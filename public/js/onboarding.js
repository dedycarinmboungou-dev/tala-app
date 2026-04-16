/* ============================================================
   TALA — Onboarding (3 étapes)
   ============================================================ */

const Onboarding = {

  render() {
    App.state.currentView = 'onboarding';
    document.body.classList.add('theme-light'); // thème clair partout

    const step = App.state.user?.onboarding_step || 0;

    document.getElementById('app').innerHTML = `
      <div class="onboarding-page">

        <!-- Header -->
        <div class="onboarding-header">
          <div class="navbar-logo">
            <div class="logo-mark">T</div>
            <span class="logo-name">Tala</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="onboarding-logout">Se déconnecter</button>
        </div>

        <!-- Body -->
        <div class="onboarding-body">
          <div id="onboarding-card" class="onboarding-card">
            ${this._renderStep(step)}
          </div>
        </div>

      </div>
    `;

    // Bouton déconnexion (header)
    document.getElementById('onboarding-logout')
      ?.addEventListener('click', () => App.logout());

    // Lier les boutons du step courant
    this._bindStep(step);
  },

  // ── Binding des boutons par step ────────────────────────────────────────────
  _bindStep(step) {
    switch (step) {
      case 0:
        document.getElementById('step1-btn')
          ?.addEventListener('click', () => Onboarding.submitStep1());
        document.getElementById('toggle-chariow-key')
          ?.addEventListener('click', function () {
            Auth.togglePassword('chariow-key', this);
          });
        break;

      case 1:
        document.getElementById('continue-meta-btn')
          ?.addEventListener('click', () => Onboarding.submitStep2());
        document.getElementById('connect-meta-btn')
          ?.addEventListener('click', () => Onboarding.connectMeta());
        document.getElementById('skip-meta-btn')
          ?.addEventListener('click', () => Onboarding.skipMeta());
        break;

      case 2:
        document.getElementById('step3-btn')
          ?.addEventListener('click', () => Onboarding.submitStep3());
        document.getElementById('skip-step3-btn')
          ?.addEventListener('click', () => Onboarding.submitStep3(true));
        document.getElementById('add-sub-btn')
          ?.addEventListener('click', () => Onboarding.addSub());
        break;
    }
  },

  // ── Mettre à jour la carte + rebind ────────────────────────────────────────
  _updateCard(step) {
    document.getElementById('onboarding-card').innerHTML = this._renderStep(step);
    this._bindStep(step);
  },

  _stepIndicator(current) {
    return `
      <div class="onboarding-step-indicator">
        ${[0, 1, 2].map(i => `
          <div class="step-dot ${i < current ? 'done' : i === current ? 'active' : ''}"></div>
        `).join('')}
        <span class="text-xs text-muted" style="margin-left:.5rem">Étape ${current + 1} sur 3</span>
      </div>
    `;
  },

  _renderStep(step) {
    switch (step) {
      case 0: return this._step1HTML();
      case 1: return this._step2HTML();
      case 2: return this._step3HTML();
      default: return this._step1HTML();
    }
  },

  // ── Étape 1 : Clé API Chariow ─────────────────────────────────────────────
  _step1HTML() {
    return `
      ${this._stepIndicator(0)}
      <div class="onboarding-icon">🔑</div>
      <h2>Connecte ton store Chariow</h2>
      <p>Colle ta clé API Chariow pour que Tala puisse lire tes revenus et tes ventes.</p>

      <div class="form-group">
        <label class="form-label">Clé API Chariow</label>
        <div class="api-key-input-wrap">
          <input
            type="password"
            id="chariow-key"
            class="form-input"
            placeholder="ck_••••••••••••••••••••"
            autocomplete="off"
            spellcheck="false"
          >
          <button type="button" id="toggle-chariow-key" class="api-key-toggle" aria-label="Afficher la clé">👁</button>
        </div>
        <p class="form-hint">
          Trouve ta clé dans <strong>Chariow → Paramètres → API</strong>.
        </p>
      </div>

      <div id="step1-error" class="form-hint error hidden"></div>

      <button class="btn btn-primary btn-block mt-4" id="step1-btn">
        Vérifier et continuer →
      </button>
    `;
  },

  // ── Étape 2 : Meta Ads OAuth ───────────────────────────────────────────────
  _step2HTML() {
    const conn = App.state.connections?.meta;
    return `
      ${this._stepIndicator(1)}
      <div class="onboarding-icon">📣</div>
      <h2>Connecte Meta Ads</h2>
      <p>Autorise Tala à lire tes dépenses publicitaires Meta pour les convertir en FCFA.</p>

      ${conn ? `
        <div class="card" style="background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.2);margin-bottom:1.25rem">
          <div style="display:flex;align-items:center;gap:.625rem;color:var(--success);font-weight:700">
            <span style="font-size:1.25rem">✓</span>
            Compte Meta connecté : <strong>${conn.ad_account_name || conn.ad_account_id}</strong>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="continue-meta-btn">Continuer →</button>
      ` : `
        <div class="card" style="margin-bottom:1.25rem">
          <p style="font-size:.875rem;color:var(--gray-400);margin-bottom:1rem">
            Tu seras redirigé vers Facebook pour autoriser l'accès en lecture seule à ton compte publicitaire.
          </p>
          <ul style="font-size:.875rem;color:var(--gray-400);line-height:1.8;padding-left:1rem">
            <li>✓ Lecture des dépenses publicitaires uniquement</li>
            <li>✓ Aucune modification de tes campagnes</li>
            <li>✓ Révocable à tout moment</li>
          </ul>
        </div>
        <button class="btn btn-primary btn-block" id="connect-meta-btn">
          Se connecter avec Facebook →
        </button>
        <div class="divider-text mt-4">ou</div>
        <button class="btn btn-ghost btn-block" id="skip-meta-btn" style="margin-top:.75rem">
          Passer cette étape (configurer plus tard)
        </button>
      `}
    `;
  },

  // ── Étape 3 : Abonnements outils ──────────────────────────────────────────
  _step3HTML() {
    return `
      ${this._stepIndicator(2)}
      <div class="onboarding-icon">🧰</div>
      <h2>Tes abonnements outils</h2>
      <p>Ajoute les outils récurrents que tu paies chaque mois. Tala les déduira de ton bénéfice net automatiquement.</p>

      <div id="subs-list" style="margin-bottom:1rem"></div>

      <div class="card" style="margin-bottom:1rem" id="add-sub-form">
        <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nom de l'outil</label>
            <input type="text" class="form-input" id="sub-name" placeholder="ex: CapCut Pro">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Montant / mois (FCFA)</label>
            <input type="number" class="form-input" id="sub-amount" placeholder="5000" style="width:130px">
          </div>
        </div>
        <button class="btn btn-secondary btn-sm mt-3" id="add-sub-btn">+ Ajouter</button>
      </div>

      <div id="step3-error" class="form-hint error hidden"></div>

      <button class="btn btn-primary btn-block mt-2" id="step3-btn">
        Terminer la configuration →
      </button>
      <button class="btn btn-ghost btn-block mt-2" id="skip-step3-btn">
        Passer — je configurerai ça plus tard
      </button>
    `;
  },

  // ── Logique étape 1 ───────────────────────────────────────────────────────
  async submitStep1() {
    const key   = document.getElementById('chariow-key')?.value.trim();
    const btn   = document.getElementById('step1-btn');
    const errEl = document.getElementById('step1-error');

    if (!key) {
      return this._setError(errEl, 'Colle ta clé API Chariow.');
    }
    this._setError(errEl, '');
    this._setLoading(btn, true, 'Vérification...');

    try {
      await API.post('/api/onboarding/chariow', { api_key: key });
      App.state.user.onboarding_step = 1;
      this._updateCard(1);
    } catch (err) {
      this._setError(errEl, err.message || 'Clé API invalide ou store introuvable.');
    } finally {
      this._setLoading(btn, false, 'Vérifier et continuer →');
    }
  },

  // ── Logique étape 2 ───────────────────────────────────────────────────────
  async connectMeta() {
    try {
      const { url } = await API.get('/api/meta/oauth/url');
      const popup   = window.open(url, 'meta_auth', 'width=600,height=700');

      const handler = async (e) => {
        if (e.data?.type !== 'META_AUTH_SUCCESS') return;
        window.removeEventListener('message', handler);
        clearInterval(closedCheck);
        await Onboarding._afterMetaAuth();
      };
      window.addEventListener('message', handler);

      const closedCheck = setInterval(() => {
        if (popup?.closed) {
          clearInterval(closedCheck);
          window.removeEventListener('message', handler);
        }
      }, 1000);

    } catch (err) {
      Toast.error(err.message || 'Impossible de lancer la connexion Meta.');
    }
  },

  async _afterMetaAuth() {
    try {
      const { accounts } = await API.get('/api/meta/accounts');

      if (!accounts?.length) {
        Toast.info('Connecté ! Aucun compte pub trouvé — tu pourras en configurer un plus tard.');
        App.state.connections.meta = { connected: true };
        this._updateCard(1);
        return;
      }

      if (accounts.length === 1) {
        await API.post('/api/meta/select-account', { account_id: accounts[0].id });
        App.state.connections.meta = { ad_account_id: accounts[0].id, ad_account_name: accounts[0].name };
        this._updateCard(1);
        Toast.success(`Compte "${accounts[0].name}" sélectionné !`);
      } else {
        document.getElementById('onboarding-card').innerHTML = this._accountSelectorHTML(accounts);
        // _accountSelectorHTML uses onclick="Onboarding.selectMetaAccount(...)" — window.Onboarding is set
      }
    } catch (err) {
      Toast.error(err.message || 'Erreur après connexion Meta.');
    }
  },

  _accountSelectorHTML(accounts) {
    return `
      ${this._stepIndicator(1)}
      <div class="onboarding-icon">📣</div>
      <h2>Choisis ton compte pub</h2>
      <p>Sélectionne le compte Meta Ads à utiliser avec Tala.</p>
      <div style="display:flex;flex-direction:column;gap:.5rem;margin-bottom:1.25rem">
        ${accounts.map(a => `
          <div class="card" style="cursor:pointer" onclick="Onboarding.selectMetaAccount('${a.id}','${(a.name || '').replace(/'/g, "\\'")}')">
            <div style="font-weight:700">${a.name}</div>
            <div style="font-size:.8125rem;color:var(--gray-400)">${a.id} · ${a.currency || 'USD'}</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  async selectMetaAccount(accountId, accountName) {
    try {
      await API.post('/api/meta/select-account', { account_id: accountId });
      App.state.connections.meta = { ad_account_id: accountId, ad_account_name: accountName };
      this._updateCard(1);
      Toast.success(`Compte "${accountName}" sélectionné !`);
    } catch (err) {
      Toast.error(err.message || 'Erreur lors de la sélection du compte.');
    }
  },

  skipMeta() {
    this.submitStep2();
  },

  async submitStep2() {
    try {
      await API.post('/api/onboarding/step', { step: 2 });
      App.state.user.onboarding_step = 2;
      this._localSubs = [];
      this._updateCard(2);
      this._renderSubsList();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  // ── Logique étape 3 ───────────────────────────────────────────────────────
  _localSubs: [],

  addSub() {
    const name   = document.getElementById('sub-name')?.value.trim();
    const amount = parseFloat(document.getElementById('sub-amount')?.value);

    if (!name || !amount || amount <= 0) {
      return Toast.error('Remplis le nom et le montant.');
    }

    this._localSubs.push({ name, amount });
    document.getElementById('sub-name').value   = '';
    document.getElementById('sub-amount').value = '';
    this._renderSubsList();
  },

  _renderSubsList() {
    const el = document.getElementById('subs-list');
    if (!el) return;
    if (!this._localSubs.length) {
      el.innerHTML = '<p class="text-sm text-muted" style="margin-bottom:.5rem">Aucun outil ajouté. C\'est optionnel.</p>';
      return;
    }
    el.innerHTML = this._localSubs.map((s, i) => `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:.875rem 1rem;margin-bottom:.5rem">
        <div>
          <span style="font-weight:700">${s.name}</span>
          <span style="color:var(--gold);font-weight:700;margin-left:.75rem">${formatXOF(s.amount)}</span>
          <span style="font-size:.8125rem;margin-left:.25rem">/mois</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="Onboarding.removeSub(${i})" style="color:var(--danger)">✕</button>
      </div>
    `).join('') + `
      <div style="padding:.5rem 0;border-top:1px solid var(--black-5);margin-top:.5rem">
        <span class="text-sm text-muted">Total mensuel : </span>
        <strong class="text-gold">${formatXOF(this._localSubs.reduce((s, t) => s + t.amount, 0))}</strong>
      </div>
    `;
  },

  removeSub(index) {
    this._localSubs.splice(index, 1);
    this._renderSubsList();
  },

  async submitStep3(skip = false) {
    const btn   = document.getElementById('step3-btn');
    const errEl = document.getElementById('step3-error');
    this._setError(errEl, '');
    this._setLoading(btn, true, 'Finalisation...');

    try {
      if (!skip && this._localSubs.length) {
        await API.post('/api/onboarding/subscriptions', { subscriptions: this._localSubs });
      }
      await API.post('/api/onboarding/complete', {});
      App.state.user.onboarding_completed = 1;
      Toast.success('Configuration terminée ! Bienvenue dans Tala 🎉');
      Dashboard.render();
    } catch (err) {
      this._setError(errEl, err.message || 'Erreur lors de la finalisation.');
    } finally {
      this._setLoading(btn, false, 'Terminer la configuration →');
    }
  },

  // ── Helpers ───────────────────────────────────────────────────────────────
  _setError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  },

  _setLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = label;
    btn.classList.toggle('btn-loading', loading);
  },
};

window.Onboarding = Onboarding;
