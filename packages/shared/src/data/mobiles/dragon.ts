/**
 * Wyvern (`dragon`) — DESIGN §3, class `bionic`, `randomOnly`.
 *
 * One of the two mobiles nobody can pick (DESIGN §7 item 10): weight 1 against every
 * other mobile's 10, so Random lands on it about 1.2 % of the time. It is a treat when
 * it does — everything it throws is `fire`, which the damage table gives ×1.2 against
 * bionic targets and no penalty against anything else (DESIGN §2.6), and its numbers sit
 * above the roster rather than in it. It pays for that with the shortest legs on the
 * roster and no shield at all.
 *
 * - **S1 Ember** — a heavy fireball. Plain configuration, no behaviour module.
 * - **S2 Triple Flame** — three fireballs in a tight fan, staggered a few ticks apart.
 * - **SS Dragon Breath** — one enormous fireball whose signature is the crater: the
 *   largest `carveRadius` in the game, which reshapes the map as much as it hurts.
 */
import type { MobileDef } from './index.js';
import { dragonSprite } from '../../sprites/mobiles/dragon.js';

export const dragon: MobileDef = {
  id: 'dragon',
  displayName: 'Wyvern',
  class: 'bionic',
  hp: 1150,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 0.94,
  moveSpeed: 0.8,
  moveGauge: 150,
  maxStep: 14,
  angleMin: -12,
  angleMax: 78,
  footprint: { w: 30, h: 22 },
  randomOnly: true,
  randomWeight: 1,
  shots: {
    s1: {
      displayName: 'Ember',
      delay: 260,
      projectile: {
        speed: 14.1,
        gravity: 1,
        windFactor: 1,
        radius: 4,
        carveRadius: 30,
        damage: 220,
        damageRadius: 64,
        damageType: 'fire',
        behaviour: 'basic',
        sprite: 'fireball',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Triple Flame',
      delay: 480,
      count: 3,
      spreadDeg: 7,
      stagger: 3,
      projectile: {
        speed: 13.7,
        gravity: 1,
        windFactor: 1.1,
        radius: 3,
        carveRadius: 24,
        damage: 160,
        damageRadius: 54,
        damageType: 'fire',
        behaviour: 'basic',
        sprite: 'flame',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Dragon Breath',
      delay: 840,
      projectile: {
        speed: 12.6,
        gravity: 1,
        windFactor: 1.25,
        radius: 6,
        // The crater is the point: it swallows a mobile's footprint whole.
        carveRadius: 88,
        damage: 470,
        damageRadius: 122,
        damageType: 'fire',
        behaviour: 'basic',
        sprite: 'breath',
        trail: 'smoke',
      },
    },
  },
  sprite: dragonSprite,
};
