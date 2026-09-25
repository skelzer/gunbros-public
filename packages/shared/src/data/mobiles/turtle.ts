/**
 * Deepshell (`turtle`) — DESIGN §3, class `bionic`.
 *
 * A slow, heavily shelled water mobile: the most hit points on the roster, the lowest
 * `defence` multiplier, and a move gauge that means it very rarely gets to reposition.
 * It trades mobility for staying power and for shots that cover ground rather than
 * pinpoint it — `damageType: 'water'`, which the table (DESIGN §2.6) makes best against
 * mechanical hulls and worst against other bionics.
 *
 * S1 is a plain water ball, the safe shot. S2 is `converge`: two balls that fan apart
 * and come back together on a timer, so the same aim brackets a target or doubles up on
 * it depending on the range. SS is `bubbleBurst`: a pressurised shell on a fuse that
 * bursts into twelve slow, wind-hungry bubbles which drift down over an area — with any
 * wind at all it is the widest shot in the game.
 */
import type { MobileDef } from './index.js';
import { turtleSprite } from '../../sprites/mobiles/turtle.js';

export const turtle: MobileDef = {
  id: 'turtle',
  displayName: 'Deepshell',
  class: 'bionic',
  hp: 1200,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 0.92,
  moveSpeed: 0.7,
  moveGauge: 130,
  maxStep: 13,
  angleMin: -20,
  angleMax: 72,
  footprint: { w: 30, h: 18 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Water Ball',
      delay: 250,
      projectile: {
        speed: 13.8,
        gravity: 1,
        windFactor: 0.9,
        radius: 4,
        carveRadius: 26,
        damage: 180,
        damageRadius: 60,
        damageType: 'water',
        behaviour: 'basic',
        sprite: 'waterBall',
        trail: 'bubble',
      },
    },
    s2: {
      displayName: 'Tide Split',
      delay: 470,
      projectile: {
        speed: 13.4,
        gravity: 1,
        windFactor: 0.9,
        radius: 4,
        carveRadius: 22,
        damage: 145,
        damageRadius: 52,
        damageType: 'water',
        behaviour: 'converge',
        params: {
          /**
           * Sideways drift each ball carries, px/tick. The pair's separation is
           * `2 * lateral` px per tick while they are spreading.
           */
          lateral: 1.6,
          /** Ticks between sign flips: spread for this long, converge for this long. */
          flipTicks: 26,
        },
        sprite: 'waterBall',
        trail: 'bubble',
      },
    },
    ss: {
      displayName: 'Bubble Burst',
      delay: 850,
      projectile: {
        speed: 12.8,
        gravity: 1,
        windFactor: 1,
        radius: 5,
        carveRadius: 30,
        damage: 250,
        damageRadius: 64,
        damageType: 'water',
        /** The fuse: the shell bursts here whether or not it has landed. */
        lifetimeTicks: 52,
        behaviour: 'bubbleBurst',
        params: {
          /** DESIGN §3: "bursts into 12 small bubbles". */
          bubbles: 12,
          /** Px/tick each bubble is thrown at, evenly around the circle. */
          burstSpeed: 4.2,
          startDeg: 0,
          offsetPx: 8,
          /** Fraction of the shell's own velocity the whole cloud keeps. */
          inheritVelocity: 0.25,
          /** A bubble barely falls, and the wind owns it. */
          bubbleGravityScale: 0.45,
          bubbleWindScale: 1.8,
          /** Ticks before a bubble pops on its own. */
          bubbleLifeTicks: 90,
          bubbleDamageScale: 0.32,
          bubbleRadiusScale: 0.5,
          /** The burst itself, as a fraction of the shell's damage. */
          burstDamageScale: 0.45,
          burstCarveScale: 0.7,
        },
        sprite: 'pressureShell',
        trail: 'bubble',
      },
    },
  },
  sprite: turtleSprite,
};
