/**
 * Mobiles: the tanks (DESIGN §2.4). One tick of mobile physics is falling, landing,
 * walking within the move gauge, tilt smoothing and death below the map. Turn rules
 * (gauge refills, shield regen, delay) belong to Phase 2 and live in `rules/`.
 */
import { constants } from '../data/constants.js';
import type { MobileDef, MobileId } from '../data/mobiles.js';
import { NO_GROUND } from '../terrain/terrain.js';
import type { Terrain } from '../terrain/terrain.js';
import { clamp } from '../math/fixed.js';
import { RAD_TO_DEG } from '../math/trig.js';
import { animDurationTicks } from '../sprites/pixelArt.js';
import type { AnimName } from '../sprites/pixelArt.js';
import type { SimEvent } from '../match/events.js';

export type TeamId = 'A' | 'B';

export interface MobileAnim {
  name: AnimName;
  /** Frame index; the client advances it from `t` and the sprite's frameTicks. */
  frame: number;
  /** Ticks spent in this animation. */
  t: number;
}

/**
 * DESIGN §2.4, plus the bookkeeping fields the reducer needs: `seat`, `defId`, `team`,
 * `moveDir` (the current walk input, edge-triggered from the `move` message) and
 * `grounded` (derived each tick; the renderer uses it for the falling pose).
 */
export interface MobileState {
  seat: number;
  defId: MobileId;
  team: TeamId;
  /** Feet centre. */
  x: number;
  y: number;
  /** Vertical velocity while falling, px/tick. */
  vy: number;
  /**
   * Horizontal velocity while airborne, px/tick. Only an impulse ever sets it
   * (`BehaviourContext.applyImpulse` — jd's pull, a shockwave): walking moves `x`
   * directly and leaves it at 0. It is integrated while the mobile is off the ground
   * and scaled by `constants.mobile.landingFriction` when it lands.
   */
  vx: number;
  facing: -1 | 1;
  /** Screen-space tilt in radians, positive = nose down to the right. */
  tilt: number;
  /** Aim angle relative to tilt, clamped to [def.angleMin, def.angleMax]. */
  relAngle: number;
  hp: number;
  shield: number;
  /** Stacking defence debuff (ice); decays per turn. */
  defenceMod: number;
  /** Px of walking left this turn. */
  moveGauge: number;
  alive: boolean;
  grounded: boolean;
  moveDir: -1 | 0 | 1;
  anim: MobileAnim;
}

export interface MobileStepContext {
  terrain: Terrain;
  mapHeight: number;
  emit: (event: SimEvent) => void;
  /** Free play (Phase 1 sandbox) tops the move gauge back up every tick. */
  refillGauge: boolean;
}

export function createMobile(
  seat: number,
  defId: MobileId,
  team: TeamId,
  def: MobileDef,
  x: number,
  y: number,
  facing: -1 | 1,
): MobileState {
  return {
    seat,
    defId,
    team,
    x,
    y,
    vy: 0,
    vx: 0,
    facing,
    tilt: 0,
    relAngle: clamp(constants.mobile.defaultRelAngleDeg, def.angleMin, def.angleMax),
    hp: def.hp,
    shield: def.shieldMax,
    defenceMod: 0,
    moveGauge: def.moveGauge,
    alive: true,
    grounded: false,
    moveDir: 0,
    anim: { name: 'idle', frame: 0, t: 0 },
  };
}

/**
 * World aim angle in degrees for a relative angle, 0 = right and 90 = up (DESIGN §2.4:
 * `trueAngle = (facing === 1 ? relAngle : 180 - relAngle) + tiltDeg`).
 *
 * Facing mirrors the aim through the *vertical* axis, which is what turning a tank
 * around does: a barrel 45° above the horizon stays 45° above the horizon and points the
 * other way (135°). Multiplying by `facing` would mirror it through the horizontal and
 * aim a left-facing mobile into its own feet. Tilt is a world-space rotation of the hull,
 * so it keeps its sign for either facing; `tiltDeg` is the counter-clockwise reading of
 * the screen-space `tilt`.
 */
export function worldAngleDeg(m: MobileState, relAngle: number): number {
  const aim = m.facing === 1 ? relAngle : 180 - relAngle;
  return aim - m.tilt * RAD_TO_DEG;
}

/** The mobile's current world aim angle. */
export function trueAngleDeg(m: MobileState): number {
  return worldAngleDeg(m, m.relAngle);
}

/** Tilt expressed the way the aim formula wants it: counter-clockwise degrees. */
export function tiltDeg(m: MobileState): number {
  return -m.tilt * RAD_TO_DEG;
}

export function setAnim(m: MobileState, name: AnimName): void {
  if (m.anim.name === name) return;
  m.anim.name = name;
  m.anim.frame = 0;
  m.anim.t = 0;
}

/** Is any of the three footprint probe columns solid at row `y`? */
export function solidUnderFootprint(terrain: Terrain, x: number, y: number, w: number): boolean {
  const half = w / 2;
  return terrain.isSolid(x - half, y) || terrain.isSolid(x, y) || terrain.isSolid(x + half, y);
}

/**
 * Is the mobile resting on something? Its feet row is the first solid row under it, so a
 * floor counts when that row itself is solid or when it sits within the ground tolerance
 * below. Probing only below the feet row would drop a mobile through a 1 px crust.
 */
function isStanding(terrain: Terrain, x: number, y: number, w: number): boolean {
  return (
    solidUnderFootprint(terrain, x, y, w) ||
    solidUnderFootprint(terrain, x, y + constants.mobile.groundTolerancePx, w)
  );
}

/**
 * Ground row the mobile would stand on at column `x`, probing from `maxStep` above the
 * current feet row downwards. Returns {@link NO_GROUND} when there is nothing to stand on
 * within the probe range.
 */
function groundForStep(terrain: Terrain, x: number, y: number, def: MobileDef): number {
  const probeTop = Math.floor(y) - def.maxStep;
  // A wall taller than maxStep blocks the step.
  if (solidUnderFootprint(terrain, x, probeTop, def.footprint.w)) return NO_GROUND;
  const range = def.maxStep + constants.mobile.surfaceProbePx;
  for (let probe = probeTop + 1; probe <= probeTop + range; probe++) {
    if (solidUnderFootprint(terrain, x, probe, def.footprint.w)) return probe;
  }
  return NO_GROUND;
}

/** Aim within the mobile's own range (DESIGN §7 item 16). */
export function setRelAngle(m: MobileState, def: MobileDef, relAngle: number): void {
  m.relAngle = clamp(relAngle, def.angleMin, def.angleMax);
}

/**
 * Set the walk input. Anything that is not exactly -1 or 1 stops the mobile: `dir`
 * arrives from the wire, and a stale or malformed value must never become a NaN
 * position (DESIGN §6.1 `move`).
 */
export function setMoveDir(m: MobileState, dir: -1 | 0 | 1): void {
  const d: -1 | 0 | 1 = dir === -1 ? -1 : dir === 1 ? 1 : 0;
  m.moveDir = d;
  if (d !== 0) m.facing = d;
}

/**
 * One tick of mobile physics. Order matters for determinism: gauge refill, walking,
 * gravity/landing, death check, tilt smoothing, animation.
 */
export function stepMobile(m: MobileState, def: MobileDef, ctx: MobileStepContext): void {
  if (!m.alive) {
    m.anim.t++;
    return;
  }
  const terrain = ctx.terrain;
  const w = def.footprint.w;

  if (ctx.refillGauge) m.moveGauge = def.moveGauge;

  // --- walking ------------------------------------------------------------
  let walked = false;
  const supported = isStanding(terrain, m.x, m.y, w);
  if (m.moveDir !== 0 && m.moveGauge > 0 && supported && m.vy === 0) {
    const stepPx = Math.min(def.moveSpeed, m.moveGauge);
    const targetX = clamp(m.x + m.moveDir * stepPx, 0, terrain.width - 1);
    const groundY = groundForStep(terrain, targetX, m.y, def);
    if (groundY === NO_GROUND) {
      // Either a wall too steep to climb, or a ledge to walk off.
      if (!solidUnderFootprint(terrain, targetX, Math.floor(m.y) - def.maxStep, w)) {
        m.x = targetX;
        m.moveGauge -= stepPx;
        m.grounded = false;
        walked = true;
      }
    } else {
      m.x = targetX;
      m.y = groundY;
      m.moveGauge -= stepPx;
      walked = true;
    }
    m.facing = m.moveDir;
  }

  // --- gravity and landing -------------------------------------------------
  const standingOn = isStanding(terrain, m.x, m.y, w);
  if (standingOn && m.vy === 0) {
    m.grounded = true;
  } else {
    m.grounded = false;
    // Horizontal drift, but only while airborne: a mobile that was thrown keeps its
    // `vx` until it touches down. It moves one pixel at a time so a fast throw cannot
    // skip through a thin wall or sink its feet into a slope.
    let touchedDown = false;
    if (m.vx !== 0) touchedDown = driftSideways(m, def, terrain);
    if (!touchedDown) {
      m.vy = Math.min(m.vy + constants.gravity, constants.mobile.maxFallSpeed);
      const targetY = m.y + m.vy;
      if (m.vy < 0) {
        // Rising: the head stops against a ceiling instead of passing through rock.
        const h = def.footprint.h;
        const headRow = Math.ceil(m.y - h);
        let blockedAt = NO_GROUND;
        for (let probe = headRow - 1; probe >= Math.floor(targetY - h); probe--) {
          if (solidUnderFootprint(terrain, m.x, probe, w)) {
            blockedAt = probe;
            break;
          }
        }
        if (blockedAt === NO_GROUND) {
          m.y = targetY;
        } else {
          m.y = Math.max(targetY, blockedAt + 1 + h);
          m.vy = 0;
        }
      } else {
        let landedAt = NO_GROUND;
        for (let probe = Math.floor(m.y) + 1; probe <= Math.floor(targetY); probe++) {
          if (solidUnderFootprint(terrain, m.x, probe, w)) {
            landedAt = probe;
            break;
          }
        }
        if (landedAt === NO_GROUND) {
          m.y = targetY;
        } else {
          touchDown(m, landedAt, ctx);
        }
      }
    } else {
      ctx.emit({ t: 'land', seat: m.seat, x: m.x, y: m.y });
    }
  }

  // --- death below the map -------------------------------------------------
  if (m.y > ctx.mapHeight + constants.mobile.deathBelowMapPx) {
    m.alive = false;
    m.hp = 0;
    setAnim(m, 'death');
    ctx.emit({ t: 'death', seat: m.seat, x: m.x, y: m.y, cause: 'fell' });
    return;
  }

  // --- tilt ---------------------------------------------------------------
  const targetTilt = m.grounded
    ? terrain.sampleTilt(m.x, m.y, w, constants.mobile.surfaceProbePx)
    : m.tilt;
  m.tilt += (targetTilt - m.tilt) * constants.mobile.tiltSmoothing;

  // --- animation ----------------------------------------------------------
  // `fire` and `hurt` are one-shots: they play out, then hand back to move/idle.
  if (m.anim.name === 'fire' || m.anim.name === 'hurt') {
    if (m.anim.t + 1 >= animDurationTicks(def.sprite, m.anim.name)) {
      setAnim(m, walked ? 'move' : 'idle');
    }
  } else if (walked) {
    setAnim(m, 'move');
  } else {
    setAnim(m, 'idle');
  }
  m.anim.t++;
}

function touchDown(m: MobileState, row: number, ctx: MobileStepContext): void {
  m.y = row;
  m.vy = 0;
  m.vx *= constants.mobile.landingFriction;
  m.grounded = true;
  ctx.emit({ t: 'land', seat: m.seat, x: m.x, y: m.y });
}

/**
 * Move an airborne mobile `vx` px sideways, one pixel at a time. A wall at mid-hull
 * height stops the drift; rising ground at the feet either catches the mobile (within
 * `maxStep`, it lands on top) or stops the drift like a wall. Returns true when the
 * mobile landed, in which case the caller emits `land` and skips gravity this tick.
 */
function driftSideways(m: MobileState, def: MobileDef, terrain: Terrain): boolean {
  const dir = m.vx > 0 ? 1 : -1;
  const w = def.footprint.w;
  const midY = m.y - def.footprint.h / 2;
  let remaining = Math.abs(m.vx);
  while (remaining > 0) {
    const step = Math.min(1, remaining);
    const nx = clamp(m.x + dir * step, 0, terrain.width - 1);
    if (nx === m.x || terrain.isSolid(nx, midY)) {
      m.vx = 0;
      return false;
    }
    const feetRow = Math.ceil(m.y) - 1;
    if (solidUnderFootprint(terrain, nx, feetRow, w)) {
      for (let up = 1; up <= def.maxStep; up++) {
        if (!solidUnderFootprint(terrain, nx, feetRow - up, w)) {
          m.x = nx;
          m.y = feetRow - up + 1;
          m.vy = 0;
          m.vx *= constants.mobile.landingFriction;
          m.grounded = true;
          return true;
        }
      }
      m.vx = 0;
      return false;
    }
    m.x = nx;
    remaining -= step;
  }
  return false;
}

/** Drop a mobile onto the first ground below it, used when placing spawns. */
export function settleOnGround(m: MobileState, def: MobileDef, terrain: Terrain): void {
  const w = def.footprint.w;
  for (let y = Math.floor(m.y); y < terrain.height; y++) {
    if (solidUnderFootprint(terrain, m.x, y, w)) {
      m.y = y;
      m.vy = 0;
      m.vx = 0;
      m.grounded = true;
      m.tilt = terrain.sampleTilt(m.x, m.y, w, constants.mobile.surfaceProbePx);
      return;
    }
  }
  m.y = terrain.height;
  m.grounded = false;
}
