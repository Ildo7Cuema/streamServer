// =============================================================================
// Admin Routes — user management & subscriptions
// =============================================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { query, getClient } = require('../database/connection');
const { authenticate, authorize } = require('../middleware/auth');
const {
  activateSubscription,
  logAdminAction,
  expireStaleSubscriptions,
  approvePaymentProof
} = require('../services/subscriptions');
const { formatPlanPrice } = require('../utils/paymentConfig');
const logger = require('../utils/logger');

router.use(authenticate, authorize('admin'));

const PROOFS_PATH = path.resolve(process.env.PAYMENT_PROOFS_PATH || '/tmp/streamserver-proofs');

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    await expireStaleSubscriptions();
    const result = await query(
      `SELECT u.id, u.username, u.email, u.display_name, u.role, u.is_active,
              u.account_status, u.blocked_at, u.blocked_reason, u.last_login, u.created_at,
              (SELECT COUNT(*) FROM stations s WHERE s.owner_id = u.id) as station_count,
              us.status as sub_status, us.expires_at as sub_expires,
              sp.name as plan_name, sp.slug as plan_slug
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM user_subscriptions
         WHERE user_id = u.id AND status IN ('active', 'pending', 'expired')
         ORDER BY created_at DESC LIMIT 1
       ) us ON true
       LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
       WHERE u.role != 'admin'
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Admin list users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/admin/users/:id/block
router.post('/users/:id/block', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await query(
      `UPDATE users SET is_active = false, account_status = 'blocked',
       blocked_at = NOW(), blocked_reason = $1
       WHERE id = $2 AND role != 'admin' RETURNING id, username, email`,
      [reason || 'Bloqueado pelo administrador', req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await query(
      `UPDATE user_subscriptions SET status = 'canceled', canceled_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [req.params.id]
    );

    await logAdminAction(req.user.id, req.params.id, 'block_user', { reason });
    res.json({ message: 'Utilizador bloqueado', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// POST /api/admin/users/:id/unblock
router.post('/users/:id/unblock', async (req, res) => {
  try {
    const result = await query(
      `UPDATE users SET is_active = true, account_status = 'active',
       blocked_at = NULL, blocked_reason = NULL
       WHERE id = $1 AND role != 'admin' RETURNING id, username, email`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    await logAdminAction(req.user.id, req.params.id, 'unblock_user', {});
    res.json({ message: 'Utilizador desbloqueado', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const client = await getClient();
  try {
    const existing = await client.query(
      `SELECT id, username FROM users WHERE id = $1 AND role != 'admin'`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { id, username } = existing.rows[0];

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details) VALUES ($1, $2, $3, $4)`,
      [req.user.id, id, 'delete_user', JSON.stringify({ username })]
    );
    await client.query('UPDATE playlists SET created_by = NULL WHERE created_by = $1', [id]);
    await client.query('UPDATE media_files SET uploaded_by = NULL WHERE uploaded_by = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({ message: 'Utilizador removido' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  } finally {
    client.release();
  }
});

// POST /api/admin/users/:id/subscription — grant/renew subscription
router.post('/users/:id/subscription', async (req, res) => {
  try {
    const { plan_id, notes } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

    const sub = await activateSubscription({
      userId: req.params.id,
      planId: plan_id,
      grantedBy: req.user.id,
      notes: notes || 'Concedida pelo administrador'
    });

    await logAdminAction(req.user.id, req.params.id, 'grant_subscription', { plan_id });
    res.json({ message: 'Assinatura activada', subscription: sub });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to activate subscription' });
  }
});

// DELETE /api/admin/users/:id/subscription — revoke subscription
router.delete('/users/:id/subscription', async (req, res) => {
  try {
    await query(
      `UPDATE user_subscriptions SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [req.params.id]
    );
    await logAdminAction(req.user.id, req.params.id, 'revoke_subscription', {});
    res.json({ message: 'Assinatura revogada' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke subscription' });
  }
});

// GET /api/admin/stations
router.get('/stations', async (req, res) => {
  try {
    const result = await query(
      `SELECT s.id, s.name, s.slug, s.mountpoint, s.format, s.bitrate, s.is_active,
              s.owner_id, s.created_at,
              u.username AS owner_username,
              (SELECT COUNT(*) FROM dj_profiles dp WHERE dp.station_id = s.id) AS dj_count
       FROM stations s
       LEFT JOIN users u ON s.owner_id = u.id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Admin list stations error:', error);
    res.status(500).json({ error: 'Failed to list stations' });
  }
});

// DELETE /api/admin/stations/:id
router.delete('/stations/:id', async (req, res) => {
  try {
    const existing = await query(
      `SELECT s.id, s.name, s.owner_id, u.username AS owner_username
       FROM stations s
       LEFT JOIN users u ON s.owner_id = u.id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Station not found' });
    }
    const station = existing.rows[0];

    await query('DELETE FROM stations WHERE id = $1', [req.params.id]);
    await logAdminAction(req.user.id, station.owner_id, 'delete_station', {
      station_id: station.id,
      station_name: station.name,
      owner_username: station.owner_username
    });

    res.json({ message: 'Estação removida' });
  } catch (error) {
    logger.error('Admin delete station error:', error);
    res.status(500).json({ error: 'Failed to delete station' });
  }
});

// GET /api/admin/payment-proofs
router.get('/payment-proofs', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const result = await query(
      `SELECT pp.*, u.username, u.email, sp.name as plan_name, sp.slug as plan_slug
       FROM payment_proofs pp
       JOIN users u ON pp.user_id = u.id
       JOIN subscription_plans sp ON pp.plan_id = sp.id
       WHERE pp.status = $1
       ORDER BY pp.created_at ASC`,
      [status]
    );
    res.json(result.rows.map((p) => ({
      ...p,
      amountFormatted: formatPlanPrice({ price_cents: p.amount_kz, currency: 'AOA' })
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to list payment proofs' });
  }
});

// GET /api/admin/payment-proofs/:id/file — ver comprovativo
router.get('/payment-proofs/:id/file', async (req, res) => {
  try {
    const result = await query(
      `SELECT file_path, mime_type, original_filename FROM payment_proofs WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Comprovativo não encontrado' });
    }

    const proof = result.rows[0];
    const resolved = path.resolve(proof.file_path);
    if (!resolved.startsWith(PROOFS_PATH)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Ficheiro não encontrado' });
    }

    res.setHeader('Content-Type', proof.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(proof.original_filename || 'comprovativo')}"`
    );
    res.sendFile(resolved);
  } catch (error) {
    logger.error('Admin proof file error:', error);
    res.status(500).json({ error: 'Failed to fetch proof file' });
  }
});

// POST /api/admin/payment-proofs/:id/approve
router.post('/payment-proofs/:id/approve', async (req, res) => {
  try {
    const { subscription: sub, proof } = await approvePaymentProof(req.params.id, req.user.id);
    await logAdminAction(req.user.id, proof.user_id, 'approve_payment', { proof_id: proof.id });
    res.json({ message: 'Comprovativo aprovado. Assinatura activada.', subscription: sub });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/admin/payment-proofs/:id/reject
router.post('/payment-proofs/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await query(
      `UPDATE payment_proofs SET status = 'rejected', rejection_reason = $1,
       reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'pending' RETURNING *`,
      [reason || 'Comprovativo inválido', req.user.id, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Comprovativo não encontrado' });
    }
    await logAdminAction(req.user.id, result.rows[0].user_id, 'reject_payment', { reason });
    res.json({ message: 'Comprovativo rejeitado' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject proof' });
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', async (req, res) => {
  try {
    const result = await query(
      `SELECT a.*, u.username as admin_username, t.username as target_username
       FROM admin_audit_log a
       LEFT JOIN users u ON a.admin_id = u.id
       LEFT JOIN users t ON a.target_user_id = t.id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// GET /api/admin/overview
router.get('/overview', async (req, res) => {
  try {
    const [users, subs, stations, proofs] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE is_active AND account_status = 'active')::int AS active,
             COUNT(*) FILTER (WHERE account_status = 'blocked')::int AS blocked
             FROM users WHERE role != 'admin'`),
      query(`SELECT COUNT(*)::int AS active FROM user_subscriptions
             WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())`),
      query('SELECT COUNT(*)::int AS total FROM stations'),
      query(`SELECT COUNT(*)::int AS pending FROM payment_proofs WHERE status = 'pending'`)
    ]);
    res.json({
      users: users.rows[0],
      activeSubscriptions: subs.rows[0].active,
      stations: stations.rows[0].total,
      pendingProofs: proofs.rows[0].pending
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

module.exports = router;
