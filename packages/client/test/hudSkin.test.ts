/**
 * The pure half of the HUD skin (docs/ART.md): the pixel font's metrics, the chat
 * bubble's wrapping, and the icon grids.
 *
 * None of this needs a canvas — the font and the icons are data, and the two helpers
 * over them are arithmetic — which is exactly why they are worth testing: a glyph grid
 * with a short row draws a hole, and a bubble that silently swallows the end of a
 * sentence is invisible in a screenshot.
 */
import { describe, expect, it } from 'vitest';
import { itemDefs } from '@gunbros/shared';
import { GLYPH_H, GLYPH_W, hasGlyphs, pixelTextWidth } from '../src/ui/pixelFont.js';
import { ICON_PALETTE, ICON_SIZE, iconNames, iconRows, itemIconName } from '../src/ui/pixelIcons.js';
import { wrapBubbleText } from '../src/render/hud.js';

describe('the pixel font', () => {
  it('measures a run as glyphs plus the tracking between them', () => {
    expect(pixelTextWidth('', 1)).toBe(0);
    expect(pixelTextWidth('A', 1)).toBe(GLYPH_W);
    expect(pixelTextWidth('AB', 1)).toBe(GLYPH_W * 2 + 1);
    expect(pixelTextWidth('AB', 2)).toBe((GLYPH_W * 2 + 1) * 2);
    expect(pixelTextWidth('ABC', 1, 2)).toBe(GLYPH_W * 3 + 4);
  });

  it('knows what it can and cannot spell', () => {
    // Everything the HUD writes itself.
    expect(hasGlyphs('FIRE  SKIP  100%  0/4')).toBe(true);
    expect(hasGlyphs('power 37')).toBe(true);
    // …and nothing a player might be called, which is why nicknames keep the canvas
    // font (`drawMobileTag`).
    expect(hasGlyphs('Ángel')).toBe(false);
    expect(hasGlyphs('ミゲル')).toBe(false);
  });
});

describe('the icon grids', () => {
  it('are square, complete, and only use the shared palette', () => {
    for (const name of iconNames()) {
      const rows = iconRows(name);
      expect(rows.length, `${name}: row count`).toBe(ICON_SIZE);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as string;
        expect(row.length, `${name} row ${i}`).toBe(ICON_SIZE);
        for (const ch of row) {
          if (ch === '.' || ch === ' ') continue;
          expect(ICON_PALETTE[ch], `${name} row ${i}: "${ch}"`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('draws something in every icon', () => {
    for (const name of iconNames()) {
      const lit = iconRows(name)
        .join('')
        .split('')
        .filter((ch) => ch !== '.' && ch !== ' ').length;
      expect(lit, `${name}`).toBeGreaterThan(20);
    }
  });

  it('gives every item in the loadout a picture', () => {
    for (const def of itemDefs) {
      expect(itemIconName(def.id), def.id).not.toBeNull();
    }
    expect(itemIconName('notAnItem')).toBeNull();
  });
});

describe('chat bubbles', () => {
  it('wraps on whole words, losing nothing that fits', () => {
    const text = 'watch the wind it is 13';
    const lines = wrapBubbleText(text, 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(12);
    expect(lines.join(' ')).toBe(text);
  });

  it('keeps a short line as one line', () => {
    expect(wrapBubbleText('ok', 22)).toEqual(['ok']);
    expect(wrapBubbleText('nice shot bro!', 22)).toEqual(['nice shot bro!']);
  });

  it('cuts a word that cannot fit rather than overflowing the plate', () => {
    const lines = wrapBubbleText('aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(8);
  });

  it('stops at three lines and marks the cut', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    const lines = wrapBubbleText(long, 10);
    expect(lines.length).toBe(3);
    expect(lines[2]?.endsWith('…')).toBe(true);
  });

  it('wraps an empty line to nothing', () => {
    expect(wrapBubbleText('')).toEqual([]);
    expect(wrapBubbleText('   ')).toEqual([]);
  });
});

describe('the font cell', () => {
  it('is the 3x5 the layout arithmetic assumes', () => {
    expect(GLYPH_W).toBe(3);
    expect(GLYPH_H).toBe(5);
  });
});
