/**
 * Wire protocol (DESIGN §6). Types only — no implementation, no runtime guards. The
 * server adds its own guards in `packages/server/src/protocol.ts`; the client imports
 * these to type its socket.
 *
 * Every message is `{ t: string, ...payload }` and goes over one WebSocket as JSON.
 */
import type { PrngState } from '../math/prng.js';
import type { MapId } from '../data/maps.js';
import type { MobileId, ShotSlot } from '../data/mobiles.js';
import type { ItemId } from '../data/items.js';
import type { SkyEventId } from '../data/sky.js';
import type { BotDifficulty } from '../data/bots.js';
import type { TeamId } from '../entities/mobile.js';
import type { Snapshot } from '../match/snapshot.js';

export type PlayerId = string;
export type RoomCode = string;
export type RoomPhase = 'lobby' | 'starting' | 'match' | 'ended';

/**
 * What marks a seat as a practice bot (DESIGN §11, §7 item 186). Absent for a human:
 * the protocol has no other way to tell the two apart, and needs none.
 */
export interface BotInfo {
  difficulty: BotDifficulty;
}

export interface PlayerInfo {
  playerId: PlayerId;
  nick: string;
  team: TeamId;
  mobileId: MobileId | 'random';
  items: ItemId[];
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /** Present for a server-side bot, absent for a human (DESIGN §11). */
  bot?: BotInfo;
}

export interface SeatInfo {
  seat: number;
  playerId: PlayerId;
  nick: string;
  team: TeamId;
  mobileId: MobileId;
  /**
   * The six-slot loadout this seat starts the match with (DESIGN §4). `createMatch`
   * takes it in `SeatSpec.items`, so every engine builds the same `PlayerSlot.items`
   * from `matchStart` alone.
   */
  items: ItemId[];
  /** Present for a server-side bot, absent for a human (DESIGN §11). */
  bot?: BotInfo;
}

// --------------------------------------------------------------------------
// 6.1 Client -> server
// --------------------------------------------------------------------------

export interface HelloMsg {
  t: 'hello';
  nick: string;
  token?: string;
}
export interface CreateRoomMsg {
  t: 'createRoom';
  mapId?: MapId;
  maxPlayers?: number;
  /**
   * Show the room in every lobby's open-rooms list ({@link RoomListMsg}). Left out, the
   * room is unlisted: only someone who has its code can find it.
   */
  listed?: boolean;
  /**
   * "Practice vs bot" (DESIGN §7 item 192): an unlisted room with the creator on team A
   * and a Normal bot on team B. `listed` is ignored when this is set.
   */
  practice?: boolean;
}
export interface JoinRoomMsg {
  t: 'joinRoom';
  code: RoomCode;
}
/** Ask for the listed rooms that can be joined right now; answered by {@link RoomListMsg}. */
export interface ListRoomsMsg {
  t: 'listRooms';
}
export interface LeaveRoomMsg {
  t: 'leaveRoom';
}
export interface SetTeamMsg {
  t: 'setTeam';
  team: TeamId;
}
export interface SetMobileMsg {
  t: 'setMobile';
  mobileId: MobileId | 'random';
}
export interface SetItemsMsg {
  t: 'setItems';
  items: ItemId[];
}
export interface SetMapMsg {
  t: 'setMap';
  mapId: MapId;
}
export interface SetReadyMsg {
  t: 'setReady';
  ready: boolean;
}
export interface StartMsg {
  t: 'start';
}
/** Host only, lobby only: seat a bot on `team` (DESIGN §11). */
export interface AddBotMsg {
  t: 'addBot';
  team: TeamId;
  difficulty: BotDifficulty;
}
/** Host only, lobby only: a bot's lobby picks. Fields left out are left alone. */
export interface SetBotMsg {
  t: 'setBot';
  playerId: PlayerId;
  team?: TeamId;
  mobileId?: MobileId | 'random';
  difficulty?: BotDifficulty;
}
/** Host only, lobby only: the bot gives its seat back. */
export interface RemoveBotMsg {
  t: 'removeBot';
  playerId: PlayerId;
}
export interface ChatMsg {
  t: 'chat';
  text: string;
}
export interface MoveMsg {
  t: 'move';
  dir: -1 | 0 | 1;
  seq: number;
}
export interface AimMsg {
  t: 'aim';
  relAngle: number;
}
export interface SelectShotMsg {
  t: 'selectShot';
  shot: ShotSlot;
}
export interface UseItemMsg {
  t: 'useItem';
  itemId: ItemId;
  target?: { x: number; y: number };
}
export interface FireMsg {
  t: 'fire';
  shot: ShotSlot;
  relAngle: number;
  /** [0, 1], quantised to 1/1000. */
  power: number;
  seq: number;
}
export interface SkipMsg {
  t: 'skip';
}
/**
 * "Still charging, bar is here." Sent a few times a second while the power key is held
 * so that a timer expiry fires at the current power instead of skipping
 * (DESIGN §2.10, §7 item 3). The *released* power still arrives in `fire`.
 */
export interface ChargingMsg {
  t: 'charging';
  /** [0, 1], quantised to 1/1000; negative means "stopped charging". */
  power: number;
}
export interface RequestTerrainMsg {
  t: 'requestTerrain';
}
/** Keep-alive. The server answers {@link PongMsg} and nothing else. */
export interface PingMsg {
  t: 'ping';
}

export type ClientMessage =
  | HelloMsg
  | CreateRoomMsg
  | JoinRoomMsg
  | ListRoomsMsg
  | LeaveRoomMsg
  | SetTeamMsg
  | SetMobileMsg
  | SetItemsMsg
  | SetMapMsg
  | SetReadyMsg
  | StartMsg
  | AddBotMsg
  | SetBotMsg
  | RemoveBotMsg
  | ChatMsg
  | MoveMsg
  | AimMsg
  | SelectShotMsg
  | UseItemMsg
  | FireMsg
  | SkipMsg
  | ChargingMsg
  | RequestTerrainMsg
  | PingMsg;

// --------------------------------------------------------------------------
// 6.2 Server -> client
// --------------------------------------------------------------------------

export interface WelcomeMsg {
  t: 'welcome';
  playerId: PlayerId;
  token: string;
}
export interface ErrorMsg {
  t: 'error';
  code: string;
  message: string;
}
export interface RoomStateMsg {
  t: 'roomState';
  code: RoomCode;
  hostId: PlayerId;
  mapId: MapId;
  /**
   * Seats the room was opened with. The room screen needs it to show "2 / 4" and to
   * decide whether the team toggle is worth offering at all (DESIGN §7 item 13: a 1v1
   * room assigns A and B by itself).
   */
  maxPlayers: number;
  players: PlayerInfo[];
  phase: RoomPhase;
}
/** One row of the lobby's open-rooms list. */
export interface OpenRoomInfo {
  code: RoomCode;
  /** The host's nickname. */
  host: string;
  mapId: MapId;
  players: number;
  maxPlayers: number;
}
/**
 * The answer to {@link ListRoomsMsg}: listed rooms still in their lobby, with a free
 * seat and somebody connected, fullest first.
 */
export interface RoomListMsg {
  t: 'roomList';
  rooms: OpenRoomInfo[];
}
export interface ChatBroadcastMsg {
  t: 'chat';
  from: string;
  text: string;
  ts: number;
}
export interface MatchStartMsg {
  t: 'matchStart';
  seed: number;
  mapId: MapId;
  players: SeatInfo[];
  skyEvent: SkyEventId;
  /** The sky is pinned (`SKY_EVENT`): no weather comes or goes (DESIGN §5). */
  skyStatic?: boolean;
}
export interface TurnStartMsg {
  t: 'turnStart';
  seat: number;
  turn: number;
  /** Wall-clock deadline for the client's countdown only; the sim counts ticks. */
  deadlineMs: number;
  wind: { strength: number; directionDeg: number };
  delays: number[];
  ssReady: boolean[];
}
/**
 * The authoritative walk. `dir` is the intent the server applied, `tick` is the tick it
 * applied it on, and x/y/gauge are where that left the mobile.
 *
 * Sent on every direction change (the edges of the client's `move`) and then at
 * `moveEcho` rate while the mobile is walking or falling. A client that is tick-aligned
 * applies `{ t: 'move', seat, dir }` at `tick` and stays bit-identical; one that is not
 * lerps the position instead and waits for the next `turnEnd` to reconcile.
 */
export interface MoveEchoMsg {
  t: 'moveEcho';
  seat: number;
  dir: -1 | 0 | 1;
  x: number;
  y: number;
  facing: -1 | 1;
  gauge: number;
  tick: number;
}
export interface AimEchoMsg {
  t: 'aimEcho';
  seat: number;
  /** Already clamped to the mobile's own range by the server. */
  relAngle: number;
  tick: number;
}

/** The authoritative shot selection, echoed because a timer expiry fires `slot.shot`. */
export interface ShotEchoMsg {
  t: 'shotEcho';
  seat: number;
  shot: ShotSlot;
  tick: number;
}
/**
 * The authoritative item use (DESIGN §4, §6.2). The server has already run
 * `canUseItem`; every client applies `{ t: 'useItem', seat, itemId, target }` at `tick`
 * exactly the way it applies `fire`, and gets the same heal, teleport, wind roll or
 * turn modifier out of it.
 */
export interface ItemUsedMsg {
  t: 'itemUsed';
  seat: number;
  itemId: ItemId;
  target?: { x: number; y: number };
  /** The tick the authority applied it on; a tick-aligned client applies it there too. */
  tick: number;
}
/** The authoritative fire command: every client runs the sim from this exact start. */
export interface FireBroadcastMsg {
  t: 'fire';
  seat: number;
  shot: ShotSlot;
  relAngle: number;
  power: number;
  /** The shooter as the authority had it the instant before the shot left the barrel. */
  shooter: { x: number; y: number; facing: -1 | 1; tilt: number };
  wind: { strength: number; directionDeg: number };
  /** The match PRNG *before* the shot, so a replay draws the same numbers. */
  rngState: PrngState;
  /**
   * The items the shooter used this turn (DESIGN §6.2), for logs and for a client that
   * wants to label the shot. It is *not* how an item reaches a client's simulation —
   * `itemUsed` is, and it arrives before this — because Dual has to be flagged before
   * the trigger and a heal has to land whether or not a shot follows it.
   */
  items: ItemId[];
  /** The tick the authority applied it on; a tick-aligned client applies it there too. */
  tick: number;
}

/** The authoritative end-of-turn-without-a-shot, the `fire` message's twin. */
export interface SkipEchoMsg {
  t: 'skipEcho';
  seat: number;
  tick: number;
}
/**
 * The server's echo of {@link ChargingMsg} to every client (DESIGN §7 item 31).
 *
 * Every engine runs `step()`, so every engine reaches the timer expiry — and the expiry
 * fires the shot only when the engine knows the active player was mid-charge (DESIGN §7
 * item 3). Without this echo a non-active client holds `chargingPower = -1`, resolves
 * the expiry as a skip, leaves `active`, and then drops the server's authoritative
 * `fire` because `turnAcceptsIntent` rejects intents outside `active`.
 */
export interface ChargingEchoMsg {
  t: 'chargingEcho';
  seat: number;
  /** [0, 1], quantised to 1/1000; negative means "stopped charging". */
  power: number;
  tick: number;
}
export interface TurnEndMsg {
  t: 'turnEnd';
  snapshot: Snapshot;
}
/**
 * Everything a returning client needs to carry on (DESIGN §6.4). Sent after
 * `roomState` and `matchStart`, which between them let the client rebuild the match
 * from scratch; this then fast-forwards that fresh state to *now*: the terrain mask
 * replaces the generated terrain, the snapshot replaces mobiles, wind, PRNG, delays
 * and the whole turn machine (including `tick`), and `turn` repeats the current
 * `turnStart` so the HUD has its countdown back.
 */
export interface ResyncMsg {
  t: 'resync';
  snapshot: Snapshot;
  width: number;
  height: number;
  rle: string;
  turn: Omit<TurnStartMsg, 't'>;
}
export interface TerrainMaskMsg {
  t: 'terrainMask';
  width: number;
  height: number;
  rle: string;
}
export interface PlayerLeftMsg {
  t: 'playerLeft';
  seat: number;
}
export interface PlayerReconnectedMsg {
  t: 'playerReconnected';
  seat: number;
}
/**
 * The seat's reconnect grace ran out (DESIGN §6.4). Every engine applies the same
 * `{ t: 'forfeit', seat }` intent, which kills the mobile where it stands; the turn
 * machine then ends the turn (if it was theirs) and possibly the match.
 */
export interface PlayerForfeitMsg {
  t: 'playerForfeit';
  seat: number;
  tick: number;
}
export interface MatchEndMsg {
  t: 'matchEnd';
  winnerTeam: TeamId | null;
  reason: 'eliminated' | 'forfeit' | 'abandoned';
}
export interface PongMsg {
  t: 'pong';
}

export type ServerMessage =
  | WelcomeMsg
  | ErrorMsg
  | RoomStateMsg
  | RoomListMsg
  | ChatBroadcastMsg
  | MatchStartMsg
  | TurnStartMsg
  | MoveEchoMsg
  | AimEchoMsg
  | ShotEchoMsg
  | ItemUsedMsg
  | FireBroadcastMsg
  | SkipEchoMsg
  | ChargingEchoMsg
  | TurnEndMsg
  | ResyncMsg
  | TerrainMaskMsg
  | PlayerLeftMsg
  | PlayerReconnectedMsg
  | PlayerForfeitMsg
  | MatchEndMsg
  | PongMsg;

export type AnyMessage = ClientMessage | ServerMessage;
export type ClientMessageType = ClientMessage['t'];
export type ServerMessageType = ServerMessage['t'];
