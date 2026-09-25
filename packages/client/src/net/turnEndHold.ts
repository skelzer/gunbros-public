/**
 * Hold a `turnEnd` until the local simulation has played up to it (DESIGN §7 item 170).
 *
 * The authority sends `turnEnd` the tick the shot settles, and every client runs a
 * network latency plus the clock slack behind it (§7 item 45). Applying the message on
 * arrival steps straight to its tick without rendering, so a client 400 ms behind
 * skipped the last 400 ms of every shot — the landing and the explosion — and on a
 * phone over a real network that was most of what there was to see.
 *
 * So the message is held, and the local clock is capped at its tick: the shot plays
 * out in real time, and the reconciliation runs when the engine gets there, at the same
 * tick it always did. Anything that arrives behind a held `turnEnd` waits behind it, so
 * the order the authority sent is the order it is applied in — the `matchEnd` of a
 * killing shot does not raise the end plate over a shell that is still in the air.
 *
 * A client too far behind to be worth waiting for (a tab that was in the background)
 * is let go at once and reconciles from the snapshot as before.
 *
 * Pure: the caller passes the ticks, and applies what comes back.
 */
import type { ServerMessage } from '@gunbros/shared';

/** Messages that never wait: they carry no simulation and their order does not matter. */
const PASS_THROUGH: ReadonlySet<ServerMessage['t']> = new Set<ServerMessage['t']>([
  'chat',
  'pong',
  'welcome',
  'error',
  'playerLeft',
  'playerReconnected',
]);

export class TurnEndHold {
  private queue: ServerMessage[] = [];

  constructor(private readonly maxHoldTicks: number) {}

  /** The tick the held `turnEnd` names, or null when nothing is held. */
  get heldTick(): number | null {
    const first = this.queue[0];
    return first?.t === 'turnEnd' ? first.snapshot.tick : null;
  }

  /**
   * Offer an arriving message. `true` means it is now held and must not be applied;
   * `false` means apply it now, as usual.
   */
  offer(msg: ServerMessage, localTick: number): boolean {
    if (PASS_THROUGH.has(msg.t)) return false;
    if (msg.t === 'resync') {
      // A resync replaces the whole state, the held shot included.
      this.queue = [];
      return false;
    }
    if (this.queue.length > 0) {
      this.queue.push(msg);
      return true;
    }
    if (msg.t !== 'turnEnd') return false;
    const ahead = msg.snapshot.tick - localTick;
    if (ahead <= 0 || ahead > this.maxHoldTicks) return false;
    this.queue.push(msg);
    return true;
  }

  /**
   * What to apply now, in arrival order: everything once the local engine has reached
   * the held tick, or once it has fallen more than `maxHoldTicks` behind `authorityTick`
   * (the authority's clock as the caller estimates it). Empty otherwise.
   */
  release(localTick: number, authorityTick: number): ServerMessage[] {
    const held = this.heldTick;
    if (held === null) return [];
    if (localTick < held && authorityTick - localTick <= this.maxHoldTicks) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }
}
