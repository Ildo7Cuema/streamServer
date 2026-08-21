// =============================================================================
// Stream Control Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { sendCommand, getStatusSafe } = require('../services/liquidsoap');
const { getServerStats, getActiveMounts, killSource } = require('../services/icecast');
const { broadcast } = require('../services/websocket');
const logger = require('../utils/logger');

function autodjUnavailable(res) {
  return res.status(503).json({
    error: 'AutoDJ (Liquidsoap) não está a correr neste servidor. Transmite com o BUTT para o Icecast.',
    code: 'AUTODJ_UNAVAILABLE'
  });
}

// GET /api/stream/status - Current stream status (Icecast + optional AutoDJ)
router.get('/status', authenticate, async (req, res) => {
  try {
    if (process.env.ICECAST_DISABLED === 'true' || process.env.SKIP_ICECAST === 'true') {
      return res.json({
        icecast: { ok: false, disabled: true },
        mounts: [],
        liquidsoap: { available: false, reason: 'disabled' },
        autodjAvailable: false,
        disabled: true,
        message: 'Icecast/Liquidsoap disabled (ICECAST_DISABLED)',
        timestamp: new Date().toISOString()
      });
    }

    const [stats, mounts, liquidsoap] = await Promise.all([
      getServerStats(),
      getActiveMounts(),
      getStatusSafe()
    ]);

    const icecastOk = Boolean(stats);
    res.json({
      icecast: {
        ok: icecastOk,
        host: process.env.PUBLIC_ICECAST_HOST || process.env.ICECAST_HOST || null,
        port: Number(process.env.ICECAST_PORT || 8000)
      },
      mounts,
      listeners: mounts.reduce((sum, m) => sum + (m.listeners || 0), 0),
      peakListeners: mounts.reduce((max, m) => Math.max(max, m.peak_listeners || 0), 0),
      liquidsoap,
      autodjAvailable: Boolean(liquidsoap?.available),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Stream status error:', error);
    res.status(500).json({ error: 'Failed to fetch stream status' });
  }
});

// POST /api/stream/autodj/start - Start AutoDJ
router.post('/autodj/start', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await sendCommand('autodj.start', 2500);
    broadcast('stream', { action: 'autodj_started' });
    logger.info('AutoDJ started by user:', req.user.username);
    res.json({ message: 'AutoDJ started', result });
  } catch (error) {
    logger.error('Start AutoDJ error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || /timeout/i.test(error.message || '')) {
      return autodjUnavailable(res);
    }
    res.status(500).json({ error: 'Failed to start AutoDJ' });
  }
});

// POST /api/stream/autodj/stop - Stop AutoDJ
router.post('/autodj/stop', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await sendCommand('autodj.stop', 2500);
    broadcast('stream', { action: 'autodj_stopped' });
    logger.info('AutoDJ stopped by user:', req.user.username);
    res.json({ message: 'AutoDJ stopped', result });
  } catch (error) {
    logger.error('Stop AutoDJ error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || /timeout/i.test(error.message || '')) {
      return autodjUnavailable(res);
    }
    res.status(500).json({ error: 'Failed to stop AutoDJ' });
  }
});

// POST /api/stream/autodj/skip - Skip current track
router.post('/autodj/skip', authenticate, authorize('admin', 'manager', 'dj'), async (req, res) => {
  try {
    const result = await sendCommand('autodj.skip', 2500);
    broadcast('stream', { action: 'track_skipped', by: req.user.username });
    res.json({ message: 'Track skipped', result });
  } catch (error) {
    logger.error('Skip track error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || /timeout/i.test(error.message || '')) {
      return autodjUnavailable(res);
    }
    res.status(500).json({ error: 'Failed to skip track' });
  }
});

// POST /api/stream/metadata - Update stream metadata
router.post('/metadata', authenticate, authorize('admin', 'manager', 'dj'), async (req, res) => {
  try {
    const { title, artist, mount } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const metadata = `${artist ? artist + ' - ' : ''}${title}`;
    await sendCommand(`metadata.update ${mount || 'live'} "${metadata}"`);

    broadcast('metadata', { title, artist, mount, updatedBy: req.user.username });
    res.json({ message: 'Metadata updated' });
  } catch (error) {
    logger.error('Update metadata error:', error);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

// POST /api/stream/recording/start - Start recording
router.post('/recording/start', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await sendCommand('recording.start', 2500);
    broadcast('stream', { action: 'recording_started' });
    logger.info('Recording started by user:', req.user.username);
    res.json({ message: 'Recording started', result });
  } catch (error) {
    logger.error('Start recording error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || /timeout/i.test(error.message || '')) {
      return autodjUnavailable(res);
    }
    res.status(500).json({ error: 'Failed to start recording' });
  }
});

// POST /api/stream/recording/stop - Stop recording
router.post('/recording/stop', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await sendCommand('recording.stop', 2500);
    broadcast('stream', { action: 'recording_stopped' });
    logger.info('Recording stopped by user:', req.user.username);
    res.json({ message: 'Recording stopped', result });
  } catch (error) {
    logger.error('Stop recording error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || /timeout/i.test(error.message || '')) {
      return autodjUnavailable(res);
    }
    res.status(500).json({ error: 'Failed to stop recording' });
  }
});

// POST /api/stream/kick - Kick a source from mount
router.post('/kick', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { mount } = req.body;
    if (!mount) {
      return res.status(400).json({ error: 'Mount is required' });
    }

    await killSource(mount);
    broadcast('stream', { action: 'source_kicked', mount });
    logger.warn('Source kicked from mount:', mount, 'by:', req.user.username);
    res.json({ message: `Source kicked from ${mount}` });
  } catch (error) {
    logger.error('Kick source error:', error);
    res.status(500).json({ error: 'Failed to kick source' });
  }
});

module.exports = router;
