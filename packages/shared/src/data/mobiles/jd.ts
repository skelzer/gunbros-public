/**
 * Vortex (`jd`) — DESIGN §3, class `shielded`.
 *
 * A control mobile. Its heavy shots collapse into the point they hit and drag every
 * mobile the blast reached toward the centre (`entities/behaviours/pull.ts`), which
 * moves a target out of cover, off a ledge, or into the crater its own shell just dug.
 * The damage is respectable; the displacement is the reason to bring one.
 *
 * `params` per pulling shot:
 * - `pullRadius` — how far the vortex reaches,
 * - `pullStrength` — px/tick of inward velocity at the centre, falling off linearly,
 * - `pullLift` — the upward kick. Not optional: a mobile only drifts while it is
 *   airborne (DESIGN §7 item 70), and the lift also sets how long the flight lasts
 *   (`2 * lift / gravity` ticks) and therefore how far the pull actually carries,
 * - `verticalScale` — how much of the pull direction's vertical part is kept,
 * - `centreEpsilonPx` — under this distance there is no direction left to pull along
 *   and the target is only thrown up,
 * - `overshootFactor` — how far past the centre the pull is allowed to throw a target,
 *   as a fraction of its distance to it. 1 = it lands on the centre.
 *
 * Statline: heavier and slower than Tempest behind a smaller shield, with a wide aim
 * range because a vortex is usually placed short of a target rather than on it.
 */
import type { MobileDef } from './index.js';
import { jdSprite } from '../../sprites/mobiles/jd.js';

export const jd: MobileDef = {
  id: 'jd',
  displayName: 'Vortex',
  class: 'shielded',
  hp: 980,
  shieldMax: 220,
  shieldRegen: 35,
  defence: 1.0,
  moveSpeed: 0.85,
  moveGauge: 155,
  maxStep: 12,
  angleMin: -8,
  angleMax: 75,
  footprint: { w: 30, h: 22 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Slug',
      delay: 250,
      projectile: {
        speed: 14.1,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 26,
        damage: 195,
        damageRadius: 56,
        damageType: 'impact',
        behaviour: 'basic',
        sprite: 'vortexSlug',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Vortex',
      delay: 460,
      projectile: {
        speed: 13.3,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        carveRadius: 32,
        damage: 185,
        damageRadius: 88,
        damageType: 'impact',
        behaviour: 'pull',
        params: {
          pullRadius: 160,
          pullStrength: 6,
          pullLift: 4,
          verticalScale: 0.3,
          centreEpsilonPx: 2,
          /** 1 = the pull never throws a target past the crater it is pulling toward. */
          overshootFactor: 1,
        },
        sprite: 'vortexShell',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Singularity',
      delay: 800,
      projectile: {
        speed: 12.7,
        gravity: 1,
        windFactor: 1.2,
        radius: 5,
        carveRadius: 52,
        damage: 340,
        damageRadius: 128,
        damageType: 'impact',
        behaviour: 'pull',
        params: {
          pullRadius: 270,
          pullStrength: 9,
          pullLift: 5.4,
          verticalScale: 0.35,
          centreEpsilonPx: 2,
          overshootFactor: 1,
        },
        sprite: 'vortexCore',
        trail: 'smoke',
      },
    },
  },
  sprite: jdSprite,
};
