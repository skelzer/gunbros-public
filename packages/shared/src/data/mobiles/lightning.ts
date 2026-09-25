/**
 * Tempest (`lightning`) — DESIGN §3, class `shielded`.
 *
 * A caller of storms. Every shot is a seed shell that paints the point it lands on and
 * then holds the turn open while the sky answers: a bolt comes down the channel it
 * burned and lands on the mark (`entities/behaviours/markThenBolt.ts`). The shell
 * itself barely scratches; the bolt is the shot.
 *
 * `params` per shot:
 * - `delayTicks` — ticks between the mark and the first bolt,
 * - `bolts`, `intervalTicks`, `spreadPx` — how many come down, how far apart in time
 *   and how far the fan spreads across the mark,
 * - `angleDeg` — how far off the vertical the bolt falls (S2's signature),
 * - `boltDamage`, `boltDamageRadius`, `boltWidth` — the strike itself.
 *
 * Statline: the thinnest hull in the group behind a real shield, a steep aim range
 * (DESIGN §7 item 16 quotes `[20, 85]` for exactly this mobile) and slow tracks. It
 * shoots over terrain it cannot shoot through, and the bolt ignores cover entirely —
 * an overhang is carved out of the way on its way down.
 */
import type { MobileDef } from './index.js';
import { lightningSprite } from '../../sprites/mobiles/lightning.js';

export const lightning: MobileDef = {
  id: 'lightning',
  displayName: 'Tempest',
  class: 'shielded',
  hp: 860,
  shieldMax: 280,
  shieldRegen: 45,
  defence: 1.02,
  moveSpeed: 0.8,
  moveGauge: 145,
  maxStep: 11,
  angleMin: 20,
  angleMax: 85,
  footprint: { w: 24, h: 24 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Bolt',
      delay: 260,
      projectile: {
        speed: 13.8,
        gravity: 1,
        windFactor: 1.1,
        radius: 3,
        carveRadius: 14,
        damage: 70,
        damageRadius: 38,
        damageType: 'energy',
        behaviour: 'markThenBolt',
        params: {
          delayTicks: 24,
          bolts: 1,
          intervalTicks: 0,
          spreadPx: 0,
          angleDeg: 0,
          boltDamage: 215,
          boltDamageRadius: 68,
          boltWidth: 12,
        },
        sprite: 'boltSeed',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Slant Bolt',
      delay: 480,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 1.15,
        radius: 3,
        carveRadius: 16,
        damage: 85,
        damageRadius: 42,
        damageType: 'energy',
        behaviour: 'markThenBolt',
        params: {
          delayTicks: 30,
          bolts: 1,
          intervalTicks: 0,
          spreadPx: 0,
          // The bolt comes in from the side, so it cuts a slanted channel through
          // anything roofing the target instead of a clean vertical shaft.
          angleDeg: 30,
          boltDamage: 300,
          boltDamageRadius: 80,
          boltWidth: 16,
        },
        sprite: 'boltSeed',
        trail: 'spark',
      },
    },
    ss: {
      displayName: 'Thunderhead',
      delay: 840,
      projectile: {
        speed: 12.8,
        gravity: 1,
        windFactor: 1.2,
        radius: 4,
        carveRadius: 20,
        damage: 95,
        damageRadius: 48,
        damageType: 'energy',
        behaviour: 'markThenBolt',
        params: {
          delayTicks: 30,
          bolts: 3,
          intervalTicks: 9,
          spreadPx: 96,
          angleDeg: 12,
          boltDamage: 250,
          boltDamageRadius: 76,
          boltWidth: 18,
        },
        sprite: 'boltSeedHeavy',
        trail: 'spark',
      },
    },
  },
  sprite: lightningSprite,
};
