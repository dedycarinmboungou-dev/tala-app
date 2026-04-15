/**
 * Tala — Service Taux de Change
 *
 * EUR/XOF : taux fixe officiel (655.957 F CFA par euro, depuis 1999)
 *           Garanti par le Trésor français — aucun appel API nécessaire.
 *
 * USD/XOF : USD → EUR via api.frankfurter.app, puis × 655.957
 *           Mis en cache 4h dans la table exchange_rates.
 *
 * Fallback : si l'API est indisponible, on utilise le dernier taux connu
 *            ou une valeur approximative (550 USD/XOF historique).
 */

const axios = require('axios');
const { db } = require('../database/db');

// ─── Constante : taux fixe EUR/XOF ───────────────────────────────────────────
const EUR_XOF = 655.957;

// ─── Cache TTL : 4 heures ─────────────────────────────────────────────────────
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

// ─── Taux de secours (dernières valeurs connues) ───────────────────────────────
const FALLBACK_USD_XOF = 600; // valeur approx si toutes les sources échouent

// ─── Cache en mémoire (évite des requêtes DB pour chaque calcul) ──────────────
const _memCache = {};

// ─── Lecture du cache DB ──────────────────────────────────────────────────────
function getCachedRate(from, to) {
  const key = `${from}_${to}`;

  // 1. Mémoire d'abord
  if (_memCache[key] && Date.now() - _memCache[key].ts < CACHE_TTL_MS) {
    return _memCache[key].rate;
  }

  // 2. Base de données
  const row = db.prepare(`
    SELECT rate, fetched_at FROM exchange_rates
    WHERE from_currency = ? AND to_currency = ?
    ORDER BY fetched_at DESC LIMIT 1
  `).get(from, to);

  if (row) {
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (age < CACHE_TTL_MS) {
      _memCache[key] = { rate: row.rate, ts: Date.now() };
      return row.rate;
    }
  }

  return null;
}

// ─── Écriture dans le cache DB + mémoire ──────────────────────────────────────
function saveRate(from, to, rate) {
  db.prepare(`
    INSERT INTO exchange_rates (from_currency, to_currency, rate)
    VALUES (?, ?, ?)
  `).run(from, to, rate);

  _memCache[`${from}_${to}`] = { rate, ts: Date.now() };
}

// ─── EUR → XOF (taux fixe) ────────────────────────────────────────────────────
function eurToXof(amount = 1) {
  return amount * EUR_XOF;
}

// ─── USD → XOF (via Frankfurter + taux fixe EUR/XOF) ─────────────────────────
async function getUsdXofRate() {
  // Cache ?
  const cached = getCachedRate('USD', 'XOF');
  if (cached) return cached;

  try {
    const { data } = await axios.get(
      'https://api.frankfurter.app/latest?from=USD&to=EUR',
      { timeout: 8000 }
    );

    const usdToEur = data?.rates?.EUR;
    if (!usdToEur || typeof usdToEur !== 'number') {
      throw new Error('Réponse Frankfurter invalide');
    }

    const rate = usdToEur * EUR_XOF;
    saveRate('USD', 'XOF', rate);
    return rate;
  } catch (err) {
    console.warn('[ExchangeRate] Frankfurter indisponible :', err.message);

    // Fallback : dernier taux connu en DB (même expiré)
    const stale = db.prepare(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = 'USD' AND to_currency = 'XOF'
      ORDER BY fetched_at DESC LIMIT 1
    `).get();

    if (stale) return stale.rate;
    return FALLBACK_USD_XOF;
  }
}

/**
 * Convertit n'importe quel montant vers XOF.
 * Devises supportées : XOF, FCFA, EUR, USD
 * Les autres devises passent par EUR (Frankfurter) puis × 655.957
 */
async function toXof(amount, currency = 'XOF') {
  if (!amount || amount === 0) return 0;

  const cur = (currency || 'XOF').toUpperCase().trim();

  if (cur === 'XOF' || cur === 'FCFA' || cur === 'CFA') return amount;
  if (cur === 'EUR') return eurToXof(amount);
  if (cur === 'USD') return amount * (await getUsdXofRate());

  // Autre devise : Frankfurter → EUR → XOF
  try {
    const cacheKey = `${cur}_XOF`;
    const cached = getCachedRate(cur, 'XOF');
    if (cached) return amount * cached;

    const { data } = await axios.get(
      `https://api.frankfurter.app/latest?from=${cur}&to=EUR`,
      { timeout: 8000 }
    );
    const toEur = data?.rates?.EUR;
    if (!toEur) throw new Error();

    const rate = toEur * EUR_XOF;
    saveRate(cur, 'XOF', rate);
    return amount * rate;
  } catch {
    console.warn(`[ExchangeRate] Conversion ${cur} → XOF impossible, fallback EUR`);
    return eurToXof(amount); // meilleur fallback possible
  }
}

/**
 * Retourne un snapshot des taux actuels (pour affichage UI).
 */
async function getRatesSnapshot() {
  const usdXof = await getUsdXofRate();
  return {
    EUR_XOF: EUR_XOF,
    USD_XOF: Math.round(usdXof),
    fetched_at: new Date().toISOString(),
  };
}

module.exports = { toXof, eurToXof, getUsdXofRate, getRatesSnapshot, EUR_XOF };
