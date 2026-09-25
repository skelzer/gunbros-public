/**
 * Keyboard (DESIGN §1.3 input/keyboard.ts): raw key events become held state plus
 * one-shot edges, and the movement edge becomes a `move` Intent — which is exactly the
 * shape the protocol sends (DESIGN §6.1: edge-triggered, held until changed).
 *
 * The bindings follow the brief: Left/Right move, Up/Down aim, Space charges and fires
 * on release, Tab cycles the shot selection, 1–6 are the six item slots and Esc backs
 * out of a targeting mode. The rest are sandbox conveniences.
 */
import type { MoveIntent } from '@gunbros/shared';

export type Action =
  | 'left'
  | 'right'
  | 'aimUp'
  | 'aimDown'
  | 'charge'
  | 'cycleShot'
  | 'skip'
  | 'item1'
  | 'item2'
  | 'item3'
  | 'item4'
  | 'item5'
  | 'item6'
  | 'rerollWind'
  | 'newMap'
  | 'freeCamera'
  | 'mute'
  | 'help'
  | 'restart'
  | 'toggleMode'
  | 'switchSeat'
  | 'cycleMobile'
  | 'cancel'
  | 'chat';

/** The six item-slot actions, in slot order. */
export const itemActions: Action[] = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'];

/** `KeyboardEvent.code` values per action, so the layout does not matter. */
export const defaultBindings: Record<Action, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  aimUp: ['ArrowUp', 'KeyW'],
  aimDown: ['ArrowDown', 'KeyS'],
  charge: ['Space'],
  cycleShot: ['Tab'],
  skip: ['KeyX'],
  item1: ['Digit1', 'Numpad1'],
  item2: ['Digit2', 'Numpad2'],
  item3: ['Digit3', 'Numpad3'],
  item4: ['Digit4', 'Numpad4'],
  item5: ['Digit5', 'Numpad5'],
  item6: ['Digit6', 'Numpad6'],
  rerollWind: ['KeyR'],
  newMap: ['KeyN'],
  freeCamera: ['KeyF'],
  mute: ['KeyM'],
  // The controls card (DESIGN §8 HUD polish): the key line is a card you open, not a
  // permanent strip across the screen.
  help: ['KeyH'],
  restart: ['Enter', 'NumpadEnter'],
  toggleMode: ['Backquote'],
  // Free play only: in `turns` mode control follows `state.activeSeat`.
  switchSeat: ['KeyC'],
  // Sandbox only: swap the controlled seat's mobile for the next one in the roster
  // and restart the match, which is how Phase 4 is play-tested (DESIGN §9 Phase 4).
  cycleMobile: ['KeyP'],
  // Backs out of a mode that is waiting for a click — today only the teleport
  // crosshair (DESIGN §4). The chat line handles its own Escape on the input element
  // and stops it there, so the two never fight over the key.
  cancel: ['Escape'],
  // Opens the in-match chat line (Esc closes it); the sandbox uses Enter to restart,
  // and the two never share a screen.
  chat: ['Enter', 'NumpadEnter'],
};

/**
 * Is the event going to a text field? The room and the match both put real DOM inputs
 * on top of the canvas (the chat line, the nickname box), and a game that swallowed
 * Space and the arrow keys while someone typed would be unusable.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Keys whose browser default (scrolling, focus change) would fight the game. */
const swallowed = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'Tab',
]);

export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressedCodes = new Set<string>();
  private readonly releasedCodes = new Set<string>();
  private lastMoveDir: -1 | 0 | 1 = 0;
  private attached = false;
  /** Called inside the `keydown` handler itself. See {@link attach}. */
  private onPress: (() => void) | null = null;

  constructor(private bindings: Record<Action, string[]> = defaultBindings) {}

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target)) return;
    // Inside the handler, not on the next frame: this call stack is the user gesture an
    // AudioContext needs to start (DESIGN §7 item 157).
    if (!e.repeat) this.onPress?.();
    if (swallowed.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedCodes.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target)) return;
    if (swallowed.has(e.code)) e.preventDefault();
    this.down.delete(e.code);
    this.releasedCodes.add(e.code);
  };

  private onBlur = (): void => {
    // A lost focus must not leave a key stuck down: release everything.
    for (const code of this.down) this.releasedCodes.add(code);
    this.down.clear();
  };

  /**
   * Focus moved into the chat line (or any other field) while a key was held: the
   * matching keyup will be filtered out, so release everything now instead of leaving
   * the mobile walking.
   */
  private onFocusIn = (e: FocusEvent): void => {
    if (isTextEntry(e.target)) this.onBlur();
  };

  /**
   * Start listening. `onPress` runs *inside* the `keydown` handler, for the audio
   * unlock: a browser only starts an AudioContext while a user gesture is live.
   */
  attach(onPress?: () => void): void {
    if (this.attached) return;
    this.onPress = onPress ?? null;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focusin', this.onFocusIn);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focusin', this.onFocusIn);
    this.onPress = null;
    this.down.clear();
    this.pressedCodes.clear();
    this.releasedCodes.clear();
    this.attached = false;
  }

  isDown(action: Action): boolean {
    const codes = this.bindings[action];
    for (const code of codes) if (this.down.has(code)) return true;
    return false;
  }

  /** True once, on the frame the key went down. */
  pressed(action: Action): boolean {
    const codes = this.bindings[action];
    for (const code of codes) if (this.pressedCodes.has(code)) return true;
    return false;
  }

  /** True once, on the frame the key came up. */
  released(action: Action): boolean {
    const codes = this.bindings[action];
    for (const code of codes) if (this.releasedCodes.has(code)) return true;
    return false;
  }

  /**
   * Did *any* key go down this frame? Browsers only let an AudioContext start inside a
   * user gesture (DESIGN §1.3 `audio/synth.ts`), and the game's gestures are keys and
   * clicks — so the audio asks this rather than binding listeners of its own.
   */
  anyPressed(): boolean {
    return this.pressedCodes.size > 0;
  }

  /** Clear the one-shot edges. Call at the end of every frame. */
  endFrame(): void {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
  }

  moveDir(): -1 | 0 | 1 {
    const left = this.isDown('left');
    const right = this.isDown('right');
    if (left === right) return 0;
    return left ? -1 : 1;
  }

  /**
   * A `move` intent only when the direction actually changed, which is what the wire
   * protocol wants and what `applyIntent` expects (it holds the direction).
   *
   * `override` is a direction from somewhere other than the keyboard — the HUD's
   * hold-to-walk arrow buttons — and wins while it is held, so the edge tracking that
   * keeps the wire quiet lives in one place whichever control the player used.
   */
  moveIntent(seat: number, override: -1 | 0 | 1 = 0): MoveIntent | null {
    const dir = override !== 0 ? override : this.moveDir();
    if (dir === this.lastMoveDir) return null;
    this.lastMoveDir = dir;
    return { t: 'move', seat, dir };
  }

  /**
   * Forget the held direction. Used when control passes to another seat, and when a
   * turn becomes active: the sim dropped every intent sent while it was not, so the
   * direction has to be re-sent even though the key never came up.
   */
  resetMove(): void {
    this.lastMoveDir = 0;
  }
}
