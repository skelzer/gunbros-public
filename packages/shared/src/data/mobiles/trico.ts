/**
 * Triclops (`trico`) — DESIGN §3, class `bionic`.
 *
 * A heavy three-eyed walker. It is slow and tough, and everything it throws is blunt
 * `impact` damage, which the table (DESIGN §2.6) makes best against machines.
 *
 * - S1 `Eye Shot` — the safe shot: one solid ball, armor-like ballistics.
 * - S2 `Orbit` — three shards turning around a shared centre of mass (`orbit`). The
 *   ring is `radiusPx` wide, so the volley covers a span instead of a point: a target
 *   under the centre takes two or three of them, one beside it takes whichever spoke
 *   swung its way.
 * - SS `Cyclops` — the big swing: one very heavy ball with a crater to match.
 */
import type { MobileDef } from './index.js';
import { tricoSprite } from '../../sprites/mobiles/trico.js';

export const trico: MobileDef = {
  id: 'trico',
  displayName: 'Triclops',
  class: 'bionic',
  hp: 1150,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.05,
  moveSpeed: 0.8,
  moveGauge: 150,
  maxStep: 12,
  angleMin: 0,
  angleMax: 78,
  footprint: { w: 30, h: 22 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Eye Shot',
      delay: 250,
      projectile: {
        speed: 14,
        gravity: 1,
        windFactor: 1,
        radius: 4,
        carveRadius: 26,
        damage: 190,
        damageRadius: 58,
        damageType: 'impact',
        behaviour: 'basic',
        params: {},
        sprite: 'eyeBall',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Orbit',
      delay: 470,
      // Three bodies, no fan: `orbit` needs one shared velocity to turn around.
      count: 3,
      spreadDeg: 0,
      projectile: {
        speed: 13.4,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 22,
        damage: 120,
        damageRadius: 50,
        damageType: 'impact',
        behaviour: 'orbit',
        params: {
          /** Spokes in the ring. Must match the shot's `count`. */
          count: 3,
          /** Distance from the centre of mass to each shard, in px. */
          radiusPx: 16,
          /** Ring rotation per sub-step; 4 sub-steps/tick, so ~9°/tick. */
          spinDegPerSubStep: 2.2,
          /** Where the first spoke starts, in degrees. */
          startDeg: 0,
          /**
           * Sub-steps the ring takes to open from a point to `radiusPx`. Long enough
           * that the centre of mass has cleared trico's own hull (footprint 30 wide)
           * before any spoke swings backwards through it.
           */
          rampSubSteps: 20,
        },
        sprite: 'eyeShard',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Cyclops',
      delay: 840,
      projectile: {
        speed: 12.6,
        gravity: 1.1,
        windFactor: 1.15,
        radius: 6,
        carveRadius: 60,
        damage: 455,
        damageRadius: 112,
        damageType: 'impact',
        behaviour: 'basic',
        params: {},
        sprite: 'eyeGiant',
        trail: 'smoke',
      },
    },
  },
  sprite: tricoSprite,
};
