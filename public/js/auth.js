/* ============================================================
   TALA — Auth Views (Login / Register modals)
   ============================================================ */

const Auth = {

  // ── Ouvrir la modale Login ─────────────────────────────────────────────────
  openLogin() {
    this._openModal('login');
  },

  // ── Ouvrir la modale Register ──────────────────────────────────────────────
  openRegister() {
    this._openModal('register');
  },

  _openModal(mode) {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = mode === 'login' ? this._loginHTML() : this._registerHTML();

    // Fermer en cliquant sur l'overlay
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) Auth.closeModal();
    });

    // Focus premier champ
    setTimeout(() => overlay.querySelector('input')?.focus(), 100);
  },

  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  },

  // ── HTML Login ────────────────────────────────────────────────────────────
  _loginHTML() {
    return `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <button class="modal-close" onclick="Auth.closeModal()" aria-label="Fermer">×</button>

        <div class="auth-logo">
          <div class="logo-mark">T</div>
          <span class="logo-name">Tala</span>
        </div>

        <h2 class="auth-title" id="login-title">Bon retour 👋</h2>
        <p class="auth-sub">Connecte-toi pour voir tes vrais chiffres.</p>

        <form id="login-form" onsubmit="Auth.submitLogin(event)" novalidate>
          <div class="form-group">
            <label class="form-label" for="login-email">Adresse email</label>
            <input
              type="email"
              id="login-email"
              class="form-input"
              placeholder="toi@exemple.com"
              autocomplete="email"
              required
            >
          </div>
          <div class="form-group">
            <label class="form-label" for="login-password">Mot de passe</label>
            <div class="api-key-input-wrap">
              <input
                type="password"
                id="login-password"
                class="form-input"
                placeholder="••••••••"
                autocomplete="current-password"
                required
              >
              <button type="button" class="api-key-toggle" onclick="Auth.togglePassword('login-password', this)" aria-label="Afficher le mot de passe">👁</button>
            </div>
          </div>

          <div id="login-error" class="form-hint error hidden"></div>

          <button type="submit" class="btn btn-primary btn-block mt-4" id="login-btn">
            Se connecter
          </button>
        </form>

        <div class="auth-switch">
          Pas encore de compte ?
          <a onclick="Auth.openRegister()">Créer un compte gratuit →</a>
        </div>
      </div>
    `;
  },

  // ── HTML Register ─────────────────────────────────────────────────────────
  _registerHTML() {
    return `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="register-title">
        <button class="modal-close" onclick="Auth.closeModal()" aria-label="Fermer">×</button>

        <div class="auth-logo">
          <div class="logo-mark">T</div>
          <span class="logo-name">Tala</span>
        </div>

        <h2 class="auth-title" id="register-title">Commence gratuitement ✨</h2>
        <p class="auth-sub">3 jours d'accès complet. Aucune carte bancaire requise.</p>

        <form id="register-form" onsubmit="Auth.submitRegister(event)" novalidate>
          <div class="form-group">
            <label class="form-label" for="reg-name">Ton prénom / nom</label>
            <input
              type="text"
              id="reg-name"
              class="form-input"
              placeholder="ex: Kouassi Yao"
              autocomplete="name"
              required
            >
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-email">Adresse email</label>
            <input
              type="email"
              id="reg-email"
              class="form-input"
              placeholder="toi@exemple.com"
              autocomplete="email"
              required
            >
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-password">Mot de passe</label>
            <div class="api-key-input-wrap">
              <input
                type="password"
                id="reg-password"
                class="form-input"
                placeholder="8 caractères minimum"
                autocomplete="new-password"
                required
                minlength="8"
              >
              <button type="button" class="api-key-toggle" onclick="Auth.togglePassword('reg-password', this)" aria-label="Afficher le mot de passe">👁</button>
            </div>
            <p class="form-hint">Au moins 8 caractères.</p>
          </div>

          <div id="register-error" class="form-hint error hidden"></div>

          <button type="submit" class="btn btn-primary btn-block mt-4" id="register-btn">
            Créer mon compte →
          </button>
        </form>

        <p style="font-size:.75rem;color:var(--gray-500);text-align:center;margin-top:.875rem;line-height:1.5">
          En créant un compte, tu acceptes nos
          <a href="#" style="color:var(--gold)">Conditions d'utilisation</a>.
        </p>

        <div class="auth-switch">
          Déjà un compte ?
          <a onclick="Auth.openLogin()">Se connecter</a>
        </div>
      </div>
    `;
  },

  // ── Toggle password visibility ────────────────────────────────────────────
  togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.textContent = isText ? '👁' : '🙈';
    btn.setAttribute('aria-label', isText ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  },

  // ── Soumettre le login ────────────────────────────────────────────────────
  async submitLogin(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    const btn      = document.getElementById('login-btn');
    const errEl    = document.getElementById('login-error');

    Auth._setError(errEl, '');
    Auth._setLoading(btn, true, 'Connexion...');

    try {
      const { token, user } = await API.post('/api/auth/login', { email, password });
      Auth.closeModal();
      App.setAuth(token, user);
      Toast.success(`Bon retour ${user.name} !`);
    } catch (err) {
      Auth._setError(errEl, err.message);
    } finally {
      Auth._setLoading(btn, false, 'Se connecter');
    }
  },

  // ── Soumettre l'inscription ───────────────────────────────────────────────
  async submitRegister(e) {
    e.preventDefault();
    const name     = document.getElementById('reg-name')?.value.trim();
    const email    = document.getElementById('reg-email')?.value.trim();
    const password = document.getElementById('reg-password')?.value;
    const btn      = document.getElementById('register-btn');
    const errEl    = document.getElementById('register-error');

    Auth._setError(errEl, '');

    if (password.length < 8) {
      return Auth._setError(errEl, 'Le mot de passe doit faire au moins 8 caractères.');
    }

    Auth._setLoading(btn, true, 'Création du compte...');

    try {
      const { token, user, message } = await API.post('/api/auth/register', { name, email, password });
      Auth.closeModal();
      App.setAuth(token, user);
      Toast.success(message || `Bienvenue ${user.name} !`);
    } catch (err) {
      Auth._setError(errEl, err.message);
    } finally {
      Auth._setLoading(btn, false, 'Créer mon compte →');
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
    btn.disabled = loading;
    btn.textContent = label;
    btn.classList.toggle('btn-loading', loading);
  },
};

// Exposer Auth sur window pour compatibilité avec tout contexte d'exécution
window.Auth = Auth;
