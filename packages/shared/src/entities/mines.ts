/**
 * Walking mines (DESIGN §3, §7 item 8) — raon's S2 and SS.
 *
 * A mine is the one entity that outlives the turn that made it, so it does **not** live
 * in `turnEffects` (the resolving watchdog empties that list, DESIGN §7 item 34): it
 * lives in `MatchState.mines`, is carried by the snapshot and the state hash, and moves
 * on a turn hook rather than per tick.
 *
 * What happens per turn, in this order (all of it deterministic, no PRNG draws):
 *
 * 1. `onTurnStart` — every mine ages by one turn and the expired ones vanish; the
 *    survivors each walk up to `speed` px toward the nearest living enemy, following
 *    the terrain surface with the same step-up / walk-down rules a mobile uses, and
 *    emit `mineMove`; then any mine with an enemy inside its `triggerRadius` detonates,
 *    chaining into every other mine within `radius` of the blast.
 * 2. `onTurnEnd` — a mine whose ground has been blown out from under it detonates
 *    (see {@link minesShakenLoose}).
 *
 * Group 2 (Phase 4) owns this file.
 */
import { constants } from '../data/constants.js';
import { q8, fromQ8 } from '../math/fixed.js';
import { registerTurnHook } from '../rules/turn.js';
import { NO_GROUND } from '../terrain/terrain.js';
import type { Terrain } from '../terrain/terrain.js';
import type { DamageType } from '../data/damageTable.js';
import type { BehaviourContext } from './behaviours/registry.js';
import type { ProjectileDef } from './projectile.js';
import type { MobileState } from './mobile.js';
import type { MatchState } from '../match/match.js';

/**
 * One mine. Every field is a number except `sprite`, which is a sprite *key* the
 * renderer resolves — so the whole record is snapshot- and hash-safe.
 */
export interface MineState {
  /** Unique within the match; `MatchState.nextMineId` hands these out. */
  id: number;
  x: number;
  y: number;
  ownerSeat: number;
  /** Damage the mine itself can take before it detonates. */
  hp: number;
  /** An explosion within this distance detonates the mine (DESIGN §3). */
  radius: number;
  /** An enemy mobile within this distance detonates the mine. */
  triggerRadius: number;
  /** Px the mine walks per turn, toward the nearest enemy along the surface. */
  speed: number;
  /**
   * Tallest rise, in px, the mine can step up — a mobile's `maxStep` rule, but per
   * mine, because a mine has to be able to climb out of the crater its own delivery
   * charge dug (and out of everyone else's). A rise taller than this stops the walk.
   */
  climb: number;
  /** Turns left before it expires harmlessly. */
  ttlTurns: number;
  /** Damage at the centre of its explosion. */
  damage: number;
  /** Linear falloff to 0 at this distance. */
  damageRadius: number;
  /** Terrain hole it leaves. */
  carveRadius: number;
  /** Sprite key for the renderer. */
  sprite: string;
}

/** Everything but `id`, which the reducer assigns in {@link BehaviourContext.addMine}. */
export type MineSpec = Partial<Omit<MineState, 'id'>> & { x: number; y: number; ownerSeat: number };

/**
 * Damage type of every mine blast. It is not a `MineState` field on purpose: a mine is
 * raon's (DESIGN §3 lists no other source), and giving the record a seventh tunable
 * would put a string on the wire that no shot ever varies. Change it here if a second
 * mobile ever drops mines of its own kind.
 */
const MINE_DAMAGE_TYPE: DamageType = 'explosive';

/**
 * Build a mine, filling anything the caller left out from `constants.mine`. A
 * `mineDrop` shot passes its own numbers from `ProjectileDef.params` (DESIGN §2.5:
 * behaviour tunables are data), so the defaults here are only a floor.
 */
export function createMine(spec: MineSpec): MineState {
  const d = constants.mine;
  return {
    id: 0,
    x: spec.x,
    y: spec.y,
    ownerSeat: spec.ownerSeat,
    hp: spec.hp ?? d.hp,
    radius: spec.radius ?? d.radius,
    triggerRadius: spec.triggerRadius ?? d.triggerRadius,
    speed: spec.speed ?? d.walkPxPerTurn,
    climb: spec.climb ?? d.maxStep,
    ttlTurns: spec.ttlTurns ?? d.ttlTurns,
    damage: spec.damage ?? d.damage,
    damageRadius: spec.damageRadius ?? d.damageRadius,
    carveRadius: spec.carveRadius ?? d.carveRadius,
    sprite: spec.sprite ?? 'mine',
  };
}

// --------------------------------------------------------------------------
// Hash and snapshot
// --------------------------------------------------------------------------

/** A mine on the wire. The positions are q8 like every other snapshot number. */
export interface MineSnapshot {
  id: number;
  x: number;
  y: number;
  ownerSeat: number;
  hp: number;
  radius: number;
  triggerRadius: number;
  speed: number;
  climb: number;
  ttlTurns: number;
  damage: number;
  damageRadius: number;
  carveRadius: number;
  sprite: string;
}

export function snapshotMines(mines: MineState[]): MineSnapshot[] {
  const out: MineSnapshot[] = [];
  for (let i = 0; i < mines.length; i++) {
    const m = mines[i];
    if (!m) continue;
    out.push({
      id: m.id,
      x: q8(m.x),
      y: q8(m.y),
      ownerSeat: m.ownerSeat,
      hp: q8(m.hp),
      radius: m.radius,
      triggerRadius: m.triggerRadius,
      speed: m.speed,
      climb: m.climb,
      ttlTurns: m.ttlTurns,
      damage: m.damage,
      damageRadius: m.damageRadius,
      carveRadius: m.carveRadius,
      sprite: m.sprite,
    });
  }
  return out;
}

export function minesFromSnapshot(snap: MineSnapshot[] | undefined): MineState[] {
  const out: MineState[] = [];
  if (!snap) return out;
  for (let i = 0; i < snap.length; i++) {
    const s = snap[i];
    if (!s) continue;
    out.push({
      id: s.id,
      x: fromQ8(s.x),
      y: fromQ8(s.y),
      ownerSeat: s.ownerSeat,
      hp: fromQ8(s.hp),
      radius: s.radius,
      triggerRadius: s.triggerRadius,
      speed: s.speed,
      climb: s.climb ?? constants.mine.maxStep,
      ttlTurns: s.ttlTurns,
      damage: s.damage,
      damageRadius: s.damageRadius,
      carveRadius: s.carveRadius,
      sprite: s.sprite,
    });
  }
  return out;
}

/** Snap a mine's floats onto the q8 grid, so a reconcile converges (see snapshot.ts). */
export function quantiseMines(mines: MineState[]): void {
  for (let i = 0; i < mines.length; i++) {
    const m = mines[i];
    if (!m) continue;
    m.x = fromQ8(q8(m.x));
    m.y = fromQ8(q8(m.y));
    m.hp = fromQ8(q8(m.hp));
  }
}

/**
 * Mix the mines into a state hash, in list order (which is spawn order — never sorted,
 * never keyed by an object). Called by `match/snapshot.ts`.
 */
export function hashMines(
  mix: (h: number, value: number) => number,
  h: number,
  mines: MineState[],
): number {
  let out = mix(h, mines.length);
  for (let i = 0; i < mines.length; i++) {
    const m = mines[i];
    if (!m) continue;
    out = mix(out, m.id);
    out = mix(out, q8(m.x));
    out = mix(out, q8(m.y));
    out = mix(out, q8(m.hp));
    out = mix(out, m.ownerSeat);
    out = mix(out, m.ttlTurns);
  }
  return out;
}

// --------------------------------------------------------------------------
// Geometry helpers
// --------------------------------------------------------------------------

/** The projectile def a mine's own blast is resolved with (falloff, table, shields). */
export function mineBlastDef(mine: MineState): ProjectileDef {
  return {
    speed: 0,
    gravity: 0,
    windFactor: 0,
    radius: 1,
    carveRadius: mine.carveRadius,
    damage: mine.damage,
    damageRadius: mine.damageRadius,
    damageType: MINE_DAMAGE_TYPE,
    sprite: mine.sprite,
  };
}

/** Centre of a mobile's hull — what a mine measures its distance to. */
function mobileCentreY(m: MobileState, ctx: BehaviourContext): number {
  const def = ctx.defOf(m.seat);
  return def ? m.y - def.footprint.h / 2 : m.y;
}

function distanceTo(mine: MineState, m: MobileState, ctx: BehaviourContext): number {
  const dx = m.x - mine.x;
  const dy = mobileCentreY(m, ctx) - mine.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Team of the seat that dropped the mine, if that mobile is still in the world. */
function teamOfSeat(ctx: BehaviourContext, seat: number): string | undefined {
  for (let i = 0; i < ctx.mobiles.length; i++) {
    const m = ctx.mobiles[i];
    if (m && m.seat === seat) return m.team;
  }
  return undefined;
}

/** Is this mobile an enemy of the mine's owner? */
function isEnemy(mine: MineState, m: MobileState, ownerTeam: string | undefined): boolean {
  if (!m.alive) return false;
  if (m.seat === mine.ownerSeat) return false;
  if (ownerTeam === undefined) return true;
  return m.team !== ownerTeam;
}

/**
 * The nearest living enemy of a mine, by horizontal distance (a mine walks along the
 * ground, so the column it has to reach is what matters). Ties go to the lower seat,
 * because `ctx.mobiles` is in seat order and the comparison is strict.
 */
export function nearestEnemy(mine: MineState, ctx: BehaviourContext): MobileState | undefined {
  const ownerTeam = teamOfSeat(ctx, mine.ownerSeat);
  let best: MobileState | undefined;
  let bestDist = 0;
  for (let i = 0; i < ctx.mobiles.length; i++) {
    const m = ctx.mobiles[i];
    if (!m || !isEnemy(mine, m, ownerTeam)) continue;
    const dist = Math.abs(m.x - mine.x);
    if (!best || dist < bestDist) {
      best = m;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Ground row a mine standing at column `x` would rest on, probing from `climb` px above
 * its current row downwards, exactly as `entities/mobile.ts` does for a walk: a rise
 * taller than the mine's own `climb` blocks the step, a drop inside the probe range is
 * walked down.
 */
function groundForMineStep(terrain: Terrain, x: number, y: number, climb: number): number {
  const probeTop = Math.floor(y) - climb;
  if (terrain.isSolid(x, probeTop)) return NO_GROUND;
  const range = climb + constants.mobile.surfaceProbePx;
  for (let probe = probeTop + 1; probe <= probeTop + range; probe++) {
    if (terrain.isSolid(x, probe)) return probe;
  }
  return NO_GROUND;
}

/** Is there still ground under this mine, or has something blown it out? */
export function mineIsSupported(mine: MineState, terrain: Terrain): boolean {
  const from = Math.floor(mine.y) - constants.mine.stepPx;
  const range = constants.mine.stepPx * 2 + 1;
  return terrain.groundBelow(mine.x, from, range) !== NO_GROUND;
}

/**
 * Put a freshly dropped mine on the ground under `(x, y)`. Returns false when there is
 * nothing below it inside the map, which is the caller's cue not to drop one at all.
 */
export function settleMineOnGround(mine: MineState, terrain: Terrain): boolean {
  const ground = terrain.groundBelow(mine.x, mine.y, terrain.height);
  if (ground === NO_GROUND) return false;
  mine.y = ground;
  return true;
}

// --------------------------------------------------------------------------
// Walking and detonating
// --------------------------------------------------------------------------

/**
 * Walk one mine toward its nearest enemy, `constants.mine.stepPx` at a time, up to
 * `mine.speed` px. Returns true when it moved (so the caller emits one `mineMove`).
 * A wall it cannot climb stops it where it stands; a drop inside the probe range is
 * walked down, which is what keeps a mine on the surface of a cratered map.
 */
function walkMine(mine: MineState, ctx: BehaviourContext): boolean {
  const target = nearestEnemy(mine, ctx);
  if (!target) return false;
  const dir = target.x > mine.x ? 1 : target.x < mine.x ? -1 : 0;
  if (dir === 0) return false;

  const terrain = ctx.terrain;
  const step = constants.mine.stepPx;
  let remaining = mine.speed;
  let moved = false;
  while (remaining >= step) {
    if (distanceTo(mine, target, ctx) <= mine.triggerRadius) break;
    const nx = mine.x + dir * step;
    if (nx < 0 || nx > terrain.width - 1) break;
    const ny = groundForMineStep(terrain, nx, mine.y, mine.climb);
    if (ny === NO_GROUND) break;
    mine.x = nx;
    mine.y = ny;
    remaining -= step;
    moved = true;
  }
  return moved;
}

/**
 * Blow a mine up: carve, damage with its own falloff through the ordinary damage path,
 * emit `mineExplode`, and chain into every other mine whose `radius` covers the blast.
 * `gone` collects the ids that have already gone off, so a chain terminates.
 */
/**
 * The mines that survive a pass: not in this pass's `gone` set and not spent. The `hp`
 * half matters because a blast can reach {@link detonateMinesNear} from inside another
 * pass's chain, with its own `gone` set — the spent mine has to drop out of the list
 * whichever pass finishes last.
 */
function keptMines(all: MineState[], gone: Set<number>): MineState[] {
  return all.filter((m) => !gone.has(m.id) && m.hp > 0);
}

function detonateMine(
  mine: MineState,
  ctx: BehaviourContext,
  all: MineState[],
  gone: Set<number>,
): void {
  if (gone.has(mine.id) || mine.hp <= 0) return;
  gone.add(mine.id);
  // Spent before it damages anything. The blast resolves through `ctx.damageArea`, which
  // triggers every mine inside the blast (reducer `makeContext`), and a mine is inside
  // its own radius — so "hp 0 means already gone off" is what stops it detonating itself
  // a second time through a chain that started somewhere else. `hp` is hashed and
  // snapshotted (DESIGN §2.1), so both engines agree on which mines are spent.
  mine.hp = 0;
  const blast = mineBlastDef(mine);
  ctx.emit({ t: 'mineExplode', id: mine.id, x: mine.x, y: mine.y });
  // Also an ordinary `explosion`, so the client draws a blast where the mine was: the
  // renderer knows explosions and would otherwise show a silent hole (DESIGN §8).
  ctx.emit({
    t: 'explosion',
    x: mine.x,
    y: mine.y,
    radius: blast.damageRadius,
    carveRadius: blast.carveRadius,
    damageType: blast.damageType,
    ownerSeat: mine.ownerSeat,
  });
  ctx.carve(mine.x, mine.y, mine.carveRadius);
  ctx.damageArea(mine.x, mine.y, blast, mine.ownerSeat);
  for (let i = 0; i < all.length; i++) {
    const other = all[i];
    if (!other || gone.has(other.id) || other.hp <= 0) continue;
    const dx = other.x - mine.x;
    const dy = other.y - mine.y;
    if (Math.sqrt(dx * dx + dy * dy) <= other.radius) detonateMine(other, ctx, all, gone);
  }
}

/**
 * Detonate every mine within `radius` of a point (DESIGN §3: "Any explosion within its
 * `radius` detonates it"). The reducer calls this at the end of `makeContext().damageArea`
 * and at the foot of a `beamStrike`, which is every blast in the game — the default
 * explode, a bolt, a satellite beam, a sword, another mine — behind a re-entry latch,
 * because a mine is inside its own radius. {@link minesShakenLoose} is the fallback for
 * a mine left hanging by a carve that was not a blast.
 */
export function detonateMinesNear(state: MatchState, ctx: BehaviourContext, x: number, y: number): void {
  if (state.mines.length === 0) return;
  const gone = new Set<number>();
  const all = state.mines;
  for (let i = 0; i < all.length; i++) {
    const mine = all[i];
    if (!mine || gone.has(mine.id) || mine.hp <= 0) continue;
    const dx = mine.x - x;
    const dy = mine.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= mine.radius) detonateMine(mine, ctx, all, gone);
  }
  if (gone.size > 0) state.mines = keptMines(all, gone);
}

/**
 * Turn end: detonate every mine the shot dug out from under.
 *
 * The blast rule itself is {@link detonateMinesNear}, which the reducer now calls for
 * every explosion. This hook is the fallback for the rest: a mine whose ground was taken
 * by a carve that was not a blast (a burrow's tunnel, a beam's column) is left standing
 * in mid-air, and a mine in mid-air has by definition been dug out from under. It is
 * checked at turn end, so the mine goes off in the turn that uncovered it.
 */
export function minesShakenLoose(state: MatchState, ctx: BehaviourContext): void {
  if (state.mines.length === 0) return;
  const gone = new Set<number>();
  const all = state.mines;
  for (let i = 0; i < all.length; i++) {
    const mine = all[i];
    if (!mine || gone.has(mine.id) || mine.hp <= 0) continue;
    if (mineIsSupported(mine, ctx.terrain)) continue;
    detonateMine(mine, ctx, all, gone);
  }
  if (gone.size > 0) state.mines = keptMines(all, gone);
}

// --------------------------------------------------------------------------
// The turn hook
// --------------------------------------------------------------------------

/** Key of the mines' turn hook; hooks run in sorted key order (`rules/turn.ts`). */
export const MINE_TURN_HOOK = 'mines';

/**
 * Turn start: age, walk, trigger (DESIGN §3, §7 item 8).
 *
 * Every mine walks, whoever dropped it — one rule, and it keeps the creeping-threat
 * feel. The list is walked in order and never sorted, and nothing here draws from
 * `ctx.rng`, so two engines stepping the same turn move the same mines the same way.
 */
export function stepMinesTurnStart(state: MatchState, ctx: BehaviourContext): void {
  if (state.mines.length === 0) return;
  const gone = new Set<number>();
  const all = state.mines;

  // --- age and walk -------------------------------------------------------
  for (let i = 0; i < all.length; i++) {
    const mine = all[i];
    if (!mine) continue;
    mine.ttlTurns--;
    if (mine.ttlTurns <= 0 || mine.hp <= 0) {
      gone.add(mine.id);
      continue;
    }
    if (walkMine(mine, ctx)) {
      ctx.emit({ t: 'mineMove', id: mine.id, x: mine.x, y: mine.y });
    }
    if (mine.y > ctx.bounds.height + constants.mobile.deathBelowMapPx) gone.add(mine.id);
  }

  // Expired and fallen mines leave the list *before* anything triggers. A blast reaches
  // the other mines through `ctx.damageArea` -> `detonateMinesNear`, which walks
  // `state.mines` with its own `gone` set; one still listed there would go off on the
  // very turn it was supposed to vanish.
  if (gone.size > 0) state.mines = keptMines(all, gone);
  const live = state.mines;
  const fired = new Set<number>();

  // --- trigger ------------------------------------------------------------
  for (let i = 0; i < live.length; i++) {
    const mine = live[i];
    if (!mine || fired.has(mine.id) || mine.hp <= 0) continue;
    const ownerTeam = teamOfSeat(ctx, mine.ownerSeat);
    let triggered = false;
    for (let j = 0; j < ctx.mobiles.length && !triggered; j++) {
      const m = ctx.mobiles[j];
      if (!m || !isEnemy(mine, m, ownerTeam)) continue;
      if (distanceTo(mine, m, ctx) <= mine.triggerRadius) triggered = true;
    }
    if (triggered) detonateMine(mine, ctx, live, fired);
  }

  if (fired.size > 0) state.mines = keptMines(live, fired);
}

registerTurnHook(MINE_TURN_HOOK, {
  onTurnStart: stepMinesTurnStart,
  onTurnEnd: minesShakenLoose,
});
