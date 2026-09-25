/**
 * The one projectile entity (DESIGN §2.5). Every shot in the game is this entity plus
 * configuration; anything that cannot be expressed as data gets a behaviour module.
 *
 * Integration is semi-implicit Euler with `constants.subSteps` sub-steps per tick and
 * a segment walk that samples terrain and mobile footprints at least once per pixel, so
 * a fast shot cannot tunnel through a 1-px wall.
 */
import { constants } from '../data/constants.js';
import type { DamageType } from '../data/damageTable.js';
import type { MobileDef } from '../data/mobiles.js';
import type { MobileState } from './mobile.js';
import type { BehaviourContext, ImpactInfo } from './behaviours/index.js';
import { getBehaviour } from './behaviours/index.js';
import { cosDeg, sinDeg } from '../math/trig.js';
import { stepProjectileSky } from '../rules/sky.js';
import type { SkyState } from '../rules/sky.js';

export type TrailKind = 'none' | 'smoke' | 'spark' | 'bubble';

export interface ProjectileDef {
  /** px/tick at power 1.0. */
  speed: number;
  /** Multiplier of constants.gravity; 0 for beams and bolts. */
  gravity: number;
  /** 0 = immune … 3 = boomer. */
  windFactor: number;
  /** Collision radius against terrain and mobiles. */
  radius: number;
  /** Terrain hole radius on explosion. */
  carveRadius: number;
  /** Damage at the explosion centre. */
  damage: number;
  /** Linear falloff to 0 at this distance. */
  damageRadius: number;
  damageType: DamageType;
  /** onTimer fires when this many ticks have elapsed. */
  lifetimeTicks?: number;
  /** Remaining ground bounces. */
  bounces?: number;
  /** Fraction of speed kept through a bounce. */
  restitution?: number;
  /** Key into the behaviour registry. */
  behaviour?: string;
  /**
   * Behaviour-specific tunables — still data (DESIGN §2.5). Every number a behaviour
   * module needs goes in here, in the mobile's own `data/mobiles/<id>.ts`, never
   * inline in the module.
   */
  params?: Record<string, number>;
  /**
   * Stacking defence debuff added to every mobile this shot damages (ice, DESIGN §3).
   * It lands on `MobileState.defenceMod`, is capped at `constants.debuff.max`, decays
   * by `constants.debuff.decayPerTurn` at the start of the victim's own turn, and
   * multiplies incoming damage by `(1 + defenceMod)` (DESIGN §2.6).
   */
  defenceDebuff?: number;
  /**
   * Damage multiplier against a shield only (mage SS: "damage ×2.5 vs shield").
   * The shield loses `amount * shieldDamageMultiplier` and whatever of the raw
   * `amount` was not spent on it carries through to hp at the ordinary rate.
   * Undefined or 1 = the plain rule.
   */
  shieldDamageMultiplier?: number;
  sprite: string;
  trail?: TrailKind;
}

export interface ProjectileState {
  id: number;
  def: ProjectileDef;
  ownerSeat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  alive: boolean;
  bouncesLeft: number;
  /** Behaviour scratch space. All numeric so it stays hash-safe. */
  data: Record<string, number>;
}

export function createProjectile(
  id: number,
  def: ProjectileDef,
  ownerSeat: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  data?: Record<string, number>,
): ProjectileState {
  return {
    id,
    def,
    ownerSeat,
    x,
    y,
    vx,
    vy,
    age: 0,
    alive: true,
    bouncesLeft: def.bounces ?? 0,
    data: data ? { ...data } : {},
  };
}

/**
 * Muzzle velocity for a shot. `angleDeg` is the world angle (0 = right, 90 = up) and
 * `power` is the charged power bar in [0, 1]. World +y is down, hence the negated sine.
 */
export function launchVelocity(
  def: ProjectileDef,
  angleDeg: number,
  power: number,
): { vx: number; vy: number } {
  const speed = def.speed * power;
  return { vx: speed * cosDeg(angleDeg), vy: -speed * sinDeg(angleDeg) };
}

/**
 * Has this shot ever been outside its own shooter's hull?
 *
 * `p.data.leftOwner` is the latch. Until it is set the owner cannot be hit, which is
 * what stops a shot exploding in its shooter's face on the tick it is born: several
 * sprites put the muzzle *inside* their own footprint box at some legal angles (a low
 * barrel pivot on a tall hull), and the multi-body shots — `orbit`, `weave` — pull one
 * body a ring radius *back* from the muzzle on the first sub-step, so the trailing body
 * can still be inside the hull long after a fixed tick grace would have run out.
 *
 * Latching on "has left" rather than counting ticks also keeps the accepted case: a
 * shot fired at 10 % power from a muzzle that *is* outside the hull leaves immediately,
 * falls back onto its owner and blows up at its feet (DESIGN §7 item 32).
 */
function updateLeftOwner(p: ProjectileState, ctx: BehaviourContext): void {
  if (p.data.leftOwner === 1) return;
  for (let mi = 0; mi < ctx.mobiles.length; mi++) {
    const m = ctx.mobiles[mi];
    if (!m || m.seat !== p.ownerSeat) continue;
    const def = ctx.defOf(m.seat);
    // No def, no box to be inside of: treat the shot as clear.
    if (def && hitsMobile(m, def, p.x, p.y, p.def.radius)) return;
    break;
  }
  p.data.leftOwner = 1;
}

/** Footprint box of a mobile, expanded by a projectile radius. */
function hitsMobile(
  m: MobileState,
  def: MobileDef,
  x: number,
  y: number,
  radius: number,
): boolean {
  const halfW = def.footprint.w / 2 + radius;
  const top = m.y - def.footprint.h - radius;
  const bottom = m.y + radius;
  return x >= m.x - halfW && x <= m.x + halfW && y >= top && y <= bottom;
}

/**
 * Surface normal estimate: sum the directions of the air pixels around the impact point.
 * Only used for bounces (grub and friends). Deterministic: integer sums plus one sqrt.
 */
function surfaceNormal(ctx: BehaviourContext, x: number, y: number): { x: number; y: number } {
  let nx = 0;
  let ny = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!ctx.terrain.isSolid(x + dx, y + dy)) {
        nx += dx;
        ny += dy;
      }
    }
  }
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len === 0) return { x: 0, y: -1 };
  return { x: nx / len, y: ny / len };
}

/** Resolve an impact: behaviour first, then the default explode. */
function impact(p: ProjectileState, ctx: BehaviourContext, hit: ImpactInfo): void {
  const behaviour = getBehaviour(p.def.behaviour);
  const suppressed = behaviour?.onImpact?.(p, ctx, hit) ?? false;
  if (suppressed) return;

  // Bounce before exploding when the shot has bounces left and hit terrain.
  if (hit.mobileSeat === undefined && p.bouncesLeft > 0) {
    const n = surfaceNormal(ctx, hit.x, hit.y);
    const restitution = p.def.restitution ?? constants.projectile.defaultRestitution;
    const dot = p.vx * n.x + p.vy * n.y;
    p.vx = (p.vx - 2 * dot * n.x) * restitution;
    p.vy = (p.vy - 2 * dot * n.y) * restitution;
    p.x = hit.x + n.x * (p.def.radius + 1);
    p.y = hit.y + n.y * (p.def.radius + 1);
    p.bouncesLeft--;
    return;
  }

  ctx.explode(p, hit.x, hit.y);
  p.alive = false;
}

/**
 * One tick of projectile motion. Returns when the projectile has moved a full tick or
 * died. The caller (the reducer) owns the projectile list.
 */
export function stepProjectile(
  p: ProjectileState,
  ctx: BehaviourContext,
  sky?: SkyState,
): void {
  if (!p.alive) return;
  const behaviour = getBehaviour(p.def.behaviour);
  const subSteps = constants.subSteps;
  const dt = 1 / subSteps;
  const wind = ctx.wind;
  const windFactor = p.def.windFactor;

  for (let s = 0; s < subSteps; s++) {
    if (!p.alive) return;
    // Latched here, at the top of the sub-step, so a behaviour's `onTick` offset (the
    // ring of `orbit`, the braid of `weave`) is part of the position that is tested.
    updateLeftOwner(p, ctx);
    // The sky (DESIGN §5). Force only flags the shell and lets it fly on; the tornado
    // takes it over completely while it is carrying it up the column, which is why this
    // can end the sub-step: a held shell has no wind, no gravity, no collision and no
    // behaviour tick, it is simply somewhere else next sub-step.
    if (sky !== undefined && sky.kind !== 'none' && stepProjectileSky(p, ctx, sky, dt)) {
      continue;
    }
    p.vx += wind.x * windFactor * dt;
    p.vy += (constants.gravity * p.def.gravity + wind.y * windFactor) * dt;

    const nx = p.x + p.vx * dt;
    const ny = p.y + p.vy * dt;
    const hit = walkSegment(p, ctx, p.x, p.y, nx, ny);
    if (hit) {
      impact(p, ctx, hit);
      if (!p.alive) return;
    } else {
      p.x = nx;
      p.y = ny;
    }

    behaviour?.onTick?.(p, ctx);
  }

  p.age++;

  const lifetime = p.def.lifetimeTicks;
  if (lifetime !== undefined && p.age >= lifetime) {
    if (behaviour?.onTimer) {
      // A behaviour with a timer owns what happens next (split, shatter, burst): it
      // decides whether the projectile explodes, keeps flying or simply disappears.
      behaviour.onTimer(p, ctx);
    } else {
      ctx.explode(p, p.x, p.y);
      p.alive = false;
    }
    return;
  }

  const outOfWorld = isOutOfWorld(p, ctx);
  if (outOfWorld || p.age > constants.projectile.maxLifetimeTicks) {
    behaviour?.onExpire?.(p, ctx);
    p.alive = false;
    // A shell that sails off the map used to die silently, which left the client with
    // nothing to return the camera on (PROGRESS.md Phase 1, "rough").
    ctx.emit({
      t: 'projectileExpire',
      id: p.id,
      ownerSeat: p.ownerSeat,
      x: p.x,
      y: p.y,
      reason: outOfWorld ? 'outOfWorld' : 'lifetime',
    });
  }
}

function isOutOfWorld(p: ProjectileState, ctx: BehaviourContext): boolean {
  const margin = constants.projectile.cullMarginPx;
  // Flying above the map is legal and common; leaving the sides or the floor is not.
  return p.x < -margin || p.x > ctx.terrain.width + margin || p.y > ctx.terrain.height + margin;
}

/**
 * Walk from (x0, y0) to (x1, y1) sampling at least once per pixel, and return the first
 * terrain or mobile hit. This is what stops fast shots tunnelling (DESIGN §2.1).
 */
function walkSegment(
  p: ProjectileState,
  ctx: BehaviourContext,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): ImpactInfo | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(dist / constants.segmentSampleStep));
  // `ownerGraceTicks` is the floor; the latch is the real rule (see updateLeftOwner).
  const ownerImmune =
    p.age < constants.projectile.ownerGraceTicks || p.data.leftOwner !== 1;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const sx = x0 + dx * t;
    const sy = y0 + dy * t;

    for (let mi = 0; mi < ctx.mobiles.length; mi++) {
      const m = ctx.mobiles[mi];
      if (!m || !m.alive) continue;
      if (ownerImmune && m.seat === p.ownerSeat) continue;
      const def = ctx.defOf(m.seat);
      if (!def) continue;
      if (hitsMobile(m, def, sx, sy, p.def.radius)) {
        return { x: sx, y: sy, mobileSeat: m.seat };
      }
    }

    if (ctx.terrain.isSolid(sx, sy)) {
      return { x: sx, y: sy };
    }
  }
  return null;
}
