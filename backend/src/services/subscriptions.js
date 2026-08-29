// =============================================================================
// Subscription Service
// =============================================================================

const { query } = require('../database/connection');
const logger = require('../utils/logger');

async function expireStaleSubscriptions() {
  await query(
    `UPDATE user_subscriptions SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
}

async function getActiveSubscription(userId) {
  await expireStaleSubscriptions();
  const result = await query(
    `SELECT us.*, sp.name as plan_name, sp.slug as plan_slug, sp.interval_type,
            sp.max_stations, sp.max_listeners, sp.price_cents, sp.currency
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'active'
       AND (us.expires_at IS NULL OR us.expires_at > NOW())
     ORDER BY us.expires_at DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function hasActiveSubscription(userId, role) {
  if (role === 'admin') return true;
  const sub = await getActiveSubscription(userId);
  return !!sub;
}

async function countUserStations(userId) {
  const result = await query(
    'SELECT COUNT(*)::int AS count FROM stations WHERE owner_id = $1',
    [userId]
  );
  return result.rows[0]?.count || 0;
}

async function canCreateStation(userId, role) {
  if (role === 'admin') return { allowed: true };
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    return { allowed: false, reason: 'Assinatura activa necessária para criar estações.' };
  }
  const count = await countUserStations(userId);
  if (count >= sub.max_stations) {
    return {
      allowed: false,
      reason: `Limite de ${sub.max_stations} estação(ões) do plano ${sub.plan_name} atingido.`
    };
  }
  return { allowed: true, subscription: sub };
}

async function activateSubscription({ userId, planId, grantedBy = null, notes = null, stripeIds = {} }) {
  const plan = await query(
    'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
    [planId]
  );
  if (plan.rows.length === 0) throw new Error('Plan not found');

  const p = plan.rows[0];
  const months = p.interval_months;

  await query(
    `UPDATE user_subscriptions SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND status IN ('active', 'pending')`,
    [userId]
  );

  const result = await query(
    `INSERT INTO user_subscriptions
       (user_id, plan_id, status, starts_at, expires_at, granted_by, notes,
        stripe_subscription_id, stripe_customer_id)
     VALUES ($1, $2, 'active', NOW(), NOW() + ($3 || ' months')::INTERVAL, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId, planId, months, grantedBy, notes,
      stripeIds.subscriptionId || null,
      stripeIds.customerId || null
    ]
  );

  await query(
    `UPDATE users SET account_status = 'active', is_active = true, blocked_at = NULL, blocked_reason = NULL
     WHERE id = $1`,
    [userId]
  );

  logger.info(`Subscription activated: user=${userId} plan=${p.slug}`);
  return result.rows[0];
}

async function createPendingSubscription(userId, planId) {
  const existing = await getActiveSubscription(userId);
  if (existing) throw new Error('Já tens uma assinatura activa.');

  const pending = await getPendingSubscription(userId);
  if (pending && pending.plan_id === planId) return pending;

  if (pending) {
    await query(
      `UPDATE user_subscriptions SET plan_id = $1, updated_at = NOW() WHERE id = $2`,
      [planId, pending.id]
    );
    return (await query('SELECT * FROM user_subscriptions WHERE id = $1', [pending.id])).rows[0];
  }

  const result = await query(
    `INSERT INTO user_subscriptions (user_id, plan_id, status)
     VALUES ($1, $2, 'pending') RETURNING *`,
    [userId, planId]
  );
  return result.rows[0];
}

async function getSubscriptionSummary(userId, role) {
  if (role === 'admin') {
    return {
      isAdmin: true,
      hasAccess: true,
      subscription: null,
      message: 'Acesso administrativo completo'
    };
  }

  const sub = await getActiveSubscription(userId);
  const stationCount = await countUserStations(userId);

  const pendingProof = await query(
    `SELECT pp.*, sp.name as plan_name
     FROM payment_proofs pp
     JOIN subscription_plans sp ON pp.plan_id = sp.id
     WHERE pp.user_id = $1 AND pp.status = 'pending'
     ORDER BY pp.created_at DESC LIMIT 1`,
    [userId]
  );

  const pendingSub = await query(
    `SELECT us.*, sp.name as plan_name, sp.price_cents, sp.currency
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'pending'
     ORDER BY us.created_at DESC LIMIT 1`,
    [userId]
  );

  return {
    isAdmin: false,
    hasAccess: !!sub,
    subscription: sub,
    stationCount,
    maxStations: sub?.max_stations || 0,
    expiresAt: sub?.expires_at || null,
    planName: sub?.plan_name || null,
    pendingProof: pendingProof.rows[0] || null,
    pendingSubscription: pendingSub.rows[0] ? withPaymentReference(pendingSub.rows[0]) : null,
    awaitingPayment: !sub && (pendingProof.rows.length > 0 || pendingSub.rows.length > 0)
  };
}

async function getPendingSubscription(userId) {
  const result = await query(
    `SELECT us.*, sp.name as plan_name, sp.price_cents, sp.currency, sp.slug as plan_slug
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'pending'
     ORDER BY us.created_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

function generatePaymentReference(subscriptionId) {
  const compact = String(subscriptionId).replace(/-/g, '').toUpperCase();
  return `SS-${compact.slice(0, 8)}`;
}

function withPaymentReference(subscription) {
  if (!subscription?.id) return subscription;
  return { ...subscription, paymentReference: generatePaymentReference(subscription.id) };
}

async function approvePaymentProof(proofId, adminId) {
  const proof = await query(
    `SELECT pp.*, u.username FROM payment_proofs pp
     JOIN users u ON pp.user_id = u.id WHERE pp.id = $1`,
    [proofId]
  );
  if (proof.rows.length === 0) throw new Error('Comprovativo não encontrado');
  const p = proof.rows[0];
  if (p.status !== 'pending') throw new Error('Comprovativo já foi processado');

  const sub = await activateSubscription({
    userId: p.user_id,
    planId: p.plan_id,
    grantedBy: adminId,
    notes: `Aprovado via Express. Ref: ${p.transfer_reference || '—'}`
  });

  await query(
    `UPDATE payment_proofs SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
     subscription_id = $2, updated_at = NOW() WHERE id = $3`,
    [adminId, sub.id, proofId]
  );

  return { proof: p, subscription: sub };
}

async function logAdminAction(adminId, targetUserId, action, details = {}) {
  await query(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details) VALUES ($1, $2, $3, $4)`,
    [adminId, targetUserId, action, JSON.stringify(details)]
  );
}

module.exports = {
  expireStaleSubscriptions,
  getActiveSubscription,
  getPendingSubscription,
  hasActiveSubscription,
  countUserStations,
  canCreateStation,
  activateSubscription,
  createPendingSubscription,
  getSubscriptionSummary,
  approvePaymentProof,
  logAdminAction,
  generatePaymentReference,
  withPaymentReference
};
