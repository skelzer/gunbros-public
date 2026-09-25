/**
 * MatchState (DESIGN §1.2, §2). Everything the simulation needs and nothing else: the
 * same object exists on the server and in every client, and `hashState` over it is the
 * desync check.
 *
 * Phase 1 runs in `freePlay` mode — no turn machine, every seat may move, aim and fire
 * at will. Phase 2 adds `turns` and the delay ordering; the fields for it (delay,
 * ssGauge, activeSeat, turn) already exist so the shape does not change under the
 * client.
 */
import type { Prng } from '../math/prng.js';
import type { Terrain } from '../terrain/terrain.js';
import type { WindState } from '../rules/wind.js';
import type { MobileState, TeamId } from '../entities/mobile.js';
import type { ProjectileDef, ProjectileState } from '../entities/projectile.js';
import type { MapDef } from '../data/maps.js';
import type { ItemId } from '../data/items.js';
import type { MobileId, ShotSlot } from '../data/mobiles.js';
import type { SkyEventId } from '../data/sky.js';
import type { SkyState } from '../rules/sky.js';
import type { TurnEffect } from '../entities/behaviours/index.js';
import type { MineState } from '../entities/mines.js';
import type { SimEvent } from './events.js';

export type MatchMode = 'freePlay' | 'turns';

/**
 * The turn state machine (DESIGN §2.9): `starting` (0.5 s) -> `active` (20 s timer) ->
 * `resolving` (until the shot settles) -> `ending` (0.75 s) -> the next turn's
 * `starting`. `ended` is terminal: one team has no living mobiles left.
 *
 * A `freePlay` match sits in `active` forever and ignores the machine entirely.
 */
export type TurnPhase = 'starting' | 'active' | 'resolving' | 'ending' | 'ended';

/** Hash and wire ordering for {@link TurnPhase}; the index is what `hashState` mixes. */
export const turnPhases: TurnPhase[] = ['starting', 'active', 'resolving', 'ending', 'ended'];

export function turnPhaseIndex(phase: TurnPhase): number {
  for (let i = 0; i < turnPhases.length; i++) {
    if (turnPhases[i] === phase) return i;
  }
  return 0;
}

/** What the room hands the match for one seat. */
export interface SeatSpec {
  playerId: string;
  nick: string;
  team: TeamId;
  mobileId: MobileId;
  /**
   * The six-slot item loadout chosen in the room (DESIGN §4, §6.1 `setItems`). Omitted
   * means "no items"; anything that does not fit in `itemSlots` is dropped by
   * `validateLoadout`, so a malformed lobby list can never stop a match starting.
   */
  items?: ItemId[];
}

export interface PlayerSlot {
  seat: number;
  playerId: string;
  nick: string;
  team: TeamId;
  mobileId: MobileId;
  /** Accumulated delay; lowest goes next (DESIGN §2.8). Phase 2 uses it. */
  delay: number;
  /** SS gauge, unlocks at constants.ss.gaugeMax (DESIGN §7 item 1). */
  ssGauge: number;
  /** Currently selected shot. */
  shot: ShotSlot;
  /**
   * The loadout, fixed for the whole match (DESIGN §4). It never changes, which is why
   * `matchStart` can carry it and the snapshot only has to carry what has been spent.
   */
  items: ItemId[];
  /**
   * Items already spent, in use order. Items are consumables: an id in here is gone for
   * the rest of the match. Hashed and snapshotted, because two engines that disagree
   * about what is left disagree about what the next turn may do.
   */
  itemsUsed: ItemId[];
  connected: boolean;
}

/**
 * What the items used *this turn* changed (DESIGN §4: "items are applied to the current
 * turn only"). Reset by the turn machine at every `finishTurn` and every `beginTurn`,
 * hashed and snapshotted in between — a client that dropped a `powerUp` would otherwise
 * deal 2/3 of the damage the authority dealt and only find out at the next `turnEnd`.
 */
export interface TurnMods {
  /** The next fire this turn goes off twice (same shot, same angle, same power). */
  dual: boolean;
  /** The next fire this turn goes off as S1 then S2. */
  dualPlus: boolean;
  /** Craters ×`carveMultiplier`, damage ×`damageMultiplier`, for the active seat. */
  bunge: boolean;
  /** Damage ×`damageMultiplier` for the active seat. */
  powerUp: boolean;
  /**
   * Items the active seat has used this turn. DESIGN §4 allows one, so this is empty or
   * a single id; it is a list because "how many" is the rule and a list says so.
   */
  usedThisTurn: ItemId[];
}

export function noTurnMods(): TurnMods {
  return { dual: false, dualPlus: false, bunge: false, powerUp: false, usedThisTurn: [] };
}

/** A projectile queued to appear later (multi-shot `stagger`, Dual item). */
export interface PendingSpawn {
  atTick: number;
  def: ProjectileDef;
  ownerSeat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface MatchState {
  seed: number;
  mode: MatchMode;
  map: MapDef;
  terrain: Terrain;
  wind: WindState;
  rng: Prng;
  /** Ticks since the match began. */
  tick: number;
  /**
   * The turn being played, 1-based. 0 before the first turn has begun and for the whole
   * of a `freePlay` match.
   */
  turn: number;
  /** Turns that have finished. Drives the wind schedule (§2.7) and sudden death (§2.9). */
  completedTurns: number;
  /** Where the turn machine is (DESIGN §2.9). */
  phase: TurnPhase;
  /** Ticks left in the current phase; only `starting`, `active` and `ending` count down. */
  turnTicksLeft: number;
  /** `state.tick` at the moment the current turn entered `active`. */
  turnStartTick: number;
  /**
   * Delay the active seat has already earned this turn (shot or skip, plus the time
   * cost, plus items in Phase 5). It is banked on the seat when the turn ends, so a
   * turn that is still resolving has not yet moved anybody in the order.
   */
  pendingDelay: number;
  /**
   * What the items used this turn changed (DESIGN §4). Reset at every turn boundary.
   */
  turnMods: TurnMods;
  /**
   * Power the active client last reported it is charging at, or -1 when it is not
   * charging. A timer expiry fires at this power instead of skipping (DESIGN §7 item 3).
   */
  chargingPower: number;
  /** Power of each seat's previous shot, -1 for a seat that has not fired yet. */
  lastShotPower: number[];
  /** Winning team once `phase` is `ended`; null for a draw or an abandoned match. */
  winnerTeam: TeamId | null;
  /** Seat whose turn it is; in free play this is just the last seat that acted. */
  activeSeat: number;
  seats: PlayerSlot[];
  mobiles: MobileState[];
  projectiles: ProjectileState[];
  pendingSpawns: PendingSpawn[];
  turnEffects: TurnEffect[];
  /**
   * Walking mines (DESIGN §3, raon). Persistent: they survive the turn that made
   * them, they are in the state hash and the snapshot, and — unlike `turnEffects` —
   * they never block `isSettled` (DESIGN §7 item 34).
   */
  mines: MineState[];
  nextProjectileId: number;
  nextMineId: number;
  /**
   * The match's sky event and everything about it that changes (DESIGN §5): Thor's
   * level and strike count, the tornado's column, the Force band's edges, the turns
   * it has left. Rolled at match start — the server puts the id in `matchStart`, every
   * engine builds the same state from it — then replaced at turn ends as weather comes
   * and goes, and hashed and snapshotted like any other simulation state.
   */
  sky: SkyState;
  /**
   * The sky is pinned (`SKY_EVENT`, `?sky=`): the opening event stays for the whole
   * match and no weather comes or goes. Fixed at match start and carried in
   * `matchStart`, so it is the same on every engine and is not hashed. Set it before
   * assigning `skyEventId`, which reads it to decide whether the event lasts.
   */
  skyStatic: boolean;
  /**
   * The rolled event's id: an alias of `sky.kind`. Assigning it rebuilds `sky` for the
   * match's seed and map, so an engine that is told the event only *after*
   * `createMatch` (the server's test client) lands on exactly the same column as one
   * that passed it as a `createMatch` option.
   */
  skyEventId: SkyEventId;
  /**
   * Events produced by the most recent `step()` — exactly that array and nothing else.
   * `applyIntent` does not append to it: its own events are its return value, so this
   * field never mixes a tick's events with an intent applied between two ticks.
   */
  events: SimEvent[];
}

export function mobileOfSeat(state: MatchState, seat: number): MobileState | undefined {
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (m && m.seat === seat) return m;
  }
  return undefined;
}

export function slotOfSeat(state: MatchState, seat: number): PlayerSlot | undefined {
  for (let i = 0; i < state.seats.length; i++) {
    const s = state.seats[i];
    if (s && s.seat === seat) return s;
  }
  return undefined;
}

/** True once one team has no living mobiles left. */
export function livingTeams(state: MatchState): TeamId[] {
  let a = false;
  let b = false;
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m || !m.alive) continue;
    if (m.team === 'A') a = true;
    else b = true;
  }
  const out: TeamId[] = [];
  if (a) out.push('A');
  if (b) out.push('B');
  return out;
}

/** Nothing in flight, nothing falling, nothing scheduled: the shot has resolved. */
export function isSettled(state: MatchState): boolean {
  if (state.projectiles.length > 0) return false;
  if (state.pendingSpawns.length > 0) return false;
  if (state.turnEffects.length > 0) return false;
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (m && m.alive && !m.grounded) return false;
  }
  return true;
}
