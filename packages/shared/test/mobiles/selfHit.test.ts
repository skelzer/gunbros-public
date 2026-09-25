/**
 * Nobody blows themselves up at the muzzle (DESIGN §2.5, §7 item 32).
 *
 * The rule the sim enforces is "the shooter is immune until its own shot has been
 * outside its hull box at least once" (`entities/projectile.ts`). A fixed tick grace
 * could not express it, and two families of shot proved that:
 *
 * - sprites whose barrel pivot sits *inside* the footprint box at some legal angles
 *   (grub's pivot is left of and above its anchor, kalsiddon's is low under a tall
 *   hull, turtle's converge ball drifts sideways off the muzzle) — a slow shell at a
 *   quarter power had not left the box when a 2-tick grace ran out;
 * - the multi-body shots, `orbit` (trico S2) and `weave` (mage S2), which pull one body
 *   a ring radius *back* from the muzzle on the very first sub-step, so the trailing
 *   body sat in the shooter's chest while the ring centre crawled away.
 *
 * What is still allowed: a shot at 10 % power that clears the hull, falls back onto its
 * owner and detonates at its feet. That is the accepted dud, so the sweep starts at a
 * power the mobile is actually trying to shoot with, and only looks at the first few
 * ticks — a shell that flew somewhere and caught its owner in the blast is fair play.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import type { MobileId, ShotSlot } from '../../src/data/mobiles/index.js';
import { getMobileDef } from '../../src/data/mobiles/index.js';
import { mobileOfSeat } from '../../src/match/match.js';
import { createDuel } from './helpers.js';

/** Powers from "a nudge" up to "everything", skipping the accepted dud at 10 %. */
const POWERS = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0];
const ANGLES = [0, 10, 20, 25, 35, 45, 50, 60];
const ALL_SLOTS: ShotSlot[] = ['s1', 's2', 'ss'];
/** Ticks a shot is given to leave the barrel. */
const MUZZLE_TICKS = 8;

/**
 * Did this shot go off *inside* its own shooter?
 *
 * The test is the explosion's position against the shooter's footprint box, not the
 * damage: a flat quarter-power shell that lands 45 px away and splashes its owner for
 * 8 hp is ordinary ballistics and every mobile can do it. A blast whose centre is in the
 * shooter's chest is the muzzle bug, and it is worth a quarter of the hp bar.
 */
function detonatesInsideShooter(
  id: MobileId,
  slot: ShotSlot,
  angle: number,
  power: number,
): boolean {
  const state = createDuel(id, 'armor', 4242);
  const def = getMobileDef(id);
  const shooter = mobileOfSeat(state, 0);
  if (!shooter) throw new Error('no shooter');
  const halfW = def.footprint.w / 2 + 2;
  const top = shooter.y - def.footprint.h - 2;
  const bottom = shooter.y + 2;
  const inside = (x: number, y: number): boolean =>
    x >= shooter.x - halfW && x <= shooter.x + halfW && y >= top && y <= bottom;

  applyIntent(state, { t: 'aim', seat: 0, relAngle: angle });
  applyIntent(state, { t: 'selectShot', seat: 0, shot: slot });
  const fired = applyIntent(state, { t: 'fire', seat: 0, shot: slot, relAngle: angle, power });
  for (const e of fired) if (e.t === 'explosion' && inside(e.x, e.y)) return true;
  for (let i = 0; i < MUZZLE_TICKS; i++) {
    for (const e of step(state)) {
      if (e.t === 'explosion' && inside(e.x, e.y)) return true;
    }
  }
  return false;
}

/** Every angle/power in the grid at which the shot went off inside its own shooter. */
function selfHits(id: MobileId, slot: ShotSlot): string[] {
  const def = getMobileDef(id);
  const out: string[] = [];
  for (const angle of ANGLES) {
    if (angle < def.angleMin || angle > def.angleMax) continue;
    for (const power of POWERS) {
      if (detonatesInsideShooter(id, slot, angle, power)) {
        out.push(`${slot} ang=${angle} pw=${power}`);
      }
    }
  }
  return out;
}

describe('no mobile detonates its own shot at the muzzle', () => {
  const cases: Array<[MobileId, ShotSlot[]]> = [
    // The multi-body shots: one body starts behind the muzzle.
    ['trico', ['s2']],
    ['mage', ['s2']],
    // The low-slung sprites: the muzzle is inside the hull at shallow angles.
    ['grub', ALL_SLOTS],
    ['kalsiddon', ALL_SLOTS],
    ['turtle', ALL_SLOTS],
    // The control: armor has never done this, and must not start.
    ['armor', ALL_SLOTS],
  ];

  for (const [id, slots] of cases) {
    for (const slot of slots) {
      it(`${id} ${slot} never hits itself at the barrel`, () => {
        expect(selfHits(id, slot)).toEqual([]);
      });
    }
  }
});
