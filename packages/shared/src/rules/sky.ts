/**
 * Sky events (DESIGN §5): Thor, Tornado and Force.
 *
 * One event (or none) is rolled at match start and lives in `MatchState.sky`. Weather
 * then comes and goes: an event lasts `weather.minTurns`..`maxTurns` completed turns,
 * the sky clears, and every turn that ends under a clear sky may bring a new one
 * ({@link advanceWeather}). This module owns everything that state does:
 *
 * - **Thor** is a satellite at the top of the map. Every explosion that goes off within
 *   `thor.triggerRadius` of an enemy of the blast's owner calls a beam down on the
 *   impact point for `thor.baseDamage * level`, and the satellite gains a level every
 *   `thor.levelEveryHits` strikes up to `thor.maxLevel`.
 * - **Tornado** is a vertical column at `sky.x ± tornado.halfWidth`. The first time a
 *   projectile enters it, it is captured, carried `tornado.liftPx` up over
 *   `tornado.holdTicks`, and released at the speed it came in with, rotated
 *   `±tornado.exitAngleDeg` from straight up (the sign is the only PRNG draw a sky
 *   event makes during a match).
 * - **Force** is a horizontal band. A projectile that crosses it is flagged, and its
 *   explosion deals `force.multiplier` times the damage.
 *
 * Determinism (DESIGN §2.1): the placement is drawn from its own stream seeded off the
 * match seed rather than from `state.rng`, so `createMatch` leaves the match stream at
 * exactly the same position whatever was rolled (DESIGN §7 item 39 requires that, and
 * an engine that is told the event only after `createMatch` returns still lands on the
 * same column). The exit sign *is* drawn from the match stream, because by then every
 * engine is running the same sequence of sub-steps in the same order — and so is the
 * turn-end weather roll, which every engine runs in the same `finishTurn`.
 */
import { sky } from '../data/sky.js';
import type { SkyEventId } from '../data/sky.js';
import type { SimEvent } from '../match/events.js';
import { clamp, snapQ8 } from '../math/fixed.js';
import { Prng } from '../math/prng.js';
import { cosDeg, sinDeg } from '../math/trig.js';
import type { BehaviourContext } from '../entities/behaviours/registry.js';
import type { ProjectileDef, ProjectileState } from '../entities/projectile.js';
import type { MatchState } from '../match/match.js';

/**
 * The rolled event and everything about it that changes: Thor's level and strike
 * count, the tornado's column, the Force band's edges.
 *
 * Every field is numeric (plus the id, which hashes through `skyEventIndex`) so the
 * whole thing goes into the state hash and the `turnEnd` snapshot unchanged.
 */
export interface SkyState {
  kind: SkyEventId;
  /** Tornado column centre, px. 0 when the match has no tornado. */
  x: number;
  /** Force band top / bottom, px. 0 when the match has no Force band. */
  top: number;
  bottom: number;
  /** Thor's level, 1..`sky.thor.maxLevel`. 0 when the match has no Thor. */
  level: number;
  /** Thor strikes triggered so far; every `levelEveryHits` of them is a level. */
  hits: number;
  /**
   * Completed turns this event has left before the sky clears (DESIGN §5). 0 under a
   * clear sky, and 0 for an event that never leaves (a match with `skyStatic`).
   */
  turnsLeft: number;
}

/** Keeps the placement stream clear of the terrain stream and the match stream. */
const SKY_STREAM_SALT = 0x51e5dd17;

/** Map bounds a sky event is placed inside. */
export interface SkyBounds {
  width: number;
  height: number;
}

export function noSkyState(): SkyState {
  return { kind: 'none', x: 0, top: 0, bottom: 0, level: 0, hits: 0, turnsLeft: 0 };
}

/**
 * Walk a drawn column to the nearest x that clears every spawn (DESIGN §7 item 129).
 *
 * The draw is kept exactly as it was — this only slides the result along the same
 * allowed range in whole pixels, right first then left, so it stays a pure function of
 * (kind, seed, map, seats) and the salted stream is consumed identically whatever the
 * roster looks like. A range with nowhere legal in it keeps the drawn column.
 */
function clearOfSpawns(x: number, minX: number, maxX: number, spawnXs: number[]): number {
  const clearance = sky.placement.tornadoSpawnClearancePx;
  const free = (cx: number): boolean => {
    for (let i = 0; i < spawnXs.length; i++) {
      const s = spawnXs[i];
      if (s === undefined) continue;
      if (Math.abs(cx - s) < clearance) return false;
    }
    return true;
  };
  if (free(x)) return x;
  const span = Math.floor(Math.max(0, maxX - minX)) + 1;
  for (let step = 1; step <= span; step++) {
    const right = x + step;
    if (right <= maxX && free(right)) return right;
    const left = x - step;
    if (left >= minX && free(left)) return left;
  }
  return x;
}

/**
 * Build the sky state for an event: a pure function of (kind, seed, map, spawn xs,
 * lasting), so every engine that is told the same rolled id lands on the same column,
 * the same band and the same duration without drawing from the match PRNG.
 *
 * `spawnXs` are the columns to keep the tornado off — the seats' starting columns at
 * match start, the living mobiles' columns for weather that arrives later. They only
 * move the tornado, and only along the range it was already drawn from.
 *
 * `lasting` gives the event a duration (`weather.minTurns`..`maxTurns`), drawn after
 * the placement so the column is the same either way; without it the event stays for
 * the whole match (a pinned sky, DESIGN §7 item 163).
 */
export function createSkyState(
  kind: SkyEventId,
  seed: number,
  bounds: SkyBounds,
  spawnXs: number[] = [],
  lasting = false,
): SkyState {
  const state = noSkyState();
  state.kind = kind;
  const rng = Prng.seed((seed ^ SKY_STREAM_SALT) >>> 0);
  if (kind === 'thor') {
    state.level = clamp(sky.thor.startLevel, 1, sky.thor.maxLevel);
  } else if (kind === 'tornado') {
    const fraction = rng.nextRange(
      sky.placement.tornadoMinXFraction,
      sky.placement.tornadoMaxXFraction,
    );
    // Snapped to the hash grid so that the column a client computes and the column the
    // server computes are the same number, not the same number to within a float.
    const minX = snapQ8(bounds.width * sky.placement.tornadoMinXFraction);
    const maxX = snapQ8(bounds.width * sky.placement.tornadoMaxXFraction);
    state.x = clearOfSpawns(snapQ8(bounds.width * fraction), minX, maxX, spawnXs);
  } else if (kind === 'force') {
    state.top = snapQ8(bounds.height * sky.force.topFraction);
    state.bottom = snapQ8(bounds.height * sky.force.bottomFraction);
  }
  if (lasting && kind !== 'none') {
    state.turnsLeft = rng.nextInt(sky.weather.minTurns, sky.weather.maxTurns);
  }
  return state;
}

/** Pick an event off `sky.rollTable` without its `none` row: what arriving weather is. */
export function rollWeatherEvent(rng: Prng): SkyEventId {
  let total = 0;
  for (let i = 0; i < sky.rollTable.length; i++) {
    const entry = sky.rollTable[i];
    if (entry && entry.id !== 'none') total += entry.weight;
  }
  let roll = rng.nextFloat() * total;
  let last: SkyEventId = 'none';
  for (let i = 0; i < sky.rollTable.length; i++) {
    const entry = sky.rollTable[i];
    if (!entry || entry.id === 'none') continue;
    last = entry.id;
    roll -= entry.weight;
    if (roll < 0) return entry.id;
  }
  return last;
}

/**
 * The turn-end weather step (DESIGN §5), run from `finishTurn` on every engine.
 *
 * An event counts down one completed turn; on its last one the sky clears. A turn that
 * ends under a clear sky rolls `weather.arriveChance` for a new event, which is placed
 * off a seed drawn from the match stream and kept clear of the living mobiles. Both
 * changes are announced as `skyChange`. A pinned sky (`state.skyStatic`) never moves.
 *
 * The draws are taken in the same order on every engine — one for the arrival, then
 * one for the kind and one for the placement seed only when it arrives — which is all
 * determinism asks of the match stream here.
 */
export function advanceWeather(state: MatchState, events: SimEvent[]): void {
  if (state.skyStatic) return;
  const s = state.sky;
  if (s.kind !== 'none') {
    s.turnsLeft = Math.max(0, s.turnsLeft - 1);
    if (s.turnsLeft > 0) return;
    const previous = s.kind;
    state.sky = noSkyState();
    events.push({ t: 'skyChange', kind: 'none', previous, turnsLeft: 0 });
    return;
  }
  if (state.rng.nextFloat() >= sky.weather.arriveChance) return;
  const kind = rollWeatherEvent(state.rng);
  const seed = state.rng.nextU32();
  const clearOf: number[] = [];
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (m && m.alive) clearOf.push(m.x);
  }
  state.sky = createSkyState(
    kind,
    seed,
    { width: state.map.width, height: state.map.height },
    clearOf,
    true,
  );
  events.push({ t: 'skyChange', kind, previous: 'none', turnsLeft: state.sky.turnsLeft });
}

/**
 * Roll the match's sky event off `sky.rollTable` (DESIGN §5). Drawn from the *room's*
 * stream by the server (DESIGN §7 item 39); the sandbox rolls its own.
 */
export function rollSkyEvent(rng: Prng): SkyEventId {
  let total = 0;
  for (let i = 0; i < sky.rollTable.length; i++) total += sky.rollTable[i]?.weight ?? 0;
  if (total <= 0) return 'none';
  let roll = rng.nextFloat() * total;
  for (let i = 0; i < sky.rollTable.length; i++) {
    const entry = sky.rollTable[i];
    if (!entry) continue;
    roll -= entry.weight;
    if (roll < 0) return entry.id;
  }
  return 'none';
}

/**
 * The level a Thor strike uses when the caller has no match state to read one from.
 *
 * A behaviour only ever sees a {@link BehaviourContext}, never the `MatchState`. The
 * reducer therefore stamps the satellite's level onto every mark it schedules
 * (`data.skyThorLevel`, see `match/reducer.ts`), and this is the fallback for a call
 * that has neither: a level-1 satellite only the caller can trigger (DESIGN §7 item 9).
 */
export function defaultThorLevel(): number {
  return clamp(sky.thor.startLevel, 1, sky.thor.maxLevel);
}

/** Thor's current level for a match: the satellite's when there is one, else level 1. */
export function thorLevel(state: MatchState): number {
  const s = state.sky;
  if (s.kind !== 'thor') return defaultThorLevel();
  return clamp(s.level, 1, sky.thor.maxLevel);
}

/** The level `hits` triggered strikes have earned (DESIGN §5). */
export function thorLevelForHits(hits: number): number {
  const gained = Math.floor(hits / Math.max(1, sky.thor.levelEveryHits));
  return clamp(sky.thor.startLevel + gained, 1, sky.thor.maxLevel);
}

/** What {@link thorStrike} needs to know that is not on the context. */
export interface ThorStrikeOptions {
  /** 1..`sky.thor.maxLevel`. Damage scales linearly with it. */
  level?: number;
  /** Seat credited with the damage; defaults to the seat whose turn it is. */
  ownerSeat?: number;
  /** Overrides on the beam's projectile def (damage, carve radius, sprite). */
  def?: Partial<ProjectileDef>;
}

/**
 * Fire Thor's laser at a point: a vertical beam from the top of the map down to
 * (x, y), dealing `sky.thor.baseDamage * level` (DESIGN §5).
 *
 * It is a thin wrapper over {@link BehaviourContext.beamStrike}, so a behaviour that
 * calls it gets the carve, the `beam` event and the falloff damage for free. A caller
 * that names its own `carveRadius` (aduka's barrage) gets a column of exactly that
 * width; the satellite's own strike uses `sky.thor.beamWidth`.
 */
export function thorStrike(
  ctx: BehaviourContext,
  x: number,
  y: number,
  options: ThorStrikeOptions = {},
): void {
  const level = clamp(options.level ?? defaultThorLevel(), 1, sky.thor.maxLevel);
  const radius = sky.thor.carveRadius;
  const base: ProjectileDef = {
    speed: 0,
    gravity: 0,
    windFactor: 0,
    radius: 1,
    carveRadius: radius,
    damage: sky.thor.baseDamage * level,
    damageRadius: radius * 3,
    damageType: 'energy',
    sprite: 'thorBeam',
  };
  const def: ProjectileDef = options.def ? { ...base, ...options.def } : base;
  const width = options.def?.carveRadius === undefined ? sky.thor.beamWidth : def.carveRadius * 2;
  ctx.beamStrike(x, y, 0, width, def, options.ownerSeat ?? ctx.activeSeat);
}

/**
 * Did an explosion at (x, y) land close enough to an enemy of `ownerSeat` to wake the
 * satellite? (DESIGN §5: "any explosion within `thor.triggerRadius` of an enemy
 * mobile".) Own team and the owner itself never count, so a shot that goes off in a
 * friend's face does not call a free beam down on it.
 */
function nearEnemy(state: MatchState, ctx: BehaviourContext, x: number, y: number, ownerSeat: number): boolean {
  let ownerTeam: string | undefined;
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (m && m.seat === ownerSeat) {
      ownerTeam = m.team;
      break;
    }
  }
  const radius = sky.thor.triggerRadius;
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m || !m.alive || m.seat === ownerSeat) continue;
    if (ownerTeam !== undefined && m.team === ownerTeam) continue;
    const def = ctx.defOf(m.seat);
    const cy = def ? m.y - def.footprint.h / 2 : m.y;
    const dx = m.x - x;
    const dy = cy - y;
    if (dx * dx + dy * dy <= radius * radius) return true;
  }
  return false;
}

/**
 * The hook every explosion runs through (`match/reducer.ts` `damageArea`). Fires one
 * beam at the impact point when the match has a Thor and the blast went off next to an
 * enemy, counts the strike and levels the satellite up.
 *
 * Returns true when a beam was fired, which is what the reducer's re-entry latch keys
 * off: the beam damages through `beamStrike`, which can set a mine off, whose blast is
 * another explosion.
 */
export function thorOnExplosion(
  state: MatchState,
  ctx: BehaviourContext,
  x: number,
  y: number,
  ownerSeat: number,
): boolean {
  const s = state.sky;
  if (s.kind !== 'thor') return false;
  if (!nearEnemy(state, ctx, x, y, ownerSeat)) return false;

  const level = clamp(s.level, 1, sky.thor.maxLevel);
  ctx.emit({ t: 'skyStrike', kind: 'thor', x, y, level, ownerSeat });
  thorStrike(ctx, x, y, { level, ownerSeat });

  s.hits++;
  const next = thorLevelForHits(s.hits);
  if (next > s.level) {
    s.level = next;
    ctx.emit({ t: 'skyLevelUp', kind: 'thor', level: next, hits: s.hits });
  }
  return true;
}

/**
 * Explosion damage multiplier for a projectile that crossed the Force band (DESIGN §5,
 * §2.6 `forceMultiplier`). Keyed off the projectile's own flag, so a shell that was
 * never in the band is untouched even when the band is up.
 */
export function forceDamageMultiplier(s: SkyState, p: ProjectileState): number {
  if (s.kind !== 'force') return 1;
  return forceMultiplierForFlag(p.data.force);
}

/**
 * The same multiplier for a payload that outlives the shell that earned it: a bolt, a
 * satellite beam, a Thor call, a sword, a frost bloom (DESIGN §7 item 130). The flag is
 * only ever set while a Force band is up, so the flag alone is the whole question.
 */
export function forceMultiplierForFlag(flag: number | undefined): number {
  return flag === 1 ? sky.force.multiplier : 1;
}

/** Is this y inside the Force band? */
export function insideForceBand(s: SkyState, y: number): boolean {
  return s.kind === 'force' && y >= s.top && y <= s.bottom;
}

/** Is this x inside the tornado's column? */
export function insideTornado(s: SkyState, x: number): boolean {
  return s.kind === 'tornado' && Math.abs(x - s.x) <= sky.tornado.halfWidth;
}

/**
 * One sub-step of the sky's effect on a projectile, called from `stepProjectile`
 * *before* the ordinary integration (DESIGN §5).
 *
 * Returns true when the tornado has taken the projectile over for this sub-step: it is
 * being carried up the column, so the caller skips wind, gravity, the segment walk and
 * the behaviour's own `onTick` — a captured shell is held, not flying.
 *
 * `dt` is the sub-step in ticks (`1 / constants.subSteps`).
 */
export function stepProjectileSky(
  p: ProjectileState,
  ctx: BehaviourContext,
  s: SkyState,
  dt: number,
): boolean {
  if (s.kind === 'force') {
    // Flagged on the way through, once, so the explosion can ask about it later.
    if (p.data.force !== 1 && insideForceBand(s, p.y)) {
      p.data.force = 1;
      ctx.emit({ t: 'skyForce', id: p.id, ownerSeat: p.ownerSeat, x: p.x, y: p.y });
    }
    return false;
  }
  if (s.kind !== 'tornado') return false;

  if (p.data.tornadoHeld === 1) {
    const held = (p.data.tornadoTicks ?? 0) + dt;
    p.data.tornadoTicks = held;
    p.vx = 0;
    p.vy = 0;
    // Ride the column: the lift is spread evenly over `holdTicks`.
    p.x = s.x;
    const nextY = p.y - (sky.tornado.liftPx / Math.max(1, sky.tornado.holdTicks)) * dt;
    // The funnel does not drill: on a map with a roof (`cave`) the lift is taller than
    // the clearance, and a shell carried into the slab would be released inside rock
    // and burst in the ceiling. Stop under the rock and let it go from there — the
    // exit sign is still the next draw, so the PRNG order is untouched (§7 item 131).
    if (ctx.terrain.isSolid(s.x, nextY)) {
      releaseFromTornado(p, ctx);
      return true;
    }
    p.y = nextY;
    if (held >= sky.tornado.holdTicks) releaseFromTornado(p, ctx);
    return true;
  }

  // Once per projectile (DESIGN §5): a shell released out of the column must be able to
  // fly back across it without being swallowed again.
  if (p.data.tornadoDone === 1) return false;
  // The funnel stands in the map: a shot lobbed clean over the top of the world is
  // above it, not in it, and is left to come down where it was aimed.
  if (p.y < 0) return false;
  if (!insideTornado(s, p.x)) return false;

  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  p.data.tornadoHeld = 1;
  p.data.tornadoTicks = 0;
  p.data.tornadoSpeed = Math.max(speed, sky.tornado.minExitSpeed);
  p.vx = 0;
  p.vy = 0;
  ctx.emit({ t: 'tornadoCapture', id: p.id, ownerSeat: p.ownerSeat, x: p.x, y: p.y });
  return true;
}

/** Spit the projectile back out: same speed, `±exitAngleDeg` from straight up. */
function releaseFromTornado(p: ProjectileState, ctx: BehaviourContext): void {
  const speed = p.data.tornadoSpeed ?? sky.tornado.minExitSpeed;
  const sign = ctx.rng.nextSign();
  const angle = sky.tornado.exitAngleDeg * sign;
  // Straight up is (0, -1); the exit angle rotates it toward one side.
  p.vx = speed * sinDeg(angle);
  p.vy = -speed * cosDeg(angle);
  p.data.tornadoHeld = 0;
  p.data.tornadoDone = 1;
  p.data.tornadoTicks = 0;
  ctx.emit({
    t: 'tornadoRelease',
    id: p.id,
    ownerSeat: p.ownerSeat,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
  });
}
