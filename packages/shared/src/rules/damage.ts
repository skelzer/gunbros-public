/**
 * Damage resolution (DESIGN §2.6).
 *
 *   raw   = damage * max(0, 1 - dist / damageRadius)
 *   typed = raw * damageTable[damageType][target class]
 *   final = typed * target defence * (1 + defenceDebuff) * extra multipliers
 *   shield absorbs min(shield, final); the remainder hits hp
 *
 * The "extra multipliers" — sudden death, the Power Up and Bunge items, the Force sky
 * band — are computed by their own rules and handed in through {@link DamageMultipliers};
 * this module does not know about any of them (`rules/suddenDeath.ts`, `rules/items.ts`).
 */
import { damageTable } from '../data/damageTable.js';
import type { DamageType, MobileClass } from '../data/damageTable.js';
import type { MobileDef } from '../data/mobiles.js';
import type { MobileState } from '../entities/mobile.js';

/** Linear falloff from full damage at the centre to 0 at `radius`. */
export function falloff(damage: number, dist: number, radius: number): number {
  if (radius <= 0) return dist === 0 ? damage : 0;
  const k = 1 - dist / radius;
  return k <= 0 ? 0 : damage * k;
}

/** Class multiplier for a damage type. */
export function typeMultiplier(type: DamageType, cls: MobileClass): number {
  return damageTable[type][cls];
}

export interface DamageMultipliers {
  /** Sudden death (x2 / x3), item power-up, Force sky band, etc. */
  extra: number;
}

export const noMultipliers: DamageMultipliers = { extra: 1 };

/** Full damage computation for one target, before it is applied. */
export function computeDamage(
  baseDamage: number,
  dist: number,
  radius: number,
  type: DamageType,
  targetDef: MobileDef,
  targetState: MobileState,
  multipliers: DamageMultipliers = noMultipliers,
): number {
  const raw = falloff(baseDamage, dist, radius);
  if (raw <= 0) return 0;
  const typed = raw * typeMultiplier(type, targetDef.class);
  return typed * targetDef.defence * (1 + targetState.defenceMod) * multipliers.extra;
}

export interface DamageApplication {
  /** Damage after every multiplier. */
  amount: number;
  shieldAbsorbed: number;
  hpLost: number;
  died: boolean;
}

/**
 * Apply already-computed damage: the shield soaks first, the rest hits hp.
 *
 * `shieldMultiplier` is `ProjectileDef.shieldDamageMultiplier` (mage SS: "damage ×2.5
 * vs shield"). The shield loses `amount * shieldMultiplier` points, and the share of
 * the raw `amount` that was actually spent on the shield — `shieldAbsorbed /
 * shieldMultiplier` — is what does *not* reach hp. At the default 1 this is exactly
 * the old rule.
 */
export function applyDamage(
  target: MobileState,
  amount: number,
  shieldMultiplier = 1,
): DamageApplication {
  if (amount <= 0 || !target.alive) {
    return { amount: 0, shieldAbsorbed: 0, hpLost: 0, died: false };
  }
  const mult = shieldMultiplier > 0 ? shieldMultiplier : 1;
  const shieldAbsorbed = Math.min(target.shield, amount * mult);
  target.shield -= shieldAbsorbed;
  const spentOnShield = shieldAbsorbed / mult;
  const hpLost = Math.min(target.hp, amount - spentOnShield);
  target.hp -= hpLost;
  const died = target.hp <= 0;
  if (died) {
    target.hp = 0;
    target.alive = false;
  }
  return { amount, shieldAbsorbed, hpLost, died };
}
