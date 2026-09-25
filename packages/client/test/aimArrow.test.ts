/**
 * The aim arrow's shape (DESIGN §7 item 171).
 */
import { describe, expect, it } from 'vitest';
import { aimArrowPixels } from '../src/render/aimArrow.js';
import { clientConstants } from '../src/data/clientConstants.js';

const style = clientConstants.hud.aim;

describe('aimArrowPixels', () => {
  it('runs from the muzzle to the tip along the aim', () => {
    const px = aimArrowPixels(100, 100, 1, 0);
    const xs = px.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100 + style.fromPx - style.dotPx);
    const lastDot = style.fromPx + Math.floor((style.toPx - style.fromPx) / style.stepPx) * style.stepPx;
    expect(Math.max(...xs)).toBe(100 + lastDot + style.headGapPx + style.headLengthPx);
    // Pointing right: nothing strays above or below the head's half-width.
    for (const p of px) expect(Math.abs(p.y - 100)).toBeLessThanOrEqual(Math.ceil(style.headHalfWidthPx));
  });

  it('fades the shaft in towards the head, and the head is solid', () => {
    const px = aimArrowPixels(0, 0, 0, -1);
    const shaft = px.filter((p) => p.size === style.dotPx);
    for (let i = 1; i < shaft.length; i++) {
      expect(shaft[i]!.alpha).toBeGreaterThan(shaft[i - 1]!.alpha);
    }
    expect(shaft[0]!.alpha).toBeCloseTo(style.fadeFrom);
    expect(shaft[shaft.length - 1]!.alpha).toBeCloseTo(1);
    for (const p of px.filter((q) => q.size === 1)) expect(p.alpha).toBe(1);
  });

  it('draws a diagonal head with no doubled pixels', () => {
    const r = Math.SQRT1_2;
    const head = aimArrowPixels(50, 50, r, -r).filter((p) => p.size === 1);
    const keys = new Set(head.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(head.length);
    expect(head.length).toBeGreaterThan(style.headLengthPx);
  });
});
