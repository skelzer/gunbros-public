/**
 * Stomper (`bigfoot`) — DESIGN §3, class `mechanical`.
 *
 * The excavator. Every shot is a volley of small missiles fired through a fan
 * (`count` + `spreadDeg` + `stagger`, all handled by `fireShot` — no behaviour module):
 * each one is weak, none of them is accurate, and together they dig a trench and hurt a
 * great deal if the target is standing in the middle of it. Slow, heavy, high hp.
 *
 * - S1 `Volley` — 4 missiles over 10°.
 * - S2 `Barrage` — 6 over 15°, more total damage and more dirt moved.
 * - SS `Carpet` — the big swing: 9 over 22°, ~765 damage if every one of them lands,
 *   and a trench the width of a small map feature.
 *
 * The fan is symmetric and deterministic (DESIGN §2.1: no PRNG in a shot's aim); the
 * "low accuracy" is the spread itself, not a random error.
 */
import type { MobileDef } from './index.js';
import { bigfootSprite } from '../../sprites/mobiles/bigfoot.js';

export const bigfoot: MobileDef = {
  id: 'bigfoot',
  displayName: 'Stomper',
  class: 'mechanical',
  hp: 1200,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.05,
  moveSpeed: 0.75,
  moveGauge: 140,
  maxStep: 15,
  angleMin: 5,
  angleMax: 75,
  footprint: { w: 32, h: 24 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Volley',
      delay: 260,
      count: 4,
      spreadDeg: 10,
      stagger: 3,
      projectile: {
        speed: 13.8,
        gravity: 1,
        windFactor: 1.15,
        radius: 3,
        carveRadius: 24,
        damage: 95,
        damageRadius: 46,
        damageType: 'explosive',
        behaviour: 'basic',
        params: {},
        sprite: 'miniMissile',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Barrage',
      delay: 480,
      count: 6,
      spreadDeg: 15,
      stagger: 3,
      projectile: {
        speed: 13.6,
        gravity: 1,
        windFactor: 1.2,
        radius: 3,
        carveRadius: 26,
        damage: 90,
        damageRadius: 48,
        damageType: 'explosive',
        behaviour: 'basic',
        params: {},
        sprite: 'miniMissile',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Carpet',
      delay: 860,
      count: 9,
      spreadDeg: 22,
      stagger: 2,
      projectile: {
        speed: 13.4,
        gravity: 1,
        windFactor: 1.25,
        radius: 3,
        carveRadius: 30,
        damage: 85,
        damageRadius: 52,
        damageType: 'explosive',
        behaviour: 'basic',
        params: {},
        sprite: 'carpetMissile',
        trail: 'smoke',
      },
    },
  },
  sprite: bigfootSprite,
};
