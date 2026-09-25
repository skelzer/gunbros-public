/**
 * Sudden death (DESIGN §2.9, §7 item 11).
 *
 * A rule, not a sky event, so it always applies: once enough turns have been *completed*
 * every damage roll in the match is multiplied, and again at a second threshold. It
 * lived in `rules/damage.ts` until Phase 5; it is its own module now because the turn
 * machine also has to announce it (`suddenDeath` event) and `damage.ts` should not be
 * the place the turn machine imports from.
 *
 * Everything here is a pure function of `completedTurns`, so no engine has to carry a
 * "sudden death is on" flag and no snapshot has to remember one.
 */
import { constants } from '../data/constants.js';

/** 0 = no sudden death, 1 = the first level, 2 = the second. */
export function suddenDeathLevel(completedTurns: number): number {
  if (completedTurns >= constants.suddenDeath.secondAfterTurns) return 2;
  if (completedTurns >= constants.suddenDeath.afterTurns) return 1;
  return 0;
}

/** Damage multiplier for a level from {@link suddenDeathLevel}. */
export function suddenDeathMultiplierForLevel(level: number): number {
  if (level >= 2) return constants.suddenDeath.secondMultiplier;
  if (level >= 1) return constants.suddenDeath.multiplier;
  return 1;
}

/** Damage multiplier after `completedTurns` completed turns (1 before the first level). */
export function suddenDeathMultiplier(completedTurns: number): number {
  return suddenDeathMultiplierForLevel(suddenDeathLevel(completedTurns));
}

/** Completed turns at which `level` begins; 0 for a level that is not a threshold. */
export function suddenDeathStartTurn(level: number): number {
  if (level === 1) return constants.suddenDeath.afterTurns;
  if (level === 2) return constants.suddenDeath.secondAfterTurns;
  return 0;
}
