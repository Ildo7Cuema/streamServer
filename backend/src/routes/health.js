// =============================================================================
// Health Check Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../database/connection');
const { getRedis, isRedisDisabled } = require('../services/redis');
const { getServerStats } = require('../services/icecast');
const { getPublicBaseUrl, getIcecastSetupStatus } = require('../utils/streamUrls');

router.get('/', async (req, res) => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {}
  };

  // Check database
  try {
    await pool.query('SELECT 1');
    checks.services.database = 'ok';
  } catch {
    checks.services.database = 'error';
    checks.status = 'degraded';
  }

  // Check Redis
  if (isRedisDisabled()) {
    checks.services.redis = 'skipped';
  } else {
    try {
      const redis = getRedis();
      await redis.ping();
      checks.services.redis = 'ok';
    } catch {
      checks.services.redis = 'error';
      checks.status = 'degraded';
    }
  }

  // Check Icecast
  if (process.env.ICECAST_DISABLED === 'true' || process.env.SKIP_ICECAST === 'true') {
    checks.services.icecast = 'skipped';
  } else {
    try {
      const stats = await getServerStats();
      checks.services.icecast = stats ? 'ok' : 'error';
      if (!stats) checks.status = 'degraded';
    } catch {
      checks.services.icecast = 'error';
      checks.status = 'degraded';
    }
  }

  const icecastSetup = getIcecastSetupStatus();
  const internalKeySet = Boolean(process.env.INTERNAL_API_KEY);

  // Diagnóstico de URLs públicas (sem segredos) — útil para validar APP_URL no Render
  checks.streamConfig = {
    appUrl: process.env.APP_URL || null,
    publicStreamUrl: process.env.PUBLIC_STREAM_URL || null,
    publicIcecastHost: process.env.PUBLIC_ICECAST_HOST || null,
    icecastHost: process.env.ICECAST_HOST || null,
    nodeEnv: process.env.NODE_ENV || null,
    resolvedListenBase: getPublicBaseUrl({ origin: req.get('origin') || req.get('referer') }),
    icecastConnectHost: icecastSetup.connectHost,
    icecastConfigured: icecastSetup.configured,
    icecastSetupReason: icecastSetup.reason,
    icecastSetupMessage: icecastSetup.message,
    // Auth Icecast já não exige INTERNAL_API_KEY; aviso só para outros endpoints internos
    internalApiKeySet: internalKeySet,
    buttHint: icecastSetup.configured
      ? `BUTT → Servidor=${icecastSetup.connectHost} Porta=${icecastSetup.port} User=source SSL=Off`
      : icecastSetup.message,
    gitCommit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null
  };

  if (!icecastSetup.configured && !isIcecastSkipped(checks.services.icecast)) {
    checks.status = checks.status === 'ok' ? 'degraded' : checks.status;
  }

  const httpStatus = checks.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(checks);
});

function isIcecastSkipped(status) {
  return status === 'skipped';
}

module.exports = router;
