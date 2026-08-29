// =============================================================================
// Subscription Plans & Multicaixa Express payments
// =============================================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');
const { requireActiveAccount } = require('../middleware/subscription');
const {
  activateSubscription,
  createPendingSubscription,
  getSubscriptionSummary,
  getActiveSubscription,
  generatePaymentReference,
  withPaymentReference
} = require('../services/subscriptions');
const { getPaymentInstructions, formatPlanPrice } = require('../utils/paymentConfig');
const logger = require('../utils/logger');

const PROOFS_PATH = process.env.PAYMENT_PROOFS_PATH || '/tmp/streamserver-proofs';

const proofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(PROOFS_PATH, { recursive: true });
    cb(null, PROOFS_PATH);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// GET /api/subscriptions/plans
router.get('/plans', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, slug, interval_type, interval_months, price_cents, currency,
              max_stations, max_listeners, description, features
       FROM subscription_plans WHERE is_active = true ORDER BY sort_order`
    );
    res.json(result.rows.map(formatPlan));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// GET /api/subscriptions/payment-info — instruções Express (público)
router.get('/payment-info', (req, res) => {
  res.json(getPaymentInstructions());
});

// GET /api/subscriptions/me
router.get('/me', authenticate, requireActiveAccount, async (req, res) => {
  try {
    res.json(await getSubscriptionSummary(req.user.id, req.user.role));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// POST /api/subscriptions/subscribe — inicia pedido + instruções de pagamento
router.post('/subscribe', authenticate, requireActiveAccount, async (req, res) => {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

    const existing = await getActiveSubscription(req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'Já tens uma assinatura activa.', subscription: existing });
    }

    const planResult = await query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
      [plan_id]
    );
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }
    const plan = planResult.rows[0];

    const pending = await createPendingSubscription(req.user.id, plan_id);
    const payment = getPaymentInstructions(plan);
    const paymentReference = generatePaymentReference(pending.id);

    res.status(202).json({
      message: 'Pedido registado. Transfere via Express e envia o comprovativo.',
      subscription: withPaymentReference(pending),
      plan: formatPlan(plan),
      payment: { ...payment, paymentReference },
      paymentReference,
      code: 'AWAITING_PAYMENT_PROOF'
    });
  } catch (error) {
    logger.error('Subscribe error:', error);
    res.status(400).json({ error: error.message || 'Subscription failed' });
  }
});

// POST /api/subscriptions/proof — enviar comprovativo
router.post('/proof', authenticate, requireActiveAccount, uploadProof.single('proof'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Ficheiro comprovativo obrigatório (JPG, PNG ou PDF)' });
    }

    const { subscription_id, transfer_reference } = req.body;
    if (!subscription_id) {
      return res.status(400).json({ error: 'subscription_id is required' });
    }

    const sub = await query(
      `SELECT us.*, sp.price_cents, sp.currency, sp.name as plan_name
       FROM user_subscriptions us
       JOIN subscription_plans sp ON us.plan_id = sp.id
       WHERE us.id = $1 AND us.user_id = $2 AND us.status = 'pending'`,
      [subscription_id, req.user.id]
    );
    if (sub.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido de assinatura não encontrado ou já processado' });
    }
    const subscription = sub.rows[0];
    const transferRef = (transfer_reference && String(transfer_reference).trim())
      || generatePaymentReference(subscription_id);

    const existingProof = await query(
      `SELECT id FROM payment_proofs WHERE user_id = $1 AND status = 'pending'`,
      [req.user.id]
    );
    if (existingProof.rows.length > 0) {
      return res.status(409).json({
        error: 'Já existe um comprovativo em análise. Aguarda aprovação do administrador.'
      });
    }

    const result = await query(
      `INSERT INTO payment_proofs
         (user_id, subscription_id, plan_id, transfer_reference, file_path,
          original_filename, mime_type, file_size, amount_kz, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING *`,
      [
        req.user.id,
        subscription_id,
        subscription.plan_id,
        transferRef,
        req.file.path,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        subscription.price_cents
      ]
    );

    logger.info(`Payment proof uploaded: user=${req.user.username} plan=${subscription.plan_name}`);

    res.status(201).json({
      message: 'Comprovativo enviado! Confirma no WhatsApp e aguarda aprovação do administrador.',
      proof: {
        id: result.rows[0].id,
        status: 'pending',
        planName: subscription.plan_name,
        amountFormatted: formatPlanPrice(subscription)
      }
    });
  } catch (error) {
    logger.error('Proof upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload proof' });
  }
});

function formatPlan(p) {
  return {
    ...p,
    priceFormatted: formatPlanPrice(p),
    intervalLabel: intervalLabels[p.interval_type] || p.interval_type
  };
}

const intervalLabels = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual'
};

module.exports = router;
