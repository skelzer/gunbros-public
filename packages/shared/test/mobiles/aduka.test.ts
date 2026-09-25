/**
 * Herald (`aduka`) — the `thorCall` behaviour and `rules/sky.ts` (DESIGN §3, §5, §10).
 *
 * What is actually asserted here: the shell marks where it lands, a beam comes down out
 * of the sky onto that mark and does more damage than the shell could, the beam scales
 * with the Thor level, and the SS walks three of them across the mark.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import type { BehaviourContext } from '../../src/entities/behaviours/index.js';
import { thorStrike, thorLevel } from '../../src/rules/sky.js';
import { sky } from '../../src/data/sky.js';
import { aduka } from '../../src/data/mobiles/aduka.js';
import type { SimEvent } from '../../src/match/events.js';
import { createDuel, eventsOfType, hpOf, MAX_RESOLVE_TICKS } from './helpers.js';

const HIT_ANGLE = 45;
const HIT_POWER = 0.54;

/** Fire and resolve, keeping the tick each event arrived on. */
function timeline(
  seed: number,
  shot: 's1' | 's2' | 'ss',
): { events: SimEvent[]; tickOf: Map<SimEvent, number>; state: ReturnType<typeof createDuel> } {
  const state = createDuel('aduka', 'armor', seed);
  const events: SimEvent[] = [];
  const tickOf = new Map<SimEvent, number>();
  for (const e of applyIntent(state, {
    t: 'fire',
    seat: 0,
    shot,
    relAngle: HIT_ANGLE,
    power: HIT_POWER,
  })) {
    events.push(e);
    tickOf.set(e, 0);
  }
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    for (const e of step(state)) {
      events.push(e);
      tickOf.set(e, i + 1);
    }
    if (isSettled(state)) break;
  }
  return { events, tickOf, state };
}

describe('aduka — Thor Call (S2)', () => {
  it('marks where the shell lands and brings a beam down on it', () => {
    const { events, tickOf, state } = timeline(401, 's2');

    const marks = eventsOfType(events, 'mark');
    expect(marks).toHaveLength(1);
    const mark = marks[0];
    if (!mark) throw new Error('no mark');
    expect(mark.kind).toBe('thor');
    expect(mark.ticksUntil).toBe(aduka.shots.s2.projectile.params?.delayTicks);

    const beams = eventsOfType(events, 'beam');
    expect(beams).toHaveLength(1);
    const beam = beams[0];
    if (!beam) throw new Error('no beam');
    // A vertical column from the top of the map onto the mark.
    expect(beam.x1).toBe(beam.x2);
    expect(beam.x1).toBeCloseTo(mark.x, 6);
    expect(beam.y1).toBe(0);
    expect(beam.y2).toBeCloseTo(mark.y, 6);
    expect(beam.ownerSeat).toBe(0);
    expect(beam.width).toBeGreaterThan(0);

    // And it arrives the promised number of ticks after the mark.
    const markTick = tickOf.get(mark) ?? 0;
    const beamTick = tickOf.get(beam) ?? 0;
    expect(beamTick - markTick).toBe(mark.ticksUntil);
    expect(isSettled(state)).toBe(true);
  });

  it('does far more damage than its own shell could', () => {
    const { state } = timeline(402, 's2');
    const lost = 1100 - hpOf(state, 1);
    // The spotting round's entire payload, before any falloff.
    expect(lost).toBeGreaterThan(aduka.shots.s2.projectile.damage * 1.5);
  });

  it('leaves S1 a plain, weak, beamless shot', () => {
    const { events, state } = timeline(403, 's1');
    expect(eventsOfType(events, 'beam')).toHaveLength(0);
    expect(eventsOfType(events, 'mark')).toHaveLength(0);
    const lost = 1100 - hpOf(state, 1);
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(aduka.shots.s1.projectile.damage * 1.2);
  });
});

describe('aduka — Thor Barrage (SS)', () => {
  it('walks three beams across the mark, staggered', () => {
    const { events, tickOf, state } = timeline(404, 'ss');
    const params = aduka.shots.ss.projectile.params ?? {};
    const marks = eventsOfType(events, 'mark');
    expect(marks).toHaveLength(1);
    const mark = marks[0];
    if (!mark) throw new Error('no mark');

    const beams = eventsOfType(events, 'beam');
    expect(beams).toHaveLength(params.calls ?? 0);

    // Spaced by `stepPx`, centred on the mark.
    const xs = beams.map((b) => b.x1).sort((a, b) => a - b);
    expect((xs[0] ?? 0)).toBeCloseTo(mark.x - (params.stepPx ?? 0), 6);
    expect((xs[1] ?? 0)).toBeCloseTo(mark.x, 6);
    expect((xs[2] ?? 0)).toBeCloseTo(mark.x + (params.stepPx ?? 0), 6);

    // One after another, not all on the same tick.
    const ticks = beams.map((b) => tickOf.get(b) ?? 0);
    expect(ticks[1] ?? 0).toBe((ticks[0] ?? 0) + (params.staggerTicks ?? 0));
    expect(ticks[2] ?? 0).toBe((ticks[1] ?? 0) + (params.staggerTicks ?? 0));

    // The whole barrage lands inside the shooter's turn.
    expect(isSettled(state)).toBe(true);
    expect(state.turnEffects).toHaveLength(0);
    expect(hpOf(state, 1)).toBeLessThan(1100);
  });

  it('hits harder than the single call', () => {
    const single = timeline(405, 's2');
    const barrage = timeline(405, 'ss');
    expect(1100 - hpOf(barrage.state, 1)).toBeGreaterThan(1100 - hpOf(single.state, 1));
  });
});

describe('thorStrike', () => {
  /** A context that records nothing but the beams asked of it. */
  function recorder(): {
    ctx: BehaviourContext;
    calls: Array<{ x: number; y: number; fromY: number; width: number; damage: number }>;
  } {
    const calls: Array<{ x: number; y: number; fromY: number; width: number; damage: number }> = [];
    const ctx = {
      activeSeat: 0,
      beamStrike: (
        x: number,
        y: number,
        fromY: number,
        width: number,
        def: { damage: number },
      ) => {
        calls.push({ x, y, fromY, width, damage: def.damage });
      },
    } as unknown as BehaviourContext;
    return { ctx, calls };
  }

  it('scales linearly with the Thor level', () => {
    const one = recorder();
    thorStrike(one.ctx, 300, 500, { level: 1 });
    const three = recorder();
    thorStrike(three.ctx, 300, 500, { level: 3 });
    expect(one.calls[0]?.damage).toBe(sky.thor.baseDamage);
    expect(three.calls[0]?.damage).toBeCloseTo((one.calls[0]?.damage ?? 0) * 3, 6);
  });

  it('clamps the level and falls from the top of the map onto the point', () => {
    const { ctx, calls } = recorder();
    thorStrike(ctx, 300, 500, { level: 99 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.damage).toBeCloseTo(sky.thor.baseDamage * sky.thor.maxLevel, 6);
    expect(calls[0]?.x).toBe(300);
    expect(calls[0]?.y).toBe(500);
    expect(calls[0]?.fromY).toBe(0);
  });

  it('defaults to the match\'s Thor level, which is 1 until Phase 6', () => {
    const state = createDuel('aduka', 'armor', 406);
    expect(thorLevel(state)).toBe(1);
    const { ctx, calls } = recorder();
    thorStrike(ctx, 120, 400);
    expect(calls[0]?.damage).toBe(sky.thor.baseDamage * thorLevel(state));
  });
});
