/**
 * The map pool (DESIGN §8, §8.1): the types every map is written against, one file per
 * map, and the lookups the rest of the game uses.
 *
 * One file per map is the point, as it is for the mobiles: the map pass is several
 * agents working in the same tree, each of them owning `maps/<id>.ts` (plus the
 * generated `maps/masks/<id>.ts` that `pnpm maps` writes for it) and adding one import
 * and one line to `registered` below. `mapOrder` is the order the lobby and the room
 * list the pool in; it names all eight maps of the pass up front, so a map joins the
 * pool the moment its file is registered and nobody has to agree on where it goes.
 *
 * `../maps.ts` re-exports everything here, so every import path written before the
 * split still resolves. Map files import their types from `./types.js` with
 * `import type`, which `verbatimModuleSyntax` erases, so there is no runtime cycle.
 */
import type { MapDef, MapId } from './types.js';
import { hillsMap } from './hills.js';
import { pitMap } from './pit.js';
import { islandsMap } from './islands.js';
import { caveMap } from './cave.js';
import { glacierMap } from './glacier.js';
import { forgeMap } from './forge.js';
import { templeMap } from './temple.js';
import { scrapyardMap } from './scrapyard.js';

export type {
  DrawnLayer,
  DrawnLayerKind,
  MapArt,
  MapDef,
  MapId,
  MapSource,
  ParallaxLayer,
  PlateLayer,
  TerrainDetail,
  TerrainDetailKind,
  TerrainPalette,
  TerrainScorch,
  TerrainStyle,
  TerrainTones,
} from './types.js';
export { terrainGen, spawnGen } from './generation.js';
export { hillsMap, pitMap, islandsMap, caveMap };

/** Where each map of the pass sits in the pickers. Ids not registered yet are skipped. */
export const mapOrder: readonly MapId[] = [
  'hills',
  'pit',
  'islands',
  'cave',
  'glacier',
  'forge',
  'temple',
  'scrapyard',
];

/** Every map that exists. One line per map; the order here does not matter. */
const registered: MapDef[] = [
  hillsMap,
  pitMap,
  islandsMap,
  caveMap,
  glacierMap,
  forgeMap,
  templeMap,
  scrapyardMap,
];

function inPickerOrder(defs: MapDef[]): MapDef[] {
  const rank = (m: MapDef): number => {
    const i = mapOrder.indexOf(m.id);
    return i < 0 ? mapOrder.length : i;
  };
  return defs.slice().sort((a, b) => rank(a) - rank(b));
}

/** The pool, in `mapOrder`. */
export const maps: MapDef[] = inPickerOrder(registered);

export function getMapDef(id: MapId): MapDef {
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    if (m && m.id === id) return m;
  }
  throw new Error(`unknown map id: ${id}`);
}
