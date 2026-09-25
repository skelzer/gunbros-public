/** DESIGN §2.1: one PRNG, seeded, reproducible, serialisable. */
import { describe, expect, it } from 'vitest';
import { Prng, seedState } from '../src/math/prng.js';

describe('prng', () => {
  it('is deterministic for a seed', () => {
    const a = Prng.seed(1234);
    const b = Prng.seed(1234);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('gives different streams for different seeds', () => {
    const a = Prng.seed(1234);
    const b = Prng.seed(1235);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBeLessThan(3);
  });

  it('produces uint32 values and floats in [0, 1)', () => {
    const r = Prng.seed(99);
    for (let i = 0; i < 5000; i++) {
      const u = r.nextU32();
      expect(Number.isInteger(u)).toBe(true);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(0xffffffff);
    }
    const f = Prng.seed(100);
    for (let i = 0; i < 5000; i++) {
      const v = f.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('keeps nextInt inside its inclusive bounds and covers them', () => {
    const r = Prng.seed(5);
    let lo = false;
    let hi = false;
    for (let i = 0; i < 5000; i++) {
      const v = r.nextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
      if (v === 3) lo = true;
      if (v === 7) hi = true;
    }
    expect(lo && hi).toBe(true);
    expect(r.nextInt(4, 4)).toBe(4);
  });

  it('round-trips its state, which is how a client replays a fire message', () => {
    const r = Prng.seed(42);
    for (let i = 0; i < 17; i++) r.nextU32();
    const state = r.getState();
    const expected = [r.nextU32(), r.nextU32(), r.nextU32()];

    const replay = new Prng(state);
    expect([replay.nextU32(), replay.nextU32(), replay.nextU32()]).toEqual(expected);

    r.setState(state);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toEqual(expected);

    const clone = new Prng(state).clone();
    expect([clone.nextU32(), clone.nextU32(), clone.nextU32()]).toEqual(expected);
  });

  it('never seeds the all-zero state', () => {
    for (const seed of [0, 1, 0xffffffff, -1, 123456789]) {
      const s = seedState(seed);
      expect(s.some((w) => w !== 0)).toBe(true);
    }
  });

  it('is roughly uniform', () => {
    const r = Prng.seed(2024);
    const buckets = new Array(10).fill(0) as number[];
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(r.nextFloat() * 10);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 100);
      expect(count).toBeLessThan(n / 10 + n / 100);
    }
  });
});
