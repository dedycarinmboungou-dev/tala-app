/**
 * Tala — Routes Onboarding
 *
 * POST /api/onboarding/chariow        Valide la clé API + sauvegarde le store
 * POST /api/onboarding/step           Met à jour l'étape d'onboarding
 * POST /api/onboarding/subscriptions  Sauvegarde les abonnements outils en batch
 * POST /api/onboarding/complete       Marque l'onboarding comme terminé
 */

const express  = require('express');
const { db }   = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { getStore, ChariowError } = require('../services/chariow');

const router = express.Router();
router.use(requireAuth); // toutes les routes onboarding nécessitent JWT

// ─── POST /api/onboarding/chariow ─────────────────────────────────────────────
router.post('/chariow', async (req, res) => {
  const { api_key } = req.body;

  if (!api_key || typeof api_key !== 'string' || api_key.trim().length < 8) {
    return res.status(400).json({ error: 'Clé API invalide.' });
  }

  const key = api_key.trim();

  try {
    // ── 1. Vérifier la clé en appelant l'API Chariow ──────────────────────────
    const store = await getStore(key);

    // ── 2. Extraire les infos du store ────────────────────────────────────────
    const storeId   = store.id    || store.store_id   || null;
    const storeName = store.name  || store.store_name || store.title || 'Mon Store';
    const storeSlug = store.slug  || store.store_slug || null;
    const storeCurrency = store.currency || store.default_currency || 'XOF';

    // ── 3. Upsert dans chariow_connections ────────────────────────────────────
    const existing = db.prepare(
      'SELECT id FROM chariow_connections WHERE user_id = ?'
    ).get(req.user.id);

    if (existing) {
      db.prepare(`
        UPDATE chariow_connections
        SET api_key = ?, store_id = ?, store_name = ?, store_slug = ?,
            store_currency = ?, connected_at = datetime('now'), last_sync_at = NULL
        WHERE user_id = ?
      `).run(key, storeId, storeName, storeSlug, storeCurrency, req.user.id);
    } else {
      db.prepare(`
        INSERT INTO chariow_connections
          (user_id, api_key, store_id, store_name, store_slug, store_currency)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.user.id, key, storeId, storeName, storeSlug, storeCurrency);
    }

    // ── 4. Avancer l'étape d'onboarding ──────────────────────────────────────
    db.prepare(`
      UPDATE users SET onboarding_step = MAX(onboarding_step, 1),
                       updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id);

    res.json({
      message: `Store "${storeName}" connecté avec succès !`,
      store: { id: storeId, name: storeName, slug: storeSlug, currency: storeCurrency },
    });

  } catch (err) {
    if (err instanceof ChariowError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[ONBOARDING/CHARIOW]', err);
    res.status(500).json({ error: 'Erreur lors de la connexion à Chariow.' });
  }
});

// ─── POST /api/onboarding/step ────────────────────────────────────────────────
// Permet de passer manuellement à une étape (ex: skip Meta)
router.post('/step', (req, res) => {
  const { step } = req.body;
  if (typeof step !== 'number' || step < 0 || step > 3) {
    return res.status(400).json({ error: 'Étape invalide.' });
  }

  db.prepare(`
    UPDATE users SET onboarding_step = MAX(onboarding_step, ?),
                     updated_at = datetime('now')
    WHERE id = ?
  `).run(step, req.user.id);

  res.json({ message: 'Étape mise à jour.', step });
});

// ─── POST /api/onboarding/subscriptions ──────────────────────────────────────
// Sauvegarde les abonnements outils (batch, écrase les existants)
router.post('/subscriptions', (req, res) => {
  const { subscriptions } = req.body;

  if (!Array.isArray(subscriptions)) {
    return res.status(400).json({ error: 'Format invalide : subscriptions doit être un tableau.' });
  }

  // Validation basique
  for (const s of subscriptions) {
    if (!s.name || typeof s.name !== 'string' || s.name.trim().length === 0) {
      return res.status(400).json({ error: 'Chaque abonnement doit avoir un nom.' });
    }
    if (!s.amount || typeof s.amount !== 'number' || s.amount <= 0) {
      return res.status(400).json({ error: `Montant invalide pour "${s.name}".` });
    }
  }

  // Transaction : vider les anciens et insérer les nouveaux
  const insertMany = db.transaction((subs) => {
    db.prepare('DELETE FROM tool_subscriptions WHERE user_id = ?').run(req.user.id);

    const insert = db.prepare(`
      INSERT INTO tool_subscriptions (user_id, name, amount, currency)
      VALUES (?, ?, ?, ?)
    `);

    for (const s of subs) {
      insert.run(req.user.id, s.name.trim(), s.amount, s.currency || 'XOF');
    }
  });

  insertMany(subscriptions);

  const saved = db.prepare(
    'SELECT * FROM tool_subscriptions WHERE user_id = ? AND is_active = 1'
  ).all(req.user.id);

  res.json({ message: `${saved.length} abonnement(s) sauvegardé(s).`, subscriptions: saved });
});

// ─── POST /api/onboarding/complete ────────────────────────────────────────────
router.post('/complete', (req, res) => {
  // Vérifier qu'au moins Chariow est connecté
  const chariow = db.prepare(
    'SELECT id FROM chariow_connections WHERE user_id = ?'
  ).get(req.user.id);

  if (!chariow) {
    return res.status(400).json({
      error: 'Connecte d\'abord ton store Chariow avant de terminer l\'onboarding.',
    });
  }

  db.prepare(`
    UPDATE users
    SET onboarding_completed = 1, onboarding_step = 3, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id);

  res.json({ message: 'Onboarding terminé ! Bienvenue dans Tala 🎉' });
});

module.exports = router;
