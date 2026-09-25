/**
 * The roster's contract (DESIGN §3) and a smoke test of `test/mobiles/helpers.ts`.
 *
 * Phase 4's per-mobile tests go next to this file, one per mobile. This one guards the
 * things that are true of *every* mobile, so that a group agent adding a definition
 * cannot quietly break the id union, the Random pool or the sprite format.
 */
import { describe, expect, it } from 'vitest';
import {
  defOf,
  isMobileImplemented,
  isPickableMobile,
  mobileDefs,
  mobileIds,
  pickableMobiles,
  randomMobileId,
  randomPickWeightTotal,
  randomWeights,
  shotSlots,
} from '../../src/data/mobiles/index.js';
import { mobileClasses } from '../../src/data/damageTable.js';
import { behaviourKeys, getBehaviour } from '../../src/entities/behaviours/index.js';
import { validatePixelSprite } from '../../src/sprites/pixelArt.js';
import { mobileSprites } from '../../src/sprites/mobiles/index.js';
import { createDuel, fireAndResolve, findExplosions, hpOf, maskOf, carvedPixels } from './helpers.js';

describe('the roster', () => {
  it('has all 18 mobiles, each with a matching id', () => {
    expect(mobileDefs).toHaveLength(18);
    expect(mobileIds).toHaveLength(18);
    for (const def of mobileDefs) expect(def.id).toBe(def.id);
    expect(new Set(mobileIds).size).toBe(18);
  });

  it('gives every mobile a class, a distinct display name and three shots', () => {
    const names = new Set<string>();
    for (const def of mobileDefs) {
      expect(mobileClasses).toContain(def.class);
      expect(def.displayName.length).toBeGreaterThan(0);
      // The player-facing name is data, separate from the mechanical id (DESIGN §3);
      // armor is the one mobile whose name was chosen before that rule mattered.
      if (def.id !== 'armor') expect(def.displayName.toLowerCase()).not.toBe(def.id);
      expect(names.has(def.displayName)).toBe(false);
      names.add(def.displayName);
      for (const slot of shotSlots) {
        const shot = def.shots[slot];
        expect(shot.displayName.length).toBeGreaterThan(0);
        expect(shot.delay).toBeGreaterThan(0);
        expect(shot.projectile.damage).toBeGreaterThan(0);
        // Every shot names a behaviour that is actually registered.
        expect(getBehaviour(shot.projectile.behaviour ?? 'basic')).toBeDefined();
      }
      expect(def.hp).toBeGreaterThan(0);
      expect(def.angleMax).toBeGreaterThan(def.angleMin);
    }
  });

  it('keeps dragon and knight out of the hand-picked list (DESIGN §7 item 10)', () => {
    expect(defOf('dragon').randomOnly).toBe(true);
    expect(defOf('knight').randomOnly).toBe(true);
    expect(defOf('dragon').randomWeight).toBe(1);
    expect(defOf('knight').randomWeight).toBe(1);
    expect(isPickableMobile('dragon')).toBe(false);
    expect(isPickableMobile('knight')).toBe(false);
    expect(pickableMobiles()).toHaveLength(16);
    for (const def of pickableMobiles()) expect(def.randomWeight).toBe(10);
  });

  it('rolls the Random pool over every mobile, random-only included', () => {
    expect(randomWeights()).toHaveLength(18);
    expect(randomPickWeightTotal()).toBe(16 * 10 + 2);
    expect(randomMobileId(0)).toBe('armor');
    // The last two slices of the wheel are dragon and knight.
    expect(randomMobileId(0.999)).toBe('knight');
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(randomMobileId(i / 1000));
    expect(seen.size).toBe(18);
  });

  it('guards unknown ids', () => {
    expect(isMobileImplemented('armor')).toBe(true);
    expect(isMobileImplemented('nope')).toBe(false);
    expect(isPickableMobile('nope')).toBe(false);
    expect(() => defOf('nope' as never)).toThrow();
  });

  it('gives every mobile a well-formed sprite', () => {
    for (const id of mobileIds) {
      const sprite = mobileSprites[id];
      expect(sprite.kind).toBe('pixels');
      expect(validatePixelSprite(sprite), id).toEqual([]);
      expect(defOf(id).sprite).toBe(sprite);
      for (const colour of sprite.palette) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('registers every planned behaviour, looked up by its string key', () => {
    const keys = behaviourKeys();
    for (const key of [
      'basic',
      'weave',
      'shieldBreak',
      'burrow',
      'orbit',
      'mineDrop',
      'markThenBolt',
      'pull',
      'satellite',
      'debuff',
      'shatter',
      'converge',
      'bubbleBurst',
      'bounce',
      'thorCall',
      'split',
      'crawl',
      'markThenSwords',
    ]) {
      expect(keys, key).toContain(key);
      expect(getBehaviour(key)).toBeDefined();
    }
    expect(getBehaviour('nothingLikeThis')).toBeUndefined();
  });
});

describe('the mobile test helpers', () => {
  it('fires a shot that explodes, carves and hurts', () => {
    const state = createDuel('armor', 'armor', 4242);
    const before = maskOf(state);
    const hpBefore = hpOf(state, 1);
    // Flat ground, no wind, 400 px apart: at 45° this lands on the other mobile.
    const events = fireAndResolve(state, 0, 's1', 45, 0.54);
    const explosions = findExplosions(events);
    expect(explosions.length).toBeGreaterThan(0);
    expect(carvedPixels(before, maskOf(state))).toBeGreaterThan(0);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });
});
