/**
 * Pointer input (DESIGN §1.3 input/mouse.ts, §7 item 144).
 *
 * One code path for a mouse, a finger and a stylus: Pointer Events. Window-space
 * coordinates become backbuffer coordinates, and every pointer keeps its own identity,
 * because on a phone two of them are down at once — a thumb holding FIRE while the other
 * hand taps the angle pad is the whole point of this pass.
 *
 * The module reports *where* and *when*; it never decides what a press means. The scene
 * hit-tests the HUD and remembers which pointer took which role (`matchView.ts`).
 *
 * Everything is captured to the canvas on `pointerdown`, so a finger that slides off the
 * FIRE key still reports its release to us and cannot leave the button stuck down.
 */
import { clientConstants } from '../data/clientConstants.js';

export interface PointerPoint {
  x: number;
  y: number;
}

export type ToBackbuffer = (clientX: number, clientY: number) => PointerPoint;

/**
 * What the scene may do *inside* the browser's event handlers rather than on the next
 * frame. Everything else in this module is queued for the frame loop; these three are
 * not, because a few things only work while the browser is still handling the gesture
 * (DESIGN §7 items 157 and 166).
 */
export interface PointerHooks {
  /**
   * Run at the top of `pointerdown` *and* of `pointerup`: the audio unlock. WebKit only
   * starts an AudioContext while a user gesture is being handled, and for a finger the
   * HTML spec counts the release as that gesture, not the press.
   */
  onGesture?: () => void;
  /**
   * Should a press here leave the text field focused? Every other press on the canvas
   * takes the focus away, which is how a tap on the game closes the virtual keyboard;
   * the chat button is the exception, because it is the key that closes it on purpose.
   */
  keepsFocus?: (point: PointerPoint) => boolean;
  /**
   * A pointer came up (not cancelled), still inside the handler. For the one control
   * that has to act here: focusing the chat line raises the iOS keyboard only from a
   * handler of the gesture itself, never from an animation frame.
   */
  onRelease?: (sample: PointerSample) => void;
}

/** One pointer, in backbuffer pixels. */
export interface PointerSample {
  id: number;
  x: number;
  y: number;
  /** Where it went down, so a scene can tell a tap from a drag. */
  startX: number;
  startY: number;
  /** `performance.now()` when it went down. */
  startedAt: number;
  /**
   * Did this pointer end by `pointercancel` or a lost window rather than a release?
   * Set when it lands in `ups`. A cancelled pointer never *did* anything: the browser
   * took the gesture away (an edge swipe, the home indicator, Control Center, a call)
   * while the finger was still down, so a scene must clear the holds it owned and act
   * on nothing — no shot, no item, no teleport spot (DESIGN §7 item 168).
   */
  cancelled: boolean;
  /**
   * A finger has no hover state and no right button; a mouse has both. A pen counts as
   * a finger here and in every other predicate in this module: it reports a position
   * only while it is touching, which is what "no hover" means.
   */
  touch: boolean;
}

/**
 * How much faster the angle moves the longer the key is held (DESIGN §7 item 145).
 *
 * A fixed step is either too slow to cross 80 degrees or too coarse to land on one.
 * Held taps start at the designed rate, and after `accelFromMs` ramp to `maxFactor`
 * over `rampMs`, so a long press sweeps and a short one nudges. Pure, so the feel is a
 * unit test rather than a thumb.
 */
export function aimHoldFactor(heldMs: number): number {
  const a = clientConstants.input.aimHold;
  if (!(heldMs > a.accelFromMs)) return 1;
  const t = Math.min(1, (heldMs - a.accelFromMs) / a.rampMs);
  return 1 + (a.maxFactor - 1) * t;
}

/**
 * Is a pointer that went down at (startX, startY) and came up at (x, y) a tap?
 *
 * A finger never lands and lifts on exactly the same pixel, so "did not move" has to be
 * a radius rather than an equality. Pure for the same reason as above.
 */
export function isTap(sample: PointerSample, x: number, y: number): boolean {
  const slop = clientConstants.input.tapSlopPx;
  return Math.abs(x - sample.startX) <= slop && Math.abs(y - sample.startY) <= slop;
}

/**
 * Does this pointer have a hover state — is it a mouse?
 *
 * The one predicate for the whole module. Splitting it (`!== 'mouse'` in one handler,
 * `=== 'touch'` in the next) made a pen a finger on the way down and a mouse on the way
 * across, so the crosshair and the item caption both believed it was hovering.
 */
function hovers(e: PointerEvent): boolean {
  return e.pointerType === 'mouse';
}

export class PointerInput {
  /** Hover position of the mouse, in backbuffer px. Meaningless on a touch screen. */
  x = 0;
  y = 0;
  /** Is a *hovering* pointer over the canvas? Edge scrolling needs to know. */
  inside = false;

  /** Pointers that went down since the last `endFrame`, in order. */
  readonly downs: PointerSample[] = [];
  /** Pointers that came up (or were cancelled: see `cancelled`) since the last `endFrame`. */
  readonly ups: PointerSample[] = [];
  /** Every pointer that is down right now, by `pointerId`. */
  readonly active = new Map<number, PointerSample>();

  private attached = false;
  private canvas: HTMLElement | null = null;
  private toBackbuffer: ToBackbuffer = (clientX, clientY) => ({ x: clientX, y: clientY });
  /** Run inside the event handlers themselves. See {@link PointerHooks}. */
  private hooks: PointerHooks = {};

  /** Did anything go down this frame? The audio unlock asks (see `Keyboard.anyPressed`). */
  get anyPressed(): boolean {
    return this.downs.length > 0;
  }

  private sampleOf(e: PointerEvent): PointerSample {
    const p = this.toBackbuffer(e.clientX, e.clientY);
    return {
      id: e.pointerId,
      x: p.x,
      y: p.y,
      startX: p.x,
      startY: p.y,
      startedAt: performance.now(),
      cancelled: false,
      touch: !hovers(e),
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Only the left button is a press; a right-click is the context menu we suppress.
    if (hovers(e) && e.button !== 0) return;
    // Synchronously, before anything else: this call stack is the only place a browser
    // lets an AudioContext start (DESIGN §7 item 157). WebKit wants a live user-gesture
    // indicator, and by the next animation frame there is none.
    this.hooks.onGesture?.();
    // Stops the browser turning this into a mouse event, a text selection, a scroll or
    // a double-tap zoom. `touch-action: none` covers the scroll; this covers the rest.
    e.preventDefault();
    const sample = this.sampleOf(e);
    // A tap on the game is also how the virtual keyboard is dismissed: the chat line
    // keeps focus through a prevented default, so take it away by hand — except on the
    // chat button, whose release decides for itself (see `PointerHooks.keepsFocus`).
    if (!this.hooks.keepsFocus?.(sample)) blurTextEntry();
    this.active.set(sample.id, sample);
    this.downs.push(sample);
    if (!sample.touch) {
      this.x = sample.x;
      this.y = sample.y;
      this.inside = true;
    }
    const canvas = this.canvas;
    if (canvas instanceof HTMLElement && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // A pointer that ended between the event and this call: nothing to capture.
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.toBackbuffer(e.clientX, e.clientY);
    const sample = this.active.get(e.pointerId);
    if (sample) {
      sample.x = p.x;
      sample.y = p.y;
    }
    if (hovers(e)) {
      this.x = p.x;
      this.y = p.y;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const sample = this.end(e, false);
    if (!sample) return;
    this.hooks.onGesture?.();
    this.hooks.onRelease?.(sample);
  };

  /**
   * The browser took the pointer away. It still ends — the holds it owned must clear —
   * but as `cancelled`, and without the release hook: nothing was released on purpose.
   */
  private onPointerCancel = (e: PointerEvent): void => {
    this.end(e, true);
  };

  private end(e: PointerEvent, cancelled: boolean): PointerSample | null {
    const sample = this.active.get(e.pointerId);
    if (!sample) return null;
    // A cancel's coordinates are unreliable (often 0, 0): keep the last known position.
    if (!cancelled) {
      const p = this.toBackbuffer(e.clientX, e.clientY);
      sample.x = p.x;
      sample.y = p.y;
    }
    sample.cancelled = cancelled;
    this.active.delete(sample.id);
    this.ups.push(sample);
    if (!sample.touch) {
      this.x = sample.x;
      this.y = sample.y;
    }
    return sample;
  }

  private onEnter = (e: PointerEvent): void => {
    if (!hovers(e)) return;
    this.inside = true;
  };

  private onLeave = (e: PointerEvent): void => {
    if (!hovers(e)) return;
    this.inside = false;
  };

  /** A lost window must not leave a finger holding FIRE for the rest of the turn. */
  private onBlur = (): void => {
    this.inside = false;
    for (const sample of this.active.values()) {
      sample.cancelled = true;
      this.ups.push(sample);
    }
    this.active.clear();
  };

  private onContextMenu = (e: Event): void => {
    // A long press on a canvas opens the context menu on Android, which is exactly the
    // gesture that charges a shot.
    e.preventDefault();
  };

  /**
   * Start listening. The {@link PointerHooks} run *inside* the event handlers rather
   * than on the next frame: the audio unlock and the chat line's focus only work while
   * the browser is still handling the gesture.
   */
  attach(canvas: HTMLElement, toBackbuffer: ToBackbuffer, hooks: PointerHooks = {}): void {
    if (this.attached) return;
    this.canvas = canvas;
    this.toBackbuffer = toBackbuffer;
    this.hooks = hooks;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerenter', this.onEnter);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointercancel', this.onPointerCancel);
      canvas.removeEventListener('pointerenter', this.onEnter);
      canvas.removeEventListener('pointerleave', this.onLeave);
      canvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    window.removeEventListener('blur', this.onBlur);
    this.canvas = null;
    this.hooks = {};
    this.active.clear();
    this.downs.length = 0;
    this.ups.length = 0;
    this.attached = false;
  }

  /** Clear the one-shot edges. Call at the end of every frame. */
  endFrame(): void {
    this.downs.length = 0;
    this.ups.length = 0;
  }
}

/** Take focus away from the chat line (and close the virtual keyboard with it). */
function blurTextEntry(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) active.blur();
}
