/**
 * Sorcerer (`mage`) — DESIGN §3, class `shielded`.
 *
 * A glass-cannon caster: less hp than armor, a real shield that comes back every turn,
 * and energy damage, which the table (DESIGN §2.6) makes strongest against the other
 * shielded mobiles. It aims high and moves lightly.
 *
 * - S1 `Arcane Bolt` — the safe shot: a fast, flat energy ball, small hole.
 * - S2 `Weave` — two bolts braiding around one shared path (`weave`). Each half hits
 *   for less than S1, but both halves land: a target in the middle of the braid takes
 *   the pair, a target the braid straddles takes one of them.
 * - SS `Shield Break` — the big swing: a heavy energy blast that eats shields at
 *   2.5× (`shieldDamageMultiplier`) and strips whatever shield is left (`shieldBreak`).
 */
import type { MobileDef } from './index.js';
import { mageSprite } from '../../sprites/mobiles/mage.js';

export const mage: MobileDef = {
  id: 'mage',
  displayName: 'Sorcerer',
  class: 'shielded',
  hp: 950,
  shieldMax: 340,
  shieldRegen: 55,
  defence: 0.95,
  moveSpeed: 0.95,
  moveGauge: 165,
  maxStep: 13,
  angleMin: -5,
  angleMax: 82,
  footprint: { w: 24, h: 22 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Arcane Bolt',
      delay: 240,
      projectile: {
        speed: 14.1,
        gravity: 1,
        windFactor: 0.9,
        radius: 3,
        carveRadius: 22,
        damage: 175,
        damageRadius: 54,
        damageType: 'energy',
        behaviour: 'basic',
        params: {},
        sprite: 'arcaneBolt',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Weave',
      delay: 460,
      // Two bodies, no fan: `weave` needs them to share one velocity, and the braid
      // is what separates them.
      count: 2,
      spreadDeg: 0,
      projectile: {
        speed: 13.6,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 20,
        damage: 135,
        damageRadius: 48,
        damageType: 'energy',
        behaviour: 'weave',
        params: {
          /** Half the width of the braid, in px. */
          amplitudePx: 18,
          /** Phase advance per sub-step; 4 sub-steps/tick, so ~13°/tick. */
          degPerSubStep: 3.2,
          /** Where in the swing the pair leaves the staff. */
          phaseDeg: 0,
          /**
           * Sub-steps the braid takes to open from the centre line to `amplitudePx`.
           * Long enough that the pair has cleared the mage's own hull before it parts.
           */
          rampSubSteps: 16,
        },
        sprite: 'weaveBolt',
        trail: 'spark',
      },
    },
    ss: {
      displayName: 'Shield Break',
      delay: 820,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 1.05,
        radius: 5,
        carveRadius: 44,
        damage: 330,
        damageRadius: 96,
        damageType: 'energy',
        /** DESIGN §3: "damage ×2.5 vs shield"; `rules/damage.ts` applies it. */
        shieldDamageMultiplier: 2.5,
        behaviour: 'shieldBreak',
        params: {
          /** Shields are stripped out to this share of the damage radius. */
          stripRadiusFactor: 1,
        },
        sprite: 'shieldBreaker',
        trail: 'spark',
      },
    },
  },
  sprite: mageSprite,
};
