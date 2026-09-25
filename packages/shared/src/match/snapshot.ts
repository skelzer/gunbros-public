/**
 * State hashing and snapshots (DESIGN §2.1, §6.2 `turnEnd`).
 *
 * `hashState` is FNV-1a 32-bit over: the terrain hash, then per mobile in seat order
 * q8(x), q8(y), q8(vx), hp, shield, defenceMod, delay, ssGauge, alive, then the wind,
 * then the turn counters and the whole turn machine (phase index, ticks left, active seat, pending
 * delay, turn start tick, the active seat's move gauge), then the items (this turn's
 * modifier flags and each seat's spent list), then the walking mines in list
 * order, and finally the sky event (its id, its placement, Thor's level and strike
 * count, the turns it has left), and last what decides the *next* turn without having
 * shown up yet: the PRNG words, the projectile and mine id counters, and per mobile its
 * facing, tilt, relative aim and walk input, and per seat the selected shot. Every float
 * is quantised with q8 first so that two engines whose last bits differ still agree —
 * that is the whole point of the hash.
 *
 * `vx` is in the list because only an impulse ever sets it (a pull, a shockwave): two
 * engines that disagree about it disagree about an event that has already happened.
 * `vy` stays out, as it always has — a falling mobile's `y` moves every tick anyway.
 *
 * `chargingPower` and `lastShotPower` are deliberately outside it: the first is a
 * client report that only the active engine holds until Phase 3 echoes it, the second
 * is a HUD marker.
 *
 * Reconciliation is symmetric: see {@link quantiseState}.
 */
import { q8, fromQ8, snapQ8 } from '../math/fixed.js';
import type { PrngState } from '../math/prng.js';
import { makeWind } from '../rules/wind.js';
import { itemIds } from '../data/items.js';
import type { ItemId } from '../data/items.js';
import { skyEventIndex } from '../data/sky.js';
import type { SkyEventId } from '../data/sky.js';
import type { ShotSlot } from '../data/mobiles.js';
import type { TeamId } from '../entities/mobile.js';
import type { MatchState, TurnMods, TurnPhase } from './match.js';
import { mobileOfSeat, noTurnMods, turnPhaseIndex } from './match.js';
import {
  hashMines,
  minesFromSnapshot,
  quantiseMines,
  snapshotMines,
} from '../entities/mines.js';
import type { MineSnapshot } from '../entities/mines.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixByte(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Feed a 32-bit integer (little-endian bytes) into an FNV-1a accumulator. */
export function mixU32(h: number, value: number): number {
  const v = value | 0;
  let out = mixByte(h, v);
  out = mixByte(out, v >>> 8);
  out = mixByte(out, v >>> 16);
  out = mixByte(out, v >>> 24);
  return out;
}

/**
 * A stable integer for an item id — its position in `itemDefs`, which is data and in a
 * fixed order (DESIGN §4). Hashing the string would mean hashing bytes for no gain.
 */
function itemIndex(id: ItemId | undefined): number {
  if (id === undefined) return 0;
  for (let i = 0; i < itemIds.length; i++) if (itemIds[i] === id) return i + 1;
  return 0;
}

/** This turn's item flags as one small integer, plus how many items it has used. */
function turnModsBits(state: MatchState): number {
  const mods = state.turnMods;
  let bits = 0;
  if (mods.dual) bits |= 1;
  if (mods.dualPlus) bits |= 2;
  if (mods.bunge) bits |= 4;
  if (mods.powerUp) bits |= 8;
  return bits | (mods.usedThisTurn.length << 4);
}

export function hashState(state: MatchState): number {
  let h = FNV_OFFSET;
  h = mixU32(h, state.terrain.hash());
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m) continue;
    const slot = state.seats[m.seat];
    h = mixU32(h, q8(m.x));
    h = mixU32(h, q8(m.y));
    h = mixU32(h, q8(m.vx));
    h = mixU32(h, q8(m.hp));
    h = mixU32(h, q8(m.shield));
    // Persistent cross-turn state (ice's stacking debuff): it multiplies every later
    // damage roll (rules/damage.ts), so two engines that disagree about it are desynced
    // long before an hp value shows it (DESIGN §2.1, §2.6).
    h = mixU32(h, q8(m.defenceMod));
    h = mixU32(h, q8(slot ? slot.delay : 0));
    h = mixU32(h, q8(slot ? slot.ssGauge : 0));
    h = mixU32(h, m.alive ? 1 : 0);
  }
  h = mixU32(h, q8(state.wind.strength));
  h = mixU32(h, q8(state.wind.directionDeg));
  h = mixU32(h, state.turn);
  // The turn machine is part of the authoritative state: two engines that disagree
  // about whose turn it is, or how much walking is left, have already desynced
  // (DESIGN §2.9). The move gauge only matters for the seat that can spend it.
  h = mixU32(h, state.completedTurns);
  h = mixU32(h, turnPhaseIndex(state.phase));
  h = mixU32(h, state.turnTicksLeft);
  // Whose turn it is, what that turn has cost so far and when it started: two engines
  // that disagree about any of these have desynced even when every mobile still lines
  // up, because the next `finishTurn` will bank a different delay on a different seat.
  h = mixU32(h, state.activeSeat);
  h = mixU32(h, q8(state.pendingDelay));
  h = mixU32(h, state.turnStartTick);
  const active = mobileOfSeat(state, state.activeSeat);
  h = mixU32(h, q8(active ? active.moveGauge : 0));
  // Items (DESIGN §4). What this turn's items changed, and what every seat has already
  // spent: two engines that disagree about either deal different damage on this turn's
  // shot or allow a different item on a later one, long before an hp value shows it.
  h = mixU32(h, turnModsBits(state));
  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    if (!slot) continue;
    h = mixU32(h, slot.itemsUsed.length);
    for (let j = 0; j < slot.itemsUsed.length; j++) {
      h = mixU32(h, itemIndex(slot.itemsUsed[j]));
    }
  }
  // Persistent entities: mines outlive the turn that dropped them, so two engines that
  // disagree about one are desynced even though every mobile still lines up (DESIGN §3).
  h = hashMines(mixU32, h, state.mines);
  // The sky (DESIGN §5). Weather comes and goes at turn ends and Thor levels up
  // mid-turn: two engines that disagree about any of it deal different damage on the
  // very next explosion, or disagree about when the sky clears.
  h = mixU32(h, skyEventIndex(state.sky.kind));
  h = mixU32(h, q8(state.sky.x));
  h = mixU32(h, q8(state.sky.top));
  h = mixU32(h, q8(state.sky.bottom));
  h = mixU32(h, state.sky.level);
  h = mixU32(h, state.sky.hits);
  h = mixU32(h, state.sky.turnsLeft);
  // State that decides the next turn before any hp or position shows it. Leave these
  // out and a client that has drifted only here passes the hash, never takes the
  // snapshot that would fix it, and desyncs visibly a turn later with no cause left to
  // find: a different number of PRNG draws (a tornado exit, a sword wobble), an id off
  // by one (`weave` and `orbit` read their body from `id % n`), a stale aim or shot
  // (the timer fires `slot.shot` at `relAngle`), a walk the other engine never stopped.
  const rng = state.rng.getState();
  for (let i = 0; i < rng.length; i++) h = mixU32(h, rng[i] ?? 0);
  h = mixU32(h, state.nextProjectileId);
  h = mixU32(h, state.nextMineId);
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m) continue;
    h = mixU32(h, m.facing);
    h = mixU32(h, q8(m.tilt));
    h = mixU32(h, q8(m.relAngle));
    h = mixU32(h, m.moveDir);
  }
  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    h = mixU32(h, !slot ? 0 : slot.shot === 's1' ? 1 : slot.shot === 's2' ? 2 : 3);
  }
  return h >>> 0;
}

export interface MobileSnapshot {
  seat: number;
  /** q8 fixed point. */
  x: number;
  y: number;
  vy: number;
  /** Horizontal velocity while airborne; only an impulse ever sets it. */
  vx: number;
  facing: -1 | 1;
  tilt: number;
  relAngle: number;
  hp: number;
  shield: number;
  defenceMod: number;
  moveGauge: number;
  alive: boolean;
  /**
   * The walk input. A resync taken while the active player holds an arrow would
   * otherwise leave the mobile standing locally while it walks on the server, and the
   * shot would leave from a different spot. Absent from older snapshots: read as 0.
   */
  moveDir?: -1 | 0 | 1;
}

/** `MatchState.sky` on the wire; `x`, `top` and `bottom` are q8 like every position. */
export interface SkySnapshot {
  kind: SkyEventId;
  x: number;
  top: number;
  bottom: number;
  level: number;
  hits: number;
  /** Absent from a snapshot taken before weather came and went; read as 0. */
  turnsLeft?: number;
}

export interface Snapshot {
  tick: number;
  turn: number;
  completedTurns: number;
  phase: TurnPhase;
  /** Who won, once `phase` is `ended`; null for a draw. Without it a resync of a
   * finished match renders as a draw. */
  winnerTeam: TeamId | null;
  turnTicksLeft: number;
  turnStartTick: number;
  pendingDelay: number;
  /**
   * Power the active seat is charging at, or -1 (DESIGN §7 item 3). A client that
   * resyncs mid-`active` would otherwise skip on the timer expiry where the authority
   * fires.
   */
  chargingPower: number;
  /** Power of each seat's previous shot, -1 for none (the HUD's previous-shot marker). */
  lastShotPower: number[];
  activeSeat: number;
  wind: { strength: number; directionDeg: number };
  delays: number[];
  ssGauges: number[];
  /**
   * Each seat's selected shot. A timer expiry fires `slot.shot` (reducer's `fire`
   * hook), so a client holding a stale selection would fire a different shot from the
   * authority.
   */
  shots: ShotSlot[];
  /**
   * Each seat's item loadout (DESIGN §4). It never changes during a match and
   * `matchStart` already carries it, but a `resync` is meant to be enough on its own —
   * a client that rebuilt from a truncated `matchStart` would otherwise be offered
   * items it does not have.
   */
  items: ItemId[][];
  /** Each seat's spent items. This is the half that changes, and it is a consumable. */
  itemsUsed: ItemId[][];
  /** What this turn's item did, so a resync mid-turn keeps Dual and the multipliers. */
  turnMods: TurnMods;
  mobiles: MobileSnapshot[];
  /** Walking mines (DESIGN §3). Persistent, so a resync has to carry them. */
  mines: MineSnapshot[];
  /** Next id `addMine` will hand out, so two engines never reuse one. */
  nextMineId: number;
  /**
   * The sky event (DESIGN §5). Weather comes and goes and Thor levels up, so a
   * reconnecting client that rebuilt from `matchStart` alone would hold the opening
   * sky while the authority is under a different one.
   */
  sky: SkySnapshot;
  /**
   * Next id `ctx.spawn` will hand out. A reconnecting client rebuilds through
   * `createMatch` (DESIGN §6.4), so its counter would restart at 1 while the authority
   * is at N — and `weave` (`id % 2`) and `orbit` (`id % count`) read which body of a
   * volley they are off that id, so the two engines would give the same shot different
   * bodies and carve the terrain in a different order.
   */
  nextProjectileId: number;
  /**
   * The match PRNG, four uint32 words. Without it a client that rebuilds from
   * `matchStart` plus a resync snapshot (DESIGN §6.4) has its stream positioned at
   * match start, so its next wind reroll and every behaviour draw diverge.
   */
  rng: PrngState;
  terrainHash: number;
  stateHash: number;
}

/**
 * Snap every field a snapshot carries onto the q8 grid.
 *
 * A snapshot is lossy: it stores `q8(x)`, and the client that applies it ends up holding
 * `floor(x * 256) / 256` while the authority still holds the raw float. The two sims are
 * then no longer bit-identical and every later `turnEnd` mismatches (DESIGN §6.3 step 5
 * would overwrite forever and the desync counter would mean nothing). Quantising both
 * sides at the same moment makes the reconciliation converge instead — which is what
 * {@link snapshotForTurnEnd} does for the authority.
 */
export function quantiseState(state: MatchState): void {
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m) continue;
    m.x = snapQ8(m.x);
    m.y = snapQ8(m.y);
    m.vy = snapQ8(m.vy);
    m.vx = snapQ8(m.vx);
    m.tilt = snapQ8(m.tilt);
    m.relAngle = snapQ8(m.relAngle);
    m.hp = snapQ8(m.hp);
    m.shield = snapQ8(m.shield);
    m.defenceMod = snapQ8(m.defenceMod);
    m.moveGauge = snapQ8(m.moveGauge);
  }
  quantiseMines(state.mines);
  // The sky's placement is already computed on the grid, but a snapshot round trip
  // must not be able to move it (DESIGN §5).
  state.sky.x = snapQ8(state.sky.x);
  state.sky.top = snapQ8(state.sky.top);
  state.sky.bottom = snapQ8(state.sky.bottom);
}

/**
 * The reconcile point: quantise, then snapshot. Both the authority (before broadcasting
 * `turnEnd`) and every client (at the same moment, whether or not its hash matched) call
 * this, so all engines hold the same numbers going into the next turn.
 */
export function snapshotForTurnEnd(state: MatchState): Snapshot {
  quantiseState(state);
  return takeSnapshot(state);
}

export function takeSnapshot(state: MatchState): Snapshot {
  const mobiles: MobileSnapshot[] = [];
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m) continue;
    mobiles.push({
      seat: m.seat,
      x: q8(m.x),
      y: q8(m.y),
      vy: q8(m.vy),
      vx: q8(m.vx),
      facing: m.facing,
      tilt: q8(m.tilt),
      relAngle: q8(m.relAngle),
      hp: q8(m.hp),
      shield: q8(m.shield),
      defenceMod: q8(m.defenceMod),
      moveGauge: q8(m.moveGauge),
      alive: m.alive,
      moveDir: m.moveDir,
    });
  }
  const delays: number[] = [];
  const ssGauges: number[] = [];
  const shots: ShotSlot[] = [];
  const items: ItemId[][] = [];
  const itemsUsed: ItemId[][] = [];
  for (let i = 0; i < state.seats.length; i++) {
    const s = state.seats[i];
    delays.push(s ? s.delay : 0);
    ssGauges.push(s ? s.ssGauge : 0);
    shots.push(s ? s.shot : 's1');
    items.push(s ? s.items.slice() : []);
    itemsUsed.push(s ? s.itemsUsed.slice() : []);
  }
  return {
    tick: state.tick,
    turn: state.turn,
    completedTurns: state.completedTurns,
    phase: state.phase,
    winnerTeam: state.winnerTeam,
    turnTicksLeft: state.turnTicksLeft,
    turnStartTick: state.turnStartTick,
    pendingDelay: state.pendingDelay,
    chargingPower: state.chargingPower,
    lastShotPower: state.lastShotPower.slice(),
    activeSeat: state.activeSeat,
    wind: { strength: state.wind.strength, directionDeg: state.wind.directionDeg },
    delays,
    ssGauges,
    shots,
    items,
    itemsUsed,
    turnMods: {
      dual: state.turnMods.dual,
      dualPlus: state.turnMods.dualPlus,
      bunge: state.turnMods.bunge,
      powerUp: state.turnMods.powerUp,
      usedThisTurn: state.turnMods.usedThisTurn.slice(),
    },
    mobiles,
    mines: snapshotMines(state.mines),
    nextMineId: state.nextMineId,
    sky: {
      kind: state.sky.kind,
      x: q8(state.sky.x),
      top: q8(state.sky.top),
      bottom: q8(state.sky.bottom),
      level: state.sky.level,
      hits: state.sky.hits,
      turnsLeft: state.sky.turnsLeft,
    },
    nextProjectileId: state.nextProjectileId,
    rng: state.rng.getState(),
    terrainHash: state.terrain.hash(),
    stateHash: hashState(state),
  };
}

/**
 * Overwrite the authoritative parts of the state from a snapshot (DESIGN §6.3 step 5).
 * Terrain is not included: if the terrain hash differs the client asks for the mask.
 */
export function applySnapshot(state: MatchState, snap: Snapshot): void {
  state.tick = snap.tick;
  state.turn = snap.turn;
  state.completedTurns = snap.completedTurns ?? state.completedTurns;
  state.phase = snap.phase ?? state.phase;
  state.winnerTeam = snap.winnerTeam ?? null;
  state.turnTicksLeft = snap.turnTicksLeft ?? state.turnTicksLeft;
  state.turnStartTick = snap.turnStartTick ?? state.turnStartTick;
  state.pendingDelay = snap.pendingDelay ?? state.pendingDelay;
  state.chargingPower = snap.chargingPower ?? state.chargingPower;
  state.turnMods = snap.turnMods
    ? {
        dual: !!snap.turnMods.dual,
        dualPlus: !!snap.turnMods.dualPlus,
        bunge: !!snap.turnMods.bunge,
        powerUp: !!snap.turnMods.powerUp,
        usedThisTurn: (snap.turnMods.usedThisTurn ?? []).slice(),
      }
    : noTurnMods();
  if (snap.lastShotPower) state.lastShotPower = snap.lastShotPower.slice();
  state.activeSeat = snap.activeSeat;
  state.wind = makeWind(snap.wind.strength, snap.wind.directionDeg);
  state.rng.setState(snap.rng);

  for (let i = 0; i < snap.mobiles.length; i++) {
    const s = snap.mobiles[i];
    if (!s) continue;
    const m = state.mobiles[s.seat];
    if (!m) continue;
    m.x = fromQ8(s.x);
    m.y = fromQ8(s.y);
    m.vy = fromQ8(s.vy);
    m.vx = fromQ8(s.vx ?? 0);
    m.facing = s.facing;
    m.tilt = fromQ8(s.tilt);
    m.relAngle = fromQ8(s.relAngle);
    m.hp = fromQ8(s.hp);
    m.shield = fromQ8(s.shield);
    m.defenceMod = fromQ8(s.defenceMod);
    m.moveGauge = fromQ8(s.moveGauge);
    m.alive = s.alive;
    m.moveDir = s.moveDir === -1 || s.moveDir === 1 ? s.moveDir : 0;
    m.grounded = m.alive
      ? state.terrain.isSolid(m.x, m.y + 1) || state.terrain.isSolid(m.x, m.y)
      : m.grounded;
  }

  // Mines are authoritative state, not a render detail: a returning client that kept
  // its own list would walk a mine the server has already detonated (DESIGN §3).
  state.mines = minesFromSnapshot(snap.mines);
  state.nextMineId = snap.nextMineId ?? state.nextMineId;

  // The sky (DESIGN §5). Written field by field rather than through `skyEventId`,
  // which would rebuild the placement and throw Thor's level away.
  if (snap.sky) {
    state.sky.kind = snap.sky.kind;
    state.sky.x = fromQ8(snap.sky.x);
    state.sky.top = fromQ8(snap.sky.top);
    state.sky.bottom = fromQ8(snap.sky.bottom);
    state.sky.level = snap.sky.level;
    state.sky.hits = snap.sky.hits;
    state.sky.turnsLeft = snap.sky.turnsLeft ?? 0;
  }
  state.nextProjectileId = snap.nextProjectileId ?? state.nextProjectileId;

  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    if (!slot) continue;
    slot.delay = snap.delays[i] ?? slot.delay;
    slot.ssGauge = snap.ssGauges[i] ?? slot.ssGauge;
    slot.shot = snap.shots?.[i] ?? slot.shot;
    const loadout = snap.items?.[i];
    if (loadout) slot.items = loadout.slice();
    slot.itemsUsed = (snap.itemsUsed?.[i] ?? slot.itemsUsed).slice();
  }

  /**
   * A snapshot carries no projectiles (DESIGN §6.3 step 5), so anything this engine
   * still has in flight is by definition stale: the authority has already decided what
   * that shell did, and the snapshot *is* that decision. Left alone, a shell fired a
   * tick late here keeps flying through `ending` and explodes a second time, damaging
   * a mobile the authority left alive — a difference that survives until the next
   * `turnEnd` and can kill a mobile locally that is still standing on the server.
   *
   * The exception is a snapshot taken *during* `resolving`, which is a shot the
   * authority has not finished yet: there the local projectiles are the best picture of
   * it anybody has, and the turn's own end will reconcile them.
   */
  if (state.phase !== 'resolving') {
    state.projectiles.length = 0;
    state.pendingSpawns.length = 0;
    state.turnEffects.length = 0;
  }

  // Mobiles the snapshot did not mention (a seat added later, a malformed message) are
  // snapped too, so the whole state sits on the grid the authority is on.
  quantiseState(state);
}
