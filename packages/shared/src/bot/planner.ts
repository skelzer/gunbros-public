/**
 * The practice bot's search (DESIGN §11, §7 items 187-189).
 *
 * The bot does not solve a ballistic equation: wind, terrain, tilt, the sky and every
 * mobile's odd shells (a boomerang, a mine layer, a satellite) are already written once,
 * in the simulation, and a second model of them would be wrong in a different way for
 * every mobile. Instead it fires candidate shots at a private copy of the match
 * (`cloneMatchState`) with the real `applyIntent` and `step`, lets each one resolve, and
 * scores what happened (`score.ts`). The copy owns its own terrain, PRNG and mobiles, so
 * nothing a candidate does can reach the live match — and because the copy's PRNG sits
 * exactly where the live one does, a shot whose behaviour draws from it resolves in the
 * plan exactly as it will when it is fired for real.
 *
 * The search is a generator that yields after every candidate. It has no clock: the
 * server's driver decides how many candidates fit in a tick (`bots.budgetMsPerTick`)
 * and when thinking is over, and a test can simply run it to the end.
 *
 * The bot may walk first (§7 item 190). Each walk — left or right, a few lengths — is
 * itself simulated on a copy with the real `move` intent and `step`, for an exact number
 * of ticks, then stopped and left to settle; the shots from there are fired at that
 * walked copy. The server's driver replays the walk tick for tick, so the live mobile
 * stops where the copy's did.
 *
 * Difficulty is not in here, beyond whether to look for a walk at all. Every bot runs
 * the same search; `chooseShot` then misses on purpose by the difficulty's error, drawn
 * from the bot's own PRNG (§7 item 188).
 */
import { bots } from '../data/bots.js';
import type { BotDifficultyDef } from '../data/bots.js';
import { getMobileDef } from '../data/mobiles.js';
import type { MobileDef, ShotSlot } from '../data/mobiles.js';
import { clamp, quantisePower } from '../math/fixed.js';
import type { Prng } from '../math/prng.js';
import { cloneMatchState } from '../match/clone.js';
import { mobileOfSeat } from '../match/match.js';
import type { MatchState } from '../match/match.js';
import { applyIntent, step } from '../match/reducer.js';
import { ssAvailable } from '../rules/delay.js';
import type { Terrain } from '../terrain/terrain.js';
import { blastPoints, scoreShot, vitalsOf } from './score.js';

/** A walk: hold `dir` for exactly `ticks` ticks, then stop (§7 item 190). */
export interface BotWalk {
  dir: -1 | 1;
  ticks: number;
}

/** A shot the bot can play: where it walks, which way it faces, the slot, barrel and bar. */
export interface BotShot {
  /** Null to fire from where it stands. */
  walk: BotWalk | null;
  facing: -1 | 1;
  shot: ShotSlot;
  /** Degrees relative to the hull, inside the mobile's own range. */
  relAngle: number;
  /** [0, 1], already quantised the way the server will quantise it. */
  power: number;
}

export interface ScoredShot extends BotShot {
  score: number;
}

/** The plan so far: every candidate tried, best first. */
export interface BotPlan {
  ranked: ScoredShot[];
  evaluated: number;
  done: boolean;
}

export interface PlanOptions {
  /** May the SS be tried? Only when the gauge is full as well (§7 item 188). */
  useSs: boolean;
  /** Look for a walk: never, only when nothing hits from here, or always (§7 item 190). */
  walk?: 'never' | 'whenStuck' | 'always';
  /** Overrides `bots.search.maxCandidates` (tests, measurements). */
  maxCandidates?: number;
}

/** One place the bot could fire from: the copy standing there, and how it got there. */
export interface BotPosition {
  walk: BotWalk | null;
  state: MatchState;
  x: number;
  /** Px walked, for the walking cost. */
  distance: number;
}

/** The phase a copy is stepped through to reach `active`, at most this many ticks. */
const MAX_TICKS_TO_ACTIVE = 240;

function linspace(min: number, max: number, count: number): number[] {
  if (count <= 1) return [(min + max) / 2];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(min + ((max - min) * i) / (count - 1));
  return out;
}

function walkKey(walk: BotWalk | null): string {
  return walk ? `${walk.dir}:${walk.ticks}` : 'stay';
}

function keyOf(c: BotShot): string {
  return `${walkKey(c.walk)}|${c.facing}|${c.shot}|${c.relAngle.toFixed(2)}|${c.power.toFixed(3)}`;
}

function byScore(a: ScoredShot, b: ScoredShot): number {
  return b.score - a.score;
}

/**
 * The directions worth facing: towards every living enemy. A mobile can only aim
 * forwards (every `angleMin..angleMax` is a forward range), so an enemy behind it is
 * out of reach until it turns — which the driver does with a `move` pair on one tick,
 * no step in between, so the mobile turns without walking (§7 item 190).
 */
export function facingsTowardEnemies(state: MatchState, seat: number): (-1 | 1)[] {
  const m = mobileOfSeat(state, seat);
  if (!m) return [1];
  let left = false;
  let right = false;
  for (let i = 0; i < state.mobiles.length; i++) {
    const e = state.mobiles[i];
    if (!e || !e.alive || e.team === m.team) continue;
    if (e.x < m.x) left = true;
    else if (e.x > m.x) right = true;
  }
  const out: (-1 | 1)[] = [];
  // The current facing first: if the search is cut short, what it did try needs no turn.
  if (m.facing === 1 ? right : left) out.push(m.facing);
  if (m.facing === 1 ? left : right) out.push(m.facing === 1 ? -1 : 1);
  if (out.length === 0) out.push(m.facing);
  return out;
}

/**
 * Walk `seat` on a copy of `base` exactly as the driver will on the live match: `move
 * dir` now, `ticks` steps, `move 0`, then `settleTicks` for the hull to land and its
 * tilt to catch up. Returns the walked copy, or null when the walk is not a place to
 * stand: the bot died, the turn left `active`, or it fell (airborne and more than
 * `maxDropPx` below its start — a ledge, a pit, the map's edge).
 */
export function simulateWalk(base: MatchState, seat: number, walk: BotWalk): MatchState | null {
  const w = bots.walk;
  const work = cloneMatchState(base);
  const m = mobileOfSeat(work, seat);
  if (!m || !m.alive) return null;
  const startY = m.y;
  applyIntent(work, { t: 'move', seat, dir: walk.dir });
  const fell = (): boolean => !m.grounded && m.y - startY > w.maxDropPx;
  for (let i = 0; i < walk.ticks; i++) {
    step(work);
    if (!m.alive || work.phase !== 'active' || fell()) return null;
  }
  applyIntent(work, { t: 'move', seat, dir: 0 });
  for (let i = 0; i < w.settleTicks || (!m.grounded && i < 240); i++) {
    step(work);
    if (!m.alive || work.phase !== 'active' || fell()) return null;
  }
  if (!m.grounded) return null;
  return work;
}

/**
 * Every place the bot could fire from this turn: where it stands, and each walk in
 * `bots.walk.fractions` of the gauge left, both ways, that ends somewhere safe and new.
 * A walk that ends where a shorter one did (a wall stopped it) is the shorter one.
 */
export function walkPositions(base: MatchState, seat: number): BotPosition[] {
  const gen = eachWalkPosition(base, seat);
  let next = gen.next();
  while (!next.done) next = gen.next();
  return next.value;
}

/**
 * {@link walkPositions}, yielding after every simulated walk: a walk is a couple of
 * hundred ticks, and six of them in one go would blow a tick's budget.
 */
function* eachWalkPosition(base: MatchState, seat: number): Generator<void, BotPosition[], void> {
  const m = mobileOfSeat(base, seat);
  if (!m) return [];
  const out: BotPosition[] = [{ walk: null, state: base, x: m.x, distance: 0 }];
  const def = getMobileDef(m.defId);
  if (m.moveGauge <= 0 || def.moveSpeed <= 0) return out;
  for (const dir of [-1, 1] as const) {
    for (const fraction of bots.walk.fractions) {
      const ticks = Math.ceil((m.moveGauge * fraction) / def.moveSpeed);
      if (ticks <= 0) continue;
      const walked = simulateWalk(base, seat, { dir, ticks });
      yield;
      if (!walked) break; // longer walks the same way only go further over the edge
      const wm = mobileOfSeat(walked, seat);
      if (!wm) continue;
      if (out.some((p) => Math.abs(p.x - wm.x) < bots.walk.samePlacePx)) continue;
      out.push({ walk: { dir, ticks }, state: walked, x: wm.x, distance: Math.abs(wm.x - m.x) });
    }
  }
  return out;
}

/**
 * Fire one candidate at a fresh copy of `base` and score it once the shot has resolved
 * (the copy's turn machine leaves `resolving`) or after `maxTicks`, whichever is first.
 * `base` is the copy standing where the shot is fired from — already walked there. The
 * walk itself is not simulated here; `walkPositions` did that once per position.
 * Returns null when the simulation refused the shot (an SS that is not ready, say).
 *
 * `scratch` is the terrain the copy is made in; it is overwritten every call.
 */
export function evaluateShot(
  base: MatchState,
  seat: number,
  shot: Omit<BotShot, 'walk'>,
  scratch?: Terrain,
  maxTicks: number = bots.search.maxTicksPerCandidate,
): number | null {
  const work = cloneMatchState(base, scratch);
  const m = mobileOfSeat(work, seat);
  if (!m || !m.alive) return null;
  // The copy is ours to write: a turn is a facing and nothing else (see
  // `facingsTowardEnemies`), so this is exactly the state the live mobile will be in.
  m.facing = shot.facing;
  const before = vitalsOf(work);
  const blasts: { x: number; y: number }[] = [];
  const fired = applyIntent(work, {
    t: 'fire',
    seat,
    shot: shot.shot,
    relAngle: shot.relAngle,
    power: shot.power,
  });
  if (!fired.some((e) => e.t === 'fire')) return null;
  blastPoints(fired, blasts);
  for (let tick = 0; tick < maxTicks && work.phase === 'resolving'; tick++) {
    blastPoints(step(work), blasts);
  }
  return scoreShot(before, work, seat, blasts);
}

/** The copy `planShot` and `refineShot` start from: `state`, walked on to `active`. */
function planBase(state: MatchState, seat: number): MatchState | null {
  const base = cloneMatchState(state);
  for (let i = 0; i < MAX_TICKS_TO_ACTIVE && base.phase === 'starting'; i++) step(base);
  const m = mobileOfSeat(base, seat);
  if (base.phase !== 'active' || base.activeSeat !== seat || !m || !m.alive) return null;
  return base;
}

/** The candidate bookkeeping both searches share. */
class Search {
  readonly plan: BotPlan = { ranked: [], evaluated: 0, done: false };
  private readonly seen = new Set<string>();
  private readonly scratch: Terrain;

  constructor(
    private readonly seat: number,
    private readonly def: MobileDef,
    base: MatchState,
  ) {
    this.scratch = base.terrain.clone();
  }

  /** Evaluate one candidate from `from` if it is new and under `limit`; true when run. */
  run(from: BotPosition, c: Omit<BotShot, 'walk'>, limit: number): boolean {
    if (this.plan.evaluated >= limit) return false;
    const shot: BotShot = {
      walk: from.walk,
      facing: c.facing,
      shot: c.shot,
      relAngle: clamp(c.relAngle, this.def.angleMin, this.def.angleMax),
      power: quantisePower(clamp(c.power, 0, 1)),
    };
    const key = keyOf(shot);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    const score = evaluateShot(from.state, this.seat, shot, this.scratch);
    this.plan.evaluated++;
    if (score === null) return true;
    this.plan.ranked.push({ ...shot, score: score - from.distance * bots.walk.costPerPx });
    this.plan.ranked.sort(byScore);
    return true;
  }

  /** Best score among the candidates fired from `position`, or -Infinity. */
  bestFrom(position: BotPosition): number {
    const key = walkKey(position.walk);
    for (const c of this.plan.ranked) if (walkKey(c.walk) === key) return c.score;
    return -Infinity;
  }
}

/**
 * Plan `seat`'s shot on `state`, which is never written. Yields the plan so far after
 * every candidate and returns the finished plan.
 *
 * 1. From where it stands: every slot it may fire × every facing towards an enemy × a
 *    grid of `coarseAngles` over the mobile's range and `coarsePowers` over
 *    [`minPower`, 1].
 * 2. The walks (`walkPositions`), unless `walk` says not to — or says `whenStuck` and
 *    step 1 found a hit: an S1 screen from each, then the full grid of step 1 from the
 *    `finalists` best that beat standing still.
 * 3. `refineRounds` passes around the `refineTop` best so far, each on a grid
 *    `refineShrink` times finer.
 *
 * Candidates are deduplicated and capped at `maxCandidates`, with the refinement's
 * share kept back. Deterministic: the same state gives the same plan.
 */
export function* planShot(
  state: MatchState,
  seat: number,
  options: PlanOptions,
): Generator<BotPlan, BotPlan, void> {
  const search = bots.search;
  const cap = options.maxCandidates ?? search.maxCandidates;
  // The refinement is where a hit becomes a direct hit, so the coarse passes may not
  // spend its share.
  const refineShare =
    search.refineRounds * search.refineTop * ((2 * search.refineRadius + 1) ** 2 - 1);
  const coarseCap = Math.max(1, cap - refineShare);

  const base = planBase(state, seat);
  const m = base ? mobileOfSeat(base, seat) : undefined;
  if (!base || !m) return { ranked: [], evaluated: 0, done: true };
  const def = getMobileDef(m.defId);
  const s = new Search(seat, def, base);
  const plan = s.plan;

  const slots: ShotSlot[] = ['s1', 's2'];
  if (options.useSs && ssAvailable(base, seat)) slots.push('ss');

  const coarse = function* (from: BotPosition): Generator<BotPlan, void, void> {
    for (const facing of facingsTowardEnemies(from.state, seat)) {
      for (const shot of slots) {
        for (const relAngle of linspace(def.angleMin, def.angleMax, search.coarseAngles)) {
          for (const power of linspace(search.minPower, 1, search.coarsePowers)) {
            if (s.run(from, { facing, shot, relAngle, power }, coarseCap)) yield plan;
          }
        }
      }
    }
  };

  // --- 1. from here -----------------------------------------------------------
  const stay: BotPosition = { walk: null, state: base, x: m.x, distance: 0 };
  const positionOf = new Map<string, BotPosition>([['stay', stay]]);
  yield* coarse(stay);

  // --- 2. from somewhere else ---------------------------------------------------
  const walk = options.walk ?? 'always';
  if (walk === 'always' || (walk === 'whenStuck' && s.bestFrom(stay) <= 0)) {
    const walking = eachWalkPosition(base, seat);
    let next = walking.next();
    while (!next.done) {
      yield plan;
      next = walking.next();
    }
    const positions = next.value.filter((p) => p.walk !== null);
    for (const p of positions) positionOf.set(walkKey(p.walk), p);
    const w = bots.walk;
    for (const from of positions) {
      for (const facing of facingsTowardEnemies(from.state, seat)) {
        for (const relAngle of linspace(def.angleMin, def.angleMax, w.screenAngles)) {
          for (const power of linspace(search.minPower, 1, w.screenPowers)) {
            if (s.run(from, { facing, shot: 's1', relAngle, power }, coarseCap)) yield plan;
          }
        }
      }
    }
    const here = s.bestFrom(stay);
    const finalists = positions
      .map((p) => ({ p, best: s.bestFrom(p) }))
      .filter((f) => f.best > here)
      .sort((a, b) => b.best - a.best)
      .slice(0, w.finalists);
    for (const f of finalists) yield* coarse(f.p);
  }

  // --- 3. refine ----------------------------------------------------------------
  const angleStep = (def.angleMax - def.angleMin) / Math.max(1, search.coarseAngles - 1);
  const powerStep = (1 - search.minPower) / Math.max(1, search.coarsePowers - 1);
  let aStep = angleStep;
  let pStep = powerStep;
  for (let round = 0; round < search.refineRounds; round++) {
    aStep /= search.refineShrink;
    pStep /= search.refineShrink;
    const centres = plan.ranked.slice(0, search.refineTop);
    for (const centre of centres) {
      const from = positionFor(centre.walk);
      if (!from) continue;
      for (let da = -search.refineRadius; da <= search.refineRadius; da++) {
        for (let dp = -search.refineRadius; dp <= search.refineRadius; dp++) {
          if (da === 0 && dp === 0) continue;
          const c = {
            facing: centre.facing,
            shot: centre.shot,
            relAngle: centre.relAngle + da * aStep,
            power: centre.power + dp * pStep,
          };
          if (s.run(from, c, cap)) yield plan;
        }
      }
    }
  }

  plan.done = true;
  return plan;

  /** The walked copy a candidate was fired from, rebuilt once if it was dropped. */
  function positionFor(walkOf: BotWalk | null): BotPosition | null {
    const key = walkKey(walkOf);
    const known = positionOf.get(key);
    if (known) return known;
    if (!walkOf || !base) return null;
    const walked = simulateWalk(base, seat, walkOf);
    const wm = walked ? mobileOfSeat(walked, seat) : undefined;
    if (!walked || !wm) return null;
    const p: BotPosition = { walk: walkOf, state: walked, x: wm.x, distance: Math.abs(wm.x - (m?.x ?? wm.x)) };
    positionOf.set(key, p);
    return p;
  }
}

/**
 * The quick re-plan after a walk has arrived (§7 item 190): `centre` — the shot the
 * plan chose, now fired from wherever the live mobile actually stopped — and
 * `arriveRounds` passes around the best so far, starting `refineShrink` times finer
 * than the coarse grid. It climbs back onto the target if the live walk ended a pixel
 * or two from the copy's, and costs a few dozen candidates.
 */
export function* refineShot(
  state: MatchState,
  seat: number,
  centre: Omit<BotShot, 'walk'>,
): Generator<BotPlan, BotPlan, void> {
  const search = bots.search;
  const base = planBase(state, seat);
  const m = base ? mobileOfSeat(base, seat) : undefined;
  if (!base || !m) return { ranked: [], evaluated: 0, done: true };
  const def = getMobileDef(m.defId);
  const s = new Search(seat, def, base);
  const plan = s.plan;
  const here: BotPosition = { walk: null, state: base, x: m.x, distance: 0 };
  const limit = Number.MAX_SAFE_INTEGER;
  if (s.run(here, centre, limit)) yield plan;
  let aStep = (def.angleMax - def.angleMin) / Math.max(1, search.coarseAngles - 1);
  let pStep = (1 - search.minPower) / Math.max(1, search.coarsePowers - 1);
  for (let round = 0; round < search.arriveRounds; round++) {
    aStep /= search.refineShrink;
    pStep /= search.refineShrink;
    const best = plan.ranked[0];
    if (!best) break;
    for (let da = -search.refineRadius; da <= search.refineRadius; da++) {
      for (let dp = -search.refineRadius; dp <= search.refineRadius; dp++) {
        if (da === 0 && dp === 0) continue;
        const c = {
          facing: best.facing,
          shot: best.shot,
          relAngle: best.relAngle + da * aStep,
          power: best.power + dp * pStep,
        };
        if (s.run(here, c, limit)) yield plan;
      }
    }
  }
  plan.done = true;
  return plan;
}

/** Uniform-sum error in (-1, 1), peaked at 0: no transcendental needed (DESIGN §2.1). */
function triangular(rng: Prng): number {
  return rng.nextFloat() + rng.nextFloat() - 1;
}

/**
 * Turn a plan into the shot the bot actually plays (§7 item 188): the best candidate,
 * or — by `settleChance` — one a little further down the ranking, then an angle and a
 * power error of up to the difficulty's size, and a walk off by up to its `walkError`. Every draw is from `rng`, the bot's own
 * generator: the match PRNG is never touched. Candidates that hurt the bot's own side
 * are never settled for unless nothing better exists.
 */
export function chooseShot(
  plan: BotPlan,
  difficulty: BotDifficultyDef,
  rng: Prng,
  def: MobileDef,
  options: { allowWalk?: boolean } = {},
): BotShot | null {
  // A walk the turn timer has no room for is not on the menu (§7 item 190).
  const ranked = options.allowWalk === false ? plan.ranked.filter((c) => !c.walk) : plan.ranked;
  const best = ranked[0];
  if (!best) return null;
  let pick: ScoredShot = best;
  const floor = Math.min(0, best.score);
  const acceptable = ranked.filter((c) => c.score >= floor);
  const settle = rng.nextFloat();
  const depth = Math.min(difficulty.settleDepth, acceptable.length - 1);
  if (settle < difficulty.settleChance && depth >= 1) {
    pick = acceptable[1 + Math.floor(rng.nextFloat() * depth)] ?? best;
  }
  const relAngle = clamp(pick.relAngle + triangular(rng) * difficulty.angleErrorDeg, def.angleMin, def.angleMax);
  const power = quantisePower(clamp(pick.power + triangular(rng) * difficulty.powerError, 0.05, 1));
  // A walk misjudged by up to `walkError` of its length. The driver re-plans the aim
  // where it actually stops, so this moves where the bot fires from, not whether it
  // aims at all.
  let walk = pick.walk;
  if (walk && difficulty.walkError > 0) {
    const ticks = Math.max(1, Math.round(walk.ticks * (1 + triangular(rng) * difficulty.walkError)));
    walk = { dir: walk.dir, ticks };
  }
  return { walk, facing: pick.facing, shot: pick.shot, relAngle, power };
}

/**
 * What a bot fires when the search found nothing at all (§7 item 189): a plain S1 at a
 * middling angle and power, towards the nearest enemy. Better than a skip, which would
 * leave a practice player waiting out a dead timer.
 */
export function fallbackShot(state: MatchState, seat: number): BotShot {
  const m = mobileOfSeat(state, seat);
  const def = m ? getMobileDef(m.defId) : undefined;
  const facing = m ? (facingsTowardEnemies(state, seat)[0] ?? m.facing) : 1;
  const relAngle = def ? clamp(45, def.angleMin, def.angleMax) : 45;
  return { walk: null, facing, shot: 's1', relAngle, power: quantisePower(0.7) };
}
