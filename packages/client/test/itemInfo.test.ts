/**
 * The words the room and the HUD use to explain items (`ui/itemInfo.ts`). Every item
 * must have them, the numbers in them must be the shared data's, and the tagline must
 * be something the HUD's pixel font can spell and its caption line can hold.
 */
import { describe, expect, it } from 'vitest';
import { constants, getItemDef, itemDefs } from '@gunbros/shared';
import { itemCost, itemRules, itemText } from '../src/ui/itemInfo.js';
import { hasGlyphs } from '../src/ui/pixelFont.js';

describe('item explanations', () => {
  it('has a tagline and an effect for every item', () => {
    for (const def of itemDefs) {
      const text = itemText(def.id);
      expect(text.tagline.length, def.id).toBeGreaterThan(0);
      expect(text.effect.length, def.id).toBeGreaterThan(20);
    }
  });

  it('keeps the HUD caption short and spellable in the pixel font', () => {
    for (const def of itemDefs) {
      const caption = `${def.displayName.toLowerCase()}: ${itemText(def.id).tagline.toLowerCase()} · +${def.delay} delay`;
      expect(hasGlyphs(caption), caption).toBe(true);
      expect(caption.length, caption).toBeLessThanOrEqual(40);
      expect(itemText(def.id).tagline.length, def.id).toBeLessThanOrEqual(16);
    }
  });

  it('reads its numbers from the shared data', () => {
    expect(itemText('healSmall').tagline).toBe(`+${getItemDef('healSmall').params.heal} HP`);
    expect(itemText('healLarge').effect).toContain(String(getItemDef('healLarge').params.heal));
    const power = getItemDef('powerUp').params.damageMultiplier ?? 1;
    expect(itemText('powerUp').tagline).toBe(`+${Math.round((power - 1) * 100)}% damage`);
    const bunge = getItemDef('bunge').params;
    expect(itemText('bunge').effect).toContain(`${bunge.carveMultiplier}×`);
    expect(itemText('bunge').effect).toContain(`${Math.round((bunge.damageMultiplier ?? 1) * 100)}%`);
    const gap = Number((constants.items.dualGapTicks / constants.tickRate).toFixed(2));
    expect(itemText('dual').effect).toContain(`${gap} s`);
  });

  it('spells out cost and the shared rules', () => {
    expect(itemCost(getItemDef('dual'))).toBe(`2 slots · +${getItemDef('dual').delay} delay`);
    expect(itemCost(getItemDef('teleport'))).toBe(`1 slot · +${getItemDef('teleport').delay} delay`);
    expect(itemRules).toContain('one item per turn');
  });
});
