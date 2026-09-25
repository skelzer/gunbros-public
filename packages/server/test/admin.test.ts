/**
 * The admin portal (admin.ts): its password, what it shows, and the history it keeps
 * across a restart (metrics.ts).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { Admin, basicPassword } from '../src/admin.js';
import { Connection } from '../src/connection.js';
import { Metrics } from '../src/metrics.js';
import { RoomManager } from '../src/rooms.js';
import type { RunningServer } from '../src/index.js';

// Hoisted above the imports: `config.ts` reads the environment once, when first imported.
const PASSWORD = vi.hoisted(() => {
  const password = 'correct-horse-battery-staple';
  process.env.ADMIN_PASSWORD = password;
  process.env.ADMIN_FAILURE_BURST = '3';
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
  return password;
});
let server: RunningServer;

function auth(password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` };
}

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.startServer(0, '127.0.0.1');
});

afterAll(async () => {
  await server.close();
});

describe('the admin password', () => {
  it('asks for one, refuses a wrong one, and lets the right one in', async () => {
    const none = await fetch(`${server.url}/admin`);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Basic');

    const wrong = await fetch(`${server.url}/admin`, { headers: { ...auth('nope'), 'x-real-ip': '10.0.0.1' } });
    expect(wrong.status).toBe(401);

    const page = await fetch(`${server.url}/admin`, { headers: auth(PASSWORD) });
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toContain('GunBros Admin');

    const api = await fetch(`${server.url}/admin/api/live`);
    expect(api.status).toBe(401);
  });

  it('locks an address out after too many wrong passwords, and only that address', async () => {
    const from = { 'x-real-ip': '10.0.0.2' };
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${server.url}/admin`, { headers: { ...auth(`guess${i}`), ...from } });
      expect(r.status).toBe(401);
    }
    const locked = await fetch(`${server.url}/admin`, { headers: { ...auth(PASSWORD), ...from } });
    expect(locked.status).toBe(429);
    const other = await fetch(`${server.url}/admin`, { headers: { ...auth(PASSWORD), 'x-real-ip': '10.0.0.3' } });
    expect(other.status).toBe(200);
  });

  it('reads the password from a Basic header whatever the user name', () => {
    expect(basicPassword(`Basic ${Buffer.from('x:a:b').toString('base64')}`)).toBe('a:b');
    expect(basicPassword('Bearer abc')).toBeNull();
    expect(basicPassword(undefined)).toBeNull();
  });
});

describe('what the portal shows', () => {
  it('serves live counts and the history', async () => {
    const live = (await (await fetch(`${server.url}/admin/api/live`, { headers: auth(PASSWORD) })).json()) as {
      counts: { online: number };
      server: { version: string };
      rooms: unknown[];
    };
    expect(live.counts.online).toBe(0);
    expect(live.server.version).toBe('dev');
    expect(Array.isArray(live.rooms)).toBe(true);

    const history = (await (await fetch(`${server.url}/admin/api/history`, { headers: auth(PASSWORD) })).json()) as {
      t: number[];
      on: number[];
    };
    expect(history.t.length).toBe(history.on.length);
    expect(history.t.length).toBeGreaterThan(0);
  });

  it('lists a room with its players', () => {
    const manager = new RoomManager();
    const socket = { readyState: 1, bufferedAmount: 0, send: () => {}, terminate: () => {}, close: () => {} };
    const conn = new Connection(socket as unknown as WebSocket, '10.1.1.1');
    manager.handle(conn, { t: 'hello', nick: 'Bro' });
    manager.handle(conn, { t: 'createRoom', mapId: 'hills' });
    const admin = new Admin(manager, new Set([conn]), Date.now(), PASSWORD);
    const live = admin.live() as {
      counts: { online: number; rooms: number };
      rooms: { mapName: string; players: { nick: string; host: boolean; address: string }[] }[];
    };
    expect(live.counts).toMatchObject({ online: 1, rooms: 1 });
    expect(live.rooms[0]?.mapName).toBe('Rolling Hills');
    expect(live.rooms[0]?.players[0]).toMatchObject({ nick: 'Bro', host: true, address: '10.1.1.1' });
    manager.stop();
  });

  it('marks a practice bot, and does not count it as somebody online', () => {
    const manager = new RoomManager();
    const socket = { readyState: 1, bufferedAmount: 0, send: () => {}, terminate: () => {}, close: () => {} };
    const conn = new Connection(socket as unknown as WebSocket, '10.1.1.2');
    manager.handle(conn, { t: 'hello', nick: 'Solo' });
    manager.handle(conn, { t: 'createRoom', practice: true });
    const admin = new Admin(manager, new Set([conn]), Date.now(), PASSWORD);
    const live = admin.live() as {
      counts: { online: number };
      rooms: { players: { nick: string; bot: string | null; connected: boolean }[] }[];
    };
    expect(live.counts.online).toBe(1);
    expect(live.rooms[0]?.players.map((p) => p.bot)).toEqual([null, 'normal']);
    manager.stop();
  });

  it('is off without a password', async () => {
    const admin = new Admin(new RoomManager(), new Set(), Date.now(), '');
    expect(admin.enabled).toBe(false);
  });
});

describe('the stored history', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gunbros-metrics-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps one busiest row per minute and survives a restart', () => {
    const t0 = Date.UTC(2026, 8, 24, 12, 0, 0);
    const a = new Metrics(dir, t0);
    a.record({ on: 1, inMatch: 0, matches: 0, rooms: 1 }, t0 + 1_000);
    a.record({ on: 3, inMatch: 2, matches: 1, rooms: 1 }, t0 + 30_000);
    a.record({ on: 0, inMatch: 0, matches: 0, rooms: 0 }, t0 + 61_000);
    a.sessionStarted(t0);
    a.matchStarted(t0);
    a.matchEnded({
      room: 'ABCDE',
      mapId: 'hills',
      startedAt: t0,
      endedAt: t0 + 600_000,
      turns: 12,
      players: [],
      winnerTeam: 'A',
      reason: 'eliminated',
    });
    expect(a.samples).toHaveLength(2);
    expect(a.samples[0]).toMatchObject({ on: 3, inMatch: 2, matches: 1 });
    expect(a.totals.peakOnline).toBe(3);
    expect(a.lastActiveAt()).toBe(t0 + 60_000);
    a.save(t0 + 62_000);

    const b = new Metrics(dir, t0 + 3_600_000);
    expect(b.samples).toHaveLength(2);
    expect(b.matches[0]?.room).toBe('ABCDE');
    expect(b.totals).toMatchObject({ since: t0, sessions: 1, matchesStarted: 1, peakOnline: 3 });
    expect(b.totals.matchesEnded.eliminated).toBe(1);
    expect(b.days['2026-09-24']).toEqual({ sessions: 1, matches: 1 });
  });

  it('reads a record from before bots, and keeps a bot seat marked', () => {
    const old = mkdtempSync(join(tmpdir(), 'gunbros-metrics-old-'));
    try {
      const t0 = Date.UTC(2026, 8, 20, 12, 0, 0);
      writeFileSync(
        join(old, 'metrics.json'),
        JSON.stringify({
          version: 1,
          samples: [],
          matches: [
            {
              room: 'OLD01',
              mapId: 'hills',
              startedAt: t0,
              endedAt: t0 + 60_000,
              turns: 4,
              players: [{ nick: 'Ana', team: 'A', mobileId: 'armor' }],
              winnerTeam: 'A',
              reason: 'eliminated',
            },
          ],
          totals: { since: t0 },
          days: {},
        }),
      );
      const m = new Metrics(old, t0 + 120_000);
      expect(m.matches[0]?.players[0]).toEqual({ nick: 'Ana', team: 'A', mobileId: 'armor' });
      m.matchEnded({
        room: 'BOT01',
        mapId: 'hills',
        startedAt: t0,
        endedAt: t0 + 1,
        turns: 1,
        players: [
          { nick: 'Ana', team: 'A', mobileId: 'armor' },
          { nick: 'Rusty', team: 'B', mobileId: 'mage', bot: 'normal' },
        ],
        winnerTeam: 'A',
        reason: 'eliminated',
      });
      m.save(t0 + 2);
      const again = new Metrics(old, t0 + 3);
      expect(again.matches[0]?.players.map((p) => p.bot)).toEqual([undefined, 'normal']);
      expect(again.matches[1]?.room).toBe('OLD01');
    } finally {
      rmSync(old, { recursive: true, force: true });
    }
  });
});
