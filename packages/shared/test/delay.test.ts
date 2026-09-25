/**
 * DESIGN §2.8 and §10: delay ordering, the seat-index tie-break and the time cost.
 */
import { describe, expect, it } from 'vitest';
import {
  addDelay,
  canTakeTurn,
  itemDelay,
  nextSeat,
  shotDelay,
  skipDelay,
  ssReady,
  timeDelay,
  turnDelayCost,
  upcomingOrder,
} from '../src/rules/delay.js';
import { createMatch } from '../src/match/reducer.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import { slotOfSeat } from '../src/match/match.js';
import { armor } from '../src/data/mobiles.js';
import { constants } from '../src/data/constants.js';
import { flatTestMap } from './helpers.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
  { playerId: 'p3', nick: 'three', team: 'A', mobileId: 'armor' },
  { playerId: 'p4', nick: 'four', team: 'B', mobileId: 'armor' },
];

const map = flatTestMap();

function fourSeats(): MatchState {
  return createMatch(7, map, seats, { mode: 'turns' });
}

function setDelays(state: MatchState, delays: number[]): void {
  for (let i = 0; i < delays.length; i++) {
    const slot = slotOfSeat(state, i);
    if (slot) slot.delay = delays[i] as number;
  }
}

describe('delay costs', () => {
  it('charges a shot what its ShotDef says', () => {
    expect(shotDelay(armor.shots.s1)).toBe(250);
    expect(shotDelay(armor.shots.s2)).toBe(450);
    expect(shotDelay(armor.shots.ss)).toBe(800);
    // The design's table: S1 200-320, S2 450, SS 800.
    expect(shotDelay(armor.shots.s1)).toBeGreaterThanOrEqual(200);
    expect(shotDelay(armor.shots.s1)).toBeLessThanOrEqual(320);
  });

  it('charges a skip or a timeout the same flat cost', () => {
    expect(skipDelay()).toBe(constants.turn.skipDelay);
  });

  it('charges +1 per whole second of turn time used', () => {
    expect(timeDelay(0)).toBe(0);
    expect(timeDelay(-5)).toBe(0);
    expect(timeDelay(59)).toBe(0);
    expect(timeDelay(60)).toBe(constants.turn.delayPerSecond);
    expect(timeDelay(119)).toBe(constants.turn.delayPerSecond);
    expect(timeDelay(600)).toBe(10 * constants.turn.delayPerSecond);
    // A turn that runs the timer out costs the full 20 s.
    expect(timeDelay(constants.turn.activeTicks)).toBe(20 * constants.turn.delayPerSecond);
  });

  it('sums the items used on a turn (the Phase 5 hook)', () => {
    expect(itemDelay([])).toBe(0);
    expect(itemDelay(['powerUp'])).toBe(250);
    expect(itemDelay(['powerUp', 'bunge'])).toBe(450);
  });

  it('adds up a whole turn', () => {
    expect(turnDelayCost({ shot: armor.shots.s1, ticksUsed: 300 })).toBe(255);
    expect(turnDelayCost({ skipped: true, ticksUsed: 1200 })).toBe(270);
    expect(turnDelayCost({ shot: armor.shots.ss, ticksUsed: 0, items: ['bunge'] })).toBe(1000);
    // Movement is free: it costs gauge and time, not delay (DESIGN §2.8).
    expect(turnDelayCost({ ticksUsed: 0 })).toBe(0);
  });
});

describe('turn ordering', () => {
  it('picks the lowest delay', () => {
    const state = fourSeats();
    setDelays(state, [700, 250, 900, 450]);
    expect(nextSeat(state)).toBe(1);
    setDelays(state, [700, 250, 90, 450]);
    expect(nextSeat(state)).toBe(2);
  });

  it('breaks a tie by seat index (DESIGN §7 item 4)', () => {
    const state = fourSeats();
    setDelays(state, [500, 500, 500, 500]);
    expect(nextSeat(state)).toBe(0);
    setDelays(state, [900, 300, 300, 300]);
    expect(nextSeat(state)).toBe(1);
    // Equal delays out of order in the array still resolve by seat, not by discovery.
    setDelays(state, [900, 900, 120, 120]);
    expect(nextSeat(state)).toBe(2);
  });

  it('starts a fresh match at seat 0, because every delay is 0', () => {
    const state = fourSeats();
    expect(state.seats.map((s) => s.delay)).toEqual([0, 0, 0, 0]);
    expect(nextSeat(state)).toBe(0);
    expect(state.activeSeat).toBe(0);
  });

  it('skips the dead and the disconnected', () => {
    const state = fourSeats();
    setDelays(state, [0, 10, 20, 30]);
    const dead = state.mobiles[0];
    if (!dead) throw new Error('no mobile');
    dead.alive = false;
    expect(canTakeTurn(state, 0)).toBe(false);
    expect(nextSeat(state)).toBe(1);

    const slot = slotOfSeat(state, 1);
    if (!slot) throw new Error('no slot');
    slot.connected = false;
    expect(canTakeTurn(state, 1)).toBe(false);
    expect(nextSeat(state)).toBe(2);
  });

  it('returns -1 when nobody can play', () => {
    const state = fourSeats();
    for (const m of state.mobiles) m.alive = false;
    expect(nextSeat(state)).toBe(-1);
    expect(upcomingOrder(state, 4)).toEqual([]);
  });

  it('banks delay onto a seat', () => {
    const state = fourSeats();
    expect(addDelay(state, 2, 450)).toBe(450);
    expect(addDelay(state, 2, 20)).toBe(470);
    expect(slotOfSeat(state, 2)?.delay).toBe(470);
    // An unknown seat is ignored rather than throwing.
    expect(addDelay(state, 99, 100)).toBe(0);
  });
});

describe('upcomingOrder (the HUD list)', () => {
  it('sorts by delay then seat and caps at n', () => {
    const state = fourSeats();
    setDelays(state, [700, 250, 250, 450]);
    expect(upcomingOrder(state, 4)).toEqual([1, 2, 3, 0]);
    expect(upcomingOrder(state, 2)).toEqual([1, 2]);
    expect(upcomingOrder(state, 0)).toEqual([]);
    expect(upcomingOrder(state, -1)).toEqual([]);
  });

  it('never lists more players than can play', () => {
    const state = fourSeats();
    const dead = state.mobiles[3];
    if (!dead) throw new Error('no mobile');
    dead.alive = false;
    expect(upcomingOrder(state, 4)).toEqual([0, 1, 2]);
  });

  it('agrees with nextSeat on the head of the list', () => {
    const state = fourSeats();
    setDelays(state, [900, 900, 120, 121]);
    expect(upcomingOrder(state, 4)[0]).toBe(nextSeat(state));
  });
});

describe('ss gauge', () => {
  it('reports ready at the data threshold, which Phase 5 made a real gate', () => {
    const state = fourSeats();
    const slot = slotOfSeat(state, 0);
    if (!slot) throw new Error('no slot');
    expect(ssReady(slot)).toBe(false);
    slot.ssGauge = constants.ss.gaugeMax;
    expect(ssReady(slot)).toBe(true);
    expect(constants.ss.gateEnabled).toBe(true);
  });
});
