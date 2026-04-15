/**
 * Tala — Routes Abonnements Outils (CRUD)
 *
 * GET    /api/subscriptions/tools          Lister tous les abonnements actifs
 * POST   /api/subscriptions/tools          Créer un nouvel abonnement
 * PUT    /api/subscriptions/tools/:id      Modifier un abonnement
 * DELETE /api/subscriptions/tools/:id      Supprimer un abonnement
 * GET    /api/subscriptions/tools/summary  Total mensuel + liste (pour dashboard)
 */

const express = require('express');
const { db }  = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Devises acceptées ────────────────────────────────────────────────────────
const ALLOWED_CURRENCIES = new Set(['XOF', 'FCFA', 'USD', 'EUR', 'GBP', 'NGN', 'GHS', 'MAD', 'TND']);

// ─── Validation d'un abonnement ───────────────────────────────────────────────
function validateSub({ name, amount, currency = 'XOF' }) {
  if (!name || typeof name !== 'string' || name.trim().length === 0)
    return 'Le nom de l\'outil est requis.';
  if (name.trim().length > 100)
    return 'Le nom est trop long (max 100 caractères).';
  if (amount === undefined || amount === null || isNaN(Number(amount)))
    return 'Le montant est requis.';
  if (Number(amount) <= 0)
    return 'Le montant doit être supérieur à 0.';
  if (Number(amount) > 10_000_000)
    return 'Montant trop élevé (max 10 000 000).';
  if (!ALLOWED_CURRENCIES.has(currency.toUpperCase()))
    return `Devise non supportée. Utilisez : ${[...ALLOWED_CURRENCIES].join(', ')}.`;
  return null;
}

// ─── GET /api/subscriptions/tools ─────────────────────────────────────────────
router.get('/', (req, res) => {
  const subs = db.prepare(`
    SELECT id, name, amount, currency, is_active, created_at, updated_at
    FROM tool_subscriptions
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at ASC
  `).all(req.user.id);

  const monthly_total = subs.reduce((sum, s) => {
    // Conversion approximative pour affichage total (tout en XOF si même devise)
    return sum + s.amount;
  }, 0);

  res.json({ subscriptions: subs, monthly_total });
});

// ─── GET /api/subscriptions/tools/summary ─────────────────────────────────────
// Utilisé par le dashboard pour un accès rapide
router.get('/summary', (req, res) => {
  const result = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(amount), 0) as monthly_total
    FROM tool_subscriptions
    WHERE user_id = ? AND is_active = 1
  `).get(req.user.id);

  res.json(result);
});

// ─── POST /api/subscriptions/tools ────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, amount, currency = 'XOF' } = req.body;

  const err = validateSub({ name, amount, currency });
  if (err) return res.status(400).json({ error: err });

  // Limite : max 20 abonnements par utilisateur
  const count = db.prepare(
    'SELECT COUNT(*) as n FROM tool_subscriptions WHERE user_id = ? AND is_active = 1'
  ).get(req.user.id);

  if (count.n >= 20) {
    return res.status(400).json({ error: 'Maximum 20 abonnements outils autorisés.' });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tool_subscriptions (user_id, name, amount, currency)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, name.trim(), Number(amount), currency.toUpperCase());

  const created = db.prepare(
    'SELECT * FROM tool_subscriptions WHERE id = ?'
  ).get(lastInsertRowid);

  res.status(201).json({
    message: `"${created.name}" ajouté.`,
    subscription: created,
  });
});

// ─── PUT /api/subscriptions/tools/:id ────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalide.' });

  // Vérifier que l'abonnement appartient à l'utilisateur
  const existing = db.prepare(
    'SELECT * FROM tool_subscriptions WHERE id = ? AND user_id = ?'
  ).get(id, req.user.id);

  if (!existing) {
    return res.status(404).json({ error: 'Abonnement introuvable.' });
  }

  const name     = req.body.name     !== undefined ? req.body.name     : existing.name;
  const amount   = req.body.amount   !== undefined ? req.body.amount   : existing.amount;
  const currency = req.body.currency !== undefined ? req.body.currency : existing.currency;

  const err = validateSub({ name, amount, currency });
  if (err) return res.status(400).json({ error: err });

  db.prepare(`
    UPDATE tool_subscriptions
    SET name = ?, amount = ?, currency = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(name.trim(), Number(amount), currency.toUpperCase(), id, req.user.id);

  const updated = db.prepare('SELECT * FROM tool_subscriptions WHERE id = ?').get(id);

  res.json({
    message: `"${updated.name}" mis à jour.`,
    subscription: updated,
  });
});

// ─── DELETE /api/subscriptions/tools/:id ─────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalide.' });

  const existing = db.prepare(
    'SELECT id, name FROM tool_subscriptions WHERE id = ? AND user_id = ?'
  ).get(id, req.user.id);

  if (!existing) {
    return res.status(404).json({ error: 'Abonnement introuvable.' });
  }

  // Soft delete pour conserver l'historique
  db.prepare(`
    UPDATE tool_subscriptions
    SET is_active = 0, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(id, req.user.id);

  res.json({ message: `"${existing.name}" supprimé.` });
});

module.exports = router;
