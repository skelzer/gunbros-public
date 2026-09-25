/**
 * Frostbite (`ice`) — the `debuff` and `shatter` behaviours (DESIGN §3, §10).
 *
 * What is actually asserted here: a hit stacks `defenceMod` on the target, a second hit
 * stacks more, the stack thaws at the victim's own turn start, the shot is ice-typed all
 * the way to the `hit` event, and the SS cracks open into exactly six shards.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled, mobileOfSeat } from '../../src/match/match.js';
import { constants } from '../../src/data/constants.js';
import { ice } from '../../src/data/mobiles/ice.js';
import {
  createDuel,
  eventsOfType,
  findExplosions,
  fireAndResolve,
  hpOf,
  runTicks,
} from './helpers.js';

/** A 45° shot at this power lands on the other mobile of a default duel. */
const HIT_ANGLE = 45;
const HIT_POWER = 0.56;

describe('ice — the chilling shot (debuff)', () => {
  it('stacks a defence debuff on what it damages and marks the frost', () => {
    const state = createDuel('ice', 'armor', 101);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    expect(target.defenceMod).toBe(0);

    const events = fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    expect(hpOf(state, 1)).toBeLessThan(1100);

    // The blast's own debuff, plus the frost bloom's second, smaller bite.
    const shot = ice.shots.s1.projectile;
    const linger = shot.params?.lingerDebuff ?? 0;
    expect(target.defenceMod).toBeCloseTo((shot.defenceDebuff ?? 0) + linger, 6);

    // The renderer gets a frost crosshair and the bloom's own burst.
    const marks = eventsOfType(events, 'mark');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]?.kind).toBe('frost');
    expect(marks[0]?.ticksUntil).toBe(shot.params?.lingerTicks);
    // One explosion for the shell, one for the bloom it left behind.
    expect(findExplosions(events).length).toBeGreaterThanOrEqual(2);
  });

  it('is ice-typed end to end, and S2 chills harder than S1', () => {
    const first = createDuel('ice', 'armor', 102);
    const hits = eventsOfType(fireAndResolve(first, 0, 's1', HIT_ANGLE, HIT_POWER), 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.damageType).toBe('ice');

    const second = createDuel('ice', 'armor', 102);
    fireAndResolve(second, 0, 's2', HIT_ANGLE, HIT_POWER);
    const chilledByS1 = mobileOfSeat(first, 1)?.defenceMod ?? 0;
    const chilledByS2 = mobileOfSeat(second, 1)?.defenceMod ?? 0;
    expect(chilledByS2).toBeGreaterThan(chilledByS1);
  });

  it('stacks again on the next hit, up to the cap', () => {
    const state = createDuel('ice', 'armor', 103);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    // Keep the target standing while it is hit over and over.
    target.hp = 1e6;

    fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    const afterOne = target.defenceMod;
    fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    expect(target.defenceMod).toBeGreaterThan(afterOne);

    for (let i = 0; i < 10; i++) fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    expect(target.defenceMod).toBe(constants.debuff.max);
  });

  it('thaws by one step at the victim\'s own turn start', () => {
    const state = createDuel('ice', 'armor', 104, { mode: 'turns' });
    // Turn 1 opens on the first step and spends `startingTicks` in the banner.
    runTicks(state, constants.turn.startingTicks + 1);
    expect(state.phase).toBe('active');
    expect(state.activeSeat).toBe(0);

    fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    const victim = mobileOfSeat(state, 1);
    if (!victim) throw new Error('no victim');
    const chilled = victim.defenceMod;
    expect(chilled).toBeGreaterThan(0);

    let opened = false;
    for (let i = 0; i < 600 && !opened; i++) {
      for (const e of step(state)) {
        if (e.t === 'turnStart' && e.seat === 1) opened = true;
      }
    }
    expect(opened).toBe(true);
    expect(victim.defenceMod).toBeCloseTo(chilled - constants.debuff.decayPerTurn, 6);
  });

  it('makes everything that follows hurt more', () => {
    const plain = createDuel('armor', 'armor', 105);
    const chilled = createDuel('armor', 'armor', 105);
    const target = mobileOfSeat(chilled, 1);
    if (!target) throw new Error('no target');
    target.defenceMod = ice.shots.s2.projectile.defenceDebuff ?? 0;

    for (const state of [plain, chilled]) {
      fireAndResolve(state, 0, 's1', HIT_ANGLE, 0.54);
    }
    const plainLost = 1100 - hpOf(plain, 1);
    const chilledLost = 1100 - hpOf(chilled, 1);
    expect(plainLost).toBeGreaterThan(0);
    expect(chilledLost).toBeGreaterThan(plainLost);
  });
});

describe('ice — Shatter (SS)', () => {
  it('cracks open on the fuse into exactly six shards', () => {
    const state = createDuel('ice', 'armor', 106);
    const fuse = ice.shots.ss.projectile.lifetimeTicks ?? 0;
    expect(fuse).toBeGreaterThan(0);

    // Fire, then watch the shell until the fuse runs out: it is still one projectile.
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: HIT_ANGLE, power: HIT_POWER });
    expect(state.projectiles).toHaveLength(1);
    const shell = state.projectiles[0];
    if (!shell) throw new Error('no shell');

    const events = [];
    for (let i = 0; i < fuse - 1; i++) for (const e of step(state)) events.push(e);
    expect(state.projectiles).toHaveLength(1);
    const crackX = shell.x;
    const crackY = shell.y;

    for (const e of step(state)) events.push(e);
    const shards = state.projectiles;
    expect(shards).toHaveLength(ice.shots.ss.projectile.params?.shards ?? 0);

    // They all leave from where the shell was, fanned around where it was going.
    for (const shard of shards) {
      expect(Math.abs(shard.x - crackX)).toBeLessThan(20);
      expect(Math.abs(shard.y - crackY)).toBeLessThan(20);
    }
    const spawns = eventsOfType(events, 'spawn').filter((e) => e.sprite === 'iceShard');
    expect(spawns).toHaveLength(6);
    // The crack itself is an explosion, before any shard has landed.
    expect(findExplosions(events)).toHaveLength(1);
  });

  it('rains the shards down and chills what they catch', () => {
    const state = createDuel('ice', 'armor', 107);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    const events = fireAndResolve(state, 0, 'ss', HIT_ANGLE, HIT_POWER);
    // The burst plus however many shards found ground: more than a plain shot's one.
    expect(findExplosions(events).length).toBeGreaterThan(3);
    expect(hpOf(state, 1)).toBeLessThan(1100);
    expect(target.defenceMod).toBeGreaterThan(0);
    expect(isSettled(state)).toBe(true);
  });
});
