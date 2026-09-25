/**
 * Frozen Peaks (`glacier`): an arctic glacier under an aurora, a painted map (DESIGN
 * §8.1).
 *
 * `tools/blender/maps/glacier.py` models it and `pnpm maps glacier` renders the picture
 * (`packages/client/public/maps/glacier/`) and, from its alpha, the mask and plate
 * placements in `./masks/glacier.ts`. The two high shelves where a duel starts each run
 * on as an overhang over the valley, which can be shot away from under whoever walks
 * out onto it; the ice spire in the middle blocks every flat shot, and a thin ice
 * bridge from its shoulder is the one way along the top. The igloo, the snowman, the
 * cabin, the pines, the spire and the bridge are all terrain and all destructible.
 *
 * The aurora is code-drawn, so it moves: two bands of faint streaks (`dust` in green and
 * violet) drifting slowly over the stars, with a scatter of blinking sparks
 * (`fireflies`) in them. The snow is `dust` again, in white, in two depths.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { glacierMask, glacierPlates, glacierSky } from './masks/glacier.js';

/**
 * Back to front: the night sky and its stars, the aurora (two drifting curtains and
 * their sparks), a small moon, the far peaks, the frozen sea with its icebergs, far
 * snow, the snowy hills and their forest, the drifts and big pines, and near snow in
 * front of them all.
 */
const glacierBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: glacierSky,
    params: { stops: 4 },
  },
  {
    kind: 'stars',
    parallax: 0.02,
    colors: ['#e6f2ff'],
    params: { density: 1.6, bandTop: 0, bandHeight: 320 },
  },
  {
    kind: 'dust',
    parallax: 0.03,
    colors: ['#b58cff', '#7fa0ff'],
    params: { count: 70, minWidth: 50, maxWidth: 190, bandTop: 30, bandHeight: 90, drift: 0.015 },
  },
  {
    kind: 'dust',
    parallax: 0.04,
    colors: ['#72ffb4', '#3fe0c8'],
    params: { count: 140, minWidth: 70, maxWidth: 260, bandTop: 70, bandHeight: 150, drift: 0.025 },
  },
  {
    kind: 'fireflies',
    parallax: 0.05,
    colors: ['#d4ffe8', '#6dffc0', '#c8a8ff'],
    params: { count: 46, bandTop: 50, bandHeight: 190, frameTicks: 14 },
  },
  {
    kind: 'celestial',
    parallax: 0.06,
    colors: ['#f2f6ff', '#cfdaf0', '#a8b6d4'],
    params: { radiusPx: 16, glowPx: 12, centreFraction: 0.18, bandTop: 44, craters: 3 },
  },
  glacierPlates.peaks,
  glacierPlates.sea,
  {
    kind: 'dust',
    parallax: 0.36,
    colors: ['#dfe9ff', '#b4c6e6'],
    params: { count: 120, minWidth: 1, maxWidth: 1, bandTop: 0, bandHeight: 900, drift: 0.16 },
  },
  glacierPlates.hills,
  glacierPlates.near,
  {
    kind: 'dust',
    parallax: 0.8,
    colors: ['#ffffff', '#dce8ff'],
    params: { count: 110, minWidth: 1, maxWidth: 2, bandTop: 0, bandHeight: 1100, drift: 0.34 },
  },
];

export const glacierMap: MapDef = {
  id: 'glacier',
  displayName: 'Frozen Peaks',
  width: 1800,
  height: 1100,
  source: { kind: 'mask', rle: glacierMask },
  background: glacierBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also
  // rims every crater on the painted ground.
  palette: {
    outline: '#ffffff',
    crust: '#e6effa',
    crustDark: '#c2d3ea',
    soil: '#5a9fcc',
    soilDark: '#3a78aa',
    deep: '#2e6496',
    deepDark: '#1f4878',
    detail: { kind: 'glints', colors: ['#ffffff', '#c6eefc', '#8ccbea'], density: 0.3 },
    scorch: { rim: '#8fe0ff', core: '#1a2a44' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
