// =============================================================================
// Media Library Page
// =============================================================================

import { api, apiUpload, toast, withButtonLoading, confirmDialog, getCurrentUser } from '../app.js';

const COUNTRIES = [
  { code: 'AO', name: 'Angola', flag: '🇦🇴' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'ES', name: 'Espanha', flag: '🇪🇸' },
  { code: 'ZA', name: 'África do Sul', flag: '🇿🇦' },
  { code: 'MZ', name: 'Moçambique', flag: '🇲🇿' },
  { code: 'CV', name: 'Cabo Verde', flag: '🇨🇻' }
];

const TYPE_LABELS = {
  music: 'Música', jingle: 'Jingle', ad: 'Anúncio', show: 'Programa', other: 'Outro'
};

let activeDiscoverCountry = '';
let currentAudio = null;
let canManageMedia = false;
let mediaSearchTimer = null;
let discoverSearchTimer = null;
let mediaLoadSeq = 0;
let discoverLoadSeq = 0;

let libraryCache = [];

function foldClient(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function filterLibrary(files, { search, country, type } = {}) {
  const tokens = foldClient(search).split(/\s+/).filter(Boolean);
  return files.filter((f) => {
    if (country && String(f.country || '').toUpperCase() !== String(country).toUpperCase()) return false;
    if (type && f.type !== type) return false;
    if (tokens.length === 0) return true;
    const hay = foldClient([f.title, f.artist, f.album, f.original_name, f.filename, f.genre].join(' '));
    return tokens.every((t) => hay.includes(t));
  });
}

function getMediaFilters() {
  return {
    search: document.getElementById('media-search')?.value || '',
    country: document.getElementById('media-filter-country')?.value || '',
    type: document.getElementById('media-filter-type')?.value || ''
  };
}

function scheduleMediaSearch() {
  clearTimeout(mediaSearchTimer);
  mediaSearchTimer = setTimeout(() => loadMedia(getMediaFilters()), 280);
}

function scheduleDiscoverSearch() {
  clearTimeout(discoverSearchTimer);
  discoverSearchTimer = setTimeout(() => {
    const q = document.getElementById('discover-search')?.value?.trim() || '';
    if (q.length === 1) return;
    runDiscover();
  }, 400);
}

export function renderMedia(container) {
  const countryOptions = COUNTRIES.map((c) => `<option value="${c.code}">${c.flag} ${c.name}</option>`).join('');

  container.innerHTML = `
    <div class="stats-grid" id="media-stats">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Total de Faixas</span>
          <div class="stat-card-icon purple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="media-stat-total">0</div>
        <div class="stat-card-sub">na sua biblioteca</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Duração Total</span>
          <div class="stat-card-icon blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="media-stat-duration">--</div>
        <div class="stat-card-sub">nesta vista</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Espaço Usado</span>
          <div class="stat-card-icon green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="media-stat-size">--</div>
        <div class="stat-card-sub">nesta vista</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Países na Biblioteca</span>
          <div class="stat-card-icon orange">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
        </div>
        <div class="stat-card-value" id="media-stat-countries">0</div>
        <div class="stat-card-sub">identificados nesta vista</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">🎵 Biblioteca Multimédia</span>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-outline btn-sm" id="btn-media-refresh">Atualizar</button>
          <button class="btn btn-primary btn-sm" id="btn-media-upload" style="display:none;">+ Adicionar Música</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="media-toolbar">
          <input id="media-search" type="search" autocomplete="off" spellcheck="false"
            placeholder="🔎 Filtrar por título, artista, álbum ou ficheiro..." />
          <select id="media-filter-country" aria-label="Filtrar por país">
            <option value="">🌍 Todos os países</option>
            ${countryOptions}
          </select>
          <select id="media-filter-type" aria-label="Filtrar por tipo">
            <option value="">Todos os tipos</option>
            ${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="btn-media-search">Pesquisar</button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Artista</th>
              <th>País</th>
              <th>Tipo</th>
              <th>Duração</th>
              <th>Criado</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="media-tbody">
            <tr><td colspan="7" style="color:var(--text-muted);padding:16px;">A carregar...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel discover-panel">
      <div class="panel-header">
        <span class="panel-title">🌍 Descobrir Música por País</span>
      </div>
      <div class="panel-body">
        <p style="color:var(--text-muted);margin-bottom:14px;font-size:0.88rem;">
          Pesquise artistas e faixas de Angola, Brasil, Portugal, Estados Unidos, Espanha, África do Sul,
          Moçambique e Cabo Verde. Ouça uma pré-visualização de 30s e depois use
          <strong>"Adicionar à Biblioteca"</strong> para carregar o ficheiro de áudio já com o país e tipo preenchidos.
        </p>
        <div class="country-chips" id="country-chips">
          <button type="button" class="country-chip" data-code="">🎧 Livre</button>
          ${COUNTRIES.map((c) => `<button type="button" class="country-chip" data-code="${c.code}">${c.flag} ${c.name}</button>`).join('')}
        </div>
        <div class="media-toolbar" style="margin-top:14px;">
          <input id="discover-search" type="search" autocomplete="off" spellcheck="false"
            placeholder="Nome do artista ou título (opcional)..." />
          <button class="btn btn-primary btn-sm" id="btn-discover-search">Pesquisar</button>
        </div>
        <div class="discover-grid" id="discover-grid">
          <p style="color:var(--text-muted);padding:8px 2px;">Escolha um país acima ou pesquise por um artista.</p>
        </div>
      </div>
    </div>

    <!-- Upload Modal -->
    <div class="modal-overlay" id="media-upload-modal">
      <div class="login-card" style="max-width:480px;">
        <h2 style="margin-bottom:4px;">Adicionar Música</h2>
        <p style="color:var(--text-muted);margin-bottom:20px;font-size:0.9rem;">
          Título e artista são detetados automaticamente do ficheiro (ID3), mas pode substituir abaixo.
        </p>
        <form id="media-upload-form">
          <div class="form-group">
            <label for="mu-files">Ficheiro(s) de áudio *</label>
            <input type="file" id="mu-files" accept=".mp3,.ogg,.flac,.wav,.aac,.m4a,.opus" multiple required>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label for="mu-title">Título (opcional)</label>
              <input type="text" id="mu-title" placeholder="Detetado automaticamente">
            </div>
            <div class="form-group">
              <label for="mu-artist">Artista (opcional)</label>
              <input type="text" id="mu-artist" placeholder="Detetado automaticamente">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label for="mu-type">Tipo</label>
              <select id="mu-type">
                ${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="mu-country">País do artista</label>
              <select id="mu-country">
                <option value="">Não especificado</option>
                ${countryOptions}
              </select>
            </div>
          </div>
          <p class="login-error" id="media-upload-error"></p>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="submit" class="btn btn-primary" style="flex:1;">Carregar</button>
            <button type="button" class="btn btn-outline" id="btn-cancel-upload">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Modal -->
    <div class="modal-overlay" id="media-edit-modal">
      <div class="login-card" style="max-width:480px;">
        <h2 style="margin-bottom:16px;">Editar Faixa</h2>
        <form id="media-edit-form">
          <input type="hidden" id="me-id">
          <div class="form-group">
            <label for="me-title">Título</label>
            <input type="text" id="me-title" required>
          </div>
          <div class="form-group">
            <label for="me-artist">Artista</label>
            <input type="text" id="me-artist">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label for="me-type">Tipo</label>
              <select id="me-type">
                ${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="me-country">País do artista</label>
              <select id="me-country">
                <option value="">Não especificado</option>
                ${countryOptions}
              </select>
            </div>
          </div>
          <p class="login-error" id="media-edit-error"></p>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="submit" class="btn btn-primary" style="flex:1;">Guardar</button>
            <button type="button" class="btn btn-outline" id="btn-cancel-edit">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const run = (btn) => withButtonLoading(
    btn || document.getElementById('btn-media-search'),
    () => loadMedia(getMediaFilters()),
    'A pesquisar...'
  );

  document.getElementById('btn-media-refresh')?.addEventListener('click', (e) => {
    document.getElementById('media-search').value = '';
    document.getElementById('media-filter-country').value = '';
    document.getElementById('media-filter-type').value = '';
    withButtonLoading(e.currentTarget, () => loadMedia({}), 'A atualizar...');
  });
  document.getElementById('btn-media-search')?.addEventListener('click', (e) => run(e.currentTarget));
  document.getElementById('media-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });
  document.getElementById('media-search')?.addEventListener('input', () => scheduleMediaSearch());
  document.getElementById('media-filter-country')?.addEventListener('change', () => run());
  document.getElementById('media-filter-type')?.addEventListener('change', () => run());

  document.getElementById('btn-media-upload')?.addEventListener('click', () => openUploadModal());
  document.getElementById('btn-cancel-upload')?.addEventListener('click', closeUploadModal);
  document.getElementById('media-upload-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'media-upload-modal') closeUploadModal();
  });
  document.getElementById('media-upload-form')?.addEventListener('submit', handleUpload);

  document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditModal);
  document.getElementById('media-edit-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'media-edit-modal') closeEditModal();
  });
  document.getElementById('media-edit-form')?.addEventListener('submit', handleEditSubmit);

  document.getElementById('country-chips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.country-chip');
    if (!btn) return;
    activeDiscoverCountry = btn.dataset.code || '';
    document.querySelectorAll('.country-chip').forEach((c) => c.classList.toggle('active', c === btn));
    runDiscover();
  });
  document.getElementById('btn-discover-search')?.addEventListener('click', (e) => {
    withButtonLoading(e.currentTarget, runDiscover, 'A pesquisar...');
  });
  document.getElementById('discover-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runDiscover();
    }
  });
  document.getElementById('discover-search')?.addEventListener('input', () => scheduleDiscoverSearch());

  const role = getCurrentUser()?.role;
  const canUpload = ['admin', 'manager', 'dj'].includes(role);
  canManageMedia = ['admin', 'manager'].includes(role);
  const uploadBtn = document.getElementById('btn-media-upload');
  if (uploadBtn) uploadBtn.style.display = canUpload ? 'inline-flex' : 'none';

  loadMedia({});
}

// -----------------------------------------------------------------------------
// Local library
// -----------------------------------------------------------------------------

async function loadMedia(filters = {}) {
  const tbody = document.getElementById('media-tbody');
  if (!tbody) return;
  const seq = ++mediaLoadSeq;
  const { search, country, type } = filters;
  const hasFilters = Boolean(String(search || '').trim() || country || type);

  if (libraryCache.length && hasFilters) {
    const local = filterLibrary(libraryCache, filters);
    if (local.length) paintMediaTable(local, { total: local.length });
  }

  try {
    const qs = new URLSearchParams();
    qs.set('limit', '200');
    if (search && String(search).trim()) qs.set('search', String(search).trim());
    if (country) qs.set('country', country);
    if (type) qs.set('type', type);

    const res = await api(`/media?${qs.toString()}`);
    if (seq !== mediaLoadSeq) return;
    let files = res?.files || [];

    if (!hasFilters) {
      libraryCache = files;
    } else if (files.length === 0 && libraryCache.length) {
      files = filterLibrary(libraryCache, filters);
    } else if (files.length) {
      const byId = new Map(libraryCache.map((f) => [f.id, f]));
      files.forEach((f) => byId.set(f.id, f));
      libraryCache = Array.from(byId.values());
    }

    if (files.length === 0) {
      const q = String(search || '').trim();
      const hint = q
        ? `Sem resultados para “${escapeHtml(q)}”. Tente outro termo ou limpe os filtros.`
        : 'Sem resultados.';
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);padding:16px;">${hint}</td></tr>`;
      updateStats({ total: 0 }, []);
      return;
    }

    paintMediaTable(files, res);
  } catch (e) {
    if (seq !== mediaLoadSeq) return;
    const fallback = hasFilters ? filterLibrary(libraryCache, filters) : libraryCache;
    if (fallback.length) {
      paintMediaTable(fallback, { total: fallback.length });
      return;
    }
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);padding:16px;">Falha: ${escapeHtml(e.message || 'erro')}</td></tr>`;
    toast(e.message || 'Falha ao carregar media', 'error');
  }
}

function paintMediaTable(files, res) {
  const tbody = document.getElementById('media-tbody');
  if (!tbody) return;

  updateStats(res, files);

  tbody.innerHTML = files.map((f) => {
    const c = COUNTRIES.find((x) => x.code === f.country);
    return `
      <tr>
        <td style="font-weight:700;">${escapeHtml(f.title || f.original_name)}</td>
        <td>${escapeHtml(f.artist || '')}</td>
        <td>${c ? `<span class="badge badge-info">${c.flag} ${c.name}</span>` : '<span style="color:var(--text-muted);">--</span>'}</td>
        <td><span class="badge badge-info">${escapeHtml(TYPE_LABELS[f.type] || f.type || 'música')}</span></td>
        <td>${formatDuration(f.duration)}</td>
        <td>${formatDate(f.created_at)}</td>
        <td>
          ${canManageMedia ? `
          <div style="display:flex;gap:4px;">
            <button class="btn btn-outline btn-sm btn-edit-media" data-id="${f.id}" title="Editar">✏️</button>
            <button class="btn btn-outline btn-sm btn-delete-media" data-id="${f.id}" data-name="${escapeHtml(f.title || f.original_name)}" title="Eliminar" style="color:var(--danger);">🗑️</button>
          </div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-edit-media').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(files.find((f) => f.id === btn.dataset.id)));
  });
  tbody.querySelectorAll('.btn-delete-media').forEach((btn) => {
    btn.addEventListener('click', () => {
      withButtonLoading(btn, () => deleteMedia(btn.dataset.id, btn.dataset.name), 'A eliminar...');
    });
  });
}

function updateStats(res, files) {
  const totalEl = document.getElementById('media-stat-total');
  const durEl = document.getElementById('media-stat-duration');
  const sizeEl = document.getElementById('media-stat-size');
  const countriesEl = document.getElementById('media-stat-countries');
  if (totalEl) totalEl.textContent = res?.total ?? files.length;

  const totalSeconds = files.reduce((sum, f) => sum + (Number(f.duration) || 0), 0);
  if (durEl) durEl.textContent = formatDurationLong(totalSeconds);

  const totalBytes = files.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0);
  if (sizeEl) sizeEl.textContent = formatBytes(totalBytes);

  const distinctCountries = new Set(files.map((f) => f.country).filter(Boolean));
  if (countriesEl) countriesEl.textContent = distinctCountries.size;
}

async function deleteMedia(id, name) {
  const ok = await confirmDialog({
    title: 'Eliminar faixa',
    message: `Eliminar <span class="confirm-highlight">"${escapeHtml(name || 'esta faixa')}"</span> permanentemente?`,
    confirmText: 'Eliminar',
    danger: true
  });
  if (!ok) return;
  try {
    await api(`/media/${id}`, { method: 'DELETE' });
    toast('Faixa eliminada', 'warning');
    libraryCache = libraryCache.filter((f) => f.id !== id);
    await loadMedia(getMediaFilters());
  } catch (e) {
    toast(e.message || 'Falha ao eliminar', 'error');
  }
}

// -----------------------------------------------------------------------------
// Upload modal
// -----------------------------------------------------------------------------

function openUploadModal(prefill = {}) {
  document.getElementById('media-upload-form')?.reset();
  document.getElementById('media-upload-error').textContent = '';
  if (prefill.title) document.getElementById('mu-title').value = prefill.title;
  if (prefill.artist) document.getElementById('mu-artist').value = prefill.artist;
  if (prefill.country) document.getElementById('mu-country').value = prefill.country;
  document.getElementById('media-upload-modal')?.classList.add('active');
}

function closeUploadModal() {
  document.getElementById('media-upload-modal')?.classList.remove('active');
}

async function handleUpload(e) {
  e.preventDefault();
  const errEl = document.getElementById('media-upload-error');
  const submitBtn = e.submitter || e.target.querySelector('[type="submit"]');
  errEl.textContent = '';

  const filesInput = document.getElementById('mu-files');
  if (!filesInput.files || filesInput.files.length === 0) {
    errEl.textContent = 'Escolhe pelo menos um ficheiro';
    return;
  }

  await withButtonLoading(submitBtn, async () => {
    try {
      const formData = new FormData();
      Array.from(filesInput.files).forEach((f) => formData.append('files', f));
      formData.append('type', document.getElementById('mu-type').value);
      const title = document.getElementById('mu-title').value.trim();
      const artist = document.getElementById('mu-artist').value.trim();
      const country = document.getElementById('mu-country').value;
      if (title) formData.append('title', title);
      if (artist) formData.append('artist', artist);
      if (country) formData.append('country', country);

      const result = await apiUpload('/media/upload', formData);
      closeUploadModal();
      toast(`${result.uploaded || 1} ficheiro(s) adicionados à biblioteca!`, 'success');
      libraryCache = [];
      await loadMedia(getMediaFilters());
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao carregar ficheiro';
    }
  }, 'A carregar...');
}

// -----------------------------------------------------------------------------
// Edit modal
// -----------------------------------------------------------------------------

function openEditModal(file) {
  if (!file) return;
  document.getElementById('media-edit-error').textContent = '';
  document.getElementById('me-id').value = file.id;
  document.getElementById('me-title').value = file.title || '';
  document.getElementById('me-artist').value = file.artist || '';
  document.getElementById('me-type').value = file.type || 'music';
  document.getElementById('me-country').value = file.country || '';
  document.getElementById('media-edit-modal')?.classList.add('active');
}

function closeEditModal() {
  document.getElementById('media-edit-modal')?.classList.remove('active');
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('media-edit-error');
  const submitBtn = e.submitter || e.target.querySelector('[type="submit"]');
  errEl.textContent = '';

  const id = document.getElementById('me-id').value;
  const body = {
    title: document.getElementById('me-title').value.trim(),
    artist: document.getElementById('me-artist').value.trim(),
    type: document.getElementById('me-type').value,
    country: document.getElementById('me-country').value
  };

  await withButtonLoading(submitBtn, async () => {
    try {
      await api(`/media/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      closeEditModal();
      toast('Faixa atualizada', 'success');
      libraryCache = [];
      await loadMedia(getMediaFilters());
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao guardar';
    }
  }, 'A guardar...');
}

// -----------------------------------------------------------------------------
// Discover (external catalog search)
// -----------------------------------------------------------------------------

async function runDiscover() {
  const grid = document.getElementById('discover-grid');
  if (!grid) return;
  const seq = ++discoverLoadSeq;

  const q = document.getElementById('discover-search')?.value?.trim() || '';
  if (!q && !activeDiscoverCountry) {
    grid.innerHTML = `<p style="color:var(--text-muted);padding:8px 2px;">Escolha um país acima ou pesquise por um artista.</p>`;
    return;
  }

  grid.innerHTML = `<p style="color:var(--text-muted);padding:8px 2px;">A pesquisar...</p>`;

  try {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (activeDiscoverCountry) qs.set('country', activeDiscoverCountry);

    const res = await api(`/media/discover?${qs.toString()}`);
    if (seq !== discoverLoadSeq) return;
    const results = res?.results || [];

    if (results.length === 0) {
      const hint = q
        ? `Sem resultados para “${escapeHtml(q)}”. Tente só o nome do artista ou o título.`
        : 'Sem resultados para esta pesquisa.';
      grid.innerHTML = `<p style="color:var(--text-muted);padding:8px 2px;">${hint}</p>`;
      return;
    }

    grid.innerHTML = results.map((t, i) => `
      <div class="discover-card">
        <img src="${escapeHtml(t.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="discover-card-body">
          <div class="discover-card-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>
          <div class="discover-card-artist" title="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</div>
          <div class="discover-card-actions">
            ${t.preview ? `<button class="btn btn-outline btn-sm btn-preview" data-preview="${escapeHtml(t.preview)}" data-idx="${i}">▶ Ouvir</button>` : ''}
            <button class="btn btn-primary btn-sm btn-add-discovered" data-idx="${i}">+ Adicionar</button>
          </div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.btn-preview').forEach((btn) => {
      btn.addEventListener('click', () => togglePreview(btn));
    });
    grid.querySelectorAll('.btn-add-discovered').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = results[Number(btn.dataset.idx)];
        if (!t) return;
        openUploadModal({ title: t.title, artist: t.artist, country: activeDiscoverCountry });
      });
    });
  } catch (e) {
    if (seq !== discoverLoadSeq) return;
    grid.innerHTML = `<p style="color:var(--danger);padding:8px 2px;">Falha: ${escapeHtml(e.message || 'erro')}</p>`;
  }
}

function togglePreview(btn) {
  const url = btn.dataset.preview;
  if (currentAudio && currentAudio._btn === btn && !currentAudio.paused) {
    currentAudio.pause();
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    if (currentAudio._btn) currentAudio._btn.textContent = '▶ Ouvir';
  }
  const audio = new Audio(url);
  audio._btn = btn;
  audio.play().catch(() => toast('Não foi possível reproduzir a pré-visualização', 'error'));
  btn.textContent = '⏸ A tocar...';
  audio.addEventListener('ended', () => { btn.textContent = '▶ Ouvir'; });
  audio.addEventListener('pause', () => { btn.textContent = '▶ Ouvir'; });
  currentAudio = audio;
}

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

function formatDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '--';
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function formatDurationLong(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function formatBytes(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '--';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

function formatDate(v) {
  if (!v) return '--';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('pt', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
