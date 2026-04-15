/**
 * Tala — Route Coach IA
 *
 * POST /api/coach/message
 *   Requiert : auth JWT + abonnement actif
 *   Corps    : { message: string }
 *
 *   Avant d'appeler Claude, Tala assemble automatiquement le contexte :
 *   - Dashboard du mois en cours (revenus, frais, dépenses, bénéfice, ROAS)
 *   - Top 3 produits les plus vendus (si Chariow connecté)
 *   - Abonnements outils actifs
 *   - 5 derniers échanges de la conversation
 *
 * GET /api/coach/history
 *   Retourne les N derniers messages de la conversation
 *
 * DELETE /api/coach/history
 *   Efface l'historique de conversation
 */

const express    = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const { db }     = require('../database/db');
const { requireAuth, requirePremium } = require('../middleware/auth');
const { getAllSales }   = require('../services/chariow');
const { toXof }        = require('../services/exchangeRate');

const router = express.Router();
router.use(requireAuth);

// ─── System prompt Tala Coach ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es Tala Coach, un expert en publicité digitale et rentabilité pour vendeurs de produits digitaux en Afrique francophone.

Ton rôle :
- Analyser les données RÉELLES de l'utilisateur (revenus, dépenses, ROAS, bénéfice net)
- Donner des conseils CONCRETS, DIRECTS et ACTIONNABLES
- Parler toujours en francs CFA (F CFA ou XOF)
- Identifier sans détour les campagnes qui perdent de l'argent
- Dire clairement ce qu'il faut couper, augmenter ou optimiser
- Proposer des actions prioritaires numérotées quand c'est pertinent

Ton style :
- Direct et professionnel, sans jargon inutile
- Chiffres précis tirés des données réelles
- Tu ne dis jamais "je pense" ou "peut-être" — tu analyses et tu recommandes
- Tes réponses sont concises sauf si une explication détaillée est demandée

Règles :
- Si le ROAS est < 1, c'est une urgence : dis-le clairement
- Si des données manquent, dis ce qui manque et pourquoi c'est important
- Ne fais jamais de suppositions sur des données non fournies`;

// ─── Assemblage du contexte ────────────────────────────────────────────────────
async function buildContext(userId) {
  const ctx = {
    period:          '30 derniers jours',
    dashboard:       null,
    top_products:    [],
    tool_subs:       [],
    chariow_store:   null,
  };

  // ── Connexion Chariow ─────────────────────────────────────────────────────
  const chariowConn = db.prepare(
    'SELECT api_key, store_name, store_currency FROM chariow_connections WHERE user_id = ?'
  ).get(userId);

  if (chariowConn) {
    ctx.chariow_store = chariowConn.store_name;

    try {
      // Période : 30 derniers jours
      const now   = new Date();
      const start = new Date(); start.setDate(now.getDate() - 30);
      const startDate = start.toISOString().split('T')[0];
      const endDate   = now.toISOString().split('T')[0];

      const sales = await getAllSales(chariowConn.api_key, { startDate, endDate });

      // Convertir en XOF
      for (const s of sales) {
        const raw = s.amount ?? s.total ?? s.total_amount ?? s.price ?? 0;
        const cur = s.currency || chariowConn.store_currency || 'XOF';
        s._xof = await toXof(raw, cur);
      }

      const revenue = sales.reduce((sum, s) => sum + (s._xof || 0), 0);

      // Frais Chariow
      const { getUsdXofRate } = require('../services/exchangeRate');
      const usdXof = await getUsdXofRate().catch(() => 600);
      const threshold = 5_000 * usdXof;
      const monthlyRev = revenue; // déjà 30 jours
      const feeRate = monthlyRev >= threshold ? 10 : 15;
      const fees    = Math.round(revenue * feeRate / 100);

      // Dépenses Meta
      const metaConn = db.prepare(`
        SELECT access_token, ad_account_id FROM meta_connections
        WHERE user_id = ? AND ad_account_id != ''
      `).get(userId);

      let metaSpend = 0;
      if (metaConn) {
        try {
          const axios = require('axios');
          const { data } = await axios.get(
            `https://graph.facebook.com/v19.0/${metaConn.ad_account_id}/insights`,
            {
              params: {
                access_token: metaConn.access_token,
                fields: 'spend',
                time_range: JSON.stringify({ since: startDate, until: endDate }),
                level: 'account',
              },
              timeout: 10_000,
            }
          );
          const spendUsd = parseFloat(data?.data?.[0]?.spend || '0');
          metaSpend = Math.round(await toXof(spendUsd, 'USD'));
        } catch { /* silencieux */ }
      }

      // Abonnements outils
      const toolSubsTotal = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM tool_subscriptions WHERE user_id = ? AND is_active = 1
      `).get(userId)?.total || 0;

      const netProfit = Math.round(revenue - fees - metaSpend - toolSubsTotal);
      const roas = metaSpend > 0 ? Math.round((revenue / metaSpend) * 100) / 100 : null;

      ctx.dashboard = {
        revenue_xof:    Math.round(revenue),
        chariow_fees:   fees,
        fee_rate:       feeRate,
        meta_spend_xof: metaSpend,
        tool_subs_xof:  Math.round(toolSubsTotal),
        net_profit:     netProfit,
        roas:           roas,
        sales_count:    sales.length,
        meta_connected: !!metaConn,
      };

      // Top 3 produits
      const productMap = {};
      for (const sale of sales) {
        const pid  = sale.product?.id || sale.product_id || 'unknown';
        const name = sale.product?.name || sale.product_name || `Produit #${pid}`;
        if (!productMap[pid]) productMap[pid] = { name, revenue: 0, count: 0 };
        productMap[pid].revenue += (sale._xof || 0);
        productMap[pid].count   += 1;
      }
      ctx.top_products = Object.values(productMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 3)
        .map(p => ({ ...p, revenue: Math.round(p.revenue) }));

    } catch (err) {
      // Si Chariow est indisponible, on continue sans les données
      console.warn('[COACH CTX] Chariow indisponible:', err.message);
    }
  }

  // ── Abonnements outils ────────────────────────────────────────────────────
  ctx.tool_subs = db.prepare(`
    SELECT name, amount, currency FROM tool_subscriptions
    WHERE user_id = ? AND is_active = 1
    ORDER BY amount DESC
  `).all(userId);

  return ctx;
}

// ─── Formatte le contexte en texte pour le system message ────────────────────
function formatContextBlock(ctx) {
  const lines = ['## DONNÉES RÉELLES DU VENDEUR (30 derniers jours)\n'];

  if (ctx.chariow_store) {
    lines.push(`**Store Chariow** : ${ctx.chariow_store}`);
  }

  if (ctx.dashboard) {
    const d = ctx.dashboard;
    const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' F CFA';

    lines.push('\n**Performance financière :**');
    lines.push(`- Revenus bruts Chariow : ${fmt(d.revenue_xof)}`);
    lines.push(`- Frais Chariow (${d.fee_rate}%) : −${fmt(d.chariow_fees)}`);
    lines.push(`- Dépenses Meta Ads : −${fmt(d.meta_spend_xof)}${d.meta_connected ? '' : ' (Meta non connecté)'}`);
    lines.push(`- Abonnements outils : −${fmt(d.tool_subs_xof)}`);
    lines.push(`- **BÉNÉFICE NET RÉEL : ${d.net_profit >= 0 ? '+' : ''}${fmt(d.net_profit)}**`);

    if (d.roas !== null) {
      const roasLabel = d.roas < 1 ? '🚨 PERTE' : d.roas < 2 ? '⚠️ FAIBLE' : '✅ OK';
      lines.push(`- **ROAS Tala : ${d.roas.toFixed(2)}× ${roasLabel}**`);
    } else {
      lines.push('- ROAS Tala : non calculable (Meta non connecté)');
    }

    lines.push(`- Nombre de ventes : ${d.sales_count}`);
  } else {
    lines.push('\n*⚠️ Données Chariow indisponibles (store non connecté ou erreur API)*');
  }

  if (ctx.top_products.length > 0) {
    lines.push('\n**Top produits :**');
    ctx.top_products.forEach((p, i) => {
      const rev = new Intl.NumberFormat('fr-FR').format(p.revenue);
      lines.push(`${i + 1}. ${p.name} — ${rev} F CFA (${p.count} ventes)`);
    });
  }

  if (ctx.tool_subs.length > 0) {
    lines.push('\n**Abonnements outils :**');
    ctx.tool_subs.forEach(s => {
      lines.push(`- ${s.name} : ${new Intl.NumberFormat('fr-FR').format(s.amount)} ${s.currency}/mois`);
    });
  }

  return lines.join('\n');
}

// ─── POST /api/coach/message ──────────────────────────────────────────────────
router.post('/message', requirePremium, async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message requis.' });
  }
  if (message.trim().length > 2000) {
    return res.status(400).json({ error: 'Message trop long (max 2000 caractères).' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Coach IA non configuré (ANTHROPIC_API_KEY manquant).' });
  }

  const userMessage = message.trim();

  try {
    // ── 1. Assembler le contexte ──────────────────────────────────────────────
    const ctx         = await buildContext(req.user.id);
    const contextText = formatContextBlock(ctx);

    // ── 2. Récupérer les 5 derniers échanges (historique) ─────────────────────
    const history = db.prepare(`
      SELECT role, content FROM coach_conversations
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 10
    `).all(req.user.id).reverse(); // remettre dans l'ordre chronologique

    // Construire les messages pour l'API Anthropic
    const messages = [
      // Contexte injecté comme premier message utilisateur (invisible pour l'utilisateur)
      ...history.map(h => ({ role: h.role, content: h.content })),
      // Message actuel
      { role: 'user', content: userMessage },
    ];

    // ── 3. Appel Claude ───────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      system:     `${SYSTEM_PROMPT}\n\n${contextText}`,
      messages,
    });

    const reply = response.content[0]?.text || 'Désolé, je n\'ai pas pu générer une réponse.';

    // ── 4. Sauvegarder la conversation ────────────────────────────────────────
    const saveMsg = db.transaction(() => {
      db.prepare(`
        INSERT INTO coach_conversations (user_id, role, content)
        VALUES (?, 'user', ?)
      `).run(req.user.id, userMessage);

      db.prepare(`
        INSERT INTO coach_conversations (user_id, role, content)
        VALUES (?, 'assistant', ?)
      `).run(req.user.id, reply);
    });
    saveMsg();

    // ── 5. Nettoyer l'historique (garder max 200 messages) ────────────────────
    db.prepare(`
      DELETE FROM coach_conversations
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM coach_conversations
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 200
      )
    `).run(req.user.id, req.user.id);

    res.json({
      reply,
      usage: {
        input_tokens:  response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      },
    });

  } catch (err) {
    console.error('[COACH]', err.message);

    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: 'Erreur de l\'API Claude. Réessaie dans un moment.' });
    }

    res.status(500).json({ error: 'Erreur interne du Coach IA.' });
  }
});

// ─── GET /api/coach/history ───────────────────────────────────────────────────
router.get('/history', requirePremium, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const messages = db.prepare(`
    SELECT id, role, content, created_at
    FROM coach_conversations
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.user.id, limit).reverse();

  res.json({ messages });
});

// ─── DELETE /api/coach/history ────────────────────────────────────────────────
router.delete('/history', requirePremium, (req, res) => {
  const { changes } = db.prepare(
    'DELETE FROM coach_conversations WHERE user_id = ?'
  ).run(req.user.id);

  res.json({ message: `${changes} messages supprimés.` });
});

module.exports = router;
