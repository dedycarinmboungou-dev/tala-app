/**
 * Tala — Routes Abonnement Tala (Freemium)
 *
 * GET  /api/subscription/status       Statut actuel : trial / premium / expired
 * POST /api/subscription/initiate     Crée une transaction FedaPay (3 000 XOF/mois)
 * POST /api/subscription/webhook      Webhook FedaPay → active le premium
 */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const { db }  = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── FedaPay config ───────────────────────────────────────────────────────────
const FEDAPAY_BASE = (process.env.FEDAPAY_ENV === 'live')
  ? 'https://api.fedapay.com/v1'
  : 'https://sandbox-api.fedapay.com/v1';

const TALA_MONTHLY_PRICE_XOF = 3_000;
const TALA_PLAN_LABEL        = 'Tala Premium — Accès mensuel';

// ─── Helper : appel FedaPay ───────────────────────────────────────────────────
async function fedapay(method, path, data = {}) {
  if (!process.env.FEDAPAY_SECRET_KEY) {
    throw Object.assign(new Error('FedaPay non configuré.'), { status: 503 });
  }

  const res = await axios({
    method,
    url:  `${FEDAPAY_BASE}${path}`,
    data: Object.keys(data).length ? data : undefined,
    headers: {
      Authorization:  `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });
  return res.data;
}

// ─── Helper : calculer le statut d'abonnement ─────────────────────────────────
function getSubscriptionStatus(userId) {
  const sub = db.prepare(`
    SELECT plan, status, started_at, expires_at
    FROM subscriptions
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);

  if (!sub) {
    return { plan: 'none', status: 'none', days_remaining: 0, is_active: false };
  }

  const now       = new Date();
  const expiresAt = sub.expires_at ? new Date(sub.expires_at) : null;
  const isExpired = expiresAt ? expiresAt < now : false;

  if (isExpired) {
    // Marquer comme expiré en DB si ce n'est pas déjà fait
    if (sub.status === 'active') {
      db.prepare(`
        UPDATE subscriptions SET status = 'expired' WHERE user_id = ?
        AND plan = ? AND expires_at = ?
      `).run(userId, sub.plan, sub.expires_at);
    }
    return {
      plan:          sub.plan,
      status:        'expired',
      days_remaining: 0,
      expires_at:    sub.expires_at,
      is_active:     false,
    };
  }

  const msRemaining   = expiresAt ? expiresAt - now : 0;
  const daysRemaining = expiresAt ? Math.ceil(msRemaining / 86_400_000) : 0;

  return {
    plan:          sub.plan,
    status:        'active',
    days_remaining: daysRemaining,
    expires_at:    sub.expires_at,
    started_at:    sub.started_at,
    is_active:     true,
  };
}

// ─── GET /api/subscription/status ────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => {
  const status = getSubscriptionStatus(req.user.id);

  // Infos supplémentaires selon le plan
  const upsell = !status.is_active || status.plan === 'trial'
    ? {
        price_xof: TALA_MONTHLY_PRICE_XOF,
        message:   status.plan === 'trial' && status.days_remaining > 0
          ? `Ton essai gratuit expire dans ${status.days_remaining} jour(s). Passe à Premium pour continuer.`
          : 'Abonne-toi pour accéder au Coach IA, aux rapports PDF et aux alertes.',
      }
    : null;

  res.json({ ...status, upsell });
});

// ─── POST /api/subscription/initiate ─────────────────────────────────────────
// Crée une transaction FedaPay et retourne l'URL de paiement.
router.post('/initiate', requireAuth, async (req, res) => {
  // Vérifier que l'utilisateur n'a pas déjà un abonnement actif premium
  const current = getSubscriptionStatus(req.user.id);
  if (current.is_active && current.plan === 'premium') {
    return res.status(400).json({ error: 'Tu as déjà un abonnement Premium actif.' });
  }

  // Récupérer les infos utilisateur
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);

  try {
    // ── Créer la transaction FedaPay ──────────────────────────────────────────
    const txData = await fedapay('POST', '/transactions', {
      description: TALA_PLAN_LABEL,
      amount:      TALA_MONTHLY_PRICE_XOF,
      currency:    { iso: 'XOF' },
      callback_url: process.env.FEDAPAY_CALLBACK_URL
        || `${process.env.APP_URL || 'http://localhost:3001'}/api/subscription/webhook`,
      customer: {
        firstname: user.name.split(' ')[0] || user.name,
        lastname:  user.name.split(' ').slice(1).join(' ') || '',
        email:     user.email,
      },
      metadata: {
        user_id: req.user.id,
        plan:    'premium',
      },
    });

    const transactionId = txData?.v1?.transaction?.id || txData?.id;

    // ── Générer le token de paiement ──────────────────────────────────────────
    const tokenData = await fedapay('POST', `/transactions/${transactionId}/token`, {});
    const paymentUrl = tokenData?.v1?.token?.url || tokenData?.url;

    if (!paymentUrl) {
      throw new Error('FedaPay n\'a pas retourné d\'URL de paiement.');
    }

    // ── Sauvegarder la transaction en attente ─────────────────────────────────
    db.prepare(`
      INSERT INTO subscriptions (user_id, plan, status, fedapay_transaction_id, expires_at)
      VALUES (?, 'premium', 'pending', ?, NULL)
    `).run(req.user.id, String(transactionId));

    res.json({
      payment_url:    paymentUrl,
      transaction_id: transactionId,
      amount_xof:     TALA_MONTHLY_PRICE_XOF,
      description:    TALA_PLAN_LABEL,
    });

  } catch (err) {
    console.error('[SUBSCRIPTION/INITIATE]', err.response?.data || err.message);
    const status = err.status || err.response?.status || 502;
    const msg    = err.message === 'FedaPay non configuré.'
      ? err.message
      : 'Erreur lors de la création du paiement. Réessaie.';
    res.status(status).json({ error: msg });
  }
});

// ─── POST /api/subscription/webhook ──────────────────────────────────────────
// FedaPay envoie une notification quand le paiement est confirmé.
// Sécurisé via vérification de la signature HMAC.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // ── Vérification signature (si FedaPay_WEBHOOK_SECRET est défini) ──────────
  const sig = req.headers['x-fedapay-signature'];
  if (process.env.FEDAPAY_WEBHOOK_SECRET && sig) {
    const computed = crypto
      .createHmac('sha256', process.env.FEDAPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(`sha256=${computed}`))) {
      return res.status(401).json({ error: 'Signature webhook invalide.' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Payload invalide.' });
  }

  const event = payload?.name || payload?.event;
  console.log('[WEBHOOK FedaPay]', event, payload?.data?.id);

  // ── Traiter les événements de paiement ────────────────────────────────────
  if (event === 'transaction.approved' || event === 'transaction.completed') {
    const txData = payload?.data || payload?.transaction;
    const txId   = txData?.id || txData?.transaction_id;

    if (!txId) {
      return res.status(400).json({ error: 'Transaction ID manquant.' });
    }

    // Récupérer la subscription en attente
    const pendingSub = db.prepare(`
      SELECT id, user_id FROM subscriptions
      WHERE fedapay_transaction_id = ? AND status = 'pending'
    `).get(String(txId));

    if (!pendingSub) {
      // Transaction inconnue ou déjà traitée
      return res.json({ received: true });
    }

    // Calculer la date d'expiration (31 jours)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 31);

    // Activer l'abonnement
    db.prepare(`
      UPDATE subscriptions
      SET status = 'active', expires_at = ?, started_at = datetime('now')
      WHERE id = ?
    `).run(expiresAt.toISOString(), pendingSub.id);

    // Annuler l'éventuel essai encore actif
    db.prepare(`
      UPDATE subscriptions
      SET status = 'cancelled'
      WHERE user_id = ? AND plan = 'trial' AND status = 'active'
        AND id != ?
    `).run(pendingSub.user_id, pendingSub.id);

    console.log(`[SUBSCRIPTION] User ${pendingSub.user_id} → Premium activé (tx ${txId})`);

    // TODO: Envoyer email de confirmation via Brevo
  }

  // Toujours répondre 200 au webhook (sinon FedaPay retentera)
  res.json({ received: true });
});

// ─── POST /api/subscription/cancel ───────────────────────────────────────────
// L'utilisateur demande l'annulation (ne rembourse pas — juste arrête le renouvellement).
router.post('/cancel', requireAuth, (req, res) => {
  const sub = db.prepare(`
    SELECT id, plan FROM subscriptions
    WHERE user_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  if (!sub) {
    return res.status(400).json({ error: 'Aucun abonnement actif.' });
  }
  if (sub.plan === 'trial') {
    return res.status(400).json({ error: 'L\'essai gratuit ne peut pas être annulé.' });
  }

  db.prepare(`
    UPDATE subscriptions SET status = 'cancelled_pending'
    WHERE id = ?
  `).run(sub.id);

  res.json({ message: 'Abonnement marqué pour annulation. Il restera actif jusqu\'à expiration.' });
});

module.exports = router;
