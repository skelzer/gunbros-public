/**
 * Practice bots (DESIGN §11, §7 items 186-192): every number the bot's search, its
 * deliberate mistakes and its pacing read. Nothing in here is logic — `bot/planner.ts`
 * is the search and `server/src/bot.ts` the pacing — and nothing here is part of the
 * simulation: a bot is a player with no socket, and the match cannot tell it from one.
 */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Picker order, and the wire values of `addBot` / `setBot`. */
export const botDifficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  for (let i = 0; i < botDifficulties.length; i++) if (botDifficulties[i] === value) return true;
  return false;
}

export interface BotDifficultyDef {
  displayName: string;
  /**
   * Seconds the bot "thinks" before it starts to aim, drawn uniformly from the range.
   * The search runs in this window; a plan that is not finished when it closes fires
   * the best candidate found so far (§7 item 189).
   */
  thinkSeconds: [number, number];
  /**
   * The deliberate miss (§7 item 188): the chosen angle and power are moved by a
   * triangular error of at most this much, drawn from the bot's own PRNG. Degrees for
   * the angle, fraction of the full bar for the power. The error is peaked at zero, so
   * it has to be wide to miss at all: measured over every map, first shots land ~24%
   * of the time on Easy, ~45% on Normal and ~83% on Hard. Most of the spread is in the
   * power, so a bot misses like a human who charged too long or too short.
   */
  angleErrorDeg: number;
  powerError: number;
  /** Chance of settling for one of the next-best candidates instead of the best. */
  settleChance: number;
  /** How far down the ranking a settled-for candidate may come from. */
  settleDepth: number;
  /** May this bot fire its SS when that scores best? */
  useSs: boolean;
  /**
   * When the bot considers walking (§7 item 190): `always` weighs every position; with
   * `whenStuck` it only looks for somewhere else when nothing from where it stands hits.
   */
  walk: 'always' | 'whenStuck';
  /** Fraction by which the planned walk is lengthened or shortened, at most. */
  walkError: number;
}

export const bots = {
  difficulties: {
    easy: {
      displayName: 'Easy',
      thinkSeconds: [1.6, 2.6],
      angleErrorDeg: 8,
      powerError: 0.22,
      settleChance: 0.4,
      settleDepth: 6,
      useSs: false,
      walk: 'whenStuck',
      walkError: 0.3,
    },
    normal: {
      displayName: 'Normal',
      thinkSeconds: [1.5, 2.2],
      angleErrorDeg: 4,
      powerError: 0.1,
      settleChance: 0.15,
      settleDepth: 3,
      useSs: true,
      walk: 'always',
      walkError: 0.08,
    },
    hard: {
      displayName: 'Hard',
      thinkSeconds: [1.5, 2.1],
      angleErrorDeg: 0.4,
      powerError: 0.006,
      settleChance: 0,
      settleDepth: 1,
      useSs: true,
      walk: 'always',
      walkError: 0,
    },
  } satisfies Record<BotDifficulty, BotDifficultyDef> as Record<BotDifficulty, BotDifficultyDef>,

  /** What `createRoom.practice` and a bare "Add bot" put in the seat (§7 item 192). */
  defaultDifficulty: 'normal' as BotDifficulty,

  /**
   * The search (§7 items 187 and 190). From where the bot stands, a coarse grid over
   * every shot slot it may fire, the mobile's whole angle range and the power bar. Then
   * the walks (`walk`): each position is screened with a small S1-only grid, and the
   * best one that beats standing still gets the full coarse grid too. Last,
   * `refineRounds` passes around the `refineTop` best candidates, each on a grid
   * `refineShrink` times finer than the one before. The counts are sized from the
   * measured cost of one candidate (docs/PROGRESS.md, "Practice bots"): the whole Hard
   * plan fits inside the shortest think time at `budgetMsPerTick`.
   */
  search: {
    coarseAngles: 7,
    coarsePowers: 9,
    /** The weakest power tried; below it every shell lands at the bot's feet. */
    minPower: 0.25,
    refineTop: 3,
    refineRounds: 3,
    /** Candidates per axis either side of a refined centre (1 = a 3x3 grid). */
    refineRadius: 1,
    refineShrink: 3,
    /** Hard cap on candidates in one plan, whatever the grid above adds up to. */
    maxCandidates: 520,
    /**
     * The quick re-plan once a walk has arrived: the chosen shot, then this many
     * refine rounds around it on the live state, starting `refineShrink` times finer
     * than the coarse grid.
     */
    arriveRounds: 3,
    /**
     * Ticks one candidate may simulate before it is scored as it stands. A shell that
     * is still in the air after this long has missed everything anyway; the turn
     * machine's own cap (`constants.turn.maxResolvingTicks`) is a minute.
     */
    maxTicksPerCandidate: 900,
  },

  /**
   * Walking before the shot (§7 item 190). Walks left and right of these fractions of
   * the move gauge left this turn, each simulated on a copy for its exact tick count
   * and then allowed to settle. A position is thrown away if the bot dies there, or if
   * getting there meant a real fall (airborne and more than `maxDropPx` below where
   * the walk began): that is a ledge, a pit or the edge of the map.
   */
  walk: {
    fractions: [1 / 3, 2 / 3, 1],
    /** Ticks after the stop for the hull to land and its tilt to settle. */
    settleTicks: 30,
    /** Positions that end this close together are one position (a blocked walk). */
    samePlacePx: 4,
    maxDropPx: 40,
    /** S1-only screening grid for a walk position. */
    screenAngles: 5,
    screenPowers: 6,
    /** Walk positions that get the full coarse grid after the screen. */
    finalists: 1,
    /**
     * Score cost per px walked, so the bot does not wander when standing is as good: a
     * full gauge (~170 px) costs ~9, against ~100-300 for a hit.
     */
    costPerPx: 0.05,
  },

  /** The score of a simulated shot (`bot/score.ts`, §7 item 187). */
  score: {
    /** Per point of hp or shield taken off a living enemy. */
    enemyDamage: 1,
    /** On top of the damage, per enemy the shot kills. */
    killBonus: 400,
    /** Per point taken off the bot itself or an ally: friendly fire costs double. */
    friendlyDamage: 2,
    /** Killing an ally. */
    allyDeath: 800,
    /** The bot dies or falls off the map: never worth it. */
    selfDeath: 5000,
    /**
     * A small pull towards the nearest enemy for shots that hit nothing, per px between
     * the closest blast and the closest living enemy. It gives the refinement a slope
     * to climb when the coarse grid landed nothing, and it is what makes an Easy miss
     * land near its target rather than anywhere.
     */
    missPerPx: 0.05,
    /** The pull is capped, so a far miss never outweighs a small hit. */
    missCap: 60,
  },

  /**
   * Planner wall-clock per server tick (§7 item 189). A 60 Hz tick is 16.7 ms, so a bot
   * turn takes under a third of one core while it thinks and never stalls the other
   * rooms on the event loop. One candidate is checked against the budget after it has
   * run, so a tick can overrun by one candidate (a few ms at worst).
   */
  budgetMsPerTick: 5,

  /** The turn as a human would play it (§7 item 190). */
  pacing: {
    /** Barrel sweep: this many `aim` steps, this far apart. */
    aimSteps: 5,
    aimStepSeconds: 0.12,
    /** Ticks the hull may take to land after a walk before the bot re-plans anyway. */
    arriveMaxTicks: 90,
    /** Pause between the last aim step and the start of the charge. */
    settleSeconds: 0.25,
    /** `charging` reports this far apart while the bar rises at the human rate. */
    chargeReportSeconds: 0.15,
    /**
     * Seconds of turn timer the bot keeps in hand: if thinking ran this close to the
     * end, it stops and fires what it has.
     */
    reserveSeconds: 6,
  },

  /** Bot nicknames, handed out in order and unique within a room (§7 item 191). */
  names: ['Rusty', 'Bolt', 'Sprocket', 'Cog', 'Piston', 'Rivet', 'Gasket', 'Widget', 'Dynamo', 'Tinker'],
};

export type Bots = typeof bots;
