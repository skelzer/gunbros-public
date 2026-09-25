/**
 * armor (`armor`) — the reference mobile (DESIGN §3), class `mechanical`.
 *
 * Its S1 is the shot every number in DESIGN §2.2 is quoted against, so this is the
 * one mobile file that is not a Phase 4 stub: retune it only with the ballistics
 * comment below in mind.
 */
import type { MobileDef } from './index.js';
import { armorSprite } from '../../sprites/mobiles/armor.js';

/**
 * armor — the reference mobile. Its S1 is the shot every number in DESIGN §2.2 is quoted
 * against: speed 14.3 px/tick at power 1.0 under gravity 0.16 px/tick², which is a
 * flat-ground range of v²/g ≈ 1278 px at 45°, i.e. the ~1.6 screens the design asks for.
 * That has to comfortably clear the widest spawn separation a map can produce (about
 * 820 px on `hills`) even into a full head wind, or the match stalls out of range.
 */
export const armor: MobileDef = {
  id: 'armor',
  displayName: 'Armor',
  class: 'mechanical',
  hp: 1100,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.0,
  moveSpeed: 0.9,
  moveGauge: 170,
  maxStep: 12,
  angleMin: -10,
  angleMax: 70,
  footprint: { w: 26, h: 20 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Shell',
      delay: 250,
      projectile: {
        speed: 14.3,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 26,
        damage: 190,
        damageRadius: 58,
        damageType: 'explosive',
        behaviour: 'basic',
        sprite: 'shell',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Heavy Shell',
      delay: 450,
      projectile: {
        speed: 13.5,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        carveRadius: 36,
        damage: 265,
        damageRadius: 74,
        damageType: 'explosive',
        behaviour: 'basic',
        sprite: 'shellHeavy',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Siege Missile',
      delay: 800,
      projectile: {
        speed: 13,
        gravity: 1,
        windFactor: 1.2,
        radius: 5,
        carveRadius: 54,
        damage: 430,
        damageRadius: 105,
        damageType: 'explosive',
        behaviour: 'basic',
        sprite: 'missile',
        trail: 'smoke',
      },
    },
  },
  sprite: armorSprite,
};
