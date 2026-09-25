/**
 * Croaker (`jfrog`) — DESIGN §3, §10: "crawl distance".
 *
 * The S2 blob must stick where it lands and then walk the surface *in the direction it
 * was travelling* for exactly the distance its data asks for before it goes off — and it
 * must stop early for anything it walks into. The SS adds the burst of blobs at the end.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import type { MatchState } from '../../src/match/match.js';
import type { ShotSlot } from '../../src/data/mobiles/index.js';
import type { SimEvent } from '../../src/match/events.js';
import { jfrog } from '../../src/data/mobiles/jfrog.js';
import type { DuelOptions } from './helpers.js';
import {
  MAX_RESOLVE_TICKS,
  createDuel,
  eventsOfType,
  findExplosions,
  fireAndResolve,
  hpOf,
} from './helpers.js';

const creeper = jfrog.shots.s2.projectile;
const deluge = jfrog.shots.ss.projectile;

/**
 * Fire a crawling shot and note where the blob stuck to the ground — which is the point
 * every distance in these tests is measured from.
 */
function fireCrawler(state: MatchState, shot: ShotSlot, relAngle: number, power: number) {
  applyIntent(state, { t: 'aim', seat: 0, relAngle });
  applyIntent(state, { t: 'selectShot', seat: 0, shot });
  const events: SimEvent[] = [];
  for (const e of applyIntent(state, { t: 'fire', seat: 0, shot, relAngle, power })) {
    events.push(e);
  }

  let stuckX = Number.NaN;
  let stuckY = Number.NaN;
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    for (const p of state.projectiles) {
      if (p.data.crawling === 1 && Number.isNaN(stuckX)) {
        stuckX = p.x;
        stuckY = p.y;
      }
    }
    for (const e of step(state)) events.push(e);
    if (isSettled(state)) break;
  }
  return { events, stuckX, stuckY };
}

/** The enemy far enough away that a full crawl finishes in open ground. */
const farAway: DuelOptions = { xB: 1400 };

describe('jfrog — Croaker', () => {
  it('sticks to the ground and crawls exactly its crawlPx before exploding', () => {
    const state = createDuel('jfrog', 'armor', 41, farAway);
    const shot = fireCrawler(state, 's2', 45, 0.4);

    expect(Number.isNaN(shot.stuckX)).toBe(false);
    const explosions = findExplosions(shot.events);
    expect(explosions).toHaveLength(1);
    const boom = explosions[0];
    if (!boom) throw new Error('no explosion');

    // Fired to the right, so it walked to the right — the whole point of the shot.
    expect(boom.x).toBeGreaterThan(shot.stuckX);
    // The blob is first *seen* crawling at the start of the tick after it stuck, by
    // which point it has already taken up to one tick of sub-steps, so the measured
    // distance is `crawlPx` minus at most `4 * stepPx`.
    const crawlPx = creeper.params?.crawlPx ?? 0;
    const tickPx = 4 * (creeper.params?.stepPx ?? 0);
    expect(boom.x - shot.stuckX).toBeLessThanOrEqual(crawlPx);
    expect(boom.x - shot.stuckX).toBeGreaterThan(crawlPx - tickPx);
    expect(boom.x - shot.stuckX).toBeGreaterThan(80);
    // It stayed on the surface rather than burrowing or floating.
    expect(Math.abs(boom.y - shot.stuckY)).toBeLessThan(4);
    expect(boom.carveRadius).toBe(creeper.carveRadius);
  });

  it('never explodes at the point it landed', () => {
    const state = createDuel('jfrog', 'armor', 42, farAway);
    const shot = fireCrawler(state, 's2', 45, 0.4);
    for (const e of findExplosions(shot.events)) {
      expect(Math.abs(e.x - shot.stuckX)).toBeGreaterThan(50);
    }
  });

  it('stops early and goes off on anything it crawls into', () => {
    // Landing short of the enemy: the blob covers the rest of the ground itself.
    const state = createDuel('jfrog', 'armor', 43);
    const hpBefore = hpOf(state, 1);
    const shot = fireCrawler(state, 's2', 45, 0.5);

    const explosions = findExplosions(shot.events);
    expect(explosions).toHaveLength(1);
    const boom = explosions[0];
    if (!boom) throw new Error('no explosion');
    expect(boom.x - shot.stuckX).toBeLessThan(creeper.params?.crawlPx ?? 0);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });

  it('bursts the Deluge into blobs after a much longer crawl', () => {
    const state = createDuel('jfrog', 'armor', 44, farAway);
    const shot = fireCrawler(state, 'ss', 45, 0.45);
    const count = deluge.params?.splitCount ?? 0;

    // The crawler, then one blob per `splitCount`.
    expect(eventsOfType(shot.events, 'spawn')).toHaveLength(1 + count);

    const explosions = findExplosions(shot.events);
    expect(explosions).toHaveLength(1 + count);
    const main = explosions.filter((e) => e.carveRadius === deluge.carveRadius);
    const blobs = explosions.filter((e) => e.carveRadius !== deluge.carveRadius);
    expect(main).toHaveLength(1);
    expect(blobs).toHaveLength(count);
    for (const blob of blobs) {
      expect(blob.carveRadius).toBeCloseTo(
        deluge.carveRadius * (deluge.params?.childCarveScale ?? 1),
        6,
      );
    }
    // The Deluge crawls further than the Creeper does.
    expect(main[0]?.x ?? 0).toBeGreaterThan(shot.stuckX + (creeper.params?.crawlPx ?? 0));
  });

  it('throws plain water slime on S1', () => {
    const state = createDuel('jfrog', 'armor', 45);
    const hpBefore = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 's1', 45, 0.55);
    expect(findExplosions(events)).toHaveLength(1);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
    for (const hit of eventsOfType(events, 'hit')) expect(hit.damageType).toBe('water');
  });
});
