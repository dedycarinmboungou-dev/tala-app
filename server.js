require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initDB } = require('./database/db');
const authRoutes         = require('./routes/auth');
const onboardingRoutes   = require('./routes/onboarding');
const dashboardRoutes    = require('./routes/dashboard');
const toolSubRoutes      = require('./routes/toolSubscriptions');
const metaRoutes         = require('./routes/meta');
const coachRoutes        = require('./routes/coach');
const subscriptionRoutes = require('./routes/subscription');
const pdfRoutes          = require('./routes/pdf');
const { router: adminRoutes } = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database ────────────────────────────────────────────────────────────────
initDB();

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: [
        "'self'",
        'https://api.anthropic.com',
        'https://graph.facebook.com',
        'https://api.exchangerate.host',
      ],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
}));

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',                 authRoutes);
app.use('/api/onboarding',           onboardingRoutes);
app.use('/api/dashboard',            dashboardRoutes);
app.use('/api/subscriptions/tools',  toolSubRoutes);
app.use('/api/meta',                 metaRoutes);
app.use('/api/coach',                coachRoutes);
app.use('/api/subscription',         subscriptionRoutes);
app.use('/api/pdf',                  pdfRoutes);
app.use('/api/admin',                adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Tala', version: '1.0.0', ts: new Date().toISOString() });
});

// ─── SPA fallback ────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Une erreur est survenue.'
      : err.message,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✨ Tala démarré sur http://localhost:${PORT}`);
  console.log(`   Environnement : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Base de données : ${process.env.DB_PATH || 'tala.db (local)'}\n`);

  // ── Cron : résumé hebdomadaire chaque lundi à 8h (UTC) ───────────────────
  if (process.env.NODE_ENV !== 'test') {
    const cron = require('node-cron');
    const { db } = require('./database/db');
    const { sendWeeklyReport } = require('./services/email');

    cron.schedule('0 8 * * 1', async () => {
      console.log('[CRON] Envoi des résumés hebdomadaires...');

      if (!process.env.BREVO_API_KEY) {
        console.log('[CRON] BREVO_API_KEY manquant — résumés ignorés.');
        return;
      }

      // Récupérer tous les utilisateurs ayant un abonnement actif
      const users = db.prepare(`
        SELECT DISTINCT u.id, u.name, u.email
        FROM users u
        INNER JOIN subscriptions s ON s.user_id = u.id
        WHERE s.status = 'active' AND s.expires_at > datetime('now')
      `).all();

      for (const user of users) {
        try {
          // Données du dashboard (7 derniers jours)
          const chariowConn = db.prepare(
            'SELECT api_key, store_currency FROM chariow_connections WHERE user_id = ?'
          ).get(user.id);

          const toolSubsTotal = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as t
            FROM tool_subscriptions WHERE user_id = ? AND is_active = 1
          `).get(user.id)?.t || 0;

          // Données simplifiées pour l'email (sans appel Chariow pour rester léger)
          // Un vrai rapport complet nécessiterait l'appel API — on envoie les données DB
          const dashData = {
            revenue:    0,
            meta_spend: 0,
            tool_subs:  Math.round(toolSubsTotal * (7 / 30)),
            net_profit: 0,
            roas:       null,
          };

          await sendWeeklyReport(user, dashData);
          console.log(`[CRON] Email envoyé → ${user.email}`);
        } catch (err) {
          console.error(`[CRON] Erreur pour ${user.email}:`, err.message);
        }
      }

      console.log(`[CRON] Résumés envoyés (${users.length} utilisateur(s)).`);
    }, { timezone: 'UTC' });

    console.log('   Cron hebdomadaire : actif (lundi 8h UTC)\n');
  }
});
