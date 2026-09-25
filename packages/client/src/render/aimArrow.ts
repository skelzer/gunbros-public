/**
 * The aim arrow drawn from the active mobile's muzzle (DESIGN §7 item 171).
 *
 * Pixel art on the backbuffer: a shaft of square dots that fades in from the muzzle and
 * a solid arrowhead at the tip, every pixel ringed by a 1 px dark outline so it reads on
 * sky, terrain and a name tag alike. The shape is computed by {@link aimArrowPixels},
 * which is pure, and only drawn by {@link drawAimArrow}.
 */
import { clientConstants } from '../data/clientConstants.js';

export interface AimPixel {
  x: number;
  y: number;
  /** Side of the square, in backbuffer px. */
  size: number;
  /** 0..1, applied to the pixel and its outline together. */
  alpha: number;
}

type AimStyle = typeof clientConstants.hud.aim;

/**
 * The arrow's pixels in screen space, shaft first, head last.
 *
 * `dx, dy` is the unit aim direction on screen (y down). Head pixels are rounded onto
 * the grid and de-duplicated, so a diagonal head has no holes and no doubled pixels.
 */
export function aimArrowPixels(
  muzzleX: number,
  muzzleY: number,
  dx: number,
  dy: number,
  style: AimStyle = clientConstants.hud.aim,
): AimPixel[] {
  const out: AimPixel[] = [];
  const half = style.dotPx / 2;
  const dots = Math.floor((style.toPx - style.fromPx) / style.stepPx) + 1;
  for (let i = 0; i < dots; i++) {
    const d = style.fromPx + i * style.stepPx;
    const t = dots > 1 ? i / (dots - 1) : 1;
    out.push({
      x: Math.round(muzzleX + dx * d - half),
      y: Math.round(muzzleY + dy * d - half),
      size: style.dotPx,
      alpha: style.fadeFrom + (1 - style.fadeFrom) * t,
    });
  }

  // The head: a filled triangle from its base (just past the last dot) to the tip.
  const lastDot = style.fromPx + (dots - 1) * style.stepPx;
  const tipD = lastDot + style.headGapPx + style.headLengthPx;
  const tipX = muzzleX + dx * tipD;
  const tipY = muzzleY + dy * tipD;
  const px = -dy;
  const py = dx;
  const seen = new Set<string>();
  for (let s = 0; s <= style.headLengthPx; s += 0.5) {
    const w = (style.headHalfWidthPx * s) / style.headLengthPx;
    for (let o = -w; o <= w; o += 0.5) {
      const x = Math.round(tipX - dx * s + px * o);
      const y = Math.round(tipY - dy * s + py * o);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, size: 1, alpha: 1 });
    }
  }
  return out;
}

/**
 * Draw {@link aimArrowPixels}. A faded dot fades as a whole, outline included: a
 * translucent fill over a solid outline would read as brown, not as a fainter yellow.
 * The shaft goes down first and the head over it, so no dot's fill can paint over the
 * outline across the head's base and leave the wide end open. The head's pixels touch,
 * so all their outlines go down before any of their fills.
 */
export function drawAimArrow(ctx: CanvasRenderingContext2D, pixels: AimPixel[]): void {
  const style = clientConstants.hud.aim;
  const head = pixels.filter((p) => p.size === 1);
  ctx.save();
  for (const p of pixels) {
    if (p.size === 1) continue;
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = style.outline;
    ctx.fillRect(p.x - 1, p.y - 1, p.size + 2, p.size + 2);
    ctx.fillStyle = style.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.outline;
  for (const p of head) ctx.fillRect(p.x - 1, p.y - 1, p.size + 2, p.size + 2);
  ctx.fillStyle = style.color;
  for (const p of head) ctx.fillRect(p.x, p.y, p.size, p.size);
  ctx.restore();
}
