/**
 * The Blender UI kit (tools/blender/build_ui_kit.py, render/uiKit.ts): the committed
 * atlas holds every piece the client names, and the nine-slice arithmetic lands on
 * whole pixels without overlapping itself.
 *
 * The atlas is read straight from `public/`, so re-running the kit's make command
 * without updating the client's piece list (or the other way round) fails here, not in
 * a screenshot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { itemIds } from '@gunbros/shared';
import { nineSliceBlits, uiPieceNames } from '../src/render/uiKit.js';
import type { UiKitAtlas } from '../src/render/uiKit.js';

const atlas = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/ui/blender/ui_kit.json', import.meta.url)), 'utf-8'),
) as UiKitAtlas;

describe('the UI kit atlas', () => {
  it('holds exactly the pieces the client names', () => {
    expect(Object.keys(atlas.pieces).sort()).toEqual([...uiPieceNames()].sort());
  });

  it('has an icon for every item', () => {
    for (const id of itemIds) expect(atlas.pieces[`item/${id}`], id).toBeDefined();
  });

  it('keeps every frame inside the image, and nine-slices wider than their corners', () => {
    const [w, h] = atlas.size;
    for (const [name, p] of Object.entries(atlas.pieces)) {
      for (const [x, y, fw, fh] of p.frames ?? [p.rect]) {
        expect(x >= 0 && y >= 0 && x + fw <= w && y + fh <= h, `${name} in bounds`).toBe(true);
      }
      if (p.kind === 'nine') {
        const [t, r, b, l] = p.slices ?? [0, 0, 0, 0];
        expect(l + r, `${name} width`).toBeLessThan(p.rect[2]);
        expect(t + b, `${name} height`).toBeLessThan(p.rect[3]);
      }
    }
  });

  it('turns the wind arrow all the way round', () => {
    const arrow = atlas.pieces['wind-arrow'];
    expect(arrow?.stepDeg).toBeGreaterThan(0);
    expect((arrow?.frames?.length ?? 0) * (arrow?.stepDeg ?? 0)).toBe(360);
  });
});

describe('nineSliceBlits', () => {
  const piece = { rect: [10, 20, 24, 24] as [number, number, number, number], slices: [7, 7, 7, 7] as [number, number, number, number] };

  it('covers the box exactly, corners unscaled at 1x', () => {
    const blits = nineSliceBlits(piece, 100, 50, 60, 30);
    expect(blits).toHaveLength(9);
    const area = blits.reduce((sum, [, , , , , , dw, dh]) => sum + dw * dh, 0);
    expect(area).toBe(60 * 30);
    expect(blits[0]).toEqual([10, 20, 7, 7, 100, 50, 7, 7]);
    expect(blits[8]).toEqual([27, 37, 7, 7, 153, 73, 7, 7]);
  });

  it('scales the corners and still covers the box', () => {
    const blits = nineSliceBlits(piece, 0, 0, 80, 40, 2);
    expect(blits[0]?.slice(4)).toEqual([0, 0, 14, 14]);
    expect(blits.reduce((sum, b) => sum + b[6] * b[7], 0)).toBe(80 * 40);
  });

  it('drops the middle rather than overlapping corners in a box that is too small', () => {
    const blits = nineSliceBlits(piece, 0, 0, 14, 14);
    expect(blits).toHaveLength(4);
  });
});
