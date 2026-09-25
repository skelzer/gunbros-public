/** DESIGN §10: falloff, table multipliers, shield absorption, debuff stacking. */
import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  computeDamage,
  falloff,
  typeMultiplier,
} from '../src/rules/damage.js';
// Sudden death moved to its own module in Phase 5 (`rules/suddenDeath.ts`): the turn
// machine announces it and must not have to import the damage rules to do so.
import { suddenDeathMultiplier } from '../src/rules/suddenDeath.js';
import { damageTable, damageTypes, mobileClasses } from '../src/data/damageTable.js';
import { constants } from '../src/data/constants.js';
import { armor } from '../src/data/mobiles.js';
import type { MobileDef } from '../src/data/mobiles.js';
import { makeArmor } from './helpers.js';

const shieldedDef: MobileDef = {
  ...armor,
  id: 'mage',
  class: 'shielded',
  shieldMax: 300,
  defence: 1,
};

describe('damage', () => {
  it('falls off linearly to zero at the damage radius', () => {
    expect(falloff(200, 0, 100)).toBe(200);
    expect(falloff(200, 50, 100)).toBe(100);
    expect(falloff(200, 99, 100)).toBeCloseTo(2, 9);
    expect(falloff(200, 100, 100)).toBe(0);
    expect(falloff(200, 500, 100)).toBe(0);
  });

  it('uses the damage type by mobile class table', () => {
    expect(typeMultiplier('explosive', 'mechanical')).toBe(1.0);
    expect(typeMultiplier('energy', 'shielded')).toBe(1.15);
    expect(typeMultiplier('fire', 'bionic')).toBe(1.2);
    expect(typeMultiplier('water', 'bionic')).toBe(0.9);
    for (const type of damageTypes) {
      for (const cls of mobileClasses) {
        expect(damageTable[type][cls]).toBeGreaterThan(0);
      }
    }
  });

  it('applies the table and the target defence to the falloff result', () => {
    const target = makeArmor(0, 0, 0);
    const base = computeDamage(200, 50, 100, 'explosive', armor, target);
    expect(base).toBeCloseTo(100 * 1.0 * armor.defence, 9);

    const energyVsShielded = computeDamage(200, 0, 100, 'energy', shieldedDef, target);
    expect(energyVsShielded).toBeCloseTo(200 * 1.15, 9);

    const tough: MobileDef = { ...armor, defence: 0.8 };
    expect(computeDamage(200, 0, 100, 'explosive', tough, target)).toBeCloseTo(160, 9);
  });

  it('scales with the stacked defence debuff', () => {
    const target = makeArmor(0, 0, 0);
    const clean = computeDamage(200, 0, 100, 'ice', armor, target);
    target.defenceMod = 0.08;
    const once = computeDamage(200, 0, 100, 'ice', armor, target);
    target.defenceMod = 0.16;
    const twice = computeDamage(200, 0, 100, 'ice', armor, target);
    expect(once).toBeCloseTo(clean * 1.08, 9);
    expect(twice).toBeCloseTo(clean * 1.16, 9);
  });

  it('multiplies by sudden death and item multipliers', () => {
    const target = makeArmor(0, 0, 0);
    const plain = computeDamage(200, 0, 100, 'explosive', armor, target);
    const boosted = computeDamage(200, 0, 100, 'explosive', armor, target, { extra: 1.5 });
    expect(boosted).toBeCloseTo(plain * 1.5, 9);

    expect(suddenDeathMultiplier(0)).toBe(1);
    expect(suddenDeathMultiplier(constants.suddenDeath.afterTurns)).toBe(
      constants.suddenDeath.multiplier,
    );
    expect(suddenDeathMultiplier(constants.suddenDeath.secondAfterTurns)).toBe(
      constants.suddenDeath.secondMultiplier,
    );
  });

  it('lets the shield absorb first, then hp', () => {
    const target = makeArmor(0, 0, 0);
    target.shield = 100;
    target.hp = 500;

    const partial = applyDamage(target, 60);
    expect(partial.shieldAbsorbed).toBe(60);
    expect(partial.hpLost).toBe(0);
    expect(target.shield).toBe(40);
    expect(target.hp).toBe(500);

    const through = applyDamage(target, 100);
    expect(through.shieldAbsorbed).toBe(40);
    expect(through.hpLost).toBe(60);
    expect(target.shield).toBe(0);
    expect(target.hp).toBe(440);
  });

  it('kills a mobile whose hp reaches zero and never goes negative', () => {
    const target = makeArmor(0, 0, 0);
    target.shield = 0;
    target.hp = 100;
    const killed = applyDamage(target, 1000);
    expect(killed.hpLost).toBe(100);
    expect(killed.died).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);

    const afterDeath = applyDamage(target, 50);
    expect(afterDeath.amount).toBe(0);
    expect(target.hp).toBe(0);
  });

  it('ignores damage outside the radius', () => {
    const target = makeArmor(0, 0, 0);
    expect(computeDamage(200, 120, 100, 'explosive', armor, target)).toBe(0);
    expect(applyDamage(target, 0).amount).toBe(0);
  });
});
