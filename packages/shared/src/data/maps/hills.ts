/**
 * Rolling Hills (`hills`): the reference painted map (DESIGN §8.1).
 *
 * The ground is a fixed mask: `tools/blender/maps/hills.py` models the landscape, `pnpm
 * maps hills` renders it through the toon and pixel pipeline and writes both the picture
 * (`packages/client/public/maps/hills/`) and, from that picture's alpha, the mask and the
 * plate placements in `./masks/hills.ts`. What you see is what you hit: the windmill's
 * sails, the cottage, the trees on the peak and the outcrop in the valley are all
 * terrain and all destructible. The match seed no longer shapes anything here; it picks
 * the spawns (`computeSpawnPoints` searches the fixed ground from seeded slots), the
 * wind and the weather, as on every other map.
 *
 * The tactical idea, in the map module's own words: two high grounds of about the same
 * height with a valley between them, so a 1v1 is played in lobs over the outcrop and
 * the cottage rather than in straight shots.
 *
 * This file is the template the other painted maps copy: a mask source, a background
 * that interleaves the generated plates with the code-drawn layers that move (sky, sun,
 * clouds, birds), the fallback `palette` the band painter uses if the art fails to load,
 * and `art` pointing the client at the pictures.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { hillsMask, hillsPlates, hillsSky } from './masks/hills.js';

/**
 * Back to front. The plates are the scenery; the code-drawn layers between them are
 * what moves. Clouds drift in front of the distant range and behind the near one, the
 * birds fly between the mountains and the farmland, which is what gives the depth.
 */
const hillsBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: hillsSky,
    params: { stops: 4 },
  },
  {
    kind: 'celestial',
    parallax: 0.04,
    colors: ['#fff6c8', '#ffe27a', '#ffd34d'],
    params: { radiusPx: 26, glowPx: 18, centreFraction: 0.72, bandTop: 46, rays: 1 },
  },
  hillsPlates.far,
  {
    kind: 'clouds',
    parallax: 0.18,
    colors: ['#ffffff', '#e7f1fa', '#c4d8ea'],
    params: { count: 8, minWidth: 70, maxWidth: 190, bandTop: 18, bandHeight: 170, drift: 0.07 },
  },
  hillsPlates.range,
  {
    kind: 'birds',
    parallax: 0.34,
    colors: ['#2f4457'],
    params: { flocks: 5, minBirds: 3, maxBirds: 6, bandTop: 70, bandHeight: 150, drift: 0.34, frameTicks: 9 },
  },
  hillsPlates.mid,
  hillsPlates.near,
];

export const hillsMap: MapDef = {
  id: 'hills',
  displayName: 'Rolling Hills',
  width: 1800,
  height: 1000,
  source: { kind: 'mask', rle: hillsMask },
  background: hillsBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also
  // rims every crater on the painted ground.
  palette: {
    outline: '#a6e069',
    crust: '#6fbb4e',
    crustDark: '#55993c',
    soil: '#8a6a3c',
    soilDark: '#705430',
    deep: '#4e3a21',
    deepDark: '#3d2d1a',
    detail: { kind: 'tufts', colors: ['#c2ee7e', '#8ed15c', '#4f8f3a'], density: 0.5 },
    scorch: { rim: '#c86a34', core: '#2c2118' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
