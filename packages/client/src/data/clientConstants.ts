/**
 * Presentation tunables.
 *
 * DESIGN's rule is that every number the *simulation* uses lives in
 * `packages/shared/src/data/*.ts`. These are the numbers the *renderer* uses — band
 * thicknesses, easing rates, particle counts, HUD geometry — none of which may ever
 * reach MatchState. They are collected here for the same reason: no magic numbers
 * buried in a draw call.
 *
 * The bottom bar geometry (`hud.bar`) is expressed as offsets inside the bar rather
 * than absolute screen coordinates, so the whole bar can be moved or resized by
 * changing two numbers.
 */
import type { ItemId } from '@gunbros/shared';

/** How the S1 / S2 / SS cards are arranged in the bar (`hud.shots.stack`). */
export type ShotStack = 'row' | 'column' | 'grid';

/** A track of the soundtrack: a file `public/music/<track>.mp3` (DESIGN §8.3). */
export type MusicTrack =
  | 'farline1'
  | 'farline3'
  | 'farline4'
  | 'farline5'
  | 'farline6'
  | 'farline7'
  | 'farline8'
  | 'farline9'
  | 'farline11'
  | 'farline12'
  | 'farline13';

interface MusicConstants {
  busGain: number;
  fadeInS: number;
  fadeOutS: number;
  tracks: Record<MusicTrack, { gain: number }>;
  maps: Record<string, MusicTrack>;
  lobby: MusicTrack;
  suddenDeath: MusicTrack;
  results: MusicTrack;
}

export const clientConstants = {
  /**
   * The internal backbuffer (DESIGN §1.3, §7 item 142).
   *
   * The width is fixed at 800 px — every world number in the design is quoted in those
   * pixels — but the height follows the screen's aspect so a phone in landscape is not
   * letterboxed into a 4:3 window: `height = clamp(round(800 * screenH / screenW),
   * minHeightPx, maxHeightPx)`.
   */
  view: {
    widthPx: 800,
    /**
     * 360 px is 800 / (20 / 9): the tallest-aspect phone in the family (Pixel 7 at
     * 915x412, iPhone 13 at 844x390) fills the screen exactly, with no letterbox at all.
     * Anything wider than 20:9 gets thin bars top and bottom rather than a HUD with no
     * room left for the world.
     */
    minHeightPx: 360,
    /** 4:3 and taller keep the original 800x600 window. */
    maxHeightPx: 600,
    /**
     * At or below this height — *and* on a touch screen — the HUD switches to its
     * `compact` variant: finger-sized buttons, bigger numbers, no section captions
     * (see `hud.compact` and {@link hudVariantFor}).
     *
     * It was 480, which left a tablet on the full geometry. Measured, that was wrong
     * (DESIGN §7 item 165): an iPad in landscape draws the full HUD at 1.47, so its
     * toggles are 27 CSS px and its walk keys 29x27. Every view height a touch screen
     * can have is at or under 600, so today this means "every touch screen"; it stays a
     * height so a tablet-sized geometry can take the top of the range back later.
     */
    compactMaxHeightPx: 600,
  },

  canvas: {
    /**
     * Smallest upscale of the backbuffer. Below 1 on a phone, where the window is
     * narrower than the 800 px buffer and the canvas is scaled *down* to fit.
     */
    minScale: 0.25,
    /** Largest upscale we will ever apply, so a 5K monitor does not get a 6x window. */
    maxScale: 8,
    background: '#05070a',
  },

  camera: {
    /** Fraction of the remaining distance closed per rendered frame when following. */
    followEase: 0.12,
    /** Faster easing for the "return to the mobile" move after a shot. */
    returnEase: 0.08,
    /** Ease used for the glide to the next mobile when a turn starts. */
    turnStartEase: 0.16,
    /** Px from the window edge that starts an edge scroll in free-camera mode. */
    edgeScrollMarginPx: 24,
    /** Edge scroll speed in world px per rendered frame. */
    edgeScrollSpeedPx: 9,
    /** Ticks the camera lingers on the last explosion before returning. */
    returnDelayTicks: 45,
    /** Px above the feet the camera centres on, so a mobile is not framed by its tracks. */
    focusHeightPx: 22,
    /**
     * The block of fixed HUD in the top-left corner — the upcoming-order panel, the
     * toggles under it and the sky badge beside them. The camera keeps the mobile it is
     * following out of this rectangle when the map gives it room to (`clearHudCorner`).
     */
    hudCorner: {
      widthPx: 232,
      heightPx: 116,
    },
    /**
     * A projectile that leaves the world explodes nothing, so there is nothing to
     * linger on: the camera starts its way back after this many ticks instead of the
     * full `returnDelayTicks` (DESIGN §7 item 24).
     */
    expireReturnDelayTicks: 8,
  },

  terrain: {
    /** 1 px lit highlight drawn on top of a solid run (DESIGN §8 palette.outline). */
    outlinePx: 1,
    /** Crust band below the highlight, dithered from crust to crustDark. */
    crustPx: 5,
    /** Soil band below the crust, dithered from soil to soilDark. */
    soilPx: 18,
    /**
     * Carving resets the depth banding of every pixel below the hole, but only until the
     * band reaches `deep` again. Repainting this far around the carve circle is enough,
     * so it has to stay above outlinePx + crustPx + soilPx.
     */
    repaintMarginPx: 32,
    /**
     * Ordered 4x4 Bayer matrix (values 0-15). A pixel takes the darker tone of its band
     * when its matrix entry is under the band's progress, which fades each band into the
     * next as a pixel-art dither instead of a hard stripe.
     */
    bayer4: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
    /** Fraction of the deep band drawn in its dark tone: a static mottle, not a fade. */
    deepMottle: 0.34,
    /** A palette with no dark tones gets them by multiplying its light ones by this. */
    deriveShade: 0.82,
    /**
     * A solid run that ends above this fraction of the map height is a hanging slab and
     * is drawn with `palette.ceiling`, banded from its underside up (DESIGN §8: cave).
     * Only maps that define ceiling tones are affected.
     */
    ceilingSplitFraction: 0.45,

    /**
     * Surface decoration (`palette.detail`): tufts, studs, roots and glints planted on
     * the exposed edges of the mask. Placement is a hash of the column and the surface
     * height there, never a random draw, so a repaint of a carve's dirty rect puts back
     * exactly what was there and the rest of the map is untouched.
     */
    detail: {
      /** Px a decoration may reach above (or below) the edge it grows from. */
      reachPx: 6,
      /** Extra columns scanned either side of a dirty rect so nothing is half-drawn. */
      marginPx: 6,
      /** Px between two decorations on the same edge: the planting grid. */
      spacingPx: 5,
      /** Tuft blades: how many, how tall, how far they lean. */
      tuftMinPx: 2,
      tuftMaxPx: 6,
      tuftBlades: 3,
      /** Rock studs: half-width and height of one lump. */
      studHalfPx: 2,
      studHeightPx: 3,
      /** Roots hanging from an underside edge. */
      rootMinPx: 4,
      rootMaxPx: 13,
      /** Crystal glints: shard height and the bright core inside it. */
      glintMinPx: 3,
      glintMaxPx: 7,
      /**
       * Px either side of an edge that are probed before anything is planted on it.
       * Both probes must be solid one px in and open one px out, which is true on a
       * level shelf and false on a cliff, a lip or a 1 px spike — so nothing grows
       * sideways out of a wall or hangs in the air off the end of a ledge.
       */
      maxSlopePx: 3,
    },

    /**
     * Rock texture inside the ceiling slab and deep in the ground: sparse studs and
     * cracks hashed from the pixel's own coordinates, which is what stops a 200 px tall
     * slab of `deep` reading as a painted rectangle.
     */
    texture: {
      /** Chance a deep pixel is nudged to its neighbour band's tone. */
      speckleChance: 0.075,
      /** Chance a ceiling pixel joins a crack: darker than its own dark tone. */
      crackChance: 0.03,
      /** How far a crack pixel is darkened. */
      crackShade: 0.62,
      /** Chance a ceiling pixel just under the underside highlight catches the light. */
      ceilingGlintChance: 0.09,
    },

    /**
     * The burnt lip a carve leaves (`palette.scorch`). Every pixel within the carve
     * radius plus `marginPx` is flagged charred; an exposed edge inside the flag is
     * drawn in the ember rim tone over a charred core instead of crust, and grows
     * nothing.
     */
    scorch: {
      marginPx: 5,
      /** Px of the ember rim on the exposed edge. */
      rimPx: 2,
      /** Px of charred core below the rim before the ordinary bands resume. */
      corePx: 6,
    },
  },

  /** Painted maps (DESIGN §8.1, render/mapArt.ts). */
  mapArt: {
    /**
     * How long a match or the sandbox waits for its map's pictures before the first
     * frame. The whole of `hills` is ~120 KB, so on anything but a stalled connection it
     * is in long before this; past it the band painter draws the ground and the art is
     * swapped in the frame it arrives.
     */
    preloadTimeoutMs: 2500,
  },

  background: {
    /** Discrete colour bands the sky gradient is quantised into (DESIGN §8: banded). */
    skyBands: 14,
    /**
     * Width in px of one baked silhouette tile (mountains, hills, mesas, cave walls).
     * Every layer is pre-rendered once into a tile this wide and then blitted, so this
     * is both the repeat period and the offscreen canvas width.
     */
    silhouettePeriodPx: 1024,
    /** Px between silhouette lattice points; smaller is bumpier. */
    silhouetteStepPx: 64,
    /** Repeat period of the layers made of sprites: clouds, sky islands, crystals. */
    spritePeriodPx: 1700,
    /** Star field density per 10 000 px^2 and its repeat period. */
    starPeriodPx: 1600,
    starDensity: 0.9,
    /** Seed offsets so the generated layers do not share a shape. */
    seedSalt: [0x1f3d, 0x2b91, 0x74c5, 0x3ae7, 0x5c19],
    /** Px of slack baked above a layer's band so vertical parallax never shows a seam. */
    tileSlackPx: 24,
    /** Second, finer octave of a ridge, as a fraction of its peak height. */
    ridgeDetail: 0.22,
    /** The back shade of a two-tone ridge sits this many px lower than the front one. */
    ridgeBackDropPx: 12,
    /** Mountain snow caps: how far toward white, and px of cap per px above the line. */
    snowMix: 0.55,
    snowDepth: 0.5,
    /** Cave rock: the slab the teeth grow out of, as a fraction of the tooth height. */
    caveBaseFraction: 0.45,
    /** Mesa talus: how far the base widens past the flat top, as a fraction of it. */
    mesaSkirt: 0.22,
    /** Cloud height as a fraction of its width. */
    cloudAspect: 0.34,
    /** Sky island keel depth and grass cap, as fractions of the island's width. */
    skyIslandDepth: 0.55,
    skyIslandCapFraction: 0.1,
    /** Crystal glow: px of halo around a cluster and how strongly it is drawn. */
    crystalGlowPx: 5,
    crystalGlowAlpha: 0.16,

    /**
     * A ridge's lit top edge: px of the third colour (when the layer declares one)
     * painted along the silhouette, which is the grass line on a hill and the wet
     * highlight on cave rock.
     */
    ridgeCapPx: 3,
    /** Clouds: px of lit top and shaded underside inside a puff. */
    cloudLitPx: 3,
    cloudShadePx: 4,
    /** Trees: canopy blobs per tree and the trunk's width. */
    treeBlobs: 3,
    treeTrunkPx: 3,
    /** Village: window size, and the fraction of houses that light one. */
    villageWindowPx: 3,
    villageLitFraction: 0.65,
    /** Birds: px of wing span and how far the tips drop between the two frames. */
    birdSpanPx: 4,
    birdFlapPx: 2,
    /** Cacti: arm length and the px between two ribs. */
    cactusArmPx: 14,
    cactusRibPx: 4,
    /** Dust: how opaque one streak is baked at. */
    dustAlpha: 0.3,
    /** Fireflies: animation tiles baked, and the px of halo around a lit one. */
    fireflyFrames: 4,
    fireflyGlowPx: 2,
    /** Sun / moon: how opaque the outermost glow ring is baked at. */
    celestialGlowAlpha: 0.1,
    celestialGlowRings: 6,
    /** Waterfall under a sky island: px of fall, of spray, and the streak width. */
    waterfallFallPx: 90,
    waterfallSprayPx: 10,
    waterfallWidthPx: 5,
  },

  effects: {
    flashTicks: 7,
    ringTicks: 22,
    /** Ring radius grows from the carve radius toward damageRadius * this. */
    ringGrowth: 1.6,
    debrisPerExplosion: 22,
    debrisSpeed: 3.4,
    debrisGravity: 0.22,
    debrisLifeTicks: 55,
    debrisSizePx: 2,
    smokeLifeTicks: 34,
    smokeEveryTicks: 2,
    smokeSizePx: 3,
    sparkLifeTicks: 16,
    bubbleLifeTicks: 40,
    /** Ticks a floating damage number stays up. */
    damageTextTicks: 70,
    damageTextRisePx: 0.45,
    /**
     * Hits on one seat inside this many ticks add into the popup already up instead of
     * starting another: a barrage lands eight pellets on one spot in a handful of ticks
     * and eight numbers a pixel apart are unreadable.
     */
    damageTextMergeTicks: 35,
    /** Px a second popup is nudged sideways when it would land on a live one. */
    damageTextSpreadPx: 14,
    /** Blow-up of the 3x5 pixel face damage numbers are drawn with. */
    damageTextScale: 2,
    /** Px above the feet that damage numbers and death debris start from. */
    hullHeightPx: 22,
    /**
     * Beams and marks (DESIGN §3: lightning, asate, aduka/Thor, knight). One generic
     * renderer covers every mobile that calls `beamStrike` or `mark`, so a Phase 4
     * group never has to touch the client.
     */
    beamTicks: 18,
    /** The bright core is this fraction of the event's width. */
    beamCoreFraction: 0.45,
    /** Extra px the glow spills either side of the column. */
    beamGlowPx: 5,
    /** jd's vortex: a ring that runs *inwards* to this fraction of the pull radius. */
    pullTicks: 26,
    pullCollapse: 0.15,
    /** Ticks a mark blinks for when the effect did not say. */
    markTicks: 45,
    /** Ticks per on/off blink of a mark. */
    markBlinkTicks: 6,
    /** Radius of the marker's outer ring, px. */
    markRadiusPx: 12,
    colors: {
      flashCore: '#fff3c4',
      flashEdge: '#ff9b3d',
      ring: '#ffd98a',
      /** The outer shock ring, drawn one step behind the bright one. */
      ringOuter: '#ff9b3d',
      /** Chunk of thrown ground: fill and its 1 px dark side. */
      chunk: ['#8a6a3c', '#6b4f2c', '#7cc45a', '#9aa2ab'],
      chunkEdge: '#2a2118',
      debris: ['#8a6a3c', '#5c4526', '#7cc45a', '#c9c2b4'],
      smoke: ['#c9cdd3', '#9aa2ab', '#6f777f'],
      spark: ['#fff3c4', '#ffb347'],
      bubble: '#bfe4f7',
      damage: '#ffd98a',
      beamCore: '#ffffff',
      beamGlow: '#9ad7ff',
      mark: '#ff6b6b',
      heal: '#7cc45a',
      teleport: '#c08cff',
    },
    /** Teleport (DESIGN §4): a ring at each end of the jump and a trail of sparks. */
    teleportTicks: 26,
    teleportRadiusPx: 26,
    teleportSparks: 14,

    /**
     * The blast itself (art pass). An explosion is five things at once: a white core
     * flash, a shock ring, a fireball of overlapping puffs that cools from white
     * through yellow and orange to red, a column of smoke that rises and greys, and
     * chunks of ground thrown out on ballistic arcs. They are all cheap — filled arcs
     * and fillRects — and all keyed off the event's carve radius, so a big shell looks
     * like a big shell without a second event.
     */
    blast: {
      /** Fireball puffs, and how their radius relates to the carve radius. */
      fireballPuffs: 11,
      fireballRadiusFraction: 0.5,
      fireballSpreadFraction: 1.05,
      fireballTicks: 16,
      /** Px per tick a fireball puff grows and rises. */
      fireballGrowPx: 0.5,
      fireballRisePx: 0.22,
      /** Smoke puffs, their radius, and how long they climb for. */
      smokePuffs: 12,
      smokeRadiusFraction: 0.34,
      smokeSpreadFraction: 0.95,
      smokeTicks: 58,
      smokeGrowPx: 0.22,
      smokeRisePx: 0.5,
      /** Delay in ticks before the smoke starts, so it follows the fire out. */
      smokeDelayTicks: 6,
      /** Chunks of ground: how many, how big, how fast. */
      chunks: 14,
      chunkMinPx: 2,
      chunkMaxPx: 4,
      chunkSpeed: 3.6,
      chunkTicks: 70,
      /** A second, dimmer ring that trails the first. */
      outerRingDelayTicks: 4,
      outerRingGrowth: 1.8,
    },

    /**
     * A hit that did damage throws a fan of sparks back along the incoming shot and a
     * short white pop, which is what separates "it hit the hull" from "it hit the
     * ground next to it".
     */
    hit: {
      sparks: 12,
      sparkSpeed: 2.6,
      sparkTicks: 18,
      popTicks: 6,
      popRadiusPx: 7,
    },

    /**
     * Screen shake (presentation only — it moves the camera for the duration of one
     * world draw and puts it back, and nothing it computes reaches MatchState).
     * The impulse is the carve radius over `radiusForFullPx`, capped.
     */
    shake: {
      radiusForFullPx: 46,
      maxPx: 7,
      /** Fraction of the amplitude kept per rendered frame. */
      decay: 0.86,
      /** Below this the shake is dropped, so it never trembles forever. */
      minPx: 0.35,
      /** Degrees the shake angle advances per frame: an oscillation, not a jitter. */
      degPerFrame: 137,
    },

    /** Hard cap on live particles; the oldest are dropped past it. */
    maxParticles: 900,

    /**
     * The fireball's cooling ramp per damage type (DESIGN §2.6), hottest first: a puff
     * walks it as it ages, which is what makes a blast read as fire rather than as an
     * orange circle — and what makes an ice shell burst white and blue while a shell
     * bursts yellow and red, off one event and no extra data on the wire.
     */
    blastColors: {
      explosive: ['#fff6d8', '#ffe27a', '#ffa832', '#e2542b', '#8c2f1c'],
      energy: ['#ffffff', '#d8f2ff', '#7fd8ff', '#3f8fd8', '#1f4a7a'],
      impact: ['#fff6d8', '#ffe0a8', '#c9a97a', '#8a6a4c', '#4e3a2a'],
      fire: ['#fffbe8', '#ffe27a', '#ff8a2b', '#d83a1c', '#7a2414'],
      ice: ['#ffffff', '#e2fbff', '#a8e8f7', '#5fb8d8', '#2a6f96'],
      water: ['#ffffff', '#dff2ff', '#8fc9ef', '#4a8ec4', '#20527f'],
    } as Record<string, string[]>,

    /**
     * Trail tint per damage type (DESIGN §2.6). The trail *kind* on the projectile def
     * says how the trail behaves — puffs, sparks, bubbles — and the damage type says
     * what colour it is, so ice leaves frost and fire leaves embers without either one
     * needing its own trail kind.
     */
    trailColors: {
      explosive: ['#d8d2c6', '#a09488', '#6f6459'],
      energy: ['#e8f7ff', '#9ad7ff', '#4aa8e8'],
      impact: ['#efe6d2', '#b9ab92', '#7d7364'],
      fire: ['#fff0b0', '#ffb347', '#e2542b'],
      ice: ['#eafcff', '#a8e8f7', '#5fb8d8'],
      water: ['#dff2ff', '#8fc9ef', '#4a8ec4'],
    } as Record<string, string[]>,

    /**
     * Blender flipbooks (render/effectSprites.ts, tools/blender/effects/). When the atlas
     * is in, a blast, a hit pop, a death, a beam, a teleport and a pull are sprites; the
     * thrown ground, debris, sparks, marks, damage numbers and the shake stay code.
     * Pixel art is never scaled, so sizes are picked from tiers.
     */
    sprites: {
      /** Blast tiers by the radius they were drawn for; the nearest to the carve wins. */
      blastTiers: [
        { tier: 's', px: 16 },
        { tier: 'm', px: 26 },
        { tier: 'l', px: 40 },
      ],
      /** A blast with no carve (the frost bloom) is sized off this much of its damage radius. */
      noCarveRadiusFraction: 0.5,
      /**
       * Past the largest tier a carve gets satellite blasts round the large one: one at
       * `satelliteFromPx`, one more every `satellitePerPx`, at most `maxSatellites`, in
       * the `satelliteTier`, `satelliteSpread` of the radius out, each `satelliteDelayTicks`
       * after the last.
       */
      satelliteFromPx: 50,
      satellitePerPx: 12,
      maxSatellites: 4,
      satelliteTier: 'm',
      satelliteSpread: 0.55,
      satelliteDelayTicks: 3,
      /**
       * Smoke left hanging over a crater after the blast's own cloud has gone: puffs per
       * tier, for the damage types that smoke, starting this many ticks in, px apart.
       */
      lingerSmoke: { s: 0, m: 1, l: 2 } as Record<string, number>,
      lingerSmokeTypes: ['explosive', 'fire'],
      lingerSmokeDelayTicks: 34,
      lingerSmokeGapTicks: 10,
      /** Px per tick a smoke puff rises, and the most it drifts sideways. */
      smokeRisePx: 0.36,
      smokeDriftPx: 0.12,
      /** The column over a wreck: a puff every `everyTicks` for `forTicks`, alternating sizes. */
      deathSmokeEveryTicks: 8,
      deathSmokeForTicks: 170,
      deathSmokeDelayTicks: 26,
      /** Beam segments by the core width they were drawn for; the nearest to the event's width wins. */
      beamTiers: [
        { tier: 'n', px: 10 },
        { tier: 'm', px: 20 },
        { tier: 'w', px: 40 },
      ],
      /** Px above the feet the teleport burst sits (it is drawn anchored at its base). */
      teleportLiftPx: 0,
    },

    /** Mark (DESIGN §3): the reticle's corner brackets and the pip inside them. */
    markBracketPx: 5,
    markPipPx: 2,
    /** Px the brackets breathe in and out over one blink. */
    markBreathePx: 3,
  },

  projectiles: {
    /** Draw radius per projectile sprite key (shared only names the key). */
    radiusPx: { shell: 3, shellHeavy: 4, missile: 5, default: 3 },
    body: '#2f3742',
    highlight: '#e8eef5',
  },

  mines: {
    /** Half-size of the box a walking mine is drawn as, in px. */
    halfPx: 4,
    body: '#3a2f2f',
    /** The blinking pip on top, so a live mine reads as armed. */
    pip: '#ff6b5e',
    /** Ticks per on/off cycle of that pip. */
    blinkTicks: 24,
  },

  hud: {
    font: '10px ui-monospace, Menlo, Consolas, monospace',
    /** Text panel geometry: line spacing and the inset around the text. */
    lineHeightPx: 12,
    paddingPx: 6,
    /** Px between the screen edge and a corner panel. */
    marginPx: 8,
    fontLarge: '14px ui-monospace, Menlo, Consolas, monospace',
    fontHuge: '30px ui-monospace, Menlo, Consolas, monospace',
    fg: '#dfe7ef',
    muted: '#93a3b3',
    dim: '#5b6874',
    warn: '#ff7b6b',
    good: '#7cc45a',
    accent: '#ffd23f',
    teamA: '#6fd1ff',
    teamB: '#ffa45c',
    panel: 'rgba(8, 12, 18, 0.72)',
    panelEdge: 'rgba(223, 231, 239, 0.25)',

    /**
     * The skin (docs/ART.md): the HUD is built from bevelled metal plates, not from
     * translucent rectangles. One plate is a near-black outline, a light edge along the
     * top and left, a dark edge along the bottom and right, a two-band face and — on
     * the big plates — rivets in the corners. A *recessed* plate is the same thing with
     * the two bevel edges swapped, which is what a slot, a groove or a gauge channel is.
     *
     * The tones are the metal ramp of docs/ART.md §5 so a button and a mobile are made
     * of the same alloy.
     */
    skin: {
      outline: '#10141c',
      /** Raised plate: face, its lighter top band, and the two bevel edges. */
      face: '#2b3646',
      faceTop: '#3a4759',
      bevelLight: '#6d7c8c',
      bevelDark: '#151b24',
      /** Recessed plate (slots, channels, the dial face). */
      recess: '#141a23',
      recessTop: '#0d1219',
      /** Rivets: the dome, its lit pixel and the shadow under it. */
      rivet: '#8e9dae',
      rivetLight: '#dfe9f2',
      rivetShade: '#10141c',
      /** How far in from a plate's corner a rivet sits. */
      rivetInsetPx: 3,
      /** 1 px gloss run along the top of a filled bar. */
      gloss: 'rgba(255, 255, 255, 0.35)',
      /** Warning hazard stripe used on the fire button's cheek. */
      hazardA: '#ffd23f',
      hazardB: '#3a2f12',
    },

    /**
     * The bottom bar (DESIGN §1.3 HUD, §2.10). Everything inside is placed by an
     * offset from the bar's own top-left, so moving the bar moves the whole cluster.
     */
    bar: {
      heightPx: 96,
      /** Gap between the bar and the left, right and bottom screen edges. */
      sideMarginPx: 6,
      bottomMarginPx: 4,
      back: 'rgba(9, 13, 19, 0.88)',
      backTop: 'rgba(20, 27, 36, 0.92)',
      /** Section label text (MOVE, POWER, LAST). */
      label: '#8595a5',
      /** The lit rail along the top of the kit's `panel-bar` (its top slice). */
      headerHeightPx: 11,
      /**
       * The owner tab — portrait, nick, mobile — a dark label plate riveted over the left
       * end of that rail. The rail itself is too thin to write a readable line on, so the
       * tab stands `tabRisePx` proud of the bar and carries the line at 2x. Its x comes
       * from the portrait (`bottomBarLayout`); these are its height, its padding, the
       * text's top inside it and the gap before the mobile name.
       */
      tabRisePx: 4,
      tabHeightPx: 16,
      tabPadPx: 4,
      nickY: 3,
      nickGapPx: 5,
      nickScale: 2,
      /** Longest run of the tab given to the nick before it is cut. */
      nickMaxPx: 130,
      /** Section divider: how far in front of a block it sits, and its vertical inset. */
      dividerInsetPx: 4,
      dividerTopPx: 14,
      dividerBottomPadPx: 22,
      /**
       * Draw the section captions (MOVE, POWER) and the move-gauge count. The short
       * variant turns them off: on a phone the room they take is worth more than the
       * words, and every widget under them is self-evident anyway.
       */
      labels: true,
    },

    /**
     * Angle dial: the kit's dial face with the mobile's range drawn on it as an arc, the
     * needle at the true angle, and the REL / TRUE readout under it.
     */
    dial: {
      offsetX: 6,
      offsetY: 13,
      sizePx: 80,
      /** Height of the dial's own block: the face, and the readout under it. */
      boxHeightPx: 80,
      /** The kit sprite for the face, and its radius (half its size). */
      piece: 'dial' as 'dial' | 'dial-small',
      radiusPx: 30,
      /** Radius the range arc is drawn at, inside the dial face, and its thickness. */
      arcRadiusPx: 21,
      arcWidthPx: 2,
      needleFromPx: 4,
      needlePx: 23,
      face: 'rgba(5, 8, 12, 0.8)',
      /** Tint laid over the face while the drag pad is in use (DESIGN §7 item 146). */
      faceActive: 'rgba(255, 210, 63, 0.18)',
      range: '#7cc45a',
      /** The two ends of the range get a brighter tick, so its limits read at a glance. */
      rangeEnd: '#b7e46a',
      needle: '#ffd23f',
      /** Little hull line showing the tilt inside the dial. */
      hull: '#93a3b3',
      hullHalfPx: 12,
      /** Up / down arrow buttons beside the dial. */
      arrowOffsetX: 90,
      arrowWidthPx: 20,
      arrowHeightPx: 34,
      arrowTopY: 13,
      arrowGapPx: 4,
      /**
       * The readout under the face: REL big on the left, TRUE small on the right, from
       * the top of the dial block.
       */
      readoutTopPx: 63,
      relScale: 2,
      trueScale: 1,
      /** TRUE on its own line under REL (the short view), rather than beside it. */
      trueBelow: false,
      /** Scale of the pixel triangle on the angle and walk keys. */
      arrowGlyphScale: 1,
      /**
       * The live angle plate drawn above the bar while the dial is being dragged: the
       * thumb is on the dial, so the number it is setting has to be somewhere else.
       */
      dragLabelScale: 2,
      dragLabelPadPx: 3,
      /** Clears the owner tab, which stands 4 px proud of the bar over the dial. */
      dragLabelGapPx: 8,
    },

    /**
     * S1 / S2 / SS as weapon cards (the kit's `card/*` frames with the shot icons). On
     * a desktop they stand side by side as upright cards and the selected shot's name
     * is printed under the row; on a touch screen they are a 2 + 1 grid (DESIGN §7 item
     * 164): S1 and S2 side by side, SS as a wide card under them, so every card is past
     * 44 CSS px in both directions on a 390 px tall phone.
     */
    shots: {
      /**
       * `row`: upright cards left to right. `column`: wide cards top to bottom.
       * `grid`: S1 and S2 as upright cards on the top row, SS as a wide card under them;
       * `widthPx` is then the whole block's width and `heightPx` one row's height.
       */
      stack: 'row' as ShotStack,
      offsetX: 116,
      offsetY: 13,
      widthPx: 38,
      heightPx: 56,
      gapPx: 3,
      key: '#93a3b3',
      keySelected: '#ffd23f',
      /** An SS the gauge has not unlocked yet: dim key plus the `n/max` count. */
      locked: '#5b6874',
      lockedCount: '#93a3b3',
      /** Scale of the shot icon, and of the S1 / S2 / SS key under or beside it. */
      iconScale: 1,
      keyScale: 2,
      /** Upright card: icon centre and key top, from the card's top edge. */
      iconCentreY: 17,
      keyTopPx: 30,
      /** Wide card: icon centre and text column, from the card's left edge. */
      iconCentreX: 17,
      textX: 30,
      /** Gap under an upright row before the selected shot's name. */
      captionGapPx: 5,
      captionScale: 2,
      /** Preferred scale of the shot name on a wide card; it drops when it will not fit. */
      nameScale: 2,
      /** SS gauge inside the SS card: inset from the card's sides and its bottom. */
      gaugeInsetPx: 7,
      gaugeBottomPx: 8,
    },

    /** Movement gauge, drawn above the power bar. */
    gauge: {
      offsetX: 246,
      offsetY: 21,
      widthPx: 194,
      /** The kit trough is 8 px tall; 16 draws it at 2x. */
      heightPx: 8,
      back: '#141a22',
      fill: '#6fd1ff',
      fillLow: '#ff7b6b',
      /** Fraction below which the gauge turns to the warning colour. */
      lowFraction: 0.2,
      /** Where the MOVE caption sits, above the gauge. */
      labelLiftPx: 7,
    },

    /**
     * Hold-to-walk arrow buttons at the right-hand end of the movement gauge, so
     * Left/Right is on screen and not keyboard-only (DESIGN §7 item 27).
     */
    move: {
      offsetX: 448,
      offsetY: 14,
      widthPx: 20,
      heightPx: 18,
      gapPx: 3,
    },

    /**
     * The read-only cluster at top centre: the turn timer, the wind plate and the wind
     * strength side by side on one row, so the whole thing is one plate tall instead of
     * the three stacked plates it used to be. The status tag hangs under it.
     */
    top: {
      y: 4,
      /** Side of the wind plate (the kit sprite is this size) and the gap either side. */
      plateSizePx: 44,
      gapPx: 4,
      /** Plates either side of the wind: the timer on the left, the strength on the right. */
      sideWidthPx: 44,
      sideHeightPx: 32,
      /** The small status line under the cluster ("SHOT IN FLIGHT", "BRO B AIMING"). */
      tagGapPx: 4,
      tagHeightPx: 13,
      tagPadPx: 6,
    },

    /** Turn timer, left of the wind plate. */
    timer: {
      fg: '#dfe7ef',
      warnFg: '#ff7b6b',
      /** Ticks per on/off cycle of the warning flash. */
      flashPeriodTicks: 30,
      /**
       * The last seconds of a turn are the ones the player has to feel, so the plate
       * does more than change colour: it pulses. `pulseTicks` is one full breath, the
       * ring grows by `pulseGrowPx`, and the number is drawn in the pixel font at
       * `digitScale`.
       */
      digitScale: 3,
      pulseTicks: 24,
      pulseGrowPx: 3,
      pulseRing: '#ff7b6b',
      /** Fallback plate tones (before the kit has loaded). */
      back: '#1d2632',
      backWarn: '#3a1b1b',
    },

    /**
     * The turn banner: YOUR TURN, or whose turn it is, on the kit's banner plate. It
     * drops in when a turn starts, holds, and fades away — after that the status tag
     * under the top cluster says the same thing in a line.
     */
    banner: {
      /** Where the plate's top sits, as a fraction of the view height. */
      topFraction: 0.24,
      /** Kit pieces are drawn at this whole scale; the plate is 24 px tall at 1x. */
      pieceScale: 2,
      paddingPx: 30,
      titleScale: 3,
      subScale: 1,
      /** Frames: dropping in, holding, fading out. */
      inFrames: 10,
      holdFrames: 100,
      outFrames: 24,
      /** How far above its resting place the plate starts its drop. */
      dropPx: 14,
      /** The canvas-font fallback for a nick the pixel font cannot spell. */
      font: '22px ui-monospace, Menlo, Consolas, monospace',
    },

    /**
     * The player list, top left: every seat in delay order (DESIGN §2.8 — the head of
     * the list is the only promise), with its HP bar and status icons, and the seat
     * whose turn it is framed in gold. Dead seats sink to the bottom with a skull.
     */
    order: {
      x: 8,
      y: 8,
      widthPx: 184,
      rowHeightPx: 14,
      /** The ORDER / DELAY caption line, inside the panel's top padding. */
      headerHeightPx: 12,
      /** How many seats the list shows. */
      count: 4,
      /** Width of the team-coloured chip down the left edge of every row. */
      teamChipPx: 3,
      /** "you" is printed after your own nickname, whoever's turn it is. */
      selfTag: '#7cc45a',
      selfTagGapPx: 3,
      /** Row geometry: the panel's own padding, then each column's inset. */
      paddingPx: 6,
      headerTopPx: 5,
      chipX: 6,
      iconX: 11,
      nickX: 26,
      hpX: 94,
      hpWidthPx: 44,
      statusX: 140,
      /** The HP fill turns to the warning colour at or under this fraction. */
      lowFraction: 0.3,
      active: '#ffd23f',
      /** Scale of the pixel font for the nicks and the delays. */
      textScale: 1,
    },

    /** The six item slots (DESIGN §4): the loadout, one item per turn, keys 1-6. */
    items: {
      offsetX: 500,
      offsetY: 13,
      /** Width of one slot, and its height: the slots are not square. */
      sizePx: 32,
      heightPx: 48,
      gapPx: 3,
      count: 6,
      key: '#8595a5',
      /** Gap between the slot row and the caption under it. */
      captionGapPx: 5,
      captionScale: 1,
      name: '#dfe7ef',
      /** A spent item: dim name and a strike through it. */
      usedName: '#5b6874',
      usedStrike: 'rgba(255, 123, 107, 0.8)',
      blinkTicks: 16,
      /** Frames a slot flashes for after its item has just been used. */
      flashFrames: 36,
      flash: '#fff3c4',
      /** Insets: the key digit, then the name line and its side padding. */
      keyInsetPx: 5,
      nameTopPx: 32,
      namePadPx: 4,
      /** Centre of the 16x16 kit icon inside the slot, from the slot's top edge. */
      iconCentreY: 19,
      /** Scale of that icon, and of the item name under it. */
      iconScale: 1,
      nameScale: 1,
      /** Print the 1-6 key digit in the corner (a keyboard hint; off on a phone). */
      keyLabels: true,
    },

    /**
     * The stack of short-lived lines under the turn banner: an item was used, a heal
     * landed, sudden death began, the wind changed. One queue, so they cannot overlap.
     */
    notices: {
      /** Under the top cluster and its status tag (`top`). */
      topPx: 70,
      lineHeightPx: 15,
      bigLineHeightPx: 20,
      /** Frames a line stays up, and the tail of that time it fades over. */
      frames: 110,
      bigFrames: 200,
      fadeFrames: 30,
      /** Lines shown at once; older ones are dropped. */
      max: 4,
    },

    /**
     * Teleport's targeting mode (DESIGN §4): the crosshair that follows the mouse
     * until the player clicks a spot or presses Esc.
     */
    targeting: {
      radiusPx: 9,
      armPx: 7,
      gapPx: 3,
      /** The hull ghost drawn at the cursor, as a fraction of the mobile's footprint. */
      ghostAlpha: 0.5,
      valid: '#7cc45a',
      invalid: '#ff7b6b',
      /** Px between the crosshair and the label under it. */
      labelOffsetPx: 16,
      blinkTicks: 24,
    },

    /** Fire and skip buttons on the right of the bar: the kit's gold and blue keys. */
    buttons: {
      offsetX: 710,
      widthPx: 70,
      skipY: 13,
      skipHeightPx: 28,
      fireY: 45,
      fireHeightPx: 43,
      /** Label tops: SKIP and FIRE from the top, "hold" up from the bottom. */
      skipLabelTopPx: 9,
      fireLabelTopPx: 9,
      holdLabelBottomPx: 12,
      fireLabelScale: 3,
      /** "HOLD" (or the charge %) under FIRE. */
      holdLabelScale: 1,
      /** The charge filling the FIRE key itself while it is held (item 147). */
      chargeFill: 'rgba(255, 90, 40, 0.42)',
      chargeFlashTicks: 4,
      /** Label ink on the gold key, and on the blue one. */
      fireInk: '#3a1a06',
      fireInkHeld: '#fff3c4',
      skipInk: '#eaf4ff',
    },

    /** The ink a key's label is drawn in while the seat may not act. */
    disabledInk: '#8a939c',
    /** What little is still greyed out with alpha while the seat may not act. */
    disabledAlpha: 0.45,

    /**
     * The power bar (DESIGN §2.10): the kit's trough at 2x with its fill, the 4 x 5 tick
     * scale over it, and the power-marker sprite at the last shot's power.
     */
    power: {
      /** Bar geometry inside the bottom bar: the whole trough, at `pieceScale`. */
      offsetX: 246,
      offsetY: 40,
      width: 244,
      height: 32,
      pieceScale: 2,
      /** Power at or above this fraction draws in the hot fill. */
      hotFrom: 0.85,
      /** Fallback fill tones (before the kit has loaded). */
      back: '#1b2430',
      fill: '#ffb238',
      fillHot: '#ff5a3c',
      majorTick: 'rgba(255, 255, 255, 0.55)',
      minorTick: 'rgba(0, 0, 0, 0.45)',
      /** The last shot: marker sprite scale, and the line it drops through the fill. */
      markerScale: 1,
      marker: '#ffd23f',
      markerLine: 'rgba(255, 243, 196, 0.9)',
      /** Glow drawn around the bar while charging, and its pulse period in ticks. */
      chargeGlow: 'rgba(255, 210, 63, 0.7)',
      chargePulseTicks: 20,
      /** The bar flashes while it is held at full. */
      maxFlash: '#fff3c4',
      maxFlashTicks: 8,
      /** The numbers under the bar: power now, and the last shot's. */
      readoutGapPx: 4,
      valueScale: 2,
      /** Where the numbers go when `readoutBeside` is set: right of the walk keys. */
      readoutBeside: false,
      readoutBesideX: 104,
      /** The "LAST" caption and the last shot's number, when `readoutBeside` is set. */
      besideLabelScale: 1,
    },

    wind: {
      /** Arrow body, its lit edge and its outline: the fallback arrow, before the kit. */
      arrowLength: 30,
      arrowHead: 5,
      arrow: '#ffd23f',
      arrowEdge: '#10141c',
      arrowHalfWidthPx: 3,
      dialFace: '#141a23',
      dialRim: '#6d7c8c',
      /** Strength colours: calm, and strong (at or over `strongFrom` of the maximum). */
      badgeCalm: '#7cc45a',
      badgeStrong: '#ffd23f',
      strongFrom: 0.6,
      badgeScale: 2,
      /** Five pips under the number, lit in proportion to the strength. */
      pips: 5,
      pipOff: '#3a4656',
    },

    nameTag: {
      /**
       * Px of clear air between the top of the sprite and the tag. The lift itself comes
       * from the sprite's own anchor (`anchor.y` is how many rows stand above the feet),
       * because mobiles are not all one height any more (docs/ART.md).
       */
      clearancePx: 8,
      /** Floor on that lift, for a sprite drawn much shorter than its canvas. */
      minOffsetPx: 40,
      barWidth: 40,
      barHeight: 4,
      /** Gap between the HP bar and the shield bar under it. */
      barGapPx: 2,
      shieldHeight: 3,
      hp: '#7cc45a',
      hpBack: '#3a1f1f',
      shield: '#6fd1ff',
      shieldBack: '#1b2b38',
      /** HP fraction below which the bar turns to the warning colour. */
      lowFraction: 0.3,
      /** Extra outline around the active seat's tag. */
      activeEdge: '#ffd23f',
      /**
       * The tag is drawn over the world, so it carries its own outline and a 1 px lit
       * run along the top of each bar — the same treatment the sprites get, for the same
       * reason: nothing on a textured hillside reads without an edge.
       */
      outline: '#10141c',
      hpLight: '#b7e46a',
      shieldLight: '#bfeaff',
      /** Scale of the pixel font used for the HP number beside the bar. */
      textScale: 1,
      hpText: '#dfe7ef',
      /** Px between the bars and the nickname above them. */
      nickGapPx: 3,
    },

    /**
     * Chat bubbles over a mobile's head while a match is on (DESIGN §6.1 `chat`): the
     * line is already in the overlay log, but a bubble is what makes it *the opponent*
     * talking rather than a line of text in a corner.
     */
    bubble: {
      /** Frames a bubble stays up before it fades, and the tail of that it fades over. */
      frames: 200,
      fadeFrames: 30,
      maxWidthPx: 132,
      paddingPx: 4,
      lineHeightPx: 9,
      /** Px between the mobile's head and the bubble's tail. */
      gapPx: 6,
      /** Chars per line the text is wrapped to. */
      wrapChars: 22,
      back: '#f2f7fb',
      backEdge: '#a8b8c6',
      outline: '#10141c',
      text: '#161c24',
      tailWidthPx: 6,
      tailHeightPx: 5,
    },

    /** Highlight ring drawn under the mobile the keyboard controls. */
    selection: {
      color: '#ffd23f',
      radiusPx: 22,
      dashPx: 4,
    },

    /**
     * The aim arrow from the muzzle (DESIGN §7 item 171), in backbuffer px along the
     * aim. The shaft is `dotPx` squares every `stepPx` from `fromPx` to `toPx`, fading
     * in from `fadeFrom`; the head starts `headGapPx` past the last dot, and is long and
     * narrow so it still reads as a point at 45°. Every pixel carries a 1 px `outline`.
     */
    aim: {
      color: '#ffd23f',
      outline: '#10141c',
      fromPx: 8,
      toPx: 40,
      stepPx: 6,
      dotPx: 2,
      fadeFrom: 0.5,
      headGapPx: 6,
      headLengthPx: 9,
      headHalfWidthPx: 3.5,
    },

    /**
     * The idle sprite frame beside the owner's name in the bar header, so the player
     * can see *what* they are driving without reading its name. Sprites differ in size
     * (docs/ART.md), so `portraitCrop` shrinks the whole frame by an integer divisor to
     * fit this plate; the plate sits in the bar's lit top band, so it is the band's
     * height and a 48 px tall mobile lands on a clean 1/5.
     */
    portrait: {
      offsetX: 8,
      offsetY: 0,
      widthPx: 16,
      heightPx: 9,
      /** Gap between the portrait and the nickname beside it. */
      gapPx: 4,
      back: 'rgba(5, 8, 12, 0.6)',
    },

    /**
     * The three toggle buttons under the order list: sound, help and chat. They sit
     * outside the bottom bar because they work while it is greyed out — a player
     * watching someone else's turn may still mute, read the keys and chat.
     */
    toggles: {
      x: 8,
      /**
       * Air between the bottom of the order panel and this row. The row's own y is
       * {@link belowOrderPanelY}, so raising `order.count` pushes it down instead of
       * letting the list grow through it.
       */
      gapAbovePx: 12,
      sizePx: 18,
      gapPx: 4,
      /** Scale of the 12x12 icon on a key. */
      iconScale: 1,
      back: 'rgba(8, 12, 18, 0.72)',
      backOn: 'rgba(255, 210, 63, 0.18)',
      edge: 'rgba(223, 231, 239, 0.25)',
      edgeOn: '#ffd23f',
      icon: '#dfe7ef',
      iconOff: '#5b6874',
      /** The little "off" slash across the speaker when sound is muted. */
      slash: '#ff7b6b',
    },

    /**
     * The controls card (H). It replaces the always-on key line: the keys matter for
     * the first five minutes and are clutter forever after.
     */
    help: {
      widthPx: 250,
      /** Distance from the bottom bar's top edge up to the card's bottom. */
      aboveBarPx: 6,
      /** Chars per line the help text is wrapped to before the card is measured. */
      wrapChars: 38,
      titleGapPx: 3,
    },

    /**
     * "RECONNECTING" while the socket is away (DESIGN §6.4). The match keeps running
     * locally, which is exactly why this has to be visible: a frozen opponent with no
     * explanation reads as a broken game.
     */
    netBadge: {
      /** Right-aligned, just above the bottom bar. */
      rightMarginPx: 8,
      aboveBarPx: 6,
      widthPx: 128,
      heightPx: 16,
      back: 'rgba(40, 12, 12, 0.85)',
      edge: '#ff7b6b',
      textTopPx: 3,
      /** Frames per on/off cycle of the dot beside the word. */
      blinkFrames: 30,
    },

    /** Full-screen result plate when the match ends. */
    gameOver: {
      widthPx: 360,
      heightPx: 130,
      back: 'rgba(5, 8, 12, 0.9)',
      edge: '#ffd23f',
      dim: 'rgba(5, 8, 12, 0.55)',
      /** Title baseline, first line's baseline, and the spacing between lines. */
      titleTopPx: 20,
      linesTopPx: 66,
      lineHeightPx: 14,
    },

    /**
     * The short-view variant (DESIGN §7 item 143).
     *
     * A phone in landscape gets a backbuffer around 800x370, and the 96 px bar designed
     * for 800x600 is then both too short for a thumb and too detailed to read: at a fit
     * scale of about 1, one backbuffer pixel is one CSS pixel, so an 18 px walk arrow is
     * an 18 px target. Everything a player touches is grown past 44 CSS px here — the
     * arrows, the fire and skip keys, the toggles — the numbers are drawn twice as big,
     * and the captions and keyboard hints that paid for themselves on a desktop are
     * dropped to make the room.
     *
     * Only the keys that differ from the full geometry above are listed; the rest (every
     * colour, every animation period) is shared, so a tone changed once changes both.
     * `bottomBarLayout` picks the set from the view height (`hudVariantFor`).
     */
    compact: {
      bar: {
        heightPx: 124,
        sideMarginPx: 4,
        bottomMarginPx: 3,
        dividerInsetPx: 3,
        dividerTopPx: 14,
        dividerBottomPadPx: 22,
        labels: false,
      },
      dial: {
        offsetX: 6,
        offsetY: 14,
        sizePx: 72,
        boxHeightPx: 104,
        piece: 'dial-small' as 'dial' | 'dial-small',
        radiusPx: 26,
        arcRadiusPx: 18,
        needlePx: 20,
        hullHalfPx: 11,
        arrowOffsetX: 82,
        arrowWidthPx: 47,
        arrowHeightPx: 47,
        arrowTopY: 14,
        arrowGapPx: 6,
        readoutTopPx: 57,
        relScale: 3,
        trueScale: 2,
        trueBelow: true,
        arrowGlyphScale: 2,
        dragLabelScale: 3,
        dragLabelPadPx: 4,
      },
      /**
       * The 2 + 1 grid (item 164). Three stacked wide cards were 32 px tall — 30 CSS px
       * on an iPhone 13, the one thing a thumb pressed during a turn that missed 44. Two
       * rows of 49 fill the same 104 px of the bar: S1 and S2 are 52 and 53 px wide, SS
       * the whole 108, and every one of them is over 46 CSS px each way on the 750 px
       * canvas a notched iPhone leaves the game. The upright S1 / S2 cards have no room
       * for a name, so the selected shot's name moves to the owner tab.
       */
      shots: {
        stack: 'grid' as ShotStack,
        offsetX: 133,
        offsetY: 14,
        widthPx: 108,
        heightPx: 49,
        gapPx: 3,
        /** Upright S1 / S2: icon centre and key top, from the card's top edge. */
        iconCentreY: 16,
        keyTopPx: 29,
        /** Wide SS: icon centre and text column, from the card's left edge. */
        iconCentreX: 17,
        textX: 30,
        nameScale: 2,
      },
      gauge: {
        offsetX: 246,
        offsetY: 14,
        widthPx: 164,
        heightPx: 16,
      },
      move: {
        offsetX: 246,
        offsetY: 34,
        widthPx: 47,
        heightPx: 47,
        gapPx: 6,
      },
      power: {
        offsetX: 246,
        offsetY: 84,
        width: 164,
        height: 32,
        markerScale: 1,
        valueScale: 3,
        readoutBeside: true,
        /** Right of the two 47 px walk keys and the 6 px between them. */
        readoutBesideX: 106,
        /** Twice the desktop's: a 5 px caption is 4 CSS px on a small phone. */
        besideLabelScale: 2,
      },
      items: {
        /**
         * All the room there is between the power block (which ends at 410) and the
         * SKIP / FIRE column (which starts at 714): six slots of 47 with 3 px between
         * them is 297. 47 px is what puts a slot over 44 CSS px on the 750 CSS px canvas
         * a notched iPhone 13 leaves the game in landscape (a scale of 0.9375: DESIGN §7
         * item 165). The slots are what a player taps to use Bandage or Teleport
         * mid-turn, so the pixels came out of the power block and the shot grid.
         */
        offsetX: 414,
        offsetY: 14,
        /** Wide enough for a four-letter name at scale 2 with air either side of it. */
        sizePx: 47,
        heightPx: 60,
        gapPx: 3,
        iconCentreY: 23,
        iconScale: 2,
        nameTopPx: 43,
        nameScale: 2,
        namePadPx: 3,
        keyLabels: false,
        captionGapPx: 5,
        captionScale: 2,
      },
      /**
       * SKIP is 47 tall for the same 0.9375 scale as the item slots; FIRE keeps the
       * rest of the column (53: still 44 CSS px on an iPhone SE's 0.83), the biggest key
       * in the bar.
       */
      buttons: {
        offsetX: 714,
        widthPx: 72,
        skipY: 14,
        skipHeightPx: 47,
        fireY: 63,
        fireHeightPx: 53,
        skipLabelTopPx: 18,
        fireLabelTopPx: 12,
        holdLabelBottomPx: 16,
        /** Twice the desktop's, for the same reason as `power.besideLabelScale`. */
        holdLabelScale: 2,
      },
      portrait: {},
      toggles: {
        x: 8,
        /**
         * Tighter than the full variant's: the order list, this row and the debug panel
         * under it all have to clear a bar that starts at y 233 on the shortest view.
         */
        gapAbovePx: 7,
        /** 47: 44 CSS px at the 0.9375 scale of a notched iPhone's 750 px canvas. */
        sizePx: 47,
        gapPx: 6,
        iconScale: 2,
      },
      /**
       * Three rows instead of four: the list, the toggle keys under it and the debug
       * panel under those all have to fit above a bar that starts at y 243 on the
       * shortest view.
       */
      order: {
        count: 3,
        textScale: 2,
      },
      help: {
        /**
         * Wider than the full variant's, in proportion to the wrap: the same font draws
         * about 6.3 px per character, so 44 of them plus the panel's two 6 px margins
         * need 290. At 250 the touch wording ran out past the card's right border, and
         * since the compact card is pinned to the right edge of the view that is off
         * the screen rather than over the sky.
         */
        widthPx: 290,
        wrapChars: 44,
      },
    },
  },

  /**
   * Sky events on screen (DESIGN §5): the tornado's funnel, the Force band and Thor's
   * satellite. Read only by `render/sky.ts`; nothing here can reach `MatchState`.
   */
  sky: {
    tornado: {
      /** Funnel width as a fraction of `sky.tornado.halfWidth`, at the top and the foot. */
      topScale: 1.15,
      bottomScale: 0.55,
      /** Vertical spacing and rise speed (px per frame) of the swirl bands. */
      bandSpacingPx: 26,
      bandRisePx: 2.4,
      bandHeightPx: 4,
      /** Degrees of swirl phase per px of height, and per frame. */
      swirlPerPx: 2.2,
      swirlPerFrame: 7,
      body: 'rgba(176, 202, 230, 0.20)',
      bodyEdge: 'rgba(226, 240, 255, 0.30)',
      band: 'rgba(236, 246, 255, 0.70)',
      bandDim: 'rgba(158, 188, 220, 0.42)',
      /** 1 px line above and below a swirl band, so it reads as a form, not a haze. */
      bandEdge: 'rgba(96, 126, 158, 0.55)',
      /** Column outline, drawn 1 px wide down both sides. */
      outline: 'rgba(226, 242, 255, 0.55)',
      /**
       * The funnel is stacked slabs rather than a smooth wash: `slabHeightPx` tall, one
       * tone of the ramp each, and the ramp walks down `slabSpinPerFrame` slabs a frame
       * so the banding spirals upward. Every tone stays translucent — a mobile behind
       * the column has to stay visible.
       */
      slabHeightPx: 5,
      slabSpinPerFrame: 0.34,
      slabTones: [
        'rgba(226, 240, 255, 0.46)',
        'rgba(170, 200, 232, 0.22)',
        'rgba(120, 156, 196, 0.38)',
        'rgba(198, 224, 248, 0.16)',
      ],
      slabSeam: 'rgba(72, 100, 132, 0.42)',
      /**
       * The twist: a slab slides `slabShift` of its half-width off centre and pinches to
       * `1 - slabPinch` of it as the face it shows turns away, phase advancing with
       * height and with the frame. Stacked, that is a funnel turning.
       */
      slabTwistPerPx: 3.4,
      slabTwistPerFrame: 6,
      slabShift: 0.16,
      slabPinch: 0.3,
      /** The whole column leans this far, phase lagging `swayPerPx` a px up the height. */
      swayPx: 4,
      swayPerFrame: 2.2,
      swayPerPx: 0.55,
      /**
       * Torn-up ground riding the funnel: specks that spiral up the column and wrap
       * back to the bottom, and a skirt of dust where it meets the ground. Deterministic
       * from the frame counter, so they cost nothing to keep.
       */
      debris: 30,
      debrisRisePx: 3.1,
      debrisColor: 'rgba(196, 176, 150, 0.75)',
      debrisDarkColor: 'rgba(122, 106, 86, 0.7)',
      /** Every fourth speck is torn foliage rather than grit. */
      leafColor: 'rgba(118, 170, 92, 0.85)',
      skirtHeightPx: 26,
      skirtColor: 'rgba(206, 192, 170, 0.22)',
      /** Chunks tumbling round the touchdown, on an ellipse so the far side rides high. */
      footChunks: 12,
      footSpinPerFrame: 5.5,
      footRingScale: 2.6,
      footRingLiftPx: 6,
      footRingRisePx: 5,
    },
    force: {
      /** Strips the band is drawn as; the middle ones are the brightest. */
      strips: 9,
      coreAlpha: 0.26,
      edgeAlpha: 0.06,
      color: '208, 150, 255',
      edge: 'rgba(228, 184, 255, 0.55)',
      /** Chevrons drifting along the band. */
      chevronSpacingPx: 72,
      chevronSpeedPx: 1.6,
      chevronWidthPx: 10,
      chevronHeightPx: 6,
      chevron: 'rgba(240, 214, 255, 0.62)',
    },
    thor: {
      /** World y of the satellite's centre; it sits at the top of the map. */
      topPx: 34,
      /**
       * …but the camera spends the match looking at the ground, and a satellite nobody
       * ever sees is not a sky event. So it is pinned into the view: never higher than
       * `minScreenY` from the top of the screen and never closer than `edgeMarginPx` to
       * either side, which turns it into its own off-screen indicator when the map's
       * middle is out of shot. `minScreenY` clears the HUD's top strip (the order panel,
       * the toggles and the banner) so the satellite is never drawn under a panel.
       */
      minScreenY: 126,
      edgeMarginPx: 40,
      bodyW: 20,
      bodyH: 12,
      panelW: 12,
      panelH: 7,
      /** Bob amplitude and period in frames. */
      bobPx: 3,
      bobFrames: 120,
      body: '#c9d6e4',
      bodyDark: '#5d6c7c',
      panel: '#3f7fd0',
      panelEdge: '#8fc0ff',
      lens: '#ffe9a3',
      lensHot: '#fff8dc',
      /** Level badge under the satellite. */
      badgeBack: 'rgba(8, 12, 18, 0.78)',
      badgeEdge: 'rgba(255, 210, 63, 0.7)',
      badgeFg: '#ffd23f',
      badgeWidthPx: 34,
      badgeHeightPx: 11,
      /** The strike flash: a column of light that fades over this many frames. */
      flashFrames: 26,
      flashWidthPx: 34,
      flashCore: '255, 246, 214',
      flashGlow: '255, 214, 92',
      /** Frames the satellite glows for after a level-up. */
      levelPulseFrames: 48,
      /** Dish, antenna and the red beacon that makes it read as a machine at 20 px. */
      dishPx: 7,
      antennaPx: 8,
      beacon: '#ff6b5e',
      beaconFrames: 34,
      /** The charge glow that gathers at the lens before a strike. */
      lensGlow: 'rgba(255, 233, 163, 0.45)',
      lensGlowPx: 7,
    },
    label: {
      /**
       * Pinned to the *right* edge, on the row {@link belowOrderPanelY} puts it on: the
       * top-left corner already carries the order panel and the toggles, and a mobile
       * framed against the map's own left edge ends up under whatever else is there.
       */
      rightInsetPx: 8,
      widthPx: 132,
      heightPx: 18,
      back: 'rgba(8, 12, 18, 0.72)',
      edge: 'rgba(223, 231, 239, 0.25)',
      textLeftPx: 6,
      textTopPx: 5,
    },
  },

  /** Dev sandbox only (DESIGN §7 item 14): it never ships in the production build. */
  sandbox: {
    /** Px of slack when deciding a mobile is off screen and can be skipped. */
    cullMarginPx: 64,
    /** Dash phase advanced per tick on the selection ring. */
    ringPhasePerTick: 0.5,
    /**
     * Debug panel (seed, tick, phase): its width, and the air between the toggle row
     * and its top. It is drawn top left under the toggles, because the match scene's
     * DOM leave button owns the top right corner.
     */
    debugWidthPx: 186,
    debugTopPx: 8,
  },

  input: {
    /** Degrees of relative aim per tick while an aim key or arrow button is held. */
    aimDegPerTick: 0.7,
    /** Aim step per tap of the key (edge), so small corrections are possible. */
    aimDegPerTap: 1,
    /**
     * How often the `charging` intent goes out while the charge is held (DESIGN §7
     * item 18: a few times a second is enough for the timer to fire at the right power).
     */
    chargeSendHz: 5,
    /**
     * Auto-repeat acceleration for a *held* angle key or arrow button (DESIGN §7
     * item 145). The first `accelFromMs` run at the designed rate so a short press is
     * still a nudge; after that the rate ramps to `maxFactor` over `rampMs`, so
     * crossing the whole 80-degree range is a press and not a marathon.
     */
    aimHold: {
      accelFromMs: 350,
      rampMs: 900,
      maxFactor: 3.4,
    },
    /**
     * The drag pad (DESIGN §7 item 146): degrees of relative aim per backbuffer pixel
     * the finger travels *up* the angle dial. 80 degrees over about 100 px is a
     * comfortable thumb sweep that still lands on a single degree.
     */
    aimDragDegPerPx: 0.8,
    /**
     * How far a pointer may travel and still count as a tap rather than a drag. Three
     * backbuffer pixels is about 3 CSS px on a phone, under the 10 px a finger wobbles
     * when its owner meant to hold still.
     */
    tapSlopPx: 3,
  },

  /**
   * The socket and the reconciliation (DESIGN §6). None of these numbers reach
   * MatchState: they are retry delays, smoothing thresholds and HUD counters.
   */
  net: {
    /** First reconnect delay; each further attempt multiplies it, capped. */
    reconnectBaseMs: 500,
    reconnectFactor: 1.8,
    reconnectMaxMs: 8000,
    /** Largest exponent applied to the factor, so the cap is reached in a few steps. */
    reconnectMaxExponent: 6,
    /** Fraction of the delay added or removed at random, so tabs do not retry in step. */
    reconnectJitter: 0.25,
    /** Application-level keep-alive; the server's own ws ping runs at 25 s. */
    pingIntervalMs: 20_000,
    /** Messages held while the socket is connecting before the oldest are dropped. */
    maxQueued: 64,
    /** Aim messages below this spacing are dropped by the server anyway. */
    aimSendMs: 45,
    /**
     * How far the authority's `moveEcho` position may differ from the local
     * simulation's before the local one is snapped onto it. A real-time client is a
     * few ticks off the authority (DESIGN §7 item 35), so small differences are normal
     * and are reconciled at `turnEnd`; a large one is visible and worth correcting now.
     */
    moveSnapPx: 6,
    /**
     * Ticks the local simulation may fast-forward in one go to reach the tick an
     * authoritative message names. Anything longer is a stalled tab, and the `turnEnd`
     * snapshot puts it right more cheaply than replaying minutes of simulation.
     */
    maxCatchUpTicks: 240,
    /**
     * How far behind a `turnEnd` this engine may be and still play the rest of the
     * shot out in real time instead of jumping to it (DESIGN §7 item 170). A phone on a
     * real network runs a few hundred ms behind; anything past 3 s is a stalled tab,
     * which reconciles from the snapshot at once.
     */
    maxTurnEndHoldTicks: 180,
    /**
     * Ticks of margin between the authority's clock, as we estimate it, and the
     * furthest tick the local simulation may reach (DESIGN §7 item 45).
     *
     * The estimate comes from the last message we heard and the real time since, so it
     * is only as good as that message's latency: a message that happened to arrive fast
     * would otherwise let the local clock run *past* a tick the server has not reached
     * yet, and the next authoritative message would name a tick already behind us — a
     * one-tick-late `move` or `turnEnd`, which is a desync the snapshot then repairs.
     *
     * Six ticks — 100 ms — because two were not enough on a phone (DESIGN §7 item 156).
     * Measured on two emulated iPhone 13s playing over a local socket: with two ticks of
     * slack the walking client was one to three ticks *past* the tick its own first
     * `moveEcho` named about a third of the time, `stepTo` cannot rewind, so the walk
     * started late, ended ~2 px short and mismatched at that turn's hash — exactly one
     * "desync #1" per client per match. With six the client stayed four to seven ticks
     * behind the authority on every turn of a dozen runs and the counter stayed at 0.
     * The cost is invisible: the floor of {@link ServerClock.cap} is the last tick the
     * authority actually reported, so the slack only limits how far *ahead* of the last
     * message this engine may guess, never how far behind it falls.
     */
    tickCapSlackTicks: 6,
    /**
     * How far the clock estimate may be *relaxed* after an unusually slow message.
     *
     * Each message implies a moment the authority's tick 0 happened; latency and the
     * server's own scheduling only ever push that estimate later, so the latest estimate
     * is the safest one and is the one kept. Without a bound a single 2 s hiccup would
     * cost the rest of the match that much lag, so an estimate this much older than the
     * newest one is given up.
     */
    tickOriginRelaxMs: 500,
    /** Lines of chat kept in the room and the in-match overlay. */
    chatHistory: 60,
    /** Ticks a chat line stays on the match overlay after it arrived. */
    chatFadeTicks: 600,
  },

  /**
   * The item loadout (DESIGN §4). Presentation only: the six slots and every magnitude
   * are shared data, and the server validates whatever the picker sends.
   */
  loadout: {
    /**
     * What a browser that has never picked a loadout starts with, and what both
     * sandbox seats carry so items can be tried without a server. Six slots exactly:
     * Dual (2) + Teleport + Bandage + Bunge + Power Up.
     */
    default: ['dual', 'teleport', 'healSmall', 'bunge', 'powerUp'] as ItemId[],
  },

  /**
   * The DOM menus (lobby, room, chat overlay). Presentation only: the server sanitises
   * and caps everything that arrives on the wire whatever a field here allows.
   */
  ui: {
    /** `maxLength` of the nickname field; the server's NICK_MAX_LENGTH default. */
    nickMaxLength: 16,
    /** `maxLength` of the room-code field. */
    codeMaxLength: 16,
    /** `maxLength` of a chat line; the server's CHAT_MAX_LENGTH default. */
    chatMaxLength: 200,
    /** How long "link copied" stays under the room code. */
    copiedToastMs: 2500,
    /**
     * How long the in-match chat log stays over the board after its last line while
     * the chat line is closed (DESIGN §7 item 167). It then fades out; the unread pip
     * on the chat button and opening the line bring it back.
     */
    chatLogLingerMs: 8000,
    /** Room sizes offered in the lobby; the server's own cap is MAX_PLAYERS_PER_ROOM. */
    roomSizes: [2, 3, 4, 5, 6, 7, 8],
    /** How often the lobby asks for the open-rooms list while it is on screen. */
    roomListPollMs: 4000,

    /**
     * Mobile portraits in the room's picker: a tile every sprite is stood on, whatever
     * its own canvas size, so a row of them shares one baseline.
     */
    portrait: {
      /** The default box, in CSS px (ui/mobilePortrait.ts). */
      widthPx: 84,
      heightPx: 64,
      /** Largest whole-pixel blow-up a portrait may use when its box has the room. */
      maxScale: 3,
      /** The barrel's rest angle above the hull in a portrait, in degrees. */
      aimDeg: 0,
      /**
       * Picker tiles, the chosen mobile's close-up and the player slot cards. 84x64 holds
       * the largest Blender idle loop (the triclops, 82x64 once cropped) at 1x, so no
       * mobile is ever shrunk; the close-up is the same at 2x.
       */
      tile: { widthPx: 84, heightPx: 64 },
      detail: { widthPx: 168, heightPx: 128 },
      slot: { widthPx: 84, heightPx: 64 },
      /** A landscape phone (the same test as index.html) keeps the close-up at 1x. */
      compact: {
        tile: { widthPx: 84, heightPx: 64 },
        detail: { widthPx: 84, heightPx: 64 },
        slot: { widthPx: 84, heightPx: 64 },
      },
    },

    /** The pixel wordmark on the lobby and the room header. */
    wordmark: {
      lobbyScale: 6,
      roomScale: 3,
    },

    /** Item icons in the loadout picker and the slot bar, as a whole-pixel scale. */
    itemIconScale: 2,
  },

  loop: {
    /** Largest real-time gap a single frame may consume, in ms (tab-switch guard). */
    maxFrameMs: 250,
    /** Ticks simulated at most in one frame, so a long stall cannot lock the page. */
    maxTicksPerFrame: 12,
    /**
     * Ms after an `orientationchange` before the canvas is fitted a second time: iOS
     * reports the window it is rotating *out of* for a frame or two after the event.
     */
    orientationSettleMs: 350,
    /**
     * How long the backbuffer stays frozen after the chat line lost focus, waiting for
     * the virtual keyboard to finish sliding away (DESIGN §7 item 159).
     *
     * iOS fires `blur` when the keyboard *starts* to go, so unfreezing there fits the
     * canvas to a window that is still half keyboard and fits it again a moment later.
     * The freeze is lifted by the `visualViewport` resize that says the window is whole
     * again; this is only the fallback for a browser that never sends one.
     */
    keyboardSettleMs: 700,
  },

  /**
   * Sound (DESIGN §1.3 `audio/synth.ts`, §8: every effect is built from oscillators,
   * noise and envelopes — no samples; the music is `music` below). Two halves:
   *
   * - `mapping`: how an event becomes a cue (`audio/sfx.ts`), which is pure and tested;
   * - `voices`: what each cue sounds like (`audio/synth.ts`), which is tuned by ear.
   *
   * Frequencies are Hz, durations seconds, gains are fractions of the master gain.
   */
  audio: {
    /** Everything goes through this one gain; mute ramps it to 0. */
    masterGain: 0.35,
    muteRampS: 0.02,
    /** Envelope shape shared by every voice, plus the slack before a node is stopped. */
    attackS: 0.006,
    tailS: 0.05,
    /** Length of the white-noise buffer every burst loops over. */
    noiseBufferS: 1,
    /** Most voices one tick may start at once (see `mergeCues`). */
    maxCuesPerTick: 3,

    mapping: {
      /** Carve radius that means "as loud as it gets", and the floor under it. */
      explosionRefRadiusPx: 40,
      explosionMinLevel: 0.35,
      /** A chained mine is a small blast wherever it goes off. */
      mineExplodeLevel: 0.5,
      /** Damage (hp plus a share of the shield) that means a full-strength hit. */
      hitRefDamage: 220,
      hitMinLevel: 0.3,
      /** How much a point soaked by the shield counts toward the hit's loudness. */
      shieldShare: 0.5,
      /** A nudge still makes a noise; a full charge is the loudest, lowest shot. */
      fireMinLevel: 0.45,
      firePitchLow: 0.85,
      firePitchHigh: 1.25,
      /** Wind under this is still audible when it changes. */
      windMinLevel: 0.3,
      /** Your own turn chime rings a fifth up; your own damage a fourth down. */
      selfPitchUp: 1.5,
      selfPitchDown: 0.75,
      /** Somebody else's clock running out is not your emergency. */
      otherPitchDown: 0.8,
      /** Each major power bar ticks this much higher than the one before. */
      chargeTickStep: 1.12,
      /** The "selected" click sits above the plain one. */
      selectPitch: 1.33,
    },

    voices: {
      /** The rising tone while the power bar fills (DESIGN §2.10). */
      charge: {
        type: 'triangle',
        fromHz: 110,
        toHz: 700,
        gain: 0.1,
        fadeInS: 0.04,
        fadeOutS: 0.06,
        /** Time constant of the glide, so the pitch follows the bar smoothly. */
        glideS: 0.02,
      },
      /** Click at each major bar of the charge. */
      chargeTick: { hz: 1200, durS: 0.035, gain: 0.16, attackS: 0.001 },
      fire: {
        gain: 0.45,
        fromHz: 360,
        toHz: 90,
        durS: 0.22,
        noiseGain: 0.3,
        noiseFromHz: 2400,
        noiseToHz: 300,
        noiseDurS: 0.18,
      },
      explosion: {
        gain: 0.55,
        durS: 0.55,
        filterFromHz: 1600,
        filterToHz: 80,
        q: 0.8,
        thumpGain: 0.5,
        thumpFromHz: 120,
        thumpToHz: 32,
        thumpDurS: 0.4,
      },
      hit: {
        gain: 0.35,
        fromHz: 320,
        toHz: 160,
        durS: 0.14,
        noiseGain: 0.22,
        noiseFromHz: 2600,
        noiseToHz: 900,
        noiseDurS: 0.1,
        q: 2,
      },
      death: {
        gain: 0.45,
        fromHz: 300,
        toHz: 45,
        durS: 0.8,
        noiseGain: 0.3,
        noiseFromHz: 900,
        noiseToHz: 70,
      },
      /** Two-note chime at the top of a turn. */
      turnStart: { gain: 0.26, notes: [587.33, 880], stepS: 0.1, durS: 0.22 },
      /** Beeps at the 5 s warning (DESIGN §2.9). */
      timerWarning: { gain: 0.24, hz: 950, beeps: 2, stepS: 0.16, durS: 0.09 },
      itemUsed: { gain: 0.26, fromHz: 520, toHz: 1040, durS: 0.16 },
      teleport: { gain: 0.26, fromHz: 200, toHz: 1600, durS: 0.22, tailGain: 0.6 },
      heal: { gain: 0.22, notes: [523.25, 659.25, 783.99], stepS: 0.07, durS: 0.2 },
      suddenDeath: {
        gain: 0.4,
        hz: 110,
        toHz: 82.41,
        durS: 1.2,
        detuneCents: 16,
        attackS: 0.08,
      },
      /** Lightning, satellite beams, Thor (DESIGN §3, §5). */
      zap: {
        gain: 0.3,
        fromHz: 2000,
        toHz: 180,
        durS: 0.22,
        noiseGain: 0.24,
        noiseFromHz: 3000,
        noiseToHz: 800,
      },
      /**
       * Sky events (DESIGN §5). The tornado whooshes up as it swallows a shell and
       * down as it spits it out; the Force band chimes when a shell picks the flag up;
       * the satellite plays two notes when it gains a level.
       */
      tornadoIn: { gain: 0.24, durS: 0.4, fromHz: 260, toHz: 1400, q: 1.3 },
      tornadoOut: { gain: 0.22, durS: 0.3, fromHz: 1400, toHz: 260, q: 1.3 },
      skyForce: { gain: 0.16, notes: [880, 1318.51], stepS: 0.06, durS: 0.16 },
      skyLevelUp: { gain: 0.26, notes: [659.25, 987.77], stepS: 0.12, durS: 0.26 },
      windChange: { gain: 0.26, durS: 0.7, fromHz: 300, peakHz: 1800, q: 1.6 },
      mineDrop: { gain: 0.22, fromHz: 220, toHz: 110, durS: 0.1 },
      matchEnd: { gain: 0.3, notes: [523.25, 659.25, 783.99, 1046.5], stepS: 0.14, durS: 0.3 },
      uiClick: { gain: 0.14, hz: 720, durS: 0.04, attackS: 0.001 },
      uiDenied: { gain: 0.2, fromHz: 220, toHz: 120, durS: 0.14 },
    },
  },

  /**
   * The music (DESIGN §8.3, `audio/music.ts`): the Farline OST, one track per map plus
   * the lobby, sudden death and the results. Files are `public/music/<track>.mp3`, built
   * from the masters by `pnpm music`.
   */
  music: {
    /**
     * Everything the music plays goes through this gain, under the sound effects'
     * `audio.masterGain`: the music is the room the game happens in, not a voice in it.
     */
    busGain: 0.2,
    /** A new track fades in over this; the old one fades out over the shorter time. */
    fadeInS: 1.2,
    fadeOutS: 0.6,
    /**
     * Per track: the gain that evens its loudness out (`pnpm music` prints it, from the
     * RMS against -18 dBFS; tune by ear from there). Over 1 is fine: `busGain` keeps the
     * product far below clipping.
     */
    tracks: {
      farline1: { gain: 0.47 },
      farline3: { gain: 0.78 },
      farline4: { gain: 1.7 },
      farline5: { gain: 0.75 },
      farline6: { gain: 0.76 },
      farline7: { gain: 1.08 },
      farline8: { gain: 0.51 },
      farline9: { gain: 0.5 },
      farline11: { gain: 0.65 },
      farline12: { gain: 0.52 },
      farline13: { gain: 0.6 },
    },
    /** The track each map plays. A map missing here plays nothing (the test says so). */
    maps: {
      hills: 'farline4',
      pit: 'farline13',
      islands: 'farline8',
      cave: 'farline1',
      glacier: 'farline12',
      forge: 'farline5',
      temple: 'farline7',
      scrapyard: 'farline3',
    } as Record<string, MusicTrack>,
    /** The lobby and the room, the match once sudden death starts, and the end panel. */
    lobby: 'farline6',
    suddenDeath: 'farline9',
    results: 'farline11',
  } satisfies MusicConstants,
};

export type ClientConstants = typeof clientConstants;

/**
 * Which set of HUD geometry a view wears (DESIGN §7 item 143).
 *
 * Two questions, and both have to answer yes. **Is this a touch screen** — because the
 * compact geometry exists to be pressed with a thumb, and it buys a mouse nothing: it
 * drops the MOVE / POWER / ITEMS captions, the move count and the 1-6 item digits, all
 * of which a player with a keyboard is using. And 16:9 is the commonest desktop aspect
 * of all, which on the height rule alone lands on a 800x450 buffer and would have taken
 * the full HUD away from almost every desktop. **Is the view short** — at or under
 * `view.compactMaxHeightPx`, which is now the whole range (item 165): the full
 * geometry's toggles and walk keys are under 44 CSS px even on a tablet.
 */
export type HudVariant = 'full' | 'compact';

export function hudVariantFor(viewHeight: number, touchScreen: boolean): HudVariant {
  if (!touchScreen) return 'full';
  return viewHeight <= clientConstants.view.compactMaxHeightPx ? 'compact' : 'full';
}

/** How many seats the upcoming-order panel lists in this variant. */
export function orderCount(variant: HudVariant = 'full'): number {
  return variant === 'compact'
    ? clientConstants.hud.compact.order.count
    : clientConstants.hud.order.count;
}

/**
 * Top of the row of widgets that sits under the upcoming-order panel — the three
 * toggles and the sky plate beside them.
 *
 * Derived rather than pinned: the panel is `orderCount` rows plus a header, so a
 * fifth row in the list used to grow straight through the toggles.
 */
export function belowOrderPanelY(variant: HudVariant = 'full'): number {
  const order = clientConstants.hud.order;
  const toggles =
    variant === 'compact' ? clientConstants.hud.compact.toggles : clientConstants.hud.toggles;
  return (
    order.y + order.headerHeightPx + orderCount(variant) * order.rowHeightPx + toggles.gapAbovePx
  );
}

/**
 * Short labels for the narrow item cells. The HUD's slots are 31 px wide and the room's
 * slot bar is barely wider, so a long name is cut mid-word — and "TELEPO" reads as a
 * bug, while "TELE" reads as an abbreviation. Keyed by the item's own `displayName`,
 * case-insensitively; anything unlisted already fits and keeps its name.
 */
const itemShortNames: Record<string, string> = {
  teleport: 'Tele',
  bandage: 'Band',
  'med kit': 'Med',
  'power up': 'Pwr',
  'wind change': 'Wind',
};

/** The short label for `displayName`, or the name itself when it needs no shortening. */
export function shortItemName(displayName: string): string {
  return itemShortNames[displayName.toLowerCase()] ?? displayName;
}
