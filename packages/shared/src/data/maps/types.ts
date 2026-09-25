/**
 * The shapes every map is written against (DESIGN §8, §8.1).
 *
 * A map is data: a size, where its ground comes from (`source`), the layers behind it
 * (`background`), the tones the client falls back to when it has no painted art
 * (`palette`) and, for a painted map, where that art lives (`art`). The per-map files in
 * this directory fill these in; nothing here holds a number.
 */

export type MapId = string;
export type TerrainStyle = 'hills' | 'pit' | 'islands' | 'cave';

/** Every code-drawn layer kind the client knows how to bake. */
export type DrawnLayerKind =
  | 'gradient'
  | 'mountains'
  | 'hills'
  | 'mesas'
  | 'clouds'
  | 'skyIslands'
  | 'caveWalls'
  | 'crystals'
  | 'stars'
  | 'celestial'
  | 'trees'
  | 'village'
  | 'birds'
  | 'cacti'
  | 'dust'
  | 'fireflies';

/**
 * A code-drawn background layer; the client turns these into pixels.
 *
 * The first nine kinds are the Phase 6 set; `celestial`, `trees`, `village`, `birds`,
 * `cacti`, `dust` and `fireflies` are the art pass's inhabitants — the small moving
 * details that stop a parallax band from reading as wallpaper. Every one of them is
 * baked once into a tile and blitted, so adding them costs draw calls, not paths.
 *
 * Since the map pass (DESIGN §8.1) the *scenery* of a painted map is `plate` layers and
 * these are kept for what moves or glows: the sky gradient, the sun, drifting clouds,
 * birds, dust, fireflies.
 */
export interface DrawnLayer {
  kind: DrawnLayerKind;
  /** 0 = pinned to the camera, 1 = moves with the world. */
  parallax: number;
  /** CSS colours, back to front. */
  colors: string[];
  /**
   * Layer-specific tunables (heights, densities, sizes) — still data.
   *
   * Two are read for every kind: `drift` is px the tile slides left per rendered frame
   * on its own, independent of the camera (clouds sail, dust blows, birds fly), and
   * `frameTicks` is how many frames each baked animation tile is held for (birds flap,
   * fireflies blink).
   */
  params: Record<string, number>;
}

/**
 * A Blender-rendered backdrop (DESIGN §8.1): one PNG in `public/maps/<mapId>/`, drawn
 * with a single `drawImage` per frame.
 *
 * Placement is plain parallax. With the camera's top-left at (ox, oy) in world px, the
 * image's top-left lands on the screen at
 *
 *     (x − ox · parallax − drift · frame,  y − oy · parallax)
 *
 * The pack step sizes a plate so that it covers the view at every camera position the
 * map allows, for every view height from 360 to 600 px: its canvas is
 * `800 + (width − 800) · parallax` by `600 + (height − 600) · parallax`, then the
 * transparent rows over the scenery are cropped off (that is `y`) and a flat run of
 * rows at the bottom is cropped into `fillBelow`. So no plate ever tiles, and past its
 * top edge the layers behind it (ultimately the sky) show through.
 *
 * Every number here is written by `pnpm maps` into the map's generated
 * `masks/<id>.ts`; a map file only chooses the order its plates stack in.
 */
export interface PlateLayer {
  kind: 'plate';
  /** File name under `public/maps/<mapId>/`. */
  src: string;
  /** 0 = pinned to the camera, 1 = moves with the world. */
  parallax: number;
  /** Size of the image, px. Known before it loads so the fallback can skip it cleanly. */
  width: number;
  height: number;
  /** View px of the image's top-left with the camera at the map's top-left corner. */
  x: number;
  y: number;
  /** Flat colour past the image's top / bottom edge, or absent for "leave it clear". */
  fillAbove?: string;
  fillBelow?: string;
  /** Px per rendered frame the plate slides left on its own; a drifting plate wraps. */
  drift?: number;
}

export type ParallaxLayer = DrawnLayer | PlateLayer;

/**
 * One set of terrain tones, darkest last. The client draws the top pixel of an exposed
 * run in `outline` (the lit surface highlight) and then dithers crust → crustDark,
 * soil → soilDark and deep → deepDark with an ordered 4×4 matrix, which is what gives
 * the ground its texture instead of three flat stripes.
 */
export interface TerrainTones {
  outline: string;
  crust: string;
  crustDark: string;
  soil: string;
  soilDark: string;
  deep: string;
  deepDark: string;
}

/**
 * Colours the client uses to draw the terrain mask. The four dark tones are optional so
 * that a palette written before the texture pass still renders (the client derives the
 * missing tone by darkening its base). `ceiling` is the rock a hanging slab is drawn
 * with — only `cave` has one — and it is banded from the *underside* up.
 *
 * On a painted map (`art` set) this is the fallback the client paints the mask with when
 * `terrain.png` fails to load, and `scorch` is still what rims a fresh crater, so it
 * stays required on every map.
 */
export interface TerrainPalette {
  /** Top 1 px of a solid run: the lit surface highlight. */
  outline: string;
  /** Band below the highlight. */
  crust: string;
  crustDark?: string;
  /** Band below the crust. */
  soil: string;
  soilDark?: string;
  /** Everything deeper. */
  deep: string;
  deepDark?: string;
  /** Tones for a slab hanging from the top of the map (cave ceiling). */
  ceiling?: TerrainTones;
  /** Things growing on the surface of this map's ground. */
  detail?: TerrainDetail;
  /** Tones a freshly blasted edge is rimmed with. */
  scorch?: TerrainScorch;
}

/**
 * What a map's ground wears on its exposed edges: grass tufts on the hills, rock studs
 * in the chasm, grass plus hanging roots under the isles, crystal glints in the cave.
 * The client plants them deterministically from the surface shape, so they survive a
 * reload and a carve repaints only its own hole. Only the band painter plants them: a
 * painted map has its tufts in the picture (and in the mask).
 */
export interface TerrainDetail {
  kind: TerrainDetailKind;
  /** Light, mid and dark tone of the decoration, in that order. */
  colors: string[];
  /** Chance in 0…1 that a surface column carries a decoration. */
  density: number;
}

export type TerrainDetailKind = 'tufts' | 'studs' | 'roots' | 'glints';

/** The burnt lip a carve leaves behind: a bright ember rim over charred rock. */
export interface TerrainScorch {
  rim: string;
  core: string;
}

/**
 * Where the ground comes from. `procedural` runs a generator off the match seed;
 * `mask` is a fixed run-length encoded mask (`terrain/codec.ts`), which for a painted
 * map is generated from the rendered picture by `pnpm maps` (DESIGN §8.1). The seed of
 * a mask map still picks the spawns, the wind and everything else.
 */
export type MapSource =
  | { kind: 'procedural'; style: TerrainStyle; seed: number }
  | { kind: 'mask'; rle: string };

/**
 * The painted art of a map, as file names under the client's `public/maps/<id>/`
 * (DESIGN §8.1). Only the client reads it; the simulation never depends on a picture.
 */
export interface MapArt {
  /** One image pixel per map pixel; alpha 255 exactly where the mask is solid. */
  terrain: string;
  /** 160 × 90 picture of the whole map for the room's map picker. */
  thumb: string;
}

export interface MapDef {
  id: MapId;
  displayName: string;
  width: number;
  height: number;
  source: MapSource;
  background: ParallaxLayer[];
  palette: TerrainPalette;
  /** Absent: the client paints the mask with `palette` (the procedural maps). */
  art?: MapArt;
}
