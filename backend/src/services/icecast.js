// =============================================================================
// Icecast Service - Server Communication
// =============================================================================

const logger = require('../utils/logger');

const ICECAST_HOST = process.env.ICECAST_HOST || 'icecast';
const ICECAST_PORT = process.env.ICECAST_PORT || '8000';
const ICECAST_ADMIN_USER = process.env.ICECAST_ADMIN_USER || 'admin';
const ICECAST_ADMIN_PASSWORD = process.env.ICECAST_ADMIN_PASSWORD || 'adminpass';

const adminAuth = Buffer.from(`${ICECAST_ADMIN_USER}:${ICECAST_ADMIN_PASSWORD}`).toString('base64');

let lastIcecastErrorLog = 0;
const ICECAST_ERROR_LOG_INTERVAL_MS = 60_000;

function logIcecastError(message, detail) {
  const now = Date.now();
  if (now - lastIcecastErrorLog < ICECAST_ERROR_LOG_INTERVAL_MS) return;
  lastIcecastErrorLog = now;
  logger.warn(`${message}${detail ? `: ${detail}` : ''} (próximo aviso em ~60s; sobe Icecast ou define ICECAST_DISABLED=true)`);
}

async function icecastRequest(endpoint) {
  try {
    const url = `http://${ICECAST_HOST}:${ICECAST_PORT}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${adminAuth}`
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Icecast returned ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    logIcecastError(`Icecast request failed [${endpoint}]`, error.message);
    throw error;
  }
}

// Get server stats as JSON
async function getServerStats() {
  try {
    const data = await icecastRequest('/status-json.xsl');
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return parsed.icestats || {};
  } catch (error) {
    logIcecastError('Failed to get Icecast stats', error.message);
    return null;
  }
}

// Get mount point details
async function getMountStats(mountpoint = '/live') {
  const stats = await getServerStats();
  if (!stats || !stats.source) return null;

  const sources = Array.isArray(stats.source) ? stats.source : [stats.source];
  return sources.find(s => s.listenurl && s.listenurl.includes(mountpoint)) || null;
}

function mountFromListenUrl(listenurl) {
  if (!listenurl || typeof listenurl !== 'string') return '';
  try {
    const path = new URL(listenurl).pathname || '';
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    const idx = listenurl.lastIndexOf('/');
    if (idx < 0) return '';
    const rest = listenurl.slice(idx);
    // keep /slug/live if possible
    const match = listenurl.match(/https?:\/\/[^/]+(\/.+)$/i);
    return match ? match[1] : rest;
  }
}

// Get all active mounts
async function getActiveMounts() {
  const stats = await getServerStats();
  if (!stats || !stats.source) return [];

  const sources = Array.isArray(stats.source) ? stats.source : [stats.source];
  return sources.map((s) => {
    const mount = mountFromListenUrl(s.listenurl) || s.server_name || '';
    return {
      mount,
      listenurl: s.listenurl,
      listeners: Number(s.listeners) || 0,
      peak_listeners: Number(s.listener_peak) || 0,
      title: s.title || '',
      artist: s.artist || '',
      genre: s.genre || '',
      bitrate: s.bitrate || 0,
      format: s.server_type || '',
      stream_start: s.stream_start || null
    };
  });
}

// Get listener count for a mount
async function getListenerCount(mountpoint = '/live') {
  const mount = await getMountStats(mountpoint);
  return mount ? (mount.listeners || 0) : 0;
}

// Get total listeners across all mounts
async function getTotalListeners() {
  const stats = await getServerStats();
  if (!stats || !stats.source) return 0;

  const sources = Array.isArray(stats.source) ? stats.source : [stats.source];
  return sources.reduce((total, s) => total + (s.listeners || 0), 0);
}

// Kill a source connection
async function killSource(mountpoint) {
  return icecastRequest(`/admin/killsource?mount=${mountpoint}`);
}

// Kill a specific client
async function killClient(mountpoint, clientId) {
  return icecastRequest(`/admin/killclient?mount=${mountpoint}&id=${clientId}`);
}

// Update mount metadata
async function updateMetadata(mountpoint, song) {
  const encoded = encodeURIComponent(song);
  return icecastRequest(`/admin/metadata?mount=${mountpoint}&mode=updinfo&song=${encoded}`);
}

// Move listeners between mounts
async function moveListeners(fromMount, toMount) {
  return icecastRequest(`/admin/moveclients?mount=${fromMount}&destination=${toMount}`);
}

module.exports = {
  getServerStats,
  getMountStats,
  getActiveMounts,
  getListenerCount,
  getTotalListeners,
  killSource,
  killClient,
  updateMetadata,
  moveListeners
};
