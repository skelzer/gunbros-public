/**
 * Quantisation helpers.
 *
 * Floating point positions are fine to simulate with, but hashing and wire snapshots
 * need a canonical integer form so that a value that differs only in the last few bits
 * hashes the same on two machines. `q8` is the sim-wide convention: 1/256 px resolution.
 */
import { constants } from '../data/constants.js';

/** Quantise to 1/256 units, as an integer (the hash and snapshot representation). */
export function q8(v: number): number {
  return Math.floor(v * 256);
}

/** Inverse of {@link q8}. */
export function fromQ8(v: number): number {
  return v / 256;
}

/** Round a value to the nearest 1/256. */
export function snapQ8(v: number): number {
  return Math.floor(v * 256) / 256;
}

/**
 * Quantise a power bar value to `constants.power.quantiseSteps` steps and clamp into
 * [0, 1] (see DESIGN §2.10). A non-finite input (a missing field after JSON, a NaN from
 * a stale client) is not a number the sim can carry, and every comparison against it is
 * false, so it would sail through a naive clamp: it becomes 0, the harmless end of the
 * range.
 */
export function quantisePower(p: number): number {
  if (!isFiniteNumber(p)) return 0;
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  const steps = constants.power.quantiseSteps;
  return Math.round(clamped * steps) / steps;
}

/**
 * Clamp helper used all over the sim. Non-finite input clamps to `min` rather than
 * propagating: one NaN in a position or an angle poisons the state forever.
 */
export function clamp(v: number, min: number, max: number): number {
  if (!isFiniteNumber(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/** True for a real, finite number: rejects NaN, ±Infinity and non-numbers. */
export function isFiniteNumber(v: number): boolean {
  return typeof v === 'number' && v - v === 0;
}
