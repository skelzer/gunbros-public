/**
 * Wind (DESIGN §2.7). Strength is drawn from [0, maxStrength] weighted toward calm
 * (the lowest of a few uniform draws), direction is uniform over [0, 360).
 *
 * The acceleration vector is `windScale * strength * (cos θ, sin θ)` per tick. World +y
 * points down, so θ in (180, 360) blows a projectile *upwards*.
 */
import type { Prng } from '../math/prng.js';
import { cosDeg, sinDeg } from '../math/trig.js';
import { constants } from '../data/constants.js';

export interface WindState {
  /** 0 … constants.wind.maxStrength. */
  strength: number;
  /** Degrees in [0, 360). */
  directionDeg: number;
  /** Per-tick acceleration, derived from the two fields above. */
  x: number;
  y: number;
}

/** Per-tick acceleration for a wind of this strength and direction. */
export function windVector(strength: number, directionDeg: number): { x: number; y: number } {
  const k = constants.wind.scale * strength;
  return { x: k * cosDeg(directionDeg), y: k * sinDeg(directionDeg) };
}

export function makeWind(strength: number, directionDeg: number): WindState {
  const v = windVector(strength, directionDeg);
  return { strength, directionDeg, x: v.x, y: v.y };
}

/** Draw a fresh wind from the match PRNG. Consumes `strengthSamples + 1` draws. */
export function generateWind(rng: Prng): WindState {
  let low = 1;
  for (let i = 0; i < constants.wind.strengthSamples; i++) low = Math.min(low, rng.nextFloat());
  const strength = Math.round(low * constants.wind.maxStrength);
  const directionDeg = Math.floor(rng.nextFloat() * 360);
  return makeWind(strength, directionDeg);
}

/** True on the completed turns where the wind should be rerolled. */
export function windChangesOnTurn(completedTurns: number): boolean {
  if (completedTurns <= 0) return false;
  return completedTurns % constants.wind.changeEveryTurns === 0;
}
