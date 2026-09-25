/**
 * Sapper (`raon`) — the walking mines (DESIGN §3, §7 item 8).
 *
 * What is asserted: a mine exists once the shot has resolved, it is standing on the
 * ground, it walks toward the enemy at the next turn start, it detonates when the enemy
 * is inside its trigger radius, it survives a snapshot round trip, it expires, and a
 * blast that takes the ground out from under it sets it off.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { applySnapshot, hashState, takeSnapshot } from '../../src/match/snapshot.js';
import { mobileOfSeat } from '../../src/match/match.js';
import type { MatchState } from '../../src/match/match.js';
import type { SimEvent } from '../../src/match/events.js';
import { createMine, minesShakenLoose, stepMinesTurnStart } from '../../src/entities/mines.js';
import { lightning } from '../../src/data/mobiles/lightning.js';
import { raon } from '../../src/data/mobiles/raon.js';
import { constants } from '../../src/data/constants.js';
import { turnHookKeys } from '../../src/rules/turn.js';
import { makeTestContext } from '../helpers.js';
import { createDuel, eventsOfType, fireAndResolve, hpOf, runTicks } from './helpers.js';

/** Power that drops a Sapper mine roughly 85 px short of the mobile at x = 1000. */
const DROP_POWER = 0.5;
/** Power that drops one about 200 px short, so the mine has several turns of walking. */
const FAR_DROP_POWER = 0.42;
const DROP_ANGLE = 45;

/**
 * The power that lands a flat-ground shot from `seat` at world x `targetX`, at 45°.
 * Range at 45° is `v² / g`, so `v = sqrt(range * g)` and `power = v / speed`.
 */
function powerToReach(
  state: MatchState,
  seat: number,
  def: { speed: number; gravity: number },
  targetX: number,
): number {
  const m = mobileOfSeat(state, seat);
  if (!m) throw new Error('no shooter');
  const range = Math.abs(targetX - m.x);
  return Math.sqrt(range * constants.gravity * def.gravity) / def.speed;
}

/** Step until `seat` is the one playing, skipping anyone else's turn. */
function playUntilActive(state: MatchState, seat: number, events: SimEvent[]): void {
  for (let i = 0; i < 3000; i++) {
    if (state.phase === 'active') {
      if (state.activeSeat === seat) return;
      applyIntent(state, { t: 'skip', seat: state.activeSeat });
    }
    for (const e of step(state)) events.push(e);
  }
  throw new Error(`seat ${seat} never got a turn`);
}

/** Step whole turns (everyone skipping) until `stop` says so or `turns` have passed. */
function playTurns(state: MatchState, turns: number, stop?: () => boolean): SimEvent[] {
  const events: SimEvent[] = [];
  let started = 0;
  for (let i = 0; i < 6000 && started < turns; i++) {
    if (state.phase === 'active') applyIntent(state, { t: 'skip', seat: state.activeSeat });
    for (const e of step(state)) {
      events.push(e);
      if (e.t === 'turnStart') started++;
    }
    if (stop && stop()) break;
  }
  return events;
}

describe('raon — Sapper', () => {
  it('drops a mine instead of only cratering, and stands it on the ground', () => {
    const state = createDuel('raon', 'armor', 31);
    const events = fireAndResolve(state, 0, 's2', DROP_ANGLE, DROP_POWER);

    expect(eventsOfType(events, 'mineSpawn')).toHaveLength(1);
    expect(state.mines).toHaveLength(1);
    const mine = state.mines[0];
    if (!mine) throw new Error('no mine');
    expect(mine.ownerSeat).toBe(0);
    expect(mine.damage).toBe(raon.shots.s2.projectile.params?.mineDamage);
    expect(mine.ttlTurns).toBe(raon.shots.s2.projectile.params?.mineTtlTurns);
    // It settled onto solid ground rather than hanging where the shell burst.
    expect(state.terrain.isSolid(mine.x, mine.y)).toBe(true);
    expect(state.terrain.isSolid(mine.x, mine.y - 1)).toBe(false);
    // A mine is persistent state, not a pending effect: the turn resolved with it there.
    expect(state.turnEffects).toHaveLength(0);
  });

  it('gives the SS a bigger, faster, longer-lived mine than the S2', () => {
    const light = raon.shots.s2.projectile.params ?? {};
    const heavy = raon.shots.ss.projectile.params ?? {};
    expect(heavy.mineDamage).toBeGreaterThan(light.mineDamage ?? 0);
    expect(heavy.mineSpeed).toBeGreaterThan(light.mineSpeed ?? 0);
    expect(heavy.mineTriggerRadius).toBeGreaterThan(light.mineTriggerRadius ?? 0);
    expect(heavy.mineTtlTurns).toBeGreaterThan(light.mineTtlTurns ?? 0);
    expect(raon.shots.ss.delay).toBeGreaterThan(raon.shots.s2.delay);
    expect(raon.shots.s2.delay).toBeGreaterThan(raon.shots.s1.delay);
  });

  it('walks the mine toward the enemy at the next turn start, then detonates on it', () => {
    const state = createDuel('raon', 'armor', 32, { mode: 'turns' });
    const events: SimEvent[] = [];
    playUntilActive(state, 0, events);
    fireAndResolve(state, 0, 's2', DROP_ANGLE, FAR_DROP_POWER);
    const mine = state.mines[0];
    if (!mine) throw new Error('no mine');
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    const startX = mine.x;
    expect(target.x - startX).toBeGreaterThan(mine.triggerRadius + mine.speed);

    // The next turn opens: every mine walks, whoever owns it (DESIGN §7 item 8).
    const walkEvents = playTurns(state, 1);
    const moves = eventsOfType(walkEvents, 'mineMove');
    expect(moves.length).toBeGreaterThan(0);
    expect(mine.x).toBeGreaterThan(startX);
    // It walked its whole allowance toward the enemy, along the surface.
    expect(mine.x - startX).toBeCloseTo(mine.speed, 3);
    expect(state.terrain.isSolid(mine.x, mine.y)).toBe(true);

    // A few turns later it is close enough to go off, and it hurts.
    const hpBefore = hpOf(state, 1);
    const later = playTurns(state, 6, () => state.mines.length === 0);
    const blasts = eventsOfType(later, 'mineExplode');
    expect(blasts.length).toBe(1);
    expect(state.mines).toHaveLength(0);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });

  it('carries the mine through a snapshot, hash included', () => {
    const server = createDuel('raon', 'armor', 33);
    fireAndResolve(server, 0, 's2', DROP_ANGLE, DROP_POWER);
    expect(server.mines).toHaveLength(1);

    const client = createDuel('raon', 'armor', 33);
    expect(hashState(client)).not.toBe(hashState(server));
    // A snapshot carries no terrain (DESIGN §6.3 step 5): the client asks for the mask
    // separately, and the state hash only agrees once it has it.
    client.terrain.replaceMask(server.terrain.mask.slice());
    applySnapshot(client, takeSnapshot(server));
    expect(client.mines).toHaveLength(1);
    expect(client.mines[0]?.id).toBe(server.mines[0]?.id);
    expect(client.mines[0]?.x).toBeCloseTo(server.mines[0]?.x ?? -1, 2);
    expect(client.nextMineId).toBe(server.nextMineId);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('expires after its ttl instead of sitting on the map forever', () => {
    const state = createDuel('raon', 'armor', 34, { mode: 'turns' });
    const mine = createMine({ x: 300, y: 600, ownerSeat: 0, ttlTurns: 2, triggerRadius: 4 });
    mine.id = state.nextMineId++;
    state.mines.push(mine);
    // Far from anybody and out of walking range of the enemy: only the clock can kill it.
    mine.speed = 0;

    playTurns(state, 3, () => state.mines.length === 0);
    expect(state.mines).toHaveLength(0);
  });

  it('does not let a mine that expired this turn be set off by a neighbour', () => {
    const state = createDuel('raon', 'armor', 39, { mode: 'turns' });
    const enemy = mobileOfSeat(state, 1);
    if (!enemy) throw new Error('no enemy');
    // A live mine on top of the enemy (triggers at turn start), and next to it one on
    // its last turn: it ages out at the same turn start and must simply vanish.
    const live = createMine({ x: enemy.x, y: enemy.y, ownerSeat: 0, radius: 30, speed: 0 });
    live.id = state.nextMineId++;
    const expiring = createMine({ x: enemy.x + 10, y: enemy.y, ownerSeat: 0, radius: 30, speed: 0, ttlTurns: 1 });
    expiring.id = state.nextMineId++;
    state.mines.push(live, expiring);

    // The first step opens turn 1, which runs the mines' turn-start hook.
    const events = step(state);
    const blasts = eventsOfType(events, 'mineExplode');
    expect(blasts.map((e) => e.id)).toEqual([live.id]);
    expect(state.mines).toHaveLength(0);
  });

  it('goes off when a blast takes the ground out from under it', () => {
    const state = createDuel('raon', 'armor', 35);
    const mine = createMine({ x: 700, y: 600, ownerSeat: 0 });
    mine.id = state.nextMineId++;
    state.mines.push(mine);
    const ctx = makeTestContext(state.terrain, undefined, state.mobiles);

    // Still standing on solid ground: nothing happens.
    minesShakenLoose(state, ctx);
    expect(state.mines).toHaveLength(1);

    // Something blew the hill away underneath it.
    state.terrain.carve(700, 610, 40);
    minesShakenLoose(state, ctx);
    expect(state.mines).toHaveLength(0);
    expect(eventsOfType(ctx.events, 'mineExplode')).toHaveLength(1);
  });

  it('goes off when any explosion lands inside its radius, before the turn ends', () => {
    // DESIGN §3: "Any explosion within its `radius` detonates it." The blast here is a
    // lightning seed, whose carve radius (14) is *smaller* than the mine's own radius —
    // the turn-end "left standing in mid-air" fallback cannot see a blast like that,
    // because the mine still has its ground.
    const state = createDuel('raon', 'lightning', 38);
    const mine = createMine({ x: 700, y: 600, ownerSeat: 0, radius: 22 });
    mine.id = state.nextMineId++;
    state.mines.push(mine);
    const seed = lightning.shots.s1.projectile;
    expect(seed.carveRadius).toBeLessThan(mine.radius);

    // Fired by seat 1 so the mine is an enemy mine and cannot simply be triggered by
    // proximity; the blast is what sets it off.
    const events = fireAndResolve(state, 1, 's1', 45, powerToReach(state, 1, seed, 720));
    const blasts = eventsOfType(events, 'mineExplode');
    expect(blasts).toHaveLength(1);
    expect(state.mines).toHaveLength(0);
    // And the client gets something to draw for it (DESIGN §8).
    const explosions = eventsOfType(events, 'explosion');
    expect(explosions.some((e) => Math.abs(e.x - 700) < 1 && Math.abs(e.y - 600) < 1)).toBe(true);
  });

  it('chains: one detonation sets off every mine inside its radius', () => {
    const state = createDuel('raon', 'armor', 36);
    for (const x of [700, 715, 900]) {
      const mine = createMine({ x, y: 600, ownerSeat: 0, radius: 24 });
      mine.id = state.nextMineId++;
      state.mines.push(mine);
    }
    const ctx = makeTestContext(state.terrain, undefined, state.mobiles);
    state.terrain.carve(700, 610, 40);
    minesShakenLoose(state, ctx);

    // The first two are within 15 px of each other; the third is 200 px away.
    expect(eventsOfType(ctx.events, 'mineExplode')).toHaveLength(2);
    expect(state.mines).toHaveLength(1);
    expect(state.mines[0]?.x).toBe(900);
  });

  it('registers its walk on the turn hook, not on the turn-effect queue', () => {
    expect(turnHookKeys()).toContain('mines');
    const state = createDuel('raon', 'armor', 37);
    const mine = createMine({ x: 600, y: 600, ownerSeat: 0, speed: 20, triggerRadius: 4 });
    mine.id = state.nextMineId++;
    state.mines.push(mine);
    const ctx = makeTestContext(state.terrain, undefined, state.mobiles);
    stepMinesTurnStart(state, ctx);
    // It walked toward seat 1, which stands to its right.
    expect(mine.x).toBeCloseTo(620, 3);
    expect(runTicks(state, 1)).toBeDefined();
  });
});
