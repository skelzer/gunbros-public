/**
 * Sky events (DESIGN §5): the roll table, how long weather lasts and how often it comes
 * back, every tunable the three events read, and the placement rules that turn a
 * rolled id into a position on the map.
 *
 * Nothing in here is logic — `rules/sky.ts` is where the satellite levels up, the
 * tornado captures and the Force band flags a shell. Every number the simulation reads
 * about a sky event lives here (DESIGN §1.2) and nowhere else.
 */

export type SkyEventId = 'none' | 'thor' | 'tornado' | 'force';

/**
 * Hash and wire ordering for {@link SkyEventId}: the index is what `hashState` mixes,
 * so this array is append-only.
 */
export const skyEventIds: SkyEventId[] = ['none', 'thor', 'tornado', 'force'];

export function skyEventIndex(id: SkyEventId): number {
  for (let i = 0; i < skyEventIds.length; i++) if (skyEventIds[i] === id) return i;
  return 0;
}

export function isSkyEventId(value: string): value is SkyEventId {
  for (let i = 0; i < skyEventIds.length; i++) if (skyEventIds[i] === value) return true;
  return false;
}

export interface SkyRollEntry {
  id: SkyEventId;
  /** Relative weight in the match-start roll. */
  weight: number;
}

export const sky = {
  /**
   * The match-start roll: `none`'s share is the chance of opening under a clear sky,
   * so the three events together are the chance of opening with weather (40%). The
   * event weights are reused by every later arrival (`weather.arriveChance`).
   */
  rollTable: [
    { id: 'none', weight: 60 },
    { id: 'thor', weight: 40 / 3 },
    { id: 'tornado', weight: 40 / 3 },
    { id: 'force', weight: 40 / 3 },
  ] as SkyRollEntry[],

  /**
   * Weather comes and goes (DESIGN §5). An event lasts a number of *completed turns*
   * drawn from [minTurns, maxTurns] — a turn is one seat's shot, so in a 1v1 a
   * three-turn tornado is one shot for one player and two for the other — and then
   * the sky clears. Every turn that ends under a clear sky rolls `arriveChance` for a
   * new event, picked off `rollTable` without its `none` row.
   */
  weather: {
    minTurns: 2,
    maxTurns: 4,
    arriveChance: 0.3,
  },

  thor: {
    /**
     * An explosion this close to an enemy mobile of the blast's owner calls a strike
     * down on the impact point (DESIGN §5).
     */
    triggerRadius: 90,
    /** Beam damage at level 1; the strike deals `baseDamage * level`. */
    baseDamage: 120,
    /** Triggered strikes per level gained. */
    levelEveryHits: 3,
    maxLevel: 5,
    startLevel: 1,
    /**
     * Radius of the hole the column digs, and the base the beam's damage falloff is
     * built from. A caller that overrides it (aduka's `beamCarveRadius`, DESIGN §3)
     * widens its own column with it.
     */
    carveRadius: 18,
    /**
     * Full width in px of the light column a *sky* Thor drops. `carveRadius` still
     * decides the hole for a caller that names one, so aduka's barrage keeps its own
     * geometry while the satellite's own strike is tuned here.
     */
    beamWidth: 30,
  },

  tornado: {
    /** The column is `x ± halfWidth`. */
    halfWidth: 60,
    /** How far a captured projectile is carried up. */
    liftPx: 260,
    /** Ticks the lift takes, after which the projectile is spat out. */
    holdTicks: 40,
    /** Exit direction, degrees either side of straight up (sign from the PRNG). */
    exitAngleDeg: 25,
    /**
     * A shell that crawled into the column would otherwise be released with almost no
     * speed and drop straight back down it; the tornado gives it at least this much.
     */
    minExitSpeed: 4,
  },

  force: {
    /** Band position as fractions of the map height. */
    topFraction: 0.25,
    bottomFraction: 0.45,
    /** Explosion damage of a projectile that crossed the band (DESIGN §2.6). */
    multiplier: 1.5,
  },

  /**
   * Where a rolled event sits on the map (DESIGN §5: "events sit in a horizontal band
   * of the map"). The tornado's column is the only one with a choice to make. The
   * fraction range keeps it away from both edges; the clearance then walks the drawn
   * column to the nearest legal x so that no spawn is standing inside it (DESIGN §7
   * item 129) — the nominal 1v1 slots sit at 0.3w and 0.7w and the 2v2 ones at 0.4w
   * and 0.6w, all of them inside the range, so the range alone was never enough.
   */
  placement: {
    tornadoMinXFraction: 0.3,
    tornadoMaxXFraction: 0.7,
    /**
     * Minimum distance from the column's centre to any spawn x: `tornado.halfWidth`
     * plus half a mobile's footprint plus a little air, so a mobile that starts the
     * match beside the funnel is still outside it.
     */
    tornadoSpawnClearancePx: 100,
  },
};

export function totalSkyWeight(): number {
  let total = 0;
  for (let i = 0; i < sky.rollTable.length; i++) total += sky.rollTable[i]?.weight ?? 0;
  return total;
}
