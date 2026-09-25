/**
 * How big the backbuffer is, and how big it is drawn (DESIGN §1.3, §7 items 142-143).
 *
 * The width of the internal resolution is fixed at 800 px — the whole design is quoted
 * in those pixels — but its *height* follows the screen, so a phone in landscape is not
 * a 4:3 window with black bars down both sides. Everything here is arithmetic on two
 * numbers, kept apart from `canvas.ts` so it can be tested without a DOM: a window that
 * comes out one pixel short is a HUD row hanging off the bottom of the screen, and that
 * is a unit test rather than a screenshot.
 */
import { clamp } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';

/** The internal resolution a scene draws into. */
export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/** How the backbuffer is laid onto the page: CSS px per backbuffer px, and the result. */
export interface CanvasFit {
  scale: number;
  cssWidth: number;
  cssHeight: number;
}

/**
 * The backbuffer for a window of `cssWidth` x `cssHeight` CSS px:
 * `height = clamp(round(800 * cssHeight / cssWidth), minHeightPx, maxHeightPx)`.
 *
 * A 4:3-ish desktop window lands on 800x600 (the clamp), a 19.5:9 phone on 800x370 and
 * a 20:9 phone on exactly 800x360, which is where the floor is set so that the commonest
 * phones fill the screen with no letterbox at all.
 */
export function viewSizeFor(cssWidth: number, cssHeight: number): ViewSize {
  const v = clientConstants.view;
  const width = v.widthPx;
  if (!(cssWidth > 0) || !(cssHeight > 0)) return { width, height: v.maxHeightPx };
  const ideal = Math.round((width * cssHeight) / cssWidth);
  return { width, height: clamp(ideal, v.minHeightPx, v.maxHeightPx) };
}

/**
 * The scale the canvas is drawn at, and the CSS box that comes out of it.
 *
 * `snapToDevicePixels` is the desktop rule and the original one: the upscale has to be a
 * whole number of *device* pixels, not of CSS pixels, because on a display with a
 * fractional devicePixelRatio an integer CSS scale lands between device pixels and the
 * blocks come out uneven. A touch screen takes the exact fractional fit instead: it has
 * two or three device pixels per backbuffer pixel to hide the unevenness in, and a phone
 * that gave up 5 % of its width to keep the blocks perfectly square would be trading the
 * thing the player looks at for a thing they cannot see.
 */
export function canvasFit(
  cssWidth: number,
  cssHeight: number,
  view: ViewSize,
  devicePixelRatio: number,
  snapToDevicePixels: boolean,
): CanvasFit {
  const c = clientConstants.canvas;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const raw = Math.min(cssWidth / view.width, cssHeight / view.height);
  let scale = clamp(raw, c.minScale, c.maxScale);
  if (snapToDevicePixels) {
    const device = Math.floor(scale * dpr);
    // Below one device pixel per backbuffer pixel there is nothing left to snap to, and
    // rounding down would be rounding to zero: take the fractional fit.
    if (device >= 1) scale = device / dpr;
  }
  return {
    scale,
    cssWidth: view.width * scale,
    cssHeight: view.height * scale,
  };
}
