/**
 * Per-address limits (limits.ts): socket caps, room creation, code guessing, Origin.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { config } from '../src/config.js';
import { KeyedBucket, originAllowed } from '../src/limits.js';
import { startServer } from '../src/index.js';
import type { RunningServer } from '../src/index.js';
import { TestClient } from './testClient.js';

describe('KeyedBucket', () => {
  it('allows a burst, then refills at the steady rate, per key', () => {
    const bucket = new KeyedBucket(6, 3);
    const t0 = 1_000_000;
    expect([bucket.take('a', t0), bucket.take('a', t0), bucket.take('a', t0)]).toEqual([true, true, true]);
    expect(bucket.take('a', t0)).toBe(false);
    expect(bucket.take('b', t0)).toBe(true);
    // 6 per minute: one token every 10 s.
    expect(bucket.take('a', t0 + 9_000)).toBe(false);
    expect(bucket.take('a', t0 + 10_500)).toBe(true);
  });

  it('checks without spending, and forgets idle keys', () => {
    const bucket = new KeyedBucket(60, 1);
    expect(bucket.has('a', 0)).toBe(true);
    expect(bucket.has('a', 0)).toBe(true);
    bucket.take('a', 0);
    expect(bucket.has('a', 0)).toBe(false);
    bucket.sweep(120_000);
    expect(bucket.size).toBe(0);
  });
});

describe('originAllowed', () => {
  const req = (origin: string | undefined, host = 'game.example:8080') =>
    ({ headers: { origin, host } }) as unknown as IncomingMessage;

  it('allows the same origin and non-browser clients, refuses other sites', () => {
    expect(originAllowed(req('https://game.example:8080'))).toBe(true);
    expect(originAllowed(req(undefined))).toBe(true);
    expect(originAllowed(req('https://evil.example'))).toBe(false);
    expect(originAllowed(req('null'))).toBe(false);
  });

  it('accepts the page host a rewriting proxy forwards (the Vite dev server)', () => {
    const proxied = {
      headers: { origin: 'http://192.168.1.20:5173', host: 'localhost:8080', 'x-forwarded-host': '192.168.1.20:5173' },
    } as unknown as IncomingMessage;
    expect(originAllowed(proxied)).toBe(true);
  });

  it('allows the extra origins in ALLOWED_ORIGINS', () => {
    const saved = config.allowedOrigins;
    config.allowedOrigins = ['https://static.example'];
    try {
      expect(originAllowed(req('https://static.example'))).toBe(true);
    } finally {
      config.allowedOrigins = saved;
    }
  });
});

describe('server limits', () => {
  let server: RunningServer;
  const saved = { ...config };

  beforeEach(async () => {
    config.maxSocketsPerAddress = 3;
    config.roomCreateBurst = 2;
    config.roomCreatesPerMinute = 1;
    config.failedJoinBurst = 3;
    config.failedJoinsPerMinute = 1;
    server = await startServer(0, '127.0.0.1');
  });

  afterEach(async () => {
    await server.close();
    Object.assign(config, saved);
  });

  /** Resolves with the HTTP status the upgrade was refused with, or 101 if it opened. */
  function openStatus(headers: Record<string, string> = {}): Promise<{ status: number; ws: WebSocket }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(server.wsUrl, { headers });
      ws.once('open', () => resolve({ status: 101, ws }));
      ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0, ws }));
      ws.once('error', () => undefined);
    });
  }

  it('refuses a page from another site', async () => {
    const { status } = await openStatus({ Origin: 'https://evil.example' });
    expect(status).toBe(403);
    const same = await openStatus({ Origin: server.url.replace(/\/$/, '') });
    expect(same.status).toBe(101);
    same.ws.close();
  });

  it('caps sockets per address, and frees the slot when one closes', async () => {
    const open = [await openStatus(), await openStatus(), await openStatus()];
    expect(open.map((o) => o.status)).toEqual([101, 101, 101]);
    expect((await openStatus()).status).toBe(429);
    open[0]?.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const again = await openStatus();
    expect(again.status).toBe(101);
    for (const o of [...open, again]) o.ws.close();
  });

  it('rate-limits room creation per address', async () => {
    const c = await TestClient.connect(server.wsUrl, 'maker');
    try {
      const codes: string[] = [];
      for (let i = 0; i < 3; i++) {
        c.received.length = 0;
        c.send({ t: 'createRoom' });
        const reply = await c.wait((m) => m.t === 'roomState' || m.t === 'error');
        codes.push(reply.t === 'error' ? reply.code : 'ok');
      }
      expect(codes).toEqual(['ok', 'ok', 'rateLimited']);
    } finally {
      c.close();
    }
  });

  it('stops an address guessing room codes, even for a code that exists', async () => {
    const host = await TestClient.connect(server.wsUrl, 'host');
    const guesser = await TestClient.connect(server.wsUrl, 'guess');
    try {
      host.send({ t: 'createRoom' });
      const state = await host.wait((m) => m.t === 'roomState');
      if (state.t !== 'roomState') throw new Error('no room');
      const replies: string[] = [];
      for (const code of ['AAAAA', 'BBBBB', 'CCCCC', state.code]) {
        guesser.received.length = 0;
        guesser.send({ t: 'joinRoom', code });
        const reply = await guesser.wait((m) => m.t === 'roomState' || m.t === 'error');
        replies.push(reply.t === 'error' ? reply.code : 'joined');
      }
      expect(replies).toEqual(['noSuchRoom', 'noSuchRoom', 'noSuchRoom', 'rateLimited']);
    } finally {
      host.close();
      guesser.close();
    }
  });
});
