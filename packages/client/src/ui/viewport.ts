/**
 * The phone shell (DESIGN §7 items 148-149): the handful of browser behaviours that have
 * to be turned off before a canvas game is playable with fingers, and the one number
 * that tells the DOM layers how much of the window the virtual keyboard has taken.
 *
 * None of it is game logic. It is installed once, at boot, and never removed.
 *
 * - **Pinch zoom** is a two-finger gesture, and this game's two-finger gesture is "hold
 *   FIRE and tap the angle pad". `user-scalable=no` in the viewport meta covers Chrome;
 *   Safari ignores it and needs its non-standard `gesture*` events prevented instead.
 *   Only on a touch screen, though: the same events are a trackpad pinch in desktop
 *   Safari, where turning page zoom off is an accessibility regression and nothing here
 *   is gained (DESIGN §7 item 155).
 * - **Double-tap zoom** is what a fast second tap on a button becomes. The canvas has
 *   `touch-action: none`, which covers it there; `manipulation` covers the menus.
 * - **The virtual keyboard** shrinks the *visual* viewport without changing the layout
 *   viewport, so `--kb-inset` is how much is missing from the bottom. Anything that has
 *   to stay above the keyboard (the chat line) adds it to its own offset.
 */

let installed = false;

/**
 * Is this a touch screen — a phone or a tablet — rather than a machine with a mouse?
 *
 * `(pointer: coarse)` on its own means "the *primary* pointer is a finger", which a
 * desktop with a touch monitor can also answer yes to; `(any-pointer: fine)` is then the
 * mouse it also has. Both together are the honest question, and the answer decides three
 * things: whether the canvas takes the exact fractional fit or whole device pixels
 * (`render/canvas.ts`), whether the HUD wears its finger-sized geometry
 * (`hudVariantFor`), and whether the gestures below are suppressed.
 */
export function isTouchScreen(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches &&
      !window.matchMedia('(any-pointer: fine)').matches
    );
  } catch {
    return false;
  }
}

/** Turn off the browser gestures that fight the game, once. */
export function installMobileShell(): void {
  if (installed) return;
  installed = true;

  if (isTouchScreen()) {
    // Safari's own pinch-zoom events. `passive: false` or the preventDefault is ignored.
    const stop = (e: Event): void => {
      e.preventDefault();
    };
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    document.addEventListener('gestureend', stop, { passive: false });
  }

  trackKeyboardInset();
}

/**
 * Publish `--kb-inset` on the document root: the CSS px of window the visual viewport no
 * longer covers at the bottom, which on a phone is the virtual keyboard.
 *
 * `offsetTop` is part of it because iOS scrolls the layout viewport up to keep the
 * focused field visible, and the page below the fold is exactly as unreachable as the
 * part under the keyboard.
 */
function trackKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = (): void => {
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${Math.round(hidden)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
