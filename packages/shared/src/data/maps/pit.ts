/**
 * Sunset Chasm (`pit`): a painted map (DESIGN §8.1), a desert canyon at sunset.
 *
 * The ground is a fixed mask: `tools/blender/maps/pit.py` models it and `pnpm maps pit`
 * renders the picture (`packages/client/public/maps/pit/`) and, from its alpha, the
 * mask and plate placements in `./masks/pit.ts`. Two layered red sandstone mesas face
 * each other across a chasm that goes all the way down; a rope-and-plank bridge hangs
 * across it, a cliff dwelling sits in the right mesa's chasm wall, a balanced-rock
 * hoodoo stands on the left mesa and a saguaro on the right.
 *
 * The tactical idea: both teams start on high ground with only air between them, so a
 * duel is a straight exchange across the gap, and short shots eat the rim you stand
 * on. The bridge is walkable and tempting (a better angle from out over the gap), but
 * it is a few planks thick: one shot drops it and whoever is on it. It is far too thin
 * to spawn on (`spawnGen.minThicknessPx`).
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { pitMask, pitPlates, pitSky } from './masks/pit.js';

/**
 * Back to front. A huge sun setting behind the distant buttes, heat haze drifting in
 * front of them, vultures circling over the nearer mesas, the canyon's far side, the
 * inside of the chasm (only ever seen through it), and dust blowing across the rims.
 */
const pitBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: pitSky,
    params: { stops: 6 },
  },
  {
    kind: 'celestial',
    parallax: 0.03,
    colors: ['#fff1c4', '#ffb35c', '#ee7446'],
    params: { radiusPx: 62, glowPx: 34, centreFraction: 0.34, bandTop: 118, bands: 4 },
  },
  pitPlates.far,
  {
    kind: 'clouds',
    parallax: 0.16,
    colors: ['#f4a878', '#dc8470', '#b8627a'],
    params: { count: 7, minWidth: 160, maxWidth: 340, aspect: 0.06, bandTop: 170, bandHeight: 150, drift: 0.05 },
  },
  pitPlates.mid,
  {
    kind: 'birds',
    parallax: 0.4,
    colors: ['#2a1424'],
    params: { flocks: 3, minBirds: 1, maxBirds: 3, bandTop: 70, bandHeight: 170, drift: 0.22, frameTicks: 14 },
  },
  pitPlates.near,
  pitPlates.gorge,
  {
    kind: 'dust',
    parallax: 0.82,
    colors: ['#f2bc86', '#d08a62'],
    params: { count: 40, bandTop: 250, bandHeight: 320, minWidth: 14, maxWidth: 56, drift: 0.6 },
  },
];

export const pitMap: MapDef = {
  id: 'pit',
  displayName: 'Sunset Chasm',
  width: 1900,
  height: 1050,
  source: { kind: 'mask', rle: pitMask },
  background: pitBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also
  // rims every crater on the painted ground.
  palette: {
    outline: '#f3cd8b',
    crust: '#c9854a',
    crustDark: '#ab6a3b',
    soil: '#8c4f2f',
    soilDark: '#703d26',
    deep: '#4b2a1d',
    deepDark: '#3a2017',
    detail: { kind: 'studs', colors: ['#f6d79c', '#c08b56', '#75452c'], density: 0.42 },
    scorch: { rim: '#e08a3a', core: '#2b1b14' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
