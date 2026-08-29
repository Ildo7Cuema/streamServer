// =============================================================================
// Admin Panel — user & subscription management
// =============================================================================

import { api, apiBlob, toast, confirmDeleteStation, confirmDialog, promptDialog, selectDialog, withButtonLoading } from '../app.js';

let plans = [];
let proofPreviewUrl = null;

export function renderAdmin(container) {
  container.innerHTML = `
    <div class="stats-grid" id="admin-stats">
      <div class="stat-card"><div class="stat-card-label">Utilizadores</div><div class="stat-card-value" id="adm-users">—</div></div>
      <div class="stat-card"><div class="stat-card-label">Assinaturas activas</div><div class="stat-card-value" id="adm-subs">—</div></div>
      <div class="stat-card"><div class="stat-card-label">Comprovativos pendentes</div><div class="stat-card-value" id="adm-proofs">—</div></div>
      <div class="stat-card"><div class="stat-card-label">Estações</div><div class="stat-card-value" id="adm-stations">—</div></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">🧾 Comprovativos de Pagamento</span>
        <button class="btn btn-outline btn-sm" id="btn-refresh-proofs">Atualizar</button>
      </div>
      <div class="panel-body" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Utilizador</th>
              <th>Email</th>
              <th>Plano</th>
              <th>Valor</th>
              <th>Referência</th>
              <th>Data</th>
              <th>Acções</th>
            </tr>
          </thead>
          <tbody id="admin-proofs-tbody">
            <tr><td colspan="7" style="padding:16px;color:var(--text-muted);">A carregar...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header">
        <span class="panel-title">👑 Gestão de Utilizadores</span>
        <button class="btn btn-outline btn-sm" id="btn-refresh-admin">Atualizar</button>
      </div>
      <div class="panel-body" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Utilizador</th>
              <th>Email</th>
              <th>Plano</th>
              <th>Expira</th>
              <th>Estações</th>
              <th>Estado</th>
              <th>Acções</th>
            </tr>
          </thead>
          <tbody id="admin-users-tbody">
            <tr><td colspan="7" style="padding:16px;color:var(--text-muted);">A carregar...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header">
        <span class="panel-title">📻 Gestão de Estações</span>
        <button class="btn btn-outline btn-sm" id="btn-refresh-stations-admin">Atualizar</button>
      </div>
      <div class="panel-body" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Mount</th>
              <th>Proprietário</th>
              <th>Formato</th>
              <th>DJs</th>
              <th>Estado</th>
              <th>Acções</th>
            </tr>
          </thead>
          <tbody id="admin-stations-tbody">
            <tr><td colspan="7" style="padding:16px;color:var(--text-muted);">A carregar...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="proof-preview-modal">
      <div class="login-card proof-preview-card">
        <div class="panel-header" style="margin-bottom:12px;">
          <span class="panel-title">Comprovativo</span>
          <button type="button" class="payment-close" id="btn-close-proof-preview" aria-label="Fechar">&times;</button>
        </div>
        <div id="proof-preview-body" class="proof-preview-body"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-refresh-proofs')?.addEventListener('click', (e) => {
    withButtonLoading(e.currentTarget, loadPaymentProofs, 'A atualizar...');
  });
  document.getElementById('btn-close-proof-preview')?.addEventListener('click', closeProofPreview);
  document.getElementById('proof-preview-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'proof-preview-modal') closeProofPreview();
  });
  document.getElementById('btn-refresh-admin')?.addEventListener('click', (e) => {
    withButtonLoading(e.currentTarget, loadAdmin, 'A atualizar...');
  });
  document.getElementById('btn-refresh-stations-admin')?.addEventListener('click', (e) => {
    withButtonLoading(e.currentTarget, loadAdminStations, 'A atualizar...');
  });
  loadAdmin();
}

async function loadAdmin() {
  try {
    const [overview, users, plansData] = await Promise.all([
      api('/admin/overview'),
      api('/admin/users'),
      api('/subscriptions/plans')
    ]);
    plans = plansData;

    document.getElementById('adm-users').textContent = overview.users?.total ?? 0;
    document.getElementById('adm-subs').textContent = overview.activeSubscriptions ?? 0;
    document.getElementById('adm-proofs').textContent = overview.pendingProofs ?? 0;
    document.getElementById('adm-stations').textContent = overview.stations ?? 0;

    await Promise.all([loadPaymentProofs(), renderUsersTable(users)]);
  } catch (e) {
    toast(e.message || 'Erro admin', 'error');
  }
}

async function renderUsersTable(users) {
    const tbody = document.getElementById('admin-users-tbody');
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text-muted);">Sem utilizadores.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map((u) => {
      const blocked = u.account_status === 'blocked' || !u.is_active;
      const badge = blocked ? 'badge-warning' : (u.sub_status === 'active' ? 'badge-success' : 'badge-warning');
      const label = blocked ? 'bloqueado' : (u.sub_status === 'active' ? 'activo' : 'sem plano');
      const expires = u.sub_expires ? new Date(u.sub_expires).toLocaleDateString('pt-PT') : '—';
      return `
        <tr>
          <td style="font-weight:700;">${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.plan_name || '—')}</td>
          <td>${expires}</td>
          <td>${u.station_count || 0}</td>
          <td><span class="badge ${badge}">${label}</span></td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              ${!blocked ? `<button class="btn btn-outline btn-sm btn-grant" data-id="${u.id}">+ Plano</button>` : ''}
              ${blocked
                ? `<button class="btn btn-outline btn-sm btn-unblock" data-id="${u.id}">Desbloquear</button>`
                : `<button class="btn btn-outline btn-sm btn-block" data-id="${u.id}">Bloquear</button>`}
              <button class="btn btn-outline btn-sm btn-revoke" data-id="${u.id}">Revogar</button>
              <button class="btn btn-outline btn-sm btn-delete" data-id="${u.id}" style="color:var(--danger);">Remover</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-block').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => blockUser(b.dataset.id), 'A bloquear...'));
    });
    tbody.querySelectorAll('.btn-unblock').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => unblockUser(b.dataset.id), 'A desbloquear...'));
    });
    tbody.querySelectorAll('.btn-grant').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => grantPlan(b.dataset.id), 'A conceder...'));
    });
    tbody.querySelectorAll('.btn-revoke').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => revokeSub(b.dataset.id), 'A revogar...'));
    });
    tbody.querySelectorAll('.btn-delete').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => deleteUser(b.dataset.id), 'A remover...'));
    });

    await loadAdminStations();
}

async function loadPaymentProofs() {
  const tbody = document.getElementById('admin-proofs-tbody');
  if (!tbody) return;

  try {
    const proofs = await api('/admin/payment-proofs?status=pending');
    if (!proofs.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text-muted);">Sem comprovativos pendentes.</td></tr>`;
      return;
    }

    tbody.innerHTML = proofs.map((p) => `
      <tr>
        <td style="font-weight:700;">${escapeHtml(p.username)}</td>
        <td>${escapeHtml(p.email)}</td>
        <td>${escapeHtml(p.plan_name || '—')}</td>
        <td>${escapeHtml(p.amountFormatted || '—')}</td>
        <td>${escapeHtml(p.transfer_reference || '—')}</td>
        <td>${new Date(p.created_at).toLocaleString('pt-PT')}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm btn-view-proof" data-id="${p.id}" data-mime="${escapeHtml(p.mime_type || '')}">Ver</button>
            <button class="btn btn-primary btn-sm btn-approve-proof" data-id="${p.id}">Aprovar</button>
            <button class="btn btn-outline btn-sm btn-reject-proof" data-id="${p.id}" style="color:var(--danger);">Rejeitar</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-view-proof').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => viewProof(b.dataset.id, b.dataset.mime), 'A carregar...'));
    });
    tbody.querySelectorAll('.btn-approve-proof').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => approveProof(b.dataset.id), 'A aprovar...'));
    });
    tbody.querySelectorAll('.btn-reject-proof').forEach((b) => {
      b.addEventListener('click', () => withButtonLoading(b, () => rejectProof(b.dataset.id), 'A rejeitar...'));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--danger);">${escapeHtml(e.message || 'Erro')}</td></tr>`;
  }
}

async function viewProof(id, mimeType) {
  try {
    const blob = await apiBlob(`/admin/payment-proofs/${id}/file`);
    closeProofPreview();
    proofPreviewUrl = URL.createObjectURL(blob);
    const body = document.getElementById('proof-preview-body');
    const modal = document.getElementById('proof-preview-modal');
    if (!body || !modal) return;

    if (mimeType === 'application/pdf') {
      body.innerHTML = `<iframe class="proof-preview-frame" src="${proofPreviewUrl}" title="Comprovativo PDF"></iframe>`;
    } else {
      body.innerHTML = `<img class="proof-preview-image" src="${proofPreviewUrl}" alt="Comprovativo de pagamento">`;
    }
    modal.classList.add('active');
  } catch (e) {
    toast(e.message || 'Erro ao carregar comprovativo', 'error');
  }
}

function closeProofPreview() {
  document.getElementById('proof-preview-modal')?.classList.remove('active');
  const body = document.getElementById('proof-preview-body');
  if (body) body.innerHTML = '';
  if (proofPreviewUrl) {
    URL.revokeObjectURL(proofPreviewUrl);
    proofPreviewUrl = null;
  }
}

async function approveProof(id) {
  const ok = await confirmDialog({
    title: 'Aprovar comprovativo',
    message: 'Aprovar este comprovativo e activar a assinatura do utilizador?',
    detail: 'A conta ficará activa de imediato após aprovação.',
    confirmText: 'Aprovar',
    variant: 'success',
    icon: '✅'
  });
  if (!ok) return;
  try {
    await api(`/admin/payment-proofs/${id}/approve`, { method: 'POST' });
    toast('Comprovativo aprovado. Assinatura activada!', 'success');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function rejectProof(id) {
  const reason = await promptDialog({
    title: 'Rejeitar comprovativo',
    message: 'Indica o motivo da rejeição (opcional).',
    placeholder: 'Ex: Comprovativo ilegível ou valor incorrecto',
    defaultValue: '',
    confirmText: 'Rejeitar',
    icon: '❌'
  });
  if (reason === null) return;
  try {
    await api(`/admin/payment-proofs/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Comprovativo inválido' })
    });
    toast('Comprovativo rejeitado', 'warning');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadAdminStations() {
  const tbody = document.getElementById('admin-stations-tbody');
  if (!tbody) return;

  try {
    let stations;
    try {
      stations = await api('/admin/stations');
    } catch (e) {
      if (e.status !== 404) throw e;
      stations = await api('/stations');
    }
    if (!stations.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text-muted);">Sem estações.</td></tr>`;
      return;
    }

    tbody.innerHTML = stations.map((s) => {
      const badge = s.is_active ? 'badge-success' : 'badge-warning';
      const label = s.is_active ? 'activa' : 'inactiva';
      return `
        <tr>
          <td style="font-weight:700;">${escapeHtml(s.name)}</td>
          <td><code>${escapeHtml(s.mountpoint || '/live')}</code></td>
          <td>${escapeHtml(s.owner_username || '—')}</td>
          <td>${escapeHtml((s.format || 'mp3').toUpperCase())} ${escapeHtml(String(s.bitrate || 128))}k</td>
          <td>${s.dj_count || 0}</td>
          <td><span class="badge ${badge}">${label}</span></td>
          <td>
            <button class="btn btn-outline btn-sm btn-delete-station" data-id="${s.id}" style="color:var(--danger);">Remover</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-delete-station').forEach((b) => {
      b.addEventListener('click', () => {
        const name = b.closest('tr')?.querySelector('td')?.textContent?.trim() || 'esta estação';
        withButtonLoading(b, () => deleteStation(b.dataset.id, name), 'A remover...');
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--danger);">${escapeHtml(e.message || 'Erro')}</td></tr>`;
  }
}

async function blockUser(id) {
  const reason = await promptDialog({
    title: 'Bloquear utilizador',
    message: 'Indica o motivo do bloqueio (opcional).',
    placeholder: 'Ex: Sem assinatura activa',
    defaultValue: 'Sem assinatura activa',
    confirmText: 'Bloquear',
    icon: '🚫'
  });
  if (reason === null) return;
  try {
    await api(`/admin/users/${id}/block`, { method: 'POST', body: JSON.stringify({ reason: reason || 'Sem assinatura activa' }) });
    toast('Utilizador bloqueado', 'warning');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function unblockUser(id) {
  try {
    await api(`/admin/users/${id}/unblock`, { method: 'POST' });
    toast('Utilizador desbloqueado', 'success');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function grantPlan(userId) {
  if (!plans.length) return;
  const planId = await selectDialog({
    title: 'Conceder plano',
    message: 'Escolhe o plano a activar para este utilizador.',
    icon: '💳',
    options: plans.map((p) => ({
      value: p.id,
      label: p.name,
      detail: p.priceFormatted
    }))
  });
  if (!planId) return;
  try {
    await api(`/admin/users/${userId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId })
    });
    toast('Assinatura concedida!', 'success');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function revokeSub(id) {
  const ok = await confirmDialog({
    title: 'Revogar assinatura',
    message: 'Revogar a assinatura deste utilizador?',
    detail: 'O acesso às funcionalidades pagas será removido.',
    confirmText: 'Revogar',
    danger: true,
    icon: '⚠️'
  });
  if (!ok) return;
  try {
    await api(`/admin/users/${id}/subscription`, { method: 'DELETE' });
    toast('Assinatura revogada', 'warning');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteUser(id) {
  const ok = await confirmDialog({
    title: 'Remover utilizador',
    message: 'Remover este utilizador permanentemente?',
    detail: 'Esta acção não pode ser desfeita. Todas as estações e dados associados serão apagados.',
    confirmText: 'Remover',
    danger: true,
    icon: '🗑️'
  });
  if (!ok) return;
  try {
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    toast('Utilizador removido', 'warning');
    loadAdmin();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteStation(id, name) {
  const ok = await confirmDeleteStation(
    name,
    'Playlists e DJs associados serão apagados.'
  );
  if (!ok) return;
  try {
    await api(`/stations/${id}`, { method: 'DELETE' });
    toast('Estação removida', 'warning');
    loadAdminStations();
    const overview = await api('/admin/overview');
    document.getElementById('adm-stations').textContent = overview.stations ?? 0;
    document.getElementById('adm-proofs').textContent = overview.pendingProofs ?? 0;
  } catch (e) { toast(e.message, 'error'); }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
