/**
 * The authority's clock, estimated from the messages it sends (DESIGN §7 item 45).
 *
 * `state.turnStartTick` is part of the state hash, so a browser engine whose absolute
 * tick counter has drifted by even one mismatches at every `turnEnd` however perfectly
 * it reproduced the shot. The match scene therefore never free-runs: it asks this clock
 * how far it may simulate, and the answer is always at or behind the server.
 *
 * The estimate is kept as an *origin* — the moment the authority's tick 0 happened,
 * measured on this browser's `performance.now()` clock. Every message that carries a
 * tick gives one reading, `received − tick × tickMs`, and every reading is at or after
 * the truth, because latency and the server's own scheduling can only make a message
 * arrive later than the tick it names, never earlier. The largest reading is therefore
 * the honest one: keeping it means this engine lags by the worst latency seen rather
 * than sprinting ahead on the luckiest one and then finding every later message naming
 * a tick it has already passed.
 *
 * Two bounds keep that from being pessimistic: a reading more than `relaxMs` older than
 * the newest one is given up (one hiccup must not cost lag for the rest of the match),
 * and the cap never falls below the last tick the authority actually reported, which is
 * a tick that certainly happened.
 *
 * Pure: no DOM, no timers, the caller passes the clock reading. That is what makes it
 * testable against jitter without a browser.
 */
import { constants } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';

export interface ServerClockOptions {
  /** Ticks of margin between the estimate and the cap. */
  slackTicks?: number;
  /** How far the origin may be relaxed after one unusually slow message. */
  relaxMs?: number;
}

export class ServerClock {
  private origin = 0;
  private anchored = false;
  private lastTick = 0;
  private readonly slackTicks: number;
  private readonly relaxMs: number;

  constructor(options: ServerClockOptions = {}) {
    this.slackTicks = options.slackTicks ?? clientConstants.net.tickCapSlackTicks;
    this.relaxMs = options.relaxMs ?? clientConstants.net.tickOriginRelaxMs;
  }

  /** Has any authoritative message arrived yet? */
  get ready(): boolean {
    return this.anchored;
  }

  /** The highest tick the authority has reported. */
  get authorityTick(): number {
    return this.lastTick;
  }

  /** One authoritative message, with the moment it reached us. */
  note(tick: number, now: number): void {
    const implied = now - tick * constants.tickMs;
    if (tick > this.lastTick) this.lastTick = tick;
    if (!this.anchored) {
      this.origin = implied;
      this.anchored = true;
      return;
    }
    if (implied > this.origin) this.origin = implied;
    else if (this.origin - implied > this.relaxMs) this.origin = implied + this.relaxMs;
  }

  /**
   * The furthest tick the local simulation may reach, or null before the first message
   * (nothing to cap against yet).
   */
  cap(now: number): number | null {
    if (!this.anchored) return null;
    const estimate = Math.floor((now - this.origin) / constants.tickMs);
    return Math.max(estimate - this.slackTicks, this.lastTick);
  }
}
