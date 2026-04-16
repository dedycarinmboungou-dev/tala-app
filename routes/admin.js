/**
 * Tala — Routes Admin
 *
 * GET /api/admin/stats   Statistiques globales de la plateforme
 *
 * Accès : email du token JWT doit correspondre à ADMIN_EMAIL (.env)
 */

const express = require('express');
const { db }  = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Middleware admin ─────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_EMAIL) {
    return res.status(503).json({ error: 'Panel admin non configuré (ADMIN_EMAIL manquant).' });
  }
  if (req.user.email !== process.env.ADMIN_EMAIL.toLowerCase().trim()) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  // Utilisateurs
  const totalUsers = db.prepare('SELECT COUNT(*) as n FROM users').get().n;

  const premiumActive = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as n FROM subscriptions
    WHERE plan = 'premium' AND status = 'active' AND expires_at > datetime('now')
  `).get().n;

  const trialActive = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as n FROM subscriptions
    WHERE plan = 'trial' AND status = 'active' AND expires_at > datetime('now')
  `).get().n;

  const expired = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as n FROM subscriptions
    WHERE status = 'expired'
  `).get().n;

  const newUsersWeek = db.prepare(`
    SELECT COUNT(*) as n FROM users
    WHERE created_at >= datetime('now', '-7 days')
  `).get().n;

  const newUsersMonth = db.prepare(`
    SELECT COUNT(*) as n FROM users
    WHERE created_at >= datetime('now', '-30 days')
  `).get().n;

  // Revenus (abonnements premium activés via FedaPay)
  const revenueRow = db.prepare(`
    SELECT COUNT(*) as n,
           COUNT(*) * 3000 as total_xof
    FROM subscriptions
    WHERE plan = 'premium'
      AND status IN ('active', 'cancelled_pending')
      AND fedapay_transaction_id IS NOT NULL
  `).get();

  // Connexions
  const chariowCount = db.prepare(
    'SELECT COUNT(*) as n FROM chariow_connections'
  ).get().n;

  const metaCount = db.prepare(
    "SELECT COUNT(*) as n FROM meta_connections WHERE ad_account_id != ''"
  ).get().n;

  // Activité Coach IA
  const coachMessages = db.prepare(
    "SELECT COUNT(*) as n FROM coach_conversations WHERE role = 'user'"
  ).get().n;

  res.json({
    users: {
      total:         totalUsers,
      trial_active:  trialActive,
      premium_active: premiumActive,
      expired:       expired,
      new_this_week: newUsersWeek,
      new_this_month: newUsersMonth,
    },
    revenue: {
      transactions_completed: revenueRow.n,
      total_xof:              revenueRow.total_xof || 0,
    },
    connections: {
      chariow: chariowCount,
      meta:    metaCount,
    },
    coach: {
      total_messages: coachMessages,
    },
    generated_at: new Date().toISOString(),
  });
});

// ─── DELETE /api/admin/zombie-users ──────────────────────────────────────────
// Supprime les comptes créés mais jamais finalisés (onboarding non démarré,
// inscription qui a échoué côté client après insert en base).
router.delete('/zombie-users', requireAuth, requireAdmin, (req, res) => {
  // Comptes avec onboarding_step=0, onboarding_completed=0, créés il y a + de 10 min
  const result = db.prepare(`
    DELETE FROM users
    WHERE onboarding_step = 0
      AND onboarding_completed = 0
      AND created_at < datetime('now', '-10 minutes')
  `).run();

  res.json({
    message: `${result.changes} compte(s) fantôme(s) supprimé(s).`,
    deleted: result.changes,
  });
});

module.exports = { router, requireAdmin };
