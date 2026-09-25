/** The reducer: createMatch / applyIntent / step, the only three mutators. */
import { describe, expect, it } from 'vitest';
import { createMatch, applyIntent, step, muzzlePosition, rerollWind } from '../src/match/reducer.js';
import { worldAngleDeg } from '../src/entities/mobile.js';
import { isSettled, livingTeams, mobileOfSeat } from '../src/match/match.js';
import type { SeatSpec } from '../src/match/match.js';
import { applySnapshot, hashState, takeSnapshot } from '../src/match/snapshot.js';
import { armor } from '../src/data/mobiles.js';
import type { ShotSlot } from '../src/data/mobiles.js';
import { registerBehaviour } from '../src/entities/behaviours/index.js';
import { makeWind } from '../src/rules/wind.js';
import { constants } from '../src/data/constants.js';
import type { MapDef } from '../src/data/maps.js';
import { hillsMap } from '../src/data/maps.js';
import { encodeRle } from '../src/terrain/codec.js';
import { flatTerrain } from './helpers.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
];

/** A flat arena, so the tests can talk about exact positions. */
const flatMap: MapDef = {
  ...hillsMap,
  id: 'testFlat',
  displayName: 'Test Flat',
  width: 1600,
  height: 900,
  source: { kind: 'mask', rle: encodeRle(flatTerrain(1600, 900, 600)) },
};

function settle(state: ReturnType<typeof createMatch>, maxTicks = 600): number {
  let ticks = 0;
  while (ticks < maxTicks) {
    step(state);
    ticks++;
    if (isSettled(state)) break;
  }
  return ticks;
}

describe('match reducer', () => {
  it('creates seats and mobiles standing on the ground', () => {
    const state = createMatch(11, flatMap, seats);
    expect(state.seats).toHaveLength(2);
    expect(state.mobiles).toHaveLength(2);
    expect(state.mode).toBe('freePlay');
    for (const m of state.mobiles) {
      expect(m.y).toBe(600);
      expect(m.alive).toBe(true);
      expect(m.hp).toBe(armor.hp);
      expect(state.terrain.isSolid(m.x, m.y)).toBe(true);
    }
    expect(state.mobiles[0]?.team).toBe('A');
    expect(state.mobiles[1]?.team).toBe('B');
    expect(livingTeams(state)).toEqual(['A', 'B']);
  });

  it('ignores intents for seats that do not exist', () => {
    const state = createMatch(11, flatMap, seats);
    const before = hashState(state);
    expect(applyIntent(state, { t: 'move', seat: 9, dir: 1 })).toEqual([]);
    expect(hashState(state)).toBe(before);
  });

  it('hashes the state that decides the next turn, so drift there is corrected', () => {
    type State = ReturnType<typeof createMatch>;
    const drifts: [string, (s: State) => void][] = [
      ['rng', (s) => s.rng.nextU32()],
      ['nextProjectileId', (s) => s.nextProjectileId++],
      ['nextMineId', (s) => s.nextMineId++],
      ['facing', (s) => { const m = s.mobiles[0]; if (m) m.facing = m.facing === 1 ? -1 : 1; }],
      ['tilt', (s) => { const m = s.mobiles[0]; if (m) m.tilt += 0.1; }],
      ['relAngle', (s) => { const m = s.mobiles[0]; if (m) m.relAngle += 3; }],
      ['moveDir', (s) => { const m = s.mobiles[0]; if (m) m.moveDir = 1; }],
      ['shot', (s) => { const slot = s.seats[1]; if (slot) slot.shot = 's2'; }],
    ];
    for (const [name, drift] of drifts) {
      const state = createMatch(11, flatMap, seats);
      const before = hashState(state);
      drift(state);
      expect(hashState(state), name).not.toBe(before);
    }
  });

  it('carries the walk input through a snapshot', () => {
    const server = createMatch(11, flatMap, seats);
    applyIntent(server, { t: 'move', seat: 0, dir: 1 });
    const client = createMatch(11, flatMap, seats);
    applySnapshot(client, takeSnapshot(server));
    expect(client.mobiles[0]?.moveDir).toBe(1);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('aims, clamps and remembers the selected shot', () => {
    const state = createMatch(11, flatMap, seats);
    applyIntent(state, { t: 'aim', seat: 0, relAngle: 33 });
    expect(state.mobiles[0]?.relAngle).toBe(33);
    applyIntent(state, { t: 'aim', seat: 0, relAngle: 999 });
    expect(state.mobiles[0]?.relAngle).toBe(armor.angleMax);
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    expect(state.seats[0]?.shot).toBe('ss');
  });

  it('walks a mobile while the move intent is held', () => {
    const state = createMatch(11, flatMap, seats);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const startX = m.x;
    applyIntent(state, { t: 'move', seat: 0, dir: 1 });
    for (let i = 0; i < 30; i++) step(state);
    expect(m.x).toBeGreaterThan(startX);
    applyIntent(state, { t: 'move', seat: 0, dir: 0 });
    const stopped = m.x;
    for (let i = 0; i < 30; i++) step(state);
    expect(m.x).toBe(stopped);
  });

  it('fires a projectile from the muzzle and quantises the power', () => {
    const state = createMatch(11, flatMap, seats);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const events = applyIntent(state, {
      t: 'fire',
      seat: 0,
      shot: 's1',
      relAngle: 45,
      power: 0.7777777,
    });
    expect(state.projectiles).toHaveLength(1);
    const fired = events.find((e) => e.t === 'fire');
    expect(fired?.t === 'fire' && fired.power).toBe(0.778);
    expect(events.some((e) => e.t === 'spawn')).toBe(true);

    const expected = muzzlePosition(m, armor, worldAngleDeg(m, 45));
    expect(state.projectiles[0]?.x).toBeCloseTo(expected.x, 9);
    expect(state.projectiles[0]?.y).toBeCloseTo(expected.y, 9);
    expect(m.anim.name).toBe('fire');
  });

  it('resolves a shot: it carves the ground and the projectile is gone', () => {
    const state = createMatch(11, flatMap, seats);
    state.wind = makeWind(0, 0); // a strong tail wind would carry it off the map edge
    const terrainBefore = state.terrain.hash();
    // 0.6 power: a full-power shell out-ranges this 1600 px test arena entirely.
    applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.6 });
    const events: string[] = [];
    let ticks = 0;
    while (ticks < 600) {
      for (const e of step(state)) events.push(e.t);
      ticks++;
      if (isSettled(state)) break;
    }
    expect(state.projectiles).toHaveLength(0);
    expect(events).toContain('explosion');
    expect(events).toContain('carve');
    expect(state.terrain.hash()).not.toBe(terrainBefore);
    expect(ticks).toBeLessThan(600);
  });

  it('damages a mobile inside the blast and can kill it', () => {
    const state = createMatch(11, flatMap, seats);
    const shooter = mobileOfSeat(state, 0);
    const target = mobileOfSeat(state, 1);
    if (!shooter || !target) throw new Error('no mobiles');
    target.x = shooter.x + 120;

    applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 0, power: 0.35 });
    const hits: number[] = [];
    let ticks = 0;
    while (ticks < 600) {
      for (const e of step(state)) if (e.t === 'hit') hits.push(e.hpLost);
      ticks++;
      if (isSettled(state)) break;
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(armor.hp);

    // Keep hitting it and it dies; the team list shrinks with it.
    target.hp = 40;
    applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: 0, power: 0.35 });
    settle(state);
    expect(target.alive).toBe(false);
    expect(livingTeams(state)).toEqual(['A']);
  });

  it('drops a mobile whose ground is blown away', () => {
    const state = createMatch(11, flatMap, seats);
    const m = mobileOfSeat(state, 1);
    if (!m) throw new Error('no mobile');
    const startY = m.y;
    // Blow a shaft under it, all the way through the floor.
    for (let y = startY; y < state.map.height; y += 30) {
      state.terrain.carve(m.x, y, 40);
    }
    settle(state, 400);
    expect(m.y).toBeGreaterThan(startY);
  });

  it('refills the move gauge in free play but not in turn mode', () => {
    const free = createMatch(11, flatMap, seats, { mode: 'freePlay' });
    const freeStart = free.mobiles[0]?.x ?? 0;
    applyIntent(free, { t: 'move', seat: 0, dir: 1 });
    for (let i = 0; i < 400; i++) step(free);
    // Topped up every tick, so it keeps walking well past one gauge worth of px.
    expect(free.mobiles[0]?.moveGauge).toBeGreaterThan(armor.moveGauge - armor.moveSpeed - 1e-9);
    expect((free.mobiles[0]?.x ?? 0) - freeStart).toBeCloseTo(400 * armor.moveSpeed, 6);

    // In `turns` mode the gauge is handed out once at turn start and never topped up
    // (DESIGN §2.4), and an intent only lands while the turn is `active`.
    const turns = createMatch(11, flatMap, seats, { mode: 'turns' });
    while (turns.phase !== 'active') step(turns);
    const turnStart = turns.mobiles[0]?.x ?? 0;
    applyIntent(turns, { t: 'move', seat: 0, dir: 1 });
    for (let i = 0; i < 400; i++) step(turns);
    expect(turns.mobiles[0]?.moveGauge).toBe(0);
    expect((turns.mobiles[0]?.x ?? 0) - turnStart).toBeCloseTo(armor.moveGauge, 6);
  });

  it('rolls wind from the match stream', () => {
    const state = createMatch(11, flatMap, seats);
    expect(state.wind.strength).toBeGreaterThanOrEqual(0);
    expect(state.wind.strength).toBeLessThanOrEqual(constants.wind.maxStrength);
    expect(state.wind.directionDeg).toBeGreaterThanOrEqual(0);
    expect(state.wind.directionDeg).toBeLessThan(360);

    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      rerollWind(state);
      seen.add(`${state.wind.strength}:${state.wind.directionDeg}`);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('spawns multi-shot counts with a spread', () => {
    const state = createMatch(11, flatMap, seats);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const def = { ...armor, shots: { ...armor.shots } };
    def.shots.s1 = { ...armor.shots.s1, count: 3, spreadDeg: 12 };
    // Fire through the same code path the data-driven mobiles will use in Phase 4.
    state.mobiles[0] = m;
    const original = armor.shots.s1;
    (armor.shots as { s1: typeof original }).s1 = def.shots.s1;
    try {
      applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 1 });
      expect(state.projectiles).toHaveLength(3);
      const angles = state.projectiles.map((p) => Math.atan2(-p.vy, p.vx));
      expect(angles[0]).not.toBeCloseTo(angles[2] as number, 3);
    } finally {
      (armor.shots as { s1: typeof original }).s1 = original;
    }
  });
  it('fires the right-hand mobile away from its own feet', () => {
    // The regression that started this: with `facing * relAngle` the right-hand spawn
    // (which faces left) aimed at -45 degrees and shelled the ground in front of itself.
    const state = createMatch(42, hillsMap, seats);
    const shooter = mobileOfSeat(state, 1);
    if (!shooter || shooter.facing !== -1) throw new Error('seat 1 should face left');
    state.wind = makeWind(0, 0);
    const startX = shooter.x;
    const hpBefore = shooter.hp;

    applyIntent(state, { t: 'fire', seat: 1, shot: 's1', relAngle: 45, power: 1 });
    expect(state.projectiles[0]?.vx ?? 0).toBeLessThan(0);
    expect(state.projectiles[0]?.vy ?? 0).toBeLessThan(0); // +y is down: it goes up

    let landedAt = Number.NaN;
    for (let i = 0; i < 600; i++) {
      for (const e of step(state)) if (e.t === 'explosion') landedAt = e.x;
      if (isSettled(state)) break;
    }
    expect(shooter.hp).toBe(hpBefore);
    if (!Number.isNaN(landedAt)) expect(landedAt).toBeLessThan(startX - 200);
  });

  it('ignores intents whose numbers are not finite', () => {
    const state = createMatch(11, flatMap, seats);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const angleBefore = m.relAngle;
    const xBefore = m.x;

    expect(applyIntent(state, { t: 'aim', seat: 0, relAngle: Number.NaN })).toEqual([]);
    expect(m.relAngle).toBe(angleBefore);

    expect(
      applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: 30,
        power: undefined as unknown as number,
      }),
    ).toEqual([]);
    expect(state.projectiles).toHaveLength(0);

    expect(
      applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: Number.NaN, power: 1 }),
    ).toEqual([]);
    expect(state.projectiles).toHaveLength(0);

    // A malformed walk direction stops the mobile rather than teleporting it to NaN.
    applyIntent(state, { t: 'move', seat: 0, dir: Number.NaN as unknown as -1 | 0 | 1 });
    for (let i = 0; i < 60; i++) step(state);
    expect(m.x).toBe(xBefore);
    expect(m.alive).toBe(true);
  });

  it('ignores an unknown shot slot instead of throwing', () => {
    const state = createMatch(11, flatMap, seats);
    const bogus = 's9' as ShotSlot;
    expect(() => applyIntent(state, { t: 'selectShot', seat: 0, shot: bogus })).not.toThrow();
    expect(state.seats[0]?.shot).toBe('s1');
    expect(
      applyIntent(state, { t: 'fire', seat: 0, shot: bogus, relAngle: 45, power: 1 }),
    ).toEqual([]);
    expect(state.projectiles).toHaveLength(0);
  });

  it('runs the behaviour onSpawn hook for every projectile it creates', () => {
    let spawned = 0;
    registerBehaviour('testOnSpawn', {
      onSpawn: (p) => {
        p.data.spawned = 1;
        spawned++;
      },
    });
    const state = createMatch(11, flatMap, seats);
    const original = armor.shots.s1;
    (armor.shots as { s1: typeof original }).s1 = {
      ...original,
      projectile: { ...original.projectile, behaviour: 'testOnSpawn' },
    };
    try {
      applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.5 });
      expect(spawned).toBe(1);
      expect(state.projectiles[0]?.data.spawned).toBe(1);
    } finally {
      (armor.shots as { s1: typeof original }).s1 = original;
    }
  });

  it('drains scheduled turn effects so a marked shot can still settle', () => {
    const state = createMatch(11, flatMap, seats);
    state.turnEffects.push({ kind: 'skyStrike', atTick: state.tick + 1, ownerSeat: 0, data: {} });
    expect(isSettled(state)).toBe(false);
    const ticks = settle(state, 120);
    expect(state.turnEffects).toHaveLength(0);
    expect(isSettled(state)).toBe(true);
    expect(ticks).toBeLessThan(10);
  });

  it('keeps state.events to the last step only', () => {
    const state = createMatch(11, flatMap, seats);
    step(state);
    const fired = applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.5 });
    expect(fired.some((e) => e.t === 'fire')).toBe(true);
    expect(state.events.some((e) => e.t === 'fire')).toBe(false);
    const stepped = step(state);
    expect(state.events).toBe(stepped);
  });
});
