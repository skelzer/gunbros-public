import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * Client build (DESIGN §1.3, §1.5).
 *
 * - `@gunbros/shared` resolves to its TypeScript source so a change to the simulation
 *   hot-reloads here instead of needing a rebuild.
 * - `/ws` is proxied to the Phase 3 server on :8080; until that exists the proxy simply
 *   fails to connect, which is harmless because nothing opens a socket yet.
 * - `VITE_WS_URL` is baked in at build time. Empty means "derive from the page origin",
 *   which is what the server-hosted deployment wants.
 */
const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

/**
 * Dev server port and the server the `/ws` proxy points at, both overridable from the
 * environment: `CLIENT_PORT=8120 SERVER_PORT=8121 pnpm --filter @gunbros/client dev`.
 *
 * An environment variable rather than a CLI flag because `pnpm --filter … dev -- --port
 * 8120` forwards the `--` literally and Vite then ignores everything after it, so that
 * form quietly lands back on 5173.
 */
const DEV_SERVER_PORT = Number(process.env.CLIENT_PORT) || 5173;
const WS_PROXY_TARGET = `ws://localhost:${Number(process.env.SERVER_PORT) || 8080}`;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, clientRoot, 'VITE_');
  const wsUrl = env.VITE_WS_URL ?? '';

  return {
    root: clientRoot,
    // `import.meta.env.VITE_WS_URL` is always defined, even when the variable is unset,
    // so the runtime helper only has to handle the empty string.
    define: {
      'import.meta.env.VITE_WS_URL': JSON.stringify(wsUrl),
    },
    resolve: {
      alias: {
        '@gunbros/shared': sharedSrc,
      },
    },
    server: {
      // Listen on every interface so phones and other computers on the LAN can join.
      host: true,
      port: DEV_SERVER_PORT,
      strictPort: true,
      proxy: {
        '/ws': {
          target: WS_PROXY_TARGET,
          ws: true,
          changeOrigin: true,
          // `changeOrigin` rewrites Host to the server's; X-Forwarded-Host keeps the
          // page's, which is what the server's Origin check compares against. (`xfwd`
          // does not set it on WebSocket upgrades, hence the hook.)
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq, req) => {
              if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host);
            });
          },
        },
      },
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
