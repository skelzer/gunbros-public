/**
 * Per-address limits: how many sockets one address may hold, and how fast it may
 * create rooms or guess room codes.
 *
 * The per-socket token bucket in `Connection` caps what one socket can make the server
 * do, but nothing stopped one machine from opening hundreds of sockets: enough to fill
 * `maxRooms` so real players get `serverFull`, to start a few hundred matches that
 * saturate the CPU, or to enumerate 5-character room codes and walk into a friend's
 * lobby. These are the per-address half of that.
 */
import type { IncomingMessage } from 'node:http';
import { config } from './config.js';

/** Token buckets keyed by address. Idle, full buckets are forgotten by {@link sweep}. */
export class KeyedBucket {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly burst: number,
  ) {}

  private refill(key: string, now: number): { tokens: number; at: number } {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
      return b;
    }
    const elapsed = Math.max(0, now - b.at);
    b.tokens = Math.min(this.burst, b.tokens + (elapsed * this.perMinute) / 60_000);
    b.at = now;
    return b;
  }

  /** Is there at least one token, without spending it? */
  has(key: string, now: number = Date.now()): boolean {
    return this.refill(key, now).tokens >= 1;
  }

  /** Spend one token; false (and nothing spent) when the bucket is empty. */
  take(key: string, now: number = Date.now()): boolean {
    const b = this.refill(key, now);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  sweep(now: number = Date.now()): void {
    for (const [key, b] of this.buckets) {
      const tokens = Math.min(this.burst, b.tokens + ((now - b.at) * this.perMinute) / 60_000);
      if (tokens >= this.burst) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Live socket counts per address. */
export class AddressCounter {
  private readonly counts = new Map<string, number>();

  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  add(key: string): void {
    this.counts.set(key, this.count(key) + 1);
  }

  remove(key: string): void {
    const next = this.count(key) - 1;
    if (next <= 0) this.counts.delete(key);
    else this.counts.set(key, next);
  }
}

/**
 * The client's address. Behind a proxy every socket comes from the proxy, so the real
 * address is the one the proxy writes (`X-Real-IP` from Caddy in production,
 * `Fly-Client-IP` on Fly) — trusted only when `CLIENT_IP_HEADER` names it, because a
 * server reachable directly would let a client send the header and pick its own address.
 */
export function clientAddress(req: IncomingMessage): string {
  const header = config.clientIpHeader;
  if (header) {
    const value = req.headers[header];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) return first.split(',')[0]?.trim() ?? first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * May a browser page from `Origin` open a game socket? A page on another site could
 * otherwise play (and spam) through its visitors' browsers. Same origin as the request's
 * `Host` (or `X-Forwarded-Host`) is always fine, as is `ALLOWED_ORIGINS` (for a client hosted apart from the
 * server, see `VITE_WS_URL`). No `Origin` at all is not a browser, so there is nothing
 * to protect — the address limits still apply to it.
 */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === '') return false;
  // Behind a proxy that rewrites Host (the Vite dev server), the page's host arrives as
  // X-Forwarded-Host. A page cannot set that header on a WebSocket, so it is safe here.
  const forwarded = req.headers['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return host === req.headers.host || (!!forwardedHost && host === forwardedHost.split(',')[0]?.trim());
}
