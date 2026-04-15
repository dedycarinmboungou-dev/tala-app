/* ============================================================
   TALA — Dashboard + Coach + Subscriptions views
   ============================================================ */

// ─── Dashboard ─────────────────────────────────────────────────────────────────
const Dashboard = {
  period: 30,
  data: null,

  render() {
    App.state.currentView = 'dashboard';
    renderAppShell('dashboard', this._shellHTML());
    this._load();
  },

  _shellHTML() {
    return `
      <div class="page-content">
        <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem">
          <div>
            <h1 class="page-title">Tableau de bord</h1>
            <p class="page-sub">Ton vrai bénéfice net, en temps réel.</p>
          </div>
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
            <div class="period-tabs">
              <div class="period-tab ${Dashboard.period === 7  ? 'active' : ''}" onclick="Dashboard.setPeriod(7)">7j</div>
              <div class="period-tab ${Dashboard.period === 30 ? 'active' : ''}" onclick="Dashboard.setPeriod(30)">30j</div>
              <div class="period-tab ${Dashboard.period === 90 ? 'active' : ''}" onclick="Dashboard.setPeriod(90)">90j</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="Dashboard.downloadPDF()" id="pdf-btn"
                    title="Télécharger le rapport PDF">
              📄 Rapport PDF
            </button>
          </div>
        </div>

        <!-- Metrics skeleton -->
        <div class="metrics-grid" id="metrics-grid">
          ${Array(6).fill(0).map(() => `
            <div class="metric-card">
              <div class="skeleton" style="height:.75rem;width:60%;margin-bottom:.75rem;border-radius:4px"></div>
              <div class="skeleton" style="height:1.75rem;width:80%;border-radius:4px"></div>
            </div>
          `).join('')}
        </div>

        <!-- ROAS alert placeholder -->
        <div id="roas-alert"></div>

        <!-- Chart -->
        <div class="chart-container" id="chart-container">
          <div class="chart-header">
            <span class="chart-title">Revenus vs Dépenses pub</span>
            <div style="display:flex;gap:1rem">
              <div style="display:flex;align-items:center;gap:.375rem;font-size:.8125rem;color:var(--gray-400)">
                <div style="width:10px;height:10px;background:var(--gold);border-radius:2px"></div>Revenus
              </div>
              <div style="display:flex;align-items:center;gap:.375rem;font-size:.8125rem;color:var(--gray-400)">
                <div style="width:10px;height:10px;background:var(--danger);opacity:.5;border-radius:2px"></div>Meta Ads
              </div>
            </div>
          </div>
          <div class="chart-bars skeleton" id="chart-bars" style="height:120px;border-radius:var(--radius-md)"></div>
          <div style="display:flex;justify-content:space-between;margin-top:.5rem" id="chart-dates">
            <span class="text-xs text-muted"></span>
            <span class="text-xs text-muted"></span>
          </div>
        </div>

        <!-- Connections warning -->
        <div id="connections-warning"></div>

      </div>
    `;
  },

  setPeriod(days) {
    Dashboard.period = days;
    Dashboard.render();
  },

  async downloadPDF() {
    const btn = document.getElementById('pdf-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération...'; }

    try {
      const token = localStorage.getItem('tala_token');
      const res   = await fetch(`/api/pdf/report?period=${Dashboard.period}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${res.status}`);
      }

      // Déclenche le téléchargement en créant un lien temporaire
      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
                       || `tala-rapport-${Dashboard.period}j.pdf`;
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('Rapport PDF téléchargé !');
    } catch (err) {
      Toast.error(err.message || 'Impossible de générer le rapport.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📄 Rapport PDF'; }
    }
  },

  async _load() {
    try {
      // Fetch real data (endpoint à implémenter)
      const data = await API.get(`/api/dashboard?period=${Dashboard.period}`).catch(() => null);
      Dashboard.data = data;
      if (data) {
        this._renderMetrics(data);
        this._renderChart(data.chart || []);
        this._renderAlerts(data);
      } else {
        this._renderMockData();
      }
    } catch {
      this._renderMockData();
    }
    this._checkConnections();
  },

  _renderMockData() {
    // Données d'exemple tant que les connexions ne sont pas faites
    this._renderMetrics({
      revenue:       0,
      chariow_fees:  0,
      meta_spend:    0,
      tool_subs:     0,
      net_profit:    0,
      roas:          0,
    });
    this._renderChart([]);
  },

  _renderMetrics(d) {
    const noConn = !App.state.connections?.chariow;
    const roas = d.roas || 0;
    const roasColor = roas === 0 ? 'var(--gray-400)' : roas >= 2 ? 'var(--success)' : roas >= 1 ? 'var(--warning)' : 'var(--danger)';

    document.getElementById('metrics-grid').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Revenus Chariow</div>
        <div class="metric-value">${noConn ? '—' : formatXOF(d.revenue)}</div>
        <div class="metric-change">Bruts, avant frais</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Frais Chariow</div>
        <div class="metric-value danger">${noConn ? '—' : '−' + formatXOF(d.chariow_fees)}</div>
        <div class="metric-change">${d.fee_rate ? d.fee_rate + '% (taux appliqué)' : 'Auto-calculé'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Dépenses Meta Ads</div>
        <div class="metric-value" style="color:var(--danger)">${!App.state.connections?.meta ? '—' : '−' + formatXOF(d.meta_spend)}</div>
        <div class="metric-change">Converti en XOF</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Abonnements outils</div>
        <div class="metric-value" style="color:var(--warning)">${noConn ? '—' : '−' + formatXOF(d.tool_subs)}</div>
        <div class="metric-change">Ce mois-ci</div>
      </div>
      <div class="metric-card card-gold" style="grid-column:span 1">
        <div class="metric-label">Bénéfice Net Réel</div>
        <div class="metric-value ${d.net_profit >= 0 ? 'success' : 'danger'}">${noConn ? '—' : formatXOF(d.net_profit)}</div>
        <div class="metric-change ${d.net_profit >= 0 ? 'up' : 'down'}">${d.net_profit >= 0 ? '↑ Tu es dans le vert' : '↓ Tu perds de l\'argent'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">ROAS Tala</div>
        <div class="metric-value" style="color:${roasColor}; font-size:1.75rem">
          ${noConn ? '—' : roas > 0 ? roas.toFixed(2) + '×' : '0×'}
        </div>
        <div class="metric-change">Fiable, calculé en XOF</div>
      </div>
    `;
  },

  _renderChart(chartData) {
    const container = document.getElementById('chart-bars');
    const datesEl = document.getElementById('chart-dates');
    if (!container) return;

    if (!chartData || !chartData.length) {
      container.className = '';
      container.style.height = '120px';
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-500);font-size:.875rem;flex-direction:column;gap:.5rem">
          <span style="font-size:1.5rem">📊</span>
          <span>Connecte Chariow pour voir le graphique</span>
        </div>
      `;
      return;
    }

    const maxVal = Math.max(...chartData.map(d => Math.max(d.revenue || 0, d.spend || 0)), 1);

    container.className = 'chart-bars';
    container.style.height = '120px';
    container.innerHTML = chartData.map(d => `
      <div class="chart-bar-group">
        <div class="chart-bar rev" style="height:${Math.max((d.revenue / maxVal) * 100, 2)}%"></div>
        <div class="chart-bar ads" style="height:${Math.max((d.spend / maxVal) * 100, 2)}%"></div>
      </div>
    `).join('');

    if (chartData.length >= 2) {
      const first = formatDate(chartData[0].date);
      const last  = formatDate(chartData[chartData.length - 1].date);
      datesEl.innerHTML = `<span class="text-xs text-muted">${first}</span><span class="text-xs text-muted">${last}</span>`;
    }
  },

  _renderAlerts(d) {
    const el = document.getElementById('roas-alert');
    if (!el) return;
    if (d.roas > 0 && d.roas < 1) {
      el.innerHTML = `
        <div class="roas-alert">
          <span class="roas-alert-icon">🚨</span>
          <div>
            <h4>ROAS Tala en dessous de 1 — Tu perds de l'argent !</h4>
            <p>Pour chaque franc dépensé en pub, tu gagnes moins de 1 franc. Réduis ton budget ou optimise tes campagnes.</p>
          </div>
        </div>
      `;
    } else {
      el.innerHTML = '';
    }
  },

  _checkConnections() {
    const el = document.getElementById('connections-warning');
    if (!el) return;
    const missing = [];
    if (!App.state.connections?.chariow) missing.push('Chariow');
    if (!App.state.connections?.meta)    missing.push('Meta Ads');

    if (missing.length) {
      el.innerHTML = `
        <div class="card" style="border-color:var(--gold-border);background:var(--gold-dim);margin-top:.5rem">
          <div style="display:flex;align-items:flex-start;gap:.75rem">
            <span style="font-size:1.25rem;flex-shrink:0">⚡</span>
            <div>
              <h4 style="margin-bottom:.375rem;color:var(--gold)">
                Connexion${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''} : ${missing.join(' et ')}
              </h4>
              <p style="font-size:.875rem;color:var(--gray-400);margin-bottom:.875rem">
                Connecte ${missing.join(' et ')} pour voir tes vrais chiffres.
              </p>
              <button class="btn btn-primary btn-sm" onclick="Onboarding.render()">Configurer maintenant →</button>
            </div>
          </div>
        </div>
      `;
    } else {
      el.innerHTML = '';
    }
  },
};

// ─── Coach IA ─────────────────────────────────────────────────────────────────
const CoachView = {
  html() {
    return `
      <div class="chat-container" style="padding-bottom:0">
        <div style="padding:1rem 1.25rem;border-bottom:1px solid var(--black-5);display:flex;align-items:center;gap:.75rem">
          <div style="width:40px;height:40px;background:var(--gold-dim);border:1px solid var(--gold-border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0">🤖</div>
          <div>
            <div style="font-weight:700">Tala Coach</div>
            <div style="font-size:.75rem;color:var(--success)">● En ligne · Propulsé par Claude</div>
          </div>
        </div>

        <div class="chat-messages" id="chat-messages">
          <div class="chat-msg assistant">
            <div class="chat-bubble">
              Bonjour <strong>${App.state.user?.name?.split(' ')[0] || ''}</strong> ! 👋<br><br>
              Je suis Tala Coach, ton copilote IA publicitaire. Je connais tes revenus Chariow, tes dépenses Meta Ads et ton bénéfice net.<br><br>
              Pose-moi n'importe quelle question sur tes campagnes, tes produits ou ta rentabilité.
            </div>
          </div>
          ${!App.state.connections?.chariow ? `
            <div class="chat-msg assistant">
              <div class="chat-bubble" style="border-color:var(--gold-border);background:var(--gold-dim)">
                ⚠️ <strong>Connexions manquantes.</strong> Connecte Chariow et Meta Ads pour que je puisse analyser tes vraies données.
                <br><br>
                <button class="btn btn-primary btn-sm" onclick="Onboarding.render()">Configurer →</button>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="chat-input-area">
          <input
            type="text"
            id="chat-input"
            class="chat-input"
            placeholder="Pose une question à Tala Coach..."
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();CoachView.send()}"
          >
          <button class="chat-send-btn" onclick="CoachView.send()" aria-label="Envoyer">→</button>
        </div>
      </div>
    `;
  },

  bind() {
    setTimeout(() => document.getElementById('chat-input')?.focus(), 100);
  },

  async send() {
    const input = document.getElementById('chat-input');
    const msg = input?.value.trim();
    if (!msg) return;

    input.value = '';
    this._addMessage('user', msg);
    this._addTyping();

    try {
      const { reply } = await API.post('/api/coach/message', { message: msg });
      this._removeTyping();
      this._addMessage('assistant', reply);
    } catch (err) {
      this._removeTyping();
      if (err.code === 'SUBSCRIPTION_REQUIRED') {
        this._addMessage('assistant', '🔒 Le Coach IA est une fonctionnalité premium. Passe à l\'abonnement pour y accéder.');
      } else {
        this._addMessage('assistant', '❌ Désolé, une erreur est survenue. Réessaie dans un moment.');
      }
    }
  },

  _addMessage(role, content) {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = `<div class="chat-bubble">${this._escape(content)}</div>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  },

  _addTyping() {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'chat-msg assistant';
    div.innerHTML = `
      <div class="chat-bubble" style="padding:.625rem 1rem">
        <span style="display:inline-flex;gap:.25rem;align-items:center">
          <span style="width:6px;height:6px;background:var(--gray-400);border-radius:50%;animation:pulse 1s infinite"></span>
          <span style="width:6px;height:6px;background:var(--gray-400);border-radius:50%;animation:pulse 1s infinite .2s"></span>
          <span style="width:6px;height:6px;background:var(--gray-400);border-radius:50%;animation:pulse 1s infinite .4s"></span>
        </span>
      </div>
    `;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  },

  _removeTyping() {
    document.getElementById('typing-indicator')?.remove();
  },

  _escape(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  },
};

// ─── Abonnements outils (gestionnaire) ────────────────────────────────────────
const SubsView = {
  html() {
    return `
      <div class="page-content">
        <div class="page-header">
          <h1 class="page-title">Abonnements outils</h1>
          <p class="page-sub">Ces montants sont déduits automatiquement de ton bénéfice net chaque mois.</p>
        </div>

        <div style="max-width:560px">

          <!-- Formulaire ajout -->
          <div class="card mb-4">
            <h4 style="margin-bottom:1rem">Ajouter un outil</h4>
            <div style="display:grid;grid-template-columns:1fr 150px;gap:.75rem;margin-bottom:.75rem">
              <div class="form-group" style="margin:0">
                <label class="form-label">Nom de l'outil</label>
                <input type="text" class="form-input" id="tool-name" placeholder="ex: CapCut Pro">
              </div>
              <div class="form-group" style="margin:0">
                <label class="form-label">Montant/mois</label>
                <input type="number" class="form-input" id="tool-amount" placeholder="5000">
              </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="SubsView.add()">+ Ajouter</button>
          </div>

          <!-- Liste -->
          <div id="subs-list-view">
            <div style="text-align:center;padding:2.5rem;color:var(--gray-500)">
              <div style="font-size:2rem;margin-bottom:.5rem">🔧</div>
              <p>Chargement...</p>
            </div>
          </div>

          <!-- Total -->
          <div id="subs-total" class="card-gold" style="padding:1.25rem;display:none">
            <div class="metric-label">Total mensuel déduit</div>
            <div class="metric-value gold" id="subs-total-val">0 F</div>
          </div>

        </div>
      </div>
    `;
  },

  async bind() {
    await this.load();
  },

  async load() {
    try {
      const { subscriptions } = await API.get('/api/subscriptions/tools');
      this.render(subscriptions || []);
    } catch {
      document.getElementById('subs-list-view').innerHTML = `
        <div class="card" style="border-color:rgba(239,68,68,.2);text-align:center;color:var(--danger)">
          Impossible de charger les abonnements.
        </div>
      `;
    }
  },

  render(subs) {
    const el = document.getElementById('subs-list-view');
    const totalEl = document.getElementById('subs-total');
    const totalVal = document.getElementById('subs-total-val');
    if (!el) return;

    if (!subs.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--gray-500)">
          <div style="font-size:2rem;margin-bottom:.5rem">🔧</div>
          <p>Aucun outil ajouté. Ajoute tes abonnements pour qu'ils soient déduits de ton bénéfice net.</p>
        </div>
      `;
      if (totalEl) totalEl.style.display = 'none';
      return;
    }

    const total = subs.reduce((s, t) => s + t.amount, 0);
    el.innerHTML = subs.map(s => `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:.875rem 1rem;margin-bottom:.625rem">
        <div>
          <span style="font-weight:700;color:var(--white)">${s.name}</span>
          <span style="color:var(--gold);font-weight:700;margin-left:.75rem">${formatXOF(s.amount)}</span>
          <span style="color:var(--gray-500);font-size:.8125rem">/mois</span>
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-ghost btn-sm" onclick="SubsView.delete(${s.id})" style="color:var(--danger)" aria-label="Supprimer">✕</button>
        </div>
      </div>
    `).join('');

    if (totalEl) { totalEl.style.display = 'block'; }
    if (totalVal) totalVal.textContent = formatXOF(total);
  },

  async add() {
    const name   = document.getElementById('tool-name')?.value.trim();
    const amount = parseFloat(document.getElementById('tool-amount')?.value);

    if (!name || !amount || amount <= 0) return Toast.error('Remplis le nom et le montant.');

    try {
      await API.post('/api/subscriptions/tools', { name, amount });
      document.getElementById('tool-name').value   = '';
      document.getElementById('tool-amount').value = '';
      await this.load();
      Toast.success(`${name} ajouté !`);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async delete(id) {
    if (!confirm('Supprimer cet abonnement ?')) return;
    try {
      await API.delete(`/api/subscriptions/tools/${id}`);
      await this.load();
      Toast.success('Abonnement supprimé.');
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
