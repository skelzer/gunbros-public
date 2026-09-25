/**
 * The static file server (DESIGN §1.5).
 *
 * The HTTP half of the process is not part of the game, but it is the half that is
 * exposed to everything on the internet that is not a player: scanners send paths with
 * malformed percent-escapes within minutes of a host going public, and rooms live only
 * in this process's memory, so one request that ends the process ends every match on
 * it. These tests are about that: whatever arrives, the server answers and keeps
 * serving.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRange } from '../src/range.js';
import type { RunningServer } from '../src/index.js';

let server: RunningServer;
let dist: string;

beforeAll(async () => {
  // A fake client bundle, so the static routes are live (without one the server answers
  // 404 to everything and none of this is reachable).
  dist = mkdtempSync(join(tmpdir(), 'gunbros-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>GunBros</title>\n');
  writeFileSync(join(dist, 'app.js'), 'export const ok = 1;\n');
  // Stands in for a music track: 100 bytes, each one its own index.
  writeFileSync(join(dist, 'track.mp3'), Uint8Array.from({ length: 100 }, (_, i) => i));
  process.env.CLIENT_DIST = dist;
  // Imported *after* the environment is set: `config.ts` reads it once, at import.
  const mod = await import('../src/index.js');
  server = await mod.startServer(0, '127.0.0.1');
});

afterAll(async () => {
  await server.close();
  rmSync(dist, { recursive: true, force: true });
});

describe('the static file server', () => {
  it('serves the bundle and falls back to index.html for client routes', async () => {
    const index = await fetch(`${server.url}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('GunBros');

    const asset = await fetch(`${server.url}/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');

    // `/r/CODE` is a client route, not a file (DESIGN §1.5 SPA fallback).
    const route = await fetch(`${server.url}/r/ABCDE`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('GunBros');

    const missing = await fetch(`${server.url}/nope.js`);
    expect(missing.status).toBe(404);
  });

  it('answers a malformed percent-escape with 400 and stays up', async () => {
    // `decodeURIComponent` throws on this; unguarded, the throw is an uncaught
    // exception in the request handler and the process exits with every room in it.
    const bad = await fetch(`${server.url}/%E0%A4%A`);
    expect(bad.status).toBe(400);

    const alsoBad = await fetch(`${server.url}/%`);
    expect(alsoBad.status).toBe(400);

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('refuses to serve anything outside the bundle', async () => {
    const escape = await fetch(`${server.url}/..%2f..%2f..%2fetc%2fpasswd`);
    expect([400, 404]).toContain(escape.status);

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
  });

  it('rejects a method it does not serve', async () => {
    const posted = await fetch(`${server.url}/`, { method: 'POST' });
    expect(posted.status).toBe(405);
  });
});

/**
 * Byte ranges (DESIGN §8.3). Safari refuses to play a media file from a server that
 * answers its opening `Range: bytes=0-1` with the whole file, so the music depends on
 * these being honoured.
 */
describe('byte ranges', () => {
  const bytes = async (res: Response): Promise<number[]> => [...new Uint8Array(await res.arrayBuffer())];

  it('serves a track whole, as audio, and says it takes ranges', async () => {
    const res = await fetch(`${server.url}/track.mp3`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect((await bytes(res)).length).toBe(100);
  });

  it("answers Safari's opening probe with just those two bytes", async () => {
    const res = await fetch(`${server.url}/track.mp3`, { headers: { range: 'bytes=0-1' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-1/100');
    expect(await bytes(res)).toEqual([0, 1]);
  });

  it('serves an open-ended range and a suffix', async () => {
    const tail = await fetch(`${server.url}/track.mp3`, { headers: { range: 'bytes=95-' } });
    expect(tail.status).toBe(206);
    expect(await bytes(tail)).toEqual([95, 96, 97, 98, 99]);

    const suffix = await fetch(`${server.url}/track.mp3`, { headers: { range: 'bytes=-3' } });
    expect(suffix.headers.get('content-range')).toBe('bytes 97-99/100');
    expect(await bytes(suffix)).toEqual([97, 98, 99]);
  });

  it('refuses a range past the end with 416 and stays up', async () => {
    const res = await fetch(`${server.url}/track.mp3`, { headers: { range: 'bytes=500-' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */100');
    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
  });

  it('ignores a range it does not understand and sends the whole file', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('bytes=9-2', 100)).toBeNull();
    expect(parseRange('bytes=10-5000', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});
