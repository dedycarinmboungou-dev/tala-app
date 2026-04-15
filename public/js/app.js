/* ============================================================
   TALA — SPA Core: Router + State + Utilities
   ============================================================ */

// ─── API Client ───────────────────────────────────────────────────────────────
const API = {
  base: '',

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const token = localStorage.getItem('tala_token');
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body)  opts.body = JSON.stringify(body);

    const res = await fetch(this.base + path, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau'), { status: res.status, code: data.code });
    return data;
  },

  get:    (path)       => API.request('GET',    path),
  post:   (path, body) => API.request('POST',   path, body),
  put:    (path, body) => API.request('PUT',    path, body),
  delete: (path)       => API.request('DELETE', path),
};

// ─── App State ────────────────────────────────────────────────────────────────
const App = {
  state: {
    user:         null,
    subscription: null,
    connections:  { chariow: null, meta: null },
    currentView:  null,
  },

  // ── Init ──────────────────────────────────────────────────────────────────
  async init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Navbar scroll effect (landing only)
    window.addEventListener('scroll', () => {
      const navbar = document.querySelector('.navbar');
      if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 10);
    });

    const token = localStorage.getItem('tala_token');
    if (token) {
      try {
        const { user, subscription, connections } = await API.get('/api/auth/me');
        App.state.user         = user;
        App.state.subscription = subscription;
        App.state.connections  = connections;
        App.route();
      } catch (err) {
        if (err.status === 401) App.logout(false);
        else App.renderLanding();
      }
    } else {
      App.renderLanding();
    }
  },

  // ── Routing ───────────────────────────────────────────────────────────────
  route() {
    if (!App.state.user) { App.renderLanding(); return; }
    if (!App.state.user.onboarding_completed) { Onboarding.render(); return; }

    const hash = location.hash || '#dashboard';
    switch (hash) {
      case '#dashboard':     Dashboard.render();     break;
      case '#products':      renderProductsPage();   break;
      case '#coach':         renderCoachPage();      break;
      case '#simulator':     renderSimulatorPage();  break;
      case '#subscriptions': renderSubsPage();       break;
      case '#settings':      SettingsView.render();  break;
      case '#admin':         renderAdminPage();      break;
      default:               Dashboard.render();
    }
  },

  // ── Auth helpers ──────────────────────────────────────────────────────────
  setAuth(token, user) {
    localStorage.setItem('tala_token', token);
    App.state.user = user;
    App.route();
  },

  logout(redirect = true) {
    localStorage.removeItem('tala_token');
    App.state.user = App.state.subscription = null;
    App.state.connections = { chariow: null, meta: null };
    if (redirect) App.renderLanding();
  },

  // ── Landing ───────────────────────────────────────────────────────────────
  renderLanding() {
    App.state.currentView = 'landing';
    document.getElementById('app').innerHTML = landingHTML();
    bindLandingEvents();
  },
};

// ─── Landing Page HTML ────────────────────────────────────────────────────────
function landingHTML() {
  return `
    <!-- NAVBAR -->
    <nav class="navbar">
      <div class="container navbar-inner">
        <div class="navbar-logo">
          <div class="logo-mark">T</div>
          <span class="logo-name">Tala</span>
        </div>
        <div class="navbar-actions">
          <button class="btn btn-ghost btn-sm" onclick="Auth.openLogin()">Se connecter</button>
          <button class="btn btn-primary btn-sm" onclick="Auth.openRegister()">Essai gratuit</button>
        </div>
      </div>
    </nav>

    <!-- HERO -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="container">
        <div class="hero-grid">

          <!-- Left: text -->
          <div class="hero-left">
            <div class="hero-eyebrow">
              <span class="dot"></span>
              Chariow × Meta Ads
            </div>
            <h1 class="display hero-title">
              Regarde ce que tu <span class="highlight">gagnes vraiment.</span>
            </h1>
            <p class="hero-sub">
              Tala relie tes revenus Chariow à tes dépenses Meta Ads et calcule
              ton vrai bénéfice net en FCFA — pixel compris.
            </p>
            <div class="hero-ctas">
              <button class="btn btn-primary btn-lg" onclick="Auth.openRegister()">
                Commencer gratuitement →
              </button>
              <button class="btn btn-secondary btn-lg" onclick="scrollToFeatures()">
                Voir les fonctionnalités
              </button>
            </div>
            <div class="hero-stats">
              <div class="hero-stat">
                <div class="hero-stat-value text-gold">3 jours</div>
                <div class="hero-stat-label">d'essai gratuit complet</div>
              </div>
              <div class="hero-stat">
                <div class="hero-stat-value">XOF natif</div>
                <div class="hero-stat-label">conversion automatique</div>
              </div>
              <div class="hero-stat">
                <div class="hero-stat-value text-gold">ROAS réel</div>
                <div class="hero-stat-label">sans biais du pixel</div>
              </div>
            </div>
          </div>

          <!-- Right: dashboard mockup -->
          <div class="hero-right">
            <div class="dashboard-preview" role="img" aria-label="Aperçu du tableau de bord Tala">
              <div class="preview-roas-badge">✓ ROAS 3.2x</div>
              <div class="preview-header">
                <span class="preview-header-title">Tableau de bord</span>
                <span class="preview-period">30 derniers jours</span>
              </div>
              <div class="preview-metrics">
                <div class="preview-metric">
                  <div class="preview-metric-label">Bénéfice net</div>
                  <div class="preview-metric-val profit">+485 000 F</div>
                </div>
                <div class="preview-metric">
                  <div class="preview-metric-label">ROAS Tala</div>
                  <div class="preview-metric-val roas">3.2×</div>
                </div>
                <div class="preview-metric">
                  <div class="preview-metric-label">Revenus</div>
                  <div class="preview-metric-val rev">750 000 F</div>
                </div>
                <div class="preview-metric">
                  <div class="preview-metric-label">Dép. Meta</div>
                  <div class="preview-metric-val spend">−234 000 F</div>
                </div>
              </div>
              <div class="preview-chart">
                ${[55,70,45,80,65,90,75,85,60,95,70,80,88,72,95].map((h, i) => `
                  <div class="preview-bar rev" style="height:${h}%"></div>
                `).join('')}
              </div>
              <div class="preview-legend">
                <div class="preview-legend-item">
                  <div class="preview-legend-dot" style="background:var(--gold)"></div>Revenus
                </div>
                <div class="preview-legend-item">
                  <div class="preview-legend-dot" style="background:var(--danger);opacity:.5"></div>Pub Meta
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- PROBLEM SECTION -->
    <section class="section problem-section" id="problems">
      <div class="container">
        <div class="text-center mb-6">
          <span class="section-tag">Le vrai problème</span>
          <h2 class="section-title">Tu investis dans la pub mais tu ne sais pas si tu gagnes</h2>
          <p class="section-sub" style="margin:0 auto">Le pixel Meta ne supporte pas le FCFA. Ton ROAS affiché par Meta est faux.
          Tala fait le lien que Meta ne peut pas faire.</p>
        </div>
        <div class="problem-grid">
          <div class="problem-card">
            <div class="problem-card-icon">📉</div>
            <h4>ROAS biaisé par Meta</h4>
            <p>Meta calcule ton ROAS en USD ou EUR, pas en FCFA. Tes conversions sont sous-estimées et tu prends de mauvaises décisions.</p>
          </div>
          <div class="problem-card">
            <div class="problem-card-icon">🔗</div>
            <h4>Données déconnectées</h4>
            <p>Tes revenus Chariow d'un côté, tes dépenses Meta de l'autre. Impossible de voir le bénéfice net en un coup d'œil.</p>
          </div>
          <div class="problem-card">
            <div class="problem-card-icon">🤷</div>
            <h4>Frais cachés oubliés</h4>
            <p>Commission Chariow, CapCut, WhatsApp Bot, Canva Pro... Ces abonnements grignotent ton profit sans que tu t'en rendes compte.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURES -->
    <section class="section" id="features">
      <div class="container">
        <span class="section-tag">Fonctionnalités</span>
        <h2 class="section-title">Tout ce dont tu as besoin pour piloter ta pub</h2>
        <p class="section-sub">Tala connecte tes données, fait les calculs et te dit exactement quoi faire.</p>
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">💰</div>
            <h4>Bénéfice Net Réel</h4>
            <p>Revenus Chariow − Frais Chariow − Dépenses Meta − Abonnements outils. Ton vrai gain, en FCFA.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h4>ROAS Tala (fiable)</h4>
            <p>Calculé avec tes revenus Chariow réels divisés par tes dépenses Meta converties en XOF. Pas biaisé.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🤖</div>
            <h4>Coach IA</h4>
            <p>Propulsé par Claude (Anthropic). Il connaît tes données et te conseille sur quoi couper, quoi pousser.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🚨</div>
            <h4>Détection de pertes</h4>
            <p>Alerte rouge immédiate si ton ROAS passe sous 1. Identification des campagnes qui te coûtent de l'argent.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🧮</div>
            <h4>Simulateur de campagne</h4>
            <p>Entre ton budget et ton produit cible. Tala calcule le nombre de ventes minimum pour être rentable.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📄</div>
            <h4>Rapports PDF</h4>
            <p>Rapport complet : bénéfice net, ROAS, meilleurs produits, déductions détaillées, recommandations IA.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="section" style="background:var(--black-2);border-top:1px solid var(--black-5);border-bottom:1px solid var(--black-5)">
      <div class="container">
        <div class="text-center mb-6">
          <span class="section-tag">Comment ça marche</span>
          <h2>Connecté en 3 étapes</h2>
        </div>
        <div class="steps-grid">
          <div class="step-card">
            <div class="step-number">1</div>
            <h4>Connecte Chariow</h4>
            <p>Colle ta clé API Chariow. Tala lit tes revenus, tes ventes et tes produits automatiquement.</p>
          </div>
          <div class="step-card">
            <div class="step-number">2</div>
            <h4>Connecte Meta Ads</h4>
            <p>Authentifie ton compte Meta en un clic. Tala récupère tes dépenses et les convertit en XOF.</p>
          </div>
          <div class="step-card">
            <div class="step-number">3</div>
            <h4>Vois ton vrai profit</h4>
            <p>Ajoute tes abonnements outils. Tala calcule ton bénéfice net réel instantanément.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- PRICING -->
    <section class="section" id="pricing">
      <div class="container">
        <div class="text-center mb-6">
          <span class="section-tag">Tarifs</span>
          <h2>Simple et transparent</h2>
          <p class="section-sub" style="margin:0 auto">3 jours d'essai complet, sans carte bancaire.</p>
        </div>
        <div class="pricing-grid">

          <div class="pricing-card">
            <div class="pricing-plan">Essai gratuit</div>
            <div class="pricing-price">0 F <span>/ 3 jours</span></div>
            <p class="pricing-desc">Accès complet à toutes les fonctionnalités pendant 3 jours.</p>
            <div class="pricing-features">
              <div class="pricing-feature"><span class="check">✓</span> Tableau de bord complet</div>
              <div class="pricing-feature"><span class="check">✓</span> ROAS Tala (XOF fiable)</div>
              <div class="pricing-feature"><span class="check">✓</span> Coach IA inclus</div>
              <div class="pricing-feature"><span class="check">✓</span> Simulateur de campagne</div>
              <div class="pricing-feature"><span class="check">✓</span> Rapports PDF</div>
              <div class="pricing-feature"><span class="check">✓</span> Alertes intelligentes</div>
            </div>
            <button class="btn btn-secondary btn-block" onclick="Auth.openRegister()">Commencer gratuitement</button>
          </div>

          <div class="pricing-card featured">
            <div class="pricing-popular">Le plus populaire</div>
            <div class="pricing-plan">Premium</div>
            <div class="pricing-price">9 900 F <span>/ mois</span></div>
            <p class="pricing-desc">Accès illimité. Payé via FedaPay (Mobile Money, carte).</p>
            <div class="pricing-features">
              <div class="pricing-feature"><span class="check">✓</span> Tout l'essai gratuit</div>
              <div class="pricing-feature"><span class="check">✓</span> Historique illimité</div>
              <div class="pricing-feature"><span class="check">✓</span> Alertes push & email</div>
              <div class="pricing-feature"><span class="check">✓</span> Analyses par produit</div>
              <div class="pricing-feature"><span class="check">✓</span> Résumé hebdo par email</div>
              <div class="pricing-feature"><span class="check">✓</span> Support prioritaire</div>
            </div>
            <button class="btn btn-primary btn-block" onclick="Auth.openRegister()">Commencer l'essai gratuit →</button>
          </div>

        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="section cta-section">
      <div class="container">
        <h2>Tu mérites de savoir si ta pub est rentable.</h2>
        <p>Rejoins les vendeurs Chariow qui pilotent leurs Meta Ads avec des vraies données.</p>
        <button class="btn btn-primary btn-lg" onclick="Auth.openRegister()">
          Essayer Tala gratuitement →
        </button>
        <p style="margin-top:1rem;font-size:.8125rem;color:var(--gray-500)">3 jours gratuits · Aucune carte requise · Annulable à tout moment</p>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="footer">
      <div class="container">
        <div class="footer-inner">
          <div class="footer-brand">
            <div class="logo-mark" style="width:28px;height:28px;font-size:.875rem;border-radius:8px">T</div>
            <span style="font-weight:800;font-size:1.125rem;letter-spacing:-.02em">Tala</span>
          </div>
          <p class="footer-copy">© 2025 Tala · Copilote publicitaire pour vendeurs digitaux africains</p>
          <div class="footer-links">
            <a href="#">Confidentialité</a>
            <a href="#">Conditions</a>
            <a href="#">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  `;
}

function bindLandingEvents() {
  // Smooth scroll to features
  window.scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    document.querySelector('.navbar')?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
}

// ─── Stub page renderers (à compléter dans les autres fichiers JS) ─────────────
function renderProductsPage() {
  App.state.currentView = 'products';
  renderAppShell('products', `
    <div class="page-content">
      <div class="page-header">
        <h1 class="page-title">Produits</h1>
        <p class="page-sub">Revenus et performances par produit Chariow</p>
      </div>
      <div style="text-align:center;padding:4rem 0;color:var(--gray-500)">
        <div style="font-size:3rem;margin-bottom:1rem">📦</div>
        <h3 style="color:var(--white);margin-bottom:.5rem">Analyse par produit</h3>
        <p>Connecte Chariow pour voir tes données produits.</p>
      </div>
    </div>
  `);
}

function renderCoachPage() {
  App.state.currentView = 'coach';
  renderAppShell('coach', CoachView ? CoachView.html() : '<div class="page-content"><p>Chargement...</p></div>');
  CoachView?.bind();
}

function renderSimulatorPage() {
  App.state.currentView = 'simulator';
  renderAppShell('simulator', `
    <div class="page-content">
      <div class="page-header">
        <h1 class="page-title">Simulateur</h1>
        <p class="page-sub">Calcule la rentabilité d'une campagne avant de la lancer</p>
      </div>
      <div class="card" style="max-width:480px">
        <h3 style="margin-bottom:1.25rem">Simuler une campagne</h3>
        <div class="form-group">
          <label class="form-label">Budget publicitaire (FCFA)</label>
          <input type="number" class="form-input" placeholder="ex: 50 000" id="sim-budget">
        </div>
        <div class="form-group">
          <label class="form-label">Prix de vente du produit (FCFA)</label>
          <input type="number" class="form-input" placeholder="ex: 15 000" id="sim-price">
        </div>
        <div class="form-group">
          <label class="form-label">Frais Chariow (%)</label>
          <input type="number" class="form-input" value="15" id="sim-fees">
        </div>
        <button class="btn btn-primary btn-block mt-4" onclick="runSimulator()">Calculer →</button>
        <div id="sim-result" style="margin-top:1.25rem"></div>
      </div>
    </div>
  `);
  window.runSimulator = () => {
    const budget = parseFloat(document.getElementById('sim-budget').value) || 0;
    const price  = parseFloat(document.getElementById('sim-price').value) || 0;
    const fees   = parseFloat(document.getElementById('sim-fees').value) || 15;
    if (!budget || !price) return Toast.error('Remplis tous les champs.');
    const netPerSale = price * (1 - fees / 100);
    const minSales   = Math.ceil(budget / netPerSale);
    const breakEven  = minSales * price;
    document.getElementById('sim-result').innerHTML = `
      <div class="card-gold" style="padding:1.25rem">
        <div style="margin-bottom:.75rem">
          <div class="metric-label">Ventes minimum pour être rentable</div>
          <div class="metric-value gold">${minSales} ventes</div>
        </div>
        <div style="margin-bottom:.75rem">
          <div class="metric-label">CA minimum à atteindre</div>
          <div class="metric-value">${formatXOF(breakEven)}</div>
        </div>
        <div>
          <div class="metric-label">Revenu net par vente</div>
          <div class="metric-value success">${formatXOF(netPerSale)}</div>
        </div>
      </div>
    `;
  };
}

function renderSubsPage() {
  App.state.currentView = 'subscriptions';
  renderAppShell('subscriptions', SubsView ? SubsView.html() : '<div class="page-content"><p>Chargement...</p></div>');
  SubsView?.bind();
}

async function renderAdminPage() {
  App.state.currentView = 'admin';

  renderAppShell('admin', `
    <div class="page-content">
      <div class="page-header">
        <h1 class="page-title">Administration</h1>
        <p class="page-sub">Statistiques globales de la plateforme Tala</p>
      </div>
      <div id="admin-content">
        <div class="metrics-grid">
          ${Array(4).fill(0).map(() => `
            <div class="metric-card">
              <div class="skeleton" style="height:.75rem;width:60%;margin-bottom:.75rem;border-radius:4px"></div>
              <div class="skeleton" style="height:1.75rem;width:80%;border-radius:4px"></div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `);

  try {
    const stats = await API.get('/api/admin/stats');
    document.getElementById('admin-content').innerHTML = `
      <div class="metrics-grid" style="margin-bottom:1.5rem">
        <div class="metric-card">
          <div class="metric-label">Utilisateurs total</div>
          <div class="metric-value">${stats.users.total}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">En essai actif</div>
          <div class="metric-value" style="color:var(--gold)">${stats.users.trial_active}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Premium actifs</div>
          <div class="metric-value success">${stats.users.premium_active}</div>
        </div>
        <div class="metric-card card-gold">
          <div class="metric-label">Revenus générés</div>
          <div class="metric-value gold">${new Intl.NumberFormat('fr-FR').format(stats.revenue.total_xof)} F</div>
          <div class="metric-change">${stats.revenue.transactions_completed} transaction(s)</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem">
        <div class="card">
          <h4 style="margin-bottom:.875rem">Activité</h4>
          <div style="display:flex;flex-direction:column;gap:.5rem;font-size:.9rem">
            <div style="display:flex;justify-content:space-between">
              <span class="text-muted">Nouveaux (7j)</span>
              <strong>${stats.users.new_this_week}</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span class="text-muted">Nouveaux (30j)</span>
              <strong>${stats.users.new_this_month}</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span class="text-muted">Expirés</span>
              <strong>${stats.users.expired}</strong>
            </div>
          </div>
        </div>
        <div class="card">
          <h4 style="margin-bottom:.875rem">Connexions</h4>
          <div style="display:flex;flex-direction:column;gap:.5rem;font-size:.9rem">
            <div style="display:flex;justify-content:space-between">
              <span class="text-muted">Chariow connectés</span>
              <strong>${stats.connections.chariow}</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span class="text-muted">Meta Ads connectés</span>
              <strong>${stats.connections.meta}</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span class="text-muted">Messages Coach IA</span>
              <strong>${stats.coach.total_messages}</strong>
            </div>
          </div>
        </div>
      </div>

      <p style="font-size:.75rem;color:var(--gray-500);margin-top:1.25rem">
        Généré le ${new Date(stats.generated_at).toLocaleString('fr-FR')}
      </p>
    `;
  } catch (err) {
    document.getElementById('admin-content').innerHTML = `
      <div class="card" style="border-color:rgba(239,68,68,.25);text-align:center;padding:2.5rem">
        <div style="font-size:2rem;margin-bottom:.75rem">🔒</div>
        <p style="color:var(--danger)">${err.message || 'Accès refusé.'}</p>
      </div>
    `;
  }
}

// ─── App Shell (nav + content) ────────────────────────────────────────────────
function renderAppShell(activeNav, content) {
  const u = App.state.user;
  const initials = u?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const navItems = [
    { id: 'dashboard',     icon: '📊', label: 'Tableau de bord' },
    { id: 'products',      icon: '📦', label: 'Produits' },
    { id: 'coach',         icon: '🤖', label: 'Coach IA' },
    { id: 'simulator',     icon: '🧮', label: 'Simulateur' },
    { id: 'subscriptions', icon: '🔧', label: 'Outils' },
    { id: 'settings',      icon: '⚙️',  label: 'Paramètres' },
  ];

  const sideNav = navItems.map(n => `
    <div class="nav-item ${activeNav === n.id ? 'active' : ''}" onclick="navigate('${n.id}')">
      <span class="nav-icon">${n.icon}</span>
      ${n.label}
    </div>
  `).join('');

  const bottomNav = navItems.slice(0, 5).map(n => `
    <div class="bottom-nav-item ${activeNav === n.id ? 'active' : ''}" onclick="navigate('${n.id}')">
      <span class="nav-icon">${n.icon}</span>
      ${n.label.split(' ')[0]}
    </div>
  `).join('');

  document.getElementById('app').innerHTML = `
    <div class="app-layout">

      <!-- Sidebar (desktop) -->
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-mark">T</div>
          <span class="logo-name">Tala</span>
        </div>
        <nav class="sidebar-nav">${sideNav}</nav>
        <div class="sidebar-footer">
          <div class="sidebar-user" onclick="navigate('settings')">
            <div class="user-avatar">${initials}</div>
            <div class="user-info">
              <div class="user-name">${u?.name || ''}</div>
              <div class="user-plan">${App.state.subscription?.plan || 'trial'}</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main -->
      <main class="main-content">
        <!-- Topbar (mobile) -->
        <div class="topbar">
          <div class="navbar-logo">
            <div class="logo-mark" style="width:32px;height:32px;font-size:1rem;border-radius:9px">T</div>
            <span class="logo-name" style="font-size:1.25rem">Tala</span>
          </div>
          <div class="user-avatar" onclick="navigate('settings')">${initials}</div>
        </div>

        <!-- Page content -->
        ${content}

        <!-- Bottom nav (mobile) -->
        <nav class="bottom-nav">${bottomNav}</nav>
      </main>

    </div>
  `;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
window.navigate = (view) => {
  location.hash = `#${view}`;
  App.route();
};

window.addEventListener('popstate', () => App.route());

// ─── Formatters ───────────────────────────────────────────────────────────────
function formatXOF(amount) {
  if (typeof amount !== 'number') return '— F';
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)) + ' F';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Toast notifications ───────────────────────────────────────────────────────
const Toast = {
  show(msg, type = 'info', duration = 3500) {
    const icons = { success: '✓', error: '✗', info: '⚡' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || '·'}</span><span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  },
  success: (m) => Toast.show(m, 'success'),
  error:   (m) => Toast.show(m, 'error'),
  info:    (m) => Toast.show(m, 'info'),
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
