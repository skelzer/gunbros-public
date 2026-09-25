/**
 * A room: the lobby, the chat, and the match that grows out of them (DESIGN §1.4, §6.1).
 *
 * Rooms are in memory and live only as long as somebody is in them. Everything a client
 * can change here goes through one of the `set*` methods, each of which validates and
 * then broadcasts a fresh `roomState` — the protocol has no partial lobby updates, so
 * there is no way for two clients to hold different ideas of the room.
 */
import { randomInt } from 'node:crypto';
import { Prng, maps, validateLoadout } from '@gunbros/shared';
import type {
  BotDifficulty,
  ItemId,
  MapId,
  MobileId,
  PlayerId,
  PlayerInfo,
  RoomCode,
  RoomPhase,
  RoomStateMsg,
  ServerMessage,
  TeamId,
} from '@gunbros/shared';
import { createBot } from './bot.js';
import { config } from './config.js';
import { log } from './log.js';
import { MatchRunner } from './matchRunner.js';
import { NO_SEAT, isConnected, playerInfo } from './player.js';
import type { Player } from './player.js';

const defaultMapId: MapId = maps[0]?.id ?? 'hills';

export class Room {
  readonly code: RoomCode;
  readonly createdAt = Date.now();
  /** The room's own PRNG: random mobile picks, the sky roll. Never the match's stream. */
  readonly rng: Prng;

  hostId: PlayerId = '';
  mapId: MapId = defaultMapId;
  maxPlayers: number;
  phase: RoomPhase = 'lobby';
  /** Shown in the lobby's open-rooms list; an unlisted room is found by its code only. */
  listed = false;
  players: Player[] = [];
  runner: MatchRunner | null = null;
  /** `Date.now()` since when nobody has been connected, or 0 while somebody is. */
  emptySince: number = Date.now();

  constructor(code: RoomCode, maxPlayers: number) {
    this.code = code;
    this.maxPlayers = Math.max(
      config.minPlayersToStart,
      Math.min(maxPlayers, config.maxPlayersPerRoom),
    );
    this.rng = Prng.seed(randomInt(0, 0xffffffff));
  }

  // ------------------------------------------------------------------------
  // Membership
  // ------------------------------------------------------------------------

  /**
   * Humans with an open socket. Bots never count (DESIGN §7 item 191): they are always
   * "connected", so counting them would keep a room of bots alive for ever and list it
   * in the lobby as somebody to play with.
   */
  get connectedCount(): number {
    let n = 0;
    for (const player of this.players) if (!player.bot && isConnected(player)) n++;
    return n;
  }

  /** Humans in the room, connected or in their grace period. */
  get humanCount(): number {
    let n = 0;
    for (const player of this.players) if (!player.bot) n++;
    return n;
  }

  has(player: Player): boolean {
    return this.players.includes(player);
  }

  /** Add a player to the lobby. Returns an error code, or null on success. */
  add(player: Player): string | null {
    if (this.has(player)) return null;
    if (this.phase !== 'lobby') return 'roomInMatch';
    if (this.players.length >= this.maxPlayers) return 'roomFull';
    player.room = this;
    player.seat = NO_SEAT;
    player.ready = false;
    player.disconnectedAt = 0;
    player.team = this.thinnerTeam();
    this.players.push(player);
    if (this.hostId === '') this.hostId = player.id;
    this.emptySince = 0;
    // The composition changed under everybody's feet; nobody is ready to anything yet.
    this.clearReady();
    this.broadcastRoomState();
    return null;
  }

  /**
   * Remove a player for good (they left, or their grace expired). The host moves to the
   * next human still in the room — never to a bot (DESIGN §7 item 191). When the last
   * human goes, the bots go with them: a room belongs to its humans, and a match of bots
   * alone is stopped rather than played to nobody. An empty room is left for the manager
   * to reap.
   */
  remove(player: Player): void {
    const index = this.players.indexOf(player);
    if (index === -1) return;
    this.players.splice(index, 1);
    player.room = null;
    player.ready = false;
    player.seat = NO_SEAT;

    if (this.humanCount === 0 && this.players.length > 0) {
      log.info(`room ${this.code}: the last human left; ${this.players.length} bot(s) go too`);
      for (const bot of this.players) {
        bot.room = null;
        bot.seat = NO_SEAT;
      }
      this.players = [];
    }
    if (this.hostId === player.id) {
      const humans = this.players.filter((p) => !p.bot);
      const next = humans.find((p) => isConnected(p)) ?? humans[0];
      this.hostId = next ? next.id : '';
      if (next) log.info(`room ${this.code}: host is now ${next.nick}`);
    }
    if (this.players.length === 0) {
      this.runner?.stop();
      this.runner = null;
      this.emptySince = Date.now();
      return;
    }
    if (this.phase === 'lobby') this.clearReady();
    this.broadcastRoomState();
    this.touch();
  }

  /** Keep `emptySince` honest: it is the moment the last connected player left. */
  private touch(): void {
    if (this.connectedCount > 0) this.emptySince = 0;
    else if (this.emptySince === 0) this.emptySince = Date.now();
  }

  /** The team with fewer players; A wins ties, so a 1v1 room fills A then B (§7 item 13). */
  private thinnerTeam(): TeamId {
    let a = 0;
    let b = 0;
    for (const p of this.players) {
      if (p.team === 'A') a++;
      else b++;
    }
    return a <= b ? 'A' : 'B';
  }

  /** Everybody confirms again — except the bots, which are always ready (§7 item 186). */
  private clearReady(): void {
    for (const p of this.players) p.ready = p.bot !== null;
  }

  // ------------------------------------------------------------------------
  // Broadcasting
  // ------------------------------------------------------------------------

  broadcast(msg: ServerMessage, except?: Player): void {
    for (const player of this.players) {
      if (player === except) continue;
      player.conn?.send(msg);
    }
  }

  roomState(): RoomStateMsg {
    const players: PlayerInfo[] = [];
    for (const player of this.players) players.push(playerInfo(player, this.hostId));
    return {
      t: 'roomState',
      code: this.code,
      hostId: this.hostId,
      mapId: this.mapId,
      maxPlayers: this.maxPlayers,
      players,
      phase: this.phase,
    };
  }

  broadcastRoomState(): void {
    this.broadcast(this.roomState());
  }

  // ------------------------------------------------------------------------
  // Lobby settings (DESIGN §6.1)
  // ------------------------------------------------------------------------

  setTeam(player: Player, team: TeamId): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    player.team = team;
    player.ready = false;
    this.broadcastRoomState();
    return null;
  }

  setMobile(player: Player, mobileId: MobileId | 'random'): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    player.mobileId = mobileId;
    this.broadcastRoomState();
    return null;
  }

  /**
   * The six-slot loadout (DESIGN §4). The parser has already checked the ids and the
   * budget; `validateLoadout` is the simulation's own reading of the same list and is
   * applied here so that what the room stores is exactly what `createMatch` will honour
   * — the room state, `matchStart.players[].items` and `PlayerSlot.items` are then the
   * same list on every engine, and no client can be shown a slot the sim has dropped.
   */
  setItems(player: Player, items: ItemId[]): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    player.items = validateLoadout(items);
    this.broadcastRoomState();
    return null;
  }

  setMap(player: Player, mapId: MapId): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    if (player.id !== this.hostId) return 'notHost';
    this.mapId = mapId;
    // A different map is a different game: everyone confirms again.
    this.clearReady();
    this.broadcastRoomState();
    return null;
  }

  setReady(player: Player, ready: boolean): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    player.ready = ready;
    this.broadcastRoomState();
    return null;
  }

  // ------------------------------------------------------------------------
  // Practice bots (DESIGN §11, §7 items 186 and 191)
  // ------------------------------------------------------------------------

  /** The bot `playerId` in this room, or an error code for whoever asked about it. */
  private botFor(player: Player, playerId: string): Player | string {
    if (this.phase !== 'lobby') return 'notInLobby';
    if (player.id !== this.hostId) return 'notHost';
    const bot = this.players.find((p) => p.id === playerId);
    if (!bot || !bot.bot) return 'noSuchBot';
    return bot;
  }

  /**
   * Seat a bot, without the host checks: the host's `addBot` and `createRoom.practice`
   * both come through here. It takes a seat like a player does, so a full room refuses.
   */
  seatBot(team: TeamId, difficulty: BotDifficulty): Player | string {
    if (this.phase !== 'lobby') return 'notInLobby';
    if (this.players.length >= this.maxPlayers) return 'roomFull';
    const bot = createBot(team, difficulty, this.players.map((p) => p.nick));
    bot.room = this;
    this.players.push(bot);
    // Somebody new sat down: the humans confirm again, as they do for a human (`add`).
    this.clearReady();
    this.broadcastRoomState();
    log.info(`room ${this.code}: bot ${bot.nick} (${difficulty}) joined team ${team}`);
    return bot;
  }

  addBot(player: Player, team: TeamId, difficulty: BotDifficulty): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    if (player.id !== this.hostId) return 'notHost';
    const seated = this.seatBot(team, difficulty);
    return typeof seated === 'string' ? seated : null;
  }

  /** The host's picks for one bot: its team, its mobile, its difficulty. */
  setBot(
    player: Player,
    playerId: string,
    picks: { team?: TeamId; mobileId?: MobileId | 'random'; difficulty?: BotDifficulty },
  ): string | null {
    const bot = this.botFor(player, playerId);
    if (typeof bot === 'string') return bot;
    if (picks.team !== undefined && picks.team !== bot.team) {
      bot.team = picks.team;
      // A different table is a different game, as when a human changes team.
      this.clearReady();
    }
    if (picks.mobileId !== undefined) bot.mobileId = picks.mobileId;
    if (picks.difficulty !== undefined && bot.bot) bot.bot = { difficulty: picks.difficulty };
    this.broadcastRoomState();
    return null;
  }

  removeBot(player: Player, playerId: string): string | null {
    const bot = this.botFor(player, playerId);
    if (typeof bot === 'string') return bot;
    this.remove(bot);
    return null;
  }

  /**
   * Chat, in the room or in a match. Length is capped by the parser; the rate limit is
   * here because it is per player, not per message.
   */
  chat(player: Player, text: string): string | null {
    const now = Date.now();
    player.chatTimes = player.chatTimes.filter((t) => now - t < config.chatWindowMs);
    if (player.chatTimes.length >= config.chatBurst) return 'chatRateLimited';
    player.chatTimes.push(now);
    this.broadcast({ t: 'chat', from: player.nick, text, ts: now });
    return null;
  }

  // ------------------------------------------------------------------------
  // The match
  // ------------------------------------------------------------------------

  /** Host pressed start. Every condition from DESIGN §6.1, in order. */
  start(player: Player): string | null {
    if (this.phase !== 'lobby') return 'notInLobby';
    if (player.id !== this.hostId) return 'notHost';
    if (this.players.length < config.minPlayersToStart) return 'needMorePlayers';
    if (this.players.length > this.maxPlayers) return 'roomFull';
    let a = 0;
    let b = 0;
    for (const p of this.players) {
      if (!p.ready) return 'notEveryoneReady';
      if (!isConnected(p)) return 'playerDisconnected';
      if (p.team === 'A') a++;
      else b++;
    }
    if (a === 0 || b === 0) return 'needBothTeams';

    this.phase = 'match';
    for (const p of this.players) {
      p.lastMoveSeq = -1;
      p.lastFireSeq = -1;
    }
    this.broadcastRoomState();
    try {
      this.runner = MatchRunner.start(this, randomInt(0, 0xffffffff));
    } catch (err) {
      // Without this the room would sit in phase `match` with no runner: every lobby
      // action answers notInLobby and every intent notInMatch until everyone leaves.
      log.error(`room ${this.code}: match failed to start`, err);
      this.onMatchEnded();
      return 'startFailed';
    }
    return null;
  }

  /** The match is over: keep everybody, drop the seats, wait for the host again. */
  onMatchEnded(): void {
    this.runner = null;
    this.phase = 'lobby';
    for (const p of this.players) {
      p.seat = NO_SEAT;
      p.ready = p.bot !== null;
    }
    this.broadcastRoomState();
    log.info(`room ${this.code}: back to the lobby`);
  }

  // ------------------------------------------------------------------------
  // Connection changes (DESIGN §6.4)
  // ------------------------------------------------------------------------

  /**
   * The socket dropped. Nothing is taken away yet: the seat, the slot and the lobby
   * picks are all held for `reconnectGraceMs` (DESIGN §6.4), and above all the *match
   * state* is not touched — every engine is simulating it in lockstep and none of them
   * can see a socket. The sweeper does the taking away if nobody comes back.
   */
  onDisconnect(player: Player): void {
    player.disconnectedAt = Date.now();
    if (this.phase === 'match' && player.seat !== NO_SEAT) {
      this.broadcast({ t: 'playerLeft', seat: player.seat }, player);
    }
    this.broadcastRoomState();
    this.touch();
  }

  onReconnect(player: Player): void {
    player.disconnectedAt = 0;
    // The replay guards belong to the socket that is gone. A reload rebuilds the match
    // scene, so the returning client's `move`/`fire` counters restart at 0 — and every
    // one of them would be dropped as a stale retransmit until they overtook what the
    // old socket had reached, which is one dead turn per shot the player had fired.
    // Nothing can replay across a reconnect (the old socket is closed), so the guards
    // start again with the new one (DESIGN §6.4).
    player.lastMoveSeq = -1;
    player.lastFireSeq = -1;
    this.touch();
    player.conn?.send(this.roomState());
    if (this.phase === 'match' && this.runner && player.seat !== NO_SEAT) {
      this.runner.sendMatchStart(player);
      this.runner.sendResync(player);
      this.broadcast({ t: 'playerReconnected', seat: player.seat }, player);
    }
    this.broadcastRoomState();
  }

  /**
   * Called by the sweeper. A player whose grace has expired forfeits and leaves; a room
   * that nobody has been connected to for `roomTtlMs` is reported as reapable.
   */
  sweep(now: number): { expired: Player[]; reapable: boolean } {
    const expired: Player[] = [];
    for (const player of this.players.slice()) {
      if (isConnected(player) || player.disconnectedAt === 0) continue;
      if (now - player.disconnectedAt < config.reconnectGraceMs) continue;
      expired.push(player);
    }
    for (const player of expired) {
      const runner = this.runner;
      const seat = player.seat;
      if (this.phase === 'match' && runner && seat !== NO_SEAT) {
        runner.guard('forfeit', () => runner.forfeit(seat));
      }
      this.remove(player);
    }
    const reapable =
      this.players.length === 0 ||
      (this.connectedCount === 0 && this.emptySince !== 0 && now - this.emptySince > config.roomTtlMs);
    return { expired, reapable };
  }

  dispose(): void {
    this.runner?.stop();
    this.runner = null;
    for (const player of this.players) {
      player.room = null;
      player.seat = NO_SEAT;
    }
    this.players = [];
  }
}
