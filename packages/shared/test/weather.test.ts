/**
 * Weather comes and goes (DESIGN §5): an event lasts `sky.weather.minTurns`..`maxTurns`
 * completed turns, the sky then clears, and a turn that ends under a clear sky may
 * bring a new one. A pinned sky never moves. All of it runs on every engine at the
 * same turn end off the match stream, so two engines stay in step.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, createMatch, step } from '../src/match/reducer.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import { applySnapshot, hashState, takeSnapshot } from '../src/match/snapshot.js';
import type { SimEvent } from '../src/match/events.js';
import type { SkyEventId } from '../src/data/sky.js';
import { sky } from '../src/data/sky.js';
import { advanceWeather, createSkyState, rollWeatherEvent } from '../src/rules/sky.js';
import { Prng } from '../src/math/prng.js';
import { flatTestMap } from './helpers.js';

const MAP = flatTestMap();

const SEATS: SeatSpec[] = [
  { playerId: 'p0', nick: 'P0', team: 'A', mobileId: 'armor' },
  { playerId: 'p1', nick: 'P1', team: 'B', mobileId: 'armor' },
];

function turnsMatch(skyEvent: SkyEventId, seed = 4242, skyStatic = false): MatchState {
  return createMatch(seed, MAP, SEATS, { mode: 'turns', skyEvent, skyStatic });
}

/** Skip `turns` turns through the real machine; every event the sim produced. */
function skipTurns(state: MatchState, turns: number): SimEvent[] {
  const events: SimEvent[] = [];
  const target = state.completedTurns + turns;
  let guard = 0;
  while (state.completedTurns < target && guard++ < 100_000) {
    for (const e of step(state)) events.push(e);
    if (state.phase === 'active') {
      for (const e of applyIntent(state, { t: 'skip', seat: state.activeSeat })) events.push(e);
    }
  }
  return events;
}

function skyChanges(events: SimEvent[]): Extract<SimEvent, { t: 'skyChange' }>[] {
  return events.filter((e): e is Extract<SimEvent, { t: 'skyChange' }> => e.t === 'skyChange');
}

describe('weather duration (DESIGN §5)', () => {
  it('gives an opening event a duration inside the range, and none to a clear sky', () => {
    for (const kind of ['thor', 'tornado', 'force'] as const) {
      for (let seed = 1; seed < 40; seed++) {
        const s = createSkyState(kind, seed, MAP, [], true);
        expect(s.turnsLeft).toBeGreaterThanOrEqual(sky.weather.minTurns);
        expect(s.turnsLeft).toBeLessThanOrEqual(sky.weather.maxTurns);
      }
    }
    expect(createSkyState('none', 7, MAP, [], true).turnsLeft).toBe(0);
    expect(turnsMatch('tornado').sky.turnsLeft).toBeGreaterThan(0);
  });

  it('places the tornado on the same column whether or not it lasts', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(createSkyState('tornado', seed, MAP, [], true).x).toBe(
        createSkyState('tornado', seed, MAP, [], false).x,
      );
    }
  });

  it('counts an event down one completed turn at a time and then clears the sky', () => {
    const state = turnsMatch('force');
    const lasts = state.sky.turnsLeft;
    const early = skipTurns(state, lasts - 1);
    expect(skyChanges(early)).toEqual([]);
    expect(state.sky.kind).toBe('force');
    expect(state.sky.turnsLeft).toBe(1);

    const last = skipTurns(state, 1);
    expect(skyChanges(last)).toEqual([
      { t: 'skyChange', kind: 'none', previous: 'force', turnsLeft: 0 },
    ]);
    expect(state.sky.kind).toBe('none');
    expect(state.sky.top).toBe(0);
  });

  it('brings new weather to a clear sky sooner or later, with a fresh duration', () => {
    const state = turnsMatch('none');
    const events = skipTurns(state, 60);
    const arrivals = skyChanges(events).filter((e) => e.kind !== 'none');
    expect(arrivals.length).toBeGreaterThan(0);
    for (const a of arrivals) {
      expect(a.previous).toBe('none');
      expect(a.turnsLeft).toBeGreaterThanOrEqual(sky.weather.minTurns);
      expect(a.turnsLeft).toBeLessThanOrEqual(sky.weather.maxTurns);
    }
    // Weather never arrives on top of weather: changes alternate arrive / clear.
    const changes = skyChanges(events);
    for (let i = 1; i < changes.length; i++) {
      expect((changes[i]?.kind === 'none') !== (changes[i - 1]?.kind === 'none')).toBe(true);
    }
  });

  it('keeps a pinned sky for the whole match', () => {
    const pinned = turnsMatch('tornado', 4242, true);
    expect(pinned.sky.turnsLeft).toBe(0);
    expect(skyChanges(skipTurns(pinned, 30))).toEqual([]);
    expect(pinned.sky.kind).toBe('tornado');

    const clear = turnsMatch('none', 4242, true);
    expect(skyChanges(skipTurns(clear, 30))).toEqual([]);
    expect(clear.sky.kind).toBe('none');
  });

  it('keeps an arriving tornado off every living mobile', () => {
    for (let seed = 1; seed < 200; seed++) {
      const state = turnsMatch('none', seed);
      state.sky = createSkyState('none', seed, MAP);
      state.rng = Prng.seed(seed);
      const events: SimEvent[] = [];
      advanceWeather(state, events);
      if (state.sky.kind !== 'tornado') continue;
      for (const m of state.mobiles) {
        expect(Math.abs(m.x - state.sky.x)).toBeGreaterThanOrEqual(
          sky.placement.tornadoSpawnClearancePx,
        );
      }
    }
  });

  it('only ever brings an event, never `none`', () => {
    const rng = Prng.seed(99);
    const seen = new Set<SkyEventId>();
    for (let i = 0; i < 3000; i++) seen.add(rollWeatherEvent(rng));
    expect([...seen].sort()).toEqual(['force', 'thor', 'tornado']);
  });
});

describe('weather is part of the state (DESIGN §2.1)', () => {
  it('two engines from the same start stay hash-identical through changing weather', () => {
    const a = turnsMatch('thor', 31337);
    const b = turnsMatch('thor', 31337);
    const eventsA = skipTurns(a, 40);
    const eventsB = skipTurns(b, 40);
    expect(skyChanges(eventsA).length).toBeGreaterThan(1);
    expect(skyChanges(eventsA)).toEqual(skyChanges(eventsB));
    expect(hashState(a)).toBe(hashState(b));
  });

  it('hashes and snapshots the turns left', () => {
    const authority = turnsMatch('force');
    const other = turnsMatch('force');
    other.sky.turnsLeft += 1;
    expect(hashState(other)).not.toBe(hashState(authority));

    const client = turnsMatch('none');
    applySnapshot(client, takeSnapshot(authority));
    expect(client.sky.kind).toBe('force');
    expect(client.sky.turnsLeft).toBe(authority.sky.turnsLeft);
  });
});
