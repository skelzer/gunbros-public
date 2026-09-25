/**
 * The Blender projectile atlas (tools/blender/build_projectiles.py,
 * render/projectileSprites.ts): every sprite key the roster fires has a piece, every
 * frame sits inside the image, and the frame picked for a velocity points that way.
 *
 * The atlas is read straight from `public/`, so a shot whose sprite key has no art yet
 * fails here rather than flying as the plain fallback square.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getMobileDef, mobileIds, shotSlots } from '@gunbros/shared';
import { EXTRA_SPRITE_KEYS, projectileFrame } from '../src/render/projectileSprites.js';
import type { ProjectileAtlas, ProjectilePiece } from '../src/render/projectileSprites.js';

const atlas = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../public/sprites/blender/projectiles.json', import.meta.url)),
    'utf-8',
  ),
) as ProjectileAtlas;

function rosterKeys(): string[] {
  const keys = new Set<string>();
  for (const id of mobileIds) {
    for (const slot of shotSlots) keys.add(getMobileDef(id).shots[slot].projectile.sprite);
  }
  for (const extra of EXTRA_SPRITE_KEYS) keys.add(extra.key);
  return [...keys].sort();
}

function piece(mode: ProjectilePiece['mode'], dirs: number, anim: number): ProjectilePiece {
  return {
    mode,
    size: [8, 8],
    dirs,
    anim,
    frameTicks: 4,
    frames: new Array(dirs * anim).fill([0, 0, 8, 8]),
  };
}

describe('the projectile atlas', () => {
  it('has a piece for every sprite key the roster fires, and no strays', () => {
    expect(Object.keys(atlas.pieces).sort()).toEqual(rosterKeys());
  });

  it('keeps every frame inside the image, with the frame count its mode implies', () => {
    const [w, h] = atlas.size;
    for (const [key, p] of Object.entries(atlas.pieces)) {
      expect(p.frames.length, key).toBe(p.mode === 'aim' ? p.dirs * p.anim : p.anim);
      for (const [x, y, fw, fh] of p.frames) {
        expect(x >= 0 && y >= 0 && x + fw <= w && y + fh <= h, key).toBe(true);
        expect([fw, fh], key).toEqual(p.size);
      }
    }
  });
});

describe('projectileFrame', () => {
  it('points an aim piece along the velocity, counter-clockwise from right (world +y down)', () => {
    const p = piece('aim', 16, 1);
    expect(projectileFrame(p, 1, 0, 0)).toBe(0);
    expect(projectileFrame(p, 0, -1, 0)).toBe(4); // up
    expect(projectileFrame(p, -1, 0, 0)).toBe(8);
    expect(projectileFrame(p, 0, 1, 0)).toBe(12); // down
    expect(projectileFrame(p, 1, 0.01, 0)).toBe(0); // just below right wraps to 0, not 16
    expect(projectileFrame(p, 0, 0, 0)).toBe(0);
  });

  it('flickers an animated aim piece within its direction', () => {
    const p = piece('aim', 16, 2);
    expect(projectileFrame(p, 0, -1, 0)).toBe(8);
    expect(projectileFrame(p, 0, -1, 4)).toBe(9);
    expect(projectileFrame(p, 0, -1, 8)).toBe(8);
  });

  it('spins forwards flying right and backwards flying left', () => {
    const p = piece('spin', 1, 4);
    expect([0, 4, 8, 12].map((t) => projectileFrame(p, 1, 0, t))).toEqual([0, 1, 2, 3]);
    expect([0, 4, 8, 12].map((t) => projectileFrame(p, -1, 0, t))).toEqual([0, 3, 2, 1]);
  });

  it('loops by age whatever the velocity', () => {
    const p = piece('loop', 1, 3);
    expect([0, 4, 8, 12].map((t) => projectileFrame(p, -1, 5, t))).toEqual([0, 1, 2, 0]);
  });
});
