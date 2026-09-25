/**
 * Herald (`aduka`) — DESIGN §3, class `mechanical`.
 *
 * Herald's gun is the weakest on the roster on purpose: what it actually fires is a
 * targeting round. S2 and SS paint the ground where the shell lands and call the Thor
 * satellite down on the mark — a column of light whose damage scales with the Thor
 * level, and which is level 1 when the map rolled no Thor at all (DESIGN §5, §7 item 9).
 *
 * So Herald is the mobile that shoots from directly overhead: the beam falls from the
 * top of the map, which reaches into a pit or a crater a lobbed shell would only clip
 * the rim of, and it carves a shaft on the way down. What Herald gives up is direct
 * damage — S1 is a popgun — and the delay the call-in costs.
 *
 * Its aim range starts at 0°: a targeting round is lobbed, never fired flat.
 */
import type { MobileDef } from './index.js';
import { adukaSprite } from '../../sprites/mobiles/aduka.js';

export const aduka: MobileDef = {
  id: 'aduka',
  displayName: 'Herald',
  class: 'mechanical',
  hp: 1000,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 1.04,
  moveSpeed: 0.85,
  moveGauge: 160,
  maxStep: 11,
  angleMin: 0,
  angleMax: 82,
  footprint: { w: 26, h: 22 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Signal Shot',
      delay: 230,
      projectile: {
        speed: 14.2,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 20,
        damage: 130,
        damageRadius: 48,
        damageType: 'explosive',
        behaviour: 'basic',
        sprite: 'flare',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Thor Call',
      delay: 480,
      projectile: {
        speed: 13.8,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 18,
        // A spotting round: the shell barely scratches, the beam does the work.
        damage: 95,
        damageRadius: 42,
        damageType: 'explosive',
        behaviour: 'thorCall',
        params: {
          /** Strikes per call-in. */
          calls: 1,
          /** Shell impact → beam, in ticks; the mark blinks for this long. */
          delayTicks: 24,
          staggerTicks: 16,
          stepPx: 0,
          /** 0 = use the match's Thor level (1 until Phase 6 raises it). */
          level: 0,
          /** Beam damage, as a fraction of `sky.thor.baseDamage * level`. */
          damageScale: 1.35,
          /** The column: carve radius, and falloff radius as a multiple of it. */
          beamCarveRadius: 17,
          beamRadiusScale: 3.2,
        },
        sprite: 'beacon',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Thor Barrage',
      delay: 860,
      projectile: {
        speed: 13.6,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 18,
        damage: 95,
        damageRadius: 42,
        damageType: 'explosive',
        behaviour: 'thorCall',
        params: {
          /** DESIGN §3: "thorCall ×3". */
          calls: 3,
          delayTicks: 22,
          /** Ticks between the three beams. */
          staggerTicks: 15,
          /**
           * Px between them: the barrage walks a line across the mark. Kept well
           * inside the beam's own falloff radius, so the two outer strikes still
           * bite on a target standing on the mark and reach two standing beside it.
           */
          stepPx: 28,
          level: 0,
          damageScale: 1.25,
          beamCarveRadius: 16,
          beamRadiusScale: 3.5,
        },
        sprite: 'beaconBarrage',
        trail: 'smoke',
      },
    },
  },
  sprite: adukaSprite,
};
