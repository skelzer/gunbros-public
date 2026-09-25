/**
 * Vortex (`jd`) — the pull (DESIGN §3, §7 item 70: an impulse is a velocity).
 *
 * What is asserted: everything inside the radius is thrown toward the centre and lands
 * again, the impulse points inward and falls off with distance, a mobile outside the
 * radius is untouched, and the SS drags further than the S2.
 */
import { describe, expect, it } from 'vitest';
import { mobileOfSeat } from '../../src/match/match.js';
import { createProjectile } from '../../src/entities/projectile.js';
import { pullBehaviour } from '../../src/entities/behaviours/pull.js';
import { armor } from '../../src/data/mobiles/armor.js';
import { jd } from '../../src/data/mobiles/jd.js';
import { constants } from '../../src/data/constants.js';
import { settleOnGround } from '../../src/entities/mobile.js';
import { getMobileDef } from '../../src/data/mobiles/index.js';
import { flatTerrain, makeArmor, makeTestContext } from '../helpers.js';
import { createDuel, eventsOfType, fireAndResolve, hpOf } from './helpers.js';

const HIT_ANGLE = 45;
/** Lands the shot short of the mobile at x = 1000, so the pull has a direction. */
const SHORT_POWER = 0.5;

describe('jd — Vortex', () => {
  it('throws every mobile in range toward the centre, in proportion to how close it is', () => {
    const terrain = flatTerrain(1600, 900, 600);
    const near = makeArmor(1, 640, 600);
    const far = makeArmor(2, 700, 600);
    const outside = makeArmor(3, 1200, 600);
    const ctx = makeTestContext(terrain, undefined, [near, far, outside]);
    const def = jd.shots.s2.projectile;
    const p = createProjectile(1, def, 0, 600, 600, 0, 0);

    pullBehaviour.onImpact?.(p, ctx, { x: 600, y: 600 });

    expect(ctx.impulses).toHaveLength(2); // the one 600 px away is out of reach
    const first = ctx.impulses[0];
    const second = ctx.impulses[1];
    if (!first || !second) throw new Error('no impulses');
    expect(first.seat).toBe(1);
    expect(second.seat).toBe(2);
    // Both are dragged left, toward the blast, and both are lifted off the ground.
    expect(first.dx).toBeLessThan(0);
    expect(second.dx).toBeLessThan(0);
    expect(first.dy).toBeLessThan(0);
    expect(second.dy).toBeLessThan(0);
    // Neither is thrown past the crater it is being pulled into: the horizontal
    // impulse is capped at the speed that covers the remaining distance in the flight
    // the lift buys (`2 * lift / gravity` ticks), which is what `overshootFactor` 1
    // means. Without the cap `pullStrength / dist` sends the nearest target furthest.
    // The far one is on the plain linear falloff; the near one is on the overshoot cap,
    // which is the whole point: `pullStrength / dist` would otherwise fling whatever is
    // closest the hardest and land it on the far side of the crater.
    const uncapped = (dx: number, dy: number): number => {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const falloff = 1 - dist / (def.params?.pullRadius ?? 1);
      return Math.abs(dx) * ((def.params?.pullStrength ?? 0) * falloff) / dist;
    };
    const dyToCentre = armor.footprint.h / 2;
    expect(Math.abs(first.dx)).toBeLessThan(uncapped(40, dyToCentre));
    expect(Math.abs(second.dx)).toBeCloseTo(uncapped(100, dyToCentre), 9);

    const pulls = eventsOfType(ctx.events, 'pull');
    expect(pulls).toHaveLength(1);
    expect(pulls[0]?.radius).toBe(def.params?.pullRadius);
    expect(pulls[0]?.ownerSeat).toBe(0);
  });

  it('drags a real mobile across the ground and puts it down again', () => {
    const state = createDuel('jd', 'armor', 51);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    const before = target.x;

    const events = fireAndResolve(state, 0, 's2', HIT_ANGLE, SHORT_POWER);
    const blast = eventsOfType(events, 'explosion')[0];
    if (!blast) throw new Error('no explosion');
    expect(blast.x).toBeLessThan(before); // the shot landed short of the target

    // It was pulled toward the blast, by more than a rounding error…
    expect(target.x).toBeLessThan(before - 8);
    // …and it is standing on the ground again, at rest, when the turn resolves.
    expect(target.grounded).toBe(true);
    expect(target.vx).toBeCloseTo(0, 9);
    expect(target.alive).toBe(true);
    expect(hpOf(state, 1)).toBeLessThan(1100);
  });

  it('never throws a target past the crater, however close it is standing', () => {
    // The failure this pins: `pullStrength / dist` has no ceiling, so the target nearest
    // the blast used to be flung the hardest and land on the *far* side of the centre —
    // a vortex that pushes. Checked at 20, 60 and 100 px, on both shots.
    for (const slot of ['s2', 'ss'] as const) {
      for (const gap of [20, 60, 100]) {
        const state = createDuel('jd', 'armor', 53);
        const shooter = mobileOfSeat(state, 0);
        const target = mobileOfSeat(state, 1);
        if (!shooter || !target) throw new Error('no duel');
        // Put the target `gap` px to the right of where the shell will land.
        const def = jd.shots[slot].projectile;
        const power = 0.5;
        const speed = def.speed * power;
        // Flat-ground range of a 45° shot: v² / g, both components at sin/cos 45.
        const range = (speed * speed) / (constants.gravity * def.gravity);
        const blastX = shooter.x + range;
        target.x = blastX + gap;
        settleOnGround(target, getMobileDef(target.defId), state.terrain);
        const beforeGap = Math.abs(target.x - blastX);

        fireAndResolve(state, 0, slot, HIT_ANGLE, power);
        const afterGap = Math.abs(target.x - blastX);
        expect(afterGap, `${slot} at ${gap} px`).toBeLessThanOrEqual(beforeGap);
        expect(target.alive).toBe(true);
      }
    }
  });

  it('pulls harder and further on the SS than on the S2', () => {
    const light = jd.shots.s2.projectile.params ?? {};
    const heavy = jd.shots.ss.projectile.params ?? {};
    expect(heavy.pullRadius).toBeGreaterThan(light.pullRadius ?? 0);
    expect(heavy.pullStrength).toBeGreaterThan(light.pullStrength ?? 0);
    expect(heavy.pullLift).toBeGreaterThan(light.pullLift ?? 0);

    const s2 = createDuel('jd', 'armor', 52);
    const ss = createDuel('jd', 'armor', 52);
    const startX = mobileOfSeat(s2, 1)?.x ?? 0;
    fireAndResolve(s2, 0, 's2', HIT_ANGLE, SHORT_POWER);
    fireAndResolve(ss, 0, 'ss', HIT_ANGLE, SHORT_POWER);
    const s2Moved = startX - (mobileOfSeat(s2, 1)?.x ?? 0);
    const ssMoved = startX - (mobileOfSeat(ss, 1)?.x ?? 0);
    expect(s2Moved).toBeGreaterThan(0);
    expect(ssMoved).toBeGreaterThan(s2Moved);
  });

  it('only lifts a mobile standing on the blast, which has no direction to give', () => {
    const terrain = flatTerrain(1600, 900, 600);
    const onTop = makeArmor(1, 600, 600);
    const ctx = makeTestContext(terrain, undefined, [onTop]);
    const def = jd.shots.ss.projectile;
    const p = createProjectile(1, def, 0, 600, 590, 0, 0);

    // The blast centre is the mobile's own hull centre: dx and dy are both ~0.
    pullBehaviour.onImpact?.(p, ctx, { x: 600, y: 590 });
    const impulse = ctx.impulses[0];
    if (!impulse) throw new Error('no impulse');
    expect(impulse.dx).toBe(0);
    expect(impulse.dy).toBeLessThan(0);
  });

  it('is a shielded control mobile whose S1 is the plain shot', () => {
    expect(jd.class).toBe('shielded');
    expect(jd.shieldMax).toBeGreaterThan(0);
    expect(jd.shots.s1.projectile.behaviour).toBe('basic');
    expect(jd.shots.s2.projectile.behaviour).toBe('pull');
    expect(jd.shots.ss.projectile.behaviour).toBe('pull');
    expect(jd.shots.ss.delay).toBeGreaterThan(jd.shots.s2.delay);
    expect(jd.shots.s2.delay).toBeGreaterThan(jd.shots.s1.delay);
  });
});
