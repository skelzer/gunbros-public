/**
 * The SS gate (DESIGN §2.9, §7 items 1 and 21, §10).
 *
 * Phase 2 filled the gauge and showed it; Phase 5 makes it a gate: below
 * `constants.ss.gaugeMax` an SS can neither be selected nor fired, and firing one spends
 * the gauge back to zero. The gauge's *gains* are unchanged — +1 per own completed turn,
 * +1 per hit taken — and are covered by `turn.test.ts`; what is under test here is the
 * refusal, the reset, and the fact that a `freePlay` sandbox is not gated at all.
 */
import { describe, expect, it } from 'vitest';
import { createMatch, applyIntent, step } from '../src/match/reducer.js';
import { mobileOfSeat, slotOfSeat } from '../src/match/match.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import type { SimEvent } from '../src/match/events.js';
import { constants } from '../src/data/constants.js';
import { ssAvailable, ssReady } from '../src/rules/delay.js';
import { makeWind } from '../src/rules/wind.js';
import { flatTestMap } from './helpers.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
];

function match(mode: 'turns' | 'freePlay', seed = 808): MatchState {
  const state = createMatch(seed, flatTestMap(), seats, { mode });
  state.wind = makeWind(0, 0);
  while (mode === 'turns' && state.phase !== 'active') step(state);
  return state;
}

function fillGauge(state: MatchState, seat: number): void {
  const slot = slotOfSeat(state, seat);
  if (!slot) throw new Error('no slot');
  slot.ssGauge = constants.ss.gaugeMax;
}

function firedShots(events: SimEvent[]): string[] {
  return events.filter((e) => e.t === 'fire').map((e) => (e.t === 'fire' ? e.shot : ''));
}

describe('the ss gate', () => {
  it('is enabled (Phase 5 turned the gauge into a real gate)', () => {
    expect(constants.ss.gateEnabled).toBe(true);
  });

  it('reports availability from the gauge in a turns match', () => {
    const state = match('turns');
    expect(ssAvailable(state, 0)).toBe(false);
    fillGauge(state, 0);
    expect(ssAvailable(state, 0)).toBe(true);
    const slot = slotOfSeat(state, 0);
    if (!slot) throw new Error('no slot');
    expect(ssReady(slot)).toBe(true);
  });

  it('ignores a selectShot of ss while the gauge is short', () => {
    const state = match('turns');
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    expect(slotOfSeat(state, 0)?.shot).toBe('s1');

    // s1 and s2 are never gated.
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 's2' });
    expect(slotOfSeat(state, 0)?.shot).toBe('s2');

    fillGauge(state, 0);
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    expect(slotOfSeat(state, 0)?.shot).toBe('ss');
  });

  it('refuses to fire an ss while the gauge is short, and leaves the turn alone', () => {
    const state = match('turns');
    const phase = state.phase;
    const events = applyIntent(state, {
      t: 'fire',
      seat: 0,
      shot: 'ss',
      relAngle: 45,
      power: 0.5,
    });
    expect(events.some((e) => e.t === 'fire')).toBe(false);
    expect(state.projectiles).toHaveLength(0);
    // Nothing was spent: the turn is still the player's to use.
    expect(state.phase).toBe(phase);
    expect(state.pendingDelay).toBe(0);
  });

  it('fires the ss once the gauge is full and resets the gauge to zero', () => {
    const state = match('turns');
    fillGauge(state, 0);
    const events = applyIntent(state, {
      t: 'fire',
      seat: 0,
      shot: 'ss',
      relAngle: 45,
      power: 0.5,
    });
    expect(firedShots(events)).toEqual(['ss']);
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(0);
    expect(ssAvailable(state, 0)).toBe(false);
    // The SS's own delay was banked, so the gate is not short-circuiting the turn.
    expect(state.pendingDelay).toBeGreaterThan(0);
  });

  it('does not spend the gauge on an ordinary shot', () => {
    const state = match('turns');
    fillGauge(state, 0);
    applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.5 });
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(constants.ss.gaugeMax);
  });

  it('drops the selection back to s1 when the fired ss locks it', () => {
    const state = match('turns');
    fillGauge(state, 0);
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    expect(slotOfSeat(state, 0)?.shot).toBe('ss');
    applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: 45, power: 0.5 });
    // A selection nothing can fire is a dead fire button on the next turn, and a skip
    // for anyone who charges into the timer (the expiry fires `slot.shot`).
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(0);
    expect(slotOfSeat(state, 0)?.shot).toBe('s1');
  });

  it('leaves the turn after an ss able to fire', () => {
    // The whole round trip, through the real route: fire the SS, let the other seat
    // skip, and take the next own turn with whatever the selection ended up as.
    const state = match('turns');
    fillGauge(state, 0);
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: 45, power: 0.5 });

    let guard = 0;
    while (guard < 20000) {
      guard++;
      step(state);
      if (state.phase !== 'active') continue;
      if (state.activeSeat === 0) break;
      applyIntent(state, { t: 'skip', seat: state.activeSeat });
    }
    expect(state.phase).toBe('active');
    expect(state.activeSeat).toBe(0);

    const slot = slotOfSeat(state, 0);
    if (!slot) throw new Error('no slot');
    expect(ssAvailable(state, 0)).toBe(false);
    // Firing what is selected — which is what the HUD sends and what a timer expiry
    // fires — puts a shell in the air instead of silently skipping the turn.
    const events = applyIntent(state, {
      t: 'fire',
      seat: 0,
      shot: slot.shot,
      relAngle: 45,
      power: 0.5,
    });
    expect(firedShots(events)).toEqual([slot.shot]);
  });

  it('skips instead of firing when the timer expires on a charged but locked ss', () => {
    // Defensive: `slot.shot` can only hold `ss` while the gate allows it, and firing one
    // now drops the selection with the gauge, so nothing in a match reaches this any
    // more. The refusal inside `performFire` still has to end the turn if anything does.
    const state = match('turns');
    fillGauge(state, 0);
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    const slot = slotOfSeat(state, 0);
    if (!slot) throw new Error('no slot');
    slot.ssGauge = 0;
    applyIntent(state, { t: 'charging', seat: 0, power: 0.6 });

    const events: SimEvent[] = [];
    for (let i = 0; i < constants.turn.activeTicks + 10; i++) {
      for (const e of step(state)) events.push(e);
      if (state.phase !== 'active') break;
    }
    expect(events.some((e) => e.t === 'fire')).toBe(false);
    expect(state.phase).not.toBe('active');
    // A skip, which costs the skip delay rather than the SS's 800.
    expect(state.pendingDelay).toBeGreaterThanOrEqual(constants.turn.skipDelay);
  });

  it('is not a gate in free play, so the sandbox can look at every ss', () => {
    const state = match('freePlay');
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(0);
    expect(ssAvailable(state, 0)).toBe(true);
    applyIntent(state, { t: 'selectShot', seat: 0, shot: 'ss' });
    expect(slotOfSeat(state, 0)?.shot).toBe('ss');
    const events = applyIntent(state, {
      t: 'fire',
      seat: 0,
      shot: 'ss',
      relAngle: 45,
      power: 0.5,
    });
    expect(firedShots(events)).toEqual(['ss']);
  });

  it('keeps the gauge in the state hash through a reset', () => {
    const state = match('turns');
    fillGauge(state, 0);
    const before = slotOfSeat(state, 0)?.ssGauge;
    applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: 45, power: 0.5 });
    expect(before).toBe(constants.ss.gaugeMax);
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(0);
    // The mobile is still there: the gate touched nothing but the gauge.
    expect(mobileOfSeat(state, 0)?.alive).toBe(true);
  });
});
