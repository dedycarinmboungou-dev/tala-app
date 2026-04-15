/**
 * Tala — Route Dashboard
 *
 * GET /api/dashboard?period=30
 *
 * Retourne :
 *   revenue         - Revenus Chariow bruts (XOF)
 *   chariow_fees    - Frais Chariow déduits (XOF)
 *   fee_rate        - Taux appliqué (10 ou 15)
 *   meta_spend      - Dépenses Meta Ads (XOF) — 0 si non connecté
 *   tool_subs_total - Total abonnements outils du mois (XOF)
 *   net_profit      - Bénéfice net réel (XOF)
 *   roas            - ROAS Tala (null si pas de Meta)
 *   sales_count     - Nombre de ventes
 *   chart           - Tableau { date, revenue, spend } pour le graphique
 *   rates           - Snapshot des taux de change utilisés
 */

const express = require('express');
const { db }  = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { getAllSales, ChariowError }  = require('../services/chariow');
const { toXof, getRatesSnapshot, EUR_XOF } = require('../services/exchangeRate');

const router = express.Router();
router.use(requireAuth);

// ─── Seuil Chariow : 5 000 USD/mois en XOF ───────────────────────────────────
// 15 % si CA mensuel < seuil,  10 % si CA mensuel ≥ seuil
const CHARIOW_FEE_THRESHOLD_USD = 5_000;
const CHARIOW_FEE_HIGH  = 10;
const CHARIOW_FEE_LOW   = 15;

// ─── Helper : plage de dates ──────────────────────────────────────────────────
function dateRange(periodDays) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - periodDays);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate:   end.toISOString().split('T')[0],
  };
}

// ─── Helper : normaliser le montant d'une vente ───────────────────────────────
// Chariow peut retourner le montant sous différentes clés
function getSaleAmount(sale) {
  return sale.amount
    ?? sale.total
    ?? sale.total_amount
    ?? sale.price
    ?? sale.revenue
    ?? 0;
}

function getSaleCurrency(sale, storeCurrency) {
  return sale.currency
    || sale.total_currency
    || sale.amount_currency
    || storeCurrency
    || 'XOF';
}

function getSaleDate(sale) {
  const raw = sale.created_at || sale.date || sale.paid_at || sale.completed_at;
  if (!raw) return null;
  return new Date(raw).toISOString().split('T')[0];
}

// ─── Helper : construire le tableau tendance journalière ─────────────────────
function buildDailyChart(sales, startDate, endDate, storeCurrency, dailyMetaSpend = {}) {
  // Initialiser tous les jours de la période
  const days = {};
  const cur  = new Date(startDate);
  const end  = new Date(endDate);

  while (cur <= end) {
    const key = cur.toISOString().split('T')[0];
    days[key] = { date: key, revenue: 0, spend: dailyMetaSpend[key] || 0, count: 0 };
    cur.setDate(cur.getDate() + 1);
  }

  // Remplir avec les ventes (déjà converties en XOF)
  for (const sale of sales) {
    const day = getSaleDate(sale);
    if (day && days[day]) {
      days[day].revenue += sale._xof || getSaleAmount(sale);
      days[day].count   += 1;
    }
  }

  return Object.values(days);
}

// ─── GET /api/dashboard ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const periodDays = Math.min(Math.max(parseInt(req.query.period) || 30, 7), 90);

  // ── 1. Vérifier la connexion Chariow ─────────────────────────────────────
  const chariowConn = db.prepare(
    'SELECT api_key, store_currency, store_name FROM chariow_connections WHERE user_id = ?'
  ).get(req.user.id);

  if (!chariowConn) {
    return res.status(400).json({
      error: 'Store Chariow non connecté.',
      code: 'CHARIOW_NOT_CONNECTED',
    });
  }

  // ── 2. Connexion Meta (optionnelle) ───────────────────────────────────────
  const metaConn = db.prepare(
    'SELECT access_token, ad_account_id FROM meta_connections WHERE user_id = ?'
  ).get(req.user.id);

  // ── 3. Taux de change ─────────────────────────────────────────────────────
  let rates;
  try {
    rates = await getRatesSnapshot();
  } catch {
    rates = { EUR_XOF, USD_XOF: 600, fetched_at: new Date().toISOString() };
  }

  const { startDate, endDate } = dateRange(periodDays);
  const storeCurrency = chariowConn.store_currency || 'XOF';

  // ── 4. Récupérer les ventes Chariow ───────────────────────────────────────
  let sales = [];
  let chariowError = null;

  try {
    sales = await getAllSales(chariowConn.api_key, { startDate, endDate });

    // Convertir chaque vente en XOF une seule fois
    for (const sale of sales) {
      const raw = getSaleAmount(sale);
      const cur = getSaleCurrency(sale, storeCurrency);
      sale._xof = await toXof(raw, cur);
    }
  } catch (err) {
    chariowError = err instanceof ChariowError ? err.message : 'Erreur de récupération Chariow.';
    console.error('[DASHBOARD] Chariow fetch error:', err.message);
  }

  // ── 5. Calculer le revenu brut total (XOF) ────────────────────────────────
  const revenueXof = sales.reduce((sum, s) => sum + (s._xof || 0), 0);

  // ── 6. Calculer les frais Chariow ─────────────────────────────────────────
  // Normaliser au mensuel pour comparer au seuil de 5 000 USD
  const revenueMonthly = revenueXof * (30 / periodDays);
  const thresholdXof   = CHARIOW_FEE_THRESHOLD_USD * rates.USD_XOF;
  const feeRate        = revenueMonthly >= thresholdXof ? CHARIOW_FEE_HIGH : CHARIOW_FEE_LOW;
  const chariowFees    = Math.round(revenueXof * feeRate / 100);

  // ── 7. Dépenses Meta Ads (XOF) ────────────────────────────────────────────
  let metaSpend = 0;
  let metaError = null;

  if (metaConn) {
    try {
      metaSpend = await fetchMetaSpend(metaConn, startDate, endDate, rates);
    } catch (err) {
      metaError = 'Erreur de récupération Meta Ads.';
      console.error('[DASHBOARD] Meta fetch error:', err.message);
    }
  }

  // ── 8. Total abonnements outils (proraté selon la période) ────────────────
  const toolSubs = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as monthly_total
    FROM tool_subscriptions
    WHERE user_id = ? AND is_active = 1
  `).get(req.user.id);

  const toolSubsMonthly = toolSubs.monthly_total || 0;
  const toolSubsPeriod  = Math.round(toolSubsMonthly * (periodDays / 30));

  // ── 9. Bénéfice net ───────────────────────────────────────────────────────
  const netProfit = Math.round(revenueXof - chariowFees - metaSpend - toolSubsPeriod);

  // ── 10. ROAS Tala ─────────────────────────────────────────────────────────
  // ROAS = Revenus Chariow XOF / Dépenses Meta XOF
  // Null si pas de Meta connecté ou dépenses = 0
  const roas = metaConn && metaSpend > 0
    ? Math.round((revenueXof / metaSpend) * 100) / 100
    : null;

  // ── 11. Graphique tendance journalière ────────────────────────────────────
  const chart = buildDailyChart(sales, startDate, endDate, storeCurrency);

  // ── 12. Réponse ───────────────────────────────────────────────────────────
  res.json({
    period:         periodDays,
    start_date:     startDate,
    end_date:       endDate,

    // Métriques principales
    revenue:        Math.round(revenueXof),
    chariow_fees:   chariowFees,
    fee_rate:       feeRate,
    meta_spend:     Math.round(metaSpend),
    tool_subs:      toolSubsPeriod,
    tool_subs_monthly: Math.round(toolSubsMonthly),
    net_profit:     netProfit,
    roas:           roas,
    sales_count:    sales.length,

    // Graphique
    chart,

    // Infos contextuelles
    store_name:     chariowConn.store_name,
    meta_connected: !!metaConn,
    rates,

    // Warnings éventuels (non-bloquants)
    warnings: [
      chariowError && { code: 'CHARIOW_FETCH_ERROR', message: chariowError },
      metaError    && { code: 'META_FETCH_ERROR',    message: metaError },
    ].filter(Boolean),
  });
});

// ─── Helper : récupérer les dépenses Meta ─────────────────────────────────────
// Sera étendu quand Meta OAuth sera implémenté
async function fetchMetaSpend(metaConn, startDate, endDate, rates) {
  const axios = require('axios');

  // Appel Meta Marketing API
  // Endpoint : /v19.0/act_{ad_account_id}/insights
  const accountId = metaConn.ad_account_id.replace(/^act_/, '');

  const { data } = await axios.get(
    `https://graph.facebook.com/v19.0/act_${accountId}/insights`,
    {
      params: {
        access_token: metaConn.access_token,
        fields:       'spend',
        time_range:   JSON.stringify({ since: startDate, until: endDate }),
        level:        'account',
      },
      timeout: 15_000,
    }
  );

  // Meta retourne le spend en USD (même pour les comptes africains)
  const spendUsd = parseFloat(data?.data?.[0]?.spend || '0');

  // Convertir en XOF
  return await toXof(spendUsd, 'USD');
}

module.exports = router;
