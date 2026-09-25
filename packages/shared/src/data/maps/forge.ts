/**
 * Magma Forge (`forge`): a painted map (DESIGN §8.1), a volcanic island on a lava sea.
 *
 * The ground is a fixed mask: `tools/blender/maps/forge.py` models it and `pnpm maps
 * forge` renders the picture (`packages/client/public/maps/forge/`) and, from its alpha,
 * the mask and plate placements in `./masks/forge.ts`. A slab of basalt stands on three
 * pillars in a lava sea, with a volcano in the middle of it, an iron forge and its
 * chimney on the left, and a causeway of basalt columns stepping down on the right. The
 * lava in the rock (seams, the conduit, the magma chamber, the crater) is paint only:
 * it is rock like any other and carries no rule.
 *
 * The tactical idea: the volcano is a 250 px wall between the two halves, too steep to
 * climb, so a duel is played in lobs over the peak, or by digging through it. Falling
 * off either cliff, or through the floor of a tunnel dug too deep, is a fall into the
 * lava sea.
 */
import type { MapDef, ParallaxLayer } from './types.js';
import { forgeMask, forgePlates, forgeSky } from './masks/forge.js';

/**
 * Back to front. A dim sun through the smoke, the erupting volcano far off, smoke
 * drifting in front of it, the fortresses, ash falling past the black crags, the lava
 * sea under the island, and embers rising off it in front of everything but the ground.
 */
const forgeBackground: ParallaxLayer[] = [
  {
    kind: 'gradient',
    parallax: 0,
    colors: forgeSky,
    params: { stops: 6 },
  },
  {
    kind: 'celestial',
    parallax: 0.03,
    colors: ['#ffb070', '#e2603a', '#8e2a1e'],
    params: { radiusPx: 22, glowPx: 20, centreFraction: 0.12, bandTop: 70, bands: 2 },
  },
  forgePlates.far,
  {
    kind: 'clouds',
    parallax: 0.2,
    colors: ['#4a2024', '#3a181c', '#2a1216'],
    params: { count: 8, minWidth: 120, maxWidth: 280, aspect: 0.16, bandTop: 30, bandHeight: 200, drift: 0.09 },
  },
  forgePlates.mid,
  {
    kind: 'dust',
    parallax: 0.42,
    colors: ['#8a7472', '#5c4a4c'],
    params: { count: 34, bandTop: 60, bandHeight: 420, minWidth: 3, maxWidth: 8, drift: 0.18 },
  },
  forgePlates.near,
  forgePlates.lava,
  {
    kind: 'fireflies',
    parallax: 0.9,
    colors: ['#ffe07a', '#ff9a2a', '#ff5a1e'],
    params: { count: 46, bandTop: 120, bandHeight: 460, drift: 0.12, frameTicks: 8 },
  },
];

export const forgeMap: MapDef = {
  id: 'forge',
  displayName: 'Magma Forge',
  width: 1800,
  height: 1050,
  source: { kind: 'mask', rle: forgeMask },
  background: forgeBackground,
  // The band painter's tones, used only if terrain.png fails to load; `scorch` also
  // rims every crater on the painted ground.
  palette: {
    outline: '#9e928c',
    crust: '#6e6260',
    crustDark: '#564c4c',
    soil: '#3c3858',
    soilDark: '#2a2740',
    deep: '#1f1c2e',
    deepDark: '#16131f',
    detail: { kind: 'glints', colors: ['#ffe07a', '#ff9a2a', '#e0481a'], density: 0.3 },
    scorch: { rim: '#ff7a24', core: '#1a0c0c' },
  },
  art: { terrain: 'terrain.png', thumb: 'thumb.png' },
};
