/**
 * Sky events (DESIGN §5, §10 `sky.test.ts`): the roll, Thor's trigger and levelling,
 * the tornado's capture and release, the Force band's multiplier, and the fact that all
 * of it is in the state hash.
 *
 * The arena is the flat 1600×900 test map with the ground at y = 600, `freePlay` mode
 * so any seat may fire at any time, and no wind — a sky test wants to assert "the beam
 * came down", not to fight the ballistics.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, createMatch, step } from '../src/match/reducer.js';
import { isSettled, mobileOfSeat } from '../src/match/match.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import { applySnapshot, hashState, takeSnapshot } from '../src/match/snapshot.js';
import { Prng } from '../src/math/prng.js';
import { makeWind } from '../src/rules/wind.js';
import { getMobileDef } from '../src/data/mobiles/index.js';
import type { MobileId } from '../src/data/mobiles/index.js';
import { settleOnGround } from '../src/entities/mobile.js';
import type { ProjectileState } from '../src/entities/projectile.js';
import type { SimEvent } from '../src/match/events.js';
import type { SkyEventId } from '../src/data/sky.js';
import { sky, skyEventIds, skyEventIndex, totalSkyWeight } from '../src/data/sky.js';
import {
  createSkyState,
  insideForceBand,
  insideTornado,
  rollSkyEvent,
  thorLevel,
  thorLevelForHits,
} from '../src/rules/sky.js';
import { caveMap, maps } from '../src/data/maps.js';
import { flatTestMap } from './helpers.js';
import { eventsOfType } from './mobiles/helpers.js';

const MAP = flatTestMap();
const GROUND_Y = 600;

/** One seat per team letter, all armor unless the caller names other mobiles. */
function seatSpecs(teams: readonly ('A' | 'B')[], mobiles?: readonly MobileId[]): SeatSpec[] {
  return teams.map((team, i) => ({
    playerId: `p${i}`,
    nick: `P${i}`,
    team,
    mobileId: mobiles?.[i] ?? 'armor',
  }));
}

/** A flat arena with the mobiles placed by hand and a chosen sky event. */
function arena(
  skyEvent: SkyEventId,
  teams: readonly ('A' | 'B')[],
  xs: readonly number[],
  seed = 777,
  mobiles?: readonly MobileId[],
): MatchState {
  const state = createMatch(seed, MAP, seatSpecs(teams, mobiles), {
    mode: 'freePlay',
    skyEvent,
  });
  state.wind = makeWind(0, 0);
  for (let seat = 0; seat < teams.length; seat++) {
    const m = mobileOfSeat(state, seat);
    if (!m) continue;
    m.x = xs[seat] ?? 400 + seat * 300;
    m.y = GROUND_Y - 40;
    settleOnGround(m, getMobileDef(m.defId), state.terrain);
  }
  return state;
}

/** The plain two-mobile duel every test but the teammate one uses. */
function duel(skyEvent: SkyEventId, seed = 777): MatchState {
  return arena(skyEvent, ['A', 'B'], [500, 1000], seed);
}

/** Fire seat `seat`'s S1 and hand back the shell it put in the air. */
function fireShell(state: MatchState, seat: number): ProjectileState {
  applyIntent(state, { t: 'fire', seat, shot: 's1', relAngle: 60, power: 0.4 });
  const p = state.projectiles[state.projectiles.length - 1];
  if (!p) throw new Error('no projectile');
  return p;
}

function run(state: MatchState, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const e of step(state)) events.push(e);
    if (isSettled(state)) break;
  }
  return events;
}

/**
 * Put a shell on top of `targetSeat` and let it fall, so the explosion happens where the
 * test says it does instead of wherever the trajectory took it. `fromY` lets a test
 * drop it from above the Force band.
 */
function explodeOn(
  state: MatchState,
  shooter: number,
  targetSeat: number,
  offsetX = 0,
  fromY?: number,
): SimEvent[] {
  const target = mobileOfSeat(state, targetSeat);
  if (!target) throw new Error('no target');
  const p = fireShell(state, shooter);
  p.x = target.x + offsetX;
  p.y = fromY ?? target.y - 90;
  p.vx = 0;
  p.vy = 6;
  p.data.leftOwner = 1;
  return run(state, 400);
}

function hpOf(state: MatchState, seat: number): number {
  return mobileOfSeat(state, seat)?.hp ?? 0;
}

describe('the sky event roll (DESIGN §5)', () => {
  it('is a pure function of the stream it is drawn from', () => {
    const a = rollSkyEvent(Prng.seed(12345));
    const b = rollSkyEvent(Prng.seed(12345));
    expect(a).toBe(b);
    const many = new Prng(Prng.seed(99).getState());
    const first = [rollSkyEvent(many), rollSkyEvent(many), rollSkyEvent(many)];
    const again = new Prng(Prng.seed(99).getState());
    expect([rollSkyEvent(again), rollSkyEvent(again), rollSkyEvent(again)]).toEqual(first);
  });

  it('only ever returns an id from the table, in roughly the table weights', () => {
    const counts = new Map<SkyEventId, number>();
    const rng = Prng.seed(4242);
    const rolls = 4000;
    for (let i = 0; i < rolls; i++) {
      const id = rollSkyEvent(rng);
      expect(skyEventIds).toContain(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = totalSkyWeight();
    for (const entry of sky.rollTable) {
      const share = (counts.get(entry.id) ?? 0) / rolls;
      expect(share).toBeGreaterThan(entry.weight / total - 0.05);
      expect(share).toBeLessThan(entry.weight / total + 0.05);
    }
  });

  it('places the tornado from the seed, inside the placement range, without touching the match PRNG', () => {
    const one = createSkyState('tornado', 4711, { width: MAP.width, height: MAP.height });
    const two = createSkyState('tornado', 4711, { width: MAP.width, height: MAP.height });
    expect(one.x).toBe(two.x);
    expect(one.x).toBeGreaterThanOrEqual(MAP.width * sky.placement.tornadoMinXFraction);
    expect(one.x).toBeLessThanOrEqual(MAP.width * sky.placement.tornadoMaxXFraction);
    const other = createSkyState('tornado', 4712, { width: MAP.width, height: MAP.height });
    expect(other.x).not.toBe(one.x);

    // DESIGN §7 item 39: `createMatch` has to leave the match stream in exactly the
    // same place on every engine, whatever the room rolled.
    const none = duel('none');
    const tornado = duel('tornado');
    expect(tornado.rng.getState()).toEqual(none.rng.getState());
  });

  it('builds the band and the satellite from the rolled id', () => {
    const force = duel('force');
    expect(force.sky.top).toBeCloseTo(MAP.height * sky.force.topFraction, 2);
    expect(force.sky.bottom).toBeCloseTo(MAP.height * sky.force.bottomFraction, 2);
    expect(insideForceBand(force.sky, (force.sky.top + force.sky.bottom) / 2)).toBe(true);
    expect(insideForceBand(force.sky, force.sky.bottom + 10)).toBe(false);

    const thor = duel('thor');
    expect(thor.sky.level).toBe(sky.thor.startLevel);
    expect(thorLevel(thor)).toBe(sky.thor.startLevel);

    const tornado = duel('tornado');
    expect(insideTornado(tornado.sky, tornado.sky.x)).toBe(true);
    expect(insideTornado(tornado.sky, tornado.sky.x + sky.tornado.halfWidth + 1)).toBe(false);
  });

  it('rebuilds the sky when the id is assigned after createMatch', () => {
    const late = duel('none');
    late.skyEventId = 'tornado';
    const early = duel('tornado');
    expect(late.sky).toEqual(early.sky);
    expect(late.skyEventId).toBe('tornado');
  });
});

describe('Thor (DESIGN §5)', () => {
  it('fires a beam when a blast goes off next to an enemy, and not otherwise', () => {
    const near = duel('thor');
    const strikes = eventsOfType(explodeOn(near, 0, 1), 'skyStrike');
    expect(strikes).toHaveLength(1);
    expect(strikes[0]?.level).toBe(1);
    expect(strikes[0]?.ownerSeat).toBe(0);
    expect(near.sky.hits).toBe(1);

    const far = duel('thor');
    const away = explodeOn(far, 0, 1, sky.thor.triggerRadius + 120);
    expect(eventsOfType(away, 'skyStrike')).toHaveLength(0);
    expect(far.sky.hits).toBe(0);
  });

  it('never triggers without the sky event, or next to the shooter\'s own team', () => {
    const noEvent = duel('none');
    expect(eventsOfType(explodeOn(noEvent, 0, 1), 'skyStrike')).toHaveLength(0);

    // Seats 0 and 1 are team A, seat 2 is team B: a blast on a teammate is not a trigger.
    const team = arena('thor', ['A', 'A', 'B'], [500, 620, 1100]);
    expect(eventsOfType(explodeOn(team, 0, 1), 'skyStrike')).toHaveLength(0);
    expect(team.sky.hits).toBe(0);
  });

  it('gains a level every thor.levelEveryHits strikes, up to the cap', () => {
    const state = duel('thor');
    const levels: number[] = [];
    const levelUps: number[] = [];
    const needed = sky.thor.levelEveryHits * (sky.thor.maxLevel - sky.thor.startLevel) + 2;
    for (let i = 0; i < needed; i++) {
      // Heal the target so the barrage never runs out of a mobile to trigger on.
      const target = mobileOfSeat(state, 1);
      if (target) {
        target.hp = getMobileDef(target.defId).hp;
        target.alive = true;
      }
      const events = explodeOn(state, 0, 1);
      for (const e of eventsOfType(events, 'skyStrike')) levels.push(e.level);
      for (const e of eventsOfType(events, 'skyLevelUp')) levelUps.push(e.level);
    }
    expect(levels.slice(0, sky.thor.levelEveryHits)).toEqual(
      new Array(sky.thor.levelEveryHits).fill(sky.thor.startLevel),
    );
    expect(levels[sky.thor.levelEveryHits]).toBe(sky.thor.startLevel + 1);
    expect(levelUps[0]).toBe(sky.thor.startLevel + 1);
    expect(state.sky.level).toBe(sky.thor.maxLevel);
    expect(thorLevel(state)).toBe(sky.thor.maxLevel);
    expect(thorLevelForHits(0)).toBe(sky.thor.startLevel);
    expect(thorLevelForHits(sky.thor.levelEveryHits)).toBe(sky.thor.startLevel + 1);
    expect(thorLevelForHits(sky.thor.levelEveryHits * 99)).toBe(sky.thor.maxLevel);
  });

  it('hurts more at a higher level, and hurts at all beyond the shot itself', () => {
    const plain = duel('none');
    explodeOn(plain, 0, 1);
    const plainLoss = getMobileDef('armor').hp - hpOf(plain, 1);

    const level1 = duel('thor');
    explodeOn(level1, 0, 1);
    const level1Loss = getMobileDef('armor').hp - hpOf(level1, 1);
    expect(level1Loss).toBeGreaterThan(plainLoss);

    const level5 = duel('thor');
    level5.sky.level = sky.thor.maxLevel;
    explodeOn(level5, 0, 1);
    const level5Loss = getMobileDef('armor').hp - hpOf(level5, 1);
    expect(level5Loss).toBeGreaterThan(level1Loss);
  });

  it('hands its level to aduka\'s call-in through the mark (DESIGN §7 item 9)', () => {
    /** Aim aduka's S2 at the ground next to the enemy and stop the tick it lands. */
    const markedLevel = (state: MatchState): number | undefined => {
      applyIntent(state, { t: 'selectShot', seat: 0, shot: 's2' });
      applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: 60, power: 0.4 });
      const p = state.projectiles[state.projectiles.length - 1];
      if (!p) throw new Error('no projectile');
      const target = mobileOfSeat(state, 1);
      p.x = (target?.x ?? 900) - 40;
      p.y = GROUND_Y - 120;
      p.vx = 0;
      p.vy = 8;
      p.data.leftOwner = 1;
      for (let i = 0; i < 60 && state.turnEffects.length === 0; i++) step(state);
      return state.turnEffects[0]?.data.skyThorLevel;
    };

    const levelled = arena('thor', ['A', 'B'], [500, 1000], 31, ['aduka', 'armor']);
    levelled.sky.level = 4;
    expect(markedLevel(levelled)).toBe(4);

    // No Thor in the sky: the call-in still works, at level 1 (DESIGN §7 item 9).
    const noEvent = arena('none', ['A', 'B'], [500, 1000], 31, ['aduka', 'armor']);
    expect(markedLevel(noEvent)).toBe(sky.thor.startLevel);
  });
});

describe('the tornado (DESIGN §5)', () => {
  /** Drop a shell into the column and hand back everything that happened. */
  function ride(state: MatchState): { p: ProjectileState; events: SimEvent[] } {
    const p = fireShell(state, 0);
    p.x = state.sky.x;
    p.y = 200;
    p.vx = 5;
    p.vy = 3;
    p.data.leftOwner = 1;
    const events = run(state, sky.tornado.holdTicks + 20);
    return { p, events };
  }

  it('captures a shell that enters the column and carries it up', () => {
    const state = duel('tornado');
    const p = fireShell(state, 0);
    p.x = state.sky.x;
    p.y = 200;
    p.vx = 5;
    p.vy = 3;
    p.data.leftOwner = 1;
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    const startY = p.y;

    const events = run(state, 5);
    const captures = eventsOfType(events, 'tornadoCapture');
    expect(captures).toHaveLength(1);
    expect(captures[0]?.id).toBe(p.id);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.data.tornadoHeld).toBe(1);
    expect(p.data.tornadoSpeed).toBeCloseTo(speed, 6);
    expect(p.x).toBe(state.sky.x);
    expect(p.y).toBeLessThan(startY);
  });

  it('releases it at the same speed, rotated from vertical, once the hold is over', () => {
    const state = duel('tornado');
    const { p, events } = ride(state);
    const releases = eventsOfType(events, 'tornadoRelease');
    expect(releases).toHaveLength(1);
    const release = releases[0];
    if (!release) throw new Error('no release');

    const capturedSpeed = p.data.tornadoSpeed ?? 0;
    const speed = Math.sqrt(release.vx * release.vx + release.vy * release.vy);
    expect(speed).toBeCloseTo(capturedSpeed, 6);
    // Up and to one side: the exit angle is measured from straight up.
    expect(release.vy).toBeLessThan(0);
    const ratio = Math.abs(release.vx) / Math.abs(release.vy);
    const expected =
      Math.abs(Math.sin((sky.tornado.exitAngleDeg * Math.PI) / 180)) /
      Math.abs(Math.cos((sky.tornado.exitAngleDeg * Math.PI) / 180));
    expect(ratio).toBeCloseTo(expected, 3);
  });

  it('lifts it by tornado.liftPx and only swallows it once', () => {
    const state = duel('tornado');
    const p = fireShell(state, 0);
    p.x = state.sky.x;
    p.y = 400;
    p.vx = 0;
    p.vy = 2;
    p.data.leftOwner = 1;
    const startY = p.y;
    const events = run(state, sky.tornado.holdTicks + 1);
    const releases = eventsOfType(events, 'tornadoRelease');
    expect(releases).toHaveLength(1);
    // Measured where it was let go: after that it is flying again, under its own speed.
    expect(startY - (releases[0]?.y ?? 0)).toBeCloseTo(sky.tornado.liftPx, 0);

    // Back into the column, and it flies straight through this time.
    p.x = state.sky.x;
    p.y = 400;
    p.vx = 0;
    p.vy = 2;
    const second = run(state, 10);
    expect(eventsOfType(second, 'tornadoCapture')).toHaveLength(0);
    expect(p.data.tornadoDone).toBe(1);
  });

  it('exits either way, depending on the match PRNG', () => {
    const signs = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const state = duel('tornado', seed);
      const { events } = ride(state);
      const release = eventsOfType(events, 'tornadoRelease')[0];
      if (release) signs.add(Math.sign(release.vx));
    }
    expect(signs.size).toBe(2);
  });

  it('leaves a shell outside the column alone', () => {
    const state = duel('tornado');
    const p = fireShell(state, 0);
    p.x = state.sky.x + sky.tornado.halfWidth + 30;
    p.y = 200;
    p.vx = 0;
    p.vy = 3;
    p.data.leftOwner = 1;
    const events = run(state, 5);
    expect(eventsOfType(events, 'tornadoCapture')).toHaveLength(0);
    expect(p.data.tornadoHeld ?? 0).toBe(0);
  });
});

describe('the Force band (DESIGN §5)', () => {
  /** The band is above the ground on the flat arena, so a falling shell crosses it. */
  function dropThroughBand(state: MatchState): SimEvent[] {
    return explodeOn(state, 0, 1, 0, state.sky.kind === 'force' ? state.sky.top + 2 : 200);
  }

  it('flags a shell that crosses it, once, and says so', () => {
    const state = duel('force');
    const p = fireShell(state, 0);
    p.x = 900;
    p.y = state.sky.top + 2;
    p.vx = 0;
    p.vy = 4;
    p.data.leftOwner = 1;
    const events = run(state, 400);
    const charged = eventsOfType(events, 'skyForce');
    expect(charged).toHaveLength(1);
    expect(charged[0]?.id).toBe(p.id);
  });

  it('multiplies the explosion damage by force.multiplier', () => {
    const plain = duel('none');
    dropThroughBand(plain);
    const plainLoss = getMobileDef('armor').hp - hpOf(plain, 1);

    const charged = duel('force');
    dropThroughBand(charged);
    const chargedLoss = getMobileDef('armor').hp - hpOf(charged, 1);

    expect(plainLoss).toBeGreaterThan(0);
    expect(chargedLoss / plainLoss).toBeCloseTo(sky.force.multiplier, 2);
  });

  it('leaves a shell that never entered the band alone', () => {
    const state = duel('force');
    const p = fireShell(state, 0);
    p.x = 900;
    // Below the band, on its way down: it never crosses it.
    p.y = state.sky.bottom + 40;
    p.vx = 0;
    p.vy = 4;
    p.data.leftOwner = 1;
    const events = run(state, 400);
    expect(eventsOfType(events, 'skyForce')).toHaveLength(0);
    expect(p.data.force ?? 0).toBe(0);
  });
});

describe('the sky is part of the state (DESIGN §2.1)', () => {
  it('changes the hash when the event, its placement or Thor\'s level differs', () => {
    const none = duel('none');
    const thor = duel('thor');
    const tornado = duel('tornado');
    expect(hashState(thor)).not.toBe(hashState(none));
    expect(hashState(tornado)).not.toBe(hashState(none));

    const levelled = duel('thor');
    expect(hashState(levelled)).toBe(hashState(thor));
    levelled.sky.level = 3;
    expect(hashState(levelled)).not.toBe(hashState(thor));
    levelled.sky.level = thor.sky.level;
    levelled.sky.hits = 2;
    expect(hashState(levelled)).not.toBe(hashState(thor));

    const moved = duel('tornado');
    moved.sky.x += 50;
    expect(hashState(moved)).not.toBe(hashState(tornado));

    expect(skyEventIndex('none')).toBe(0);
    expect(skyEventIndex('thor')).not.toBe(skyEventIndex('tornado'));
  });

  it('survives a snapshot round trip', () => {
    // No explosion first: `applySnapshot` deliberately leaves the terrain alone
    // (DESIGN §6.3 step 5), so a carved authority and a fresh client only compare once
    // the mask has been shipped too.
    const authority = duel('thor');
    authority.sky.level = 3;
    authority.sky.hits = 7;
    const snapshot = takeSnapshot(authority);
    expect(snapshot.sky.kind).toBe('thor');

    const client = duel('thor');
    applySnapshot(client, snapshot);
    expect(client.sky.level).toBe(3);
    expect(client.sky.hits).toBe(7);
    expect(hashState(client)).toBe(snapshot.stateHash);

    const tornadoAuthority = duel('tornado');
    const tornadoClient = duel('none');
    applySnapshot(tornadoClient, takeSnapshot(tornadoAuthority));
    expect(tornadoClient.sky.kind).toBe('tornado');
    expect(tornadoClient.sky.x).toBe(tornadoAuthority.sky.x);
  });
});

// --------------------------------------------------------------------------
// Placement against the real maps (DESIGN §7 item 129)
// --------------------------------------------------------------------------

describe('the tornado is placed clear of the spawns', () => {
  it('never drops the column on a seat, on any map, for 2 or 4 seats', () => {
    // The placement range alone was not enough: the nominal 1v1 slots sit at 0.3w and
    // 0.7w and the 2v2 ones at 0.4w and 0.6w, all inside it, so roughly one match in
    // six used to start with somebody standing in the funnel — every shell captured at
    // the muzzle and thrown back at them.
    const clearance = sky.placement.tornadoSpawnClearancePx;
    for (const map of maps) {
      for (const teams of [['A', 'B'], ['A', 'B', 'A', 'B']] as const) {
        for (let seed = 1; seed <= 120; seed++) {
          const state = createMatch(seed, map, seatSpecs(teams), {
            mode: 'turns',
            skyEvent: 'tornado',
          });
          for (const m of state.mobiles) {
            expect(Math.abs(m.x - state.sky.x)).toBeGreaterThanOrEqual(clearance);
            expect(insideTornado(state.sky, m.x)).toBe(false);
          }
          // …and it is still inside the range it was drawn from.
          expect(state.sky.x).toBeGreaterThanOrEqual(
            map.width * sky.placement.tornadoMinXFraction - 1,
          );
          expect(state.sky.x).toBeLessThanOrEqual(map.width * sky.placement.tornadoMaxXFraction + 1);
        }
      }
    }
  }, 120000);

  it('stays a pure function of (kind, seed, map, seats)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = createMatch(seed, caveMap, seatSpecs(['A', 'B']), {
        mode: 'turns',
        skyEvent: 'tornado',
      });
      // The engine that is told the event only afterwards lands on the same column.
      const b = createMatch(seed, caveMap, seatSpecs(['A', 'B']), { mode: 'turns' });
      b.skyEventId = 'tornado';
      expect(b.sky.x).toBe(a.sky.x);
    }
  });

  it('does not release a held shell inside the cave roof', () => {
    // `tornado.liftPx` (260) is taller than the cave's clearance, and the hold skips
    // the segment walk (DESIGN §7 item 121), so the lift has to stop under the rock.
    let captures = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const state = createMatch(seed, caveMap, seatSpecs(['A', 'B']), {
        mode: 'freePlay',
        skyEvent: 'tornado',
      });
      state.wind = makeWind(0, 0);
      const p = fireShell(state, 0);
      p.x = state.sky.x;
      p.y = (state.mobiles[0]?.y ?? 600) - 40;
      p.vx = 0;
      p.vy = -1;
      p.data.leftOwner = 1;
      const events = run(state, 600);
      for (const e of events) {
        if (e.t !== 'tornadoRelease') continue;
        captures++;
        expect(state.terrain.isSolid(e.x, e.y)).toBe(false);
      }
    }
    expect(captures).toBeGreaterThan(0);
  }, 60000);
});

// --------------------------------------------------------------------------
// The Force band reaches the payload, not only the shell (DESIGN §7 item 130)
// --------------------------------------------------------------------------

describe('the Force band and a mark-based shot', () => {
  /** Total hp taken off seat 1 by a lightning shell dropped through the band. */
  function boltDamage(skyEvent: SkyEventId): number {
    const state = arena(skyEvent, ['A', 'B'], [500, 1000], 4242, ['lightning', 'armor']);
    const before = hpOf(state, 1);
    // From above the band (0.25h = 225 on the 900 px test map) down onto the target.
    explodeOn(state, 0, 1, 0, 120);
    return before - hpOf(state, 1);
  }

  it('scales the bolt, not only the spotting shell', () => {
    const plain = boltDamage('none');
    const flagged = boltDamage('force');
    expect(plain).toBeGreaterThan(0);
    // Both halves of the shot are boosted, so the whole hit is worth the multiplier.
    // Before the fix the bolt — most of lightning's damage — ignored the band entirely.
    expect(flagged).toBeGreaterThan(plain * 1.3);
    expect(flagged).toBeLessThanOrEqual(plain * sky.force.multiplier + 1);
  });
});
