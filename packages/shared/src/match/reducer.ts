/**
 * The reducer: `createMatch`, `applyIntent` and `step` are the only ways MatchState
 * changes (DESIGN §1.2). Rendering reads the state and the events; it never writes.
 *
 * Two modes share the same code path: `freePlay` (the Phase 1 sandbox: any seat may act
 * at any time) and `turns`, where `rules/turn.ts` owns the state machine, the 20 s timer
 * and the delay ordering, and `applyIntent` only accepts the active seat while the turn
 * is `active` (DESIGN §2.9).
 */
import { Prng } from '../math/prng.js';
import { clamp, isFiniteNumber, quantisePower } from '../math/fixed.js';
import { cosDeg, sinDeg, RAD_TO_DEG } from '../math/trig.js';
import type { MapDef } from '../data/maps.js';
import { getMobileDef } from '../data/mobiles.js';
import type { MobileDef, ShotDef, ShotSlot } from '../data/mobiles.js';
import { generateTerrain, computeSpawnPoints } from '../terrain/generate.js';
import {
  createMobile,
  setRelAngle,
  setMoveDir,
  setAnim,
  stepMobile,
  settleOnGround,
  worldAngleDeg,
} from '../entities/mobile.js';
import type { MobileState } from '../entities/mobile.js';
import { createProjectile, launchVelocity, stepProjectile } from '../entities/projectile.js';
import type { ProjectileDef, ProjectileState } from '../entities/projectile.js';
import { getBehaviour } from '../entities/behaviours/index.js';
import type { BehaviourContext, TurnEffect } from '../entities/behaviours/index.js';
import { detonateMinesNear } from '../entities/mines.js';
import type { MineState } from '../entities/mines.js';
import { constants } from '../data/constants.js';
import { generateWind } from '../rules/wind.js';
import {
  NOT_CHARGING,
  initTurnState,
  noteShotFired,
  noteSkip,
  stepTurn,
  turnAcceptsIntent,
} from '../rules/turn.js';
import { applyDamage, computeDamage } from '../rules/damage.js';
import {
  createSkyState,
  forceDamageMultiplier,
  thorLevel,
  thorOnExplosion,
} from '../rules/sky.js';
import type { SkyEventId } from '../data/sky.js';
import { suddenDeathMultiplier } from '../rules/suddenDeath.js';
import { ssAvailable } from '../rules/delay.js';
import {
  applyUseItem,
  dualGapTicks,
  itemCarveMultiplier,
  itemDamageMultiplier,
} from '../rules/items.js';
import { validateLoadout } from '../data/items.js';
import type { ItemId } from '../data/items.js';
import type { SimEvent } from './events.js';
import type { MatchMode, MatchState, PendingSpawn, PlayerSlot, SeatSpec } from './match.js';
import { mobileOfSeat, noTurnMods, slotOfSeat } from './match.js';

// --------------------------------------------------------------------------
// Intents
// --------------------------------------------------------------------------

export interface MoveIntent {
  t: 'move';
  seat: number;
  dir: -1 | 0 | 1;
}

export interface AimIntent {
  t: 'aim';
  seat: number;
  /** Degrees relative to tilt; clamped to the mobile's own range. */
  relAngle: number;
}

export interface SelectShotIntent {
  t: 'selectShot';
  seat: number;
  shot: ShotSlot;
}

export interface FireIntent {
  t: 'fire';
  seat: number;
  shot: ShotSlot;
  relAngle: number;
  /** Power bar in [0, 1]; quantised to 1/1000 before use (DESIGN §2.10). */
  power: number;
}

/** End the turn without firing (DESIGN §2.8: same delay as a timeout). */
export interface SkipIntent {
  t: 'skip';
  seat: number;
}

/**
 * "I am holding the charge, and the bar is here." The charge itself is client-side
 * (DESIGN §2.10: only the *released* power goes on the wire), so the simulation would
 * otherwise have no idea a player was mid-charge when the timer ran out. The client
 * reports this a few times a second while Space is held; the turn machine uses the last
 * value to fire instead of skipping (DESIGN §7 item 3).
 *
 * A negative power means "no longer charging".
 */
export interface ChargingIntent {
  t: 'charging';
  seat: number;
  power: number;
}

/**
 * Use one of the seat's six items (DESIGN §4). `target` is only read by Teleport.
 *
 * The server validates it with `canUseItem` and broadcasts the authoritative
 * `itemUsed` with the tick it applied it on; every client applies exactly this intent at
 * that tick, the same way it applies `fire` (DESIGN §6.2).
 */
export interface UseItemIntent {
  t: 'useItem';
  seat: number;
  itemId: ItemId;
  target?: { x: number; y: number };
}

/**
 * The seat gives up: its mobile dies where it stands. Not a player action — the server
 * broadcasts it when a disconnected player's reconnect grace expires (DESIGN §6.4) and
 * every engine applies it identically, which is why it is an intent and not a
 * server-only mutation. It is the one intent the turn gate does not filter: it arrives
 * for a seat that is by definition not the one playing, in whatever phase the match
 * happens to be in.
 */
export interface ForfeitIntent {
  t: 'forfeit';
  seat: number;
}

export type Intent =
  | MoveIntent
  | AimIntent
  | SelectShotIntent
  | FireIntent
  | SkipIntent
  | ChargingIntent
  | UseItemIntent
  | ForfeitIntent;

// --------------------------------------------------------------------------
// Creation
// --------------------------------------------------------------------------

/** `lastShotPower` for a seat that has not fired yet (the HUD draws no marker). */
export const NO_SHOT_YET = -1;

export interface CreateMatchOptions {
  mode?: MatchMode;
  /**
   * The sky event rolled for this match (DESIGN §5). The server rolls it off the
   * room's stream and puts it in `matchStart`, so every engine passes the same id here
   * and builds the same column, band and satellite. Omitted means `none`.
   */
  skyEvent?: SkyEventId;
  /**
   * Pin the sky: `skyEvent` stays for the whole match and no weather comes or goes
   * (DESIGN §5). The server sets it under `SKY_EVENT` and says so in `matchStart`.
   */
  skyStatic?: boolean;
}

/**
 * Build a match. Deterministic in (seed, map, seats): two engines given the same
 * arguments produce byte-identical state, which is what `matchStart` relies on.
 */
export function createMatch(
  seed: number,
  map: MapDef,
  seats: SeatSpec[],
  options: CreateMatchOptions = {},
): MatchState {
  const rng = Prng.seed(seed);

  // Terrain runs on its own stream so that map generation never shifts the gameplay
  // stream when the map changes size or style.
  const terrainSeed =
    map.source.kind === 'procedural'
      ? (seed ^ Math.imul(map.source.seed, 0x9e3779b1)) >>> 0
      : seed >>> 0;
  const terrain = generateTerrain(map, Prng.seed(terrainSeed));
  const spawns = computeSpawnPoints(terrain, seats.length, Prng.seed((terrainSeed ^ 0x5bf03635) >>> 0));
  // The columns the seats start in. The tornado is placed clear of them (DESIGN §7
  // item 129); nothing else reads them, and they are derived from (seed, map, seats)
  // like the spawns themselves, so they are not state and are not hashed.
  const spawnXs = spawns.map((s) => s.x);

  const slots: PlayerSlot[] = [];
  const mobiles: MobileState[] = [];
  for (let i = 0; i < seats.length; i++) {
    const spec = seats[i];
    if (!spec) continue;
    const def = getMobileDef(spec.mobileId);
    const spawn = spawns[i] ?? { x: terrain.width / 2, y: 0 };
    const facing: -1 | 1 = spawn.x > terrain.width / 2 ? -1 : 1;
    const mobile = createMobile(i, spec.mobileId, spec.team, def, spawn.x, spawn.y, facing);
    settleOnGround(mobile, def, terrain);
    mobiles.push(mobile);
    slots.push({
      seat: i,
      playerId: spec.playerId,
      nick: spec.nick,
      team: spec.team,
      mobileId: spec.mobileId,
      delay: 0,
      ssGauge: 0,
      shot: 's1',
      // The room's loadout, trimmed to the six slots (DESIGN §4). Fixed for the match.
      items: validateLoadout(spec.items),
      itemsUsed: [],
      connected: true,
    });
  }

  const lastShotPower: number[] = [];
  for (let i = 0; i < slots.length; i++) lastShotPower.push(NO_SHOT_YET);

  const state: MatchState = {
    seed,
    mode: options.mode ?? 'freePlay',
    map,
    terrain,
    wind: generateWind(rng),
    rng,
    tick: 0,
    turn: 0,
    completedTurns: 0,
    phase: 'active',
    turnTicksLeft: 0,
    turnStartTick: 0,
    pendingDelay: 0,
    turnMods: noTurnMods(),
    chargingPower: NOT_CHARGING,
    lastShotPower,
    winnerTeam: null,
    activeSeat: 0,
    seats: slots,
    mobiles,
    projectiles: [],
    pendingSpawns: [],
    turnEffects: [],
    mines: [],
    nextProjectileId: 1,
    nextMineId: 1,
    // The rolled sky event (DESIGN §5). Its placement and duration are drawn from its
    // own stream seeded off `seed`, never from `rng`, so a match with a tornado leaves
    // the match PRNG exactly where a match without one does (DESIGN §7 item 39).
    sky: createSkyState(
      options.skyEvent ?? 'none',
      seed,
      { width: map.width, height: map.height },
      spawnXs,
      !(options.skyStatic ?? false),
    ),
    skyStatic: options.skyStatic ?? false,
    get skyEventId(): SkyEventId {
      return this.sky.kind;
    },
    set skyEventId(id: SkyEventId) {
      // The same spawn columns the constructor used, closed over rather than stored, so
      // an engine told the event only after `createMatch` lands on the same column.
      this.sky = createSkyState(
        id,
        this.seed,
        { width: this.map.width, height: this.map.height },
        spawnXs,
        !this.skyStatic,
      );
    },
    events: [],
  };

  // A `turns` match starts at the gate: the first `step()` opens turn 1 and emits
  // `turnStart`. A `freePlay` match stays in `active` forever and ignores the machine.
  initTurnState(state);
  return state;
}

export function defOfSeat(state: MatchState, seat: number): MobileDef | undefined {
  const m = mobileOfSeat(state, seat);
  if (!m) return undefined;
  return getMobileDef(m.defId);
}

// --------------------------------------------------------------------------
// Behaviour context
// --------------------------------------------------------------------------

/**
 * Damage every living mobile by a distance function, which is the one place the damage
 * table, the shield, the defence debuff and the SS gauge are applied. `damageArea` uses
 * the distance to a point; `beamStrike` uses the distance to a vertical segment.
 */
function damageMobiles(
  state: MatchState,
  events: SimEvent[],
  def: ProjectileDef,
  ownerSeat: number,
  distanceTo: (m: MobileState, targetDef: MobileDef) => number,
): void {
  // Sudden death counts *completed* turns (DESIGN §2.9, §7 item 11); the item
  // multiplier is Bunge's ×0.7 or Power Up's ×1.5, and only for the seat whose turn
  // paid for them (DESIGN §4). Both are one number by the time damage is computed, so
  // every body of a volley, every shard and every bolt is covered by one rule.
  const extra =
    suddenDeathMultiplier(state.completedTurns) * itemDamageMultiplier(state, ownerSeat);
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m || !m.alive) continue;
    const targetDef = getMobileDef(m.defId);
    const dist = distanceTo(m, targetDef);
    const amount = computeDamage(
      def.damage,
      dist,
      def.damageRadius,
      def.damageType,
      targetDef,
      m,
      { extra },
    );
    if (amount <= 0) continue;
    const applied = applyDamage(m, amount, def.shieldDamageMultiplier ?? 1);
    setAnim(m, 'hurt');
    // A chilling shot stacks a defence debuff on whatever it damaged (DESIGN §2.6,
    // §3 ice). It is capped here and thaws at the victim's own turn start (turn.ts);
    // the hit that applies it is not boosted by it.
    const debuff = def.defenceDebuff ?? 0;
    if (debuff > 0) {
      m.defenceMod = Math.min(constants.debuff.max, m.defenceMod + debuff);
    }
    // +1 SS gauge per hit taken (DESIGN §2.9, §7 item 1).
    const victim = slotOfSeat(state, m.seat);
    if (victim) victim.ssGauge += constants.ss.gainPerHitTaken;
    events.push({
      t: 'hit',
      seat: m.seat,
      x: m.x,
      y: m.y,
      amount: applied.amount,
      shieldAbsorbed: applied.shieldAbsorbed,
      hpLost: applied.hpLost,
      damageType: def.damageType,
      ownerSeat,
    });
    if (applied.died) {
      setAnim(m, 'death');
      events.push({ t: 'death', seat: m.seat, x: m.x, y: m.y, cause: 'damage' });
    }
  }
}

/** Centre of a mobile's hull, which is what an explosion measures its distance to. */
function centreOf(m: MobileState, def: MobileDef): { x: number; y: number } {
  return { x: m.x, y: m.y - def.footprint.h / 2 };
}

function makeContext(state: MatchState, events: SimEvent[]): BehaviourContext {
  /**
   * Re-entry latch for {@link detonateMinesNear} (DESIGN §3: "Any explosion within its
   * radius detonates it"). A mine's own blast damages through `damageArea` again and a
   * mine sits inside its own radius, so without the latch the first mine would set
   * itself off forever. The chain between mines is `detonateMine`'s own business and is
   * unaffected.
   */
  let resolvingMines = false;
  const triggerMines = (x: number, y: number): void => {
    if (resolvingMines) return;
    resolvingMines = true;
    detonateMinesNear(state, ctx, x, y);
    resolvingMines = false;
  };

  /**
   * The same latch for Thor (DESIGN §5). A triggered beam damages through
   * `beamStrike`, which can set a mine off, whose blast is another explosion — and the
   * satellite would answer its own strike for as long as there were mines left. One
   * explosion calls down at most one beam.
   */
  let resolvingThor = false;
  const triggerThor = (x: number, y: number, ownerSeat: number): void => {
    if (resolvingThor) return;
    resolvingThor = true;
    thorOnExplosion(state, ctx, x, y, ownerSeat);
    resolvingThor = false;
  };

  const ctx: BehaviourContext = {
    // Getters, not copies: the context is built once per `step()` and the turn machine
    // moves both of these before the turn hooks run.
    get tick(): number {
      return state.tick;
    },
    get activeSeat(): number {
      return state.activeSeat;
    },
    rng: state.rng,
    wind: state.wind,
    terrain: state.terrain,
    bounds: { width: state.map.width, height: state.map.height },
    mobiles: state.mobiles,
    // A getter: `detonateMinesNear` replaces `state.mines` with a filtered array, and a
    // context that had captured the old one would keep walking mines that are gone.
    get mines(): MineState[] {
      return state.mines;
    },
    defOf: (seat) => defOfSeat(state, seat),
    spawn: (def, x, y, vx, vy, ownerSeat, data) => {
      const p = createProjectile(state.nextProjectileId++, def, ownerSeat, x, y, vx, vy, data);
      state.projectiles.push(p);
      events.push({ t: 'spawn', id: p.id, ownerSeat, sprite: def.sprite, x, y, vx, vy });
      // Every projectile in the game is born here, so this is the one place the
      // `onSpawn` hook has to run (DESIGN §2.5): behaviours initialise their scratch
      // data in it (orbit's centre of mass, weave's phase, converge's flip timer).
      getBehaviour(def.behaviour)?.onSpawn?.(p, ctx);
      return p;
    },
    explode: (p, x, y, defOverride) => {
      const merged: ProjectileDef = defOverride ? { ...p.def, ...defOverride } : p.def;
      // A shell that crossed the Force band hits for `sky.force.multiplier` more
      // (DESIGN §5, §2.6). It is keyed off the projectile's own flag rather than the
      // seat's, which is what makes it survive a def override and a behaviour that
      // explodes by hand.
      const force = forceDamageMultiplier(state.sky, p);
      const def: ProjectileDef =
        force === 1 ? merged : { ...merged, damage: merged.damage * force };
      // Bunge widens the crater of everything the active seat set off this turn
      // (DESIGN §4). Applied here rather than on the fired def so that a shot which
      // splits, shatters or bursts carries it into every piece.
      const carveRadius = def.carveRadius * itemCarveMultiplier(state, p.ownerSeat);
      ctx.carve(x, y, carveRadius);
      events.push({
        t: 'explosion',
        x,
        y,
        radius: def.damageRadius,
        carveRadius,
        damageType: def.damageType,
        ownerSeat: p.ownerSeat,
      });
      ctx.damageArea(x, y, def, p.ownerSeat);
    },
    forceMultiplier: (p) => forceDamageMultiplier(state.sky, p),
    carve: (x, y, r) => {
      const circle = state.terrain.carve(x, y, r);
      events.push({ t: 'carve', x: circle.x, y: circle.y, r: circle.r });
    },
    damageArea: (x, y, def, ownerSeat) => {
      damageMobiles(state, events, def, ownerSeat, (m, targetDef) => {
        const c = centreOf(m, targetDef);
        const dx = c.x - x;
        const dy = c.y - y;
        return Math.sqrt(dx * dx + dy * dy);
      });
      // Every blast in the game lands here — the default explode, a bolt, a satellite
      // beam, a mine — so this is the one place that can honour DESIGN §3's "any
      // explosion within its radius detonates it". `minesShakenLoose` stays as the
      // turn-end fallback for a mine left hanging by a carve that was not a blast.
      triggerMines(x, y);
      // …and the one place Thor can watch the whole game from (DESIGN §5): every blast
      // in the game lands here, so "any explosion within `triggerRadius` of an enemy"
      // is one hook rather than one per behaviour. A beam's own damage does not come
      // through `damageArea`, so a strike cannot call down another.
      triggerThor(x, y, ownerSeat);
    },
    /**
     * A vertical column of light (DESIGN §3: lightning, asate, aduka/Thor, knight).
     * The column is carved as overlapping circles of `width / 2` spaced one radius
     * apart — the terrain has no column primitive and a beam is rare — then every
     * mobile is damaged by its distance to the segment, so one standing in the beam
     * takes the centre value and one beside it takes the falloff.
     *
     * The `beam` event's `kind` is the def's sprite key, which is how the renderer
     * tells a bolt from a satellite beam without knowing either mobile.
     */
    beamStrike: (x, y, fromY, width, def, ownerSeat) => {
      const owner = ownerSeat ?? state.activeSeat;
      const top = Math.min(fromY, y);
      const bottom = Math.max(fromY, y);
      const radius = Math.max(1, width / 2);
      events.push({
        t: 'beam',
        x1: x,
        y1: fromY,
        x2: x,
        y2: y,
        width,
        kind: def.sprite,
        ownerSeat: owner,
      });
      for (let sy = top; sy < bottom; sy += radius) ctx.carve(x, sy, radius);
      ctx.carve(x, bottom, radius);
      damageMobiles(state, events, def, owner, (m, targetDef) => {
        const c = centreOf(m, targetDef);
        const dx = c.x - x;
        const dy = c.y < top ? c.y - top : c.y > bottom ? c.y - bottom : 0;
        return Math.sqrt(dx * dx + dy * dy);
      });
      // A beam does not go through `damageArea`, so it triggers mines at its foot.
      triggerMines(x, bottom);
    },
    applyImpulse: (seat, dx, dy) => {
      const m = mobileOfSeat(state, seat);
      if (!m || !m.alive) return;
      // An impulse is a velocity, not a teleport: the mobile leaves the ground and
      // `stepMobile` flies it (DESIGN §2.4). `vx` dies on landing.
      const cap = constants.mobile.maxLaunchSpeedX;
      m.vx = clamp(m.vx + dx, -cap, cap);
      m.vy += dy;
      m.grounded = false;
    },
    mark: (x, y, ticksUntil, payload) => {
      const kind = payload.kind ?? 'mark';
      const delay = ticksUntil > 0 ? Math.floor(ticksUntil) : 0;
      // The shot's owner when the caller knows it, the active seat otherwise; the two
      // differ in `freePlay`, where a seat can fire before someone else's mark is due.
      const ownerSeat = payload.ownerSeat ?? state.activeSeat;
      state.turnEffects.push({
        kind,
        atTick: state.tick + delay,
        ownerSeat,
        behaviour: payload.behaviour,
        // `skyThorLevel` is the satellite's level at the moment the point was marked
        // (DESIGN §5): a behaviour only ever sees the context, so this is how aduka's
        // call-in reaches the match's Thor rather than the level-1 default (§7 item 9).
        // A behaviour that does not know the name ignores it, and it stays numeric, so
        // the effect is still hash-safe.
        data: { ...(payload.data ?? {}), x, y, skyThorLevel: thorLevel(state) },
      });
      events.push({
        t: 'mark',
        x,
        y,
        kind,
        ownerSeat,
        ticksUntil: delay,
      });
    },
    addMine: (mine: MineState) => {
      mine.id = state.nextMineId++;
      state.mines.push(mine);
      events.push({
        t: 'mineSpawn',
        id: mine.id,
        ownerSeat: mine.ownerSeat,
        x: mine.x,
        y: mine.y,
        sprite: mine.sprite,
      });
    },
    emit: (event) => {
      events.push(event);
    },
    scheduleTurnEffect: (effect: TurnEffect) => {
      state.turnEffects.push(effect);
    },
  };
  return ctx;
}

// --------------------------------------------------------------------------
// Intents
// --------------------------------------------------------------------------

/**
 * Muzzle position for a shot: the sprite's barrel pivot (mirrored by facing, rotated by
 * the hull tilt) plus the barrel length along the aim. The sprite is the single source
 * of this geometry, so the drawn barrel, the aim line and the spawn point agree.
 */
export function muzzlePosition(
  m: MobileState,
  def: MobileDef,
  angleDeg: number,
): { x: number; y: number } {
  const sprite = def.sprite;
  const localX = (sprite.barrelPivot.x - sprite.anchor.x) * m.facing;
  const localY = sprite.barrelPivot.y - sprite.anchor.y;
  const tiltDegrees = m.tilt * RAD_TO_DEG;
  const c = cosDeg(tiltDegrees);
  const s = sinDeg(tiltDegrees);
  const pivotX = m.x + localX * c - localY * s;
  const pivotY = m.y + localX * s + localY * c;
  return {
    x: pivotX + cosDeg(angleDeg) * sprite.barrelLength,
    y: pivotY - sinDeg(angleDeg) * sprite.barrelLength,
  };
}

/**
 * Put one volley in the air from `m`'s muzzle.
 *
 * `delayTicks` is Dual's gap (DESIGN §4): a volley that is not due yet goes into
 * `pendingSpawns` in its entirety, which is the same queue a staggered multi-shot
 * already uses — so the second volley is spawned through `ctx.spawn` on the tick it is
 * due, runs its behaviour's `onSpawn` there, and keeps `isSettled` false until it has
 * resolved, with no new machinery at all.
 */
function fireShot(
  state: MatchState,
  ctx: BehaviourContext,
  m: MobileState,
  def: MobileDef,
  shot: ShotDef,
  power: number,
  events: SimEvent[],
  delayTicks = 0,
): void {
  const angleDeg = worldAngleDeg(m, m.relAngle);
  const muzzle = muzzlePosition(m, def, angleDeg);
  const count = shot.count ?? 1;
  const spread = shot.spreadDeg ?? 0;
  const stagger = shot.stagger ?? 0;

  for (let i = 0; i < count; i++) {
    // Fan the projectiles symmetrically around the aim.
    const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
    const v = launchVelocity(shot.projectile, angleDeg + offset, power);
    const at = delayTicks + (stagger > 0 ? stagger * i : 0);
    if (at > 0) {
      const pending: PendingSpawn = {
        atTick: state.tick + at,
        def: shot.projectile,
        ownerSeat: m.seat,
        x: muzzle.x,
        y: muzzle.y,
        vx: v.vx,
        vy: v.vy,
      };
      state.pendingSpawns.push(pending);
    } else {
      // Through the context, so the behaviour's `onSpawn` runs here too.
      ctx.spawn(shot.projectile, muzzle.x, muzzle.y, v.vx, v.vy, m.seat);
    }
  }

  // A queued second volley is the same trigger pull, so it plays no second fire
  // animation and emits no second `fire` event: the muzzle flash would be drawn now and
  // the shells would leave twenty ticks later. Its `spawn` events are what the renderer
  // and the camera follow.
  if (delayTicks > 0) return;
  setAnim(m, 'fire');
  events.push({
    t: 'fire',
    seat: m.seat,
    shot: state.seats[m.seat]?.shot ?? 's1',
    power,
    angleDeg,
    x: muzzle.x,
    y: muzzle.y,
  });
}

/**
 * Fire `seat`'s shot, from wherever the order came from: a `fire` intent, or the turn
 * timer expiring mid-charge. Returns false when there is nothing to fire.
 */
function performFire(
  state: MatchState,
  events: SimEvent[],
  seat: number,
  slotKey: ShotSlot,
  power: number,
): boolean {
  const m = mobileOfSeat(state, seat);
  if (!m || !m.alive) return false;
  const def = getMobileDef(m.defId);
  // Dual+ is "S1 then S2" (DESIGN §4), whatever was selected: it replaces the shot, it
  // does not add to it, so the first volley is S1 and the delay banked is S1's.
  const dualPlus = state.turnMods.dualPlus;
  const firstKey: ShotSlot = dualPlus ? 's1' : slotKey;
  const shot = def.shots[firstKey];
  if (!shot) return false;
  // The SS gate (DESIGN §2.9, §7 item 21). Refusing here covers every route to a shot —
  // the `fire` intent and the turn machine's own expiry-fires-the-charge — and returning
  // false makes the expiry fall back to a skip instead of hanging on a dead timer.
  if (firstKey === 'ss' && !ssAvailable(state, seat)) return false;

  const slot = slotOfSeat(state, seat);
  if (slot) slot.shot = firstKey;
  state.activeSeat = seat;
  setMoveDir(m, 0);
  const ctx = makeContext(state, events);
  fireShot(state, ctx, m, def, shot, power, events);

  // The second volley of Dual / Dual+ (DESIGN §4): same muzzle, same angle, same power,
  // `constants.items.dualGapTicks` later. Queued before `noteShotFired` so the turn is
  // already waiting on it when the machine moves to `resolving`.
  const secondKey: ShotSlot | null = dualPlus ? 's2' : state.turnMods.dual ? firstKey : null;
  if (secondKey) {
    const second = def.shots[secondKey];
    if (second) fireShot(state, ctx, m, def, second, power, events, dualGapTicks());
  }

  // Using the SS spends the gauge (DESIGN §7 item 1). Only the slot that was actually
  // fired pays: Dual+'s S2 half is not an SS however the player had it selected.
  //
  // The selection drops back to S1 with it. A seat left selecting an SS it can no
  // longer fire has a dead fire button on its next turn — the intent is refused, the
  // HUD's own gate raises "SS NOT READY", and a charge that runs into the timer expiry
  // (which fires `slot.shot`, §7 item 36) becomes a skip. Done here, inside the sim, so
  // every engine reaches it from the same broadcast `fire`.
  if (firstKey === 'ss' && slot) {
    slot.ssGauge = 0;
    // Asked rather than assumed, so free play (where the gate is off, §7 item 91) keeps
    // the SS selected and the sandbox can fire it again without pressing Tab.
    if (!ssAvailable(state, seat)) slot.shot = 's1';
  }

  state.lastShotPower[seat] = power;
  // In `turns` mode this banks the shot's delay and hands the turn to `resolving`.
  noteShotFired(state, shot);
  return true;
}

/** Kill a seat's mobile where it stands, with no damage, no shield and no delay. */
function forfeit(state: MatchState, events: SimEvent[], seat: number): void {
  const m = mobileOfSeat(state, seat);
  if (!m || !m.alive) return;
  setMoveDir(m, 0);
  m.hp = 0;
  m.shield = 0;
  m.alive = false;
  setAnim(m, 'death');
  events.push({ t: 'death', seat, x: m.x, y: m.y, cause: 'forfeit' });
}

/**
 * Apply one player intent. Returns the events it produced (a fire produces a `fire` and
 * a `spawn`; the rest are silent) — that return value is the only place they appear, so
 * `state.events` keeps meaning "the events of the most recent `step()`".
 *
 * In `turns` mode an intent from anyone but the active seat, or from the active seat
 * outside the `active` phase, is dropped here (DESIGN §2.9). Free play accepts
 * everything, which is what lets the sandbox drive both mobiles from one keyboard.
 *
 * Invalid intents are ignored, never thrown: the server validates, and a client
 * replaying a stream must not crash on a stale message. "Invalid" includes an unknown
 * shot slot and a non-finite angle or power, both of which are reachable from a
 * malformed JSON message and would otherwise freeze or kill the match on every client.
 */
export function applyIntent(state: MatchState, intent: Intent): SimEvent[] {
  const events: SimEvent[] = [];
  // Before every gate: a forfeit is not a turn action (DESIGN §6.4). The turn machine
  // then does the rest on its own — a dead active seat ends its turn (§7 item 33) and a
  // team without a living mobile ends the match.
  if (intent.t === 'forfeit') {
    forfeit(state, events, intent.seat);
    return events;
  }
  const m = mobileOfSeat(state, intent.seat);
  if (!m || !m.alive) return events;
  if (!turnAcceptsIntent(state, intent.seat)) return events;
  const def = getMobileDef(m.defId);
  const slot = slotOfSeat(state, intent.seat);

  switch (intent.t) {
    case 'move':
      setMoveDir(m, intent.dir);
      break;
    case 'aim':
      if (!isFiniteNumber(intent.relAngle)) break;
      setRelAngle(m, def, intent.relAngle);
      break;
    case 'selectShot':
      // A selection the gate would refuse is ignored outright rather than accepted and
      // refused at the trigger: the timer expiry fires `slot.shot` (DESIGN §7 item 36),
      // so a stored-but-illegal SS would turn into a skip at the worst moment.
      if (intent.shot === 'ss' && !ssAvailable(state, intent.seat)) break;
      if (slot && def.shots[intent.shot]) slot.shot = intent.shot;
      break;
    case 'useItem':
      applyUseItem(state, events, intent.seat, intent.itemId, intent.target);
      break;
    case 'charging':
      // Not a mutation of the world, just the client telling us where its bar is.
      state.chargingPower =
        isFiniteNumber(intent.power) && intent.power >= 0
          ? quantisePower(intent.power)
          : NOT_CHARGING;
      break;
    case 'skip':
      setMoveDir(m, 0);
      state.chargingPower = NOT_CHARGING;
      noteSkip(state);
      break;
    case 'fire': {
      if (!def.shots[intent.shot]) break;
      if (!isFiniteNumber(intent.relAngle) || !isFiniteNumber(intent.power)) break;
      setRelAngle(m, def, intent.relAngle);
      state.chargingPower = NOT_CHARGING;
      performFire(state, events, intent.seat, intent.shot, quantisePower(intent.power));
      break;
    }
  }

  return events;
}

// --------------------------------------------------------------------------
// Step
// --------------------------------------------------------------------------

/**
 * Advance the simulation one tick and return everything that happened. Order is fixed
 * and must not change: pending spawns, projectiles (by id), mobiles (by seat).
 */
export function step(state: MatchState): SimEvent[] {
  const events: SimEvent[] = [];
  state.events = events;
  const ctx = makeContext(state, events);

  // --- pending spawns -----------------------------------------------------
  if (state.pendingSpawns.length > 0) {
    const remaining: PendingSpawn[] = [];
    for (let i = 0; i < state.pendingSpawns.length; i++) {
      const s = state.pendingSpawns[i];
      if (!s) continue;
      if (s.atTick <= state.tick) {
        ctx.spawn(s.def, s.x, s.y, s.vx, s.vy, s.ownerSeat);
      } else {
        remaining.push(s);
      }
    }
    state.pendingSpawns = remaining;
  }

  // --- projectiles --------------------------------------------------------
  for (let i = 0; i < state.projectiles.length; i++) {
    const p = state.projectiles[i];
    if (!p || !p.alive) continue;
    stepProjectile(p, ctx, state.sky);
  }
  if (state.projectiles.some((p) => !p.alive)) {
    state.projectiles = state.projectiles.filter((p): p is ProjectileState => p.alive);
  }

  // --- scheduled turn effects ---------------------------------------------
  // A due effect calls back into the behaviour that scheduled it (`onTurnEffect`) —
  // this is how a mark becomes a bolt, a satellite beam or a falling sword. The effect
  // is retired either way, so an effect whose behaviour has no hook simply disappears
  // and the turn can resolve. Chaining is done by scheduling another effect.
  if (state.turnEffects.length > 0) {
    const pendingEffects: TurnEffect[] = [];
    const due: TurnEffect[] = [];
    for (let i = 0; i < state.turnEffects.length; i++) {
      const effect = state.turnEffects[i];
      if (!effect) continue;
      if (effect.atTick > state.tick) pendingEffects.push(effect);
      else due.push(effect);
    }
    state.turnEffects = pendingEffects;
    for (let i = 0; i < due.length; i++) {
      const effect = due[i];
      if (!effect) continue;
      getBehaviour(effect.behaviour)?.onTurnEffect?.(effect, ctx);
    }
  }

  // --- mobiles ------------------------------------------------------------
  const refillGauge = state.mode === 'freePlay';
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m) continue;
    stepMobile(m, getMobileDef(m.defId), {
      terrain: state.terrain,
      mapHeight: state.map.height,
      emit: (e) => events.push(e),
      refillGauge,
    });
  }

  // --- turn machine -------------------------------------------------------
  // Last, so that `isSettled` sees this tick's projectiles and landings and the turn
  // resolves on the tick it actually finished (DESIGN §2.9). A no-op in free play.
  stepTurn(state, events, {
    ctx,
    fire: (seat, power) => {
      const slot = slotOfSeat(state, seat);
      return performFire(state, events, seat, slot ? slot.shot : 's1', quantisePower(power));
    },
  });

  state.tick++;
  return events;
}

/** Roll a new wind from the match stream (wind change item, Phase 2 turn schedule). */
export function rerollWind(state: MatchState): void {
  state.wind = generateWind(state.rng);
}
