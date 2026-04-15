/**
 * Tala — Script de test des routes API
 * Usage : node test-api.js
 *
 * Lance le serveur avant : node server.js
 */
require('dotenv').config();
const http = require('http');

const PORT = process.env.PORT || 3001;
let TOKEN  = null;
let PASS   = 0;
let FAIL   = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: 'localhost',
      port:     PORT,
      path,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function ok(label, condition, detail = '') {
  const icon = condition ? '✅' : '❌';
  if (condition) PASS++; else FAIL++;
  console.log(`  ${icon} ${label}${detail ? ' — ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🧪 Tests Tala API → http://localhost:${PORT}\n`);

  // ═══ HEALTH ════════════════════════════════════════════════════════════════
  section('Health');
  const h = await request('GET', '/api/health');
  ok('GET /health → 200', h.status === 200, h.body?.status);

  // ═══ AUTH ══════════════════════════════════════════════════════════════════
  section('Auth — Register');
  const email = `test_${Date.now()}@tala.app`;
  const reg = await request('POST', '/api/auth/register', {
    name: 'Test Tala', email, password: 'password123',
  });
  ok('POST /register → 201', reg.status === 201);
  ok('Token présent',        !!reg.body?.token);
  ok('onboarding = 0',       reg.body?.user?.onboarding_completed === 0);
  TOKEN = reg.body?.token;

  section('Auth — Login');
  const login = await request('POST', '/api/auth/login', { email, password: 'password123' });
  ok('POST /login → 200',       login.status === 200);
  ok('Token présent',           !!login.body?.token);
  const bad = await request('POST', '/api/auth/login', { email, password: 'nope' });
  ok('Mauvais mdp → 401',       bad.status === 401);

  section('Auth — /me');
  const me = await request('GET', '/api/auth/me');
  ok('GET /me → 200',           me.status === 200);
  ok('Subscription trial',      me.body?.subscription?.plan === 'trial');

  // ═══ SUBSCRIPTION STATUS ═══════════════════════════════════════════════════
  section('Subscription — statut');
  const subStatus = await request('GET', '/api/subscription/status');
  ok('GET /subscription/status → 200', subStatus.status === 200);
  ok('Plan = trial',           subStatus.body?.plan === 'trial');
  ok('is_active = true',       subStatus.body?.is_active === true);
  ok('days_remaining > 0',     subStatus.body?.days_remaining > 0);
  ok('Upsell présent',         !!subStatus.body?.upsell);

  section('Subscription — initiate sans FedaPay configuré');
  const subInit = await request('POST', '/api/subscription/initiate', {});
  ok('Sans FEDAPAY_SECRET_KEY → 503 ou 400', [400, 503].includes(subInit.status));

  section('Subscription — déjà premium');
  // Test du guard "déjà premium" (ne peut pas s'appliquer sur trial, mais vérifie le code)
  const subCancel = await request('POST', '/api/subscription/cancel', {});
  ok('Cancel trial → 400', subCancel.status === 400, subCancel.body?.error);

  // ═══ ONBOARDING ════════════════════════════════════════════════════════════
  section('Onboarding — sécurité');
  const savedToken = TOKEN; TOKEN = null;
  const unauth = await request('POST', '/api/onboarding/chariow', { api_key: 'x' });
  ok('Sans token → 401', unauth.status === 401);
  TOKEN = savedToken;

  section('Onboarding — validations');
  const shortKey = await request('POST', '/api/onboarding/chariow', { api_key: 'abc' });
  ok('Clé trop courte → 400',   shortKey.status === 400);
  const noComp = await request('POST', '/api/onboarding/complete', {});
  ok('Complete sans Chariow → 400', noComp.status === 400);
  const stepRes = await request('POST', '/api/onboarding/step', { step: 1 });
  ok('Step update → 200',       stepRes.status === 200);
  const badStep = await request('POST', '/api/onboarding/step', { step: 99 });
  ok('Step invalide → 400',     badStep.status === 400);

  // ═══ ABONNEMENTS OUTILS ════════════════════════════════════════════════════
  section('Abonnements outils — CRUD');
  const list0 = await request('GET', '/api/subscriptions/tools');
  ok('GET liste → 200',         list0.status === 200);
  ok('Liste initiale vide',     Array.isArray(list0.body?.subscriptions));

  const c1 = await request('POST', '/api/subscriptions/tools', { name: 'CapCut', amount: 5000, currency: 'XOF' });
  ok('POST créer → 201',        c1.status === 201);
  const id1 = c1.body?.subscription?.id;
  ok('ID retourné',             !!id1);

  const c2 = await request('POST', '/api/subscriptions/tools', { name: 'WhatsApp Bot', amount: 15000 });
  ok('POST 2ème outil → 201',   c2.status === 201);

  const list2 = await request('GET', '/api/subscriptions/tools');
  ok('Liste → 2 outils',        list2.body?.subscriptions?.length === 2);
  ok('Total = 20 000',          list2.body?.monthly_total === 20_000);

  const upd = await request('PUT', `/api/subscriptions/tools/${id1}`, { amount: 6000 });
  ok('PUT update → 200',        upd.status === 200);
  ok('Montant mis à jour',      upd.body?.subscription?.amount === 6000);

  const badPut = await request('PUT', `/api/subscriptions/tools/9999`, { amount: 100 });
  ok('PUT ID inconnu → 404',    badPut.status === 404);

  const del = await request('DELETE', `/api/subscriptions/tools/${id1}`);
  ok('DELETE → 200',            del.status === 200);

  const list1 = await request('GET', '/api/subscriptions/tools');
  ok('Liste → 1 outil restant', list1.body?.subscriptions?.length === 1);

  const summary = await request('GET', '/api/subscriptions/tools/summary');
  ok('GET summary → 200',       summary.status === 200);
  ok('Count = 1',               summary.body?.count === 1);
  ok('Total = 15 000',          summary.body?.monthly_total === 15_000);

  section('Abonnements outils — validations');
  const badName  = await request('POST', '/api/subscriptions/tools', { name: '', amount: 100 });
  ok('Nom vide → 400',          badName.status === 400);
  const badAmt   = await request('POST', '/api/subscriptions/tools', { name: 'X', amount: -50 });
  ok('Montant négatif → 400',   badAmt.status === 400);
  const badCur   = await request('POST', '/api/subscriptions/tools', { name: 'X', amount: 1000, currency: 'BTC' });
  ok('Devise invalide → 400',   badCur.status === 400);

  // ═══ DASHBOARD ═════════════════════════════════════════════════════════════
  section('Dashboard');
  const dash = await request('GET', '/api/dashboard');
  ok('Sans Chariow → 400',      dash.status === 400);
  ok('Code CHARIOW_NOT_CONNECTED', dash.body?.code === 'CHARIOW_NOT_CONNECTED');

  const dashBad = await request('GET', '/api/dashboard?period=999');
  ok('Period clampée → 400',    dashBad.status === 400); // toujours sans Chariow

  // ═══ META ADS ══════════════════════════════════════════════════════════════
  section('Meta Ads — OAuth');
  const metaUrl = await request('GET', '/api/meta/oauth/url');
  // Sans META_APP_ID configuré → 503
  ok('OAuth URL sans config → 503', metaUrl.status === 503, metaUrl.body?.error);

  section('Meta Ads — comptes / spend sans connexion');
  const metaAcc = await request('GET', '/api/meta/accounts');
  ok('Accounts sans connexion → 400', metaAcc.status === 400);
  ok('Code META_NOT_CONNECTED',       metaAcc.body?.code === 'META_NOT_CONNECTED');

  const metaSpend = await request('GET', '/api/meta/spend?from=2025-01-01&to=2025-01-31');
  ok('Spend sans connexion → 400',    metaSpend.status === 400);

  const metaSpendNoParam = await request('GET', '/api/meta/spend');
  ok('Spend sans params → 400',       metaSpendNoParam.status === 400);

  const metaSelect = await request('POST', '/api/meta/select-account', { account_id: 'act_123' });
  ok('Select sans connexion → 400',   metaSelect.status === 400);

  // ═══ COACH IA ══════════════════════════════════════════════════════════════
  section('Coach IA — guard premium');
  // L'utilisateur est en trial → requirePremium doit laisser passer (trial = actif)
  // Si ANTHROPIC_API_KEY est vide → 503
  const coach = await request('POST', '/api/coach/message', { message: 'Bonjour' });
  ok('Coach sans ANTHROPIC_API_KEY → 503', coach.status === 503, coach.body?.error);

  section('Coach IA — validations');
  const coachEmpty = await request('POST', '/api/coach/message', { message: '' });
  ok('Message vide → 400',      coachEmpty.status === 400);

  const coachLong = await request('POST', '/api/coach/message', { message: 'x'.repeat(2001) });
  ok('Message trop long → 400', coachLong.status === 400);

  section('Coach IA — historique');
  const hist = await request('GET', '/api/coach/history');
  ok('GET history → 200',       hist.status === 200);
  ok('Messages = []',           Array.isArray(hist.body?.messages));

  const delHist = await request('DELETE', '/api/coach/history');
  ok('DELETE history → 200',    delHist.status === 200);

  section('Coach IA — sans token');
  TOKEN = null;
  const coachNoAuth = await request('POST', '/api/coach/message', { message: 'test' });
  ok('Sans token → 401',        coachNoAuth.status === 401);
  TOKEN = savedToken;

  // ═══ RÉSUMÉ ════════════════════════════════════════════════════════════════
  const total = PASS + FAIL;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Résultat : ${PASS}/${total} tests passés  ${FAIL > 0 ? `(${FAIL} ❌)` : '🎉'}`);
  if (FAIL > 0) console.log('Certains tests ont échoué — vérifie les lignes ❌ ci-dessus.');
  console.log();

  process.exit(FAIL > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💥 Erreur inattendue :', err.message);
  process.exit(1);
});
