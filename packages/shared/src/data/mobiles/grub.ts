/**
 * Skipper (`grub`) — DESIGN §3, class `bionic`.
 *
 * The mobile that shoots *around* terrain instead of over it. Every shot is a heavy
 * rolling slug with `bounces` and `restitution`: it skips off ridges, runs down the far
 * side of a crater and detonates where it comes to rest (`bounce`, see the behaviour
 * module). A direct hit on a mobile always goes off on contact, so a flat shot down a
 * corridor is still a shot.
 *
 * Its aim range is deliberately low and flat — the skip is the point, not the arc — and
 * it is the best walker on the roster to make up for how often the slug ends up in the
 * wrong hole.
 *
 * S1 skips three times. S2 skips five and hits harder. SS is a boulder: heavy, bouncy,
 * and it keeps rolling long after it lands.
 */
import type { MobileDef } from './index.js';
import { grubSprite } from '../../sprites/mobiles/grub.js';

export const grub: MobileDef = {
  id: 'grub',
  displayName: 'Skipper',
  class: 'bionic',
  hp: 1050,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.0,
  moveSpeed: 1.05,
  moveGauge: 195,
  maxStep: 15,
  angleMin: -25,
  angleMax: 62,
  footprint: { w: 28, h: 18 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Skip Shot',
      delay: 250,
      projectile: {
        speed: 13.6,
        gravity: 1,
        windFactor: 0.85,
        radius: 4,
        carveRadius: 24,
        damage: 155,
        damageRadius: 54,
        damageType: 'impact',
        // DESIGN §3: "bounces: 3, restitution: 0.55".
        bounces: 3,
        restitution: 0.55,
        behaviour: 'bounce',
        params: {
          /** Normal speed below which a contact rolls instead of bouncing, px/tick. */
          rollSpeed: 1.2,
          /** Along-surface speed kept per bounce: how far each skip carries. */
          bounceFriction: 0.72,
          /** Speed kept per rolling contact. */
          rollFriction: 0.85,
          /** Speed at which the slug stops and goes off, px/tick. */
          restSpeed: 1.1,
          /** Px the slug's centre is lifted off the surface after a contact. */
          clearancePx: 1,
          /** Safety cap on a roll that never slows down (a long slope). */
          maxRollTicks: 240,
        },
        sprite: 'slug',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Double Skip',
      delay: 460,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 0.85,
        radius: 4,
        carveRadius: 32,
        damage: 205,
        damageRadius: 66,
        damageType: 'impact',
        // DESIGN §3: "bounces: 5".
        bounces: 5,
        restitution: 0.6,
        behaviour: 'bounce',
        params: {
          rollSpeed: 0.7,
          bounceFriction: 0.78,
          rollFriction: 0.88,
          restSpeed: 1,
          clearancePx: 1,
          maxRollTicks: 300,
        },
        sprite: 'slugHeavy',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Boulder',
      delay: 830,
      projectile: {
        speed: 12.4,
        gravity: 1,
        windFactor: 0.7,
        radius: 6,
        carveRadius: 52,
        damage: 340,
        damageRadius: 96,
        damageType: 'impact',
        // DESIGN §3: "big bouncy".
        bounces: 7,
        restitution: 0.72,
        behaviour: 'bounce',
        params: {
          rollSpeed: 0.5,
          bounceFriction: 0.85,
          rollFriction: 0.92,
          restSpeed: 0.8,
          clearancePx: 2,
          maxRollTicks: 420,
        },
        sprite: 'boulder',
        trail: 'smoke',
      },
    },
  },
  sprite: grubSprite,
};
