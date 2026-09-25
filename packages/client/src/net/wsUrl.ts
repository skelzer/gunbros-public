/**
 * Where the WebSocket lives (DESIGN §1.5): `VITE_WS_URL` is baked in at build time and,
 * when it is empty, the client derives `ws(s)://<same host>/ws` from the page it was
 * served from. In dev that is the Vite origin, whose `/ws` is proxied to :8080.
 *
 * Phase 3 opens the socket; this is the one piece of it Phase 1 needs so the build-time
 * configuration is settled.
 */
export function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured && configured.length > 0) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
