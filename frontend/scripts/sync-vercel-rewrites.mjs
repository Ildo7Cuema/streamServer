/**
 * Atualiza frontend/vercel.json com rewrites para o backend (build na Vercel).
 * Define VITE_BACKEND_URL (ou BACKEND_URL) nas Environment Variables do projeto.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vercelPaths = [
  path.join(__dirname, '..', 'vercel.json'),
  path.join(__dirname, '..', '..', 'vercel.json')
].filter((p) => fs.existsSync(p));

const isVercel = process.env.VERCEL === '1';
const raw = (process.env.VITE_BACKEND_URL || process.env.BACKEND_URL || '').trim();

function fail(msg) {
  console.error(`[vercel] ${msg}`);
  process.exit(1);
}

if (!raw) {
  if (isVercel) {
    fail(
      'VITE_BACKEND_URL em falta. Vercel → Environment Variables → URL do backend InterServer ' +
        '(ex.: http://SEU_IP ou https://api.teudominio.com).'
    );
  }
  console.warn('[vercel] VITE_BACKEND_URL não definido — skip rewrites (dev local).');
  process.exit(0);
}

let base;
try {
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  base = new URL(normalized).origin;
} catch {
  fail(`VITE_BACKEND_URL inválido: "${raw}"`);
}

const host = new URL(base).hostname;
const blocked = ['YOUR_API_DOMAIN', 'localhost', '127.0.0.1', '0.0.0.0'];
if (blocked.includes(host)) {
  fail(
    `VITE_BACKEND_URL aponta para "${host}". Na Vercel usa a URL pública do backend (InterServer VPS), não localhost.`
  );
}
if (!host.includes('.')) {
  fail(`Hostname inválido em VITE_BACKEND_URL: "${host}"`);
}

if (!vercelPaths.length) {
  console.warn('[vercel] vercel.json não encontrado — skip rewrites.');
  process.exit(0);
}

for (const vercelPath of vercelPaths) {
  const cfg = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  const apiRewrites = [
    { source: '/api/(.*)', destination: `${base}/api/$1` },
    { source: '/ws', destination: `${base}/ws` },
    { source: '/stream/(.*)', destination: `${base}/stream/$1` },
  ];
  const spaRewrite = cfg.rewrites?.find((r) => r.source?.includes('index.html')) ?? {
    source: '/((?!assets/).*)',
    destination: '/index.html',
  };
  cfg.rewrites = [...apiRewrites, spaRewrite];
  fs.writeFileSync(vercelPath, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log('[vercel] Rewrites /api, /ws e /stream →', base, `(${path.relative(process.cwd(), vercelPath)})`);
}
