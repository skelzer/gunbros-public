/**
 * Delver (`nak`) — DESIGN §3, class `bionic`.
 *
 * The digger. It shoots into the ground on purpose: its two special shells bore through
 * terrain and come out the far side, which makes cover a liability rather than a wall.
 * Its aim range reaches well below the horizon so it can start a tunnel at its feet.
 *
 * - S1 `Clay Lob` — the safe shot: a heavy, short-ranged arc, ordinary impact damage.
 * - S2 `Burrow` — tunnels `ticks` ticks through whatever it hits, carving a
 *   `tunnelRadius` bore, and detonates on a mobile, on breaking out, or on the timer.
 * - SS `Deep Drill` — the big swing: the same trick with a wider bore, a longer dig
 *   and an explosion that opens a crater wherever it stops.
 */
import type { MobileDef } from './index.js';
import { nakSprite } from '../../sprites/mobiles/nak.js';

export const nak: MobileDef = {
  id: 'nak',
  displayName: 'Delver',
  class: 'bionic',
  hp: 1080,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.0,
  moveSpeed: 0.95,
  moveGauge: 185,
  maxStep: 14,
  // It has to be able to aim at the dirt in front of its own tracks.
  angleMin: -35,
  angleMax: 70,
  footprint: { w: 28, h: 18 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Clay Lob',
      delay: 250,
      projectile: {
        speed: 13.2,
        gravity: 1.15,
        windFactor: 0.9,
        radius: 4,
        carveRadius: 30,
        damage: 185,
        damageRadius: 60,
        damageType: 'impact',
        behaviour: 'basic',
        params: {},
        sprite: 'clayBall',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Burrow',
      delay: 470,
      projectile: {
        speed: 13.8,
        gravity: 1,
        windFactor: 0.85,
        radius: 3,
        carveRadius: 34,
        damage: 230,
        damageRadius: 66,
        damageType: 'impact',
        behaviour: 'burrow',
        params: {
          /** Radius of the bore, in px. Also the spacing of the carved circles. */
          tunnelRadius: 9,
          /** Speed underground, px/tick: the drill trades flight speed for rock. */
          digSpeed: 4.5,
          /** Ticks of digging before it gives up and detonates where it is. */
          ticks: 70,
          /** How far ahead "is there still rock?" is asked, in px. */
          probePx: 12,
          /**
           * Detonate once this far below the point it went in at. A shell that dug into
           * a floor has no far side to break out of, and the carve radius (34) is wider
           * than this, so the crater still opens at the surface.
           */
          maxDepthPx: 20,
        },
        sprite: 'drillShell',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Deep Drill',
      delay: 830,
      projectile: {
        speed: 13,
        gravity: 1,
        windFactor: 0.8,
        radius: 4,
        carveRadius: 56,
        damage: 400,
        damageRadius: 104,
        damageType: 'impact',
        behaviour: 'burrow',
        params: {
          tunnelRadius: 14,
          digSpeed: 5.5,
          ticks: 110,
          probePx: 17,
          /** As the S2, scaled to the bigger bore and the 56 px crater. */
          maxDepthPx: 32,
        },
        sprite: 'drillHeavy',
        trail: 'smoke',
      },
    },
  },
  sprite: nakSprite,
};
