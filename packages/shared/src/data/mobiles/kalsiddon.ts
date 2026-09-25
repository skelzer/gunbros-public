/**
 * Shrike (`kalsiddon`) — DESIGN §3, class `mechanical`.
 *
 * A long-legged walker with a pair of missile pods on its back. It is armor's harder,
 * flatter-shooting cousin: a little more speed on the direct shot, a lower ceiling on
 * the aim range, and a cluster round that is its real trick.
 *
 * - **S1 Talon** — a fast, flat armour-piercing round. The safe shot (DESIGN §3 note).
 * - **S2 Cluster Pod** — `split`: at the top of its arc the pod comes apart into four
 *   fragments fanned along the direction of travel, so a shot aimed slightly long rakes
 *   the ground rather than digging one hole. Each fragment is a fraction of the pod, so
 *   it wants the whole fan to land on the target, not one lucky piece.
 * - **SS Siege Lance** — one enormous `impact` round: the biggest single number on the
 *   mobile, at the biggest delay.
 *
 * Every tunable, including every `split` number, is here (DESIGN §2.5): the behaviour
 * module reads `ProjectileDef.params` and holds no number of its own.
 */
import type { MobileDef } from './index.js';
import { kalsiddonSprite } from '../../sprites/mobiles/kalsiddon.js';

export const kalsiddon: MobileDef = {
  id: 'kalsiddon',
  displayName: 'Shrike',
  class: 'mechanical',
  hp: 1050,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 0.98,
  moveSpeed: 0.95,
  moveGauge: 175,
  maxStep: 13,
  // Legs, not a turret: it shoots flat and cannot lob as steeply as armor.
  angleMin: -15,
  angleMax: 68,
  footprint: { w: 28, h: 22 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Talon',
      delay: 240,
      projectile: {
        speed: 14.6,
        gravity: 1,
        windFactor: 0.9,
        radius: 3,
        carveRadius: 24,
        damage: 185,
        damageRadius: 54,
        damageType: 'explosive',
        behaviour: 'basic',
        sprite: 'talon',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Cluster Pod',
      delay: 470,
      projectile: {
        speed: 13.4,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        // The pod never explodes itself — it comes apart. `damage` and the radii are the
        // numbers the fragments are scaled from.
        carveRadius: 34,
        damage: 220,
        damageRadius: 72,
        damageType: 'explosive',
        behaviour: 'split',
        params: {
          /** Fragments the pod comes apart into (DESIGN §3: four). */
          pieces: 4,
          /** Total vx fan across those fragments, px/tick. */
          spreadVx: 3.4,
          /** Upward kick given to every fragment at the break-up, px/tick. */
          liftVy: 0.9,
          /** Ticks before the pod is allowed to split, so a flat shot still flies. */
          minTicks: 10,
          childDamageScale: 0.44,
          childDamageRadiusScale: 0.62,
          childCarveScale: 0.5,
          childRadiusScale: 0.7,
        },
        sprite: 'clusterPod',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Siege Lance',
      delay: 820,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 1.2,
        radius: 5,
        carveRadius: 56,
        damage: 455,
        damageRadius: 104,
        damageType: 'impact',
        behaviour: 'basic',
        sprite: 'lance',
        trail: 'smoke',
      },
    },
  },
  sprite: kalsiddonSprite,
};
