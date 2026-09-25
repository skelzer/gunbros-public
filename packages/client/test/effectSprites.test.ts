/**
 * The Blender effects atlas (tools/blender/build_effects.py, render/effectSprites.ts):
 * every clip the client asks for is there, every frame sits inside the image and its
 * canvas, and the pure pieces — frame by age, tier by radius, satellites past the
 * largest tier, the damage-type fallback — pick what they should.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { damageTypes } from '@gunbros/shared';
import { clientConstants } from '../src/data/clientConstants.js';
import {
  clipFrameAt,
  clipLength,
  keyForType,
  nearestTier,
  satelliteCount,
} from '../src/render/effectSprites.js';
import type { EffectAtlas } from '../src/render/effectSprites.js';

const atlas = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../public/sprites/blender/effects.json', import.meta.url)),
    'utf-8',
  ),
) as EffectAtlas;

const sp = clientConstants.effects.sprites;

describe('the effects atlas', () => {
  it('has a blast in every tier and a hit pop for every damage type', () => {
    for (const type of damageTypes) {
      for (const t of sp.blastTiers)
        expect(atlas.effects[`blast_${type}_${t.tier}`], `${type} ${t.tier}`).toBeDefined();
      expect(atlas.effects[`hit_${type}`], type).toBeDefined();
    }
  });

  it('has the death blast, smoke, every beam tier, the beam burst, the teleport and the vortex', () => {
    const keys = ['death_blast', 'beam_hit', 'teleport', 'vortex'];
    for (const size of ['s', 'l']) for (const v of ['a', 'b', 'c']) keys.push(`smoke_${size}_${v}`);
    for (const t of sp.beamTiers) keys.push(`beam_${t.tier}`);
    for (const k of keys) expect(atlas.effects[k], k).toBeDefined();
  });

  it('keeps every frame inside the image and inside its own canvas', () => {
    const [w, h] = atlas.size;
    for (const [key, clip] of Object.entries(atlas.effects)) {
      expect(clip.frames.length, key).toBe(clip.ticks.length);
      expect(
        clip.ticks.every((t) => t >= 1),
        key,
      ).toBe(true);
      for (const [x, y, fw, fh, ox, oy] of clip.frames) {
        if (fw === 0) continue;
        expect(x >= 0 && y >= 0 && x + fw <= w && y + fh <= h, key).toBe(true);
        expect(ox >= 0 && oy >= 0 && ox + fw <= clip.size[0] && oy + fh <= clip.size[1], key).toBe(
          true,
        );
      }
    }
  });

  it('draws beam segments the full tile height, so the tiles meet', () => {
    for (const t of sp.beamTiers) {
      const clip = atlas.effects[`beam_${t.tier}`];
      expect(clip?.tile).toBe(true);
      for (const f of clip?.frames ?? []) expect([f[3], f[5]]).toEqual([clip?.size[1], 0]);
    }
  });

  it('opens every blast on a drawn frame', () => {
    for (const [key, clip] of Object.entries(atlas.effects)) {
      if (key.startsWith('blast_') || key.startsWith('hit_'))
        expect(clip.frames[0]?.[2], key).toBeGreaterThan(0);
    }
  });
});

describe('clipFrameAt', () => {
  const clip = { ticks: [2, 3, 1], loop: false };

  it('holds each frame for its ticks and ends with -1', () => {
    expect(clipLength(clip)).toBe(6);
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => clipFrameAt(clip, a))).toEqual([0, 0, 1, 1, 1, 2, -1]);
    expect(clipFrameAt(clip, -1)).toBe(-1);
  });

  it('wraps a looping clip', () => {
    const loop = { ...clip, loop: true };
    expect([6, 7, 8, 11, 12].map((a) => clipFrameAt(loop, a))).toEqual([0, 0, 1, 2, 0]);
  });
});

describe('tiers', () => {
  it('picks the blast tier nearest the carve radius, never scaling', () => {
    const tier = (r: number) => nearestTier(sp.blastTiers, r).tier;
    expect([12, 18, 20, 22, 26, 30, 32, 34, 40, 88].map(tier)).toEqual([
      's',
      's',
      's',
      'm',
      'm',
      'm',
      'm',
      'l',
      'l',
      'l',
    ]);
  });

  it('splits a tie towards the bigger tier', () => {
    expect(
      nearestTier(
        [
          { tier: 'a', px: 10 },
          { tier: 'b', px: 20 },
        ],
        15,
      ).tier,
    ).toBe('b');
  });

  it('adds satellite blasts only past the largest tier, up to the cap', () => {
    const n = (r: number) =>
      satelliteCount(r, sp.satelliteFromPx, sp.satellitePerPx, sp.maxSatellites);
    expect(n(40)).toBe(0);
    expect(n(sp.satelliteFromPx - 1)).toBe(0);
    expect(n(sp.satelliteFromPx)).toBe(1);
    expect(n(56)).toBeGreaterThanOrEqual(1);
    expect(n(88)).toBe(sp.maxSatellites);
  });

  it('picks the beam tier nearest the column width', () => {
    const tier = (w: number) => nearestTier(sp.beamTiers, w).tier;
    expect([7, 12, 16, 28, 46].map(tier)).toEqual(['n', 'n', 'm', 'm', 'w']);
  });
});

describe('keyForType', () => {
  const have = new Set(['blast_explosive_m', 'blast_ice_m', 'hit_explosive']);
  const has = (k: string) => have.has(k);

  it("uses the damage type's own clip when there is one", () => {
    expect(keyForType('blast', 'ice', '_m', has)).toBe('blast_ice_m');
  });

  it('falls back to the explosive clip, then to nothing', () => {
    expect(keyForType('blast', 'plasma', '_m', has)).toBe('blast_explosive_m');
    expect(keyForType('hit', 'water', '', has)).toBe('hit_explosive');
    expect(keyForType('blast', 'ice', '_l', has)).toBeUndefined();
  });
});
