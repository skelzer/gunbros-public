/**
 * A private copy of a match (DESIGN §11, §7 item 187).
 *
 * The practice bot aims by firing candidate shots at a *copy* of the live state with
 * the real `applyIntent` and `step`. The copy has to be total: the live state is the
 * authority every client is simulating in lockstep, so a copy that shared one mutable
 * object with it — the terrain mask a candidate carves, the PRNG a behaviour draws
 * from, a mobile a candidate damages — would change the match from inside a plan, and
 * every engine would desync at the next `turnEnd`.
 *
 * What *is* shared, on purpose, is data that nothing ever writes: the map definition
 * (`state.map`) and every projectile definition (`def`), which behaviours replace
 * rather than edit (`crawl` builds a new def). Everything else is walked and copied:
 * the plain records and arrays by a structural copy that follows whatever fields they
 * grow later, and the two class instances (`Terrain`, `Prng`) through their own
 * copies. `skyEventId` is an accessor over `sky` whose setter closes over the spawn
 * columns; it is carried across as the same accessor, which reads and writes the
 * copy's own `sky` through `this`.
 */
import { Prng } from '../math/prng.js';
import { Terrain } from '../terrain/terrain.js';
import type { MatchState } from './match.js';

/** Keys whose values are immutable definitions, shared between a state and its copy. */
const SHARED_KEYS = new Set(['map', 'def']);

function copyValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (SHARED_KEYS.has(key)) return value;
  if (value instanceof Terrain) return value.clone();
  if (value instanceof Prng) return value.clone();
  if (ArrayBuffer.isView(value)) return (value as Uint8Array).slice();
  if (Array.isArray(value)) {
    const out: unknown[] = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = copyValue(value[i], key);
    return out;
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(source)) out[k] = copyValue(source[k], k);
  return out;
}

/**
 * Deep-copy a match. The copy steps, carves, draws and damages on its own and the
 * source is never touched; `hashState` of the source is the same before and after
 * anything is done to the copy (the planner's test checks exactly that).
 *
 * `terrain`, when given, is a scratch terrain of the same size whose mask is
 * overwritten with the source's instead of allocating a fresh one: a map is ~2 MB and a
 * plan copies the state a few hundred times.
 */
export function cloneMatchState(state: MatchState, terrain?: Terrain): MatchState {
  const out = {} as Record<string, unknown>;
  const source = state as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set) {
      // `skyEventId`: the same accessor, bound to the copy by `this`.
      Object.defineProperty(out, key, { ...descriptor });
      continue;
    }
    if (key === 'terrain' && terrain && terrain.width === state.terrain.width && terrain.height === state.terrain.height) {
      terrain.replaceMask(state.terrain.mask);
      out[key] = terrain;
      continue;
    }
    if (key === 'events') {
      // The events of the source's last `step()` belong to the source.
      out[key] = [];
      continue;
    }
    out[key] = copyValue(descriptor.value, key);
  }
  return out as unknown as MatchState;
}
