/**
 * The clock the match scene simulates against (DESIGN §7 item 45).
 *
 * The one property that matters: whatever the latency does, the cap must never be
 * *ahead* of the tick the authority has actually reached, because a local clock that
 * overtakes the server finds every later message naming a tick it has already passed —
 * a `move` applied one tick late, a `turnEnd` compared one tick apart, and a desync at
 * the end of a turn the engine otherwise replayed perfectly.
 */
import { describe, expect, it } from 'vitest';
import { constants } from '@gunbros/shared';
import { ServerClock } from '../src/net/clock.js';

const tickMs = constants.tickMs;

describe('ServerClock', () => {
  it('has nothing to say before the first message', () => {
    const clock = new ServerClock();
    expect(clock.ready).toBe(false);
    expect(clock.cap(1000)).toBeNull();
  });

  it('advances with real time once anchored', () => {
    const clock = new ServerClock({ slackTicks: 0, relaxMs: 500 });
    clock.note(100, 1000);
    expect(clock.cap(1000)).toBe(100);
    expect(clock.cap(1000 + 30 * tickMs)).toBe(130);
  });

  it('keeps the local clock behind the authority by the slack', () => {
    const clock = new ServerClock({ slackTicks: 2, relaxMs: 500 });
    clock.note(600, 10_000);
    // Right after the message the cap is the reported tick, never less.
    expect(clock.cap(10_000)).toBe(600);
    // A second later it is a second of ticks on, minus the slack.
    expect(clock.cap(10_000 + 60 * tickMs)).toBe(658);
  });

  it('never lets jitter put the estimate ahead of the authority', () => {
    // A server whose tick 0 happened at t = 0 on our clock, processing each tick
    // between 0 and 17 ms late, reaching us after a latency that wanders.
    const clock = new ServerClock({ slackTicks: 2, relaxMs: 500 });
    const latencies = [40, 5, 60, 3, 80, 2, 30, 1, 120, 4, 15, 2];
    const lateness = [0, 12, 3, 16, 1, 9, 17, 0, 5, 14, 2, 8];
    const maxLatenessMs = 17;

    let worst = -Infinity;
    for (let i = 0; i < latencies.length; i++) {
      const tick = 100 + i * 30;
      const sentAt = tick * tickMs + (lateness[i] ?? 0);
      const receivedAt = sentAt + (latencies[i] ?? 0);
      clock.note(tick, receivedAt);

      // At every instant from this message until the next one, the cap must be at or
      // behind a tick the server has certainly *processed* — not merely one whose
      // nominal moment has passed. A tick is processed up to `maxLatenessMs` after its
      // nominal time (the server's loop wakes on a timer), and that is exactly what the
      // slack pays for.
      const nextTick = 100 + (i + 1) * 30;
      for (let t = receivedAt; t < nextTick * tickMs; t += 4) {
        const cap = clock.cap(t) ?? 0;
        // A tick is known to have been processed either because enough time has
        // passed for the server's timer to have reached it, or because a message
        // already told us so.
        const certainlyProcessed = Math.max(
          Math.floor((t - maxLatenessMs) / tickMs),
          clock.authorityTick,
        );
        expect(cap, `cap at t=${t}`).toBeLessThanOrEqual(certainlyProcessed);
        worst = Math.max(worst, cap - certainlyProcessed);
      }
    }
    // And it is not uselessly far behind either: within a handful of ticks.
    expect(worst).toBeGreaterThan(-12);
  });

  it('still leaves the server room on a link with no latency at all', () => {
    // Two browsers and the server on one machine: every message arrives instantly and
    // punctually, so the origin estimate is the truth and there is nothing left to lag
    // behind — except the server's own scheduling, which processes a tick up to a
    // wake-up late. This is the localhost case that produced ~11 % desynced turns
    // before the slack existed.
    const clock = new ServerClock();
    const maxLatenessMs = 17;
    for (let tick = 60; tick <= 600; tick += 30) {
      clock.note(tick, tick * tickMs);
      for (let t = tick * tickMs; t < (tick + 30) * tickMs; t += 3) {
        const cap = clock.cap(t) ?? 0;
        const certainlyProcessed = Math.max(
          Math.floor((t - maxLatenessMs) / tickMs),
          clock.authorityTick,
        );
        expect(cap, `cap at t=${t}`).toBeLessThanOrEqual(certainlyProcessed);
      }
    }
  });

  it('gives up a stale origin rather than lagging for the rest of the match', () => {
    const clock = new ServerClock({ slackTicks: 0, relaxMs: 200 });
    // One message took two seconds: the origin it implies is 2 s later than the truth.
    clock.note(60, 60 * tickMs + 2000);
    expect(clock.cap(60 * tickMs + 2000)).toBe(60);

    // The next messages are prompt again. The origin relaxes towards them instead of
    // holding two seconds of lag until the match ends.
    for (let i = 1; i <= 20; i++) clock.note(60 + i * 30, (60 + i * 30) * tickMs + 5);
    const now = 700 * tickMs;
    const cap = clock.cap(now) ?? 0;
    expect(cap).toBeLessThanOrEqual(700);
    expect(cap).toBeGreaterThan(700 - 20);
  });

  it('never returns a tick below the last one the authority reported', () => {
    const clock = new ServerClock({ slackTicks: 30, relaxMs: 500 });
    clock.note(500, 500 * tickMs);
    // The slack is larger than the time elapsed, but tick 500 certainly happened.
    expect(clock.cap(500 * tickMs)).toBe(500);
    expect(clock.authorityTick).toBe(500);
  });

  it('ignores a message that names an older tick', () => {
    const clock = new ServerClock({ slackTicks: 0, relaxMs: 500 });
    clock.note(300, 300 * tickMs);
    clock.note(120, 300 * tickMs + 5);
    expect(clock.authorityTick).toBe(300);
  });
});
