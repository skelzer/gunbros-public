/**
 * Tunables the procedural generators and the spawn search read (DESIGN §2.3, §7 item 15).
 *
 * Everything about the *shape* of a procedural world is in `terrainGen`, everything
 * about where a seat may stand is in `spawnGen`. The spawn rules apply to every map,
 * painted or procedural: a painted map (DESIGN §8.1) fixes the ground, and the seed then
 * only moves the seats about inside what `spawnGen` allows. No generator holds a literal.
 */


/** Generator tunables, per style. All of the shape of the world lives here. */
export const terrainGen = {
  hills: {
    /** Ground level as a fraction of map height before noise is applied. */
    baseFraction: 0.58,
    /**
     * Octaves of 1-D value noise: wavelength in px and amplitude in px. The long
     * octave was cut back from 90 px in Phase 1 (PROGRESS: "the 900 px octave
     * dominates") because it was what put a spawn halfway up a 30° ramp; the relief is
     * carried by the 420 px octave now, which is roughly one screen wide and therefore
     * reads as a hill rather than as a continental tilt.
     */
    octaves: [
      { wavelength: 900, amplitude: 62 },
      { wavelength: 420, amplitude: 52 },
      { wavelength: 175, amplitude: 17 },
      { wavelength: 64, amplitude: 6 },
    ],
    /** Surface is clamped into these fractions of the map height. */
    minTopFraction: 0.26,
    maxTopFraction: 0.88,
  },

  pit: {
    baseFraction: 0.62,
    octaves: [
      { wavelength: 760, amplitude: 46 },
      { wavelength: 260, amplitude: 20 },
      { wavelength: 96, amplitude: 7 },
    ],
    minTopFraction: 0.3,
    maxTopFraction: 0.88,
    /**
     * The rim: the ground rises by `rimLiftPx` toward the chasm over `rimSpanFraction`
     * of the width, with a flat top (`rimFlatness` > 1 widens the plateau and steepens
     * its outer slope), so both teams start on high ground looking down into the gap.
     */
    rimLiftPx: 150,
    rimSpanFraction: 0.44,
    rimFlatness: 2.2,
    /**
     * The chasm itself: full height, so falling in is death (DESIGN §2.4). It is a
     * funnel — `chasmTopHalfWidth` at the lips widening by `chasmFlareFraction` of
     * itself at the map floor — with noise on the walls.
     */
    chasmHalfWidthFraction: 0.125,
    chasmTopScale: 0.84,
    chasmFlareFraction: 0.4,
    chasmWallWavelength: 170,
    chasmWallAmplitude: 22,
  },

  islands: {
    /**
     * Four floating masses (DESIGN brief: three to five). The two outer ones are wide
     * and flat — that is where the spawns land — and the two inner ones are small
     * stepping stones at different heights. Centres are fractions of the map width,
     * tops fractions of the map height, everything else px.
     */
    masses: [
      { centreFraction: 0.175, halfWidthPx: 270, topFraction: 0.52, thicknessPx: 175 },
      { centreFraction: 0.425, halfWidthPx: 100, topFraction: 0.4, thicknessPx: 120 },
      { centreFraction: 0.575, halfWidthPx: 100, topFraction: 0.6, thicknessPx: 120 },
      { centreFraction: 0.825, halfWidthPx: 270, topFraction: 0.52, thicknessPx: 175 },
    ],
    /** Per-island deterministic nudge, px (kept under half the smallest gap). */
    jitterPx: 14,
    /** Bumps along the top surface. */
    surfaceWavelength: 130,
    surfaceAmplitude: 12,
    /** How far the surface dips at the shoulders of an island, px. */
    shoulderDropPx: 26,
    /** Ragged underside. */
    keelWavelength: 90,
    keelAmplitude: 14,
    /** A spike of rock hanging under the middle of each island. */
    keelSpikePx: 70,
    keelSpikeSpread: 3.4,
  },

  cave: {
    /**
     * Floor and ceiling are both pulled toward the middle of the map: the camera cannot
     * scroll past `height - 600`, so a ceiling drawn near the top of a 900 px map would
     * never be on screen while a mobile stands on the floor. Both bands sit inside the
     * band the camera can actually reach, which is what makes the roof a thing players
     * aim under rather than a fact in the map file.
     */
    baseFraction: 0.74,
    octaves: [
      { wavelength: 520, amplitude: 34 },
      { wavelength: 190, amplitude: 15 },
      { wavelength: 72, amplitude: 6 },
    ],
    minTopFraction: 0.64,
    maxTopFraction: 0.88,
    /** Ceiling slab hanging from the top of the map. */
    ceilingBaseFraction: 0.36,
    ceilingWavelength: 340,
    ceilingAmplitude: 30,
    /** Stalactites hanging off it: a high lob into one hits rock. */
    stalactites: 14,
    stalactiteHalfWidthPx: 30,
    stalactiteMinLengthPx: 50,
    stalactiteMaxLengthPx: 170,
    /** A tip is shortened rather than ever leaving less than this above the floor. */
    minClearancePx: 180,
    /** Bumps growing back up off the floor; drawn before the tips, which clear them. */
    stalagmites: 9,
    stalagmiteHalfWidthPx: 22,
    stalagmiteMinLengthPx: 18,
    stalagmiteMaxLengthPx: 54,
  },
};

/**
 * What makes a column a legal place to start a match on (DESIGN §7 item 15, extended in
 * Phase 6 for maps with holes in them). `computeSpawnPoints` scores every column of the
 * map against these and drops each seat on the nearest legal one, so no seat can start
 * inside the chasm, in a gap between two islands, on a 3 px ledge, under a stalactite,
 * or on a ramp it cannot shoot off.
 */
export const spawnGen = {
  /** Air needed above a spawn: the cave ceiling clearance, and a sanity check elsewhere. */
  minHeadroomPx: 115,
  /** Solid px needed under a spawn, so nobody starts on a crust that a shot removes. */
  minThicknessPx: 12,
  /**
   * Surface drop over the slope probe width (`constants.spawn.slopeProbeWidthPx`, 26 px)
   * a spawn may sit on: 9 px is 19°, the relaxed pass 13 px is 27°, both inside the 30°
   * the maps test pins.
   */
  maxDropPx: 9,
  relaxedDropPx: 13,
  /**
   * How far either end of the footprint may stand above the feet (map pass, DESIGN
   * §8.1). The drop above is measured edge to edge, so a site on the lip of a shelf —
   * centre on the flat, one edge up the slope behind it — passes it with that edge 9 px
   * over the feet, and walking treats anything more than `maxStep` over the feet as a
   * wall: the seat starts wedged, unable to drive either way. 4 is the smallest
   * `maxStep` in the roster. The first three stages keep it; the last two are the
   * "anywhere with ground" fallbacks and do not.
   */
  maxEdgeRisePx: 4,
  /**
   * How far either end of the footprint may hang *below* the feet in those same stages.
   * The drop compares the two ends with each other, so a symmetric point — a pine's tip,
   * a sharp crest — passes it with both ends far down; this keeps seats off them.
   */
  maxEdgeDipPx: 13,
  /**
   * Headroom the *last* relaxation stage still insists on. The stage before it drops
   * the requirement entirely so a seat can stand under a stalactite; without a floor
   * here a seat on `pit` could end up walled into a pocket of the chasm wall with
   * eleven px of air over its head, where its own shells burst at the muzzle.
   */
  floorHeadroomPx: 58,
  /**
   * Px two spawn sites must be apart — or, in a room with more seats than the map has
   * width to spread them over, this fraction of one seat's slot.
   */
  minSeparationPx: 240,
  slotSeparationFraction: 0.8,
  /**
   * The separation the last stage keeps whatever happens: the widest mobile footprint
   * (32 px, bigfoot) plus a little air, so eight seats on a narrow shelf stand shoulder
   * to shoulder rather than inside one another. The stage searches
   * `wideSearchRadiusPx` instead of giving the separation up.
   */
  minSeparationFloorPx: 42,
  /** How far from its nominal slot a seat may be moved to find a legal column. */
  searchRadiusPx: 430,
  wideSearchRadiusPx: 900,
  searchStepPx: 2,
  /** Deterministic jitter of the nominal slot, as a fraction of the slot width. */
  jitterFraction: 0.06,
};

