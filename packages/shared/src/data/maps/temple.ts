/**
 * Jungle Temple (`temple`): a painted map (DESIGN §8.1).
 *
 * A stepped ziggurat overgrown by the jungle, modelled in `tools/blender/maps/temple.py`
 * and rendered by `pnpm maps temple`, which writes the picture
 * (`packages/client/public/maps/temple/`) and, from its alpha, the mask and the plate
 * placements in `./masks/temple.ts`. What you see is what you hit: the tiers, the
 * sanctuary and its roof comb, the idol heads, the rubble and the three trees are all
 * terrain and all destructible.
 *
 * The tactical idea, in the map module's own words: height against cover. The third
 * tier either side of the sanctuary sees the whole map but stands in the open; the
 * lower steps and the jungle floor sit behind the tier walls, which stop flat shots;
 * and the gallery through the sanctuary is the one covered place on the map, and a
 * sightline from one upper terrace to the other.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { templeMask, templePlates, templeSky } from './masks/temple.js';

/**
 * Back to front. The plates are the scenery (misty ridges and a far pyramid, cliffs
 * with waterfalls, the canopy, the undergrowth); the code-drawn layers between them
 * are what moves: a hazy sun, low clouds drifting past the falls, a flock of dark
 * birds over the canopy, a pair of red parrots nearer in, and glowing motes over the
 * undergrowth.
 */
const templeBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: templeSky,
    params: { stops: 4 },
  },
  {
    kind: 'celestial',
    parallax: 0.03,
    colors: ['#fffbe0', '#fff0a8', '#f4e08a'],
    params: { radiusPx: 22, glowPx: 26, centreFraction: 0.3, bandTop: 40, rays: 1 },
  },
  templePlates.far,
  {
    kind: 'clouds',
    parallax: 0.16,
    colors: ['#f2f8ec', '#d9ebe0', '#b6d4c8'],
    params: { count: 7, minWidth: 80, maxWidth: 200, bandTop: 60, bandHeight: 150, drift: 0.05 },
  },
  templePlates.falls,
  {
    kind: 'birds',
    parallax: 0.3,
    colors: ['#24433c'],
    params: { flocks: 4, minBirds: 3, maxBirds: 6, bandTop: 90, bandHeight: 160, drift: 0.3, frameTicks: 9 },
  },
  templePlates.canopy,
  {
    kind: 'birds',
    parallax: 0.5,
    colors: ['#d8412f'],
    params: { flocks: 2, minBirds: 1, maxBirds: 2, bandTop: 150, bandHeight: 140, drift: 0.55, frameTicks: 6 },
  },
  templePlates.near,
  {
    kind: 'fireflies',
    parallax: 0.7,
    colors: ['#f6ff9a', '#a8f07a', '#ffd166'],
    params: { count: 34, bandTop: 260, bandHeight: 300, drift: 0.07, frameTicks: 12 },
  },
];

export const templeMap: MapDef = {
  id: 'temple',
  displayName: 'Jungle Temple',
  width: 1900,
  height: 1050,
  source: { kind: 'mask', rle: templeMask },
  background: templeBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also
  // rims every crater on the painted ground.
  palette: {
    outline: '#a6d24e',
    crust: '#7c8a6a',
    crustDark: '#646f55',
    soil: '#914e32',
    soilDark: '#6c3624',
    deep: '#433e47',
    deepDark: '#2c2a30',
    detail: { kind: 'tufts', colors: ['#bfe56a', '#7dbd3e', '#4a8a2c'], density: 0.4 },
    scorch: { rim: '#c46a32', core: '#241a14' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
