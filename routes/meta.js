/**
 * Tala — Routes Meta Ads
 *
 * GET  /api/meta/oauth/url          Génère l'URL d'autorisation Meta OAuth
 * GET  /api/meta/oauth/callback     Échange le code contre un token long-lived
 * GET  /api/meta/accounts           Liste les comptes publicitaires disponibles
 * POST /api/meta/select-account     Définit le compte pub principal
 * GET  /api/meta/spend?from=&to=    Dépenses sur une période (retour en USD)
 * DELETE /api/meta/disconnect       Révoque la connexion Meta
 */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const { db }  = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Constantes Meta ──────────────────────────────────────────────────────────
const META_GRAPH = 'https://graph.facebook.com/v19.0';
const META_OAUTH = 'https://www.facebook.com/v19.0/dialog/oauth';

// ─── Helper : vérifie les variables Meta requises ─────────────────────────────
function assertMetaConfig() {
  const { META_APP_ID, META_APP_SECRET, META_REDIRECT_URI } = process.env;
  if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
    const err = new Error('Meta OAuth non configuré (META_APP_ID, META_APP_SECRET, META_REDIRECT_URI).');
    err.status = 503;
    throw err;
  }
  return { META_APP_ID, META_APP_SECRET, META_REDIRECT_URI };
}

// ─── Helper : appel Graph API ─────────────────────────────────────────────────
async function graph(path, token, params = {}) {
  const { data } = await axios.get(`${META_GRAPH}${path}`, {
    params: { access_token: token, ...params },
    timeout: 15_000,
  });
  return data;
}

// ─── GET /api/meta/oauth/url ──────────────────────────────────────────────────
// Retourne l'URL d'autorisation Meta à ouvrir côté client.
// Un state signé (HMAC) est généré et sauvegardé en DB pour prévenir le CSRF.
router.get('/oauth/url', requireAuth, (req, res) => {
  try {
    const { META_APP_ID, META_REDIRECT_URI } = assertMetaConfig();

    // State = userId + timestamp + signature HMAC
    const payload = `${req.user.id}:${Date.now()}`;
    const sig     = crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(payload)
      .digest('hex')
      .slice(0, 16);
    const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

    // Sauvegarde du state en DB (expire dans 10 min)
    db.prepare(`
      INSERT OR REPLACE INTO oauth_states (user_id, state, expires_at)
      VALUES (?, ?, datetime('now', '+10 minutes'))
    `).run(req.user.id, state);

    const params = new URLSearchParams({
      client_id:     META_APP_ID,
      redirect_uri:  META_REDIRECT_URI,
      scope:         'ads_read,business_management,ads_management',
      response_type: 'code',
      state,
    });

    res.json({ url: `${META_OAUTH}?${params}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/meta/oauth/callback ─────────────────────────────────────────────
// Appelé par Meta après autorisation. Échange le code contre un token.
// Ce callback peut être déclenché soit depuis le navigateur (redirect)
// soit via window.postMessage depuis la popup.
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  // Refus utilisateur
  if (oauthError) {
    return res.redirect('/?meta_auth=denied');
  }

  if (!code || !state) {
    return res.status(400).send('Paramètres manquants.');
  }

  try {
    const { META_APP_ID, META_APP_SECRET, META_REDIRECT_URI } = assertMetaConfig();

    // ── Valider le state (anti-CSRF) ──────────────────────────────────────────
    const stateRow = db.prepare(`
      SELECT user_id FROM oauth_states
      WHERE state = ? AND expires_at > datetime('now')
    `).get(state);

    if (!stateRow) {
      return res.status(400).send('State OAuth invalide ou expiré. Recommence la connexion.');
    }

    const userId = stateRow.user_id;

    // Invalider immédiatement le state (one-use)
    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

    // ── Échange code → short-lived token ─────────────────────────────────────
    const tokenRes = await axios.get(`${META_GRAPH}/oauth/access_token`, {
      params: {
        client_id:     META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri:  META_REDIRECT_URI,
        code,
      },
      timeout: 15_000,
    });

    const shortToken = tokenRes.data.access_token;

    // ── Short-lived → Long-lived token (60 jours) ─────────────────────────────
    const longRes = await axios.get(`${META_GRAPH}/oauth/access_token`, {
      params: {
        grant_type:        'fb_exchange_token',
        client_id:         META_APP_ID,
        client_secret:     META_APP_SECRET,
        fb_exchange_token: shortToken,
      },
      timeout: 15_000,
    });

    const longToken   = longRes.data.access_token;
    const expiresInSec = longRes.data.expires_in || 5_184_000; // 60 jours par défaut
    const expiresAt   = new Date(Date.now() + expiresInSec * 1000).toISOString();

    // ── Récupérer les infos de l'utilisateur Meta ─────────────────────────────
    const meData = await graph('/me', longToken, { fields: 'id,name' });

    // ── Sauvegarder le token (sans compte sélectionné encore) ─────────────────
    const existing = db.prepare(
      'SELECT id FROM meta_connections WHERE user_id = ?'
    ).get(userId);

    if (existing) {
      db.prepare(`
        UPDATE meta_connections
        SET access_token = ?, token_expires_at = ?, connected_at = datetime('now'),
            ad_account_id = '', ad_account_name = NULL
        WHERE user_id = ?
      `).run(longToken, expiresAt, userId);
    } else {
      db.prepare(`
        INSERT INTO meta_connections
          (user_id, access_token, ad_account_id, token_expires_at)
        VALUES (?, ?, '', ?)
      `).run(userId, longToken, expiresAt);
    }

    // ── Réponse : page HTML qui ferme la popup et notifie le parent ───────────
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Tala — Meta connecté</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#080808;color:#fff;margin:0">
  <div style="text-align:center">
    <div style="font-size:3rem;margin-bottom:1rem">✅</div>
    <h2 style="color:#F5C518">Meta Ads connecté !</h2>
    <p style="color:#888">Sélectionne ton compte publicitaire dans Tala.</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'META_AUTH_SUCCESS' }, '*');
      setTimeout(() => window.close(), 1500);
    } else {
      setTimeout(() => window.location.href = '/', 1500);
    }
  </script>
</body>
</html>`);

  } catch (err) {
    console.error('[META CALLBACK]', err.response?.data || err.message);
    res.status(500).send(`
      <html><body style="background:#080808;color:#ef4444;padding:2rem;font-family:sans-serif">
        <h2>Erreur de connexion Meta</h2>
        <p>${err.response?.data?.error?.message || err.message}</p>
        <script>setTimeout(() => window.close(), 3000)</script>
      </body></html>
    `);
  }
});

// ─── GET /api/meta/accounts ───────────────────────────────────────────────────
// Liste les comptes publicitaires accessibles par l'utilisateur.
router.get('/accounts', requireAuth, async (req, res) => {
  const conn = db.prepare(
    'SELECT access_token, token_expires_at FROM meta_connections WHERE user_id = ?'
  ).get(req.user.id);

  if (!conn) {
    return res.status(400).json({ error: 'Meta non connecté.', code: 'META_NOT_CONNECTED' });
  }

  // Vérifier expiration du token
  if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
    return res.status(401).json({
      error: 'Token Meta expiré. Reconnecte ton compte Meta.',
      code: 'META_TOKEN_EXPIRED',
    });
  }

  try {
    const data = await graph('/me/adaccounts', conn.access_token, {
      fields: 'id,name,account_status,currency,spend_cap,amount_spent',
      limit:  50,
    });

    // Filtrer les comptes actifs (status = 1)
    const accounts = (data.data || []).map(acc => ({
      id:            acc.id,           // format : act_XXXXXXXXX
      name:          acc.name,
      status:        acc.account_status,
      active:        acc.account_status === 1,
      currency:      acc.currency || 'USD',
      amount_spent:  acc.amount_spent ? parseFloat(acc.amount_spent) : null,
    }));

    res.json({ accounts });
  } catch (err) {
    console.error('[META ACCOUNTS]', err.response?.data || err.message);
    const status = err.response?.status || 502;
    const msg    = err.response?.data?.error?.message || 'Erreur Meta API.';
    res.status(status).json({ error: msg });
  }
});

// ─── POST /api/meta/select-account ───────────────────────────────────────────
// L'utilisateur choisit son compte pub principal parmi la liste.
router.post('/select-account', requireAuth, async (req, res) => {
  const { account_id } = req.body;

  if (!account_id || typeof account_id !== 'string') {
    return res.status(400).json({ error: 'account_id requis.' });
  }

  const conn = db.prepare(
    'SELECT access_token FROM meta_connections WHERE user_id = ?'
  ).get(req.user.id);

  if (!conn) {
    return res.status(400).json({ error: 'Meta non connecté.' });
  }

  try {
    // Vérifier que le compte existe et est accessible
    const adId = account_id.startsWith('act_') ? account_id : `act_${account_id}`;
    const acc  = await graph(`/${adId}`, conn.access_token, {
      fields: 'id,name,account_status,currency',
    });

    // Sauvegarder
    db.prepare(`
      UPDATE meta_connections
      SET ad_account_id = ?, ad_account_name = ?
      WHERE user_id = ?
    `).run(adId, acc.name || adId, req.user.id);

    res.json({
      message:  `Compte "${acc.name}" sélectionné.`,
      account:  { id: adId, name: acc.name, currency: acc.currency },
    });
  } catch (err) {
    console.error('[META SELECT]', err.response?.data || err.message);
    res.status(400).json({ error: 'Compte publicitaire inaccessible ou invalide.' });
  }
});

// ─── GET /api/meta/spend ──────────────────────────────────────────────────────
// Retourne les dépenses sur une période (en USD, conversion faite par le dashboard).
// Query params : from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/spend', requireAuth, async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Paramètres from et to requis (YYYY-MM-DD).' });
  }

  const conn = db.prepare(`
    SELECT access_token, ad_account_id, ad_account_name, token_expires_at
    FROM meta_connections WHERE user_id = ?
  `).get(req.user.id);

  if (!conn) {
    return res.status(400).json({ error: 'Meta non connecté.', code: 'META_NOT_CONNECTED' });
  }
  if (!conn.ad_account_id) {
    return res.status(400).json({ error: 'Aucun compte publicitaire sélectionné.', code: 'NO_ACCOUNT_SELECTED' });
  }
  if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
    return res.status(401).json({ error: 'Token Meta expiré.', code: 'META_TOKEN_EXPIRED' });
  }

  try {
    // Insights account-level
    const data = await graph(`/${conn.ad_account_id}/insights`, conn.access_token, {
      fields:     'spend,impressions,clicks,reach,cpm,cpc',
      time_range: JSON.stringify({ since: from, until: to }),
      level:      'account',
    });

    const insight = data?.data?.[0] || {};
    const spendUsd = parseFloat(insight.spend || '0');

    // Données par jour (pour le graphique)
    const dailyData = await graph(`/${conn.ad_account_id}/insights`, conn.access_token, {
      fields:           'spend,date_start',
      time_range:       JSON.stringify({ since: from, until: to }),
      time_increment:   1,       // 1 jour
      level:            'account',
    }).catch(() => ({ data: [] }));

    const daily = (dailyData?.data || []).map(d => ({
      date:      d.date_start,
      spend_usd: parseFloat(d.spend || '0'),
    }));

    res.json({
      account_id:   conn.ad_account_id,
      account_name: conn.ad_account_name,
      from,
      to,
      spend_usd:    spendUsd,
      currency:     'USD',                  // Meta retourne toujours en USD
      metrics: {
        impressions: parseInt(insight.impressions || '0'),
        clicks:      parseInt(insight.clicks || '0'),
        reach:       parseInt(insight.reach || '0'),
        cpm:         parseFloat(insight.cpm || '0'),
        cpc:         parseFloat(insight.cpc || '0'),
      },
      daily,
    });
  } catch (err) {
    console.error('[META SPEND]', err.response?.data || err.message);
    const apiError = err.response?.data?.error?.message;
    res.status(err.response?.status || 502).json({
      error: apiError || 'Erreur lors de la récupération des dépenses Meta.',
    });
  }
});

// ─── DELETE /api/meta/disconnect ─────────────────────────────────────────────
router.delete('/disconnect', requireAuth, (req, res) => {
  db.prepare('DELETE FROM meta_connections WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'Compte Meta déconnecté.' });
});

module.exports = router;
