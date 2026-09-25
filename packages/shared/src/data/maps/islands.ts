/**
 * Cloudbreak Isles (`islands`): floating isles in a bright sky with lethal gaps between
 * them, a painted map (DESIGN §8.1).
 *
 * `tools/blender/maps/islands.py` models it and `pnpm maps islands` renders the picture
 * (`packages/client/public/maps/islands/`) and, from its alpha, the mask and plate
 * placements in `./masks/islands.ts`. Two home isles face each other across three
 * stones at staggered heights; the central crag, with a ruined shrine arch on its
 * crown, blocks every flat shot across the middle, and every rim is a drop into the
 * cloud sea. The keels, the shrine, the stone head and the trees are all terrain and
 * all destructible.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { islandsMask, islandsPlates, islandsSky } from './masks/islands.js';

/**
 * Back to front: the sky, the day moon, high clouds, the distant isles, birds, the
 * cloud sea, low clouds sailing over it, the nearer isles, and a last bank of cloud
 * drifting across between them and the playfield.
 */
const islandsBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: islandsSky,
    params: { stops: 4 },
  },
  islandsPlates.moon,
  {
    kind: 'clouds',
    parallax: 0.1,
    colors: ['#f4f9ff', '#dbe9f7', '#b9d2ec'],
    params: { count: 7, minWidth: 90, maxWidth: 220, bandTop: 30, bandHeight: 190, drift: 0.05 },
  },
  islandsPlates.far,
  {
    kind: 'birds',
    parallax: 0.24,
    colors: ['#35507a'],
    params: { flocks: 4, minBirds: 3, maxBirds: 6, bandTop: 110, bandHeight: 190, drift: 0.3, frameTicks: 9 },
  },
  islandsPlates.sea,
  {
    kind: 'clouds',
    parallax: 0.36,
    colors: ['#ffffff', '#e6f0fa', '#c4d9ee'],
    params: { count: 5, minWidth: 120, maxWidth: 260, bandTop: 330, bandHeight: 150, drift: 0.09 },
  },
  islandsPlates.isles,
  {
    kind: 'clouds',
    parallax: 0.55,
    colors: ['#ffffff', '#eaf3fb', '#cadcef'],
    params: { count: 4, minWidth: 150, maxWidth: 300, bandTop: 440, bandHeight: 180, drift: 0.13 },
  },
];

export const islandsMap: MapDef = {
  id: 'islands',
  displayName: 'Cloudbreak Isles',
  width: 1900,
  height: 1100,
  source: { kind: 'mask', rle: islandsMask },
  background: islandsBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also
  // rims every crater on the painted ground.
  palette: {
    outline: '#b8f08c',
    crust: '#66bf57',
    crustDark: '#4a9846',
    soil: '#7c7e8e',
    soilDark: '#636576',
    deep: '#4b4d5c',
    deepDark: '#3a3c49',
    detail: { kind: 'roots', colors: ['#d2f79f', '#79c95f', '#4a6a4a'], density: 0.46 },
    scorch: { rim: '#d2733c', core: '#28242f' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
