import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_BACKEND_URL || 'http://127.0.0.1:3000';
  const wsTarget = env.VITE_BACKEND_WS || 'ws://127.0.0.1:3000';

  return {
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              console.error('[vite] API proxy error:', err.message);
              if (res && !res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Backend indisponível. Na raiz do projeto corre: npm run dev (API + frontend juntos).',
                  details: err.message
                }));
              }
            });
          }
        },
        '/ws': {
          target: wsTarget,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets'
    }
  };
});
