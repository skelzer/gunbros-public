/**
 * The room registry and the one place a client message turns into an action
 * (DESIGN §1.4, §6).
 *
 * Every handler here assumes the message has already been through
 * `protocol.parseClientMessage`, so the shapes and ranges are known good. What is left
 * to check is *context*: has this socket said hello, is the player in a room, is it
 * their turn, are they the host. None of that can be validated by a parser, and all of
 * it is validated here.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { bots } from '@gunbros/shared';
import type { ClientMessage, OpenRoomInfo, PlayerId, RoomCode } from '@gunbros/shared';
import { KeyedBucket } from './limits.js';
import { config } from './config.js';
import type { Connection } from './connection.js';
import { log } from './log.js';
import { metrics } from './metrics.js';
import { Room } from './room.js';
import { NO_SEAT, createPlayer, isConnected } from './player.js';
import type { Player } from './player.js';
import { sanitiseNick } from './protocol.js';

/**
 * Room-code alphabet: digits and capitals minus `0`, `O`, `1` and `I`, which are the
 * four characters someone reads out over the phone and gets wrong (DESIGN §6.1).
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateRoomCode(length: number = config.roomCodeLength): RoomCode {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

export class RoomManager {
  readonly rooms = new Map<RoomCode, Room>();
  private readonly playersByToken = new Map<string, Player>();
  private readonly playersById = new Map<PlayerId, Player>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  /** Per-address limits (see limits.ts): creating rooms, and guessing codes. */
  private readonly roomCreates = new KeyedBucket(config.roomCreatesPerMinute, config.roomCreateBurst);
  private readonly failedJoins = new KeyedBucket(config.failedJoinsPerMinute, config.failedJoinBurst);

  start(): void {
    if (this.sweeper) return;
    // Wrapped: the sweeper forfeits seats and closes rooms, and a throw inside a timer
    // callback is an uncaught exception that would take the whole process down.
    this.sweeper = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        log.error('sweep threw', err);
      }
    }, config.sweepIntervalMs);
    // Never hold the process open for a housekeeping timer.
    this.sweeper.unref?.();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.playersByToken.clear();
    this.playersById.clear();
  }

  get playerCount(): number {
    return this.playersById.size;
  }

  // ------------------------------------------------------------------------
  // Dispatch
  // ------------------------------------------------------------------------

  handle(conn: Connection, msg: ClientMessage): void {
    if (msg.t === 'ping') {
      conn.send({ t: 'pong' });
      return;
    }
    if (msg.t === 'hello') {
      this.hello(conn, msg.nick, msg.token);
      return;
    }
    const player = conn.player;
    if (!player) {
      conn.sendError('noHello', 'send hello before anything else');
      return;
    }

    switch (msg.t) {
      case 'createRoom':
        this.createRoom(player, msg.mapId, msg.maxPlayers, msg.listed === true, msg.practice === true);
        return;
      case 'listRooms':
        conn.send({ t: 'roomList', rooms: this.openRooms() });
        return;
      case 'joinRoom':
        this.joinRoom(player, msg.code);
        return;
      case 'leaveRoom':
        this.leaveRoom(player);
        return;
      default:
        break;
    }

    const room = player.room;
    if (!room) {
      conn.sendError('notInRoom', 'join a room first');
      return;
    }

    switch (msg.t) {
      case 'setTeam':
        reply(conn, room.setTeam(player, msg.team));
        return;
      case 'setMobile':
        reply(conn, room.setMobile(player, msg.mobileId));
        return;
      case 'setItems':
        reply(conn, room.setItems(player, msg.items));
        return;
      case 'setMap':
        reply(conn, room.setMap(player, msg.mapId));
        return;
      case 'setReady':
        reply(conn, room.setReady(player, msg.ready));
        return;
      case 'start':
        reply(conn, room.start(player));
        return;
      case 'addBot':
        reply(conn, room.addBot(player, msg.team, msg.difficulty));
        return;
      case 'setBot':
        reply(
          conn,
          room.setBot(player, msg.playerId, {
            team: msg.team,
            mobileId: msg.mobileId,
            difficulty: msg.difficulty,
          }),
        );
        return;
      case 'removeBot':
        reply(conn, room.removeBot(player, msg.playerId));
        return;
      case 'chat':
        reply(conn, room.chat(player, msg.text));
        return;
      default:
        break;
    }

    const runner = room.runner;
    if (!runner || player.seat === NO_SEAT) {
      conn.sendError('notInMatch', 'no match is running');
      return;
    }

    // Guarded: a throw half way through an intent leaves the authority's state changed
    // with nothing broadcast, so every client is silently out of step from then on. The
    // runner ends such a match as abandoned, the same as a throw in its own loop.
    runner.guard(msg.t, () => {
      switch (msg.t) {
        case 'move':
          runner.onMove(player, msg);
          return;
        case 'aim':
          runner.onAim(player, msg.relAngle);
          return;
        case 'selectShot':
          runner.onSelectShot(player, msg.shot);
          return;
        case 'charging':
          runner.onCharging(player, msg.power);
          return;
        case 'fire':
          runner.onFire(player, msg);
          return;
        case 'skip':
          runner.onSkip(player);
          return;
        case 'requestTerrain':
          runner.onRequestTerrain(player);
          return;
        case 'useItem':
          runner.onUseItem(player, msg);
          return;
        default:
          // Unreachable: every ClientMessage is handled above, and TypeScript narrows
          // `msg` to `never` here. Kept so a message added later fails loudly.
          conn.sendError('unhandled', 'nothing handles that message here');
      }
    });
  }

  // ------------------------------------------------------------------------
  // Identity
  // ------------------------------------------------------------------------

  /**
   * `hello` is the only message a socket may send before it has a player. With a token
   * it rebinds to the existing player — same id, same seat, same room (DESIGN §6.4);
   * without one it mints a fresh identity and hands back the token to store.
   */
  private hello(conn: Connection, nick: string, token?: string): void {
    const existing = token ? this.playersByToken.get(token) : undefined;
    if (existing) {
      if (existing.conn === conn && conn.player === existing) {
        // Our own token on our own socket: that is a rename, not a reconnect (DESIGN §7
        // item 49 — the lobby re-sends `hello` when the name changed). Taking the
        // reconnect branch here would re-send `matchStart` and a `resync` to a client
        // that never went anywhere, and remount a live match scene.
        existing.nick = sanitiseNick(nick);
        conn.send({ t: 'welcome', playerId: existing.id, token: existing.token });
        existing.room?.broadcastRoomState();
        return;
      }
      // A different identity on this socket: let the one we are leaving go through the
      // ordinary disconnect path, or it would keep a seat, a room and a `conn` pointing
      // at a socket that now belongs to somebody else — a player and a room that no
      // sweep can ever reap.
      this.detach(conn);
      const previous = existing.conn;
      if (previous && previous !== conn) {
        // Same token on a second socket: the newest wins, the old one is told why.
        previous.player = null;
        previous.sendError('replaced', 'this session was opened somewhere else');
        previous.close(4000, 'replaced');
      }
      existing.nick = sanitiseNick(nick);
      existing.conn = conn;
      existing.disconnectedAt = 0;
      conn.player = existing;
      conn.send({ t: 'welcome', playerId: existing.id, token: existing.token });
      if (existing.room) existing.room.onReconnect(existing);
      log.info(`player ${existing.nick} (${existing.id}) reconnected`);
      return;
    }

    if (conn.player) {
      // A second `hello` without a token on a socket that already has a player: treat
      // it as a rename rather than leaking a second identity.
      conn.player.nick = sanitiseNick(nick);
      conn.send({ t: 'welcome', playerId: conn.player.id, token: conn.player.token });
      conn.player.room?.broadcastRoomState();
      return;
    }

    const player = createPlayer(newPlayerId(), newToken(), sanitiseNick(nick));
    player.conn = conn;
    conn.player = player;
    this.playersByToken.set(player.token, player);
    this.playersById.set(player.id, player);
    metrics.sessionStarted();
    conn.send({ t: 'welcome', playerId: player.id, token: player.token });
    log.info(`player ${player.nick} (${player.id}) said hello`);
  }

  // ------------------------------------------------------------------------
  // Rooms
  // ------------------------------------------------------------------------

  /**
   * `practice` is the lobby's "Practice vs bot" (DESIGN §7 item 192): the same room,
   * unlisted whatever `listed` said, with the creator on team A and a Normal bot on B.
   */
  private createRoom(
    player: Player,
    mapId?: string,
    maxPlayers?: number,
    listed = false,
    practice = false,
  ): void {
    const address = player.conn?.address ?? 'unknown';
    if (!this.roomCreates.take(address)) {
      player.conn?.sendError('rateLimited', 'too many rooms created; wait a minute');
      return;
    }
    if (this.rooms.size >= config.maxRooms) {
      player.conn?.sendError('serverFull', 'too many rooms are open');
      return;
    }
    if (player.room) this.leaveRoom(player);

    let code = generateRoomCode();
    for (let i = 0; i < 20 && this.rooms.has(code); i++) code = generateRoomCode();
    if (this.rooms.has(code)) {
      player.conn?.sendError('serverFull', 'could not allocate a room code');
      return;
    }

    const room = new Room(code, maxPlayers ?? config.maxPlayersPerRoom);
    if (mapId) room.mapId = mapId;
    room.listed = listed && !practice;
    this.rooms.set(code, room);
    const err = room.add(player);
    if (err) {
      this.rooms.delete(code);
      player.conn?.sendError(err, `could not create the room (${err})`);
      return;
    }
    if (practice) {
      player.team = 'A';
      room.seatBot('B', bots.defaultDifficulty);
    }
    log.info(
      `room ${code}: created by ${player.nick}${room.listed ? ' (listed)' : ''}${practice ? ' (practice)' : ''}`,
    );
  }

  /**
   * The lobby's open-rooms list: listed rooms still in their lobby, with a free seat
   * and somebody connected to play with — a human: `connectedCount` leaves the bots out,
   * while `players.length` counts them as taken seats (DESIGN §7 item 191). Fullest
   * first, so a newcomer fills the room
   * that is closest to starting; then oldest first, the one that has waited longest.
   */
  openRooms(): OpenRoomInfo[] {
    const open: Room[] = [];
    for (const room of this.rooms.values()) {
      if (!room.listed || room.phase !== 'lobby') continue;
      if (room.players.length >= room.maxPlayers || room.connectedCount === 0) continue;
      open.push(room);
    }
    open.sort((a, b) => b.players.length - a.players.length || a.createdAt - b.createdAt);
    return open.slice(0, config.roomListMax).map((room) => ({
      code: room.code,
      host: room.players.find((p) => p.id === room.hostId)?.nick ?? '',
      mapId: room.mapId,
      players: room.players.length,
      maxPlayers: room.maxPlayers,
    }));
  }

  private joinRoom(player: Player, code: RoomCode): void {
    // Checked before the lookup, so an address that has been guessing learns nothing
    // more, not even whether this code happens to exist.
    const address = player.conn?.address ?? 'unknown';
    if (!this.failedJoins.has(address)) {
      player.conn?.sendError('rateLimited', 'too many wrong room codes; wait a minute');
      return;
    }
    const room = this.rooms.get(code);
    if (!room) {
      this.failedJoins.take(address);
      player.conn?.sendError('noSuchRoom', `no room with code ${code}`);
      return;
    }
    if (player.room === room) {
      player.conn?.send(room.roomState());
      return;
    }
    if (player.room) this.leaveRoom(player);
    const err = room.add(player);
    if (err) {
      player.conn?.sendError(err, `could not join room ${code} (${err})`);
      return;
    }
    log.info(`room ${code}: ${player.nick} joined`);
  }

  private leaveRoom(player: Player): void {
    const room = player.room;
    if (!room) return;
    if (room.phase === 'match' && room.runner && player.seat !== NO_SEAT) {
      // Leaving a match on purpose is an immediate forfeit: there is no grace period
      // for a player who closed the door behind them (DESIGN §6.4).
      const runner = room.runner;
      const seat = player.seat;
      runner.guard('forfeit', () => runner.forfeit(seat));
    }
    room.remove(player);
    if (room.players.length === 0) this.reap(room);
  }

  /** The socket died. The player keeps their seat until the grace period expires. */
  onSocketClose(conn: Connection): void {
    this.detach(conn);
  }

  /**
   * Unbind whatever player this socket holds, exactly as a close would: the player is
   * left disconnected (and so visible to the sweeper's grace period), the socket is left
   * with no player. Used by the close handler and by a `hello` that hands this socket a
   * different identity.
   */
  private detach(conn: Connection): void {
    const player = conn.player;
    conn.player = null;
    if (!player || player.conn !== conn) return;
    player.conn = null;
    player.disconnectedAt = Date.now();
    if (player.room) {
      player.room.onDisconnect(player);
      log.info(`player ${player.nick} dropped; seat held for ${config.reconnectGraceMs} ms`);
    } else {
      this.forget(player);
    }
  }

  private forget(player: Player): void {
    this.playersByToken.delete(player.token);
    this.playersById.delete(player.id);
  }

  private reap(room: Room): void {
    room.dispose();
    this.rooms.delete(room.code);
    log.info(`room ${room.code}: closed`);
  }

  /** Grace periods and room TTLs (DESIGN §6.4). Runs every `sweepIntervalMs`. */
  sweep(now: number = Date.now()): void {
    this.roomCreates.sweep(now);
    this.failedJoins.sweep(now);
    for (const room of [...this.rooms.values()]) {
      const { expired, reapable } = room.sweep(now);
      for (const player of expired) this.forget(player);
      if (reapable) this.reap(room);
    }
    for (const player of [...this.playersById.values()]) {
      if (isConnected(player) || player.room) continue;
      if (player.disconnectedAt === 0) continue;
      if (now - player.disconnectedAt > config.reconnectGraceMs) this.forget(player);
    }
  }

  /** Everybody the server knows: connected, or holding a seat through a grace period. */
  players(): Player[] {
    return [...this.playersById.values()];
  }

  stats(): { rooms: number; players: number; matches: number } {
    let matches = 0;
    for (const room of this.rooms.values()) if (room.runner) matches++;
    return { rooms: this.rooms.size, players: this.playersById.size, matches };
  }
}

function reply(conn: Connection, err: string | null): void {
  if (err) conn.sendError(err, humanise(err));
}

function humanise(code: string): string {
  switch (code) {
    case 'notInLobby':
      return 'the room is not in the lobby';
    case 'notHost':
      return 'only the host can do that';
    case 'needMorePlayers':
      return `a match needs at least ${config.minPlayersToStart} players`;
    case 'needBothTeams':
      return 'both teams need at least one player';
    case 'notEveryoneReady':
      return 'everyone has to be ready';
    case 'playerDisconnected':
      return 'somebody is disconnected';
    case 'roomFull':
      return 'the room is full';
    case 'roomInMatch':
      return 'that room is already playing';
    case 'noSuchBot':
      return 'there is no such bot in this room';
    case 'startFailed':
      return 'the match could not start; try again';
    case 'chatRateLimited':
      return 'slow down';
    default:
      return code;
  }
}

function newToken(): string {
  return randomBytes(24).toString('hex');
}

function newPlayerId(): PlayerId {
  return randomBytes(6).toString('hex');
}
