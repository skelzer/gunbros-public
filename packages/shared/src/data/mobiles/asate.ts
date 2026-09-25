/**
 * Orbital (`asate`) — DESIGN §3, class `mechanical`.
 *
 * A designator, not a gun. Every shot lobs a painter shell; where it lands, the
 * satellite overhead answers with beams straight down from the top of the map
 * (`entities/behaviours/satellite.ts`, through `ctx.beamStrike`). A beam ignores
 * whatever is between the sky and the mark — it carves its way through — so Orbital is
 * the answer to a target dug into a hillside.
 *
 * `params` per shot:
 * - `delayTicks` — ticks between the paint and the first beam,
 * - `beams`, `intervalTicks`, `spreadPx` — how many columns come down, how far apart
 *   in time and how wide the fan is across the mark,
 * - `beamWidth` — the column's full width in px; it is also the hole it leaves,
 * - `beamDamage`, `beamDamageRadius` — the strike itself, falling off with the
 *   distance to the column.
 *
 * Statline: light, quick and precise — a low hp pool with no shield, the widest useful
 * aim range in the group and a painter shell that flies flat and fast.
 */
import type { MobileDef } from './index.js';
import { asateSprite } from '../../sprites/mobiles/asate.js';

export const asate: MobileDef = {
  id: 'asate',
  displayName: 'Orbital',
  class: 'mechanical',
  hp: 920,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 0.95,
  moveSpeed: 0.95,
  moveGauge: 175,
  maxStep: 12,
  angleMin: 0,
  angleMax: 80,
  footprint: { w: 26, h: 20 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Painter',
      delay: 270,
      projectile: {
        speed: 14.6,
        gravity: 1,
        windFactor: 0.9,
        radius: 3,
        carveRadius: 12,
        damage: 60,
        damageRadius: 34,
        damageType: 'energy',
        behaviour: 'satellite',
        params: {
          delayTicks: 26,
          beams: 1,
          intervalTicks: 0,
          spreadPx: 0,
          beamWidth: 16,
          beamDamage: 235,
          beamDamageRadius: 62,
        },
        sprite: 'painter',
        trail: 'spark',
      },
    },
    s2: {
      displayName: 'Tri-Beam',
      delay: 500,
      projectile: {
        speed: 14.0,
        gravity: 1,
        windFactor: 0.95,
        radius: 3,
        carveRadius: 14,
        damage: 70,
        damageRadius: 38,
        damageType: 'energy',
        behaviour: 'satellite',
        params: {
          delayTicks: 30,
          beams: 3,
          intervalTicks: 8,
          spreadPx: 108,
          beamWidth: 12,
          beamDamage: 160,
          beamDamageRadius: 52,
        },
        sprite: 'painter',
        trail: 'spark',
      },
    },
    ss: {
      displayName: 'Orbital Lance',
      delay: 860,
      projectile: {
        speed: 13.4,
        gravity: 1,
        windFactor: 1,
        radius: 4,
        carveRadius: 18,
        damage: 90,
        damageRadius: 44,
        damageType: 'energy',
        behaviour: 'satellite',
        params: {
          delayTicks: 36,
          beams: 1,
          intervalTicks: 0,
          spreadPx: 0,
          beamWidth: 46,
          beamDamage: 470,
          beamDamageRadius: 120,
        },
        sprite: 'painterHeavy',
        trail: 'spark',
      },
    },
  },
  sprite: asateSprite,
};
