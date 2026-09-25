/**
 * Croaker (`jfrog`) — DESIGN §3, class `bionic`.
 *
 * A fat amphibian that spits slime. It walks further than anything else on the roster
 * and climbs steps a tracked mobile cannot, which is how it gets the angles its crawling
 * shots want; in exchange its shots are slow and wind-shy.
 *
 * - **S1 Slime** — a plain `water` lob. The safe shot.
 * - **S2 Creeper** — `crawl`: the blob sticks where it lands and then walks the surface
 *   in the direction it was travelling before it goes off, so it can be landed short of
 *   a ridge and let to come over the top — or into a trench a direct shot cannot reach.
 * - **SS Deluge** — a much longer crawl that bursts into five blobs at the end, which
 *   then rain down around the crater.
 *
 * Every tunable, including every `crawl` number, is here (DESIGN §2.5): the behaviour
 * module reads `ProjectileDef.params` and holds no number of its own.
 */
import type { MobileDef } from './index.js';
import { jfrogSprite } from '../../sprites/mobiles/jfrog.js';

export const jfrog: MobileDef = {
  id: 'jfrog',
  displayName: 'Croaker',
  class: 'bionic',
  hp: 1180,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.02,
  moveSpeed: 1.05,
  moveGauge: 200,
  maxStep: 16,
  angleMin: -20,
  angleMax: 72,
  footprint: { w: 28, h: 18 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Slime',
      delay: 240,
      projectile: {
        speed: 13.9,
        gravity: 1,
        windFactor: 1,
        radius: 4,
        carveRadius: 24,
        damage: 180,
        damageRadius: 60,
        damageType: 'water',
        behaviour: 'basic',
        sprite: 'slime',
        trail: 'bubble',
      },
    },
    s2: {
      displayName: 'Creeper',
      delay: 460,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        carveRadius: 30,
        damage: 255,
        damageRadius: 68,
        damageType: 'water',
        behaviour: 'crawl',
        params: {
          /** Px of surface the blob covers before it goes off. */
          crawlPx: 96,
          /** Px per sub-step — four of these per tick, so 3.2 px/tick. */
          stepPx: 0.8,
          /** Tallest rise it can climb in one step; anything more and it splatters. */
          climbPx: 6,
          /** Furthest it will reach down for ground before it falls instead. */
          dropPx: 10,
          /** Px it rides above the surface, so it is not inside the ground it walks on. */
          hoverPx: 2,
          /** Horizontal speed it keeps when it walks off a ledge, px/tick. */
          fallVx: 1.6,
        },
        sprite: 'creeper',
        trail: 'bubble',
      },
    },
    ss: {
      displayName: 'Deluge',
      delay: 830,
      projectile: {
        speed: 12.8,
        gravity: 1,
        windFactor: 1.2,
        radius: 5,
        carveRadius: 42,
        damage: 320,
        damageRadius: 86,
        damageType: 'water',
        behaviour: 'crawl',
        params: {
          crawlPx: 170,
          stepPx: 1,
          climbPx: 7,
          dropPx: 12,
          hoverPx: 2,
          fallVx: 1.8,
          /** Blobs thrown out of the final explosion (DESIGN §3: "longer + splits"). */
          splitCount: 5,
          /** Speed they are thrown at, px/tick. */
          splitSpeed: 5.6,
          /** Total fan of the throw, degrees, centred straight up. */
          splitSpreadDeg: 108,
          childDamageScale: 0.38,
          childDamageRadiusScale: 0.6,
          childCarveScale: 0.5,
          childRadiusScale: 0.7,
        },
        sprite: 'deluge',
        trail: 'bubble',
      },
    },
  },
  sprite: jfrogSprite,
};
