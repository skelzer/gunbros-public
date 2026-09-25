/**
 * Paladin (`knight`) — DESIGN §3, class `mechanical`, `randomOnly`.
 *
 * The other mobile Random has to give you (DESIGN §7 item 10, weight 1). All three of
 * its shots are the same idea at three sizes: the shell is a spotter that does no damage
 * of its own, and a few ticks after it lands a rank of swords falls out of the sky onto
 * the marked ground — 3, then 5, then 9 across a much wider front (`markThenSwords`).
 *
 * Each sword is a short vertical beam (DESIGN §7 item 68), so `damage` below is the
 * damage of **one** sword and the total depends on how much of the rank the target is
 * standing under. A shot placed dead centre of a small spread beats a wide one; the SS
 * is the opposite bet — it covers ground rather than a point, and anything caught in the
 * middle of it is finished.
 *
 * Every tunable, including every `markThenSwords` number, is here (DESIGN §2.5).
 */
import type { MobileDef } from './index.js';
import { knightSprite } from '../../sprites/mobiles/knight.js';

export const knight: MobileDef = {
  id: 'knight',
  displayName: 'Paladin',
  class: 'mechanical',
  hp: 1080,
  shieldMax: 0,
  shieldRegen: 0,
  // Plate armour: it takes less than anything else that is not actually shielded.
  defence: 0.9,
  moveSpeed: 0.75,
  moveGauge: 145,
  maxStep: 13,
  angleMin: -5,
  angleMax: 80,
  footprint: { w: 26, h: 24 },
  randomOnly: true,
  randomWeight: 1,
  shots: {
    s1: {
      displayName: 'Three Swords',
      delay: 260,
      projectile: {
        speed: 13.8,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        // The spotter never explodes; these are the numbers of one falling sword.
        carveRadius: 14,
        damage: 125,
        damageRadius: 46,
        damageType: 'impact',
        behaviour: 'markThenSwords',
        params: {
          /** Swords in the rank (DESIGN §3: 3 / 5 / 9). */
          swords: 3,
          /** Width of the whole rank in px, centred on where the spotter landed. */
          spreadPx: 34,
          /** Px of scatter drawn per sword from the match PRNG. */
          jitterPx: 3,
          /** Ticks between the spotter landing and the first sword. */
          delayTicks: 16,
          /** Extra ticks per sword, so the rank comes down left to right. */
          staggerTicks: 5,
          /** Width of one sword's column in px. */
          swordWidthPx: 7,
          /** How far above the marked point a sword falls from, px. */
          fallHeightPx: 110,
          /** How far into the ground the blade sticks, px. */
          biteDepthPx: 8,
        },
        sprite: 'sword',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Five Swords',
      delay: 470,
      projectile: {
        speed: 13.4,
        gravity: 1,
        windFactor: 1.05,
        radius: 3,
        carveRadius: 14,
        damage: 120,
        damageRadius: 48,
        damageType: 'impact',
        behaviour: 'markThenSwords',
        params: {
          swords: 5,
          spreadPx: 62,
          jitterPx: 4,
          delayTicks: 16,
          staggerTicks: 4,
          swordWidthPx: 7,
          fallHeightPx: 124,
          biteDepthPx: 9,
        },
        sprite: 'swordRank',
        trail: 'spark',
      },
    },
    ss: {
      displayName: 'Nine Swords',
      delay: 840,
      projectile: {
        speed: 13,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        carveRadius: 18,
        damage: 138,
        damageRadius: 54,
        damageType: 'impact',
        behaviour: 'markThenSwords',
        params: {
          swords: 9,
          spreadPx: 132,
          jitterPx: 6,
          delayTicks: 18,
          staggerTicks: 3,
          swordWidthPx: 8,
          fallHeightPx: 150,
          biteDepthPx: 11,
        },
        sprite: 'swordStorm',
        trail: 'spark',
      },
    },
  },
  sprite: knightSprite,
};
