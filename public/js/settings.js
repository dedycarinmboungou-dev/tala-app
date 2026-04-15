/* ============================================================
   TALA — Settings View (Paramètres complets)
   ============================================================ */

const SettingsView = {

  render() {
    App.state.currentView = 'settings';
    renderAppShell('settings', this._html());
    this._bind();
  },

  _html() {
    const u   = App.state.user;
    const sub = App.state.subscription;
    const conn = App.state.connections;

    // ── Statut Chariow ────────────────────────────────────────────────────────
    const chariow = conn?.chariow;
    const chariowHtml = chariow
      ? `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
           <div>
             <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
               <span style="color:var(--success);font-size:1rem">●</span>
               <span style="font-weight:700">Connecté</span>
             </div>
             <div style="font-size:.8125rem;color:var(--gray-400)">${chariow.store_name || 'Store'}</div>
           </div>
           <button class="btn btn-secondary btn-sm" id="btn-reconnect-chariow">Reconnecter</button>
         </div>`
      : `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
           <div>
             <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
               <span style="color:var(--danger);font-size:1rem">●</span>
               <span style="font-weight:700;color:var(--danger)">Non connecté</span>
             </div>
             <div style="font-size:.8125rem;color:var(--gray-400)">Connecte ton store pour voir tes données</div>
           </div>
           <button class="btn btn-primary btn-sm" id="btn-connect-chariow">Connecter</button>
         </div>`;

    // ── Statut Meta Ads ───────────────────────────────────────────────────────
    const meta = conn?.meta;
    const metaHtml = meta
      ? `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
           <div>
             <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
               <span style="color:var(--success);font-size:1rem">●</span>
               <span style="font-weight:700">Connecté</span>
             </div>
             <div style="font-size:.8125rem;color:var(--gray-400)">${meta.ad_account_name || meta.ad_account_id || 'Compte Meta Ads'}</div>
           </div>
           <div style="display:flex;gap:.5rem">
             <button class="btn btn-secondary btn-sm" id="btn-reconnect-meta">Reconnecter</button>
             <button class="btn btn-ghost btn-sm" id="btn-disconnect-meta" style="color:var(--danger)">Déconnecter</button>
           </div>
         </div>`
      : `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
           <div>
             <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
               <span style="color:var(--gray-500);font-size:1rem">●</span>
               <span style="font-weight:700;color:var(--gray-400)">Non connecté</span>
             </div>
             <div style="font-size:.8125rem;color:var(--gray-400)">Connecte Meta Ads pour calculer ton ROAS</div>
           </div>
           <button class="btn btn-secondary btn-sm" id="btn-connect-meta">Connecter Meta Ads →</button>
         </div>`;

    // ── Statut abonnement ─────────────────────────────────────────────────────
    let subStatusHtml = '';
    let subActionsHtml = '';

    if (sub) {
      const isActive  = sub.is_active;
      const isTrial   = sub.plan === 'trial';
      const isPremium = sub.plan === 'premium' && isActive;
      const isExpired = !isActive;

      const statusColor = isPremium ? 'var(--success)' : isTrial && isActive ? 'var(--gold)' : 'var(--danger)';
      const statusText  = isPremium ? 'Premium actif'
                        : isTrial && isActive ? `Essai gratuit — ${sub.days_remaining} jour(s) restant(s)`
                        : 'Expiré';

      const expiryLine = sub.expires_at
        ? `Expire le ${new Date(sub.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
        : '';

      subStatusHtml = `
        <div style="display:flex;align-items:center;gap:.625rem;margin-bottom:.5rem">
          <span style="font-size:1.5rem">${isPremium ? '⭐' : isTrial && isActive ? '⏳' : '⛔'}</span>
          <div>
            <div style="font-weight:700;color:${statusColor}">${statusText}</div>
            ${expiryLine ? `<div style="font-size:.8125rem;color:var(--gray-400)">${expiryLine}</div>` : ''}
          </div>
        </div>`;

      if (isPremium) {
        subActionsHtml = `
          <button class="btn btn-ghost btn-sm mt-3" id="btn-cancel-sub" style="color:var(--danger)">
            Annuler l'abonnement
          </button>
          <p class="form-hint" style="margin-top:.5rem">L'abonnement reste actif jusqu'à la date d'expiration.</p>`;
      } else {
        subActionsHtml = `
          <button class="btn btn-primary btn-sm mt-3" id="btn-upgrade">
            Passer Premium — 9 900 F/mois →
          </button>
          <p class="form-hint" style="margin-top:.5rem">Paiement sécurisé via FedaPay (Mobile Money, carte).</p>`;
      }
    }

    return `
      <div class="page-content">
        <div class="page-header">
          <h1 class="page-title">Paramètres</h1>
          <p class="page-sub">Gère ton compte, tes connexions et ton abonnement</p>
        </div>

        <div style="display:flex;flex-direction:column;gap:1.25rem;max-width:520px">

          <!-- ── Mon compte ──────────────────────────────────────────────── -->
          <div class="card">
            <h4 style="margin-bottom:1.125rem">Mon compte</h4>
            <div class="form-group">
              <label class="form-label">Prénom / Nom</label>
              <input type="text" class="form-input" id="s-name" value="${u?.name || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" class="form-input" value="${u?.email || ''}" disabled
                     style="opacity:.45;cursor:not-allowed">
            </div>
            <div id="s-name-error" class="form-hint error hidden"></div>
            <button class="btn btn-primary btn-sm" id="btn-save-name">Enregistrer le nom</button>
          </div>

          <!-- ── Connexions ──────────────────────────────────────────────── -->
          <div class="card">
            <h4 style="margin-bottom:1.25rem">Connexions</h4>

            <!-- Chariow -->
            <div style="margin-bottom:1.25rem;padding-bottom:1.25rem;border-bottom:1px solid var(--black-5)">
              <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.875rem">
                <span style="font-size:1.125rem">🛍</span>
                <span style="font-weight:600;font-size:.9375rem">Chariow</span>
              </div>
              ${chariowHtml}
              <div id="chariow-reconnect-form" class="hidden" style="margin-top:1rem">
                <div class="form-group" style="margin-bottom:.75rem">
                  <label class="form-label">Nouvelle clé API Chariow</label>
                  <div class="api-key-input-wrap">
                    <input type="password" class="form-input" id="s-chariow-key"
                           placeholder="ck_••••••••••••••••••••" autocomplete="off">
                    <button type="button" class="api-key-toggle"
                            onclick="Auth.togglePassword('s-chariow-key',this)"
                            aria-label="Afficher la clé">👁</button>
                  </div>
                </div>
                <div id="s-chariow-error" class="form-hint error hidden"></div>
                <div style="display:flex;gap:.625rem">
                  <button class="btn btn-primary btn-sm" id="btn-save-chariow">Valider la clé →</button>
                  <button class="btn btn-ghost btn-sm" id="btn-cancel-chariow">Annuler</button>
                </div>
              </div>
            </div>

            <!-- Meta Ads -->
            <div>
              <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.875rem">
                <span style="font-size:1.125rem">📣</span>
                <span style="font-weight:600;font-size:.9375rem">Meta Ads</span>
              </div>
              ${metaHtml}
            </div>
          </div>

          <!-- ── Abonnement Tala ─────────────────────────────────────────── -->
          <div class="card">
            <h4 style="margin-bottom:1rem">Abonnement Tala</h4>
            ${subStatusHtml}
            <div id="sub-error" class="form-hint error hidden"></div>
            ${subActionsHtml}
          </div>

          <!-- ── Déconnexion ─────────────────────────────────────────────── -->
          <button class="btn btn-danger btn-block" onclick="App.logout()">
            Se déconnecter
          </button>

        </div>
      </div>
    `;
  },

  _bind() {
    // Enregistrer le nom
    document.getElementById('btn-save-name')?.addEventListener('click', () => this._saveName());

    // Chariow
    document.getElementById('btn-reconnect-chariow')?.addEventListener('click', () => this._showChariowForm());
    document.getElementById('btn-connect-chariow')?.addEventListener('click',   () => this._showChariowForm());
    document.getElementById('btn-save-chariow')?.addEventListener('click',      () => this._saveChariow());
    document.getElementById('btn-cancel-chariow')?.addEventListener('click',    () => this._hideChariowForm());

    // Meta Ads
    document.getElementById('btn-connect-meta')?.addEventListener('click',    () => this._connectMeta());
    document.getElementById('btn-reconnect-meta')?.addEventListener('click',  () => this._connectMeta());
    document.getElementById('btn-disconnect-meta')?.addEventListener('click', () => this._disconnectMeta());

    // Abonnement
    document.getElementById('btn-upgrade')?.addEventListener('click',     () => this._initiatePremium());
    document.getElementById('btn-cancel-sub')?.addEventListener('click',  () => this._cancelSub());
  },

  // ── Compte ──────────────────────────────────────────────────────────────────
  async _saveName() {
    const name   = document.getElementById('s-name')?.value.trim();
    const btn    = document.getElementById('btn-save-name');
    const errEl  = document.getElementById('s-name-error');

    this._clearError(errEl);

    if (!name || name.length < 2) {
      return this._showError(errEl, 'Le nom doit faire au moins 2 caractères.');
    }

    this._setLoading(btn, true, 'Enregistrement...');
    try {
      await API.put('/api/auth/profile', { name });
      App.state.user.name = name;
      Toast.success('Nom mis à jour !');
    } catch (e) {
      this._showError(errEl, e.message);
    } finally {
      this._setLoading(btn, false, 'Enregistrer le nom');
    }
  },

  // ── Chariow ──────────────────────────────────────────────────────────────────
  _showChariowForm() {
    document.getElementById('chariow-reconnect-form')?.classList.remove('hidden');
    document.getElementById('btn-reconnect-chariow')?.setAttribute('disabled', '');
    document.getElementById('btn-connect-chariow')?.setAttribute('disabled', '');
    setTimeout(() => document.getElementById('s-chariow-key')?.focus(), 50);
  },

  _hideChariowForm() {
    document.getElementById('chariow-reconnect-form')?.classList.add('hidden');
    document.getElementById('btn-reconnect-chariow')?.removeAttribute('disabled');
    document.getElementById('btn-connect-chariow')?.removeAttribute('disabled');
  },

  async _saveChariow() {
    const key   = document.getElementById('s-chariow-key')?.value.trim();
    const btn   = document.getElementById('btn-save-chariow');
    const errEl = document.getElementById('s-chariow-error');

    this._clearError(errEl);

    if (!key) return this._showError(errEl, 'Colle ta clé API Chariow.');

    this._setLoading(btn, true, 'Vérification...');
    try {
      const { store } = await API.post('/api/onboarding/chariow', { api_key: key });
      App.state.connections.chariow = { store_name: store?.name };
      Toast.success(`Store "${store?.name || 'Chariow'}" reconnecté !`);
      // Recharger la page paramètres pour refléter le nouveau statut
      SettingsView.render();
    } catch (e) {
      this._showError(errEl, e.message || 'Clé API invalide.');
    } finally {
      this._setLoading(btn, false, 'Valider la clé →');
    }
  },

  // ── Meta Ads ──────────────────────────────────────────────────────────────────
  async _connectMeta() {
    try {
      const { url } = await API.get('/api/meta/oauth/url');
      const popup   = window.open(url, 'meta_auth', 'width=600,height=700');

      const handler = async (e) => {
        if (e.data?.type !== 'META_AUTH_SUCCESS') return;
        window.removeEventListener('message', handler);
        clearInterval(closedCheck);
        await this._afterMetaAuth();
      };
      window.addEventListener('message', handler);

      const closedCheck = setInterval(() => {
        if (popup?.closed) { clearInterval(closedCheck); window.removeEventListener('message', handler); }
      }, 1000);

    } catch (err) {
      Toast.error(err.message || 'Impossible de lancer la connexion Meta.');
    }
  },

  async _afterMetaAuth() {
    try {
      const { accounts } = await API.get('/api/meta/accounts');
      if (!accounts?.length) {
        Toast.info('Connecté ! Aucun compte pub trouvé.');
        App.state.connections.meta = { connected: true };
        SettingsView.render(); return;
      }
      if (accounts.length === 1) {
        await API.post('/api/meta/select-account', { account_id: accounts[0].id });
        App.state.connections.meta = { ad_account_id: accounts[0].id, ad_account_name: accounts[0].name };
        Toast.success(`Compte "${accounts[0].name}" sélectionné !`);
        SettingsView.render();
      } else {
        this._showAccountSelector(accounts);
      }
    } catch (err) {
      Toast.error(err.message || 'Erreur après connexion Meta.');
    }
  },

  _showAccountSelector(accounts) {
    // Overlay simple de sélection de compte
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" onclick="document.getElementById('modal-overlay').classList.add('hidden')" aria-label="Fermer">×</button>
        <div class="auth-logo"><div class="logo-mark">T</div><span class="logo-name">Tala</span></div>
        <h2 class="auth-title">Choisis ton compte pub</h2>
        <p class="auth-sub">Sélectionne le compte Meta Ads à lier à Tala.</p>
        <div style="display:flex;flex-direction:column;gap:.5rem;max-height:300px;overflow-y:auto">
          ${accounts.map(a => `
            <div class="card" style="cursor:pointer"
                 onclick="SettingsView._selectAccount('${a.id}','${(a.name || '').replace(/'/g, "\\'")}')">
              <div style="font-weight:700">${a.name}</div>
              <div style="font-size:.8125rem;color:var(--gray-400)">${a.id} · ${a.currency || 'USD'}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  async _selectAccount(accountId, accountName) {
    document.getElementById('modal-overlay')?.classList.add('hidden');
    try {
      await API.post('/api/meta/select-account', { account_id: accountId });
      App.state.connections.meta = { ad_account_id: accountId, ad_account_name: accountName };
      Toast.success(`Compte "${accountName}" sélectionné !`);
      SettingsView.render();
    } catch (err) {
      Toast.error(err.message || 'Erreur lors de la sélection.');
    }
  },

  async _disconnectMeta() {
    if (!confirm('Déconnecter Meta Ads ? Tes données de dépenses pub ne seront plus disponibles.')) return;
    try {
      await API.delete('/api/meta/disconnect');
      App.state.connections.meta = null;
      Toast.success('Meta Ads déconnecté.');
      SettingsView.render();
    } catch (e) {
      Toast.error(e.message);
    }
  },

  // ── Abonnement ────────────────────────────────────────────────────────────────
  async _initiatePremium() {
    const btn   = document.getElementById('btn-upgrade');
    const errEl = document.getElementById('sub-error');
    this._clearError(errEl);
    this._setLoading(btn, true, 'Chargement...');

    try {
      const { payment_url } = await API.post('/api/subscription/initiate', {});
      if (payment_url) {
        window.open(payment_url, '_blank');
        Toast.info('Fenêtre de paiement ouverte. Reviens ici après le paiement.');
      } else {
        throw new Error('URL de paiement non retournée.');
      }
    } catch (e) {
      this._showError(errEl, e.message || 'Erreur lors de l\'initiation du paiement.');
    } finally {
      this._setLoading(btn, false, 'Passer Premium — 9 900 F/mois →');
    }
  },

  async _cancelSub() {
    if (!confirm('Annuler l\'abonnement Premium ? Il restera actif jusqu\'à son expiration.')) return;
    const btn   = document.getElementById('btn-cancel-sub');
    const errEl = document.getElementById('sub-error');
    this._clearError(errEl);
    this._setLoading(btn, true, 'Annulation...');

    try {
      const { message } = await API.post('/api/subscription/cancel', {});
      Toast.success(message || 'Abonnement annulé.');
      // Recharger l'état depuis le serveur
      const { subscription } = await API.get('/api/subscription/status');
      App.state.subscription = subscription;
      SettingsView.render();
    } catch (e) {
      this._showError(errEl, e.message);
    } finally {
      this._setLoading(btn, false, 'Annuler l\'abonnement');
    }
  },

  // ── Helpers ──────────────────────────────────────────────────────────────────
  _showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  },
  _clearError(el) {
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  },
  _setLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = label;
  },
};
