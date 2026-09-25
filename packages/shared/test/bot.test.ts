/**
 * The practice bot's half in the shared package (DESIGN §11, §7 items 187-189): the
 * match copy it plans on, the search, the score and the deliberate misses.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, createMatch, step } from '../src/match/reducer.js';
import type { SeatSpec } from '../src/match/match.js';
import { mobileOfSeat } from '../src/match/match.js';
import { hashState } from '../src/match/snapshot.js';
import { cloneMatchState } from '../src/match/clone.js';
import { Prng } from '../src/math/prng.js';
import { Terrain } from '../src/terrain/terrain.js';
import { makeWind } from '../src/rules/wind.js';
import { getMapDef } from '../src/data/maps.js';
import { getMobileDef } from '../src/data/mobiles.js';
import type { MobileId } from '../src/data/mobiles.js';
import { bots } from '../src/data/bots.js';
import {
  chooseShot,
  facingsTowardEnemies,
  fallbackShot,
  planShot,
  refineShot,
  simulateWalk,
  walkPositions,
} from '../src/bot/planner.js';
import type { BotPlan, BotShot } from '../src/bot/planner.js';
import type { MatchState } from '../src/match/match.js';
import { flatTestMap, maskMap } from './helpers.js';

function seats(a: MobileId, b: MobileId): SeatSpec[] {
  return [
    { playerId: 'p1', nick: 'one', team: 'A', mobileId: a },
    { playerId: 'p2', nick: 'two', team: 'B', mobileId: b },
  ];
}

/** A `turns` match stepped to its first `active` phase. */
function openTurn(state: MatchState): MatchState {
  for (let i = 0; i < 600 && state.phase !== 'active'; i++) step(state);
  expect(state.phase).toBe('active');
  return state;
}

function runPlan(
  state: MatchState,
  seat: number,
  useSs = true,
  walk: 'never' | 'whenStuck' | 'always' = 'always',
): BotPlan {
  const gen = planShot(state, seat, { useSs, walk });
  let next = gen.next();
  let yields = 0;
  while (!next.done) {
    yields++;
    next = gen.next();
  }
  // At least one yield per candidate (and one per simulated walk): that is what lets
  // the server budget it per tick.
  expect(yields).toBeGreaterThanOrEqual(next.value.evaluated);
  return next.value;
}

/**
 * Play a chosen shot on the live state the way the server does: walk for exactly its
 * ticks, stop, let it settle, face, fire, resolve. Returns the enemy's hp lost.
 */
function playShot(state: MatchState, seat: number, shot: BotShot): number {
  const m = mobileOfSeat(state, seat);
  if (!m) throw new Error('no mobile');
  if (shot.walk) {
    applyIntent(state, { t: 'move', seat, dir: shot.walk.dir });
    for (let i = 0; i < shot.walk.ticks; i++) step(state);
    applyIntent(state, { t: 'move', seat, dir: 0 });
    for (let i = 0; i < bots.walk.settleTicks || !m.grounded; i++) step(state);
  }
  if (shot.facing !== m.facing) {
    applyIntent(state, { t: 'move', seat, dir: shot.facing });
    applyIntent(state, { t: 'move', seat, dir: 0 });
  }
  const enemy = state.mobiles.find((e) => e.seat !== seat);
  const before = enemy?.hp ?? 0;
  applyIntent(state, { t: 'fire', seat, shot: shot.shot, relAngle: shot.relAngle, power: shot.power });
  for (let i = 0; i < 900 && state.phase === 'resolving'; i++) step(state);
  return before - (enemy?.hp ?? 0);
}

/**
 * A 1600x900 arena from a list of ground spans (x0, x1, top y), with the active seat's
 * mobile put at `me` and the other at `them`, both settled, in a still sky.
 */
function arena(spans: [number, number, number][], me: number, them: number): { state: MatchState; seat: number } {
  const terrain = new Terrain(1600, 900);
  for (const [x0, x1, top] of spans) for (let x = x0; x < x1; x++) terrain.fillColumnFrom(x, top);
  const state = openTurn(createMatch(13, maskMap('testArena', terrain), seats('armor', 'armor'), { mode: 'turns' }));
  state.wind = makeWind(0, 0);
  const seat = state.activeSeat;
  for (const m of state.mobiles) {
    m.x = m.seat === seat ? me : them;
    m.facing = m.seat === seat ? (them > me ? 1 : -1) : them > me ? -1 : 1;
    m.y = terrain.heightAt(m.x);
    m.vy = 0;
    m.tilt = 0;
    m.grounded = true;
  }
  return { state, seat };
}

/** Every object reachable from `root`, except through the keys that are shared on purpose. */
function objectsOf(root: unknown): Set<object> {
  const seen = new Set<object>();
  const walk = (value: unknown, key: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (key === 'map' || key === 'def') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof Terrain) {
      seen.add(value.mask);
      return;
    }
    if (value instanceof Prng) return;
    if (ArrayBuffer.isView(value)) return;
    for (const [k, v] of Object.entries(value)) walk(v, Array.isArray(value) ? key : k);
  };
  walk(root, '');
  return seen;
}

describe('cloneMatchState', () => {
  it('shares no mutable object with the live state', () => {
    const state = openTurn(createMatch(7, getMapDef('temple'), seats('raon', 'turtle'), { mode: 'turns' }));
    // Put something in every list, so the walk has projectiles and mines to compare.
    applyIntent(state, { t: 'fire', seat: state.activeSeat, shot: 's2', relAngle: 40, power: 0.6 });
    for (let i = 0; i < 20; i++) step(state);
    const copy = cloneMatchState(state);
    const live = objectsOf(state);
    for (const object of objectsOf(copy)) expect(live.has(object)).toBe(false);
    expect(copy.map).toBe(state.map);
    expect(copy.skyEventId).toBe(state.skyEventId);
    expect(hashState(copy)).toBe(hashState(state));
  });

  it('can be stepped, carved and drawn from without moving the live hash', () => {
    const state = openTurn(createMatch(21, getMapDef('hills'), seats('armor', 'armor'), { mode: 'turns' }));
    const before = hashState(state);
    const rngBefore = state.rng.getState();
    const copy = cloneMatchState(state, new Terrain(state.terrain.width, state.terrain.height));
    applyIntent(copy, { t: 'fire', seat: copy.activeSeat, shot: 's1', relAngle: 50, power: 0.8 });
    for (let i = 0; i < 400; i++) step(copy);
    copy.terrain.carve(400, 400, 80);
    copy.rng.nextU32();
    const m = mobileOfSeat(copy, 0);
    if (m) m.hp = 1;
    copy.skyEventId = 'tornado';
    expect(hashState(copy)).not.toBe(before);
    expect(hashState(state)).toBe(before);
    expect(state.rng.getState()).toEqual(rngBefore);
    expect(state.skyEventId).not.toBe('tornado');
  });
});

describe('planShot', () => {
  it('leaves the live state hash unchanged', () => {
    const state = openTurn(createMatch(3, getMapDef('glacier'), seats('boomer', 'mage'), { mode: 'turns' }));
    const before = hashState(state);
    const tick = state.tick;
    const plan = runPlan(state, state.activeSeat);
    expect(plan.evaluated).toBeGreaterThan(100);
    expect(plan.evaluated).toBeLessThanOrEqual(bots.search.maxCandidates);
    expect(hashState(state)).toBe(before);
    expect(state.tick).toBe(tick);
  });

  it('is deterministic: the same state gives the same plan', () => {
    const make = (): MatchState =>
      openTurn(createMatch(5, getMapDef('forge'), seats('armor', 'nak'), { mode: 'turns' }));
    const a = make();
    const b = make();
    const planA = runPlan(a, a.activeSeat);
    const planB = runPlan(b, b.activeSeat);
    expect(planA.ranked.slice(0, 5)).toEqual(planB.ranked.slice(0, 5));
  });

  it('Hard hits a stationary target on flat ground in no wind', () => {
    for (const mobileId of ['armor', 'mage', 'turtle'] as MobileId[]) {
      const state = openTurn(createMatch(11, flatTestMap(), seats(mobileId, 'armor'), { mode: 'turns' }));
      state.wind = makeWind(0, 0);
      const seat = state.activeSeat;
      const plan = runPlan(state, seat);
      const m = mobileOfSeat(state, seat);
      if (!m) throw new Error('no mobile');
      const shot = chooseShot(plan, bots.difficulties.hard, Prng.seed(1), getMobileDef(m.defId));
      expect(shot).not.toBeNull();
      if (!shot) continue;
      // On open flat ground there is nothing to walk for.
      expect(shot.walk).toBeNull();
      expect(playShot(state, seat, shot), `${mobileId} hit the target`).toBeGreaterThan(0);
      // …and not itself.
      expect(m.hp).toBe(getMobileDef(m.defId).hp);
    }
  });

  it('plans nothing when it is not that seat’s turn', () => {
    const state = openTurn(createMatch(9, flatTestMap(), seats('armor', 'armor'), { mode: 'turns' }));
    const other = state.activeSeat === 0 ? 1 : 0;
    const plan = runPlan(state, other);
    expect(plan.ranked).toEqual([]);
    expect(plan.done).toBe(true);
  });

  it('only tries the SS when it may and the gauge is full', () => {
    const state = openTurn(createMatch(4, flatTestMap(), seats('armor', 'armor'), { mode: 'turns' }));
    state.wind = makeWind(0, 0);
    const seat = state.activeSeat;
    const slot = state.seats[seat];
    if (!slot) throw new Error('no slot');
    expect(runPlan(state, seat).ranked.some((c) => c.shot === 'ss')).toBe(false);
    slot.ssGauge = 99;
    expect(runPlan(state, seat, false).ranked.some((c) => c.shot === 'ss')).toBe(false);
    expect(runPlan(state, seat, true).ranked.some((c) => c.shot === 'ss')).toBe(true);
  });
});

describe('walking (§7 item 190)', () => {
  // A wall 250 px tall three barrel-lengths in front of the bot: every shot from where it
  // stands goes into the wall, and 170 px back it clears it.
  const walled = (): { state: MatchState; seat: number } =>
    arena(
      [
        [0, 400, 600],
        [400, 420, 350],
        [420, 1600, 600],
      ],
      372,
      900,
    );

  it('a walled-in bot that cannot hit from where it stands walks and hits', () => {
    const { state, seat } = walled();
    const standing = runPlan(state, seat, true, 'never');
    expect(standing.ranked[0]?.score ?? 0, 'nothing hits from behind the wall').toBeLessThanOrEqual(0);

    const before = hashState(state);
    const plan = runPlan(state, seat);
    expect(hashState(state), 'planning a walk leaves the live state alone').toBe(before);
    const shot = chooseShot(plan, bots.difficulties.hard, Prng.seed(3), getMobileDef('armor'));
    if (!shot) throw new Error('no shot');
    expect(shot.walk?.dir).toBe(-1);
    expect(playShot(state, seat, shot)).toBeGreaterThan(0);
  });

  it('Easy only looks for a walk when nothing hits from where it stands', () => {
    const { state, seat } = walled();
    expect(runPlan(state, seat, false, 'whenStuck').ranked.some((c) => c.walk)).toBe(true);
    const open = openTurn(createMatch(11, flatTestMap(), seats('armor', 'armor'), { mode: 'turns' }));
    open.wind = makeWind(0, 0);
    expect(runPlan(open, open.activeSeat, false, 'whenStuck').ranked.some((c) => c.walk)).toBe(false);
  });

  it('never walks off a cliff, nor drops into a pit', () => {
    // A chasm to the bottom of the map in front, a 150 px drop behind.
    const { state, seat } = arena(
      [
        [0, 330, 750],
        [330, 520, 600],
        [720, 1600, 600],
      ],
      460,
      1200,
    );
    const m = mobileOfSeat(state, seat);
    if (!m) throw new Error('no mobile');
    const def = getMobileDef(m.defId);
    // Both edges are within one gauge's walk: the full walks would go over them.
    expect(simulateWalk(state, seat, { dir: 1, ticks: Math.ceil(m.moveGauge / def.moveSpeed) })).toBeNull();
    expect(simulateWalk(state, seat, { dir: -1, ticks: Math.ceil(m.moveGauge / def.moveSpeed) })).toBeNull();
    for (const p of walkPositions(state, seat)) {
      const pm = mobileOfSeat(p.state, seat);
      expect(pm?.alive).toBe(true);
      expect(pm?.x ?? 0).toBeGreaterThan(310);
      expect(pm?.x ?? 0).toBeLessThan(520);
    }
    // Even when walking is made to look irresistible.
    const saved = bots.walk.costPerPx;
    bots.walk.costPerPx = -5;
    try {
      const plan = runPlan(state, seat);
      const shot = chooseShot(plan, bots.difficulties.hard, Prng.seed(5), def);
      if (!shot) throw new Error('no shot');
      playShot(state, seat, shot);
      expect(m.alive).toBe(true);
      expect(m.x).toBeGreaterThan(310);
      expect(m.x).toBeLessThan(520);
    } finally {
      bots.walk.costPerPx = saved;
    }
  });

  it('re-aims from where the walk really ended', () => {
    const { state, seat } = walled();
    const plan = runPlan(state, seat);
    const shot = chooseShot(plan, bots.difficulties.hard, Prng.seed(3), getMobileDef('armor'));
    if (!shot?.walk) throw new Error('expected a walk');
    // Walk a little short, as a misjudged walk would, and refine from there.
    const short = { ...shot.walk, ticks: shot.walk.ticks - 12 };
    playShotWalkOnly(state, seat, short);
    const gen = refineShot(state, seat, shot);
    let next = gen.next();
    while (!next.done) next = gen.next();
    const refined = chooseShot(next.value, bots.difficulties.hard, Prng.seed(4), getMobileDef('armor'), {
      allowWalk: false,
    });
    if (!refined) throw new Error('no refined shot');
    expect(next.value.evaluated).toBeLessThan(40);
    expect(playShot(state, seat, refined)).toBeGreaterThan(0);
  });
});

function playShotWalkOnly(state: MatchState, seat: number, walk: { dir: -1 | 1; ticks: number }): void {
  const m = mobileOfSeat(state, seat);
  applyIntent(state, { t: 'move', seat, dir: walk.dir });
  for (let i = 0; i < walk.ticks; i++) step(state);
  applyIntent(state, { t: 'move', seat, dir: 0 });
  for (let i = 0; i < bots.walk.settleTicks || !m?.grounded; i++) step(state);
}

describe('facing', () => {
  it('faces every side an enemy is on, the current facing first', () => {
    const state = createMatch(2, flatTestMap(), [
      { playerId: 'a', nick: 'a', team: 'A', mobileId: 'armor' },
      { playerId: 'b', nick: 'b', team: 'B', mobileId: 'armor' },
      { playerId: 'c', nick: 'c', team: 'B', mobileId: 'armor' },
    ]);
    const [a, b, c] = state.mobiles;
    if (!a || !b || !c) throw new Error('no mobiles');
    a.x = 800;
    a.facing = 1;
    b.x = 200;
    c.x = 1400;
    expect(facingsTowardEnemies(state, 0)).toEqual([1, -1]);
    c.alive = false;
    expect(facingsTowardEnemies(state, 0)).toEqual([-1]);
    expect(fallbackShot(state, 0)).toMatchObject({ facing: -1, shot: 's1' });
  });
});

describe('chooseShot', () => {
  it('misses on purpose by the difficulty, from the bot’s own PRNG only', () => {
    const state = openTurn(createMatch(8, flatTestMap(), seats('armor', 'armor'), { mode: 'turns' }));
    state.wind = makeWind(0, 0);
    const seat = state.activeSeat;
    const plan = runPlan(state, seat);
    const best = plan.ranked[0];
    if (!best) throw new Error('no plan');
    const def = getMobileDef('armor');
    const rngBefore = state.rng.getState();
    const spread = (difficulty: 'easy' | 'normal' | 'hard'): number => {
      const rng = Prng.seed(42);
      let total = 0;
      for (let i = 0; i < 200; i++) {
        const shot = chooseShot(plan, bots.difficulties[difficulty], rng, def);
        if (!shot) throw new Error('no shot');
        total += Math.abs(shot.relAngle - best.relAngle) + 100 * Math.abs(shot.power - best.power);
        expect(shot.relAngle).toBeGreaterThanOrEqual(def.angleMin);
        expect(shot.relAngle).toBeLessThanOrEqual(def.angleMax);
        if (difficulty === 'easy') expect(shot.shot).not.toBe('ss');
      }
      return total / 200;
    };
    const easy = spread('easy');
    const normal = spread('normal');
    const hard = spread('hard');
    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
    expect(hard).toBeLessThan(1);
    expect(state.rng.getState()).toEqual(rngBefore);
  });

  it('returns null for an empty plan', () => {
    expect(chooseShot({ ranked: [], evaluated: 0, done: true }, bots.difficulties.hard, Prng.seed(1), getMobileDef('armor'))).toBeNull();
  });
});
