/**
 * Rust Yard (`scrapyard`): a painted junkyard (DESIGN §8.1).
 *
 * The ground is a fixed mask: `tools/blender/maps/scrapyard.py` models the yard, `pnpm
 * maps scrapyard` renders it and writes the picture (`packages/client/public/maps/
 * scrapyard/`) and, from its alpha, the mask and the plate placements in
 * `./masks/scrapyard.ts`. Two banks of packed rusty earth over slag, full of buried junk,
 * with a chasm between them that drops off the bottom of the map. Wedged into the chasm
 * lies the hull of a crashed airship; a wrecked tank, a water tower, a crane with a car
 * on its magnet, crates, barrels and tyres stand between the shelves. All of it is
 * terrain.
 *
 * The tactical idea: the airship is a wall in the middle that is really paper. Its skin
 * is 6 px of brass round air, so the first shell bursts on it and the next one flies
 * through the hole; lob over it or open a window through it. Anyone who drives into the
 * chasm falls off the map. The girder towers are lattices: most shells burst on them,
 * some slip between the members. Nobody spawns inside the hull (its bottom skin is
 * thinner than `spawnGen.minThicknessPx`); a full room of 8 may put a seat on its back.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { scrapyardMask, scrapyardPlates, scrapyardSky } from './masks/scrapyard.js';

/**
 * Back to front: the smog, a hazy sun, the skyline, smoke drifting off the chimneys, the
 * factory halls, the cranes, crows, the heaps behind the yard, and sparks and grit blown
 * across the front.
 */
const scrapyardBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: scrapyardSky,
    params: { stops: 4 },
  },
  {
    kind: 'celestial',
    parallax: 0.04,
    colors: ['#fff0c0', '#ffd27a', '#f0a050'],
    params: { radiusPx: 30, glowPx: 26, centreFraction: 0.3, bandTop: 120, rays: 0 },
  },
  scrapyardPlates.skyline,
  {
    kind: 'clouds',
    parallax: 0.18,
    colors: ['#9a6a5e', '#86584e', '#6e4640'],
    params: { count: 7, minWidth: 90, maxWidth: 220, bandTop: 40, bandHeight: 190, drift: 0.05 },
  },
  scrapyardPlates.chimneys,
  {
    kind: 'clouds',
    parallax: 0.3,
    colors: ['#7a5a56', '#624642', '#4e3634'],
    params: { count: 6, minWidth: 50, maxWidth: 130, bandTop: 120, bandHeight: 140, drift: 0.12 },
  },
  scrapyardPlates.cranes,
  {
    kind: 'birds',
    parallax: 0.5,
    colors: ['#2a1c1c'],
    params: { flocks: 3, minBirds: 2, maxBirds: 4, bandTop: 110, bandHeight: 170, drift: 0.28, frameTicks: 10 },
  },
  scrapyardPlates.heaps,
  {
    kind: 'fireflies',
    parallax: 0.7,
    colors: ['#ffd27a', '#ff8a3a', '#fff0c0'],
    params: { count: 14, bandTop: 260, bandHeight: 240, drift: 0.2, frameTicks: 6 },
  },
  {
    kind: 'dust',
    parallax: 0.85,
    colors: ['#c89a78', '#8a6a58'],
    params: { count: 26, minWidth: 8, maxWidth: 30, bandTop: 180, bandHeight: 360, drift: 0.5 },
  },
];

export const scrapyardMap: MapDef = {
  id: 'scrapyard',
  displayName: 'Rust Yard',
  width: 1900,
  height: 1050,
  source: { kind: 'mask', rle: scrapyardMask },
  background: scrapyardBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also rims
  // every crater on the painted ground.
  palette: {
    outline: '#d08a52',
    crust: '#9a4a22',
    crustDark: '#7a3a1c',
    soil: '#5e4034',
    soilDark: '#4a322a',
    deep: '#3b363c',
    deepDark: '#28242a',
    detail: { kind: 'glints', colors: ['#a6b8cc', '#71839a', '#eba062'], density: 0.3 },
    scorch: { rim: '#e07a2c', core: '#1c1412' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
