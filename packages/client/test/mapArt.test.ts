/**
 * The painted maps' art (DESIGN §8.1, tools/blender/maps/): what the client draws has to
 * be exactly what the simulation collides with.
 *
 * For every map in the pool that has art, read straight from `public/maps/<id>/`:
 * `terrain.png` is map sized and its alpha is 255 exactly where the shared mask (the
 * generated RLE in `data/maps/masks/<id>.ts`) is solid and 0 everywhere else; every
 * plate the map lists exists at the size its layer says; the thumbnail is 160 x 90; and
 * the map's PNGs together stay under the 1.2 MB budget. A re-render that was not packed
 * (picture and mask out of step) or a hand-edited mask fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeRle, maps } from '@gunbros/shared';
import type { PlateLayer } from '@gunbros/shared';
import { decodePng } from './png.js';

const PUBLIC = new URL('../public/maps/', import.meta.url);
const MAX_MAP_BYTES = 1_200_000;

function file(mapId: string, name: string): Uint8Array {
  return readFileSync(fileURLToPath(new URL(`${mapId}/${name}`, PUBLIC)));
}

const painted = maps.filter((m) => m.art !== undefined);

describe('painted map art', () => {
  it('exists for the reference map', () => {
    expect(painted.map((m) => m.id)).toContain('hills');
  });

  for (const map of painted) {
    describe(map.id, () => {
      it('has a terrain picture whose alpha is exactly the mask', () => {
        if (map.source.kind !== 'mask' || !map.art) throw new Error(`${map.id} is not a mask map`);
        const png = decodePng(file(map.id, map.art.terrain));
        expect([png.width, png.height]).toEqual([map.width, map.height]);
        const mask = decodeRle(map.source.rle).mask;
        let mismatches = 0;
        let partial = 0;
        let first = -1;
        for (let i = 0; i < mask.length; i++) {
          const a = png.data[i * 4 + 3] as number;
          if (a !== 0 && a !== 255) partial++;
          if ((a === 255) !== (mask[i] === 1)) {
            mismatches++;
            if (first < 0) first = i;
          }
        }
        expect(partial, 'semi-transparent pixels').toBe(0);
        expect(
          mismatches,
          first < 0 ? 'mismatches' : `first mismatch at (${first % map.width}, ${Math.floor(first / map.width)})`,
        ).toBe(0);
      });

      it('has every plate it lists, at the size the layer says', () => {
        const plates = map.background.filter((l): l is PlateLayer => l.kind === 'plate');
        for (const p of plates) {
          const png = decodePng(file(map.id, p.src));
          expect([png.width, png.height], p.src).toEqual([p.width, p.height]);
        }
      });

      it('has a 160 x 90 thumbnail', () => {
        if (!map.art) return;
        const png = decodePng(file(map.id, map.art.thumb));
        expect([png.width, png.height]).toEqual([160, 90]);
      });

      it('stays inside the size budget', () => {
        const dir = fileURLToPath(new URL(`${map.id}/`, PUBLIC));
        const total = readdirSync(dir).reduce((sum, f) => sum + statSync(`${dir}${f}`).size, 0);
        expect(total).toBeLessThanOrEqual(MAX_MAP_BYTES);
      });
    });
  }
});
