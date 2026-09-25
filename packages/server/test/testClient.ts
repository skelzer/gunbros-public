/**
 * A headless client, written the way a real client has to be written.
 *
 * It is the executable half of the determinism contract: it runs the same
 * `@gunbros/shared` simulation, it never advances its own clock, and it steps to the
 * tick carried by each authoritative message before applying that message. A browser
 * client steps in real time instead and reconciles at `turnEnd`; this one is exactly
 * tick-aligned, which is what lets the test assert *equal hashes* rather than "the
 * reconciliation eventually converged".
 */
import WebSocket from 'ws';
import {
  applyIntent,
  applySnapshot,
  createMatch,
  decodeRle,
  getMapDef,
  makeWind,
  mobileOfSeat,
  snapshotForTurnEnd,
  step,
} from '@gunbros/shared';
import type {
  ClientMessage,
  MatchState,
  SeatSpec,
  ServerMessage,
  Snapshot,
} from '@gunbros/shared';

interface Waiter {
  predicate: (msg: ServerMessage) => boolean;
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface TurnEndReport {
  turn: number;
  /** The client's own hash at the same tick, and the authority's. */
  mine: number;
  theirs: number;
  matched: boolean;
}

export class TestClient {
  readonly nick: string;
  readonly ws: WebSocket;
  readonly received: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];

  playerId = '';
  token = '';
  roomCode = '';
  seat = -1;
  state: MatchState | null = null;
  readonly turnEnds: TurnEndReport[] = [];
  /** Authoritative messages applied to the local sim, in order, for assertions. */
  readonly applied: string[] = [];

  private constructor(nick: string, ws: WebSocket) {
    this.nick = nick;
    this.ws = ws;
    ws.on('message', (raw: Buffer) => this.onMessage(JSON.parse(raw.toString('utf8')) as ServerMessage));
  }

  /** `token` replays a previous session, which is the reconnect path (DESIGN §6.4). */
  static async connect(url: string, nick: string, token?: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const client = new TestClient(nick, ws);
    client.send(token ? { t: 'hello', nick, token } : { t: 'hello', nick });
    await client.wait((m) => m.t === 'welcome');
    return client;
  }

  /**
   * An engine with no socket: it applies whatever it is `feed`ed exactly as a connected
   * client applies what arrives. A test that runs a match without sockets (bots only,
   * fake timers) hands it the room's broadcasts to check the lockstep all the same.
   */
  static offline(nick: string): TestClient {
    const stub = { on: () => stub, send: () => {}, close: () => {} };
    return new TestClient(nick, stub as unknown as WebSocket);
  }

  /** Apply one server message as if it had just arrived (see {@link offline}). */
  feed(msg: ServerMessage): void {
    this.onMessage(JSON.parse(JSON.stringify(msg)) as ServerMessage);
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('client closed'));
    }
    this.ws.close();
  }

  /** Wait for the next message that matches, or one that already arrived. */
  wait(predicate: (msg: ServerMessage) => boolean, timeoutMs = 15000): Promise<ServerMessage> {
    for (let i = 0; i < this.received.length; i++) {
      const msg = this.received[i];
      if (msg && predicate(msg)) return Promise.resolve(msg);
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`${this.nick}: timed out waiting for a message`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  private onMessage(msg: ServerMessage): void {
    this.received.push(msg);
    this.applyToSim(msg);
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (!waiter || !waiter.predicate(msg)) continue;
      this.waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    }
  }

  /** Run the local simulation forward to `tick`. Never rewinds. */
  private stepTo(tick: number): void {
    const state = this.state;
    if (!state) return;
    let guard = 0;
    while (state.tick < tick && guard < 60 * 60 * 10) {
      step(state);
      guard++;
    }
  }

  private applyToSim(msg: ServerMessage): void {
    switch (msg.t) {
      // Handled here rather than by the caller that awaits it: a reconnect's
      // `welcome`, `roomState`, `matchStart` and `resync` all arrive in one burst and
      // are dispatched synchronously, so an id assigned in a `.then()` would be too
      // late for the `matchStart` that needs it. A real client has the same ordering
      // obligation.
      case 'welcome':
        this.playerId = msg.playerId;
        this.token = msg.token;
        return;
      case 'roomState':
        this.roomCode = msg.code;
        return;
      case 'matchStart': {
        const specs: SeatSpec[] = msg.players.map((p) => ({
          playerId: p.playerId,
          nick: p.nick,
          team: p.team,
          mobileId: p.mobileId,
          // The loadout travels with the seat (DESIGN §4): without it this engine would
          // build empty `PlayerSlot.items` and refuse the first `itemUsed` it is told
          // to apply, which is a desync one turn later.
          items: p.items,
        }));
        const state = createMatch(msg.seed, getMapDef(msg.mapId), specs, { mode: 'turns' });
        state.skyStatic = msg.skyStatic ?? false;
        state.skyEventId = msg.skyEvent;
        this.state = state;
        for (const p of msg.players) if (p.playerId === this.playerId) this.seat = p.seat;
        this.applied.push('matchStart');
        return;
      }
      case 'moveEcho': {
        this.stepTo(msg.tick);
        if (this.state) applyIntent(this.state, { t: 'move', seat: msg.seat, dir: msg.dir });
        return;
      }
      case 'aimEcho': {
        this.stepTo(msg.tick);
        if (this.state) applyIntent(this.state, { t: 'aim', seat: msg.seat, relAngle: msg.relAngle });
        return;
      }
      case 'shotEcho': {
        this.stepTo(msg.tick);
        if (this.state) applyIntent(this.state, { t: 'selectShot', seat: msg.seat, shot: msg.shot });
        return;
      }
      case 'chargingEcho': {
        this.stepTo(msg.tick);
        if (this.state) applyIntent(this.state, { t: 'charging', seat: msg.seat, power: msg.power });
        return;
      }
      case 'itemUsed': {
        // Applied exactly like `fire`, and always before it (DESIGN §6.2): the item's
        // own tick, then the same intent the authority applied.
        this.stepTo(msg.tick);
        if (this.state) {
          applyIntent(this.state, {
            t: 'useItem',
            seat: msg.seat,
            itemId: msg.itemId,
            target: msg.target,
          });
        }
        this.applied.push(`item:${msg.itemId}`);
        return;
      }
      case 'fire': {
        const state = this.state;
        if (!state) return;
        this.stepTo(msg.tick);
        // Everything needed to reproduce the shot is in this message (DESIGN §6.2).
        const m = mobileOfSeat(state, msg.seat);
        if (m) {
          m.x = msg.shooter.x;
          m.y = msg.shooter.y;
          m.facing = msg.shooter.facing;
          m.tilt = msg.shooter.tilt;
        }
        state.wind = makeWind(msg.wind.strength, msg.wind.directionDeg);
        state.rng.setState(msg.rngState);
        applyIntent(state, {
          t: 'fire',
          seat: msg.seat,
          shot: msg.shot,
          relAngle: msg.relAngle,
          power: msg.power,
        });
        this.applied.push('fire');
        return;
      }
      case 'skipEcho': {
        this.stepTo(msg.tick);
        if (this.state) applyIntent(this.state, { t: 'skip', seat: msg.seat });
        this.applied.push('skip');
        return;
      }
      case 'playerForfeit': {
        this.stepTo(msg.tick);
        if (this.state) applyIntent(this.state, { t: 'forfeit', seat: msg.seat });
        this.applied.push('forfeit');
        return;
      }
      case 'turnEnd': {
        const state = this.state;
        if (!state) return;
        this.stepTo(msg.snapshot.tick);
        // Both sides quantise at the same moment, then compare (DESIGN §6.3 step 5).
        const mine: Snapshot = snapshotForTurnEnd(state);
        const matched = mine.stateHash === msg.snapshot.stateHash;
        this.turnEnds.push({
          turn: msg.snapshot.turn,
          mine: mine.stateHash,
          theirs: msg.snapshot.stateHash,
          matched,
        });
        if (!matched) applySnapshot(state, msg.snapshot);
        return;
      }
      case 'resync': {
        const state = this.state;
        if (!state) return;
        state.terrain.replaceMask(decodeRle(msg.rle).mask);
        applySnapshot(state, msg.snapshot);
        this.applied.push('resync');
        return;
      }
      case 'terrainMask': {
        const state = this.state;
        if (!state) return;
        state.terrain.replaceMask(decodeRle(msg.rle).mask);
        return;
      }
      default:
        return;
    }
  }
}
