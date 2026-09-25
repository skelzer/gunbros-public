/**
 * One WebSocket, wrapped so nothing else in the server ever touches `ws` directly.
 *
 * It owns exactly three things: JSON encoding, the keepalive flag, and the link back to
 * the {@link Player} the socket has authenticated as. Everything else — rooms, matches,
 * validation — lives further in.
 */
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@gunbros/shared';
import type { Player } from './player.js';
import { config } from './config.js';
import { log } from './log.js';

let nextConnectionId = 1;

export class Connection {
  readonly id: number;
  readonly socket: WebSocket;
  /** The player this socket said `hello` as; null until then. */
  player: Player | null = null;
  /** Cleared when a keepalive goes out, set by any frame the client sends back. */
  alive = true;
  readonly openedAt = Date.now();

  /** Token bucket for the message rate limit; starts full. */
  private tokens = config.messageBurst;
  private tokensAt = Date.now();

  /** Client address (see `clientAddress`), the key for the per-address limits. */
  readonly address: string;

  constructor(socket: WebSocket, address = 'unknown') {
    this.id = nextConnectionId++;
    this.socket = socket;
    this.address = address;
  }

  /**
   * One message's worth of budget, or `false` when this socket is shouting.
   *
   * The protocol is throttled where it matters (aim, charge, chat, terrain requests),
   * but most messages are only bounded by how fast a client can send them, and every
   * one of `setReady`, `setTeam` and `selectShot` costs a broadcast to the whole room.
   * A bucket of `messageBurst` refilling at `messagesPerSecond` is invisible to the
   * real client (which peaks at a few dozen messages a second while walking) and caps
   * what one crafted socket can make the server do.
   */
  takeMessageToken(now: number = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.tokensAt);
    this.tokensAt = now;
    this.tokens = Math.min(
      config.messageBurst,
      this.tokens + (elapsed * config.messagesPerSecond) / 1000,
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  get open(): boolean {
    // 1 === WebSocket.OPEN; the numeric constant avoids importing the class at runtime.
    return this.socket.readyState === 1;
  }

  send(msg: ServerMessage): void {
    if (!this.open) return;
    if (this.socket.bufferedAmount > config.maxBufferedBytes) {
      // Not reading what we send: drop it rather than hold its backlog in memory. The
      // close handler treats this like any other disconnect (reconnect grace applies).
      log.warn('send buffer over limit, dropping socket', this.id, this.socket.bufferedAmount);
      this.socket.terminate();
      return;
    }
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      log.warn('send failed', this.id, err);
    }
  }

  sendError(code: string, message: string): void {
    this.send({ t: 'error', code, message });
  }

  close(code = 1000, reason = ''): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // Already gone; nothing to do.
    }
  }
}
