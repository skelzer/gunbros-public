/**
 * The event stream a step produces (DESIGN §1.2, §2.5). Rendering and audio read these;
 * nothing in the simulation reads them back, so adding an event is always safe.
 * All payloads are plain data so they can go straight over the wire if we ever want to.
 */
import type { DamageType } from '../data/damageTable.js';
import type { ItemId } from '../data/items.js';
import type { ShotSlot } from '../data/mobiles.js';
import type { SkyEventId } from '../data/sky.js';
import type { TeamId } from '../entities/mobile.js';

export interface CarveEvent {
  t: 'carve';
  x: number;
  y: number;
  r: number;
}

export interface ExplosionEvent {
  t: 'explosion';
  x: number;
  y: number;
  /** Damage radius, which is what the effect should be sized from. */
  radius: number;
  carveRadius: number;
  damageType: DamageType;
  ownerSeat: number;
}

export interface HitEvent {
  t: 'hit';
  seat: number;
  x: number;
  y: number;
  /** Damage after every multiplier, before the shield soaked its share. */
  amount: number;
  shieldAbsorbed: number;
  hpLost: number;
  damageType: DamageType;
  ownerSeat: number;
}

export interface DeathEvent {
  t: 'death';
  seat: number;
  x: number;
  y: number;
  cause: 'damage' | 'fell' | 'forfeit';
}

export interface SpawnEvent {
  t: 'spawn';
  id: number;
  ownerSeat: number;
  sprite: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface LandEvent {
  t: 'land';
  seat: number;
  x: number;
  y: number;
}

export interface FireEvent {
  t: 'fire';
  seat: number;
  shot: ShotSlot;
  power: number;
  /** World angle in degrees, 0 = right, 90 = up. */
  angleDeg: number;
  x: number;
  y: number;
}

/** A projectile left the world (or outlived `maxLifetimeTicks`) without exploding. */
export interface ProjectileExpireEvent {
  t: 'projectileExpire';
  id: number;
  ownerSeat: number;
  x: number;
  y: number;
  /** `outOfWorld` = off the sides or below the floor; `lifetime` = culled by age. */
  reason: 'outOfWorld' | 'lifetime';
}

/**
 * A column of light (lightning bolt, satellite beam, Thor laser, falling sword). The
 * simulation emits it from `BehaviourContext.beamStrike`; the client draws a bright
 * line from (x1, y1) to (x2, y2) that fades. `kind` is a free render tag — 'bolt',
 * 'beam', 'thor', 'sword' — so one generic renderer covers every mobile that has one.
 */
export interface BeamEvent {
  t: 'beam';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Full width of the column in px. */
  width: number;
  kind: string;
  ownerSeat: number;
}

/**
 * A point has been marked and something is coming for it (DESIGN §3: lightning, asate,
 * aduka, knight). The client blinks a marker there until `ticksUntil` has passed.
 */
export interface MarkEvent {
  t: 'mark';
  x: number;
  y: number;
  kind: string;
  ownerSeat: number;
  /** Ticks between the mark and whatever it called down. */
  ticksUntil: number;
}

/** A walking mine was dropped (DESIGN §3, raon). */
export interface MineSpawnEvent {
  t: 'mineSpawn';
  id: number;
  ownerSeat: number;
  x: number;
  y: number;
  /** Sprite key. */
  sprite: string;
}

/** A mine walked at the start of a turn. */
export interface MineMoveEvent {
  t: 'mineMove';
  id: number;
  x: number;
  y: number;
}

/** A mine detonated (triggered, shot, or chained off another explosion). */
export interface MineExplodeEvent {
  t: 'mineExplode';
  id: number;
  x: number;
  y: number;
}

/** A pull (jd, DESIGN §3): everything within `radius` was dragged toward (x, y). */
export interface PullEvent {
  t: 'pull';
  x: number;
  y: number;
  radius: number;
  ownerSeat: number;
}

/** A new turn has begun (DESIGN §2.9). Emitted as the turn enters `starting`. */
export interface TurnStartEvent {
  t: 'turnStart';
  seat: number;
  /** 1-based turn number. */
  turn: number;
}

/** The turn's delay has been banked. `delays` is the whole table, in seat order. */
export interface TurnEndEvent {
  t: 'turnEnd';
  seat: number;
  delays: number[];
  /** Delay this turn cost the seat (shot or skip, plus time, plus items). */
  cost: number;
}

/** Fired once per turn, `constants.turn.warningSeconds` before the timer runs out. */
export interface TimerWarningEvent {
  t: 'timerWarning';
  seat: number;
  secondsLeft: number;
}

/** The wind was rerolled (the turn schedule, §2.7, or the Wind Change item). */
export interface WindChangeEvent {
  t: 'windChange';
  strength: number;
  directionDeg: number;
}

/**
 * An item was used (DESIGN §4). Emitted by `applyIntent` for a `useItem` that passed
 * validation, before whatever the item does — so the client can play the pickup sound
 * and flash the spent slot even when the effect itself is silent.
 */
export interface ItemUsedEvent {
  t: 'itemUsed';
  seat: number;
  itemId: ItemId;
  target?: { x: number; y: number };
}

/** A mobile was healed (Bandage, Med Kit). `amount` is what it actually gained. */
export interface HealEvent {
  t: 'heal';
  seat: number;
  amount: number;
}

/** A mobile teleported (DESIGN §4). The client draws both ends of the jump. */
export interface TeleportEvent {
  t: 'teleport';
  seat: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
}

/**
 * A sudden-death level began (DESIGN §2.9). Emitted once, by the turn machine, on the
 * `turnEnd` that crossed the threshold, so the client can raise a banner.
 */
export interface SuddenDeathEvent {
  t: 'suddenDeath';
  /** 1 or 2. */
  level: number;
  /** The damage multiplier that level applies, so the banner can name it. */
  multiplier: number;
  completedTurns: number;
}

/**
 * The Thor satellite fired (DESIGN §5). The beam itself still arrives as an ordinary
 * `beam` event; this one says *why* it fired and at what level, so the client can flash
 * the satellite and name the strike.
 */
export interface SkyStrikeEvent {
  t: 'skyStrike';
  kind: 'thor';
  x: number;
  y: number;
  /** The level the strike was fired at. */
  level: number;
  /** Seat whose explosion called it down, and who the damage is credited to. */
  ownerSeat: number;
}

/** The Thor satellite gained a level (DESIGN §5: one per `thor.levelEveryHits`). */
export interface SkyLevelUpEvent {
  t: 'skyLevelUp';
  kind: 'thor';
  level: number;
  /** Strikes triggered so far. */
  hits: number;
}

/** A projectile was swallowed by the tornado's column (DESIGN §5). */
export interface TornadoCaptureEvent {
  t: 'tornadoCapture';
  id: number;
  ownerSeat: number;
  x: number;
  y: number;
}

/** The tornado let a projectile go, with the velocity it left at. */
export interface TornadoReleaseEvent {
  t: 'tornadoRelease';
  id: number;
  ownerSeat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A projectile crossed the Force band and is now charged (DESIGN §5). */
export interface SkyForceEvent {
  t: 'skyForce';
  id: number;
  ownerSeat: number;
  x: number;
  y: number;
}

/**
 * The weather changed at a turn end (DESIGN §5): an event arrived under a clear sky
 * (`kind` is it, `previous` is `none`) or the one that was up ran out of turns (`kind`
 * is `none`, `previous` is the one that left). The new state is already in
 * `MatchState.sky`; this is what the banner and the sound key off.
 */
export interface SkyChangeEvent {
  t: 'skyChange';
  kind: SkyEventId;
  previous: SkyEventId;
  /** Completed turns the new event lasts; 0 when the sky cleared. */
  turnsLeft: number;
}

/** One team has no living mobiles left (DESIGN §6.3 step 6). */
export interface MatchEndEvent {
  t: 'matchEnd';
  winnerTeam: TeamId | null;
  completedTurns: number;
}

export type SimEvent =
  | CarveEvent
  | ExplosionEvent
  | HitEvent
  | DeathEvent
  | SpawnEvent
  | LandEvent
  | FireEvent
  | ProjectileExpireEvent
  | BeamEvent
  | MarkEvent
  | MineSpawnEvent
  | MineMoveEvent
  | MineExplodeEvent
  | PullEvent
  | TurnStartEvent
  | TurnEndEvent
  | TimerWarningEvent
  | WindChangeEvent
  | ItemUsedEvent
  | HealEvent
  | TeleportEvent
  | SuddenDeathEvent
  | SkyStrikeEvent
  | SkyLevelUpEvent
  | TornadoCaptureEvent
  | TornadoReleaseEvent
  | SkyForceEvent
  | SkyChangeEvent
  | MatchEndEvent;

export type SimEventType = SimEvent['t'];
