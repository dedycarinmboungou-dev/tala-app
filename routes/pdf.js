/**
 * Tala — Route Rapport PDF
 *
 * GET /api/pdf/report?period=30
 * Requiert : auth JWT + abonnement actif (trial ou premium)
 *
 * Contenu :
 *   - En-tête (logo, slogan, date, boutique)
 *   - Résumé financier (revenus, frais, dépenses, bénéfice net, ROAS)
 *   - Top 5 produits
 *   - Abonnements outils actifs
 *   - Recommandations Tala Coach (via Claude Haiku si API key configurée)
 *   - Pied de page
 */

const express   = require('express');
const PDFDoc    = require('pdfkit');
const Anthropic = require('@anthropic-ai/sdk');
const { db }    = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { getAllSales }  = require('../services/chariow');
const { toXof, getRatesSnapshot, EUR_XOF } = require('../services/exchangeRate');

const router = express.Router();

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  gold:    '#D4AF37',
  black:   '#1A1A1A',
  gray:    '#666666',
  white:   '#FFFFFF',
  green:   '#27AE60',
  red:     '#C0392B',
  orange:  '#E67E22',
  bgDark:  '#1A1A1A',
  bgLight: '#FAFAFA',
};

const PAGE_W    = 595.28;
const MARGIN    = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Formateurs ───────────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F CFA';
}

function fmtDate(d = new Date()) {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ─── Assemblage des données ───────────────────────────────────────────────────
async function buildReportData(userId, periodDays) {
  const period = Math.min(Math.max(parseInt(periodDays) || 30, 7), 90);

  const chariowConn = db.prepare(
    'SELECT api_key, store_currency, store_name FROM chariow_connections WHERE user_id = ?'
  ).get(userId);

  if (!chariowConn) {
    const err = new Error('Connecte d\'abord ton store Chariow pour générer un rapport.');
    err.status = 400; throw err;
  }

  const metaConn = db.prepare(`
    SELECT access_token, ad_account_id FROM meta_connections
    WHERE user_id = ? AND ad_account_id != ''
  `).get(userId);

  const toolSubs = db.prepare(`
    SELECT name, amount, currency FROM tool_subscriptions
    WHERE user_id = ? AND is_active = 1 ORDER BY amount DESC
  `).all(userId);

  let rates;
  try { rates = await getRatesSnapshot(); }
  catch { rates = { EUR_XOF, USD_XOF: 600, fetched_at: new Date().toISOString() }; }

  const now   = new Date();
  const start = new Date(); start.setDate(now.getDate() - period);
  const startDate = start.toISOString().split('T')[0];
  const endDate   = now.toISOString().split('T')[0];
  const storeCurrency = chariowConn.store_currency || 'XOF';

  // ── Ventes Chariow ────────────────────────────────────────────────────────
  let sales = [];
  try {
    sales = await getAllSales(chariowConn.api_key, { startDate, endDate });
    for (const s of sales) {
      const raw = s.amount ?? s.total ?? s.total_amount ?? s.price ?? 0;
      const cur = s.currency || storeCurrency;
      s._xof = await toXof(raw, cur);
    }
  } catch { /* rapport partiel si Chariow temporairement indisponible */ }

  const revenue     = sales.reduce((sum, s) => sum + (s._xof || 0), 0);
  const revenueM    = revenue * (30 / period);
  const threshold   = 5_000 * (rates.USD_XOF || 600);
  const feeRate     = revenueM >= threshold ? 10 : 15;
  const chariowFees = Math.round(revenue * feeRate / 100);

  // ── Dépenses Meta Ads ─────────────────────────────────────────────────────
  let metaSpend = 0;
  if (metaConn?.ad_account_id) {
    try {
      const axios = require('axios');
      const { data } = await axios.get(
        `https://graph.facebook.com/v19.0/${metaConn.ad_account_id}/insights`,
        {
          params: {
            access_token: metaConn.access_token,
            fields:       'spend',
            time_range:   JSON.stringify({ since: startDate, until: endDate }),
            level:        'account',
          },
          timeout: 10_000,
        }
      );
      const spendUsd = parseFloat(data?.data?.[0]?.spend || '0');
      metaSpend = Math.round(await toXof(spendUsd, 'USD'));
    } catch { /* silencieux */ }
  }

  const toolSubsTotal  = toolSubs.reduce((s, t) => s + t.amount, 0);
  const toolSubsPeriod = Math.round(toolSubsTotal * (period / 30));
  const netProfit      = Math.round(revenue - chariowFees - metaSpend - toolSubsPeriod);
  const roas           = metaConn && metaSpend > 0
    ? Math.round((revenue / metaSpend) * 100) / 100
    : null;

  // ── Top 5 produits ────────────────────────────────────────────────────────
  const pMap = {};
  for (const s of sales) {
    const pid  = s.product?.id || s.product_id || 'unknown';
    const name = s.product?.name || s.product_name || `Produit #${pid}`;
    if (!pMap[pid]) pMap[pid] = { name, revenue: 0, count: 0 };
    pMap[pid].revenue += (s._xof || 0);
    pMap[pid].count   += 1;
  }
  const topProducts = Object.values(pMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map(p => ({ ...p, revenue: Math.round(p.revenue) }));

  // ── Recommandations Tala Coach ────────────────────────────────────────────
  let recommendations = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const ctxText = [
        `Store : ${chariowConn.store_name}`,
        `Période : ${period} derniers jours (${startDate} → ${endDate})`,
        `Revenus bruts : ${fmt(revenue)}`,
        `Frais Chariow (${feeRate}%) : −${fmt(chariowFees)}`,
        `Dépenses Meta Ads : −${fmt(metaSpend)}`,
        `Abonnements outils (proraté) : −${fmt(toolSubsPeriod)}`,
        `Bénéfice net réel : ${fmt(netProfit)}`,
        roas !== null ? `ROAS Tala : ${roas}×` : 'ROAS Tala : N/A (Meta non connecté)',
        `Nombre de ventes : ${sales.length}`,
        topProducts.length
          ? 'Top produits :\n' + topProducts.map((p, i) => `  ${i + 1}. ${p.name} — ${fmt(p.revenue)} (${p.count} ventes)`).join('\n')
          : '',
      ].filter(Boolean).join('\n');

      const resp = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system:     `Tu es Tala Coach, expert en publicité Meta Ads pour vendeurs digitaux africains.\nDonnées réelles du vendeur :\n${ctxText}\n\nRéponds en 5 points numérotés maximum, concis, directs, avec chiffres précis si pertinent.`,
        messages:   [{ role: 'user', content: 'Génère un résumé des recommandations clés pour ce mois en 5 points maximum.' }],
      });
      recommendations = resp.content[0]?.text?.trim() || null;
    } catch (err) {
      console.warn('[PDF/Coach]', err.message);
    }
  }

  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId);

  return {
    user, period, startDate, endDate,
    storeName:      chariowConn.store_name || 'Mon Store',
    revenue:        Math.round(revenue),
    chariowFees,    feeRate,
    metaSpend,      metaConnected: !!metaConn,
    toolSubsPeriod, toolSubsTotal, toolSubs,
    netProfit,      roas,          salesCount: sales.length,
    topProducts,    recommendations,
    generatedAt:    new Date(),
  };
}

// ─── GET /api/pdf/report ──────────────────────────────────────────────────────
router.get('/report', requireAuth, async (req, res) => {
  try {
    const d = await buildReportData(req.user.id, req.query.period || 30);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tala-rapport-${d.startDate}-${d.endDate}.pdf"`
    );

    const doc = new PDFDoc({
      size:    'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title:   `Rapport Tala — ${d.storeName}`,
        Author:  'Tala',
        Subject: `Rapport financier — ${d.period} jours`,
      },
    });

    doc.pipe(res);
    renderPDF(doc, d);
    doc.end();

  } catch (err) {
    console.error('[PDF]', err.message);
    if (!res.headersSent) {
      res.status(err.status || 500).json({
        error: err.message || 'Erreur lors de la génération du rapport PDF.',
      });
    }
  }
});

// ─── Rendu complet du PDF ─────────────────────────────────────────────────────
function renderPDF(doc, d) {
  let y = 0;

  // ══════════════════════════════════════════════════════════════════════════════
  // EN-TÊTE
  // ══════════════════════════════════════════════════════════════════════════════
  doc.rect(0, 0, PAGE_W, 88).fill(C.bgDark);

  // Logo TALA
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(34)
     .text('TALA', MARGIN, 16);

  // Slogan
  doc.fillColor('#CCCCCC').font('Helvetica').fontSize(9.5)
     .text('Regarde ce que tu gagnes vraiment.', MARGIN, 55);

  // Infos rapport (aligné à droite)
  doc.fillColor('#888888').fontSize(7.5)
     .text(
       `${d.storeName}   ·   ${d.period} derniers jours   ·   Généré le ${fmtDate(d.generatedAt)}`,
       MARGIN, 73, { width: CONTENT_W, align: 'right' }
     );

  y = 103;

  // ══════════════════════════════════════════════════════════════════════════════
  // RÉSUMÉ FINANCIER
  // ══════════════════════════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, 'RÉSUMÉ FINANCIER', y);

  const financialRows = [
    { label: 'Revenus bruts Chariow',                        value: fmt(d.revenue),          color: C.black },
    { label: `Frais Chariow (${d.feeRate}%)`,                value: '− ' + fmt(d.chariowFees), color: C.gray  },
    { label: 'Dépenses Meta Ads' + (d.metaConnected ? '' : ' (non connecté)'),
                                                              value: (d.metaConnected ? '− ' : '') + fmt(d.metaSpend), color: C.gray },
    { label: `Abonnements outils (proraté ${d.period}j)`,    value: '− ' + fmt(d.toolSubsPeriod), color: C.gray },
  ];

  for (const r of financialRows) {
    y = drawMetricRow(doc, r.label, r.value, y, r.color);
  }

  // Ligne de séparation
  y += 6;
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
  y += 8;

  // Bénéfice net (encadré coloré)
  const profitColor = d.netProfit >= 0 ? C.green : C.red;
  const profitBg    = d.netProfit >= 0 ? '#EFF9F2' : '#FDF0EF';
  doc.rect(MARGIN, y, CONTENT_W, 36).fill(profitBg);

  doc.fillColor('#333333').font('Helvetica-Bold').fontSize(10)
     .text('BÉNÉFICE NET RÉEL', MARGIN + 12, y + 10);

  doc.fillColor(profitColor).font('Helvetica-Bold').fontSize(14)
     .text(
       (d.netProfit >= 0 ? '+' : '') + fmt(d.netProfit),
       MARGIN + 12, y + 8, { width: CONTENT_W - 24, align: 'right' }
     );
  y += 46;

  // ROAS
  if (d.roas !== null) {
    const roasColor = d.roas < 1 ? C.red : d.roas < 2 ? C.orange : C.green;
    const roasNote  = d.roas < 1
      ? ' — ⚠ PERTE : réduire le budget pub'
      : d.roas < 2 ? ' — Faible : optimiser les campagnes' : ' — Rentable ✓';
    y = drawMetricRow(doc, `ROAS Tala${roasNote}`, `${d.roas.toFixed(2)}×`, y, roasColor, true);
  } else {
    y = drawMetricRow(doc, 'ROAS Tala', 'N/A (Meta Ads non connecté)', y, C.gray);
  }

  y = drawMetricRow(doc, 'Nombre de ventes', `${d.salesCount}`, y, C.gray);
  y += 20;

  // ══════════════════════════════════════════════════════════════════════════════
  // TOP 5 PRODUITS
  // ══════════════════════════════════════════════════════════════════════════════
  if (y > 660) { doc.addPage(); y = MARGIN; }
  y = drawSectionHeader(doc, 'TOP 5 PRODUITS (PAR CHIFFRE D\'AFFAIRES)', y);

  if (!d.topProducts.length) {
    doc.fillColor(C.gray).font('Helvetica').fontSize(9)
       .text('Aucune donnée de vente disponible sur la période.', MARGIN + 12, y + 5);
    y += 22;
  } else {
    const ROWH = 21;
    const X_NAME  = MARGIN + 12;
    const X_COUNT = MARGIN + 318;
    const X_REV   = MARGIN + 388;
    const W_NAME  = 300;
    const W_COUNT = 65;
    const W_REV   = CONTENT_W - 388 + MARGIN - 12;

    // En-tête tableau
    doc.rect(MARGIN, y, CONTENT_W, ROWH).fill('#2A2A2A');
    doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(8)
       .text('PRODUIT',             X_NAME,  y + 6, { width: W_NAME  })
       .text('VENTES',              X_COUNT, y + 6, { width: W_COUNT, align: 'center' })
       .text('CHIFFRE D\'AFFAIRES', X_REV,   y + 6, { width: W_REV,  align: 'right'  });
    y += ROWH;

    d.topProducts.forEach((p, i) => {
      doc.rect(MARGIN, y, CONTENT_W, ROWH).fill(i % 2 === 0 ? C.bgLight : C.white);
      doc.fillColor(C.black).font('Helvetica').fontSize(8.5)
         .text(p.name.slice(0, 50), X_NAME, y + 5, { width: W_NAME });
      doc.fillColor(C.gray).font('Helvetica').fontSize(8.5)
         .text(`${p.count}`, X_COUNT, y + 5, { width: W_COUNT, align: 'center' });
      doc.fillColor(C.black).font('Helvetica-Bold').fontSize(8.5)
         .text(fmt(p.revenue), X_REV, y + 5, { width: W_REV, align: 'right' });
      y += ROWH;
    });
    y += 12;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ABONNEMENTS OUTILS
  // ══════════════════════════════════════════════════════════════════════════════
  if (y > 660) { doc.addPage(); y = MARGIN; }
  y = drawSectionHeader(doc, 'ABONNEMENTS OUTILS ACTIFS', y);

  if (!d.toolSubs.length) {
    doc.fillColor(C.gray).font('Helvetica').fontSize(9)
       .text('Aucun abonnement outil enregistré.', MARGIN + 12, y + 5);
    y += 22;
  } else {
    const ROWH = 21;
    d.toolSubs.forEach((s, i) => {
      doc.rect(MARGIN, y, CONTENT_W, ROWH).fill(i % 2 === 0 ? C.bgLight : C.white);
      doc.fillColor(C.black).font('Helvetica').fontSize(8.5)
         .text(s.name, MARGIN + 12, y + 5, { width: 320 });
      doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(8.5)
         .text(fmt(s.amount) + '/mois', MARGIN + 12, y + 5, { width: CONTENT_W - 24, align: 'right' });
      y += ROWH;
    });

    // Total
    y += 5;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
    y += 8;
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(9)
       .text('Total mensuel', MARGIN + 12, y);
    doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(9)
       .text(fmt(d.toolSubsTotal) + '/mois', MARGIN + 12, y, { width: CONTENT_W - 24, align: 'right' });
    y += 22;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RECOMMANDATIONS TALA COACH
  // ══════════════════════════════════════════════════════════════════════════════
  if (y > 640) { doc.addPage(); y = MARGIN; }
  y = drawSectionHeader(doc, 'RECOMMANDATIONS TALA COACH', y);

  if (d.recommendations) {
    const lines = d.recommendations.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) { y += 5; continue; }
      if (y > 762) { doc.addPage(); y = MARGIN; }

      const isNumeric = /^\d+[.):]/.test(line);
      doc.fillColor(isNumeric ? C.black : C.gray)
         .font(isNumeric ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(9)
         .text(line, MARGIN + 12, y, { width: CONTENT_W - 24 });

      // Mesure la hauteur réelle du texte rendu pour avancer y correctement
      y = doc.y + 4;
    }
    y += 8;
  } else {
    const msg = process.env.ANTHROPIC_API_KEY
      ? 'Impossible de générer les recommandations IA pour ce rapport.'
      : 'Recommandations IA non disponibles (ANTHROPIC_API_KEY non configuré).';
    doc.fillColor(C.gray).font('Helvetica-Oblique').fontSize(9)
       .text(msg, MARGIN + 12, y + 5, { width: CONTENT_W - 24 });
    y += 24;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PIED DE PAGE (toutes les pages)
  // ══════════════════════════════════════════════════════════════════════════════
  const footerY = doc.page.height - MARGIN - 12;
  doc.moveTo(MARGIN, footerY - 8).lineTo(PAGE_W - MARGIN, footerY - 8)
     .strokeColor('#DDDDDD').lineWidth(0.5).stroke();
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5)
     .text(
       'Généré par Tala — copilote publicitaire pour vendeurs Chariow',
       MARGIN, footerY, { width: CONTENT_W, align: 'center' }
     );
}

// ─── Helpers de dessin ────────────────────────────────────────────────────────
function drawSectionHeader(doc, title, y) {
  doc.rect(MARGIN, y, CONTENT_W, 22).fill(C.bgDark);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(8.5)
     .text(title, MARGIN + 12, y + 6);
  return y + 28;
}

function drawMetricRow(doc, label, value, y, valueColor = C.black, bold = false) {
  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text(label, MARGIN + 12, y, { width: 295 });
  doc.fillColor(valueColor).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
     .text(value, MARGIN + 12, y, { width: CONTENT_W - 24, align: 'right' });
  return y + 21;
}

module.exports = router;
