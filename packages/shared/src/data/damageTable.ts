/** Damage types, mobile classes and the multiplier table (DESIGN §2.6). */
import { constants } from './constants.js';

export type DamageType = 'explosive' | 'energy' | 'impact' | 'fire' | 'ice' | 'water';
export type MobileClass = 'mechanical' | 'shielded' | 'bionic';

export const damageTypes: DamageType[] = [
  'explosive',
  'energy',
  'impact',
  'fire',
  'ice',
  'water',
];

export const mobileClasses: MobileClass[] = ['mechanical', 'shielded', 'bionic'];

/** rows = damage type, columns = target class. */
export const damageTable: Record<DamageType, Record<MobileClass, number>> = {
  explosive: { mechanical: 1.0, shielded: 0.9, bionic: 1.1 },
  energy: { mechanical: 0.9, shielded: 1.15, bionic: 1.0 },
  impact: { mechanical: 1.1, shielded: 0.95, bionic: 0.9 },
  fire: { mechanical: 1.0, shielded: 1.0, bionic: 1.2 },
  ice: { mechanical: 0.95, shielded: 1.05, bionic: 1.0 },
  water: { mechanical: 1.05, shielded: 1.0, bionic: 0.9 },
};

/**
 * Damage tunables that are not per-shot.
 *
 * The debuff numbers moved to `constants.debuff` when the `defenceDebuff` extension
 * point landed (a shot carries its own debuff amount in `ProjectileDef.defenceDebuff`,
 * and the decay is a turn rule). These two are aliases so nothing that already read
 * them breaks; write new code against `constants.debuff`.
 */
export const damageRules = {
  /** Alias of `constants.debuff.decayPerTurn`. */
  iceDebuffDecayPerTurn: constants.debuff.decayPerTurn,
  /** Alias of `constants.debuff.max`. */
  maxDefenceDebuff: constants.debuff.max,
};
