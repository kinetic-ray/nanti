import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const host = process.env.HOST || env.HOST || '127.0.0.1';
  const port = process.env.PORT || env.PORT || '3000';
  const target = process.env.NANTI_DEV_API_ORIGIN || `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  const authOrigin = URL.parse(process.env.AUTH_PUBLIC_ORIGIN || env.AUTH_PUBLIC_ORIGIN || '');
  const authHostname = authOrigin?.protocol === 'http:' ? authOrigin.hostname : null;
  // The OAuth attempt cookie is host-only. Advertise the same loopback host used by the callback.
  const webHost = authHostname === 'localhost' ? 'localhost' : authHostname === '[::1]' ? '::1' : '127.0.0.1';
  return {
    plugins: [react()],
    server: {
      host: webHost,
      proxy: { '/api': {
        target,
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (!('writeHead' in response) || response.headersSent || response.writableEnded) return;
            response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ code: 'api_unavailable', error: 'Start the local Nanti API, then try again.' }));
          });
        },
      } },
    },
    build: { outDir: 'dist/web' },
  };
});
