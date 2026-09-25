/**
 * A player: an identity that outlives its socket.
 *
 * The reconnect token (DESIGN §6.4) is what makes that true — the browser stores it,
 * sends it in `hello`, and gets the same `Player` back, seat and all, as long as the
 * grace period has not expired. Everything about *how* the player is connected lives on
 * the {@link Connection}; everything about who they are and what they picked lives here.
 */
import type { BotInfo, ItemId, MobileId, PlayerId, PlayerInfo, TeamId } from '@gunbros/shared';
import type { Connection } from './connection.js';
import type { Room } from './room.js';

/** A seat number that means "not in a match". */
export const NO_SEAT = -1;

export interface Player {
  readonly id: PlayerId;
  readonly token: string;
  nick: string;
  conn: Connection | null;
  room: Room | null;
  /**
   * A practice bot (DESIGN §11, §7 item 186): a player with no socket, living in one
   * room. Null for a human. A bot's `conn` is always null, so every `conn?.send` is a
   * no-op for it, and it is never in the manager's token or id maps.
   */
  bot: BotInfo | null;

  // --- lobby choices (DESIGN §6.1) ---
  team: TeamId;
  mobileId: MobileId | 'random';
  items: ItemId[];
  ready: boolean;

  // --- match ---
  /** Seat in the running match, or {@link NO_SEAT}. */
  seat: number;

  /** `Date.now()` of the socket loss, or 0 while connected (DESIGN §6.4 grace). */
  disconnectedAt: number;
  /** Timestamps of recent chat lines, for the rate limit. */
  chatTimes: number[];
  /** Last `move` sequence number accepted, so a reordered pair cannot flip the walk. */
  lastMoveSeq: number;
  /** Last `fire` sequence number accepted, so a retransmit cannot fire twice. */
  lastFireSeq: number;
  /** Throttle bookkeeping, all `Date.now()` stamps. */
  lastAimAt: number;
  lastChargeAt: number;
  lastShotSelectAt: number;
  lastItemAt: number;
  lastTerrainRequestAt: number;
}

export function createPlayer(id: PlayerId, token: string, nick: string): Player {
  return {
    id,
    token,
    nick,
    conn: null,
    room: null,
    bot: null,
    team: 'A',
    mobileId: 'random',
    items: [],
    ready: false,
    seat: NO_SEAT,
    disconnectedAt: 0,
    chatTimes: [],
    lastMoveSeq: -1,
    lastFireSeq: -1,
    lastAimAt: 0,
    lastChargeAt: 0,
    lastShotSelectAt: 0,
    lastItemAt: 0,
    lastTerrainRequestAt: 0,
  };
}

/**
 * Is anybody there? A bot always is (DESIGN §7 item 186): it has no socket to lose, so
 * `start` never refuses it as disconnected and the sweeper never starts its grace.
 */
export function isConnected(player: Player): boolean {
  if (player.bot) return true;
  return player.conn !== null && player.conn.open;
}

export function isBot(player: Player): boolean {
  return player.bot !== null;
}

export function playerInfo(player: Player, hostId: PlayerId): PlayerInfo {
  return {
    playerId: player.id,
    nick: player.nick,
    team: player.team,
    mobileId: player.mobileId,
    items: player.items.slice(),
    ready: player.ready,
    connected: isConnected(player),
    isHost: player.id === hostId,
    ...(player.bot ? { bot: { difficulty: player.bot.difficulty } } : {}),
  };
}
