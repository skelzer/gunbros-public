/**
 * Sapper (`raon`) — DESIGN §3, class `mechanical`.
 *
 * The minelayer. Its direct shot is the weakest opening in the roster, but both of its
 * other shots leave something behind: a walking mine that creeps toward the nearest
 * enemy at every turn start, detonates when it gets close and goes off if anything
 * blows the ground out from under it (`entities/mines.ts`). Played well, a Sapper wins
 * ground it never shot at; played badly, it spends two turns arming a crater.
 *
 * Every mine number is a `params` entry on the shot that drops it, read by
 * `entities/behaviours/mineDrop.ts` and handed to `createMine`:
 *
 * - `mineHp`, `mineRadius` (an explosion this close sets it off),
 *   `mineTriggerRadius` (an enemy this close sets it off),
 * - `mineSpeed` (px walked per turn), `mineClimb` (tallest rise it can step up — big
 *   enough to climb out of the crater its own delivery charge digs), `mineTtlTurns`,
 * - `mineDamage`, `mineDamageRadius`, `mineCarveRadius`,
 * - `variant` (0 = the light mine's sprite key, 1 = the heavy one's).
 *
 * Statline: a shade tougher than armor at the same defence, slightly quicker on its
 * tracks and with a flatter aim range, because a minelayer wants to *place* a charge
 * rather than lob it over a hill.
 */
import type { MobileDef } from './index.js';
import { raonSprite } from '../../sprites/mobiles/raon.js';

export const raon: MobileDef = {
  id: 'raon',
  displayName: 'Sapper',
  class: 'mechanical',
  hp: 1150,
  shieldMax: 0,
  shieldRegen: 0,
  defence: 0.98,
  moveSpeed: 1.0,
  moveGauge: 190,
  maxStep: 13,
  angleMin: -15,
  angleMax: 62,
  footprint: { w: 28, h: 18 },
  randomOnly: false,
  randomWeight: 10,
  shots: {
    s1: {
      displayName: 'Charge',
      delay: 240,
      projectile: {
        speed: 14.0,
        gravity: 1,
        windFactor: 1,
        radius: 3,
        carveRadius: 24,
        damage: 175,
        damageRadius: 54,
        damageType: 'explosive',
        behaviour: 'basic',
        sprite: 'sapperCharge',
        trail: 'smoke',
      },
    },
    s2: {
      displayName: 'Mine Drop',
      delay: 470,
      projectile: {
        speed: 13.2,
        gravity: 1,
        windFactor: 1.1,
        radius: 4,
        // The deployment burst is small on purpose: the shot is paid for by the mine.
        carveRadius: 18,
        damage: 80,
        damageRadius: 42,
        damageType: 'explosive',
        behaviour: 'mineDrop',
        params: {
          mineHp: 45,
          mineRadius: 22,
          mineTriggerRadius: 28,
          mineSpeed: 70,
          mineClimb: 14,
          mineTtlTurns: 6,
          mineDamage: 210,
          mineDamageRadius: 62,
          mineCarveRadius: 28,
          variant: 0,
        },
        sprite: 'minePod',
        trail: 'smoke',
      },
    },
    ss: {
      displayName: 'Siege Mine',
      delay: 820,
      projectile: {
        speed: 12.6,
        gravity: 1,
        windFactor: 1.2,
        radius: 5,
        carveRadius: 26,
        damage: 130,
        damageRadius: 58,
        damageType: 'explosive',
        behaviour: 'mineDrop',
        params: {
          mineHp: 95,
          mineRadius: 30,
          mineTriggerRadius: 40,
          mineSpeed: 105,
          mineClimb: 20,
          mineTtlTurns: 8,
          mineDamage: 430,
          mineDamageRadius: 100,
          mineCarveRadius: 48,
          variant: 1,
        },
        sprite: 'minePodHeavy',
        trail: 'smoke',
      },
    },
  },
  sprite: raonSprite,
};
