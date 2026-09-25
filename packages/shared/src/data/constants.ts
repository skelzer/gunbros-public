/**
 * Global tunables. DESIGN.md §2: every number the simulation uses lives in data/*.ts,
 * never inline in a rule. Values here are the initial tuning, not promises.
 */

/**
 * The turn timer's warning point, in seconds. Declared here rather than written twice
 * so that `turn.warningSeconds` (the event payload and the HUD flash) and
 * `turn.warningTicks` (what the tick counter compares against) cannot drift apart.
 */
const warningSeconds = 5;

/** Fixed simulation step, ticks per second; needed before the object literal closes. */
const tickRate = 60;

export const constants = {
  /** Fixed simulation step. */
  tickRate,
  tickMs: 1000 / tickRate,

  /** Downward acceleration in px/tick^2 (~576 px/s^2). */
  gravity: 0.16,

  /** Projectile integration sub-steps per tick (anti-tunnelling, DESIGN §2.1). */
  subSteps: 4,
  /** Maximum distance in px between terrain samples along a projectile segment. */
  segmentSampleStep: 1,

  /** Internal presentation resolution; "pixel" in the design means one of these. */
  screenWidth: 800,
  screenHeight: 600,

  wind: {
    /** Wind strength is drawn from [0, maxStrength]. */
    maxStrength: 26,
    /**
     * Force per tick = windScale * strength * windFactor * direction. At 26 this is about
     * a quarter of gravity: a 70° armor lob drifts roughly half a screen, which is the
     * classic feel. It was 0.0035 (over half of gravity) and wind dominated every shot.
     */
    scale: 0.0015,
    /** Completed turns between wind rerolls. */
    changeEveryTurns: 2,
    /**
     * Strength draw is the lowest of this many uniform draws, so calm-to-moderate winds
     * are common and 20+ is rare (about 5 % with 2).
     */
    strengthSamples: 2,
  },

  mobile: {
    /** Extra px below the map bottom before a falling mobile counts as dead. */
    deathBelowMapPx: 50,
    /** Downward speed cap while falling, px/tick. */
    maxFallSpeed: 12,
    /** Fraction of the remaining tilt difference closed per tick. */
    tiltSmoothing: 0.25,
    /** How far up/down the ground probe looks when sampling the surface, px. */
    surfaceProbePx: 64,
    /** Gap in px between the feet and the ground before the mobile is considered falling. */
    groundTolerancePx: 1,
    /** Relative aim angle a freshly spawned mobile starts with, before clamping. */
    defaultRelAngleDeg: 45,
    /**
     * Horizontal speed kept when a mobile that was thrown (jd's pull, a shockwave)
     * touches the ground again. 0 = it stops dead where it lands; raise it to let a
     * launched mobile skid. `vx` is only integrated while airborne (DESIGN §2.4).
     */
    landingFriction: 0,
    /** Horizontal speed cap while airborne, px/tick. */
    maxLaunchSpeedX: 12,
  },

  projectile: {
    /** Ticks after which an unresolved projectile is culled. */
    maxLifetimeTicks: 60 * 30,
    /** Distance outside the map bounds at which a projectile expires. */
    cullMarginPx: 400,
    /**
     * Minimum ticks during which a projectile cannot hit the mobile that fired it.
     * It is only a floor: the real rule is that the owner stays immune until the shot
     * has been outside its hull box at least once (`entities/projectile.ts`), which a
     * fixed tick count cannot express for a muzzle inside the hull or for a multi-body
     * shot whose trailing body starts behind the muzzle.
     */
    ownerGraceTicks: 2,
    /** Fraction of speed a bouncing shot keeps when its def does not say otherwise. */
    defaultRestitution: 0.5,
  },

  power: {
    /** Seconds to charge from 0 to 1. */
    chargeSeconds: 2.6,
    /** Power is quantised to this many steps before it goes on the wire. */
    quantiseSteps: 1000,
    majorBars: 4,
    minorTicksPerBar: 5,
  },

  /**
   * The turn machine (DESIGN §2.9). Every duration is in ticks: the simulation never
   * reads a wall clock, so "0.5 s" is 30 ticks and nothing else.
   */
  turn: {
    /** `starting`: the turn banner, 0.5 s. */
    startingTicks: 30,
    /** `active`: the 20 s turn timer. */
    activeTicks: 20 * 60,
    /** `ending`: the pause after a shot has resolved, 0.75 s. */
    endingTicks: 45,
    /**
     * Safety cap on `resolving`. A behaviour that never settles (a bug, a projectile
     * parked inside terrain) would otherwise freeze the match forever; after this the
     * turn ends anyway. Generous: a lobbed shot into a head wind can hang for ~15 s.
     */
    maxResolvingTicks: 60 * 60,
    /** `timerWarning` fires once, when this many seconds are left. */
    warningSeconds,
    /** The same instant in ticks — the timer counts ticks (DESIGN §2.1: no wall clock). */
    warningTicks: warningSeconds * tickRate,
    /** Delay added per second of turn time used. */
    delayPerSecond: 1,
    /** Delay added by skipping or timing out. */
    skipDelay: 250,
  },

  ss: {
    /** SS unlocks when the gauge reaches this value (DESIGN §7 item 1). */
    gaugeMax: 4,
    gainPerOwnTurn: 1,
    gainPerHitTaken: 1,
    /**
     * Phase 5 turned the gauge into a real gate: a `selectShot` or a `fire` of `ss` is
     * refused below `gaugeMax`, and using the SS resets the gauge to 0. The gate only
     * binds a `turns` match — a `freePlay` one has no completed turns to earn the
     * gauge with, and the dev sandbox exists precisely to look at every SS
     * (DESIGN §7 item 91).
     */
    gateEnabled: true,
  },

  /**
   * Items (DESIGN §4). The *magnitudes* — how much a heal heals, how much a bunge
   * widens a crater — are per item in `data/items.ts`; what lives here is the mechanics
   * every item shares.
   */
  items: {
    /** Ticks between Dual's / Dual+'s first and second volley. */
    dualGapTicks: 20,
    /** How far below a teleport target the ground may be for the target to be legal. */
    teleportGroundProbePx: 240,
    /** A teleport target this close to another mobile's hull is refused. */
    teleportMinSeparationPx: 12,
    /** Px of map edge a teleport target must stay clear of. */
    teleportMarginPx: 8,
    /** Px between the samples that check a teleport target's hull box is air. */
    teleportClearanceStepPx: 4,
  },

  /**
   * The stacking defence debuff (DESIGN §2.4 `defenceMod`, §2.6). A shot carrying
   * `ProjectileDef.defenceDebuff` adds it to every mobile it damages; the total is
   * capped at `max` and shrinks by `decayPerTurn` at the start of the *victim's* own
   * turn (`rules/turn.ts`). Damage is multiplied by `(1 + defenceMod)`.
   */
  debuff: {
    /** Removed from a mobile's `defenceMod` at the start of its own turn. */
    decayPerTurn: 0.02,
    /** Hard cap on the stacked debuff: at 0.6 a target takes +60 % damage. */
    max: 0.6,
  },

  /**
   * Walking mines (DESIGN §3, §7 item 8). These are the fallbacks `createMine` uses
   * when a `mineDrop` shot does not override them through `ProjectileDef.params`;
   * the real per-shot numbers live in `data/mobiles/raon.ts`.
   */
  mine: {
    /** Px a mine walks per turn (all mines walk at every turn start). */
    walkPxPerTurn: 60,
    /** Px per step of that walk; the smaller, the better it follows the surface. */
    stepPx: 1,
    /** Tallest rise, in px, a mine can climb. */
    maxStep: 4,
    /** Turns a mine lives before it expires harmlessly. */
    ttlTurns: 6,
    /** A mine within this distance of an enemy detonates. */
    triggerRadius: 22,
    /** An explosion within this distance of a mine detonates it too. */
    radius: 20,
    hp: 40,
    damage: 180,
    damageRadius: 56,
    carveRadius: 24,
  },

  /**
   * Sudden death (DESIGN §2.9, §7 item 11): a damage multiplier that steps up after a
   * number of *completed* turns. `rules/suddenDeath.ts` reads these and nothing else.
   */
  suddenDeath: {
    afterTurns: 40,
    multiplier: 2,
    secondAfterTurns: 60,
    secondMultiplier: 3,
  },

  /** Spawn layout (DESIGN §7 item 15). */
  spawn: {
    /** Fraction of the map width kept clear at each edge. */
    marginFraction: 0.1,
    /** Probe start height above the terrain top when dropping a spawn onto the ground. */
    dropFromY: 0,
    /**
     * Spawn sites are nudged to the flattest column within this many px of the nominal
     * one, so nobody starts the match on a ramp they cannot shoot off (DESIGN §7.15).
     */
    flattenSearchPx: 72,
    flattenStepPx: 4,
    /** Width in px the spawn-site slope is measured over (a mobile footprint). */
    slopeProbeWidthPx: 26,
  },
};

export type Constants = typeof constants;
