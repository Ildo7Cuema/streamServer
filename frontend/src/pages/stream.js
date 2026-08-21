// =============================================================================
// Stream Control Page — Icecast / BUTT (AutoDJ opcional)
// =============================================================================

import { api, toast, withButtonLoading, getCurrentUser } from '../app.js';

let refreshTimer = null;

export function renderStreamControl(container) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  container.innerHTML = `
    <div class="stream-hero">
      <div>
        <div class="stream-hero-kicker">Ao vivo</div>
        <h2 class="stream-hero-title">Controlo de Stream</h2>
        <p class="stream-hero-sub">Estado do Icecast e das fontes BUTT neste servidor.</p>
      </div>
      <div class="stream-hero-actions">
        <span class="stream-pill" id="stream-icecast-pill">A verificar Icecast…</span>
        <button class="btn btn-primary btn-sm" id="btn-stream-refresh">Atualizar</button>
      </div>
    </div>

    <div class="stats-grid stream-stats">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Ouvintes</span>
        </div>
        <div class="stat-card-value" id="stream-stat-listeners">—</div>
        <div class="stat-card-sub">Neste momento</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Pico</span>
        </div>
        <div class="stat-card-value" id="stream-stat-peak">—</div>
        <div class="stat-card-sub">Máximo nestes mounts</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Fontes</span>
        </div>
        <div class="stat-card-value" id="stream-stat-mounts">—</div>
        <div class="stat-card-sub">A transmitir agora</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Icecast</span>
        </div>
        <div class="stat-card-value" id="stream-stat-icecast" style="font-size:1.35rem;">—</div>
        <div class="stat-card-sub" id="stream-stat-host">—</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">📡 Mounts activos</span>
        <span class="stream-hint" id="stream-updated">—</span>
      </div>
      <div class="panel-body" id="stream-mounts">
        <div class="empty-state"><p>A carregar estado do Icecast…</p></div>
      </div>
    </div>

    <div class="panel" id="stream-player-panel" style="display:none;">
      <div class="panel-header"><span class="panel-title">🎧 Pré-escuta</span></div>
      <div class="panel-body">
        <audio id="stream-preview" controls preload="none" style="width:100%;"></audio>
      </div>
    </div>

    <div class="panel autodj-panel">
      <div class="panel-header">
        <span class="panel-title">🤖 AutoDJ / Gravação</span>
        <span class="badge" id="autodj-badge">Opcional</span>
      </div>
      <div class="panel-body">
        <p class="stream-autodj-note" id="autodj-note">
          Em produção InterServer a emissão é feita com o <strong>BUTT</strong> para o Icecast.
          O AutoDJ (Liquidsoap) só funciona se esse serviço estiver instalado.
        </p>
        <div class="control-grid" id="autodj-controls">
          <button class="control-btn" id="btn-autodj-start" type="button">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg>
            <span>Iniciar AutoDJ</span>
          </button>
          <button class="control-btn" id="btn-autodj-stop" type="button">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
            <span>Parar AutoDJ</span>
          </button>
          <button class="control-btn" id="btn-autodj-skip" type="button">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
            <span>Saltar</span>
          </button>
          <button class="control-btn" id="btn-rec-start" type="button">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
            <span>Iniciar gravação</span>
          </button>
          <button class="control-btn" id="btn-rec-stop" type="button">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10"/></svg>
            <span>Parar gravação</span>
          </button>
        </div>
        <pre id="stream-liquidsoap" class="stream-ls-log">—</pre>
      </div>
    </div>
  `;

  wireButtons();
  loadStatus();
  refreshTimer = setInterval(loadStatus, 12000);
}

function wireButtons() {
  document.getElementById('btn-stream-refresh')?.addEventListener('click', (e) => {
    withButtonLoading(e.currentTarget, loadStatus, 'A atualizar...');
  });

  const bindAction = (id, path, okMsg, loadingText) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      withButtonLoading(e.currentTarget, () => action(path, okMsg), loadingText);
    });
  };

  bindAction('btn-autodj-start', '/stream/autodj/start', 'AutoDJ iniciado', 'A iniciar...');
  bindAction('btn-autodj-stop', '/stream/autodj/stop', 'AutoDJ parado', 'A parar...');
  bindAction('btn-autodj-skip', '/stream/autodj/skip', 'Faixa saltada', 'A saltar...');
  bindAction('btn-rec-start', '/stream/recording/start', 'Gravação iniciada', 'A gravar...');
  bindAction('btn-rec-stop', '/stream/recording/stop', 'Gravação parada', 'A parar...');
}

function setAutodjEnabled(enabled) {
  const ids = ['btn-autodj-start', 'btn-autodj-stop', 'btn-autodj-skip', 'btn-rec-start', 'btn-rec-stop'];
  ids.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('is-disabled', !enabled);
    btn.title = enabled ? '' : 'AutoDJ não está instalado neste servidor';
  });
  const badge = document.getElementById('autodj-badge');
  if (badge) {
    badge.className = enabled ? 'badge badge-success' : 'badge badge-warning';
    badge.textContent = enabled ? 'Disponível' : 'Não instalado';
  }
}

async function action(path, okMsg) {
  try {
    await api(path, { method: 'POST', body: JSON.stringify({}) });
    toast(okMsg, 'success');
    await loadStatus();
  } catch (e) {
    toast(e.message || 'Falha', 'error');
  }
}

function listenPath(mount) {
  const m = String(mount || '').replace(/^\/+/, '');
  if (!m) return '';
  return `/stream/${m}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('URL copiada', 'success');
  } catch {
    toast('Não foi possível copiar', 'error');
  }
}

async function kickMount(mount) {
  if (!confirm(`Desligar a fonte em ${mount}?`)) return;
  try {
    await api('/stream/kick', { method: 'POST', body: JSON.stringify({ mount }) });
    toast('Fonte desligada', 'success');
    await loadStatus();
  } catch (e) {
    toast(e.message || 'Falha ao desligar fonte', 'error');
  }
}

function renderMounts(mounts) {
  const mountsEl = document.getElementById('stream-mounts');
  if (!mountsEl) return;
  const isAdmin = getCurrentUser()?.role === 'admin';

  if (!mounts.length) {
    mountsEl.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma fonte ligada.</p>
        <p style="color:var(--text-muted);margin-top:8px;">Liga o BUTT (Icecast, porta 8000, SSL Off) com o mount da estação.</p>
      </div>`;
    return;
  }

  mountsEl.innerHTML = mounts.map((m) => {
    const mount = m.mount || m.name || '';
    const path = listenPath(mount);
    const abs = path ? `${window.location.origin}${path}` : '';
    const meta = [m.artist, m.title].filter(Boolean).join(' — ') || 'Sem metadados';
    const kick = isAdmin
      ? `<button type="button" class="btn btn-outline btn-sm stream-kick" data-mount="${escapeHtml(mount)}">Kick</button>`
      : '';
    return `
      <div class="stream-mount-row">
        <div>
          <div class="stream-mount-name">
            <span class="live-dot"></span>
            ${escapeHtml(mount)}
          </div>
          <div class="stream-mount-meta">${escapeHtml(meta)}</div>
          ${abs ? `<code class="stream-mount-url">${escapeHtml(abs)}</code>` : ''}
        </div>
        <div class="stream-mount-aside">
          <span class="badge badge-success">${escapeHtml(String(m.listeners ?? 0))} ouvintes</span>
          <div class="stream-mount-bit">${escapeHtml(String(m.bitrate || '?'))} kbps</div>
          <div class="stream-mount-actions">
            ${path ? `<button type="button" class="btn btn-primary btn-sm stream-listen" data-src="${escapeHtml(path)}">Ouvir</button>` : ''}
            ${abs ? `<button type="button" class="btn btn-outline btn-sm stream-copy" data-url="${escapeHtml(abs)}">Copiar URL</button>` : ''}
            ${kick}
          </div>
        </div>
      </div>`;
  }).join('');

  mountsEl.querySelectorAll('.stream-listen').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById('stream-player-panel');
      const audio = document.getElementById('stream-preview');
      if (!panel || !audio) return;
      panel.style.display = 'block';
      audio.src = btn.dataset.src;
      audio.play().catch(() => toast('Clica em play no leitor', 'warning'));
    });
  });
  mountsEl.querySelectorAll('.stream-copy').forEach((btn) => {
    btn.addEventListener('click', () => copyText(btn.dataset.url));
  });
  mountsEl.querySelectorAll('.stream-kick').forEach((btn) => {
    btn.addEventListener('click', () => kickMount(btn.dataset.mount));
  });
}

async function loadStatus() {
  const mountsEl = document.getElementById('stream-mounts');
  const lsEl = document.getElementById('stream-liquidsoap');
  if (!mountsEl) return;

  try {
    const status = await api('/stream/status');
    const mounts = status?.mounts || [];
    const ice = status?.icecast || {};
    const autodj = Boolean(status?.autodjAvailable);

    const pill = document.getElementById('stream-icecast-pill');
    if (pill) {
      pill.className = ice.ok ? 'stream-pill is-live' : 'stream-pill is-down';
      pill.textContent = ice.ok ? 'Icecast online' : 'Icecast indisponível';
    }
    const el = (id) => document.getElementById(id);
    if (el('stream-stat-listeners')) el('stream-stat-listeners').textContent = String(status.listeners ?? 0);
    if (el('stream-stat-peak')) el('stream-stat-peak').textContent = String(status.peakListeners ?? 0);
    if (el('stream-stat-mounts')) el('stream-stat-mounts').textContent = String(mounts.length);
    if (el('stream-stat-icecast')) el('stream-stat-icecast').textContent = ice.ok ? 'Online' : 'Offline';
    if (el('stream-stat-host')) {
      el('stream-stat-host').textContent = ice.host
        ? `${ice.host}:${ice.port || 8000}`
        : 'Host público não definido';
    }
    if (el('stream-updated') && status.timestamp) {
      el('stream-updated').textContent = `Actualizado ${new Date(status.timestamp).toLocaleTimeString('pt-PT')}`;
    }

    renderMounts(mounts);
    setAutodjEnabled(autodj);

    if (lsEl) {
      if (autodj) {
        const raw = status.liquidsoap?.status ?? status.liquidsoap;
        lsEl.textContent = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
      } else {
        lsEl.textContent = 'Liquidsoap não está neste servidor — usa o BUTT para emitir.';
      }
    }
  } catch (e) {
    const pill = document.getElementById('stream-icecast-pill');
    if (pill) {
      pill.className = 'stream-pill is-down';
      pill.textContent = 'Erro ao ler estado';
    }
    mountsEl.innerHTML = `<div class="empty-state"><p style="color:var(--danger);">${escapeHtml(e.message || 'erro')}</p></div>`;
    if (lsEl) lsEl.textContent = '—';
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}
