/**
 * Crystal Hollow (`cave`): a painted cavern (DESIGN §8.1), remade from the procedural cave.
 *
 * The ground is a fixed mask: `tools/blender/maps/cave.py` models the cavern, `pnpm maps
 * cave` renders it and writes the picture (`packages/client/public/maps/cave/`) and, from
 * its alpha, the mask and the plate placements in `./masks/cave.ts`. A rock roof hangs
 * from the top of the map over an open floor; the underside sits at 370 to 400 px, inside
 * the band the camera shows (it stops at `height − viewHeight`), with stalactites,
 * hanging crystal clusters, lanterns and sleeping bats. On the floor: a mine track, an ore
 * cart, stalagmites and a big crystal outcrop in the middle. All of it is terrain.
 *
 * The tactical idea: the roof takes the lob away. A shot that climbs more than about
 * 250 px bursts in the ceiling, so duels are fought in flat, direct shots through the
 * windows between the fangs hanging from the roof and the stalagmites and crystals on the
 * floor, and every one of those can be shot away.
 *
 * `palette.ceiling` stays: the client's band painter (the fallback when terrain.png fails
 * to load) paints any run that starts at the top of the map, the roof, with those tones.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { caveMask, cavePlates, caveSky } from './masks/cave.js';

/**
 * Back to front: the void, the far columns, glints in the dark, the hall, fireflies, the
 * lake, spores drifting in front of it, and the mine timbers just behind the playfield.
 */
const caveBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: caveSky,
    params: { stops: 4 },
  },
  cavePlates.depths,
  {
    kind: 'crystals',
    parallax: 0.18,
    colors: ['#3c7fa4', '#28577a', '#8fd0e4'],
    params: { count: 9, minSize: 5, maxSize: 10, bandTop: 150, bandHeight: 260, glow: 3 },
  },
  cavePlates.hall,
  {
    kind: 'fireflies',
    parallax: 0.36,
    colors: ['#b9ffa8', '#6fe36a', '#ffe9a0'],
    params: { count: 34, bandTop: 170, bandHeight: 300, drift: 0.05, frameTicks: 11 },
  },
  cavePlates.pool,
  {
    kind: 'fireflies',
    parallax: 0.55,
    colors: ['#d6fbff', '#5fd8f2', '#e2b8ff'],
    params: { count: 22, bandTop: 160, bandHeight: 320, drift: 0.12, frameTicks: 14 },
  },
  cavePlates.mine,
  {
    kind: 'dust',
    parallax: 0.8,
    colors: ['#8a84b8', '#5f5a8a'],
    params: { count: 16, minWidth: 3, maxWidth: 8, bandTop: 200, bandHeight: 360, drift: 0.04 },
  },
];

export const caveMap: MapDef = {
  id: 'cave',
  displayName: 'Crystal Hollow',
  width: 1800,
  height: 900,
  source: { kind: 'mask', rle: caveMask },
  background: caveBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also rims
  // every crater on the painted rock.
  palette: {
    outline: '#9a94c4',
    crust: '#635d80',
    crustDark: '#4f4a6a',
    soil: '#403b58',
    soilDark: '#332f49',
    deep: '#26223a',
    deepDark: '#1d1a2d',
    ceiling: {
      outline: '#8c86b4',
      crust: '#5a5479',
      crustDark: '#494263',
      soil: '#3b3554',
      soilDark: '#2e2945',
      deep: '#211d36',
      deepDark: '#181529',
    },
    detail: { kind: 'glints', colors: ['#d6fbff', '#5fd8f2', '#2a8fb8'], density: 0.3 },
    scorch: { rim: '#b06adf', core: '#191530' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
