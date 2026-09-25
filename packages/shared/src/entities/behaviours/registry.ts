/**
 * The behaviour registry itself: the types every behaviour module is written against,
 * the key → module map, and `basic` (DESIGN §2.5).
 *
 * It is a separate module from `index.ts` purely so that the seventeen behaviour
 * modules can import their types and `basicBehaviour` without importing the file that
 * imports *them*. `index.ts` re-exports everything here, so every existing import path
 * (`entities/behaviours/index.js`) keeps working.
 */
import type { Prng } from '../../math/prng.js';
import type { Terrain } from '../../terrain/terrain.js';
import type { WindState } from '../../rules/wind.js';
import type { MobileState } from '../mobile.js';
import type { MineState } from '../mines.js';
import type { MobileDef } from '../../data/mobiles.js';
import type { SimEvent } from '../../match/events.js';
import type { ProjectileDef, ProjectileState } from '../projectile.js';

/** Where a projectile struck. `mobileSeat` is set when it hit a mobile rather than terrain. */
export interface ImpactInfo {
  x: number;
  y: number;
  mobileSeat?: number;
}

/**
 * Something that has to happen after the projectile is gone but before the turn can
 * resolve (sky strikes, delayed bolts, falling swords).
 *
 * This queue blocks `isSettled`, so only *same-turn* effects belong in it: an entry
 * still pending holds the turn in `resolving` until the watchdog fires, and the
 * watchdog then drops the whole queue. Entities that outlive the turn (mines, DESIGN
 * §3: "Persistent entities (mines) do not block resolution") live in `MatchState.mines`
 * and walk on a turn hook instead.
 *
 * When an effect comes due the reducer calls `onTurnEffect` on the behaviour named by
 * `behaviour`, passing the effect itself; an effect with no `behaviour`, or whose
 * behaviour has no hook, is simply retired.
 */
export interface TurnEffect {
  /** Render/dispatch tag, e.g. 'bolt', 'sword', 'satellite', 'thor'. */
  kind: string;
  /** Tick at which it fires. */
  atTick: number;
  ownerSeat: number;
  /** Behaviour key whose `onTurnEffect` runs when it comes due. */
  behaviour?: string;
  /** All numeric, so the effect stays hash-safe and snapshot-safe. */
  data: Record<string, number>;
}

/** What {@link BehaviourContext.mark} schedules. */
export interface MarkPayload {
  /** Behaviour key called back through `onTurnEffect` when the mark comes due. */
  behaviour: string;
  /** Render tag for the `mark` event and the resulting {@link TurnEffect.kind}. */
  kind?: string;
  /** Numeric scratch carried to the callback (bolt count, angle, Thor level…). */
  data?: Record<string, number>;
  /**
   * Who the strike belongs to. Defaults to `state.activeSeat`, which is the same thing
   * in `turns` mode — but in `freePlay` (the sandbox) seat A can schedule a mark and
   * seat B fire before it comes due, and the strike would then be credited to B on the
   * `hit` event and on B's SS gauge. A behaviour that has a projectile in hand passes
   * `p.ownerSeat` and is right in both modes.
   */
  ownerSeat?: number;
}

/** Map bounds, for behaviours that need to know where the world stops. */
export interface WorldBounds {
  width: number;
  height: number;
}

/**
 * Everything a behaviour is allowed to touch. Deviations from DESIGN §2.5, both because
 * the context is built once per step rather than per projectile: `spawn` and
 * `damageArea` take the owner seat, and `explode` takes the projectile it belongs to.
 */
export interface BehaviourContext {
  tick: number;
  rng: Prng;
  wind: WindState;
  terrain: Terrain;
  /** Map width and height in px; `terrain` has the same numbers. */
  bounds: WorldBounds;
  mobiles: MobileState[];
  /** Persistent walking mines (DESIGN §3). Append through {@link addMine}. */
  mines: MineState[];
  /** The seat whose turn it is; the owner of anything the turn machine schedules. */
  activeSeat: number;
  defOf(seat: number): MobileDef | undefined;
  spawn(
    def: ProjectileDef,
    x: number,
    y: number,
    vx: number,
    vy: number,
    ownerSeat: number,
    data?: Record<string, number>,
  ): ProjectileState;
  explode(p: ProjectileState, x: number, y: number, defOverride?: Partial<ProjectileDef>): void;
  /**
   * The Force band's damage multiplier for this projectile (DESIGN §5, §7 item 130).
   * `explode` applies it on its own; a behaviour that deals its payload through
   * `damageArea` or `beamStrike` — a bolt, a satellite beam, a sword — multiplies its
   * own def's damage by this instead, so the band is worth the same whatever a mobile
   * fires. A payload that outlives its shell carries `data.force` through the mark and
   * uses `forceMultiplierForFlag` on the other side.
   */
  forceMultiplier(p: ProjectileState): number;
  carve(x: number, y: number, r: number): void;
  damageArea(x: number, y: number, def: ProjectileDef, ownerSeat: number): void;
  /**
   * A vertical column of light from `fromY` down to `y` at column `x` (lightning,
   * asate, Thor, knight): carves the column `width` px wide, emits a `beam` event for
   * the renderer, and damages every mobile by its distance to the column segment with
   * the def's ordinary falloff — so a mobile standing in the beam takes the full hit
   * and one beside it takes the edge of it. `ownerSeat` defaults to `activeSeat`.
   */
  beamStrike(
    x: number,
    y: number,
    fromY: number,
    width: number,
    def: ProjectileDef,
    ownerSeat?: number,
  ): void;
  /** Throw a mobile: adds to its velocity and takes it off the ground (DESIGN §2.4). */
  applyImpulse(seat: number, dx: number, dy: number): void;
  /**
   * Mark a point and come back to it. Schedules a {@link TurnEffect} `ticksUntil`
   * ticks from now that calls `payload.behaviour`'s `onTurnEffect`, and emits a `mark`
   * event so the renderer can blink a target there in the meantime.
   */
  mark(x: number, y: number, ticksUntil: number, payload: MarkPayload): void;
  /** Put a walking mine in the world (DESIGN §3, raon). Emits `mineSpawn`. */
  addMine(mine: MineState): void;
  emit(event: SimEvent): void;
  scheduleTurnEffect(effect: TurnEffect): void;
}

export interface Behaviour {
  onSpawn?(p: ProjectileState, ctx: BehaviourContext): void;
  /** Every sub-step, after integration. */
  onTick?(p: ProjectileState, ctx: BehaviourContext): void;
  /** Return true to suppress the default explode. */
  onImpact?(p: ProjectileState, ctx: BehaviourContext, hit: ImpactInfo): boolean;
  /** `lifetimeTicks` reached. */
  onTimer?(p: ProjectileState, ctx: BehaviourContext): void;
  /** Left the world. */
  onExpire?(p: ProjectileState, ctx: BehaviourContext): void;
  /**
   * A {@link TurnEffect} this behaviour scheduled (through `mark` or
   * `scheduleTurnEffect`) has come due. The effect is retired either way; schedule
   * another one to chain.
   */
  onTurnEffect?(effect: TurnEffect, ctx: BehaviourContext): void;
}

const registry = new Map<string, Behaviour>();

export function registerBehaviour(key: string, behaviour: Behaviour): void {
  registry.set(key, behaviour);
}

/** Lookup by the string key in `ProjectileDef.behaviour`. */
export function getBehaviour(key: string | undefined): Behaviour | undefined {
  if (key === undefined) return undefined;
  return registry.get(key);
}

export function behaviourKeys(): string[] {
  return [...registry.keys()].sort();
}

/** Fly, hit, explode. No hooks: the projectile's own defaults do everything. */
export const basicBehaviour: Behaviour = {};
