/**
 * Tala — Service Chariow
 * Client HTTP pour l'API Chariow avec gestion d'erreurs et pagination.
 */

const axios = require('axios');

const CHARIOW_BASE = process.env.CHARIOW_API_BASE || 'https://api.chariow.com/v1';
const TIMEOUT_MS   = 15_000;

// ─── Erreur typée ─────────────────────────────────────────────────────────────
class ChariowError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name   = 'ChariowError';
    this.status = status;
  }
}

// ─── Client axios avec la clé API ─────────────────────────────────────────────
function makeClient(apiKey) {
  return axios.create({
    baseURL: CHARIOW_BASE,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept:        'application/json',
    },
    timeout: TIMEOUT_MS,
  });
}

// ─── Normalise la réponse Chariow (plusieurs shapes possibles) ─────────────────
function extractList(data, key) {
  if (Array.isArray(data))         return { items: data, meta: {} };
  if (Array.isArray(data?.[key]))  return { items: data[key], meta: data.meta || data.pagination || {} };
  if (Array.isArray(data?.data))   return { items: data.data, meta: data.meta || {} };
  return { items: [], meta: {} };
}

function extractObject(data) {
  return data?.store || data?.data || data || {};
}

// ─── Gestion d'erreurs Axios → ChariowError ────────────────────────────────────
function handleAxiosError(err) {
  if (err instanceof ChariowError) throw err;

  if (err.response) {
    const { status } = err.response;
    if (status === 401 || status === 403)
      throw new ChariowError('Clé API Chariow invalide ou révoquée.', 401);
    if (status === 404)
      throw new ChariowError('Store Chariow introuvable.', 404);
    if (status === 429)
      throw new ChariowError('Limite de requêtes Chariow atteinte. Réessaie dans quelques minutes.', 429);
  }

  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')
    throw new ChariowError('Timeout : Chariow met trop de temps à répondre.', 504);

  throw new ChariowError('Impossible de contacter l\'API Chariow.', 502);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Vérifie la clé API et retourne les infos du store.
 * Utilisé pour valider la connexion pendant l'onboarding.
 */
async function getStore(apiKey) {
  try {
    const { data } = await makeClient(apiKey).get('/store');
    return extractObject(data);
  } catch (err) {
    handleAxiosError(err);
  }
}

/**
 * Récupère une page de ventes.
 * @param {Object} opts - startDate (ISO), endDate (ISO), page, perPage, status
 */
async function getSalesPage(apiKey, opts = {}) {
  const {
    startDate,
    endDate,
    page    = 1,
    perPage = 100,
    status  = 'completed',
  } = opts;

  const params = { page, per_page: perPage };
  if (startDate) params.start_date = startDate;
  if (endDate)   params.end_date   = endDate;
  if (status)    params.status     = status;

  try {
    const { data } = await makeClient(apiKey).get('/sales', { params });
    const { items, meta } = extractList(data, 'sales');
    return { sales: items, meta };
  } catch (err) {
    handleAxiosError(err);
  }
}

/**
 * Récupère TOUTES les ventes d'une période (pagination auto).
 * Max 10 pages pour éviter les boucles infinies.
 */
async function getAllSales(apiKey, { startDate, endDate, status = 'completed' } = {}) {
  const all  = [];
  let page   = 1;
  const max  = 10;

  while (page <= max) {
    const { sales, meta } = await getSalesPage(apiKey, { startDate, endDate, page, perPage: 100, status });

    all.push(...sales);

    // Stop si moins de 100 résultats (dernière page)
    if (sales.length < 100) break;

    // Stop si la pagination indique explicitement la fin
    const totalPages = meta.total_pages
      || meta.last_page
      || Math.ceil((meta.total || 0) / 100);

    if (totalPages && page >= totalPages) break;

    page++;
  }

  return all;
}

/**
 * Retourne les analytiques de ventes agrégées (si l'endpoint existe).
 * Fallback silencieux → null si non disponible.
 */
async function getSalesAnalytics(apiKey, { startDate, endDate } = {}) {
  const params = {};
  if (startDate) params.start_date = startDate;
  if (endDate)   params.end_date   = endDate;

  try {
    const { data } = await makeClient(apiKey).get('/analytics/sales', { params });
    return data?.data || data || null;
  } catch {
    return null; // endpoint optionnel
  }
}

/**
 * Retourne les produits du store.
 */
async function getProducts(apiKey) {
  try {
    const { data } = await makeClient(apiKey).get('/products');
    const { items } = extractList(data, 'products');
    return items;
  } catch (err) {
    handleAxiosError(err);
  }
}

module.exports = { getStore, getSalesPage, getAllSales, getSalesAnalytics, getProducts, ChariowError };
