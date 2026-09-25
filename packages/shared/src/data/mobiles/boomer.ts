/**
 * Zephyr (`boomer`) — DESIGN §3, class `bionic`.
 *
 * The wind reader. Its blades weigh almost nothing — `gravity: 0.6` of the global pull
 * and `windFactor: 3`, the highest in the game — so a strong wind does not nudge the
 * shot, it *steers* it: into a head wind a blade climbs out, stops, and comes back past
 * the muzzle to land behind the thrower, which is the whole point of the mobile. In
 * dead air it is a floaty, long, flat lob.
 *
 * - S1 `Boomerang` — one blade.
 * - S2 `Triple` — three over a narrow fan, staggered, so the wind bends them apart.
 * - SS `Cyclone` — the big swing: five larger blades, wider fan, heavier each.
 *
 * No behaviour module: the curve is ballistics plus `windFactor`, which is exactly what
 * DESIGN §3 asks for ("cfg `windFactor: 3.0`, `gravity: 0.6`").
 */
import type { MobileDef } from './index.js';
import { boomerSprite } from '../../sprites/mobiles/boomer.js';

export const boomer: MobileDef = {
  id: 'boomer',
  displayName: 'Zephyr',
  class: 'bionic',
  hp: 1000,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 0.95,
  moveSpeed: 1.05,
  moveGauge: 200,
  maxStep: 13,
  angleMin: 0,
  angleMax: 85,
  footprint: { w: 24, h: 18 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Boomerang',
      delay: 250,
      projectile: {
        speed: 13,
        gravity: 0.6,
        windFactor: 3,
        radius: 4,
        carveRadius: 26,
        damage: 180,
        damageRadius: 58,
        damageType: 'impact',
        behaviour: 'basic',
        params: {},
        sprite: 'boomerang',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Triple',
      delay: 460,
      count: 3,
      spreadDeg: 8,
      stagger: 4,
      projectile: {
        speed: 12.8,
        gravity: 0.6,
        windFactor: 3,
        radius: 4,
        carveRadius: 22,
        damage: 115,
        damageRadius: 50,
        damageType: 'impact',
        behaviour: 'basic',
        params: {},
        sprite: 'boomerang',
        trail: 'spark',
      },
    },
    ss: {
      displayName: 'Cyclone',
      delay: 830,
      count: 5,
      spreadDeg: 14,
      stagger: 4,
      projectile: {
        speed: 12.6,
        gravity: 0.55,
        windFactor: 3.2,
        radius: 6,
        carveRadius: 34,
        damage: 130,
        damageRadius: 70,
        damageType: 'impact',
        behaviour: 'basic',
        params: {},
        sprite: 'boomerangBig',
        trail: 'spark',
      },
    },
  },
  sprite: boomerSprite,
};
