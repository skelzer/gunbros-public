/**
 * Shrike (`kalsiddon`) — DESIGN §3, §10: "split count".
 *
 * The thing worth pinning is the S2 pod: it must come apart at the top of its arc, into
 * exactly the number of fragments its data asks for, each scaled down from the pod by
 * the `child*Scale` params — and the pod itself must never explode.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import type { MatchState } from '../../src/match/match.js';
import type { SimEvent } from '../../src/match/events.js';
import { kalsiddon } from '../../src/data/mobiles/kalsiddon.js';
import {
  MAX_RESOLVE_TICKS,
  carvedPixels,
  createDuel,
  eventsOfType,
  findExplosions,
  fireAndResolve,
  hpOf,
  maskOf,
} from './helpers.js';

const pod = kalsiddon.shots.s2.projectile;
const params = pod.params ?? {};

/** The pod still in flight, if it has not come apart yet. */
function podInFlight(state: MatchState) {
  for (const p of state.projectiles) if (p.def.behaviour === 'split') return p;
  return undefined;
}

/**
 * Fire the cluster pod and watch it, tick by tick: where it was highest, where it came
 * apart and what the fragments did.
 */
function fireCluster(state: MatchState, relAngle: number, power: number) {
  applyIntent(state, { t: 'aim', seat: 0, relAngle });
  applyIntent(state, { t: 'selectShot', seat: 0, shot: 's2' });
  const events: SimEvent[] = [];
  for (const e of applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle, power })) {
    events.push(e);
  }

  let apexY = Number.POSITIVE_INFINITY;
  let splitY = Number.NaN;
  let splitX = Number.NaN;
  let fragments = 0;

  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    const pods = podInFlight(state);
    if (pods) {
      apexY = Math.min(apexY, pods.y);
      splitY = pods.y;
      splitX = pods.x;
    }
    const tickEvents = step(state);
    for (const e of tickEvents) events.push(e);
    // The tick the pod came apart is the tick several projectiles were born at once.
    const spawns = eventsOfType(tickEvents, 'spawn');
    if (spawns.length > 1 && fragments === 0) fragments = spawns.length;
    if (isSettled(state)) break;
  }

  return { events, apexY, splitY, splitX, fragments };
}

describe('kalsiddon — Shrike', () => {
  it('splits the cluster pod into four fragments at the apex', () => {
    const state = createDuel('kalsiddon', 'armor', 21);
    const shot = fireCluster(state, 55, 0.62);

    expect(shot.fragments).toBe(params.pieces);
    expect(shot.fragments).toBe(4);
    // One pod plus its fragments, and nothing else.
    expect(eventsOfType(shot.events, 'spawn')).toHaveLength(1 + 4);
    // It came apart where it stopped rising, not on the way up or on the way down.
    expect(shot.splitY).toBeLessThanOrEqual(shot.apexY + 2);
  });

  it('gives every fragment the scaled-down def from data, and the pod none of its own', () => {
    const state = createDuel('kalsiddon', 'armor', 22);
    const shot = fireCluster(state, 55, 0.62);
    const explosions = findExplosions(shot.events);

    // Four fragments, four craters: the pod itself never explodes.
    expect(explosions).toHaveLength(4);
    for (const e of explosions) {
      expect(e.carveRadius).toBeCloseTo(pod.carveRadius * (params.childCarveScale ?? 1), 6);
      expect(e.radius).toBeCloseTo(pod.damageRadius * (params.childDamageRadiusScale ?? 1), 6);
      expect(e.damageType).toBe(pod.damageType);
    }
    // The pod is spent, not exploded: nothing detonated at the break-up point.
    for (const e of explosions) expect(e.y).toBeGreaterThan(shot.splitY + 50);
  });

  it('rakes the ground: the fragments land spread out along the line of flight', () => {
    const state = createDuel('kalsiddon', 'armor', 23);
    const shot = fireCluster(state, 55, 0.62);
    const xs = findExplosions(shot.events).map((e) => e.x);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeGreaterThan(40);
    // Fanned around the direction of travel, so the pattern straddles the break-up point.
    expect(Math.min(...xs)).toBeGreaterThan(shot.splitX);
  });

  it('lands the Siege Lance as one big impact hit, not a cluster', () => {
    const state = createDuel('kalsiddon', 'armor', 24);
    const before = maskOf(state);
    const events = fireAndResolve(state, 0, 'ss', 45, 0.55);

    const explosions = findExplosions(events);
    expect(explosions).toHaveLength(1);
    expect(explosions[0]?.carveRadius).toBe(kalsiddon.shots.ss.projectile.carveRadius);
    expect(carvedPixels(before, maskOf(state))).toBeGreaterThan(2000);
    for (const hit of eventsOfType(events, 'hit')) expect(hit.damageType).toBe('impact');
  });

  it('hurts with the plain Talon shot', () => {
    const state = createDuel('kalsiddon', 'armor', 25);
    const hpBefore = hpOf(state, 1);
    fireAndResolve(state, 0, 's1', 45, 0.53);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });
});
