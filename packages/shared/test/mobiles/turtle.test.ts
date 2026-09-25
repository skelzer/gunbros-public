/**
 * Deepshell (`turtle`) — the `converge` and `bubbleBurst` behaviours (DESIGN §3, §10).
 *
 * What is actually asserted here: S2 puts two balls in the air from one trigger pull and
 * their separation grows and then shrinks again (the flip), and SS bursts into exactly
 * twelve bubbles that drift with the wind and pop on their own.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import { turtle } from '../../src/data/mobiles/turtle.js';
import {
  createDuel,
  eventsOfType,
  findExplosions,
  fireAndResolve,
  hpOf,
  runTicks,
} from './helpers.js';

const HIT_ANGLE = 45;
const HIT_POWER = 0.57;

describe('turtle — Tide Split (S2, converge)', () => {
  it('fires two balls from one trigger pull', () => {
    const state = createDuel('turtle', 'armor', 201);
    applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: HIT_ANGLE, power: HIT_POWER });
    expect(state.projectiles).toHaveLength(2);
    const [a, b] = state.projectiles;
    if (!a || !b) throw new Error('no pair');
    // Same muzzle, mirrored lateral velocity.
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.data.side).toBe(1);
    expect(b.data.side).toBe(-1);
    const lateral = turtle.shots.s2.projectile.params?.lateral ?? 0;
    expect(a.vx - b.vx).toBeCloseTo(2 * lateral, 6);
  });

  it('spreads and then converges again', () => {
    const state = createDuel('turtle', 'armor', 202);
    applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: HIT_ANGLE, power: HIT_POWER });
    const flipTicks = turtle.shots.s2.projectile.params?.flipTicks ?? 0;
    const lateral = turtle.shots.s2.projectile.params?.lateral ?? 0;

    const separations: number[] = [];
    for (let i = 0; i < flipTicks * 2 + 2; i++) {
      step(state);
      const [a, b] = state.projectiles;
      if (!a || !b) break;
      separations.push(Math.abs(a.x - b.x));
    }
    expect(separations.length).toBeGreaterThan(flipTicks * 2);

    // Widest at the flip: the pair drifts apart at 2 * lateral px per tick.
    const widest = Math.max(...separations);
    const widestAt = separations.indexOf(widest);
    expect(widestAt).toBeGreaterThan(flipTicks - 3);
    expect(widestAt).toBeLessThan(flipTicks + 3);
    expect(widest).toBeCloseTo(2 * lateral * flipTicks, 0);

    // And back together one flip later — the whole point of the shot.
    const closedAgain = separations[flipTicks * 2] ?? widest;
    expect(closedAgain).toBeLessThan(widest * 0.15);
  });

  it('lands two water-typed hits', () => {
    const state = createDuel('turtle', 'armor', 203);
    const events = fireAndResolve(state, 0, 's2', HIT_ANGLE, HIT_POWER);
    expect(findExplosions(events)).toHaveLength(2);
    const hits = eventsOfType(events, 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.damageType).toBe('water');
    expect(hpOf(state, 1)).toBeLessThan(1100);
    expect(isSettled(state)).toBe(true);
  });
});

describe('turtle — Bubble Burst (SS)', () => {
  it('bursts into exactly twelve bubbles on the fuse', () => {
    const state = createDuel('turtle', 'armor', 204);
    const params = turtle.shots.ss.projectile.params ?? {};
    const fuse = turtle.shots.ss.projectile.lifetimeTicks ?? 0;

    applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: HIT_ANGLE, power: HIT_POWER });
    expect(state.projectiles).toHaveLength(1);
    const shell = state.projectiles[0];
    if (!shell) throw new Error('no shell');

    const events = runTicks(state, fuse - 1);
    expect(state.projectiles).toHaveLength(1);
    const burstX = shell.x;
    const burstY = shell.y;

    for (const e of step(state)) events.push(e);
    expect(state.projectiles).toHaveLength(params.bubbles ?? 0);
    const spawns = eventsOfType(events, 'spawn').filter((e) => e.sprite === 'bubble');
    expect(spawns).toHaveLength(12);

    // Thrown evenly around the circle, so the cloud is a ring, not a cone: measure
    // it around the ring's own centre, which has moved on with the shell.
    let cx = 0;
    let cy = 0;
    for (const bubble of state.projectiles) {
      cx += bubble.x / state.projectiles.length;
      cy += bubble.y / state.projectiles.length;
    }
    expect(Math.abs(cx - burstX)).toBeLessThan(20);
    expect(Math.abs(cy - burstY)).toBeLessThan(20);
    const near = (params.offsetPx ?? 0) + (params.burstSpeed ?? 0) * 2;
    let left = 0;
    let right = 0;
    let above = 0;
    let below = 0;
    for (const bubble of state.projectiles) {
      expect(Math.abs(bubble.x - cx)).toBeLessThanOrEqual(near);
      expect(Math.abs(bubble.y - cy)).toBeLessThanOrEqual(near);
      if (bubble.x < cx) left++;
      if (bubble.x > cx) right++;
      if (bubble.y < cy) above++;
      if (bubble.y > cy) below++;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
  });

  it('pops every bubble and settles the turn', () => {
    const state = createDuel('turtle', 'armor', 205);
    const events = fireAndResolve(state, 0, 'ss', HIT_ANGLE, HIT_POWER);
    // The burst plus the twelve bubbles, each of which goes off somewhere.
    expect(findExplosions(events).length).toBeGreaterThanOrEqual(10);
    expect(hpOf(state, 1)).toBeLessThan(1100);
    expect(isSettled(state)).toBe(true);
    expect(state.projectiles).toHaveLength(0);
  });

  it('lets the wind carry the cloud', () => {
    const still = createDuel('turtle', 'armor', 206);
    const windy = createDuel('turtle', 'armor', 206, {
      windStrength: 24,
      windDirectionDeg: 0,
    });
    const fuse = turtle.shots.ss.projectile.lifetimeTicks ?? 0;
    const drift = (state: ReturnType<typeof createDuel>): number => {
      applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: 70, power: 0.5 });
      runTicks(state, fuse + 40);
      let sum = 0;
      let n = 0;
      for (const bubble of state.projectiles) {
        sum += bubble.x;
        n++;
      }
      return n > 0 ? sum / n : 0;
    };
    const stillX = drift(still);
    const windyX = drift(windy);
    expect(stillX).toBeGreaterThan(0);
    expect(windyX).toBeGreaterThan(stillX + 20);
  });
});
