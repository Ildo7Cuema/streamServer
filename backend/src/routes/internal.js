// =============================================================================
// Internal Routes - Service-to-Service Communication
// =============================================================================
// Used by Icecast/Liquidsoap callbacks and internal monitoring

const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { broadcast } = require('../services/websocket');
const logger = require('../utils/logger');

function verifyInternal(req, res, next) {
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return next();
  }
  if (req.headers['x-internal-key'] !== apiKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/** Icecast URL-auth não envia X-Internal-Key — nunca bloquear este callback. */
function allowIcecastAuth(req, res, next) {
  return next();
}

function normalizeMount(mount) {
  if (!mount) return '/live';
  return mount.startsWith('/') ? mount : `/${mount}`;
}

function getAuthParams(req) {
  return {
    user: req.body?.user || req.query?.user,
    pass: req.body?.pass || req.query?.pass,
    mount: req.body?.mount || req.query?.mount,
    ip: req.body?.ip || req.query?.ip
  };
}

async function handleIcecastAuth(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const user = params.user;
    const pass = params.pass;
    const mount = params.mount;
    const ip = params.ip;
    const action = params.action;

    logger.info(`Icecast auth: action=${action}, user=${user}, mount=${mount}, ip=${ip}, hasPass=${!!pass}`);

    if (!pass) {
      return res.status(401).send('Denied');
    }

    const normalizedMount = normalizeMount(mount);

    // Station-level password
    const stationResult = await query(
      'SELECT id, name, source_password, owner_id FROM stations WHERE mountpoint = $1 AND is_active = true',
      [normalizedMount]
    );

    if (stationResult.rows.length > 0) {
      const station = stationResult.rows[0];
      if (station.source_password && pass === station.source_password) {
        // Verify station owner has active subscription (unless admin-owned legacy)
        if (station.owner_id) {
          const owner = await query(
            'SELECT role FROM users WHERE id = $1 AND is_active = true AND account_status != $2',
            [station.owner_id, 'blocked']
          );
          if (owner.rows.length === 0) {
            logger.warn(`Auth denied: owner blocked for mount ${normalizedMount}`);
            return res.status(401).send('Denied');
          }
          if (owner.rows[0].role !== 'admin') {
            const { hasActiveSubscription } = require('../services/subscriptions');
            const active = await hasActiveSubscription(station.owner_id, owner.rows[0].role);
            if (!active) {
              logger.warn(`Auth denied: no subscription for mount ${normalizedMount}`);
              return res.status(401).send('Denied');
            }
          }
        }
        broadcast('stream', {
          action: 'source_connected',
          station: station.name,
          mount: normalizedMount,
          timestamp: new Date().toISOString()
        });
        logger.info(`Auth granted (station) on mount ${normalizedMount}`);
        res.set('icecast-auth-user', '1');
        return res.status(200).send('OK');
      }
    }

    // DJ profile password
    const djResult = await query(
      `SELECT dp.*, u.username
       FROM dj_profiles dp
       JOIN users u ON dp.user_id = u.id
       WHERE dp.is_active = true AND u.is_active = true
         AND dp.source_password = $1`,
      [pass]
    );

    if (djResult.rows.length === 0) {
      logger.warn(`Auth denied for mount ${normalizedMount}`);
      return res.status(401).send('Denied');
    }

    const dj = djResult.rows[0];
    const allowed = dj.allowed_mountpoints || [];

    if (allowed.length > 0 && !allowed.includes(normalizedMount)) {
      logger.warn(`Mount ${normalizedMount} not allowed for DJ: ${dj.dj_name}`);
      return res.status(403).send('Mount not allowed');
    }

    await query(
      'UPDATE dj_profiles SET last_connected = NOW(), last_ip = $1::inet WHERE id = $2',
      [ip || null, dj.id]
    );

    broadcast('stream', {
      action: 'dj_connected',
      dj: dj.dj_name,
      mount: normalizedMount,
      timestamp: new Date().toISOString()
    });

    logger.info(`Auth granted for ${dj.dj_name} on mount ${normalizedMount}`);
    res.set('icecast-auth-user', '1');
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Icecast auth error:', error);
    res.status(500).send('Error');
  }
}

// Icecast auth (GET and POST — Icecast uses GET with query params)
// Sem verifyInternal: o Icecast não consegue enviar INTERNAL_API_KEY.
router.get('/icecast/auth', allowIcecastAuth, handleIcecastAuth);
router.post('/icecast/auth', allowIcecastAuth, handleIcecastAuth);

// POST /api/internal/metadata - Metadata update from Liquidsoap
router.post('/metadata', verifyInternal, async (req, res) => {
  try {
    const { mount, title, artist, album, song } = req.body;

    const fullTitle = song || `${artist || 'Unknown'} - ${title || 'Unknown'}`;

    const station = await query(
      'SELECT id FROM stations WHERE mountpoint = $1',
      ['/' + mount]
    );

    if (station.rows.length > 0) {
      const stationId = station.rows[0].id;

      let mediaFileId = null;
      if (title && artist) {
        const mediaResult = await query(
          `SELECT id FROM media_files
           WHERE LOWER(title) = LOWER($1) AND LOWER(artist) = LOWER($2)
           LIMIT 1`,
          [title, artist]
        );
        if (mediaResult.rows.length > 0) {
          mediaFileId = mediaResult.rows[0].id;
        }
      }

      await query(
        `INSERT INTO metadata_history (station_id, media_file_id, title, artist, album, raw_metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stationId, mediaFileId, title, artist, album, JSON.stringify(req.body)]
      );
    }

    broadcast('metadata', {
      mount,
      title: fullTitle,
      artist,
      album,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Metadata update error:', error);
    res.status(500).json({ error: 'Failed to process metadata' });
  }
});

// POST /api/internal/listener-change
router.post('/listener-change', verifyInternal, async (req, res) => {
  try {
    const { mount, event } = req.body;

    broadcast('listeners', {
      mount,
      event,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process listener event' });
  }
});

// POST /api/internal/stream-event - Liquidsoap stream events
router.post('/stream-event', verifyInternal, async (req, res) => {
  try {
    const { event, mount, data } = req.body;

    broadcast('stream', {
      action: event || 'stream_event',
      mount,
      data,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process stream event' });
  }
});

module.exports = router;
