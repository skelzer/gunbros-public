/**
 * What the `?debug=1` build hands a browser test, in one place (DESIGN §10).
 *
 * The HUD is pixels on a canvas: there is no button to click by name and no text to
 * read. `scenes/match.ts` publishes `window.__gunbrosMatch` instead — the same numbers
 * the debug panel draws, plus the rectangle of any control a finger has to press — and
 * this file is the type of it. It is shared by every spec so the shape is written down
 * once and the two suites cannot drift from each other or from the client.
 *
 * Not a spec: Playwright only collects `*.spec.ts`.
 */

/** Mirrors `MatchProbe` in `packages/client/src/scenes/match.ts`. */
export interface MatchProbe {
  readonly seat: number;
  readonly activeSeat: number;
  readonly turn: number;
  readonly completedTurns: number;
  readonly phase: string;
  readonly tick: number;
  readonly desyncs: number;
  readonly ended: boolean;
  /** The local power bar while the charge key is held, else 0. */
  readonly power: number;
  /** Where a HUD control is on the page, in CSS px, or null before the first fit. */
  hudRect(name: ControlName): Rect | null;
}

/** Mirrors `ControlName` in `packages/client/src/scenes/matchView.ts`. */
export type ControlName =
  | 'fire'
  | 'skip'
  | 'moveLeft'
  | 'moveRight'
  | 'angleUp'
  | 'angleDown'
  | 'dial'
  | 's1'
  | 's2'
  | 'ss'
  | 'mute'
  | 'help'
  | 'chat'
  | `item${0 | 1 | 2 | 3 | 4 | 5}`;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One frame a page put on its socket; see `installSocketLog` in `touch.spec.ts`. */
export interface SentFrame {
  at: number;
  t: string;
  dir?: number;
}

declare global {
  interface Window {
    /** Present only with `?debug=1`; see {@link MatchProbe}. */
    __gunbrosMatch?: MatchProbe;
    /** Frames this page sent, newest last. Installed by a test, not by the client. */
    __sent?: SentFrame[];
  }
}
