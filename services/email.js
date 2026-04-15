/**
 * Tala — Service Email (Brevo / Sendinblue)
 *
 * Fonctions :
 *   sendWelcomeEmail(user)              — Email de bienvenue à l'inscription
 *   sendWeeklyReport(user, dashData)    — Résumé hebdomadaire (lundi 8h)
 *
 * Dépend de :
 *   BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME, APP_URL (.env)
 */

const brevo = require('@getbrevo/brevo');

// ─── Initialisation client Brevo ──────────────────────────────────────────────
function getApiInstance() {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY non configuré — emails désactivés.');
  }
  const client = brevo.ApiClient.instance;
  client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;
  return new brevo.TransactionalEmailsApi();
}

const FROM = () => ({
  email: process.env.BREVO_FROM_EMAIL || 'hello@tala.app',
  name:  process.env.BREVO_FROM_NAME  || 'Tala',
});

const APP_URL = () => process.env.APP_URL || 'http://localhost:3001';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F CFA';
}

// ─── Email de bienvenue ───────────────────────────────────────────────────────
async function sendWelcomeEmail(user) {
  const api    = getApiInstance();
  const prenom = (user.name || '').split(' ')[0] || user.name;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:40px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:#0D0D0D;padding:36px 40px;text-align:center">
      <div style="color:#D4AF37;font-size:2.25rem;font-weight:800;letter-spacing:-.03em;line-height:1">TALA</div>
      <div style="color:#888;font-size:.875rem;margin-top:8px">Regarde ce que tu gagnes vraiment.</div>
    </div>

    <!-- Body -->
    <div style="background:#FFFFFF;padding:36px 40px">
      <h2 style="color:#111;margin:0 0 14px;font-size:1.3rem">
        Bienvenue ${prenom}&nbsp;! 🎉
      </h2>
      <p style="color:#444;line-height:1.75;margin:0 0 20px;font-size:.95rem">
        Ton compte Tala est prêt. Tu disposes de <strong style="color:#D4AF37">3 jours d'accès complet</strong>
        pour connecter ton store Chariow, lier Meta Ads et voir ton vrai bénéfice net en FCFA — pixel compris.
      </p>

      <!-- Steps -->
      <div style="background:#FFFEF5;border:1px solid #F0E68A;border-radius:8px;padding:18px 22px;margin-bottom:28px">
        <div style="color:#7A5F00;font-weight:700;font-size:.9rem;margin-bottom:10px">✅ À faire dès maintenant :</div>
        <ol style="color:#555;margin:0;padding-left:20px;line-height:2;font-size:.9rem">
          <li>Connecte ton store Chariow <span style="color:#999">(Paramètres → API → copier la clé)</span></li>
          <li>Relie ton compte Meta Ads en un clic OAuth</li>
          <li>Ajoute tes abonnements outils <span style="color:#999">(CapCut, Canva, WhatsApp Bot...)</span></li>
        </ol>
      </div>

      <!-- CTA -->
      <div style="text-align:center">
        <a href="${APP_URL()}"
           style="display:inline-block;background:#D4AF37;color:#000;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:700;font-size:.95rem">
          Accéder à mon tableau de bord →
        </a>
      </div>

      <p style="color:#999;font-size:.8rem;text-align:center;margin:24px 0 0;line-height:1.6">
        3 jours gratuits · Aucune carte requise · Annulable à tout moment
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#F5F5F5;padding:18px 40px;text-align:center">
      <p style="color:#AAA;font-size:.75rem;margin:0">
        Tala · Copilote publicitaire pour vendeurs Chariow<br>
        <a href="${APP_URL()}" style="color:#AAA">Se désabonner des emails</a>
      </p>
    </div>

  </div>
</body>
</html>`;

  await api.sendTransacEmail({
    sender:      FROM(),
    to:          [{ email: user.email, name: user.name }],
    subject:     `Bienvenue sur Tala, ${prenom} ! Ton essai de 3 jours commence maintenant.`,
    htmlContent: html,
  });
}

// ─── Résumé hebdomadaire ──────────────────────────────────────────────────────
async function sendWeeklyReport(user, dashData) {
  const api    = getApiInstance();
  const prenom = (user.name || '').split(' ')[0] || user.name;

  const {
    revenue    = 0,
    meta_spend = 0,
    tool_subs  = 0,
    net_profit = 0,
    roas       = null,
  } = dashData;

  const roasColor = !roas ? '#888' : roas < 1 ? '#C0392B' : roas < 2 ? '#E67E22' : '#27AE60';
  const roasText  = !roas ? 'N/A' : `${roas.toFixed(2)}×`;
  const profitColor = net_profit >= 0 ? '#27AE60' : '#C0392B';

  const alertBanner = roas && roas < 1 ? `
    <div style="background:#FDF0EF;border-left:4px solid #C0392B;padding:14px 18px;margin-bottom:22px;border-radius:4px">
      <strong style="color:#C0392B">🚨 Alerte ROAS</strong><br>
      <span style="color:#555;font-size:.9rem">
        Ton ROAS est de <strong>${roasText}</strong>. Tu perds de l'argent en pub.
        Réduis ton budget ou coupe les campagnes peu performantes.
      </span>
    </div>
  ` : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:40px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:#0D0D0D;padding:28px 40px">
      <div style="color:#D4AF37;font-size:1.75rem;font-weight:800;letter-spacing:-.02em">TALA</div>
      <div style="color:#AAA;font-size:.8rem;margin-top:4px">Résumé de la semaine passée</div>
    </div>

    <!-- Body -->
    <div style="background:#FFFFFF;padding:28px 40px">
      <p style="color:#444;margin:0 0 20px;font-size:.95rem">
        Salut <strong>${prenom}</strong>, voici tes chiffres pour la semaine passée :
      </p>

      ${alertBanner}

      <!-- Tableau des métriques -->
      <table style="width:100%;border-collapse:collapse;font-size:.9rem">
        <tr style="background:#F8F8F8">
          <td style="padding:11px 14px;color:#666">Revenus Chariow</td>
          <td style="padding:11px 14px;text-align:right;font-weight:700;color:#111">${fmt(revenue)}</td>
        </tr>
        <tr>
          <td style="padding:11px 14px;color:#666">Dépenses Meta Ads</td>
          <td style="padding:11px 14px;text-align:right;font-weight:700;color:#C0392B">− ${fmt(meta_spend)}</td>
        </tr>
        <tr style="background:#F8F8F8">
          <td style="padding:11px 14px;color:#666">Abonnements outils</td>
          <td style="padding:11px 14px;text-align:right;font-weight:700;color:#888">− ${fmt(tool_subs)}</td>
        </tr>
        <tr style="border-top:2px solid #EEE">
          <td style="padding:14px 14px;font-weight:700;color:#111;font-size:1rem">Bénéfice net réel</td>
          <td style="padding:14px 14px;text-align:right;font-weight:800;font-size:1.1rem;color:${profitColor}">
            ${(net_profit >= 0 ? '+' : '') + fmt(net_profit)}
          </td>
        </tr>
        <tr style="background:#F8F8F8">
          <td style="padding:11px 14px;color:#666">ROAS Tala</td>
          <td style="padding:11px 14px;text-align:right;font-weight:700;color:${roasColor}">${roasText}</td>
        </tr>
      </table>

      <div style="text-align:center;margin-top:26px">
        <a href="${APP_URL()}#dashboard"
           style="display:inline-block;background:#D4AF37;color:#000;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:.9rem">
          Voir le tableau de bord complet →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#F5F5F5;padding:18px 40px;text-align:center">
      <p style="color:#AAA;font-size:.75rem;margin:0">
        Tala · Copilote publicitaire pour vendeurs Chariow<br>
        <a href="${APP_URL()}" style="color:#AAA">Se désabonner des emails</a>
      </p>
    </div>

  </div>
</body>
</html>`;

  await api.sendTransacEmail({
    sender:      FROM(),
    to:          [{ email: user.email, name: user.name }],
    subject:     `Ton résumé Tala — Bénéfice net : ${(net_profit >= 0 ? '+' : '') + fmt(net_profit)}`,
    htmlContent: html,
  });
}

module.exports = { sendWelcomeEmail, sendWeeklyReport };
