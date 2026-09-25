/**
 * The backbuffer (DESIGN §1.3 render/canvas.ts, §7 item 142).
 *
 * Everything is drawn at the internal resolution and then blown up to fill the window.
 * The width is always 800 px; the height follows the screen's aspect (`viewSizeFor`), so
 * a phone in landscape gets a wide, short buffer instead of a 4:3 window with black bars
 * down both sides. On a desktop the upscale stays a whole number of device pixels, so a
 * "pixel" in the design is a square block of screen pixels and nothing is resampled; on
 * a touch screen the canvas takes the exact fractional fit and fills the glass.
 *
 * The size changes while the game is running — a rotation, a browser that hides its
 * toolbar, a resized window — so consumers subscribe to {@link Backbuffer.onResize}
 * rather than reading the size once.
 */
import { clientConstants } from '../data/clientConstants.js';
import { isTouchScreen } from '../ui/viewport.js';
import { canvasFit, viewSizeFor } from './viewSize.js';
import type { ViewSize } from './viewSize.js';

export interface Backbuffer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Current internal resolution. Both change on a resize or a rotation. */
  readonly width: number;
  readonly height: number;
  /** The same two numbers as one object, for anything that takes a {@link ViewSize}. */
  readonly size: ViewSize;
  /** CSS px per backbuffer px. Not an integer on a phone. */
  readonly scale: number;
  /** Convert a window-space point (e.g. a pointer event) into backbuffer pixels. */
  toBackbuffer(clientX: number, clientY: number): { x: number; y: number };
  /**
   * Hold the current size, whatever the window says (DESIGN §7 item 148).
   *
   * A virtual keyboard sliding up halves the visual viewport, and a canvas that took
   * that at face value would re-lay the whole HUD around a 800x180 window and lay it
   * back out a second later. The game is not being played while someone types a chat
   * line, so the backbuffer simply stops listening until the keyboard is gone.
   */
  setFrozen(frozen: boolean): void;
  /** Called whenever the internal size or the scale changed. Returns an unsubscribe. */
  onResize(listener: (size: ViewSize, scale: number) => void): () => void;
  destroy(): void;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** An offscreen drawing surface with smoothing already turned off. */
export function createOffscreen(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The notch and the home indicator, in CSS px.
 *
 * `env(safe-area-inset-*)` is only readable from CSS, so one hidden element wears the
 * four insets as its padding and is measured. The same four values are the padding on
 * `#app` (index.html), which is what actually keeps the canvas out from under the
 * notch — this reads them so the fit arithmetic agrees with the layout.
 */
function readSafeAreaInsets(probe: HTMLElement): Insets {
  const style = window.getComputedStyle(probe);
  const px = (value: string): number => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}

function createInsetProbe(): HTMLElement {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
    'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  return probe;
}

/**
 * Does this screen want whole device pixels, or the exact fit?
 *
 * A touch screen is a phone or a tablet: there the window is the whole screen and every
 * pixel of it counts. Anything with a mouse — including a laptop that also has a
 * touchscreen, which `isTouchScreen` is careful to exclude — is a desktop, where the
 * window is one of many and pixel-perfect blocks are the house style.
 */
function prefersDevicePixelSnap(): boolean {
  return !isTouchScreen();
}

/** The room the canvas has, in CSS px: the visible viewport less the safe-area insets. */
function availableSize(insets: Insets): { width: number; height: number } {
  const vv = window.visualViewport;
  const width = (vv ? vv.width : window.innerWidth) - insets.left - insets.right;
  const height = (vv ? vv.height : window.innerHeight) - insets.top - insets.bottom;
  return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
}

export function createBackbuffer(host: HTMLElement): Backbuffer {
  const canvas = document.createElement('canvas');
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';
  canvas.tabIndex = 0;
  // Stop the browser from taking a drag on the canvas as a scroll or a pinch: on a phone
  // the canvas *is* the game, and a swipe over it is a camera drag (DESIGN §1.3).
  canvas.style.touchAction = 'none';
  const ctx = context2d(canvas);
  const probe = createInsetProbe();

  host.style.background = clientConstants.canvas.background;
  host.appendChild(canvas);

  const listeners = new Set<(size: ViewSize, scale: number) => void>();
  // Zero, not 800x600: the first `fit` has to size the element itself, and a state that
  // already claimed the size it is about to compute would leave the canvas at its 300x150
  // default on a window that happens to want exactly 800x600.
  const state: { size: ViewSize; scale: number } = { size: { width: 0, height: 0 }, scale: 0 };
  let pending = 0;
  let settle = 0;
  let frozen = false;

  const fit = (): void => {
    if (frozen) return;
    const insets = readSafeAreaInsets(probe);
    const room = availableSize(insets);
    const size = viewSizeFor(room.width, room.height);
    const box = canvasFit(
      room.width,
      room.height,
      size,
      window.devicePixelRatio || 1,
      prefersDevicePixelSnap(),
    );

    const resized = size.width !== state.size.width || size.height !== state.size.height;
    if (resized) {
      canvas.width = size.width;
      canvas.height = size.height;
      state.size = size;
    }
    const rescaled = box.scale !== state.scale;
    state.scale = box.scale;
    canvas.style.width = `${box.cssWidth}px`;
    canvas.style.height = `${box.cssHeight}px`;
    // A size change resets the context; a CSS resize keeps the flag, but setting it
    // again costs nothing and survives a context loss.
    ctx.imageSmoothingEnabled = false;
    if (!resized && !rescaled) return;
    for (const listener of listeners) listener(state.size, state.scale);
  };

  /** Coalesce a burst of resize events into one fit, on the next frame. */
  const schedule = (): void => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      fit();
    });
  };

  /**
   * iOS reports the old window size for a moment after `orientationchange`, so the
   * rotation is fitted again once the dust has settled as well as immediately.
   */
  const onOrientationChange = (): void => {
    schedule();
    window.clearTimeout(settle);
    settle = window.setTimeout(fit, clientConstants.loop.orientationSettleMs);
  };

  fit();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', onOrientationChange);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);

  return {
    canvas,
    ctx,
    get width() {
      return state.size.width;
    },
    get height() {
      return state.size.height;
    },
    get size() {
      return state.size;
    },
    get scale() {
      return state.scale;
    },
    toBackbuffer(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / state.scale,
        y: (clientY - rect.top) / state.scale,
      };
    },
    setFrozen(next: boolean) {
      if (frozen === next) return;
      frozen = next;
      // Coming back: the window may well be a different shape than it was (the page
      // scrolled itself to keep the field in view), so fit again rather than assume.
      if (!frozen) schedule();
    },
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (pending) cancelAnimationFrame(pending);
      window.clearTimeout(settle);
      listeners.clear();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', onOrientationChange);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      probe.remove();
      canvas.remove();
    },
  };
}
