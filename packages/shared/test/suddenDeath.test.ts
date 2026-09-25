/**
 * Sudden death (DESIGN §2.9, §7 item 11, §10).
 *
 * It is a pure function of `completedTurns`, so most of this is arithmetic; the parts
 * worth a match are that damage really is multiplied by it and that the turn machine
 * announces each level exactly once.
 */
import { describe, expect, it } from 'vitest';
import { createMatch, applyIntent, step } from '../src/match/reducer.js';
import { mobileOfSeat, slotOfSeat } from '../src/match/match.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import type { SimEvent } from '../src/match/events.js';
import { constants } from '../src/data/constants.js';
import { armor } from '../src/data/mobiles.js';
import { makeWind } from '../src/rules/wind.js';
import { computeDamage } from '../src/rules/damage.js';
import {
  suddenDeathLevel,
  suddenDeathMultiplier,
  suddenDeathMultiplierForLevel,
  suddenDeathStartTurn,
} from '../src/rules/suddenDeath.js';
import { flatTestMap, makeArmor } from './helpers.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
];

/** Reading the phase through a function, so TypeScript does not narrow it to a literal. */
function phaseOf(state: MatchState): string {
  return state.phase;
}

function turnMatch(seed = 4242): MatchState {
  const state = createMatch(seed, flatTestMap(), seats, { mode: 'turns' });
  state.wind = makeWind(0, 0);
  return state;
}

describe('sudden death levels', () => {
  it('is off until the first threshold', () => {
    expect(suddenDeathLevel(0)).toBe(0);
    expect(suddenDeathLevel(constants.suddenDeath.afterTurns - 1)).toBe(0);
    expect(suddenDeathMultiplier(0)).toBe(1);
  });

  it('steps up at each threshold and stays there', () => {
    const { afterTurns, multiplier, secondAfterTurns, secondMultiplier } = constants.suddenDeath;
    expect(suddenDeathLevel(afterTurns)).toBe(1);
    expect(suddenDeathMultiplier(afterTurns)).toBe(multiplier);
    expect(suddenDeathMultiplier(secondAfterTurns - 1)).toBe(multiplier);
    expect(suddenDeathLevel(secondAfterTurns)).toBe(2);
    expect(suddenDeathMultiplier(secondAfterTurns)).toBe(secondMultiplier);
    expect(suddenDeathMultiplier(secondAfterTurns + 500)).toBe(secondMultiplier);
  });

  it('agrees with itself about levels, multipliers and thresholds', () => {
    for (const turns of [0, 5, 39, 40, 41, 59, 60, 61, 900]) {
      const level = suddenDeathLevel(turns);
      expect(suddenDeathMultiplierForLevel(level)).toBe(suddenDeathMultiplier(turns));
      if (level > 0) expect(turns).toBeGreaterThanOrEqual(suddenDeathStartTurn(level));
    }
    expect(suddenDeathStartTurn(0)).toBe(0);
    expect(suddenDeathStartTurn(1)).toBe(constants.suddenDeath.afterTurns);
    expect(suddenDeathStartTurn(2)).toBe(constants.suddenDeath.secondAfterTurns);
  });

  it('is a damage multiplier, not a rule of its own', () => {
    const target = makeArmor(0, 0, 0);
    const plain = computeDamage(200, 0, 100, 'explosive', armor, target);
    const doubled = computeDamage(200, 0, 100, 'explosive', armor, target, {
      extra: suddenDeathMultiplier(constants.suddenDeath.afterTurns),
    });
    expect(doubled).toBeCloseTo(plain * constants.suddenDeath.multiplier, 9);
  });
});

describe('sudden death in a match', () => {
  it('multiplies real damage once the completed turns are there', () => {
    const before = turnMatch();
    const after = turnMatch();
    for (const state of [before, after]) {
      const shooter = mobileOfSeat(state, 0);
      const target = mobileOfSeat(state, 1);
      if (!shooter || !target) throw new Error('no mobiles');
      target.x = shooter.x + 90;
      target.hp = 10_000;
    }
    // Only the turn counter differs; the shot is the same one from the same seed.
    after.completedTurns = constants.suddenDeath.afterTurns;

    const damageOf = (state: MatchState): number => {
      while (state.phase !== 'active') step(state);
      const target = mobileOfSeat(state, 1);
      if (!target) throw new Error('no target');
      const hp = target.hp;
      applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 0, power: 0.35 });
      for (let i = 0; i < 600; i++) {
        step(state);
        if (phaseOf(state) !== 'resolving') break;
      }
      return hp - target.hp;
    };

    const plain = damageOf(before);
    const doubled = damageOf(after);
    expect(plain).toBeGreaterThan(0);
    expect(doubled).toBeCloseTo(plain * constants.suddenDeath.multiplier, 4);
  });

  it('announces a level once, on the turn end that crosses it', () => {
    const state = turnMatch();
    // Park the counter one completed turn short of the threshold and skip a turn.
    state.completedTurns = constants.suddenDeath.afterTurns - 1;
    const events: SimEvent[] = [];
    while (state.phase !== 'active') step(state);
    applyIntent(state, { t: 'skip', seat: state.activeSeat });
    for (let i = 0; i < 400; i++) for (const e of step(state)) events.push(e);

    const announced = events.filter((e): e is Extract<SimEvent, { t: 'suddenDeath' }> =>
      e.t === 'suddenDeath',
    );
    expect(announced).toHaveLength(1);
    expect(announced[0]?.level).toBe(1);
    expect(announced[0]?.multiplier).toBe(constants.suddenDeath.multiplier);
    expect(announced[0]?.completedTurns).toBe(constants.suddenDeath.afterTurns);
  });

  it('says nothing on an ordinary turn', () => {
    const state = turnMatch();
    const events: SimEvent[] = [];
    while (state.phase !== 'active') step(state);
    applyIntent(state, { t: 'skip', seat: state.activeSeat });
    for (let i = 0; i < 400; i++) for (const e of step(state)) events.push(e);
    expect(events.some((e) => e.t === 'suddenDeath')).toBe(false);
    // And the seat that skipped still banked its delay: the level check must not have
    // become a condition on the rest of `finishTurn`.
    expect(slotOfSeat(state, 0)?.delay).toBeGreaterThan(0);
  });
});
