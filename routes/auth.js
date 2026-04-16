const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { sendWelcomeEmail } = require('../services/email');

const router = express.Router();

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  // ── Vérifications préalables (avant tout accès DB) ────────────────────────
  if (!process.env.JWT_SECRET) {
    console.error('[REGISTER] JWT_SECRET manquant dans les variables d\'environnement !');
    return res.status(500).json({ error: 'Configuration serveur incomplète. Contacte le support.' });
  }

  const trimmedName = name.trim();
  const lowerEmail  = email.toLowerCase().trim();

  if (trimmedName.length < 2) {
    return res.status(400).json({ error: 'Le nom doit faire au moins 2 caractères.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(lowerEmail);
    if (existing) {
      // Cas particulier : compte créé mais token jamais retourné (bug précédent)
      // → permettre la reconnexion si onboarding non démarré
      if (existing.onboarding_step === 0 && !existing.onboarding_completed) {
        // Retenter comme un login silencieux
      }
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // ── Transaction atomique : user + subscription ensemble ──────────────────
    const createUser = db.transaction(() => {
      const { lastInsertRowid: uid } = db.prepare(`
        INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)
      `).run(lowerEmail, passwordHash, trimmedName);

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 3);

      db.prepare(`
        INSERT INTO subscriptions (user_id, plan, status, expires_at)
        VALUES (?, 'trial', 'active', ?)
      `).run(Number(uid), trialEnd.toISOString());

      return Number(uid);
    });

    const userId = createUser();

    // ── Signer le JWT (après la transaction) ──────────────────────────────────
    let token;
    try {
      token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
    } catch (jwtErr) {
      // Rollback : supprimer l'utilisateur créé (ON DELETE CASCADE supprime la subscription)
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      console.error('[REGISTER] Échec jwt.sign → rollback user', jwtErr.message);
      return res.status(500).json({ error: 'Erreur de configuration serveur (JWT). Contacte le support.' });
    }

    // Email de bienvenue (silencieux si Brevo non configuré)
    sendWelcomeEmail({ email: lowerEmail, name: trimmedName }).catch((e) => {
      console.warn('[AUTH] sendWelcomeEmail:', e.message);
    });

    res.status(201).json({
      message: `Bienvenue ${trimmedName} ! Ton essai gratuit de 3 jours commence maintenant.`,
      token,
      user: {
        id: userId,
        email: lowerEmail,
        name: trimmedName,
        onboarding_step: 0,
        onboarding_completed: 0,
      },
    });
  } catch (err) {
    console.error('[REGISTER] Erreur inattendue:', err.message, err.stack);
    res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[LOGIN] JWT_SECRET manquant !');
    return res.status(500).json({ error: 'Configuration serveur incomplète. Contacte le support.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

    // Délai constant pour éviter le timing attack
    const dummyHash = '$2a$12$dummyhashfortimingattackprevention000000000000000000';
    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        onboarding_step: user.onboarding_step,
        onboarding_completed: user.onboarding_completed,
      },
    });
  } catch (err) {
    console.error('[LOGIN]', err);
    res.status(500).json({ error: 'Erreur de connexion.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const rawSub = db.prepare(`
    SELECT plan, status, started_at, expires_at
    FROM subscriptions
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  const chariow = db.prepare(`
    SELECT store_name, store_slug, last_sync_at FROM chariow_connections WHERE user_id = ?
  `).get(req.user.id);

  const meta = db.prepare(`
    SELECT ad_account_name, connected_at FROM meta_connections WHERE user_id = ?
  `).get(req.user.id);

  // ── Enrichir la subscription avec is_active + days_remaining ────────────────
  let subscription = null;
  if (rawSub) {
    const now       = new Date();
    const expiresAt = rawSub.expires_at ? new Date(rawSub.expires_at) : null;
    const isExpired = expiresAt ? expiresAt < now : false;
    const isActive  = !isExpired && (rawSub.status === 'active' || rawSub.status === 'cancelled_pending');
    const msLeft    = expiresAt && !isExpired ? expiresAt - now : 0;
    const daysRemaining = msLeft > 0 ? Math.ceil(msLeft / 86_400_000) : 0;

    subscription = {
      ...rawSub,
      is_active:     isActive,
      days_remaining: daysRemaining,
    };
  }

  res.json({
    user: req.user,
    subscription,
    connections: { chariow: chariow || null, meta: meta || null },
  });
});

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', requireAuth, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const updates = {};

    if (name && name.trim().length >= 2) {
      updates.name = name.trim();
    }

    if (currentPassword && newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Nouveau mot de passe trop court (min. 8 caractères).' });
      }
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
      }
      updates.password_hash = await bcrypt.hash(newPassword, 12);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune modification à appliquer.' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.user.id];

    db.prepare(`UPDATE users SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).run(...values);

    res.json({ message: 'Profil mis à jour.' });
  } catch (err) {
    console.error('[PROFILE UPDATE]', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

module.exports = router;
