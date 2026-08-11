// =============================================================================
// Stream URL & BUTT Configuration Helpers
// =============================================================================

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

function isLocalHostName(hostname) {
  if (!hostname) return true;
  return LOCAL_HOSTS.has(String(hostname).toLowerCase());
}

function isLocalUrl(url) {
  if (!url) return true;
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    return isLocalHostName(new URL(normalized).hostname);
  } catch {
    return true;
  }
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

function ensureHttps(url) {
  if (!url || !url.startsWith('http://')) return url;
  if (process.env.NODE_ENV !== 'production') return url;
  if (isLocalUrl(url)) return url;
  return url.replace(/^http:\/\//i, 'https://');
}

function getRequestPublicOrigin(req) {
  if (!req) return null;

  // Browser (cross-origin ou same-origin)
  const raw = req.get('origin') || req.get('referer');
  if (raw) {
    try {
      const u = new URL(raw);
      if (!isLocalHostName(u.hostname)) {
        return `${u.protocol}//${u.host}`;
      }
    } catch { /* ignore */ }
  }

  // Proxy Vercel / CDN → backend (Origin por vezes omitido em server-side)
  const forwardedHost = req.get('x-forwarded-host');
  if (forwardedHost) {
    const host = String(forwardedHost).split(',')[0].trim();
    if (host && !isLocalHostName(host)) {
      const proto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      return `${proto}://${host}`;
    }
  }

  return null;
}

function normalizeMount(mountpoint) {
  if (!mountpoint) return '/live';
  return mountpoint.startsWith('/') ? mountpoint : `/${mountpoint}`;
}

function hostnameFromPublicUrl(url) {
  if (!url) return null;
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const hostname = new URL(normalized).hostname;
    return isLocalHostName(hostname) ? null : hostname;
  } catch {
    return null;
  }
}

/** Hostnames de frontend/CDN — nunca são servidores Icecast (BUTT não liga aqui). */
const FRONTEND_HOST_SUFFIXES = [
  '.vercel.app',
  '.netlify.app',
  '.pages.dev',
  '.github.io',
  '.onrender.com'
];

function isLikelyFrontendHost(hostname) {
  if (!hostname) return false;
  const host = String(hostname).toLowerCase();
  return FRONTEND_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/** True when APP_URL / PUBLIC_STREAM_URL / NODE_ENV indicam deploy público (não dev local). */
function isPublicDeployment() {
  if (process.env.NODE_ENV === 'production') return true;
  return [process.env.PUBLIC_STREAM_URL, process.env.APP_URL, process.env.RENDER_EXTERNAL_URL]
    .filter(Boolean)
    .some((u) => !isLocalUrl(u));
}

function isIcecastDisabled() {
  return process.env.ICECAST_DISABLED === 'true' || process.env.SKIP_ICECAST === 'true';
}

/**
 * Host Icecast explícito para o BUTT (VM/VPS).
 * Nunca faz fallback para APP_URL / Vercel — ouvintes e fontes usam hosts diferentes.
 * Ordem: PUBLIC_ICECAST_HOST → ICECAST_HOST → ICECAST_HOSTNAME → PUBLIC_STREAM_HOST
 */
function resolvePublicIcecastHost() {
  const hostCandidates = [
    process.env.PUBLIC_ICECAST_HOST,
    process.env.ICECAST_HOST,
    process.env.ICECAST_HOSTNAME,
    process.env.PUBLIC_STREAM_HOST
  ];

  for (const raw of hostCandidates) {
    if (!raw) continue;
    const host = String(raw).trim();
    if (!isLocalHostName(host) && !isLikelyFrontendHost(host)) return host;
  }

  return null;
}

function getStreamHostname() {
  return resolvePublicIcecastHost() || 'localhost';
}

function getIcecastConnectHostname() {
  const publicHost = resolvePublicIcecastHost();
  if (publicHost) return publicHost;

  if (!isPublicDeployment()) {
    return process.env.ICECAST_HOST || process.env.ICECAST_HOSTNAME || 'localhost';
  }

  return null;
}

function getIcecastSetupStatus() {
  const port = parseInt(process.env.ICECAST_PORT, 10) || 8000;
  const connectHost = getIcecastConnectHostname();

  if (isIcecastDisabled()) {
    return {
      configured: false,
      ready: false,
      connectHost: null,
      port,
      reason: 'icecast_disabled',
      message:
        'Icecast está desactivado (ICECAST_DISABLED=true). Define PUBLIC_ICECAST_HOST e ICECAST_DISABLED=false no Render.'
    };
  }

  if (!connectHost) {
    return {
      configured: false,
      ready: false,
      connectHost: null,
      port,
      reason: 'missing_public_icecast_host',
      message:
        'Define PUBLIC_ICECAST_HOST no Render com o IP ou domínio da VPS Icecast (ex.: InterServer, porta 8000). ' +
        'A Vercel serve só a escuta online — o BUTT liga directamente ao Icecast na VPS. ' +
        'Ver infrastructure/icecast/INTERSERVER.md'
    };
  }

  if (isLocalHostName(connectHost)) {
    if (!isPublicDeployment()) {
      return {
        configured: true,
        ready: true,
        connectHost,
        port,
        reason: 'local_dev',
        message: null
      };
    }
    return {
      configured: false,
      ready: false,
      connectHost,
      port,
      reason: 'localhost_in_production',
      message:
        'PUBLIC_ICECAST_HOST não está definido — o BUTT não pode usar localhost em produção.'
    };
  }

  if (isLikelyFrontendHost(connectHost)) {
    return {
      configured: false,
      ready: false,
      connectHost,
      port,
      reason: 'frontend_host_misconfigured',
      message:
        `O host "${connectHost}" é um frontend (Vercel/Render), não um servidor Icecast. ` +
        'Define PUBLIC_ICECAST_HOST com o host público da tua VM.'
    };
  }

  return {
    configured: true,
    ready: true,
    connectHost,
    port,
    reason: 'ok',
    message: null
  };
}

function getPublicBaseUrl(urlContext = {}) {
  const candidates = [
    process.env.PUBLIC_STREAM_URL,
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    urlContext.origin
  ]
    .filter(Boolean)
    .map(stripTrailingSlash);

  const publicBase = candidates.find((base) => !isLocalUrl(base));
  if (publicBase) return ensureHttps(publicBase);

  // Em Render/produção: nunca devolver localhost — APP_URL mal configurado
  const onRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  if (onRender || process.env.NODE_ENV === 'production') {
    console.error(
      '[stream] APP_URL ou PUBLIC_STREAM_URL em falta no Render. ' +
        'Define APP_URL=https://stream-server-rouge.vercel.app (ou o teu domínio Vercel).'
    );
    return null;
  }

  if (candidates.length > 0) return candidates[0];

  return 'http://localhost:5173';
}

function buildListenUrl(mountpoint, urlContext) {
  const base = getPublicBaseUrl(urlContext);
  if (!base) return null;
  const mount = normalizeMount(mountpoint);
  return `${base}/stream${mount}`;
}

function buildDirectListenUrl(mountpoint) {
  const host = getIcecastConnectHostname();
  if (!host) return null;
  const port = parseInt(process.env.ICECAST_PORT, 10) || 8000;
  const mount = normalizeMount(mountpoint);
  const useTls = process.env.ICECAST_TLS === 'true' || process.env.PUBLIC_ICECAST_TLS === 'true';
  const protocol = useTls ? 'https' : 'http';
  const portSuffix = (useTls && port === 443) || (!useTls && port === 80) ? '' : `:${port}`;
  return `${protocol}://${host}${portSuffix}${mount}`;
}

function buildPlayerUrl(mountpoint, urlContext) {
  const base = getPublicBaseUrl(urlContext);
  if (!base) return null;
  const mount = encodeURIComponent(normalizeMount(mountpoint));
  return `${base}/player?mount=${mount}`;
}

function buildButtFile({ hostname, port, mount, username, password, stationName, format, bitrate }) {
  const codec = format === 'mp3' ? 'mp3' : format === 'ogg' ? 'ogg' : 'aac';
  return `[main]
server = ${hostname}
port = ${port}
type = 0
mount = ${mount}
usr = ${username}
pwd = ${password}
name = ${stationName || 'StreamServer'}
codec = ${codec}
bitrate = ${bitrate}
samplerate = 44100
channel = 2
`;
}

function buildButtConfig(station, urlContext) {
  const setup = getIcecastSetupStatus();
  const hostname = setup.connectHost;
  const port = setup.port;
  const mount = normalizeMount(station.mountpoint);
  const username = 'source';
  const password = station.source_password || '';
  const format = station.format || 'mp3';
  const bitrate = station.bitrate || 128;
  const useTls = process.env.ICECAST_TLS === 'true' || process.env.PUBLIC_ICECAST_TLS === 'true';

  return {
    setup,
    server: {
      hostname,
      port,
      mountpoint: mount,
      username,
      password,
      protocol: 'icecast',
      ssl: useTls
    },
    audio: {
      codec: format === 'ogg' ? 'ogg' : format === 'aac' ? 'aac' : 'mp3',
      bitrate,
      samplerate: 44100,
      channels: 2
    },
    display: {
      stationName: station.name,
      djName: station.dj_name || station.name
    },
    listen_url: buildListenUrl(mount, urlContext),
    listen_url_direct: buildDirectListenUrl(mount),
    player_url: buildPlayerUrl(mount, urlContext),
    buttFile: setup.configured
      ? buildButtFile({
          hostname,
          port,
          mount,
          username,
          password,
          stationName: station.name,
          format,
          bitrate
        })
      : null
  };
}

function enrichStation(station, { includePassword = true, origin } = {}) {
  if (!station) return station;

  const urlContext = { origin };
  const mount = normalizeMount(station.mountpoint);
  const enriched = {
    ...station,
    listen_url: buildListenUrl(mount, urlContext),
    listen_url_direct: buildDirectListenUrl(mount),
    player_url: buildPlayerUrl(mount, urlContext),
    stream_url: buildListenUrl(mount, urlContext),
    codec: station.format
  };

  if (includePassword && station.source_password) {
    const setup = getIcecastSetupStatus();
    enriched.icecast = {
      host: setup.connectHost,
      port: setup.port,
      mountpoint: mount,
      username: 'source',
      password: station.source_password,
      format: station.format || 'mp3',
      bitrate: station.bitrate || 128,
      configured: setup.configured,
      setup
    };
    enriched.butt = buildButtConfig(station, urlContext);
  } else {
    delete enriched.source_password;
  }

  return enriched;
}

function enrichStationPublic(station, urlContext) {
  const { source_password, ...rest } = station;
  return enrichStation(rest, { includePassword: false, ...urlContext });
}

function defaultMountForSlug(slug) {
  return slug === 'main' ? '/live' : `/${slug}/live`;
}

function logStreamUrlConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const base = getPublicBaseUrl();
  const setup = getIcecastSetupStatus();

  if (isLocalUrl(base)) {
    console.warn(
      '[stream] PUBLIC_STREAM_URL ou APP_URL deve ser a URL HTTPS do frontend (Vercel). ' +
        'URLs de ouvir online vão sair como localhost.'
    );
  }

  if (!setup.configured) {
    console.warn(`[stream] Icecast/BUTT: ${setup.message}`);
  }
}

module.exports = {
  normalizeMount,
  getStreamHostname,
  getIcecastConnectHostname,
  getIcecastSetupStatus,
  isIcecastDisabled,
  isLikelyFrontendHost,
  getPublicBaseUrl,
  getRequestPublicOrigin,
  buildListenUrl,
  buildDirectListenUrl,
  buildPlayerUrl,
  buildButtConfig,
  buildButtFile,
  enrichStation,
  enrichStationPublic,
  defaultMountForSlug,
  logStreamUrlConfig
};
