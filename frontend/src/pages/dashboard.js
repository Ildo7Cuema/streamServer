// =============================================================================
// Dashboard Page
// =============================================================================

import { api, toast } from '../app.js';

let listenerChart = null;

export function renderDashboard(container) {
  container.innerHTML = `
    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Ouvintes</span>
          <div class="stat-card-icon blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="stat-listeners">0</div>
        <div class="stat-card-sub">Neste momento</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Pico Hoje</span>
          <div class="stat-card-icon green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="stat-peak">0</div>
        <div class="stat-card-sub">Máximo de ouvintes</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Estações</span>
          <div class="stat-card-icon purple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="stat-stations">0</div>
        <div class="stat-card-sub" id="stat-stations-active">0 activas</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Mounts Activos</span>
          <div class="stat-card-icon orange">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="stat-mounts">0</div>
        <div class="stat-card-sub">A transmitir agora</div>
      </div>
    </div>

    <!-- Stream Credentials -->
    <div class="panel" id="stream-creds-panel">
      <div class="panel-header">
        <span class="panel-title">🔌 Credenciais de Stream (BUTT)</span>
        <button class="btn btn-outline btn-sm" id="btn-copy-stream-creds" style="display:none;">Copiar</button>
      </div>
      <div class="panel-body" id="stream-creds-body">
        <p style="color:var(--text-muted);">A carregar...</p>
      </div>
    </div>

    <!-- Two Column Layout -->
    <div class="grid-2">
      <!-- Now Playing -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">🎵 Em Reprodução</span>
          <div class="eq-bars">
            <div class="eq-bar"></div><div class="eq-bar"></div>
            <div class="eq-bar"></div><div class="eq-bar"></div>
          </div>
        </div>
        <div class="panel-body">
          <div class="now-playing">
            <div class="now-playing-art">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
            <div class="now-playing-info">
              <div class="now-playing-title" id="np-title">Aguardando stream...</div>
              <div class="now-playing-artist" id="np-artist">--</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Mounts -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">📡 Mounts Activos</span>
        </div>
        <div class="panel-body" id="mounts-list">
          <div class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p>Nenhum mount activo — inicia o BUTT para transmitir</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Listener Chart -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">📊 Ouvintes (24h)</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline btn-sm" data-period="1h">1h</button>
          <button class="btn btn-outline btn-sm" data-period="6h">6h</button>
          <button class="btn btn-outline btn-sm active" data-period="24h">24h</button>
          <button class="btn btn-outline btn-sm" data-period="7d">7d</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="chart-container">
          <canvas id="listener-chart"></canvas>
        </div>
      </div>
    </div>
  `;

  loadDashboardData();
  loadStreamCredentials();
}

let streamCredsText = '';

async function loadStreamCredentials() {
  const body = document.getElementById('stream-creds-body');
  const copyBtn = document.getElementById('btn-copy-stream-creds');
  if (!body) return;

  try {
    const data = await api('/auth/stream-connection');
    const sc = data?.streamConnection;

    if (!sc?.icecast) {
      body.innerHTML = `<p style="color:var(--text-muted);">
        Sem perfil de DJ. Cria uma estação em <strong>Estações</strong> ou regista-te como DJ.
      </p>`;
      return;
    }

    const ic = sc.icecast;
    const setup = ic.setup || sc.butt?.setup || {};
    const configured = ic.configured ?? setup.configured ?? false;

    streamCredsText = [
      `Servidor: ${configured ? ic.host : '(Icecast não configurado — ver Estações)'}`,
      `Porta: ${ic.port}`,
      `Mount: ${ic.mountpoint}`,
      `Utilizador: ${ic.username}`,
      `Password: ${ic.password}`,
      `Formato: ${String(ic.format || '').toUpperCase()} ${ic.bitrate} kbps`,
      `SSL/TLS: Desligado`,
      `URL ouvir: ${sc.listen_url || ''}`
    ].join('\n');

    const setupBanner = !configured
      ? `<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:8px;padding:12px;margin-bottom:16px;font-size:0.85rem;">
          <strong style="color:#f59e0b;">⚠️ Servidor Icecast em falta</strong>
          <p style="margin:8px 0 0;color:var(--text-muted);">${escapeHtml(setup.message || 'Define PUBLIC_ICECAST_HOST no Render com o IP da VPS InterServer (porta 8000).')}</p>
        </div>`
      : '';

    body.innerHTML = `
      ${setupBanner}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;">Transmitir (BUTT)</div>
          <div style="font-size:0.85rem;line-height:1.7;">
            <div><strong>Servidor:</strong> ${configured ? escapeHtml(ic.host) : '<span style="color:#f59e0b;">Não configurado</span>'}</div>
            <div><strong>Porta:</strong> ${ic.port}</div>
            <div><strong>Mount:</strong> <code>${escapeHtml(ic.mountpoint)}</code></div>
            <div><strong>Utilizador:</strong> ${escapeHtml(ic.username)}</div>
            <div><strong>Pass:</strong> <code>${escapeHtml(ic.password)}</code></div>
            <div><strong>SSL:</strong> Desligado</div>
          </div>
        </div>
        <div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;">Ouvir online</div>
          <code style="font-size:0.82rem;word-break:break-all;color:var(--accent);">${escapeHtml(sc.listen_url || '—')}</code>
        </div>
      </div>
    `;

    if (copyBtn) {
      copyBtn.style.display = 'inline-flex';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(streamCredsText).then(() => toast('Credenciais copiadas!', 'success'));
      };
    }
  } catch (e) {
    body.innerHTML = `<p style="color:var(--text-muted);">Credenciais indisponíveis.</p>`;
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

async function loadDashboardData() {
  try {
    // Load overview
    const overview = await api('/stats/overview');

    document.getElementById('stat-stations').textContent = overview.stations?.total || 0;
    document.getElementById('stat-stations-active').textContent =
      `${overview.stations?.active || 0} activas`;

    // Load realtime
    try {
      const realtime = await api('/stats/realtime');
      updateDashboardStats(realtime);
    } catch (e) { /* server might not be running */ }

    // Load chart
    loadListenerChart('24h');
  } catch (error) {
    console.warn('Dashboard data not available:', error.message);
  }
}

export function updateDashboardStats(data) {
  const el = (id) => document.getElementById(id);
  if (el('stat-listeners')) el('stat-listeners').textContent = data.totalListeners || 0;
  if (el('stat-peak')) el('stat-peak').textContent = data.peakListeners || 0;
  if (el('stat-mounts')) el('stat-mounts').textContent = data.activeMounts || 0;

  // Update mounts list
  const mountsList = el('mounts-list');
  if (mountsList && data.mounts && data.mounts.length > 0) {
    mountsList.innerHTML = data.mounts.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:600;">/${m.mount}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${m.title || 'Sem metadados'}</div>
        </div>
        <div style="text-align:right;">
          <span class="badge badge-success">${m.listeners} ouvintes</span>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${m.bitrate || '?'}kbps</div>
        </div>
      </div>
    `).join('');
  }
}

async function loadListenerChart(period) {
  try {
    const data = await api(`/stats/listeners?period=${period}`);

    if (listenerChart) listenerChart.destroy();

    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);

    const ctx = document.getElementById('listener-chart');
    if (!ctx) return;

    listenerChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => new Date(d.time_bucket).toLocaleTimeString('pt', { hour: '2-digit', minute: '2-digit' })),
        datasets: [{
          label: 'Ouvintes',
          data: data.map(d => Math.round(d.avg_listeners)),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { color: 'rgba(30,41,59,0.5)' },
            ticks: { color: '#64748b', font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(30,41,59,0.5)' },
            ticks: { color: '#64748b', font: { size: 11 } },
            beginAtZero: true
          }
        }
      }
    });
  } catch (e) {
    console.warn('Chart data not available');
  }
}
