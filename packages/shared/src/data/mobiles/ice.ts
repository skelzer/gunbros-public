/**
 * Frostbite (`ice`) — DESIGN §3, class `shielded`.
 *
 * The attrition mobile. Nothing it fires hits as hard as armor's equivalent, but
 * every shell is `damageType: 'ice'` and carries a `defenceDebuff`: the core stacks it
 * onto whatever the blast damaged, caps it at `constants.debuff.max` and thaws it by
 * `constants.debuff.decayPerTurn` at the victim's own turn start (DESIGN §2.6, §7 item
 * 69). A target Frostbite keeps landing on takes more from *everything* — its own
 * later shots included — so the shot that wins the match is usually the third one.
 *
 * The `debuff` behaviour adds the second bite: the crater blooms with frost a few
 * ticks after the hit and chills again.
 *
 * S1 chips and chills. S2 is the same shot with real weight behind it and twice the
 * chill. SS is the big swing: a fused icicle that cracks open in mid-air and rains six
 * shards, each one carrying the ice type and the debuff down with it.
 *
 * Shielded, so it has a real shield and regenerates it at its own turn start — which
 * is what pays for the low direct damage.
 */
import type { MobileDef } from './index.js';
import { iceSprite } from '../../sprites/mobiles/ice.js';

export const ice: MobileDef = {
  id: 'ice',
  displayName: 'Frostbite',
  class: 'shielded',
  hp: 950,
  shieldMax: 340,
  shieldRegen: 55,
  defence: 0.98,
  moveSpeed: 0.8,
  moveGauge: 150,
  maxStep: 12,
  angleMin: -5,
  angleMax: 78,
  footprint: { w: 26, h: 22 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Frost Shard',
      delay: 250,
      projectile: {
        speed: 14,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 24,
        damage: 165,
        damageRadius: 56,
        damageType: 'ice',
        // DESIGN §3: "+defenceDebuff: 0.08".
        defenceDebuff: 0.08,
        behaviour: 'debuff',
        params: {
          /** Impact → frost bloom, in ticks. */
          lingerTicks: 24,
          /** Bloom damage and radius, as fractions of the shell's. */
          lingerDamageScale: 0.22,
          lingerRadiusScale: 0.9,
          /** Second, smaller chill from the bloom. */
          lingerDebuff: 0.03,
        },
        sprite: 'frostShard',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Glacier Shell',
      delay: 470,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 1.05,
        radius: 4,
        carveRadius: 34,
        damage: 240,
        damageRadius: 70,
        damageType: 'ice',
        // DESIGN §3: "stronger, +0.12".
        defenceDebuff: 0.12,
        behaviour: 'debuff',
        params: {
          lingerTicks: 30,
          lingerDamageScale: 0.26,
          lingerRadiusScale: 0.95,
          lingerDebuff: 0.05,
        },
        sprite: 'glacierShell',
        trail: 'spark',
      },
    },
    ss: {
      displayName: 'Shatter',
      delay: 820,
      projectile: {
        speed: 13,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        carveRadius: 30,
        damage: 260,
        damageRadius: 66,
        damageType: 'ice',
        defenceDebuff: 0.1,
        /**
         * The fuse. It is a tick count, not a distance, so the power dial is what
         * decides where the shell cracks — aim short and the shards rain down, aim
         * long and they overshoot.
         */
        lifetimeTicks: 48,
        behaviour: 'shatter',
        params: {
          /** DESIGN §3: "splits into 6 shards". */
          shards: 6,
          /** Total fan, centred on the shell's direction of travel. */
          spreadDeg: 112,
          shardSpeedScale: 0.8,
          shardDamageScale: 0.6,
          shardRadiusScale: 0.58,
          /** The crack itself, as a fraction of the shell's damage. */
          burstDamageScale: 0.45,
          burstCarveScale: 0.6,
        },
        sprite: 'icicle',
        trail: 'spark',
      },
    },
  },
  sprite: iceSprite,
};
