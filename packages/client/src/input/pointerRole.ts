/**
 * What a pointer on the match screen is doing, and what its end means (DESIGN §7 items
 * 144, 162 and 168).
 *
 * `matchView.ts` gives every pointer that goes down a role and keeps it until the pointer
 * comes up. The *end* is the part worth pinning without a browser: a release commits a
 * teleport spot or spends an item, while a pointer the browser cancelled — an edge swipe,
 * the home indicator, Control Center, a call, a lost window — commits nothing, and a
 * cancelled FIRE throws the charge away rather than shooting it.
 */
import { isTap } from './pointer.js';
import type { PointerSample } from './pointer.js';

/**
 * What one pointer is doing (DESIGN §7 item 144).
 *
 * Every pointer that goes down is given a role and keeps it until it comes up, which is
 * what lets a thumb hold FIRE while the other hand works the angle pad: the two are
 * different entries in the same map, not one global "the mouse is down".
 *
 * `tap` is a button that already did its work on the press (a shot key or a toggle) and
 * has nothing left to do on the release.
 */
export type PointerRole =
  | { kind: 'tap' }
  /** `frame` is the rendered frame the press landed on; see {@link releaseOutcome}. */
  | { kind: 'fire'; frame: number }
  | { kind: 'angle'; delta: 1 | -1 }
  | { kind: 'move'; dir: 1 | -1 }
  /** Dragging the dial: the angle is set from how far the finger has travelled. */
  | { kind: 'aim'; startY: number; startAngle: number }
  /**
   * A loadout slot. Unlike the other buttons this one acts on the *release*, so that a
   * press and hold names the item in the caption first: a finger has no hover, and
   * without this a player on a phone can only learn what Bandage does by spending it
   * (DESIGN §7 item 162). Sliding off the slot before lifting cancels it.
   */
  | { kind: 'item'; index: number }
  /**
   * Dragging the world: the camera follows the finger. `started` is false until the
   * pointer has actually travelled — a *tap* on the world must not park the camera,
   * and on a touch screen every press begins as a possible tap.
   */
  | { kind: 'drag'; startX: number; startY: number; started: boolean }
  /** Picking a teleport spot: the crosshair follows, and the release commits it. */
  | { kind: 'target' };

/** What the scene does when a pointer holding `role` comes up. */
export type ReleaseOutcome =
  /** Nothing beyond dropping the role (the holds are re-derived from the role map). */
  | { kind: 'none' }
  /** Hand the camera back: the drag had taken it. */
  | { kind: 'endDrag' }
  /** A tap on the world while an item asks for a spot: that is the spot. */
  | { kind: 'commitTarget'; x: number; y: number }
  /** Lifted on the loadout slot it pressed: spend the item. */
  | { kind: 'useItem'; index: number }
  /** FIRE went down and came up inside one frame: the charge never started. */
  | { kind: 'fireTooShort' }
  /** FIRE was cancelled by the browser: end the charge and do not shoot. */
  | { kind: 'abortCharge' };

/**
 * Pure: what the end of pointer `p`, which held `role`, means. `frameTick` is the frame
 * being handled, for the press-and-release-in-one-frame case.
 */
export function releaseOutcome(role: PointerRole, p: PointerSample, frameTick: number): ReleaseOutcome {
  // A press that never travelled never took the camera: nothing to hand back. A drag
  // that did is handed back however it ended.
  if (role.kind === 'drag') return role.started ? { kind: 'endDrag' } : { kind: 'none' };
  if (p.cancelled) return role.kind === 'fire' ? { kind: 'abortCharge' } : { kind: 'none' };
  switch (role.kind) {
    case 'target':
      // A tap commits the teleport spot; a drag over the map was the player moving the
      // crosshair around to look at it, and is not an answer.
      return isTap(p, p.x, p.y) ? { kind: 'commitTarget', x: p.x, y: p.y } : { kind: 'none' };
    case 'item':
      // Lifting on the slot spends the item; sliding off first is how a player who only
      // wanted to read the caption backs out.
      return isTap(p, p.x, p.y) ? { kind: 'useItem', index: role.index } : { kind: 'none' };
    case 'fire':
      return role.frame === frameTick ? { kind: 'fireTooShort' } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}
