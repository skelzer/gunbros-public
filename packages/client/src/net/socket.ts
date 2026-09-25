/**
 * The socket (DESIGN §1.3 net/socket.ts, §6, §6.4).
 *
 * One WebSocket for the whole session: lobby, room and match all travel on it. The
 * wrapper owns three things the rest of the client should never have to think about.
 *
 * 1. **`hello` is always first.** Every (re)connection sends `{ t: 'hello', nick,
 *    token? }` before anything else, because the server closes a socket that says
 *    anything else first. The token comes from the previous `welcome` and is what
 *    rebinds this browser to the same player, room and seat (DESIGN §6.4).
 * 2. **A queue.** Room and lobby messages sent while the socket is connecting are held
 *    and flushed in order once the handshake is out, so a scene never has to ask
 *    whether it is open. In-match intents are dropped instead: they go stale.
 * 3. **Reconnection with backoff.** A dropped socket is retried with an exponential,
 *    jittered delay until the page is closed or the server says this session was
 *    replaced (`error.code === 'replaced'`, close 4000), which means another tab took
 *    the token and reconnecting would fight it forever.
 *
 * `welcome` is consumed here — the token is stored and `playerId` recorded — *before*
 * the message is handed on, because the reconnect burst (`welcome`, `roomState`,
 * `matchStart`, `resync`) arrives back to back and `matchStart` is matched against
 * `playerId` to find our seat.
 */
import type { ClientMessage, ServerMessage } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';
import { clearToken, loadToken, setToken } from '../state/session.js';
import { resolveWsUrl } from './wsUrl.js';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketOptions {
  /** The nickname sent with every `hello`; read fresh so a rename takes effect. */
  nick(): string;
  onMessage(msg: ServerMessage): void;
  onStatus(status: SocketStatus, detail: string): void;
  /** Overridden by the tests and by a client hosted apart from its server. */
  url?: string;
  /** Sees every message a scene sends, queued or not (the shell watches room changes). */
  onSend?(msg: ClientMessage): void;
}

/**
 * In-match intents only mean something at the moment they are made. Held across a
 * reconnect they would replay after the server has moved on — and it resets the fire
 * and move sequence numbers for a returning player, so a stale `fire` or a walk with no
 * stop could actually go through. The resync that follows puts the scene right instead.
 */
const DROPPED_WHILE_OFFLINE: ReadonlySet<ClientMessage['t']> = new Set<ClientMessage['t']>([
  'move',
  'aim',
  'selectShot',
  'useItem',
  'fire',
  'skip',
  'charging',
  'requestTerrain',
  // A poll: the next one asks again, so an old answer is not worth queueing.
  'listRooms',
  'ping',
]);

/** WebSocket close code the server uses when another socket took over this token. */
const CLOSE_REPLACED = 4000;

export class GameSocket {
  playerId = '';

  private ws: WebSocket | null = null;
  private readonly queue: ClientMessage[] = [];
  private status: SocketStatus = 'closed';
  private attempt = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private stopped = false;
  private replaced = false;
  /** The nickname the last `hello` carried, so a rename can be noticed. */
  private sentNick = '';

  constructor(private readonly options: SocketOptions) {}

  get state(): SocketStatus {
    return this.status;
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Was this session taken over by another tab? Reconnecting is pointless after that. */
  get wasReplaced(): boolean {
    return this.replaced;
  }

  connect(): void {
    if (this.stopped || this.replaced) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const url = this.options.url ?? resolveWsUrl();
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', url);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', this.onOpen);
    ws.addEventListener('message', this.onMessage);
    ws.addEventListener('close', this.onClose);
    ws.addEventListener('error', this.onError);
  }

  /** Queue a message, or send it now if the handshake is already out. */
  send(msg: ClientMessage): void {
    this.options.onSend?.(msg);
    if (this.isOpen) {
      this.raw(msg);
      return;
    }
    if (!DROPPED_WHILE_OFFLINE.has(msg.t)) {
      // Full queue: the oldest goes, so the latest decision (say, leaving) survives.
      if (this.queue.length >= clientConstants.net.maxQueued) this.queue.shift();
      this.queue.push(msg);
    }
    this.connect();
  }

  /** Close for good: no reconnect, no queue. */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeEventListener('open', this.onOpen);
      ws.removeEventListener('message', this.onMessage);
      ws.removeEventListener('close', this.onClose);
      ws.removeEventListener('error', this.onError);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
    this.queue.length = 0;
    this.setStatus('closed', 'closed');
  }

  /**
   * Tell the server about a rename. `hello` is the only message that carries a
   * nickname, and the server treats a second one on a live socket as exactly that — a
   * rename — so this re-sends it (with the token, which keeps the same player) when the
   * name actually changed. Called from the lobby, before creating or joining, because
   * that is where a name is typed.
   */
  syncNick(): void {
    const nick = this.options.nick();
    if (nick === this.sentNick || !this.isOpen) return;
    this.sentNick = nick;
    const token = loadToken();
    this.raw(token ? { t: 'hello', nick, token } : { t: 'hello', nick });
  }

  /** Drop this identity (used by "leave and forget me"); the next hello mints a new one. */
  forgetIdentity(): void {
    clearToken();
    this.playerId = '';
  }

  // ------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------

  private raw(msg: ClientMessage): void {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {
      // The socket died between the check and the write; the close handler retries.
    }
  }

  private setStatus(status: SocketStatus, detail: string): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus(status, detail);
  }

  private onOpen = (): void => {
    this.attempt = 0;
    // Always first, on every connection: a socket that says anything else is closed.
    const token = loadToken();
    const nick = this.options.nick();
    this.sentNick = nick;
    const hello: ClientMessage = token ? { t: 'hello', nick, token } : { t: 'hello', nick };
    this.raw(hello);
    for (const msg of this.queue.splice(0)) this.raw(msg);
    this.setStatus('open', 'open');
    this.startPing();
  };

  private onMessage = (event: MessageEvent): void => {
    if (typeof event.data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;

    // Consumed before anything else sees it: the reconnect burst arrives back to back
    // and `matchStart` needs `playerId` to find our seat.
    if (msg.t === 'welcome') {
      this.playerId = msg.playerId;
      setToken(msg.token);
    } else if (msg.t === 'error' && msg.code === 'replaced') {
      this.replaced = true;
    }
    this.options.onMessage(msg);
  };

  private onClose = (event: CloseEvent): void => {
    this.clearPing();
    this.ws = null;
    if (event.code === CLOSE_REPLACED) this.replaced = true;
    if (this.stopped || this.replaced) {
      this.setStatus('closed', this.replaced ? 'replaced' : 'closed');
      return;
    }
    this.setStatus('reconnecting', `closed (${event.code})`);
    this.scheduleRetry();
  };

  private onError = (): void => {
    // `error` is always followed by `close`; the retry lives there.
  };

  private scheduleRetry(): void {
    if (this.stopped || this.replaced || this.retryTimer !== 0) return;
    const net = clientConstants.net;
    const exponent = Math.min(this.attempt, net.reconnectMaxExponent);
    const base = Math.min(net.reconnectBaseMs * Math.pow(net.reconnectFactor, exponent), net.reconnectMaxMs);
    // Jitter, so two tabs that dropped together do not come back in lockstep.
    const delay = base * (1 - net.reconnectJitter + Math.random() * net.reconnectJitter * 2);
    this.attempt++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      this.connect();
    }, Math.round(delay));
  }

  /** Application-level keep-alive; the server answers `pong` and nothing else. */
  private startPing(): void {
    this.clearPing();
    this.pingTimer = window.setInterval(() => {
      if (this.isOpen) this.raw({ t: 'ping' });
    }, clientConstants.net.pingIntervalMs);
  }

  private clearPing(): void {
    if (this.pingTimer !== 0) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = 0;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.retryTimer !== 0) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = 0;
    }
  }
}
