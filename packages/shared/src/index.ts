/**
 * @gunbros/shared — the entire game simulation.
 *
 * Zero DOM, zero Node, zero `Math.random`: everything here runs identically in every
 * browser and on the server (DESIGN §1.2, §2.1). The client imports this module as TS
 * source through Vite; the server builds it to `dist` first.
 *
 * The three entry points the client needs are `createMatch`, `applyIntent` and `step`.
 */

// --- math -----------------------------------------------------------------
export { Prng, seedState } from './math/prng.js';
export type { PrngState } from './math/prng.js';
export {
  sin,
  cos,
  tan,
  atan,
  atan2,
  sinDeg,
  cosDeg,
  degToRad,
  radToDeg,
  wrapDeg,
  wrapRad,
  PI,
  TWO_PI,
  HALF_PI,
  QUARTER_PI,
  DEG_TO_RAD,
  RAD_TO_DEG,
} from './math/trig.js';
export { q8, fromQ8, snapQ8, quantisePower, clamp, isFiniteNumber } from './math/fixed.js';
export * as vec from './math/vec.js';
export type { Vec2 } from './math/vec.js';

// --- terrain --------------------------------------------------------------
export { Terrain, AIR, SOLID, NO_GROUND } from './terrain/terrain.js';
export type { CarveCircle } from './terrain/terrain.js';
export { encodeRle, decodeRle } from './terrain/codec.js';
export {
  generateMap,
  generateTerrain,
  generateStyle,
  generateHills,
  generatePit,
  generateIslands,
  generateCave,
  computeSpawnPoints,
} from './terrain/generate.js';
export type { GeneratedMap, SpawnPoint } from './terrain/generate.js';

// --- entities -------------------------------------------------------------
export {
  createMobile,
  stepMobile,
  settleOnGround,
  setAnim,
  setMoveDir,
  setRelAngle,
  trueAngleDeg,
  worldAngleDeg,
  tiltDeg,
  solidUnderFootprint,
} from './entities/mobile.js';
export type { MobileState, MobileAnim, MobileStepContext, TeamId } from './entities/mobile.js';
export { createProjectile, launchVelocity, stepProjectile } from './entities/projectile.js';
export type { ProjectileDef, ProjectileState, TrailKind } from './entities/projectile.js';
export {
  registerBehaviour,
  getBehaviour,
  behaviourKeys,
  basicBehaviour,
} from './entities/behaviours/index.js';
export type {
  Behaviour,
  BehaviourContext,
  ImpactInfo,
  MarkPayload,
  TurnEffect,
  WorldBounds,
} from './entities/behaviours/index.js';
export {
  createMine,
  snapshotMines,
  minesFromSnapshot,
  quantiseMines,
  hashMines,
  MINE_TURN_HOOK,
} from './entities/mines.js';
export type { MineState, MineSpec, MineSnapshot } from './entities/mines.js';

// --- rules ----------------------------------------------------------------
export { generateWind, makeWind, windVector, windChangesOnTurn } from './rules/wind.js';
export type { WindState } from './rules/wind.js';
export {
  shotDelay,
  skipDelay,
  timeDelay,
  itemDelay,
  turnDelayCost,
  addDelay,
  canTakeTurn,
  nextSeat,
  upcomingOrder,
  ssReady,
  ssAvailable,
} from './rules/delay.js';
export type { TurnCost } from './rules/delay.js';
// The turn machine itself is driven by `step()`; only its read-only helpers are public,
// so `step` and `applyIntent` stay the only two mutators (DESIGN §1.2).
export {
  turnAcceptsIntent,
  ticksUsed,
  secondsLeft,
  registerTurnHook,
  turnHookKeys,
  NOT_CHARGING,
} from './rules/turn.js';
export type { TurnHook } from './rules/turn.js';
export {
  canUseItem,
  applyUseItem,
  checkTeleportTarget,
  itemsRemaining,
  itemDamageMultiplier,
  itemCarveMultiplier,
  dualGapTicks,
  resetTurnMods,
} from './rules/items.js';
export type { ItemCheck, ItemCheckOk, ItemCheckFail, ItemRejection, ItemTarget } from './rules/items.js';
export {
  suddenDeathLevel,
  suddenDeathMultiplier,
  suddenDeathMultiplierForLevel,
  suddenDeathStartTurn,
} from './rules/suddenDeath.js';
export {
  thorStrike,
  thorLevel,
  thorLevelForHits,
  defaultThorLevel,
  rollSkyEvent,
  createSkyState,
  noSkyState,
  thorOnExplosion,
  stepProjectileSky,
  forceDamageMultiplier,
  forceMultiplierForFlag,
  insideForceBand,
  insideTornado,
  advanceWeather,
  rollWeatherEvent,
} from './rules/sky.js';
export type { ThorStrikeOptions, SkyState, SkyBounds } from './rules/sky.js';
export {
  falloff,
  typeMultiplier,
  computeDamage,
  applyDamage,
  noMultipliers,
} from './rules/damage.js';
export type { DamageApplication, DamageMultipliers } from './rules/damage.js';

// --- match ----------------------------------------------------------------
export {
  createMatch,
  applyIntent,
  step,
  rerollWind,
  defOfSeat,
  muzzlePosition,
} from './match/reducer.js';
export { NO_SHOT_YET } from './match/reducer.js';
export type {
  Intent,
  MoveIntent,
  AimIntent,
  SelectShotIntent,
  FireIntent,
  SkipIntent,
  ChargingIntent,
  UseItemIntent,
  ForfeitIntent,
  CreateMatchOptions,
} from './match/reducer.js';
export {
  mobileOfSeat,
  slotOfSeat,
  livingTeams,
  isSettled,
  turnPhases,
  turnPhaseIndex,
  noTurnMods,
} from './match/match.js';
export type {
  MatchState,
  MatchMode,
  TurnPhase,
  PlayerSlot,
  SeatSpec,
  PendingSpawn,
  TurnMods,
} from './match/match.js';
export {
  hashState,
  takeSnapshot,
  snapshotForTurnEnd,
  applySnapshot,
  quantiseState,
  mixU32,
} from './match/snapshot.js';
export type { Snapshot, MobileSnapshot, SkySnapshot } from './match/snapshot.js';
export { cloneMatchState } from './match/clone.js';
export type {
  SimEvent,
  SimEventType,
  CarveEvent,
  ExplosionEvent,
  HitEvent,
  DeathEvent,
  SpawnEvent,
  LandEvent,
  FireEvent,
  ProjectileExpireEvent,
  BeamEvent,
  MarkEvent,
  MineSpawnEvent,
  MineMoveEvent,
  MineExplodeEvent,
  PullEvent,
  TurnStartEvent,
  TurnEndEvent,
  TimerWarningEvent,
  WindChangeEvent,
  ItemUsedEvent,
  HealEvent,
  TeleportEvent,
  SuddenDeathEvent,
  MatchEndEvent,
} from './match/events.js';

// --- data -----------------------------------------------------------------
export { constants } from './data/constants.js';
export { damageTable, damageTypes, mobileClasses, damageRules } from './data/damageTable.js';
export type { DamageType, MobileClass } from './data/damageTable.js';
export {
  armor,
  mobileDefs,
  mobileIds,
  defOf,
  getMobileDef,
  isMobileImplemented,
  isPickableMobile,
  pickableMobiles,
  randomWeights,
  randomMobileId,
  randomPickWeightTotal,
  shotSlots,
} from './data/mobiles/index.js';
export type { MobileDef, MobileId, ShotDef, ShotSlot } from './data/mobiles/index.js';
export {
  maps,
  hillsMap,
  pitMap,
  islandsMap,
  caveMap,
  getMapDef,
  mapOrder,
  terrainGen,
  spawnGen,
} from './data/maps.js';
export type {
  MapDef,
  MapId,
  MapSource,
  MapArt,
  TerrainStyle,
  ParallaxLayer,
  DrawnLayer,
  PlateLayer,
  TerrainPalette,
  TerrainTones,
} from './data/maps.js';
export {
  itemDefs,
  itemIds,
  itemSlots,
  getItemDef,
  findItemDef,
  isItemId,
  loadoutSlots,
  canAddToLoadout,
  validateLoadout,
} from './data/items.js';
export type { ItemDef, ItemId } from './data/items.js';
export {
  sky,
  totalSkyWeight,
  skyEventIds,
  skyEventIndex,
  isSkyEventId,
} from './data/sky.js';
export type { SkyEventId, SkyRollEntry } from './data/sky.js';

export { bots, botDifficulties, isBotDifficulty } from './data/bots.js';
export type { BotDifficulty, BotDifficultyDef } from './data/bots.js';

// --- practice bots (DESIGN §11) -------------------------------------------
export {
  planShot,
  refineShot,
  simulateWalk,
  walkPositions,
  evaluateShot,
  chooseShot,
  fallbackShot,
  facingsTowardEnemies,
} from './bot/planner.js';
export type { BotShot, BotWalk, BotPosition, ScoredShot, BotPlan, PlanOptions } from './bot/planner.js';
export { scoreShot, vitalsOf, blastPoints } from './bot/score.js';
export type { Vitals } from './bot/score.js';

// --- sprites --------------------------------------------------------------
export {
  animNames,
  paletteIndexOf,
  decodeFrame,
  validatePixelSprite,
  animDurationTicks,
  TRANSPARENT,
} from './sprites/pixelArt.js';
export type {
  SpriteRef,
  PixelSpriteRef,
  PngSpriteRef,
  PixelFrame,
  AnimName,
  SpriteAnchor,
} from './sprites/pixelArt.js';
export { armorSprite } from './sprites/mobiles/armor.js';
export { mobileSprites, rotateHue, tintedArmorSprite } from './sprites/mobiles/index.js';

// --- net ------------------------------------------------------------------
export type * from './net/protocol.js';
