/**
 * mage — Sorcerer (DESIGN §3): `weave` on S2, `shieldBreak` on SS.
 *
 * What is actually asserted here is the two things the data cannot say on its own: the
 * braid really is two bodies oscillating around one shared centre line (and that line
 * is the plain ballistic path), and the shield breaker really empties a shield rather
 * than only hitting it harder.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled, mobileOfSeat } from '../../src/match/match.js';
import { mage } from '../../src/data/mobiles/mage.js';
import { constants } from '../../src/data/constants.js';
import { shieldBreakBehaviour } from '../../src/entities/behaviours/shieldBreak.js';
import { createProjectile } from '../../src/entities/projectile.js';
import { flatTerrain, makeArmor, makeTestContext } from '../helpers.js';
import {
  createDuel,
  eventsOfType,
  fireAndResolve,
  hpOf,
  shieldOf,
  MAX_RESOLVE_TICKS,
} from './helpers.js';

const WEAVE = mage.shots.s2.projectile;

/** Fire and sample every live projectile's position once per tick. */
function trackShot(
  seat: number,
  shot: 's1' | 's2' | 'ss',
  relAngle: number,
  power: number,
  state: ReturnType<typeof createDuel>,
): Array<Array<{ id: number; x: number; y: number }>> {
  const frames: Array<Array<{ id: number; x: number; y: number }>> = [];
  applyIntent(state, { t: 'aim', seat, relAngle });
  applyIntent(state, { t: 'fire', seat, shot, relAngle, power });
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    step(state);
    frames.push(state.projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y })));
    if (isSettled(state)) break;
  }
  return frames;
}

describe('mage — the roster entry', () => {
  it('is a shielded caster with a shield that comes back', () => {
    expect(mage.class).toBe('shielded');
    expect(mage.shieldMax).toBeGreaterThan(0);
    expect(mage.shieldRegen).toBeGreaterThan(0);
    expect(mage.hp).toBeLessThan(1100);
  });

  it('orders its delays S1 < S2 < SS (DESIGN §2.8)', () => {
    expect(mage.shots.s1.delay).toBeLessThan(mage.shots.s2.delay);
    expect(mage.shots.s2.delay).toBeLessThan(mage.shots.ss.delay);
  });

  it('keeps every weave tunable in data, not in the behaviour module', () => {
    expect(WEAVE.behaviour).toBe('weave');
    expect(WEAVE.params?.amplitudePx).toBeGreaterThan(0);
    expect(WEAVE.params?.degPerSubStep).toBeGreaterThan(0);
    expect(mage.shots.s2.count).toBe(2);
    expect(mage.shots.s2.spreadDeg).toBe(0);
  });
});

describe('mage — Weave (S2)', () => {
  it('sends two bodies out of one trigger pull', () => {
    const state = createDuel('mage', 'armor', 21);
    const events = fireAndResolve(state, 0, 's2', 45, 0.54);
    expect(eventsOfType(events, 'spawn')).toHaveLength(2);
  });

  it('braids: the pair crosses its own centre line again and again', () => {
    const state = createDuel('mage', 'armor', 21);
    const frames = trackShot(0, 's2', 60, 0.6, state);

    // Signed lateral separation of the pair, per tick, while both are alive.
    const separations: number[] = [];
    for (const frame of frames) {
      if (frame.length !== 2) continue;
      const a = frame[0];
      const b = frame[1];
      if (!a || !b) continue;
      separations.push(a.x - b.x);
    }
    expect(separations.length).toBeGreaterThan(20);

    let crossings = 0;
    for (let i = 1; i < separations.length; i++) {
      const prev = separations[i - 1] ?? 0;
      const now = separations[i] ?? 0;
      if (prev === 0 || now === 0) continue;
      if (prev > 0 !== now > 0) crossings++;
    }
    expect(crossings).toBeGreaterThanOrEqual(2);

    // The braid is as wide as the data says and no wider.
    const amplitude = WEAVE.params?.amplitudePx ?? 0;
    let widest = 0;
    for (const s of separations) widest = Math.max(widest, Math.abs(s));
    expect(widest).toBeGreaterThan(amplitude);
    expect(widest).toBeLessThanOrEqual(2 * amplitude + 1);
  });

  it('leaves the shared centre line on the plain ballistic path', () => {
    const state = createDuel('mage', 'armor', 21);
    const frames = trackShot(0, 's2', 60, 0.6, state);

    const centres: Array<{ x: number; y: number }> = [];
    for (const frame of frames) {
      if (frame.length !== 2) continue;
      const a = frame[0];
      const b = frame[1];
      if (!a || !b) continue;
      centres.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    expect(centres.length).toBeGreaterThan(20);

    // No wind in the duel arena, so the centre of the braid accelerates by exactly
    // gravity downward and not at all sideways: the offsets cancel, tick after tick.
    for (let i = 2; i < centres.length; i++) {
      const p0 = centres[i - 2];
      const p1 = centres[i - 1];
      const p2 = centres[i];
      if (!p0 || !p1 || !p2) continue;
      expect(p2.x - 2 * p1.x + p0.x).toBeCloseTo(0, 6);
      expect(p2.y - 2 * p1.y + p0.y).toBeCloseTo(constants.gravity, 6);
    }
  });

  it('hurts with both halves of the braid', () => {
    const state = createDuel('mage', 'armor', 21);
    const before = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 's2', 45, 0.54);
    expect(eventsOfType(events, 'explosion').length).toBeGreaterThan(0);
    expect(hpOf(state, 1)).toBeLessThan(before);
  });
});

describe('mage — Shield Break (SS)', () => {
  it('strips the shield of everything it damaged, and nothing further out', () => {
    const terrain = flatTerrain(400, 300, 200);
    const near = makeArmor(1, 120, 200);
    const far = makeArmor(2, 380, 200);
    near.shield = 200;
    far.shield = 200;
    const ctx = makeTestContext(terrain, undefined, [near, far]);
    const p = createProjectile(1, mage.shots.ss.projectile, 0, 120, 180, 0, 0);

    const suppressed = shieldBreakBehaviour.onImpact?.(p, ctx, { x: 120, y: 180 });
    // It runs the blast itself, so the default explode must not run a second time.
    expect(suppressed).toBe(true);
    expect(ctx.explosions).toHaveLength(1);
    expect(near.shield).toBe(0);
    expect(far.shield).toBe(200);
    expect(p.alive).toBe(false);
  });

  it('empties a caster shield an ordinary bolt only dents', () => {
    const plain = createDuel('mage', 'mage', 33);
    const broken = createDuel('mage', 'mage', 33);
    expect(shieldOf(plain, 1)).toBe(mage.shieldMax);

    fireAndResolve(plain, 0, 's1', 45, 0.54);
    fireAndResolve(broken, 0, 'ss', 45, 0.54);

    expect(shieldOf(plain, 1)).toBeGreaterThan(0);
    expect(shieldOf(broken, 1)).toBe(0);
    expect(hpOf(broken, 1)).toBeLessThan(hpOf(plain, 1));
  });

  it('bites 2.5x into a shield through ProjectileDef.shieldDamageMultiplier', () => {
    expect(mage.shots.ss.projectile.shieldDamageMultiplier).toBe(2.5);
    const state = createDuel('mage', 'mage', 34);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    // A shield far larger than the blast: the strip is what empties it, and the
    // multiplier is what makes the hit worth taking in the first place.
    target.shield = 5000;
    fireAndResolve(state, 0, 'ss', 45, 0.54);
    expect(target.shield).toBe(0);
  });
});
