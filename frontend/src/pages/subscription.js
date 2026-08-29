// =============================================================================
// Subscription Plans Page
// =============================================================================

import { api, apiUpload, toast, getSubscription, setSubscription, getCurrentUser, withButtonLoading } from '../app.js';

const MULTICAIXA_EXPRESS_PHONE = normalizeExpressPhone(
  import.meta.env.VITE_PAYMENT_EXPRESS_PHONE || '921923232'
);
const WHATSAPP_PHONE = normalizeWhatsAppPhone(
  import.meta.env.VITE_PAYMENT_WHATSAPP_PHONE
  || import.meta.env.VITE_PAYMENT_EXPRESS_PHONE
  || '921923232'
);

let pendingPaymentContext = null;

function normalizeExpressPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const local = digits.startsWith('244') ? digits.slice(3) : digits;
  return local.length === 9 ? local : '921923232';
}

function normalizeWhatsAppPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.startsWith('244') ? digits : `244${normalizeExpressPhone(raw)}`;
}

function buildWhatsAppUrl({ planName, amount, reference, username, email }) {
  const lines = [
    'Olá! Envio comprovativo de assinatura StreamServer.',
    '',
    `Plano: ${planName || '—'}`,
    amount ? `Valor: ${amount}` : null,
    username ? `Utilizador: ${username}` : null,
    email ? `Email: ${email}` : null,
    reference ? `Referência: ${reference}` : null,
    '',
    'Segue o comprovativo em anexo.'
  ].filter(Boolean);
  return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(lines.join('\n'))}`;
}

function openWhatsAppProof(context = {}) {
  const url = buildWhatsAppUrl(context);
  window.open(url, '_blank', 'noopener,noreferrer');
}

function generatePaymentReference(subscriptionId) {
  const compact = String(subscriptionId ?? '').replace(/-/g, '').toUpperCase();
  return compact ? `SS-${compact.slice(0, 8)}` : '';
}

function resolvePaymentReference(subscription = {}, payment = {}) {
  return subscription.paymentReference
    || payment.paymentReference
    || generatePaymentReference(subscription.id);
}

export function renderSubscription(container) {
  container.innerHTML = `
    <div id="sub-status-banner"></div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">💳 Planos de Assinatura</span>
      </div>
      <div class="panel-body">
        <p style="color:var(--text-muted);margin-bottom:20px;">
          Escolhe um plano para criar a tua estação de rádio e transmitir ao vivo com o BUTT.
          Pagamentos em <strong>Kwanza (AOA)</strong> via <strong>Multicaixa Express</strong>.
        </p>
        <div id="plans-grid" class="plans-grid">
          <p style="color:var(--text-muted);">A carregar planos...</p>
        </div>
      </div>
    </div>

    <!-- Multicaixa Express Payment Modal -->
    <div class="modal-overlay" id="payment-modal">
      <div class="login-card payment-card">
        <div class="payment-header">
          <img src="/multicaixa-express.png" alt="Multicaixa Express" class="payment-logo">
          <button type="button" class="payment-close" id="btn-close-payment" aria-label="Fechar">&times;</button>
        </div>

        <div class="payment-plan-info" id="payment-plan-info"></div>

        <div class="payment-country">
          <span class="payment-flag">🇦🇴</span> Pagamento em Angola — Kwanza (AOA)
        </div>

        <ol class="payment-steps" id="payment-steps"></ol>

        <div class="cred-section payment-detail">
          <div class="cred-section-header">
            <span>📱 Número Multicaixa Express</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-copy-phone">Copiar</button>
          </div>
          <code class="cred-value payment-phone" id="payment-phone"></code>
        </div>

        <div class="cred-section payment-detail" id="payment-amount-section">
          <div class="cred-section-header">
            <span>💰 Valor a transferir</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-copy-amount">Copiar</button>
          </div>
          <code class="cred-value payment-amount" id="payment-amount"></code>
        </div>

        <p class="payment-note" id="payment-note"></p>

        <div class="cred-section payment-detail">
          <div class="cred-section-header">
            <span>💬 WhatsApp — enviar comprovativo</span>
          </div>
          <p class="payment-whatsapp-hint">
            Após o pagamento, envia o comprovativo para
            <strong id="payment-whatsapp-display">+244 921 923 232</strong>
            via WhatsApp.
          </p>
          <button type="button" class="btn btn-whatsapp btn-full" id="btn-whatsapp-proof">
            Enviar comprovativo no WhatsApp
          </button>
        </div>

        <form id="proof-form">
          <div class="form-group">
            <label for="proof-reference">Referência da transferência</label>
            <div class="input-with-copy">
              <input type="text" id="proof-reference" readonly maxlength="100">
              <button type="button" class="btn btn-outline btn-sm" id="btn-copy-reference">Copiar</button>
            </div>
            <small style="color:var(--text-muted);">Preenchida automaticamente — usa esta referência na transferência.</small>
          </div>
          <div class="form-group">
            <label for="proof-file">Comprovativo de pagamento *</label>
            <input type="file" id="proof-file" accept=".jpg,.jpeg,.png,.webp,.pdf" required>
            <small style="color:var(--text-muted);">JPG, PNG ou PDF — máx. 10 MB</small>
          </div>
          <p class="login-error" id="proof-form-error"></p>
          <div class="payment-actions">
            <button type="submit" class="btn btn-primary" id="btn-submit-proof">Enviar e confirmar no WhatsApp</button>
            <button type="button" class="btn btn-outline" id="btn-payment-later">Fechar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('btn-close-payment')?.addEventListener('click', closePaymentModal);
  document.getElementById('btn-payment-later')?.addEventListener('click', closePaymentModal);
  document.getElementById('payment-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'payment-modal') closePaymentModal();
  });
  document.getElementById('proof-form')?.addEventListener('submit', handleProofSubmit);
  document.getElementById('btn-copy-phone')?.addEventListener('click', () => {
    const phone = document.getElementById('payment-phone')?.dataset.copyValue
      || document.getElementById('payment-phone')?.textContent;
    copyText(phone, 'Número copiado!');
  });
  document.getElementById('btn-copy-amount')?.addEventListener('click', () => {
    copyText(document.getElementById('payment-amount')?.textContent, 'Valor copiado!');
  });
  document.getElementById('btn-copy-reference')?.addEventListener('click', () => {
    copyText(document.getElementById('proof-reference')?.value, 'Referência copiada!');
  });
  document.getElementById('btn-whatsapp-proof')?.addEventListener('click', () => {
    openWhatsAppFromModal();
  });

  loadPlans();
}

async function loadPlans() {
  const grid = document.getElementById('plans-grid');
  const banner = document.getElementById('sub-status-banner');
  if (!grid) return;

  try {
    const [plans, status] = await Promise.all([
      api('/subscriptions/plans'),
      api('/subscriptions/me').catch(() => null)
    ]);

    if (status) setSubscription(status);
    renderBanner(banner, status);

    grid.innerHTML = plans.map((p) => `
      <div class="plan-card ${status?.hasAccess && status?.subscription?.plan_id === p.id ? 'plan-active' : ''}">
        <div class="plan-name">${escapeHtml(p.name)}</div>
        <div class="plan-price">${escapeHtml(p.priceFormatted)}</div>
        <div class="plan-interval">${escapeHtml(p.intervalLabel)}</div>
        <p class="plan-desc">${escapeHtml(p.description || '')}</p>
        <ul class="plan-features">
          <li>${p.max_stations} estação(ões)</li>
          <li>Até ${p.max_listeners} ouvintes</li>
          <li>Stream URL + credenciais BUTT</li>
        </ul>
        <button class="btn btn-primary btn-full btn-subscribe" data-plan-id="${p.id}"
          ${status?.hasAccess ? 'disabled' : ''}>
          ${status?.hasAccess ? 'Plano activo' : 'Subscrever'}
        </button>
      </div>
    `).join('');

    grid.querySelectorAll('.btn-subscribe').forEach((btn) => {
      btn.addEventListener('click', () => {
        withButtonLoading(btn, () => subscribe(btn.dataset.planId), 'A processar...');
      });
    });
  } catch (e) {
    grid.innerHTML = `<p style="color:var(--danger);">Erro: ${escapeHtml(e.message)}</p>`;
  }
}

function renderBanner(banner, status) {
  if (!banner || !status) return;

  if (status.isAdmin) {
    banner.innerHTML = `<div class="sub-banner sub-banner-admin">👑 Acesso administrativo completo</div>`;
    return;
  }

  if (status.hasAccess) {
    banner.innerHTML = `<div class="sub-banner sub-banner-active">
      ✅ Plano <strong>${escapeHtml(status.planName)}</strong> activo
      ${status.expiresAt ? `— expira ${new Date(status.expiresAt).toLocaleDateString('pt-PT')}` : ''}
      (${status.stationCount}/${status.maxStations} estações)
    </div>`;
    return;
  }

  if (status.pendingProof) {
    banner.innerHTML = `<div class="sub-banner sub-banner-pending">
      ⏳ Comprovativo em análise — confirma também no WhatsApp (+244 921 923 232) se ainda não o fizeste.
    </div>`;
    return;
  }

  if (status.awaitingPayment) {
    banner.innerHTML = `<div class="sub-banner sub-banner-awaiting">
      💳 Pagamento pendente via Multicaixa Express.
      <button type="button" class="btn btn-outline btn-sm" id="btn-continue-payment" style="margin-left:12px;">
        Continuar pagamento
      </button>
    </div>`;
    document.getElementById('btn-continue-payment')?.addEventListener('click', () => {
      reopenPendingPayment(status);
    });
    return;
  }

  banner.innerHTML = `<div class="sub-banner sub-banner-inactive">
    ⚠️ Sem assinatura activa. Escolhe um plano abaixo para desbloquear o sistema.
  </div>`;
}

async function subscribe(planId) {
  try {
    const result = await api('/subscriptions/subscribe', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId })
    });

    if (result.code === 'AWAITING_PAYMENT_PROOF') {
      openPaymentModal({
        subscription: result.subscription,
        plan: result.plan,
        payment: result.payment
      });
      const status = await api('/subscriptions/me');
      setSubscription(status);
      loadPlans();
      return;
    }

    toast(result.message || 'Assinatura activada!', 'success');
    const status = await api('/subscriptions/me');
    setSubscription(status);
    loadPlans();
  } catch (e) {
    if (e.status === 409 && e.response?.subscription) {
      toast('Já tens um pedido de assinatura pendente.', 'info');
      reopenPendingPayment(getSubscription());
      return;
    }
    toast(e.message || 'Erro na assinatura', 'error');
  }
}

async function reopenPendingPayment(status) {
  if (pendingPaymentContext) {
    openPaymentModal(pendingPaymentContext);
    return;
  }

  const pending = status?.pendingSubscription;
  if (!pending) {
    toast('Nenhum pagamento pendente encontrado.', 'info');
    return;
  }

  try {
    const [plans, paymentInfo] = await Promise.all([
      api('/subscriptions/plans'),
      api('/subscriptions/payment-info')
    ]);
    const plan = plans.find((p) => p.id === pending.plan_id);
    if (!plan) {
      toast('Plano pendente não encontrado.', 'error');
      return;
    }
    openPaymentModal({
      subscription: pending,
      plan,
      payment: {
        ...paymentInfo,
        amountFormatted: plan.priceFormatted,
        paymentReference: pending.paymentReference || generatePaymentReference(pending.id)
      }
    });
  } catch (e) {
    toast(e.message || 'Erro ao carregar dados de pagamento', 'error');
  }
}

function openPaymentModal({ subscription, plan, payment = {} }) {
  const paymentReference = resolvePaymentReference(subscription, payment);
  pendingPaymentContext = { subscription, plan, payment, paymentReference };

  const phone = MULTICAIXA_EXPRESS_PHONE;
  const amount = payment.amountFormatted || plan?.priceFormatted || '';
  const recipient = payment.recipientName || 'StreamServer';

  document.getElementById('payment-plan-info').innerHTML = `
    <strong>${escapeHtml(plan?.name || 'Plano')}</strong>
    <span class="payment-plan-price">${escapeHtml(amount)}</span>
  `;

  const stepsEl = document.getElementById('payment-steps');
  const steps = [
    'Abre a app Multicaixa Express no telemóvel.',
    'Selecciona "Transferir" ou "Pagamento".',
    `Destinatário: ${recipient}`,
    `Número Express: ${phone}`,
    amount ? `Valor exacto: ${amount}` : 'Valor: conforme o plano escolhido.',
    paymentReference ? `Referência: ${paymentReference} (indica na transferência).` : null,
    'Confirma a transferência e guarda o comprovativo.',
    'Envia o comprovativo abaixo — o WhatsApp abrirá automaticamente para confirmar.'
  ].filter(Boolean);
  stepsEl.innerHTML = steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');

  const whatsappDisplay = document.getElementById('payment-whatsapp-display');
  if (whatsappDisplay) {
    const local = WHATSAPP_PHONE.startsWith('244') ? WHATSAPP_PHONE.slice(3) : WHATSAPP_PHONE;
    whatsappDisplay.textContent = `+244 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }

  const phoneEl = document.getElementById('payment-phone');
  if (phoneEl) {
    phoneEl.textContent = phone;
    phoneEl.dataset.copyValue = phone;
  }
  document.getElementById('payment-amount').textContent = amount;
  const referenceInput = document.getElementById('proof-reference');
  if (referenceInput) referenceInput.value = paymentReference;
  document.getElementById('payment-note').textContent = payment.note || '';

  const proofForm = document.getElementById('proof-form');
  const proofSection = proofForm;
  if (getSubscription()?.pendingProof) {
    proofSection.style.display = 'none';
  } else {
    proofSection.style.display = 'block';
    document.getElementById('proof-file').value = '';
    document.getElementById('proof-form-error').textContent = '';
  }

  document.getElementById('payment-modal')?.classList.add('active');
}

function openWhatsAppFromModal() {
  const user = getCurrentUser();
  const ref = document.getElementById('proof-reference')?.value?.trim()
    || pendingPaymentContext?.paymentReference;
  openWhatsAppProof({
    planName: pendingPaymentContext?.plan?.name,
    amount: pendingPaymentContext?.payment?.amountFormatted || pendingPaymentContext?.plan?.priceFormatted,
    reference: ref,
    username: user?.username,
    email: user?.email
  });
}

function closePaymentModal() {
  document.getElementById('payment-modal')?.classList.remove('active');
}

async function handleProofSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('proof-form-error');
  const submitBtn = document.getElementById('btn-submit-proof');
  errEl.textContent = '';

  const fileInput = document.getElementById('proof-file');
  const file = fileInput?.files?.[0];
  if (!file) {
    errEl.textContent = 'Selecciona o comprovativo de pagamento.';
    return;
  }

  const subscriptionId = pendingPaymentContext?.subscription?.id;
  if (!subscriptionId) {
    errEl.textContent = 'Pedido de assinatura não encontrado. Clica em Subscrever novamente.';
    return;
  }

  await withButtonLoading(submitBtn, async () => {
    try {
      const formData = new FormData();
      formData.append('proof', file);
      formData.append('subscription_id', subscriptionId);
      const ref = document.getElementById('proof-reference')?.value?.trim()
        || pendingPaymentContext?.paymentReference
        || generatePaymentReference(subscriptionId);
      formData.append('transfer_reference', ref);

      const result = await apiUpload('/subscriptions/proof', formData);
      toast(result.message || 'Comprovativo enviado!', 'success');

      openWhatsAppProof({
        planName: pendingPaymentContext?.plan?.name || result.proof?.planName,
        amount: pendingPaymentContext?.payment?.amountFormatted
          || pendingPaymentContext?.plan?.priceFormatted
          || result.proof?.amountFormatted,
        reference: ref,
        username: getCurrentUser()?.username,
        email: getCurrentUser()?.email
      });

      pendingPaymentContext = null;
      closePaymentModal();

      const status = await api('/subscriptions/me');
      setSubscription(status);
      loadPlans();
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao enviar comprovativo';
    }
  }, 'A enviar...');
}

function copyText(text, msg) {
  if (!text) return;
  navigator.clipboard.writeText(text.trim())
    .then(() => toast(msg, 'success'))
    .catch(() => toast('Falha ao copiar', 'error'));
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
