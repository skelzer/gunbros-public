/**
 * The turn machine (DESIGN §2.9, §2.4, §2.7, §2.10, §7 items 3, 4, 6, 7).
 *
 * Everything here is counted in ticks: the simulation has no clock, so "0.5 s" is 30
 * steps of `step()` and the 20 s timer is 1200 of them.
 */
import { describe, expect, it } from 'vitest';
import { createMatch, applyIntent, step } from '../src/match/reducer.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import { mobileOfSeat, slotOfSeat } from '../src/match/match.js';
import type { SimEvent, SimEventType } from '../src/match/events.js';
import { constants } from '../src/data/constants.js';
import { armor } from '../src/data/mobiles.js';
import { makeWind } from '../src/rules/wind.js';
import { secondsLeft } from '../src/rules/turn.js';
import { settleOnGround } from '../src/entities/mobile.js';
import { flatTestMap, maskMap, stepTerrain } from './helpers.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
];

const map = flatTestMap();

function turnMatch(seed = 11): MatchState {
  const state = createMatch(seed, map, seats, { mode: 'turns' });
  // A stiff wind would sail the test shells off the arena; the turn machine is what is
  // under test here, not ballistics.
  state.wind = makeWind(0, 0);
  return state;
}

/** Step `n` ticks and collect everything they emitted. */
function run(state: MatchState, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) for (const e of step(state)) out.push(e);
  return out;
}

/** Step until the machine reaches `phase` (or `max` ticks pass). */
function runUntilPhase(state: MatchState, phase: MatchState['phase'], max = 4000): SimEvent[] {
  const out: SimEvent[] = [];
  let n = 0;
  while (state.phase !== phase && n < max) {
    for (const e of step(state)) out.push(e);
    n++;
  }
  return out;
}

function types(events: SimEvent[]): SimEventType[] {
  return events.map((e) => e.t);
}

describe('turn machine', () => {
  it('ends the match at once when the last enemy dies during someone else\'s turn', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const other = state.activeSeat === 0 ? 1 : 0;
    // The authority forfeits the other seat mid-turn (it left the room).
    applyIntent(state, { t: 'forfeit', seat: other });
    const events = run(state, 10);
    expect(types(events)).toContain('matchEnd');
    expect(state.phase).toBe('ended');
    expect(state.winnerTeam).toBe(mobileOfSeat(state, state.activeSeat)?.team);
  });

  it('ends the match during the turn-start pause too', () => {
    const state = turnMatch();
    step(state);
    expect(state.phase).toBe('starting');
    const other = state.activeSeat === 0 ? 1 : 0;
    applyIntent(state, { t: 'forfeit', seat: other });
    run(state, 10);
    expect(state.phase).toBe('ended');
  });

  it('opens turn 1 on the first step, at seat 0', () => {
    const state = turnMatch();
    expect(state.phase).toBe('starting');
    expect(state.turn).toBe(0);

    const events = run(state, 1);
    expect(state.turn).toBe(1);
    expect(state.activeSeat).toBe(0);
    expect(state.phase).toBe('starting');
    expect(state.turnTicksLeft).toBe(constants.turn.startingTicks);
    const started = events.find((e) => e.t === 'turnStart');
    expect(started).toEqual({ t: 'turnStart', seat: 0, turn: 1 });
  });

  it('runs starting -> active -> resolving -> ending -> the next turn', () => {
    const state = turnMatch();
    run(state, 1 + constants.turn.startingTicks - 1);
    expect(state.phase).toBe('starting');
    run(state, 1);
    expect(state.phase).toBe('active');
    expect(state.turnTicksLeft).toBe(constants.turn.activeTicks);
    expect(state.turnStartTick).toBe(constants.turn.startingTicks);

    applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.5 });
    expect(state.phase).toBe('resolving');
    expect(state.projectiles).toHaveLength(1);

    const resolved = runUntilPhase(state, 'ending');
    expect(state.phase).toBe('ending');
    expect(state.turnTicksLeft).toBe(constants.turn.endingTicks);
    expect(state.completedTurns).toBe(1);
    expect(types(resolved)).toContain('turnEnd');

    // The ending pause runs out and the next seat is up.
    run(state, constants.turn.endingTicks - 1);
    expect(state.phase).toBe('ending');
    const opened = run(state, 1);
    expect(state.phase).toBe('starting');
    expect(state.turn).toBe(2);
    expect(state.activeSeat).toBe(1);
    expect(opened.some((e) => e.t === 'turnStart' && e.seat === 1 && e.turn === 2)).toBe(true);
  });

  it('only accepts the active seat, and only while the turn is active', () => {
    const state = turnMatch();
    run(state, 1);
    // Still in `starting`: nothing lands.
    const before = mobileOfSeat(state, 0)?.relAngle ?? 0;
    applyIntent(state, { t: 'aim', seat: 0, relAngle: 12 });
    expect(mobileOfSeat(state, 0)?.relAngle).toBe(before);

    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'aim', seat: 0, relAngle: 12 });
    expect(mobileOfSeat(state, 0)?.relAngle).toBe(12);

    // The other seat is ignored entirely.
    applyIntent(state, { t: 'aim', seat: 1, relAngle: 12 });
    applyIntent(state, { t: 'fire', seat: 1, shot: 's1', relAngle: 45, power: 1 });
    expect(mobileOfSeat(state, 1)?.relAngle).not.toBe(12);
    expect(state.projectiles).toHaveLength(0);
    expect(state.phase).toBe('active');
  });

  it('charges a fired turn the shot delay plus the seconds used', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    run(state, 180); // three seconds of thinking
    applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: 45, power: 0.5 });
    runUntilPhase(state, 'ending');
    expect(slotOfSeat(state, 0)?.delay).toBe(armor.shots.s2.delay + 3);
    expect(slotOfSeat(state, 1)?.delay).toBe(0);
    // Lowest delay goes next.
    runUntilPhase(state, 'active');
    expect(state.activeSeat).toBe(1);
  });

  it('banks the delay only once the shot has resolved', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.5 });
    expect(state.phase).toBe('resolving');
    expect(slotOfSeat(state, 0)?.delay).toBe(0);
    expect(state.pendingDelay).toBe(armor.shots.s1.delay);
    runUntilPhase(state, 'ending');
    expect(slotOfSeat(state, 0)?.delay).toBe(armor.shots.s1.delay);
    expect(state.pendingDelay).toBe(0);
  });

  it('ends the turn as a skip when the timer runs out', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const events = run(state, constants.turn.activeTicks);
    expect(state.phase).toBe('resolving');
    expect(state.projectiles).toHaveLength(0);
    runUntilPhase(state, 'ending');
    // Skip cost plus the full 20 s of turn time.
    expect(slotOfSeat(state, 0)?.delay).toBe(constants.turn.skipDelay + 20);

    const warning = events.find((e) => e.t === 'timerWarning');
    expect(warning).toEqual({
      t: 'timerWarning',
      seat: 0,
      secondsLeft: constants.turn.warningSeconds,
    });
    expect(events.filter((e) => e.t === 'timerWarning')).toHaveLength(1);
  });

  it('fires at the reported power when the timer expires mid-charge', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'charging', seat: 0, power: 0.42 });
    expect(state.chargingPower).toBe(0.42);

    const events = run(state, constants.turn.activeTicks);
    const fired = events.find((e) => e.t === 'fire');
    expect(fired?.t === 'fire' && fired.power).toBe(0.42);
    expect(state.projectiles).toHaveLength(1);
    expect(state.lastShotPower[0]).toBe(0.42);
    expect(state.phase).toBe('resolving');

    runUntilPhase(state, 'ending');
    // A fired timeout costs the shot, not the skip.
    expect(slotOfSeat(state, 0)?.delay).toBe(armor.shots.s1.delay + 20);
  });

  it('skips when the client said it stopped charging', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'charging', seat: 0, power: 0.42 });
    applyIntent(state, { t: 'charging', seat: 0, power: -1 });
    expect(state.chargingPower).toBe(-1);
    run(state, constants.turn.activeTicks);
    expect(state.projectiles).toHaveLength(0);
    runUntilPhase(state, 'ending');
    expect(slotOfSeat(state, 0)?.delay).toBe(constants.turn.skipDelay + 20);
  });

  it('ends the turn on a skip intent', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    run(state, 120);
    applyIntent(state, { t: 'skip', seat: 0 });
    expect(state.phase).toBe('resolving');
    runUntilPhase(state, 'ending');
    expect(slotOfSeat(state, 0)?.delay).toBe(constants.turn.skipDelay + 2);
    expect(state.completedTurns).toBe(1);
  });

  it('refills the move gauge at the start of the owner turn and nowhere else', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const mine = mobileOfSeat(state, 0);
    const theirs = mobileOfSeat(state, 1);
    if (!mine || !theirs) throw new Error('no mobiles');
    expect(mine.moveGauge).toBe(armor.moveGauge);

    applyIntent(state, { t: 'move', seat: 0, dir: 1 });
    run(state, 60);
    applyIntent(state, { t: 'move', seat: 0, dir: 0 });
    const spent = mine.moveGauge;
    expect(spent).toBeLessThan(armor.moveGauge);
    expect(spent).toBeGreaterThan(0);

    applyIntent(state, { t: 'skip', seat: 0 });
    runUntilPhase(state, 'active');
    // Seat 1's turn: its gauge is full, seat 0's is untouched.
    expect(state.activeSeat).toBe(1);
    expect(theirs.moveGauge).toBe(armor.moveGauge);
    expect(mine.moveGauge).toBe(spent);

    // Keep skipping until seat 0 comes back round (seat 1's skips are cheaper than
    // seat 0's, which spent a second walking, so it may take two of them).
    for (let guard = 0; guard < 6 && state.activeSeat !== 0; guard++) {
      applyIntent(state, { t: 'skip', seat: state.activeSeat });
      runUntilPhase(state, 'active');
    }
    expect(state.activeSeat).toBe(0);
    expect(mine.moveGauge).toBe(armor.moveGauge);
  });

  it('never walks further than one gauge in a turn', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const startX = m.x;
    applyIntent(state, { t: 'move', seat: 0, dir: 1 });
    run(state, constants.turn.activeTicks - 1);
    expect(m.x - startX).toBeCloseTo(armor.moveGauge, 6);
    expect(m.moveGauge).toBe(0);
  });

  it('still refuses a climb steeper than maxStep during a turn', () => {
    const wall = maskMap('testStep', stepTerrain(1600, 900, 600, 800, 40));
    const state = createMatch(11, wall, seats, { mode: 'turns' });
    state.wind = makeWind(0, 0);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    m.x = 740;
    settleOnGround(m, armor, state.terrain);
    runUntilPhase(state, 'active');

    applyIntent(state, { t: 'move', seat: 0, dir: 1 });
    run(state, 400);
    // The 40 px rise is far beyond armor's 5 px maxStep: it stops at the wall with
    // gauge to spare, rather than teleporting up it.
    expect(m.x).toBeLessThan(800);
    expect(m.x).toBeGreaterThan(740);
    expect(m.moveGauge).toBeGreaterThan(0);
    expect(m.y).toBe(600);
  });

  it('changes the wind every wind.changeEveryTurns completed turns', () => {
    const state = turnMatch();
    const seen: string[] = [];
    const changes: number[] = [];
    for (let turn = 1; turn <= 4; turn++) {
      runUntilPhase(state, 'active');
      seen.push(`${state.wind.strength}:${state.wind.directionDeg}`);
      applyIntent(state, { t: 'skip', seat: state.activeSeat });
      const events = runUntilPhase(state, 'ending');
      if (events.some((e) => e.t === 'windChange')) changes.push(state.completedTurns);
    }
    expect(changes).toEqual([2, 4]);
    expect(seen[0]).toBe(seen[1]); // unchanged across turn 1 -> 2
    expect(seen[2]).not.toBe(seen[1]); // rerolled after turn 2
  });

  it('regenerates a shield at the start of its own turn only (DESIGN §7 item 7)', () => {
    const shieldMax = 300;
    const shieldRegen = 50;
    const original = { shieldMax: armor.shieldMax, shieldRegen: armor.shieldRegen };
    armor.shieldMax = shieldMax;
    armor.shieldRegen = shieldRegen;
    try {
      const state = turnMatch();
      const mine = mobileOfSeat(state, 0);
      const theirs = mobileOfSeat(state, 1);
      if (!mine || !theirs) throw new Error('no mobiles');
      mine.shield = 100;
      theirs.shield = 100;

      runUntilPhase(state, 'active');
      expect(state.activeSeat).toBe(0);
      expect(mine.shield).toBe(150);
      expect(theirs.shield).toBe(100);

      applyIntent(state, { t: 'skip', seat: 0 });
      runUntilPhase(state, 'active');
      expect(state.activeSeat).toBe(1);
      expect(mine.shield).toBe(150);
      expect(theirs.shield).toBe(150);

      // And it never exceeds the maximum.
      theirs.shield = shieldMax;
      applyIntent(state, { t: 'skip', seat: 1 });
      runUntilPhase(state, 'active');
      applyIntent(state, { t: 'skip', seat: 0 });
      runUntilPhase(state, 'active');
      expect(theirs.shield).toBe(shieldMax);
    } finally {
      armor.shieldMax = original.shieldMax;
      armor.shieldRegen = original.shieldRegen;
    }
  });

  it('fills the SS gauge from own turns and hits taken', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'skip', seat: 0 });
    runUntilPhase(state, 'ending');
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(constants.ss.gainPerOwnTurn);
    expect(slotOfSeat(state, 1)?.ssGauge).toBe(0);

    runUntilPhase(state, 'active');
    const shooter = mobileOfSeat(state, 1);
    const target = mobileOfSeat(state, 0);
    if (!shooter || !target) throw new Error('no mobiles');
    target.x = shooter.x - 120;
    applyIntent(state, { t: 'fire', seat: 1, shot: 's1', relAngle: 180, power: 0.35 });
    runUntilPhase(state, 'ending');
    expect(target.hp).toBeLessThan(armor.hp);
    // One own turn plus one hit taken.
    expect(slotOfSeat(state, 0)?.ssGauge).toBe(
      constants.ss.gainPerOwnTurn + constants.ss.gainPerHitTaken,
    );
  });

  it('ends the match when a team has no living mobiles', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const target = mobileOfSeat(state, 1);
    const shooter = mobileOfSeat(state, 0);
    if (!target || !shooter) throw new Error('no mobiles');
    target.x = shooter.x + 120;
    target.hp = 20;

    // Phase 5 gates the SS behind a full gauge (DESIGN §7 item 21); this test is about
    // the match ending, so it simply earns the gauge first.
    const shooterSlot = slotOfSeat(state, 0);
    if (shooterSlot) shooterSlot.ssGauge = constants.ss.gaugeMax;
    applyIntent(state, { t: 'fire', seat: 0, shot: 'ss', relAngle: 0, power: 0.35 });
    const events = runUntilPhase(state, 'ended');
    expect(state.phase).toBe('ended');
    expect(state.winnerTeam).toBe('A');
    expect(target.alive).toBe(false);
    const ended = events.find((e) => e.t === 'matchEnd');
    expect(ended?.t === 'matchEnd' && ended.winnerTeam).toBe('A');
    // A finished match is inert: no more turns, no more intents.
    const after = run(state, 200);
    expect(types(after)).not.toContain('turnStart');
    expect(state.turn).toBe(1);
  });

  it('reports the seconds left for the HUD', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    expect(secondsLeft(state)).toBe(20);
    run(state, 60);
    expect(secondsLeft(state)).toBe(19);
    applyIntent(state, { t: 'skip', seat: 0 });
    expect(secondsLeft(state)).toBe(0);
  });

  it('emits projectileExpire when a shot leaves the world', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    // Straight up the map edge at full power: it sails off the side and is never seen
    // again (PROGRESS.md Phase 1 listed this silence as rough).
    applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 0, power: 1 });
    const events = runUntilPhase(state, 'ending');
    const expired = events.find((e) => e.t === 'projectileExpire');
    if (!expired || expired.t !== 'projectileExpire') {
      // The shell hit the far wall of the arena instead; that is still a valid arena.
      expect(types(events)).toContain('explosion');
      return;
    }
    expect(expired.ownerSeat).toBe(0);
    expect(expired.reason).toBe('outOfWorld');
  });

  it('ends the turn on the tick the active mobile dies', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');

    // Take the ground out from under seat 0 and let it fall out of the world
    // (DESIGN §2.4). A dead mobile's intents are dropped, so nothing could skip for it.
    for (let y = 600; y < state.map.height + 200; y += 80) state.terrain.carve(m.x, y, 100);
    const events = runUntilPhase(state, 'ended', 600);
    expect(types(events)).toContain('death');
    expect(m.alive).toBe(false);
    // It ended because the corpse could not take its turn, not because 20 s elapsed.
    expect(state.tick).toBeLessThan(constants.turn.activeTicks);
    expect(state.winnerTeam).toBe('B');
    // A death costs no delay: a dead seat never takes another turn.
    expect(slotOfSeat(state, 0)?.delay).toBe(0);
  });

  it('stops the walk when the timer expires while a direction is held', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    applyIntent(state, { t: 'move', seat: 0, dir: 1 });
    run(state, constants.turn.activeTicks - 10);
    const walking = m.x;
    expect(walking).toBeGreaterThan(0);

    // The last ten ticks of the turn run out with Right still held.
    run(state, 10);
    expect(state.phase).toBe('resolving');
    const atExpiry = m.x;
    const gauge = m.moveGauge;
    // Nothing moves through `resolving` or `ending` (DESIGN §2.9: no input).
    runUntilPhase(state, 'active');
    expect(m.x).toBe(atExpiry);
    expect(m.moveGauge).toBe(gauge);
  });

  it('holds in ending rather than declaring a draw while nobody is connected', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'skip', seat: 0 });
    runUntilPhase(state, 'ending');

    // Both sockets blink out at the turn boundary (DESIGN §6.4 gives 60 s of grace).
    const a = slotOfSeat(state, 0);
    const b = slotOfSeat(state, 1);
    if (!a || !b) throw new Error('no slots');
    a.connected = false;
    b.connected = false;
    run(state, constants.turn.endingTicks * 3);
    expect(state.phase).toBe('ending');
    expect(state.winnerTeam).toBe(null);

    // They come back and the match carries on.
    a.connected = true;
    b.connected = true;
    runUntilPhase(state, 'active');
    expect(state.activeSeat).toBe(1);
  });

  it('clears a stuck queue when the resolving watchdog fires', () => {
    const state = turnMatch();
    runUntilPhase(state, 'active');
    // An effect that is never due: `isSettled` can never go true again.
    state.turnEffects.push({
      kind: 'test',
      atTick: Number.MAX_SAFE_INTEGER,
      ownerSeat: 0,
      data: {},
    });
    applyIntent(state, { t: 'skip', seat: 0 });
    runUntilPhase(state, 'ending', constants.turn.maxResolvingTicks + 10);
    expect(state.phase).toBe('ending');
    expect(state.turnEffects).toHaveLength(0);

    // And the next turn is not punished for it.
    runUntilPhase(state, 'active');
    applyIntent(state, { t: 'skip', seat: state.activeSeat });
    const before = state.tick;
    runUntilPhase(state, 'ending', constants.turn.maxResolvingTicks + 10);
    expect(state.tick - before).toBeLessThan(constants.turn.maxResolvingTicks);
  });

  it('leaves free play alone', () => {
    const free = createMatch(11, map, seats, { mode: 'freePlay' });
    expect(free.phase).toBe('active');
    run(free, 120);
    expect(free.turn).toBe(0);
    expect(free.completedTurns).toBe(0);
    // Both seats still act at will, which is what the sandbox needs.
    applyIntent(free, { t: 'aim', seat: 1, relAngle: 33 });
    expect(mobileOfSeat(free, 1)?.relAngle).toBe(33);
    applyIntent(free, { t: 'fire', seat: 1, shot: 's1', relAngle: 33, power: 0.4 });
    expect(free.projectiles).toHaveLength(1);
    expect(free.phase).toBe('active');
  });
});
