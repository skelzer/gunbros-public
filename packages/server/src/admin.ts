/**
 * The admin portal: `/admin` (one page, admin.html) and the two JSON routes it
 * polls, `/admin/api/live` and `/admin/api/history`. It answers the owner's one
 * question, "can I deploy now?", and shows who is on, in which room, doing what.
 *
 * Behind HTTP Basic auth with one password (`ADMIN_PASSWORD`, any user name). Without
 * one the portal does not exist and `/admin` is an ordinary client route. Wrong
 * passwords are limited per address, and every answer is `no-store`.
 *
 * Read-only on purpose: nothing here can kick a player or close a room.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cpus, loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getMapDef, getMobileDef } from '@gunbros/shared';
import type { MobileId } from '@gunbros/shared';
import { config } from './config.js';
import type { Connection } from './connection.js';
import { KeyedBucket, clientAddress } from './limits.js';
import { log } from './log.js';
import { metrics } from './metrics.js';
import { NO_SEAT, isConnected } from './player.js';
import type { Player } from './player.js';
import type { RoomManager } from './rooms.js';

const SAMPLE_MS = 15_000;

/**
 * The page: plain HTML with its script and styles inline, next to this file in both
 * `src/` and `dist/` (the build copies it). Read once, when the portal is first shown.
 */
let page: string | null = null;
function adminPage(): string {
  page ??= readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
  return page;
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** The password from a `Basic` header, or null. The user name is ignored. */
export function basicPassword(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

function mapName(id: string): string {
  try {
    return getMapDef(id).displayName;
  } catch {
    return id;
  }
}

function mobileName(id: MobileId | 'random'): string {
  if (id === 'random') return 'Random';
  try {
    return getMobileDef(id).displayName;
  } catch {
    return id;
  }
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...extra,
  });
  res.end(body);
}

export class Admin {
  private readonly expected: Buffer | null;
  private readonly failures = new KeyedBucket(config.adminFailuresPerMinute, config.adminFailureBurst);
  private readonly loop = monitorEventLoopDelay({ resolution: 10 });
  private sampler: ReturnType<typeof setInterval> | null = null;
  /** The event loop's delay over the last sampling window, in ms. */
  private loopDelay = { p50: 0, p99: 0, max: 0 };

  constructor(
    private readonly manager: RoomManager,
    private readonly connections: ReadonlySet<Connection>,
    private readonly startedAt: number,
    password: string = config.adminPassword,
  ) {
    this.expected = password ? digest(password) : null;
    if (password && password.length < 16) log.warn('ADMIN_PASSWORD is short; use 16 characters or more');
  }

  get enabled(): boolean {
    return this.expected !== null;
  }

  start(): void {
    if (this.sampler) return;
    this.loop.enable();
    this.sampler = setInterval(() => {
      try {
        this.sample();
      } catch (err) {
        log.error('admin sample threw', err);
      }
    }, SAMPLE_MS);
    this.sampler.unref?.();
    this.sample();
  }

  stop(): void {
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = null;
    this.loop.disable();
    metrics.save();
  }

  private sample(now: number = Date.now()): void {
    const live = this.counts();
    metrics.record({ on: live.online, inMatch: live.inMatch, matches: live.matches, rooms: live.rooms }, now);
    const ms = (ns: number): number => Math.round((ns / 1e6) * 10) / 10;
    this.loopDelay = {
      p50: ms(this.loop.percentile(50)),
      p99: ms(this.loop.percentile(99)),
      max: ms(this.loop.max),
    };
    this.loop.reset();
  }

  private counts(): { online: number; inMatch: number; matches: number; rooms: number; known: number } {
    let online = 0;
    let inMatch = 0;
    let known = 0;
    for (const player of this.manager.players()) {
      known++;
      if (!isConnected(player)) continue;
      online++;
      if (player.room?.runner && player.seat !== NO_SEAT) inMatch++;
    }
    let matches = 0;
    for (const room of this.manager.rooms.values()) if (room.runner) matches++;
    return { online, inMatch, matches, rooms: this.manager.rooms.size, known };
  }

  /**
   * `/admin…`: true if this module answered the request (always, when the path is
   * ours and the portal is on), false to let the static server carry on.
   */
  handle(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (path !== '/admin' && !path.startsWith('/admin/')) return false;
    if (!this.expected) return false;

    const address = clientAddress(req);
    if (!this.failures.has(address)) {
      send(res, 429, 'text/plain; charset=utf-8', 'too many wrong passwords; wait a minute\n', { 'retry-after': '60' });
      return true;
    }
    const given = basicPassword(req.headers.authorization);
    if (given === null || !timingSafeEqual(digest(given), this.expected)) {
      if (given !== null) {
        this.failures.take(address);
        log.warn('admin: wrong password from', address);
      }
      send(res, 401, 'text/plain; charset=utf-8', 'password required\n', {
        'www-authenticate': 'Basic realm="GunBros admin", charset="UTF-8"',
      });
      return true;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'application/json; charset=utf-8', '{"error":"method not allowed"}');
      return true;
    }
    if (path === '/admin' || path === '/admin/') {
      send(res, 200, 'text/html; charset=utf-8', adminPage(), {
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      });
      return true;
    }
    if (path === '/admin/api/live') {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(this.live()));
      return true;
    }
    if (path === '/admin/api/history') {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(this.history()));
      return true;
    }
    send(res, 404, 'application/json; charset=utf-8', '{"error":"not found"}');
    return true;
  }

  // ------------------------------------------------------------------------
  // What the page shows
  // ------------------------------------------------------------------------

  live(now: number = Date.now()): unknown {
    const counts = this.counts();
    metrics.observeOnline(counts.online, now);
    const mem = process.memoryUsage();

    const person = (p: Player) => ({
      nick: p.nick,
      connected: isConnected(p),
      address: p.conn?.address ?? null,
      since: p.conn?.openedAt ?? null,
      disconnectedAt: p.disconnectedAt || null,
    });

    const rooms = [...this.manager.rooms.values()]
      .sort((a, b) => Number(!!b.runner) - Number(!!a.runner) || b.connectedCount - a.connectedCount)
      .map((room) => {
        const runner = room.runner;
        const state = runner?.state;
        return {
          code: room.code,
          phase: room.phase,
          mapId: room.mapId,
          mapName: mapName(room.mapId),
          listed: room.listed,
          createdAt: room.createdAt,
          maxPlayers: room.maxPlayers,
          players: room.players.map((p) => ({
            ...person(p),
            // A practice bot's difficulty, or null for a human (DESIGN §7 item 192).
            bot: p.bot ? p.bot.difficulty : null,
            team: p.team,
            mobile: mobileName(p.mobileId),
            host: p.id === room.hostId,
            ready: p.ready,
          })),
          match:
            runner && state
              ? {
                  startedAt: runner.startedAt,
                  turn: state.turn,
                  sky: runner.skyEvent,
                  activeSeat: state.activeSeat,
                  seats: runner.seats.map((s) => {
                    const m = state.mobiles.find((mob) => mob.seat === s.seat);
                    const player = room.players.find((p) => p.id === s.playerId);
                    let maxHp = 0;
                    try {
                      maxHp = getMobileDef(s.mobileId).hp;
                    } catch {
                      maxHp = m?.hp ?? 0;
                    }
                    return {
                      nick: s.nick,
                      bot: s.bot ? s.bot.difficulty : null,
                      team: s.team,
                      mobile: mobileName(s.mobileId),
                      hp: m ? Math.max(0, Math.round(m.hp)) : 0,
                      maxHp,
                      alive: !!m?.alive,
                      connected: player ? isConnected(player) : false,
                    };
                  }),
                }
              : null,
        };
      });

    const lobby = this.manager
      .players()
      .filter((p) => !p.room && isConnected(p))
      .map(person);

    return {
      now,
      server: {
        version: config.gitSha,
        node: process.version,
        startedAt: this.startedAt,
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        load: loadavg().map((l) => Math.round(l * 100) / 100),
        cpus: cpus().length,
        loopDelayMs: this.loopDelay,
        sockets: this.connections.size,
        persisted: config.dataDir !== '',
        limits: { maxRooms: config.maxRooms, maxConnections: config.maxConnections },
      },
      counts,
      lastActiveAt: counts.online > 0 ? now : metrics.lastActiveAt(),
      rooms,
      lobby,
      totals: metrics.totals,
      days: metrics.days,
      matches: metrics.matches.map((m) => ({
        ...m,
        mapName: mapName(m.mapId),
        players: m.players.map((p) => ({ ...p, mobile: mobileName(p.mobileId) })),
      })),
    };
  }

  /** Every stored minute, column by column (a fortnight of rows is ~20k). */
  history(): unknown {
    const s = metrics.samples;
    return {
      t: s.map((x) => x.t),
      on: s.map((x) => x.on),
      inMatch: s.map((x) => x.inMatch),
      matches: s.map((x) => x.matches),
    };
  }
}
