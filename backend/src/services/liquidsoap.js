// =============================================================================
// Liquidsoap Service - Telnet Control
// =============================================================================

const net = require('net');
const logger = require('../utils/logger');

const TELNET_HOST = process.env.LIQUIDSOAP_TELNET_HOST || 'liquidsoap';
const TELNET_PORT = parseInt(process.env.LIQUIDSOAP_TELNET_PORT) || 1234;

/**
 * Send a command to Liquidsoap via telnet
 */
function sendCommand(command, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let response = '';
    let timeoutId;

    timeoutId = setTimeout(() => {
      client.destroy();
      reject(new Error('Liquidsoap telnet timeout'));
    }, timeout);

    client.connect(TELNET_PORT, TELNET_HOST, () => {
      client.write(command + '\n');
      // Send quit after brief delay
      setTimeout(() => client.write('quit\n'), 200);
    });

    client.on('data', (data) => {
      response += data.toString();
    });

    client.on('end', () => {
      clearTimeout(timeoutId);
      // Clean response
      const cleaned = response
        .split('\n')
        .filter(line => !line.startsWith('Liquidsoap') && line.trim() !== 'Bye!' && line.trim() !== '')
        .join('\n')
        .trim();
      resolve(cleaned);
    });

    client.on('error', (err) => {
      clearTimeout(timeoutId);
      logger.error('Liquidsoap telnet error:', err.message);
      reject(err);
    });
  });
}

// Skip current track
async function skipTrack() {
  return sendCommand('autodj.skip');
}

// Reload playlist
async function reloadPlaylist() {
  return sendCommand('autodj.reload');
}

// Get status
async function getStatus() {
  return sendCommand('status');
}

/** Never throws — InterServer production often has Icecast/BUTT without Liquidsoap. */
async function getStatusSafe() {
  try {
    const status = await sendCommand('status', 2500);
    return { available: true, status };
  } catch (error) {
    return {
      available: false,
      status: null,
      reason: error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED'
        ? 'not_running'
        : (error.message || 'unavailable')
    };
  }
}

// Start recording
async function startRecording() {
  return sendCommand('recording.start');
}

// Stop recording
async function stopRecording() {
  return sendCommand('recording.stop');
}

// Get version
async function getVersion() {
  return sendCommand('version');
}

// Get help (list all commands)
async function getHelp() {
  return sendCommand('help');
}

// Get uptime
async function getUptime() {
  return sendCommand('uptime');
}

module.exports = {
  sendCommand,
  skipTrack,
  reloadPlaylist,
  getStatus,
  getStatusSafe,
  startRecording,
  stopRecording,
  getVersion,
  getHelp,
  getUptime
};
