/**
 * The HUD (DESIGN §1.3 render/hud.ts, §2.8, §2.9, §2.10).
 *
 * One console along the bottom holds everything the active player touches — angle dial,
 * weapon cards, move gauge, power bar, item slots, fire and skip — and the rest of the
 * screen carries the read-only furniture: the player list at top left, the timer, wind
 * and status line at top centre, the turn banner that drops in when a turn starts, and
 * a name / HP / shield tag over every mobile.
 *
 * It is drawn with the Blender UI kit (`uiKit.ts`, docs/ART.md §12): nine-slice frames,
 * gem keys, the dial face, the trough and its fills, the wind plate and arrow, the
 * banner plates and the icons. Every kit call falls back to the hand-drawn bevelled
 * plate ({@link drawPlate}) for the few frames before the atlas has loaded, so the HUD
 * is never missing, only plainer.
 *
 * Layout is computed once by {@link bottomBarLayout} from `clientConstants` and is the
 * same rectangle set the pointer hit-tests against ({@link hudHitTest}), so a widget can
 * never be drawn in one place and clicked in another.
 *
 * Nothing here reads or writes MatchState: every function takes a plain view object.
 */
import { constants, cosDeg, itemDefs, sinDeg } from '@gunbros/shared';
import type { ItemId, MobileDef, MobileState, ShotSlot, TeamId, WindState } from '@gunbros/shared';
import {
  belowOrderPanelY,
  clientConstants,
  hudVariantFor,
  orderCount,
  shortItemName,
} from '../data/clientConstants.js';
import type { HudVariant } from '../data/clientConstants.js';
import type { ViewSize } from './viewSize.js';
import { drawPixelText, hasGlyphs, pixelTextWidth } from '../ui/pixelFont.js';
import { drawIconCentred, itemIconName } from '../ui/pixelIcons.js';
import type { IconName } from '../ui/pixelIcons.js';
import { drawBar, drawNineSlice, drawUiPieceAt, stripFrameFor } from './uiKit.js';
import type {
  ButtonState,
  CardState,
  FillColour,
  IconPiece,
  NinePiece,
  SlotState,
  StatusIcon,
} from './uiKit.js';

const hud = clientConstants.hud;
const skin = hud.skin;

/**
 * The two sets of HUD geometry (DESIGN §7 item 143): the designed 800x600 one, and the
 * short-view one whose buttons are finger-sized. `hud.compact` lists only the numbers
 * that differ, so every colour and every animation period is shared between them.
 *
 * Resolved once, here, rather than per frame: a layout is arithmetic on constants and
 * the merge is the only part of it that allocates.
 */
interface HudGeometry {
  bar: typeof hud.bar;
  dial: typeof hud.dial;
  shots: typeof hud.shots;
  gauge: typeof hud.gauge;
  move: typeof hud.move;
  power: typeof hud.power;
  items: typeof hud.items;
  buttons: typeof hud.buttons;
  portrait: typeof hud.portrait;
  toggles: typeof hud.toggles;
  help: typeof hud.help;
}

const GEOMETRY: Record<HudVariant, HudGeometry> = {
  full: {
    bar: hud.bar,
    dial: hud.dial,
    shots: hud.shots,
    gauge: hud.gauge,
    move: hud.move,
    power: hud.power,
    items: hud.items,
    buttons: hud.buttons,
    portrait: hud.portrait,
    toggles: hud.toggles,
    help: hud.help,
  },
  compact: {
    bar: { ...hud.bar, ...hud.compact.bar },
    dial: { ...hud.dial, ...hud.compact.dial },
    shots: { ...hud.shots, ...hud.compact.shots },
    gauge: { ...hud.gauge, ...hud.compact.gauge },
    move: { ...hud.move, ...hud.compact.move },
    power: { ...hud.power, ...hud.compact.power },
    items: { ...hud.items, ...hud.compact.items },
    buttons: { ...hud.buttons, ...hud.compact.buttons },
    portrait: { ...hud.portrait, ...hud.compact.portrait },
    toggles: { ...hud.toggles, ...hud.compact.toggles },
    help: { ...hud.help, ...hud.compact.help },
  },
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The three buttons that work whoever's turn it is: sound, the controls card and the
 * chat line. They are not part of the bar, so they are never greyed out with it.
 */
export type ToggleName = 'mute' | 'help' | 'chat';

/** What the pointer is over. `null` means "the world", i.e. a camera drag. */
export type HudTarget =
  | { kind: 'shot'; shot: ShotSlot }
  | { kind: 'fire' }
  | { kind: 'skip' }
  | { kind: 'angle'; delta: 1 | -1 }
  /**
   * The dial itself, dragged: a vertical sweep sets the angle continuously (DESIGN §7
   * item 146). A thumb crosses the whole range in one gesture instead of holding an
   * arrow for four seconds.
   */
  | { kind: 'aim' }
  /** Hold-to-walk, the same latch as the angle arrows (DESIGN §7 item 27). */
  | { kind: 'move'; dir: 1 | -1 }
  | { kind: 'item'; index: number }
  | { kind: 'toggle'; toggle: ToggleName };

export interface ShotButtonLayout {
  shot: ShotSlot;
  rect: Rect;
}

export interface BottomBarLayout {
  /** Which geometry this layout was built from; every draw call reads it back. */
  variant: HudVariant;
  /** The view it was laid out for, so a draw call needs no second argument. */
  view: ViewSize;
  bar: Rect;
  /**
   * The highest row the bar's furniture reaches: the owner tab stands a few px proud of
   * the bar, and the DOM layers stacked above the bar (the chat log) must clear it.
   */
  top: number;
  dial: Rect;
  dialCentreX: number;
  dialCentreY: number;
  angleUp: Rect;
  angleDown: Rect;
  shots: ShotButtonLayout[];
  gauge: Rect;
  moveLeft: Rect;
  moveRight: Rect;
  /** The whole power trough, frame included. */
  power: Rect;
  items: Rect[];
  fire: Rect;
  skip: Rect;
  /** The mobile portrait in the bar header, and the nick's x once it has moved over. */
  portrait: Rect;
  nickX: number;
  /**
   * The three always-live toggles. They live under the player list rather than in the
   * bar, but they are in this layout because {@link hudHitTest} is the one place a
   * pointer is turned into a widget.
   */
  toggles: Record<ToggleName, Rect>;
  /**
   * The y below every fixed panel in the top-left corner (the player list and the
   * toggle row), i.e. where a free-standing panel such as the debug readout may start.
   */
  belowPanelsY: number;
}

export interface ShotButtonView {
  shot: ShotSlot;
  /** `ShotDef.displayName` — the player-facing name (DESIGN conventions). */
  name: string;
  selected: boolean;
  /** SS gauge fill in [0, 1]; ignored for S1 and S2. */
  gauge: number;
  ready: boolean;
  /**
   * May this shot be fired at all? Only SS is ever false: the Phase 5 gauge is a real
   * gate (DESIGN §2.9, §7 item 21), so the card locks and shows the count while the
   * gauge is short. The server refuses it too — this is the honest button, not the
   * rule.
   */
  available: boolean;
  /** `2/4` for a locked SS, empty otherwise. */
  gaugeText: string;
}

/**
 * One of the six item slots (DESIGN §4). A two-slot item is one view spanning two
 * rectangles; the slots it covers have no view of their own.
 */
export interface ItemSlotView {
  /** Index of the first rectangle this item occupies. */
  index: number;
  /** Rectangles it spans: 1 or 2. */
  span: number;
  /** `ItemDef.displayName` — what the player reads. */
  name: string;
  /** Already spent, and gone for the rest of the match (DESIGN §7 item 92). */
  used: boolean;
  /** May it be pressed right now? False also covers "an item was already used". */
  enabled: boolean;
  /** This is the item waiting for a target click (Teleport). */
  targeting: boolean;
  /** Frames since it was used, for the spend flash; -1 for "not flashing". */
  flashFrames: number;
}

export interface ItemRowView {
  slots: ItemSlotView[];
  /** The line under the row: the hovered item's name, or why nothing may be used. */
  caption: string;
  /** Is the caption a refusal rather than a name? */
  captionWarn: boolean;
  /** Rendered-frame counter, for the targeting blink. */
  frameTick: number;
}

/** A short-lived line under the top cluster. */
export interface NoticeView {
  text: string;
  color: string;
  /** 0..1; the queue fades a line out over its last frames. */
  alpha: number;
  /** Sudden death gets the large font and a gold frame. */
  big: boolean;
}

/** The teleport crosshair while the player is choosing a spot (DESIGN §4). */
export interface TargetCursorView {
  /** Backbuffer-space pointer position. */
  x: number;
  y: number;
  valid: boolean;
  /** What is wrong with this point, or the item's name when nothing is. */
  label: string;
  /** Footprint of the mobile that would land here, in px. */
  hullW: number;
  hullH: number;
  frameTick: number;
}

export interface BottomBarView {
  nick: string;
  team: TeamId;
  mobileName: string;
  /** Aim, in degrees: relative to the hull, in world space, and the hull's own tilt. */
  relAngle: number;
  trueAngle: number;
  tiltDeg: number;
  /** The mobile's aim range, already converted to world angles. */
  rangeFromDeg: number;
  rangeToDeg: number;
  power: number;
  charging: boolean;
  /** Power of this seat's previous shot, or null before its first (DESIGN §2.10). */
  previousPower: number | null;
  shots: ShotButtonView[];
  moveGauge: number;
  moveGaugeMax: number;
  /** Direction the mobile is walking, so the held arrow button lights up. */
  moveHeld: -1 | 0 | 1;
  /** Angle key held (on screen or on the keyboard), so its arrow button goes down. */
  angleHeld: -1 | 0 | 1;
  /** The six item slots and the caption under them. */
  items: ItemRowView;
  /** False while this seat may not act: every key shows its disabled state. */
  enabled: boolean;
  /** The fire button is being held (a pointer is down on it). */
  firePressed: boolean;
  /**
   * The angle is being dragged on the dial (DESIGN §7 item 146): the face lights up and
   * the REL number is repeated on a plate above the bar, so the finger covering the dial
   * still has a number to read.
   */
  aimActive: boolean;
  /** The widget a mouse is resting on, for the kit's hover states; null on a phone. */
  hover: HudTarget | null;
  /** Rendered-frame counter, for the charge pulse and the full-power flash. */
  frameTick: number;
  /**
   * The mobile's idle frame, drawn beside the name. Null until the sheet exists (a PNG
   * sheet loads asynchronously), in which case the header simply has no portrait.
   */
  portrait: HTMLCanvasElement | null;
}

/** One row of the player list (top left). */
export interface OrderEntry {
  seat: number;
  nick: string;
  team: TeamId;
  delay: number;
  /** Whose turn it is: the row is lit and framed. */
  active: boolean;
  /** This row is the local player, whoever's turn it is. */
  self: boolean;
  alive: boolean;
  connected: boolean;
  hp: number;
  hpMax: number;
  /** What the seat is marked with right now, most important first; two are drawn. */
  status: StatusIcon[];
}

/** The three always-live toggles, drawn under the player list. */
export interface TogglesView {
  /** Sound is *off*: the speaker shows its slash. */
  muted: boolean;
  /** The effects are on but the music is off (DESIGN §8.3): the slashed note. */
  musicOff: boolean;
  /** The controls card is open. */
  help: boolean;
  /** This scene has a chat line at all (the sandbox does not). */
  chat: boolean;
  /** The chat line is open and focused. */
  chatOpen: boolean;
  /** Unread lines since the log was last looked at; 0 draws no pip. */
  chatUnread: number;
}

/** The turn banner, from the frame its turn started on. */
export interface TurnBannerView {
  /** YOUR TURN, or the nickname whose turn it is. */
  title: string;
  /** The small line under it: the turn number. */
  sub: string;
  self: boolean;
  /** Rendered frames since the turn started. */
  age: number;
}

/** The socket, as far as the match is concerned (DESIGN §6.4). */
export type NetState = 'online' | 'reconnecting' | 'offline';

// --------------------------------------------------------------------------
// Layout
// --------------------------------------------------------------------------

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Every interactive rectangle of the bottom bar, in backbuffer pixels, for a view of
 * this size. The bar hangs off the *bottom* of the view, so a 800x370 phone window and
 * a 800x600 desktop one put it in different places (DESIGN §7 item 142).
 *
 * `touchScreen` picks the geometry with {@link hudVariantFor}; it is a parameter rather
 * than a media query read in here so the whole layout stays a pure function of two
 * numbers and a flag, and can be asserted without a DOM.
 */
export function bottomBarLayout(view: ViewSize, touchScreen = false): BottomBarLayout {
  const variant = hudVariantFor(view.height, touchScreen);
  const g = GEOMETRY[variant];
  const b = g.bar;
  const barX = b.sideMarginPx;
  const barW = view.width - b.sideMarginPx * 2;
  const barY = view.height - b.bottomMarginPx - b.heightPx;
  const bar = rect(barX, barY, barW, b.heightPx);

  const d = g.dial;
  const dial = rect(barX + d.offsetX, barY + d.offsetY, d.sizePx, d.boxHeightPx);
  const arrowX = barX + d.arrowOffsetX;
  const angleUp = rect(arrowX, barY + d.arrowTopY, d.arrowWidthPx, d.arrowHeightPx);
  const angleDown = rect(
    arrowX,
    angleUp.y + d.arrowHeightPx + d.arrowGapPx,
    d.arrowWidthPx,
    d.arrowHeightPx,
  );

  // Upright cards stand in a row; wide ones are stacked; the touch grid puts S1 and S2
  // side by side over a wide SS (see `hud.shots`).
  const s = g.shots;
  const slots: ShotSlot[] = ['s1', 's2', 'ss'];
  const shots: ShotButtonLayout[] = [];
  const shotX = barX + s.offsetX;
  const shotY = barY + s.offsetY;
  if (s.stack === 'grid') {
    const leftW = Math.floor((s.widthPx - s.gapPx) / 2);
    const rightX = leftW + s.gapPx;
    shots.push(
      { shot: 's1', rect: rect(shotX, shotY, leftW, s.heightPx) },
      { shot: 's2', rect: rect(shotX + rightX, shotY, s.widthPx - rightX, s.heightPx) },
      { shot: 'ss', rect: rect(shotX, shotY + s.heightPx + s.gapPx, s.widthPx, s.heightPx) },
    );
  } else {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const across = s.stack === 'row' ? i * (s.widthPx + s.gapPx) : 0;
      const down = s.stack === 'column' ? i * (s.heightPx + s.gapPx) : 0;
      shots.push({
        shot: slot,
        rect: rect(shotX + across, shotY + down, s.widthPx, s.heightPx),
      });
    }
  }

  const ga = g.gauge;
  const gauge = rect(barX + ga.offsetX, barY + ga.offsetY, ga.widthPx, ga.heightPx);

  const mv = g.move;
  const moveLeft = rect(barX + mv.offsetX, barY + mv.offsetY, mv.widthPx, mv.heightPx);
  const moveRight = rect(
    moveLeft.x + mv.widthPx + mv.gapPx,
    moveLeft.y,
    mv.widthPx,
    mv.heightPx,
  );

  const p = g.power;
  const power = rect(barX + p.offsetX, barY + p.offsetY, p.width, p.height);

  const it = g.items;
  const items: Rect[] = [];
  for (let i = 0; i < it.count; i++) {
    items.push(
      rect(
        barX + it.offsetX + i * (it.sizePx + it.gapPx),
        barY + it.offsetY,
        it.sizePx,
        it.heightPx,
      ),
    );
  }

  const bt = g.buttons;
  const skip = rect(barX + bt.offsetX, barY + bt.skipY, bt.widthPx, bt.skipHeightPx);
  const fire = rect(barX + bt.offsetX, barY + bt.fireY, bt.widthPx, bt.fireHeightPx);

  const pt = g.portrait;
  const portrait = rect(barX + pt.offsetX, barY + pt.offsetY, pt.widthPx, pt.heightPx);

  const tg = g.toggles;
  const toggleY = belowOrderPanelY(variant);
  const toggleAt = (i: number): Rect =>
    rect(tg.x + i * (tg.sizePx + tg.gapPx), toggleY, tg.sizePx, tg.sizePx);
  const toggles: Record<ToggleName, Rect> = {
    mute: toggleAt(0),
    help: toggleAt(1),
    chat: toggleAt(2),
  };

  return {
    variant,
    view,
    bar,
    top: barY - b.tabRisePx,
    dial,
    dialCentreX: dial.x + dial.w / 2,
    dialCentreY: dial.y + d.radiusPx,
    angleUp,
    angleDown,
    shots,
    gauge,
    moveLeft,
    moveRight,
    power,
    items,
    fire,
    skip,
    portrait,
    nickX: barX + pt.offsetX + pt.widthPx + pt.gapPx,
    toggles,
    belowPanelsY: toggleY + tg.sizePx,
  };
}

/** Which widget is under a backbuffer-space point, if any. */
export function hudHitTest(layout: BottomBarLayout, x: number, y: number): HudTarget | null {
  // The toggles first: they are outside the bar and live at every phase of the match.
  if (inside(layout.toggles.mute, x, y)) return { kind: 'toggle', toggle: 'mute' };
  if (inside(layout.toggles.help, x, y)) return { kind: 'toggle', toggle: 'help' };
  if (inside(layout.toggles.chat, x, y)) return { kind: 'toggle', toggle: 'chat' };
  for (const button of layout.shots) {
    if (inside(button.rect, x, y)) return { kind: 'shot', shot: button.shot };
  }
  if (inside(layout.fire, x, y)) return { kind: 'fire' };
  if (inside(layout.skip, x, y)) return { kind: 'skip' };
  if (inside(layout.angleUp, x, y)) return { kind: 'angle', delta: 1 };
  if (inside(layout.angleDown, x, y)) return { kind: 'angle', delta: -1 };
  if (inside(layout.moveLeft, x, y)) return { kind: 'move', dir: -1 };
  if (inside(layout.moveRight, x, y)) return { kind: 'move', dir: 1 };
  for (let i = 0; i < layout.items.length; i++) {
    const r = layout.items[i];
    if (r && inside(r, x, y)) return { kind: 'item', index: i };
  }
  // Last, so the drag pad can never shadow a button: the dial's block also carries the
  // REL / TRUE readout, and every other widget was offered this point first.
  if (inside(layout.dial, x, y)) return { kind: 'aim' };
  return null;
}

/** True while the pointer is over the bar itself, so a drag must not pan the camera. */
export function isOverBar(layout: BottomBarLayout, x: number, y: number): boolean {
  return inside(layout.bar, x, y);
}

/**
 * The bounding box of the toggle row (mute, controls, chat), gaps included.
 *
 * The three keys are 47 px squares 6 px apart in the compact variant, and a thumb that
 * lands in one of those gaps misses {@link hudHitTest}. Treated as one block it is a
 * press that did nothing rather than a press that panned the board.
 */
function toggleRow(layout: BottomBarLayout): Rect {
  const first = layout.toggles.mute;
  const last = layout.toggles.chat;
  return rect(first.x, first.y, last.x + last.w - first.x, first.h);
}

/**
 * Is this point on HUD furniture, so a press on it must not start a camera drag?
 *
 * The bar is the obvious part; the toggle row is the rest of it. Everything else drawn
 * over the world — the player list, the top cluster, the net badge — is a label, and
 * dragging the board from behind one of those is fine.
 */
export function hudBlocksDrag(layout: BottomBarLayout, x: number, y: number): boolean {
  return isOverBar(layout, x, y) || inside(toggleRow(layout), x, y);
}

/**
 * The read-only cluster at top centre (`hud.top`): the timer plate, the wind plate and
 * the strength plate on one row, and the status tag's top under them. Pure, so the
 * notice stack's clearance can be asserted.
 */
export function topClusterLayout(view: ViewSize): {
  timer: Rect;
  plate: Rect;
  strength: Rect;
  tagY: number;
} {
  const t = hud.top;
  const cx = Math.round(view.width / 2);
  const plate = rect(cx - t.plateSizePx / 2, t.y, t.plateSizePx, t.plateSizePx);
  const sideY = t.y + Math.round((t.plateSizePx - t.sideHeightPx) / 2);
  return {
    timer: rect(plate.x - t.gapPx - t.sideWidthPx, sideY, t.sideWidthPx, t.sideHeightPx),
    plate,
    strength: rect(plate.x + plate.w + t.gapPx, sideY, t.sideWidthPx, t.sideHeightPx),
    tagY: plate.y + plate.h + t.tagGapPx,
  };
}

/**
 * Where the turn banner is in its life: dropping in, holding, fading. Null once it has
 * gone (or before a turn has started), which is when the status tag takes over.
 *
 * Pure and exported for the tests: a banner that never leaves is the one thing this
 * rework exists to prevent, and a screenshot cannot show the frame it should have gone.
 */
export function turnBannerPose(age: number): { alpha: number; dy: number } | null {
  const b = hud.banner;
  if (!(age >= 0)) return null;
  if (age < b.inFrames) {
    const t = age / b.inFrames;
    return { alpha: t, dy: -Math.round((1 - t) * b.dropPx) };
  }
  if (age < b.inFrames + b.holdFrames) return { alpha: 1, dy: 0 };
  const out = age - b.inFrames - b.holdFrames;
  if (out >= b.outFrames) return null;
  return { alpha: 1 - out / b.outFrames, dy: 0 };
}

// --------------------------------------------------------------------------
// The fallback skin: bevelled plates and rivets (docs/ART.md)
// --------------------------------------------------------------------------

/**
 * One rivet: a 2 px dome with a lit pixel in its top left and a shadow under it. Only
 * the fallback plates use it now; the kit's frames carry their own.
 */
function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = skin.rivetShade;
  ctx.fillRect(x, y + 1, 2, 2);
  ctx.fillStyle = skin.rivet;
  ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = skin.rivetLight;
  ctx.fillRect(x, y, 1, 1);
}

export interface PlateStyle {
  /** The face colour; the top band is drawn in `faceTop` above it. */
  face?: string;
  faceTop?: string;
  outline?: string;
  /** Bevel: light along the top and left, dark along the bottom and right. */
  light?: string;
  dark?: string;
  /** Swap the two bevel edges, which turns a raised plate into a hole. */
  recessed?: boolean;
  /** Rivet the four corners (raised plates only — a hole has nothing to bolt). */
  rivets?: boolean;
  /** Fraction of the height the lighter top band covers. */
  topBand?: number;
}

/**
 * A bevelled plate: 1 px near-black outline, a lit edge along the top and left, a dark
 * edge along the bottom and right, and a two-band face lit from above. It is what every
 * kit frame falls back to while the atlas is loading.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  style: PlateStyle = {},
): void {
  if (w < 3 || h < 3) return;
  const ix = Math.round(x);
  const iy = Math.round(y);
  const iw = Math.round(w);
  const ih = Math.round(h);
  const light = style.recessed ? (style.dark ?? skin.bevelDark) : (style.light ?? skin.bevelLight);
  const dark = style.recessed ? (style.light ?? skin.bevelLight) : (style.dark ?? skin.bevelDark);

  ctx.fillStyle = style.outline ?? skin.outline;
  ctx.fillRect(ix, iy, iw, ih);

  ctx.fillStyle = style.face ?? skin.face;
  ctx.fillRect(ix + 1, iy + 1, iw - 2, ih - 2);
  const band = Math.max(1, Math.round((ih - 2) * (style.topBand ?? 0.42)));
  ctx.fillStyle = style.faceTop ?? skin.faceTop;
  ctx.fillRect(ix + 1, iy + 1, iw - 2, band);

  ctx.fillStyle = light;
  ctx.fillRect(ix + 1, iy + 1, iw - 2, 1);
  ctx.fillRect(ix + 1, iy + 1, 1, ih - 2);
  ctx.fillStyle = dark;
  ctx.fillRect(ix + 1, iy + ih - 2, iw - 2, 1);
  ctx.fillRect(ix + iw - 2, iy + 1, 1, ih - 2);

  if (style.rivets && iw >= 12 && ih >= 12) {
    const i = skin.rivetInsetPx;
    drawRivet(ctx, ix + i, iy + i);
    drawRivet(ctx, ix + iw - i - 2, iy + i);
    drawRivet(ctx, ix + i, iy + ih - i - 2);
    drawRivet(ctx, ix + iw - i - 2, iy + ih - i - 2);
  }
}

/**
 * A translucent panel with a 1 px edge.
 *
 * Kept for the plain rectangle a caller outside this module may still want behind a
 * block of text, and because its signature is part of the module's published surface.
 */
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = hud.panel,
  edge = hud.panelEdge,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** The plate a kit frame is replaced by until the atlas is in, per family of piece. */
function fallbackStyle(piece: NinePiece): PlateStyle {
  const state = piece.slice(piece.indexOf('/') + 1);
  if (piece.startsWith('button-gold/')) {
    if (state === 'disabled') return { face: '#5b6068', faceTop: '#6b7078' };
    return {
      face: '#c9831c',
      faceTop: state === 'hover' ? '#ffc94a' : '#f0a830',
      light: '#ffd23f',
      dark: '#6b3d0b',
      recessed: state === 'pressed',
    };
  }
  if (piece.startsWith('button/')) {
    if (state === 'disabled') return { face: '#4b525c', faceTop: '#5b636e' };
    return {
      face: '#2f5d9a',
      faceTop: state === 'hover' ? '#5a92d8' : '#4a7fc4',
      light: '#8fc0ff',
      dark: '#15294a',
      recessed: state === 'pressed',
    };
  }
  if (piece.startsWith('card/') || piece.startsWith('slot/')) {
    const lit = state === 'selected' || state === 'active' ? hud.accent : undefined;
    const light = lit ?? (state === 'hover' ? hud.teamA : state === 'filled' ? hud.good : undefined);
    return {
      face: skin.recess,
      faceTop: skin.recessTop,
      light,
      recessed: state === 'used' || state === 'locked' || state === 'empty',
    };
  }
  if (piece === 'trough' || piece === 'trough-small' || piece === 'recess') {
    return { face: skin.recess, faceTop: skin.recessTop, recessed: true, topBand: 0.3 };
  }
  if (piece === 'banner/gold' || piece === 'frame-gold') {
    return { face: hud.panel, faceTop: '#22331f', light: hud.accent, rivets: true };
  }
  if (piece === 'panel-dark') return { face: hud.panel, faceTop: 'rgba(24, 33, 45, 0.86)' };
  if (piece === 'panel-bar') return { face: hud.bar.back, faceTop: hud.bar.backTop, topBand: 0.12 };
  return { rivets: true };
}

/** A kit nine-slice frame, or its fallback plate. `frame-gold` falls back to an edge. */
function nine(
  ctx: CanvasRenderingContext2D,
  piece: NinePiece,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
): void {
  if (drawNineSlice(ctx, piece, x, y, w, h, scale)) return;
  if (piece === 'frame-gold') {
    ctx.strokeStyle = hud.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
    ctx.lineWidth = 1;
    return;
  }
  drawPlate(ctx, x, y, w, h, fallbackStyle(piece));
}

/** The flat colour a kit fill falls back to. */
const FILL_FALLBACK: Record<FillColour, string> = {
  amber: '#ffb238',
  cyan: '#6fd1ff',
  green: '#7cc45a',
  red: '#ff5a3c',
  violet: '#a47cff',
};

/**
 * The two kit troughs, and where their fill sits inside them at 1x (docs/ART.md §12:
 * the big fill is 8 px tall at +4, +4 in a 16 px trough).
 */
const TROUGHS = {
  trough: { h: 16, insetX: 4, insetY: 4, fillH: 8, small: false },
  'trough-small': { h: 8, insetX: 3, insetY: 2, fillH: 4, small: true },
} as const;

/**
 * A trough with a fill `fraction` of the way along it, drawn at the whole scale that
 * makes the kit piece `r.h` tall. Returns the fill's channel, for ticks and markers.
 */
function drawTrough(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  which: keyof typeof TROUGHS,
  colour: FillColour,
  fraction: number,
): Rect {
  const t = TROUGHS[which];
  const scale = Math.max(1, Math.round(r.h / t.h));
  nine(ctx, which, r.x, r.y, r.w, r.h, scale);
  const channel = rect(
    r.x + t.insetX * scale,
    r.y + t.insetY * scale,
    r.w - t.insetX * 2 * scale,
    t.fillH * scale,
  );
  const w = Math.round(channel.w * Math.max(0, Math.min(1, fraction)));
  if (w > 0) {
    const piece = t.small ? (`fill-small/${colour}` as const) : (`fill/${colour}` as const);
    if (!drawBar(ctx, piece, channel.x, channel.y, w, scale)) {
      ctx.fillStyle = FILL_FALLBACK[colour];
      ctx.fillRect(channel.x, channel.y, w, channel.h);
    }
  }
  return channel;
}

/**
 * A kit icon centred on `cx, cy`, or the hand-drawn 12 px icon of the same thing before
 * the atlas is in. `alpha` below 1 is how a spent or disabled icon is drawn.
 */
function kitIcon(
  ctx: CanvasRenderingContext2D,
  piece: IconPiece,
  fallback: IconName | null,
  cx: number,
  cy: number,
  scale = 1,
  alpha = 1,
): void {
  const before = ctx.globalAlpha;
  ctx.globalAlpha = before * alpha;
  if (!drawUiPieceAt(ctx, piece, cx, cy, scale) && fallback) {
    drawIconCentred(ctx, fallback, cx, cy, scale);
  }
  ctx.globalAlpha = before;
}

/**
 * A panel in the read-only idiom: the kit's dark plate the furniture (notices, help
 * card, debug readout) sits on. `edge` adds a coloured 1 px frame inside it, because
 * "this one matters" is worth an edge colour.
 */
function drawSkinPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  edge?: string,
): void {
  nine(ctx, 'panel-dark', x, y, w, h);
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 1.5, Math.round(y) + 1.5, Math.round(w) - 3, Math.round(h) - 3);
  }
}

/** Left-aligned block of lines inside a panel. Returns the height it used. */
export function drawTextPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lines: string[],
  width = 0,
): number {
  const lineHeight = hud.lineHeightPx;
  const padding = hud.paddingPx;
  ctx.font = hud.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let w = width;
  if (w <= 0) {
    for (const line of lines) w = Math.max(w, Math.ceil(ctx.measureText(line).width));
    w += padding * 2;
  }
  const h = lines.length * lineHeight + padding * 2;
  drawSkinPanel(ctx, x, y, w, h);
  ctx.fillStyle = hud.fg;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i] as string, x + padding, y + padding + i * lineHeight);
  }
  ctx.textBaseline = 'alphabetic';
  return h;
}

/**
 * Client-authored text in the pixel font. Player-authored text (nicknames, chat) must
 * not come through here: {@link hasGlyphs} is false for most of the world's alphabets
 * and a glyph this font lacks is drawn as nothing at all.
 */
function pixel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: 'left' | 'center' | 'right' = 'left',
  scale = 1,
): number {
  return drawPixelText(ctx, text, x, y, { color, scale, align });
}

function textAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
  font: string = hud.font,
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

/**
 * A player's name: in the pixel font at `scale` when it can spell it, otherwise in the
 * canvas font, cut to `maxW`. Returns the width it took.
 */
function nickAt(
  ctx: CanvasRenderingContext2D,
  nick: string,
  x: number,
  y: number,
  color: string,
  maxW: number,
  scale = 1,
  align: 'left' | 'center' = 'left',
): number {
  const upper = nick.toUpperCase();
  if (hasGlyphs(upper)) {
    const text = fitPixelText(upper, maxW, scale);
    return pixel(ctx, text, x, y, color, align, scale);
  }
  ctx.font = hud.font;
  const text = fitText(ctx, nick, maxW);
  textAt(ctx, text, x, y - 2, color, align);
  return Math.ceil(ctx.measureText(text).width);
}

function teamColor(team: TeamId): string {
  return team === 'A' ? hud.teamA : hud.teamB;
}

/** `text` cut down (with no ellipsis: at 10 px there is no room for one) to fit `w`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, w: number): string {
  if (ctx.measureText(text).width <= w) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut).width > w) cut = cut.slice(0, -1);
  return cut;
}

/**
 * The largest scale up to `preferred` at which `text` still fits in `w`, or 0 when even
 * the smallest one does not. The short-view HUD asks for scale 2 everywhere and takes
 * scale 1 back for the few labels that are too long for it, which is how one geometry
 * covers both "VULCAN" and "BIG FOOT SALVO".
 */
function fittingScale(text: string, w: number, preferred: number): number {
  for (let scale = Math.max(1, Math.round(preferred)); scale >= 1; scale--) {
    if (pixelTextWidth(text, scale) <= w) return scale;
  }
  return 0;
}

/** The same, for the pixel font, whose width is arithmetic rather than a measurement. */
function fitPixelText(text: string, w: number, scale = 1): string {
  if (pixelTextWidth(text, scale) <= w) return text;
  let cut = text;
  while (cut.length > 1 && pixelTextWidth(cut, scale) > w) cut = cut.slice(0, -1);
  return cut;
}

/** Client text that may carry a nick: the pixel font if it can, the canvas font if not. */
function captionAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  color: string,
  preferredScale: number,
  align: 'left' | 'center' = 'left',
): void {
  const upper = text.toUpperCase();
  const scale = fittingScale(upper, w, preferredScale);
  if (hasGlyphs(upper) && scale > 0) {
    pixel(ctx, upper, x, y, color, align, scale);
    return;
  }
  ctx.font = hud.font;
  textAt(ctx, fitText(ctx, text, w), x, y - 2, color, align);
}

/** Is this HUD target the one the mouse is resting on? */
function hovering(view: BottomBarView, test: (t: HudTarget) => boolean): boolean {
  return view.hover !== null && test(view.hover);
}

/** The kit state of a key: disabled, held down, under the mouse, or at rest. */
function keyState(enabled: boolean, pressed: boolean, hovered: boolean): ButtonState {
  if (!enabled) return 'disabled';
  if (pressed) return 'pressed';
  return hovered ? 'hover' : 'normal';
}

// --------------------------------------------------------------------------
// Bottom bar
// --------------------------------------------------------------------------

/** The range arc: a band `width` px thick at `radius`, one pixel per step of arc. */
function rangeArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  fromDeg: number,
  toDeg: number,
  color: string,
): void {
  const lo = Math.min(fromDeg, toDeg);
  const hi = Math.max(fromDeg, toDeg);
  const step = Math.max(0.5, 50 / Math.max(1, radius));
  ctx.fillStyle = color;
  for (let a = lo; a <= hi + 1e-6; a += step) {
    const ux = cosDeg(Math.min(a, hi));
    const uy = -sinDeg(Math.min(a, hi));
    for (let t = 0; t < width; t++) {
      ctx.fillRect(Math.round(cx + ux * (radius + t)), Math.round(cy + uy * (radius + t)), 1, 1);
    }
  }
}

/** A straight line from `r0` to `r1` along an angle, `thick` px wide, pixel-snapped. */
function radial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  deg: number,
  r0: number,
  r1: number,
  color: string,
  thick: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.beginPath();
  ctx.moveTo(Math.round(cx + cosDeg(deg) * r0) + 0.5, Math.round(cy - sinDeg(deg) * r0) + 0.5);
  ctx.lineTo(Math.round(cx + cosDeg(deg) * r1) + 0.5, Math.round(cy - sinDeg(deg) * r1) + 0.5);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawAngleDial(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: BottomBarView,
): void {
  const d = GEOMETRY[layout.variant].dial;
  const cx = Math.round(layout.dialCentreX);
  const cy = Math.round(layout.dialCentreY);

  // The kit face is only the face (ticks and bezel); the range, the hull and the needle
  // are this mobile's, so they are drawn over it.
  if (!drawUiPieceAt(ctx, d.piece, cx, cy)) {
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, d.radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = skin.bevelLight;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, d.radiusPx - 3, 0, Math.PI * 2);
    ctx.fillStyle = d.face;
    ctx.fill();
  }
  if (view.aimActive) {
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, d.radiusPx - 4, 0, Math.PI * 2);
    ctx.fillStyle = d.faceActive;
    ctx.fill();
  }

  // The mobile's aim range, in world angles, with its two limits ticked.
  rangeArc(ctx, cx, cy, d.arcRadiusPx, d.arcWidthPx, view.rangeFromDeg, view.rangeToDeg, d.range);
  for (const end of [view.rangeFromDeg, view.rangeToDeg]) {
    radial(ctx, cx, cy, end, d.arcRadiusPx - 2, d.arcRadiusPx + d.arcWidthPx + 1, d.rangeEnd, 1);
  }
  // The hull line at the current tilt, so a tilted mobile's range reads as tilted.
  radial(ctx, cx, cy, view.tiltDeg, 0, d.hullHalfPx, d.hull, 1);
  radial(ctx, cx, cy, view.tiltDeg + 180, 0, d.hullHalfPx, d.hull, 1);

  // Needle at the true angle: outlined, so it reads over the ticks and the arc.
  radial(ctx, cx, cy, view.trueAngle, d.needleFromPx, d.needlePx, skin.outline, 3);
  radial(ctx, cx, cy, view.trueAngle, d.needleFromPx, d.needlePx, d.needle, 1);
  if (!drawUiPieceAt(ctx, 'dial-hub', cx, cy)) {
    ctx.fillStyle = skin.outline;
    ctx.fillRect(cx - 2, cy - 2, 5, 5);
    ctx.fillStyle = hud.accent;
    ctx.fillRect(cx - 1, cy - 1, 3, 3);
  }

  // REL is the number a player aims with, so it is the big one; TRUE sits beside it
  // (or under it on a phone, where REL is three times the font).
  const top = layout.dial.y + d.readoutTopPx;
  const rel = view.relAngle.toFixed(1);
  const relColor = view.aimActive ? hud.fg : hud.accent;
  pixel(ctx, rel, layout.dial.x + 1, top, relColor, 'left', d.relScale);
  const trueText = view.trueAngle.toFixed(1);
  const right = layout.dial.x + layout.dial.w - 1;
  if (d.trueBelow) {
    const y = top + 5 * d.relScale + 4;
    pixel(ctx, 'TRUE', layout.dial.x + 1, y + Math.round((5 * d.trueScale - 5) / 2), hud.muted);
    pixel(ctx, trueText, right, y, hud.fg, 'right', d.trueScale);
  } else {
    pixel(ctx, 'TRUE', right, top - 1, hud.muted, 'right');
    pixel(ctx, trueText, right, top + 6, hud.fg, 'right', d.trueScale);
  }

  // Dragging the dial puts the number where the thumb is not: on a plate *above* the
  // bar, because the finger doing the dragging is covering the dial itself.
  if (view.aimActive) {
    const scale = d.dragLabelScale;
    // No degree sign: the pixel font has no glyph for one.
    const w = pixelTextWidth(rel, scale) + d.dragLabelPadPx * 2 + 8;
    const h = 5 * scale + d.dragLabelPadPx * 2 + 4;
    const x = Math.round(layout.dial.x);
    const y = layout.bar.y - d.dragLabelGapPx - h;
    drawSkinPanel(ctx, x, y, w, h, hud.accent);
    pixel(ctx, rel, x + d.dragLabelPadPx + 4, y + d.dragLabelPadPx + 2, hud.accent, 'left', scale);
  }
}

type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/** A blue gem key with a pixel triangle on it: the angle and walk arrows. */
function drawArrowButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  direction: ArrowDirection,
  state: ButtonState,
  glyphScale = 1,
): void {
  nine(ctx, `button/${state}`, r.x, r.y, r.w, r.h);
  // A held key is pressed *in*: the glyph moves a pixel down with the face.
  const push = state === 'pressed' ? 1 : 0;
  const cx = Math.round(r.x + r.w / 2);
  const cy = Math.round(r.y + r.h / 2) + push;
  // A 7 px pixel triangle with its own outline, drawn line by line so it stays crisp.
  // `glyphScale` blows the same shape up for the big keys of the short-view HUD.
  const s = Math.max(1, Math.round(glyphScale));
  // The outline (`grow` 1) runs one row past the fill's widest row and repeats that
  // width there, so the base is closed as well as the two sides.
  const paint = (color: string, grow: number): void => {
    ctx.fillStyle = color;
    for (let i = 0; i < 4 + grow * 2; i++) {
      const size = 1 + Math.min(i, 3 + grow) * 2 + grow * 2;
      const half = Math.floor(size / 2);
      if (direction === 'up') ctx.fillRect(cx - half * s, cy + (-2 - grow + i) * s, size * s, s);
      else if (direction === 'down') ctx.fillRect(cx - half * s, cy + (2 + grow - i) * s, size * s, s);
      else if (direction === 'left') ctx.fillRect(cx + (-2 - grow + i) * s, cy - half * s, s, size * s);
      else ctx.fillRect(cx + (2 + grow - i) * s, cy - half * s, s, size * s);
    }
  };
  paint(skin.outline, 1);
  paint(state === 'disabled' ? hud.disabledInk : hud.buttons.skipInk, 0);
}

/**
 * S1 / S2 / SS as weapon cards (DESIGN §2.9). Selected is the gold card, a locked SS
 * the dark one with its gauge count, the one under the mouse the blue one. SS carries
 * its gauge as a small bar inside the card.
 */
function drawShotCards(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: BottomBarView,
): void {
  const s = GEOMETRY[layout.variant].shots;
  for (let i = 0; i < layout.shots.length; i++) {
    const button = layout.shots[i];
    const shotView = view.shots[i];
    if (!button || !shotView) continue;
    const r = button.rect;
    const locked = !shotView.available;
    const hovered =
      view.enabled && hovering(view, (t) => t.kind === 'shot' && t.shot === shotView.shot);
    const state: CardState = locked
      ? 'locked'
      : shotView.selected
        ? 'selected'
        : hovered
          ? 'hover'
          : 'normal';
    nine(ctx, `card/${state}`, r.x, r.y, r.w, r.h);

    const key = shotView.shot.toUpperCase();
    const keyColor = locked ? s.locked : shotView.selected ? s.keySelected : s.key;
    const iconAlpha = locked ? 0.45 : 1;
    // SS gauge along the foot of the card (DESIGN §2.9, §7 item 1): violet filling,
    // amber once it is full.
    const gauge = (x: number, y: number, w: number): void => {
      if (shotView.shot !== 'ss') return;
      drawTrough(ctx, rect(x, y, w, 8), 'trough-small', shotView.ready ? 'amber' : 'violet', shotView.gauge);
    };

    // The grid's S1 and S2 are upright cards; its SS is a wide one.
    const upright = s.stack === 'row' || (s.stack === 'grid' && shotView.shot !== 'ss');
    if (upright) {
      kitIcon(ctx, `shot/${shotView.shot}`, shotView.shot, r.x + r.w / 2, r.y + s.iconCentreY, s.iconScale, iconAlpha);
      // A locked SS says how far off it is where its key would be.
      const label = locked && shotView.gaugeText.length > 0 ? shotView.gaugeText : key;
      const labelScale = fittingScale(label, r.w - 8, s.keyScale) || 1;
      pixel(ctx, label, r.x + r.w / 2, r.y + s.keyTopPx, locked ? s.lockedCount : keyColor, 'center', labelScale);
      gauge(r.x + s.gaugeInsetPx, r.y + r.h - s.gaugeBottomPx - 8, r.w - s.gaugeInsetPx * 2);
      continue;
    }

    // A wide card: icon, key, then the name right-aligned in whatever room is left.
    kitIcon(ctx, `shot/${shotView.shot}`, shotView.shot, r.x + s.iconCentreX, r.y + r.h / 2, s.iconScale, iconAlpha);
    const textY = r.y + Math.round((r.h - 5 * s.keyScale) / 2) - (shotView.shot === 'ss' ? 3 : 0);
    let left = r.x + s.textX + pixel(ctx, key, r.x + s.textX, textY, keyColor, 'left', s.keyScale) + 5;
    if (locked && shotView.gaugeText.length > 0) {
      left += pixel(ctx, shotView.gaugeText, left, textY + 5 * s.keyScale - 5, s.lockedCount) + 5;
    }
    const name = shotView.name.toUpperCase();
    const room = r.x + r.w - 7 - left;
    const scale = fittingScale(name, room, s.nameScale);
    const nameColor = locked ? s.locked : shotView.selected ? hud.fg : hud.muted;
    if (hasGlyphs(name) && scale > 0) {
      pixel(ctx, name, r.x + r.w - 7, textY + 5 * s.keyScale - 5 * scale, nameColor, 'right', scale);
    }
    gauge(r.x + s.textX, r.y + r.h - 12, r.w - s.textX - 7);
  }

  // Upright cards have no room for a name, so the selected one is printed under them
  // (the grid has no room under them either: its name is on the owner tab).
  if (s.stack === 'row') {
    const first = layout.shots[0]?.rect;
    const last = layout.shots[layout.shots.length - 1]?.rect;
    const selected = view.shots.find((v) => v.selected);
    if (first && last && selected) {
      const w = last.x + last.w - first.x;
      captionAt(
        ctx,
        selected.name,
        first.x + w / 2,
        first.y + first.h + s.captionGapPx,
        w,
        hud.fg,
        s.captionScale,
        'center',
      );
    }
  }
}

/**
 * The power bar (DESIGN §2.10): the kit trough at 2x, amber while charging and red past
 * `hotFrom`, flashing once it is pinned at maximum; the 4 major bars of 5 minor ticks
 * over it; and the marker sprite at the previous shot's power, with a line dropped
 * through the fill so the two can be lined up by eye.
 */
export function drawPowerBar(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  view: BottomBarView,
  variant: HudVariant = 'full',
): void {
  const p = GEOMETRY[variant].power;
  const value = Math.max(0, Math.min(1, view.power));
  let colour: FillColour = value >= p.hotFrom ? 'red' : 'amber';
  const flashing = view.charging && value >= 1;
  if (flashing && Math.floor(view.frameTick / p.maxFlashTicks) % 2 === 0) colour = 'amber';
  const channel = drawTrough(ctx, r, 'trough', colour, value);
  const scale = Math.max(1, Math.round(r.h / TROUGHS.trough.h));

  const filled = Math.round(channel.w * value);
  if (filled > 0) {
    // A bright leading edge: the eye lands on the tip.
    ctx.fillStyle = p.maxFlash;
    ctx.fillRect(channel.x + filled - scale, channel.y, scale, channel.h);
  }

  // The scale: a short dark tick at every minor division, a full-height lit gutter at
  // every major one. Drawn over the fill too, so power reads as a count of chunks.
  const majors = constants.power.majorBars;
  const total = majors * constants.power.minorTicksPerBar;
  for (let i = 1; i < total; i++) {
    const x = Math.round(channel.x + (channel.w * i) / total);
    if (i % constants.power.minorTicksPerBar === 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(x - 1, channel.y, 1, channel.h);
      ctx.fillStyle = p.majorTick;
      ctx.fillRect(x, channel.y, 1, channel.h);
    } else {
      ctx.fillStyle = p.minorTick;
      ctx.fillRect(x, channel.y + channel.h - 2 * scale, 1, 2 * scale);
    }
  }

  if (view.previousPower !== null && view.previousPower >= 0) {
    const mx = Math.round(channel.x + channel.w * Math.max(0, Math.min(1, view.previousPower)));
    ctx.fillStyle = skin.outline;
    ctx.fillRect(mx - 1, channel.y, 3, channel.h);
    ctx.fillStyle = p.markerLine;
    ctx.fillRect(mx, channel.y, 1, channel.h);
    // The marker's tip is its pivot: it rests on the channel's top edge.
    const tipY = channel.y + 1;
    if (!drawUiPieceAt(ctx, 'power-marker', mx, tipY, p.markerScale)) {
      ctx.fillStyle = p.marker;
      for (let i = 0; i < 5; i++) ctx.fillRect(mx - 4 + i, tipY - 5 + i, 9 - i * 2, 1);
    }
  }

  if (view.charging) {
    // A pulsing outline is the cheapest "you are charging" signal that survives the
    // 800x600 downscale.
    const phase = (view.frameTick % p.chargePulseTicks) / p.chargePulseTicks;
    ctx.globalAlpha = 0.35 + 0.65 * (phase < 0.5 ? phase * 2 : 2 - phase * 2);
    ctx.strokeStyle = p.chargeGlow;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
    ctx.globalAlpha = 1;
  }
}

/**
 * The two numbers that go with the power bar: the power now (in the accent while it is
 * charging) and the last shot's, in the marker's colour. Under the bar on a desktop,
 * beside the walk keys on a phone.
 */
function drawPowerReadout(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: BottomBarView,
): void {
  const g = GEOMETRY[layout.variant];
  const p = g.power;
  const now = `${Math.round(view.power * 100)}%`;
  const nowColor = view.charging ? hud.accent : hud.fg;
  const last = view.previousPower === null ? '--' : `${Math.round(view.previousPower * 100)}%`;
  if (p.readoutBeside) {
    const x = layout.power.x + p.readoutBesideX;
    const y = layout.moveLeft.y;
    const ls = p.besideLabelScale;
    const lastTop = y + 5 * p.valueScale + 6;
    pixel(ctx, now, x, y + 2, nowColor, 'left', p.valueScale);
    pixel(ctx, 'LAST', x, lastTop, hud.bar.label, 'left', ls);
    pixel(ctx, last, x, lastTop + 5 * ls + 3, p.marker, 'left', 2);
    return;
  }
  const y = layout.power.y + layout.power.h + p.readoutGapPx;
  const vy = y + 1;
  let x = layout.power.x + 2;
  if (g.bar.labels) x += pixel(ctx, 'POWER', x, vy + 5 * p.valueScale - 5, hud.bar.label) + 4;
  pixel(ctx, now, x, vy, nowColor, 'left', p.valueScale);
  const right = layout.power.x + layout.power.w - 2;
  const lastW = pixel(ctx, last, right, vy, p.marker, 'right', p.valueScale);
  pixel(ctx, 'LAST', right - lastW - 4, vy + 5 * p.valueScale - 5, hud.bar.label, 'right');
}

/** The walk gauge: the small kit trough, cyan, red when nearly spent, in quarters. */
function drawMoveGauge(ctx: CanvasRenderingContext2D, r: Rect, view: BottomBarView): void {
  const g = hud.gauge;
  const ratio = view.moveGaugeMax > 0 ? view.moveGauge / view.moveGaugeMax : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const channel = drawTrough(ctx, r, 'trough-small', clamped <= g.lowFraction ? 'red' : 'cyan', clamped);
  // Quarter marks, so "half a tank" is a position rather than a guess.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  for (let i = 1; i < 4; i++) {
    ctx.fillRect(Math.round(channel.x + (channel.w * i) / 4), channel.y, 1, channel.h);
  }
}

/**
 * The rectangle a slot view covers: its own, widened over the slot beside it when the
 * item takes two (DESIGN §4 — Dual, Dual+ and the Med Kit each cost two of the six).
 */
function itemRect(layout: BottomBarLayout, view: ItemSlotView): Rect | null {
  const first = layout.items[view.index];
  if (!first) return null;
  const last = layout.items[Math.min(view.index + view.span - 1, layout.items.length - 1)];
  if (!last) return first;
  return rect(first.x, first.y, last.x + last.w - first.x, first.h);
}

/**
 * Item display name to id. The HUD is handed a `displayName` (the view objects stay
 * free of the item table), so the map is built once from the table itself rather than
 * hard-coded here — a renamed item keeps its picture.
 */
const itemIdByName = ((): Map<string, ItemId> => {
  const map = new Map<string, ItemId>();
  for (const def of itemDefs) map.set(def.displayName.toUpperCase(), def.id);
  return map;
})();

/**
 * The six item slots (DESIGN §4) in the kit's slot frames: an empty slot is the dark
 * hole, a filled one the green-rimmed key with the item's icon and short name, a spent
 * one greyed and struck through, and the one waiting for a teleport target blinks gold.
 */
function drawItemSlots(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: ItemRowView,
): void {
  const it = GEOMETRY[layout.variant].items;
  const covered = new Set<number>();
  for (const slot of view.slots) {
    for (let k = 0; k < slot.span; k++) covered.add(slot.index + k);
  }

  // Empty slots first, so a spanning item always draws over its own rectangles.
  for (let i = 0; i < layout.items.length; i++) {
    const r = layout.items[i];
    if (!r || covered.has(i)) continue;
    nine(ctx, 'slot/empty', r.x, r.y, r.w, r.h);
    if (it.keyLabels) pixel(ctx, `${i + 1}`, r.x + it.keyInsetPx, r.y + it.keyInsetPx, hud.dim);
  }

  for (const slot of view.slots) {
    const r = itemRect(layout, slot);
    if (!r) continue;
    const blink = Math.floor(view.frameTick / it.blinkTicks) % 2 === 0;
    const flashing = slot.flashFrames >= 0 && slot.flashFrames < it.flashFrames;
    let state: SlotState = slot.used ? 'used' : 'filled';
    if (slot.targeting ? blink : flashing) state = 'active';
    nine(ctx, `slot/${state}`, r.x, r.y, r.w, r.h);

    const id = itemIdByName.get(slot.name.toUpperCase());
    if (id) {
      kitIcon(
        ctx,
        `item/${id}`,
        itemIconName(id),
        r.x + r.w / 2,
        r.y + it.iconCentreY,
        it.iconScale,
        slot.used ? 0.3 : slot.enabled ? 1 : 0.6,
      );
    }

    // The keys that fire this slot: "3" for one slot, "1-2" for a spanning item. A
    // phone has no number keys, so the short variant leaves them off.
    if (it.keyLabels) {
      const keys =
        slot.span > 1 ? `${slot.index + 1}-${slot.index + slot.span}` : `${slot.index + 1}`;
      pixel(
        ctx,
        keys,
        r.x + it.keyInsetPx,
        r.y + it.keyInsetPx,
        slot.used ? it.usedName : flashing ? it.flash : it.key,
      );
    }

    const nameColor = slot.used ? it.usedName : slot.enabled ? it.name : hud.muted;
    // A cell this narrow cuts "TELEPORT" to "TELEPO", which reads as a bug. Fall back
    // to the item's short label before falling back to chopping letters off.
    const room = r.w - it.namePadPx * 2;
    const full = slot.name.toUpperCase();
    const label =
      pixelTextWidth(full, it.nameScale) <= room ? full : shortItemName(slot.name).toUpperCase();
    const scale = Math.max(1, fittingScale(label, room, it.nameScale));
    const name = fitPixelText(label, room, scale);
    pixel(ctx, name, r.x + r.w / 2, r.y + it.nameTopPx, nameColor, 'center', scale);

    if (slot.used) {
      ctx.fillStyle = it.usedStrike;
      ctx.fillRect(r.x + 4, Math.round(r.y + r.h / 2), r.w - 8, 1);
    }
  }

  const first = layout.items[0];
  const last = layout.items[layout.items.length - 1];
  if (first && last) {
    captionAt(
      ctx,
      view.caption,
      first.x + 1,
      first.y + first.h + it.captionGapPx,
      last.x + last.w - first.x,
      view.captionWarn ? hud.warn : hud.muted,
      it.captionScale,
    );
  }
}

function drawActionButtons(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: BottomBarView,
): void {
  const b = GEOMETRY[layout.variant].buttons;
  const skip = layout.skip;
  const skipState = keyState(view.enabled, false, hovering(view, (t) => t.kind === 'skip'));
  nine(ctx, `button/${skipState}`, skip.x, skip.y, skip.w, skip.h);
  pixel(
    ctx,
    'SKIP',
    skip.x + skip.w / 2,
    skip.y + b.skipLabelTopPx,
    view.enabled ? b.skipInk : hud.disabledInk,
    'center',
    2,
  );

  const held = view.firePressed || view.charging;
  const fire = layout.fire;
  const fireState = keyState(view.enabled || view.charging, held, hovering(view, (t) => t.kind === 'fire'));
  nine(ctx, `button-gold/${fireState}`, fire.x, fire.y, fire.w, fire.h);
  const push = fireState === 'pressed' ? 1 : 0;

  // The charge, under the finger (DESIGN §7 item 147). The bar in the middle of the HUD
  // is the precise one; this is the one the thumb is *on*, and it is the only feedback
  // a player gets while their hand covers the rest of the key: the face fills from the
  // bottom, and the HOLD label becomes the percentage.
  if (view.charging) {
    const level = Math.max(0, Math.min(1, view.power));
    const innerX = fire.x + 3;
    const innerW = fire.w - 6;
    const innerBottom = fire.y + fire.h - 4;
    const h = Math.round((fire.h - 7) * level);
    ctx.fillStyle = b.chargeFill;
    ctx.fillRect(innerX, innerBottom - h, innerW, h);
    if (h > 0) {
      // Full power holds at 1.0 until the finger comes up (DESIGN §7 item 2), so the
      // top of the fill flashes rather than simply stopping.
      const flash = level >= 1 && Math.floor(view.frameTick / b.chargeFlashTicks) % 2 === 0;
      ctx.fillStyle = flash ? '#fff3c4' : hud.warn;
      ctx.fillRect(innerX, innerBottom - h, innerW, 1);
    }
  }

  const ink = fireState === 'disabled' ? hud.disabledInk : held ? b.fireInkHeld : b.fireInk;
  pixel(ctx, 'FIRE', fire.x + fire.w / 2, fire.y + b.fireLabelTopPx + push, ink, 'center', b.fireLabelScale);
  pixel(
    ctx,
    view.charging ? `${Math.round(view.power * 100)}%` : 'HOLD',
    fire.x + fire.w / 2,
    fire.y + fire.h - b.holdLabelBottomPx + push,
    ink,
    'center',
    b.holdLabelScale,
  );
}

/**
 * The source and destination rectangles for a mobile portrait.
 *
 * Sprites are no longer all one size (docs/ART.md: 56×48 for most mobiles, up to 64×56
 * for the big walkers), so the portrait shows the *whole* frame, shrunk by the smallest
 * integer divisor that fits the plate. Integer divisors keep the pixels square on a
 * canvas that has smoothing off, and a whole mobile at 1/3 reads far better than a
 * third of a mobile at 1/1. A sprite that already fits is drawn at 1:1 and centred.
 *
 * Pure, because "the portrait is off by a pixel" is the kind of thing a test catches and
 * a screenshot does not.
 */
export function portraitCrop(
  frameW: number,
  frameH: number,
  boxW: number,
  boxH: number,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  let divisor = 1;
  while (
    divisor < 8 &&
    (Math.round(frameW / divisor) > boxW || Math.round(frameH / divisor) > boxH)
  ) {
    divisor++;
  }
  const dw = Math.max(1, Math.min(boxW, Math.round(frameW / divisor)));
  const dh = Math.max(1, Math.min(boxH, Math.round(frameH / divisor)));
  return {
    sx: 0,
    sy: 0,
    sw: frameW,
    sh: frameH,
    dx: Math.max(0, Math.round((boxW - dw) / 2)),
    dy: Math.max(0, Math.round((boxH - dh) / 2)),
    dw,
    dh,
  };
}

/** The portrait in the bar header: a small window with the team's colour under it. */
function drawPortrait(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  frame: HTMLCanvasElement | null,
  team: TeamId,
): void {
  ctx.fillStyle = skin.outline;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = hud.portrait.back;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.fillStyle = teamColor(team);
  ctx.fillRect(r.x + 1, r.y + r.h - 2, r.w - 2, 1);
  if (!frame) return;
  const crop = portraitCrop(frame.width, frame.height, r.w - 2, r.h - 3);
  ctx.drawImage(
    frame,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    r.x + 1 + crop.dx,
    r.y + 1 + crop.dy,
    crop.dw,
    crop.dh,
  );
}

/**
 * The owner tab: a dark plate over the bar's top rail with the portrait, the nick in the
 * team's colour and the mobile's name, 2x, so the bar says whose it is as plainly as the
 * old header line did. It is sized to its text.
 */
function drawOwnerTab(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: BottomBarView,
): void {
  const b = GEOMETRY[layout.variant].bar;
  const scale = b.nickScale;
  const nick = view.nick.toUpperCase();
  ctx.font = hud.font;
  const nickW = hasGlyphs(nick)
    ? Math.min(b.nickMaxPx, pixelTextWidth(nick, scale))
    : Math.min(b.nickMaxPx, Math.ceil(ctx.measureText(view.nick).width));
  const mobile = `· ${view.mobileName.toUpperCase()}`;
  const mobileW = pixelTextWidth(mobile, scale);
  // The touch grid's upright S1 / S2 cards cannot carry a name, and there is no room
  // under them either, so the selected shot is named here, in the selected card's gold.
  const shotName = ownerTabShotName(layout, view);
  const shot = shotName.length > 0 ? `· ${shotName}` : '';
  const shotW = shot.length > 0 ? b.nickGapPx + pixelTextWidth(shot, scale) : 0;
  const x = layout.portrait.x - b.tabPadPx;
  const right = layout.nickX + nickW + b.nickGapPx + mobileW + shotW + b.tabPadPx + 2;
  const y = layout.top;
  nine(ctx, 'panel-dark', x, y, right - x, b.tabHeightPx);
  drawPortrait(ctx, layout.portrait, view.portrait, view.team);
  const textY = y + b.nickY;
  const drawn = nickAt(ctx, view.nick, layout.nickX, textY, teamColor(view.team), b.nickMaxPx, scale);
  const afterMobile = layout.nickX + drawn + b.nickGapPx;
  const mobileDrawn = pixel(ctx, mobile, afterMobile, textY, hud.muted, 'left', scale);
  if (shot.length > 0) {
    pixel(ctx, shot, afterMobile + mobileDrawn + b.nickGapPx, textY, hud.shots.keySelected, 'left', scale);
  }
}

/** The selected shot's name for the owner tab: only the touch grid puts it there. */
function ownerTabShotName(layout: BottomBarLayout, view: BottomBarView): string {
  if (GEOMETRY[layout.variant].shots.stack !== 'grid') return '';
  const selected = view.shots.find((v) => v.selected);
  const name = selected ? selected.name.toUpperCase() : '';
  return hasGlyphs(name) ? name : '';
}

/** The whole bottom bar. */
export function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: BottomBarView,
): void {
  const g = GEOMETRY[layout.variant];
  const b = g.bar;
  const bar = layout.bar;

  // One kit console, and the owner tab riveted over the left end of its top rail: the
  // portrait, then whose bar this is in their team's colour, then the mobile.
  nine(ctx, 'panel-bar', bar.x, bar.y, bar.w, bar.h);
  drawOwnerTab(ctx, layout, view);

  // Section dividers, one in front of each block: a dark groove with a lit edge, which
  // is a seam between two plates rather than a line.
  const firstShot = layout.shots[0];
  const firstItem = layout.items[0];
  const dividers: number[] = [];
  if (firstShot) dividers.push(firstShot.rect.x - b.dividerInsetPx);
  dividers.push(layout.gauge.x - b.dividerInsetPx);
  if (firstItem) dividers.push(firstItem.x - b.dividerInsetPx);
  dividers.push(layout.fire.x - b.dividerInsetPx + 1);
  for (const x of dividers) {
    if (x > bar.x) {
      const dx = Math.round(x);
      const dy = bar.y + b.dividerTopPx;
      const dh = bar.h - b.dividerBottomPadPx;
      ctx.fillStyle = skin.bevelDark;
      ctx.fillRect(dx, dy, 1, dh);
      ctx.fillStyle = 'rgba(223, 231, 239, 0.14)';
      ctx.fillRect(dx + 1, dy, 1, dh);
    }
  }

  const glyph = g.dial.arrowGlyphScale;
  const arrow = (r: Rect, direction: ArrowDirection, held: boolean): void => {
    // The hovered widget is the one whose rectangle holds the mouse, so "is it this
    // key" is a question about the rectangle rather than about the target's fields.
    const over = hovering(view, (t) => (t.kind === 'angle' || t.kind === 'move') && hoverIn(r));
    drawArrowButton(ctx, r, direction, keyState(view.enabled, held, over), glyph);
  };
  const hoverIn = (r: Rect): boolean => {
    const t = view.hover;
    if (!t) return false;
    if (t.kind === 'angle') return r === (t.delta === 1 ? layout.angleUp : layout.angleDown);
    if (t.kind === 'move') return r === (t.dir === 1 ? layout.moveRight : layout.moveLeft);
    return false;
  };

  drawAngleDial(ctx, layout, view);
  arrow(layout.angleUp, 'up', view.angleHeld === 1);
  arrow(layout.angleDown, 'down', view.angleHeld === -1);
  drawShotCards(ctx, layout, view);

  // The section captions and the move count are the first thing a short view gives up:
  // the gauge is colour-coded and the keys under them are self-evident (§7 item 143).
  if (b.labels) {
    const y = layout.gauge.y - g.gauge.labelLiftPx;
    pixel(ctx, 'MOVE', layout.gauge.x + 1, y, hud.bar.label);
    pixel(
      ctx,
      `${Math.round(view.moveGauge)}/${Math.round(view.moveGaugeMax)}`,
      layout.gauge.x + layout.gauge.w - 1,
      y,
      hud.muted,
      'right',
    );
  }
  drawMoveGauge(ctx, layout.gauge, view);
  arrow(layout.moveLeft, 'left', view.moveHeld === -1);
  arrow(layout.moveRight, 'right', view.moveHeld === 1);

  drawPowerBar(ctx, layout.power, view, layout.variant);
  drawPowerReadout(ctx, layout, view);

  drawItemSlots(ctx, layout, view.items);
  drawActionButtons(ctx, layout, view);
}

// --------------------------------------------------------------------------
// Top centre: timer, wind, status tag and the turn banner
// --------------------------------------------------------------------------

/**
 * Wind at top centre: the kit's plate with the arrow turned to the wind's direction,
 * and the strength beside it as a number and a row of pips. Direction is degrees with
 * +y down, so 180–360 points up the screen (DESIGN §2.7) — the same way round as the
 * kit's arrow frames.
 */
export function drawWind(
  ctx: CanvasRenderingContext2D,
  wind: WindState,
  view: ViewSize,
): void {
  const w = hud.wind;
  const top = topClusterLayout(view);
  const cx = top.plate.x + top.plate.w / 2;
  const cy = top.plate.y + top.plate.h / 2;
  const fraction = Math.max(
    0,
    Math.min(1, wind.strength / Math.max(1, constants.wind.maxStrength)),
  );

  if (!drawUiPieceAt(ctx, 'wind-plate', cx, cy)) {
    ctx.beginPath();
    ctx.arc(cx, cy, top.plate.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = w.dialRim;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, top.plate.w / 2 - 3, 0, Math.PI * 2);
    ctx.fillStyle = w.dialFace;
    ctx.fill();
  }
  // A calm wind still has a direction, but it should not shout about it.
  ctx.globalAlpha = wind.strength > 0 ? 1 : 0.35;
  if (!drawUiPieceAt(ctx, 'wind-arrow', cx, cy, 1, stripFrameFor('wind-arrow', wind.directionDeg))) {
    drawFallbackArrow(ctx, cx, cy, wind.directionDeg);
  }
  ctx.globalAlpha = 1;

  // The strength plate: the number is what a player actually aims with.
  const s = top.strength;
  nine(ctx, 'panel-dark', s.x, s.y, s.w, s.h);
  const strong = fraction >= w.strongFrom;
  pixel(ctx, 'WIND', s.x + s.w / 2, s.y + 4, hud.muted, 'center');
  pixel(ctx, `${wind.strength}`, s.x + s.w / 2, s.y + 11, strong ? w.badgeStrong : w.badgeCalm, 'center', w.badgeScale);
  const lit = Math.round(fraction * w.pips);
  const pipW = 4;
  const pipsW = w.pips * pipW + (w.pips - 1) * 2;
  const px = Math.round(s.x + (s.w - pipsW) / 2);
  for (let i = 0; i < w.pips; i++) {
    ctx.fillStyle = i < lit ? (strong ? w.badgeStrong : w.badgeCalm) : w.pipOff;
    ctx.fillRect(px + i * (pipW + 2), s.y + s.h - 7, pipW, 2);
  }
}

/** The hand-drawn wind arrow, for the frames before the kit's is loaded. */
function drawFallbackArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, deg: number): void {
  const w = hud.wind;
  const dx = cosDeg(deg);
  const dy = sinDeg(deg);
  const nx = -dy;
  const ny = dx;
  const len = w.arrowLength * 0.5;
  const polygon = (inflate: number): void => {
    const hw = w.arrowHalfWidthPx + inflate;
    const hd = w.arrowHead + 2 + inflate;
    const tipX = cx + dx * len;
    const tipY = cy + dy * len;
    ctx.beginPath();
    ctx.moveTo(tipX + dx * inflate, tipY + dy * inflate);
    ctx.lineTo(tipX - dx * hd + nx * hd * 0.8, tipY - dy * hd + ny * hd * 0.8);
    ctx.lineTo(tipX - dx * hd + nx * hw, tipY - dy * hd + ny * hw);
    ctx.lineTo(cx - dx * (len + inflate) + nx * hw, cy - dy * (len + inflate) + ny * hw);
    ctx.lineTo(cx - dx * (len + inflate) - nx * hw, cy - dy * (len + inflate) - ny * hw);
    ctx.lineTo(tipX - dx * hd - nx * hw, tipY - dy * hd - ny * hw);
    ctx.lineTo(tipX - dx * hd - nx * hd * 0.8, tipY - dy * hd - ny * hd * 0.8);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = w.arrowEdge;
  polygon(1);
  ctx.fillStyle = w.arrow;
  polygon(0);
}

/**
 * The turn timer, left of the wind. `warning` is the last
 * `constants.turn.warningSeconds` of the turn (DESIGN §2.9), where it flashes and a
 * ring beats out of it once a second, so the clock is felt at the edge of vision while
 * the player is looking at the terrain.
 */
export function drawTurnTimer(
  ctx: CanvasRenderingContext2D,
  seconds: number,
  warning: boolean,
  frameTick: number,
  view: ViewSize,
): void {
  const t = hud.timer;
  const r = topClusterLayout(view).timer;
  const flashOn = Math.floor(frameTick / (t.flashPeriodTicks / 2)) % 2 === 0;

  if (warning) {
    const phase = (frameTick % t.pulseTicks) / t.pulseTicks;
    const grow = Math.round(phase * t.pulseGrowPx);
    ctx.globalAlpha = Math.max(0, 1 - phase);
    ctx.strokeStyle = t.pulseRing;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x - grow - 0.5, r.y - grow - 0.5, r.w + grow * 2 + 1, r.h + grow * 2 + 1);
    ctx.globalAlpha = 1;
  }

  nine(ctx, 'panel', r.x, r.y, r.w, r.h);
  if (warning && flashOn) {
    ctx.strokeStyle = t.warnFg;
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
  }
  const color = warning ? (flashOn ? t.warnFg : '#ffb4a8') : t.fg;
  pixel(
    ctx,
    `${Math.max(0, Math.round(seconds))}`,
    r.x + r.w / 2,
    r.y + Math.round((r.h - 5 * t.digitScale) / 2),
    color,
    'center',
    t.digitScale,
  );
}

/**
 * The status line under the top cluster: YOUR TURN, SHOT IN FLIGHT, WAITING FOR X,
 * FREE PLAY. It is what the turn banner leaves behind once it has gone, one plate
 * 13 px tall.
 */
export function drawStatusTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  self: boolean,
  view: ViewSize,
): void {
  const t = hud.top;
  const y = topClusterLayout(view).tagY;
  const upper = text.toUpperCase();
  const pixels = hasGlyphs(upper);
  ctx.font = hud.font;
  const textW = pixels ? pixelTextWidth(upper) : Math.ceil(ctx.measureText(text).width);
  const w = textW + t.tagPadPx * 2;
  const x = Math.round(view.width / 2 - w / 2);
  nine(ctx, 'panel-dark', x, y, w, t.tagHeightPx);
  const color = self ? hud.good : hud.fg;
  if (pixels) pixel(ctx, upper, x + t.tagPadPx, y + 4, color);
  else textAt(ctx, text, x + t.tagPadPx, y + 1, color);
}

/**
 * The turn banner: YOUR TURN on the gold plate, or the player whose turn it is on the
 * steel one, dropping in when a turn starts and fading out after a moment
 * ({@link turnBannerPose}). Nothing is drawn once it has gone.
 */
export function drawTurnBanner(
  ctx: CanvasRenderingContext2D,
  banner: TurnBannerView,
  view: ViewSize,
): void {
  const pose = turnBannerPose(banner.age);
  if (!pose) return;
  const b = hud.banner;
  const upper = banner.title.toUpperCase();
  const pixels = hasGlyphs(upper);
  ctx.font = b.font;
  const titleW = pixels
    ? pixelTextWidth(upper, b.titleScale)
    : Math.ceil(ctx.measureText(banner.title).width);
  const h = 24 * b.pieceScale;
  const w = Math.max(titleW, pixelTextWidth(banner.sub, b.subScale)) + b.paddingPx * 2 + 28 * b.pieceScale;
  const x = Math.round(view.width / 2 - w / 2);
  const y = Math.round(view.height * b.topFraction) + pose.dy;

  ctx.globalAlpha = pose.alpha;
  nine(ctx, banner.self ? 'banner/gold' : 'banner/steel', x, y, w, h, b.pieceScale);
  const cx = Math.round(view.width / 2);
  const titleH = 5 * b.titleScale;
  const subH = banner.sub ? 5 * b.subScale + 4 : 0;
  const ty = y + Math.round((h - titleH - subH) / 2);
  const color = banner.self ? '#fff3c4' : hud.fg;
  if (pixels) {
    drawPixelText(ctx, upper, cx, ty, { color, align: 'center', scale: b.titleScale, shadow: skin.outline });
  } else {
    textAt(ctx, banner.title, cx, ty - 3, color, 'center', b.font);
  }
  if (banner.sub) pixel(ctx, banner.sub.toUpperCase(), cx, ty + titleH + 4, hud.muted, 'center', b.subScale);
  ctx.globalAlpha = 1;
}

/**
 * The notice stack under the top cluster: "ANA USED BUNGE", "+150 HP", "SUDDEN DEATH".
 *
 * One queue drawn top down, newest first, each line fading on its own. Sudden death
 * asks for the large font and a gold frame, because it changes the arithmetic of the
 * whole match (DESIGN §2.9) and deserves to be read across the table.
 */
export function drawNotices(
  ctx: CanvasRenderingContext2D,
  notices: readonly NoticeView[],
  view: ViewSize,
): void {
  const n = hud.notices;
  const cx = Math.round(view.width / 2);
  let y = n.topPx;
  for (const notice of notices) {
    ctx.globalAlpha = Math.max(0, Math.min(1, notice.alpha));
    const font = notice.big ? hud.fontLarge : hud.font;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(notice.text).width) + 20;
    const h = notice.big ? n.bigLineHeightPx : n.lineHeightPx;
    const x = cx - Math.round(w / 2);
    drawSkinPanel(ctx, x, y, w, h);
    if (notice.big) nine(ctx, 'frame-gold', x - 2, y - 2, w + 4, Math.max(14, h + 4));
    textAt(ctx, notice.text, cx, y + (notice.big ? 3 : 2), notice.color, 'center', font);
    y += h + 3;
  }
  ctx.globalAlpha = 1;
}

/**
 * The teleport crosshair (DESIGN §4): it follows the pointer, shows the hull that would
 * land there, and turns red with the reason as soon as the point is one the simulation
 * would refuse — so a player never spends the item on a click that cannot work.
 */
export function drawTargetCursor(
  ctx: CanvasRenderingContext2D,
  view: TargetCursorView,
): void {
  const t = hud.targeting;
  const color = view.valid ? t.valid : t.invalid;
  const x = Math.round(view.x);
  const y = Math.round(view.y);

  ctx.globalAlpha = t.ghostAlpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(x - view.hullW / 2) + 0.5,
    Math.round(y - view.hullH) + 0.5,
    Math.round(view.hullW),
    Math.round(view.hullH),
  );
  ctx.globalAlpha = 1;

  const blink = Math.floor(view.frameTick / t.blinkTicks) % 2 === 0;
  ctx.strokeStyle = blink ? color : hud.fg;
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, t.radiusPx, 0, Math.PI * 2);
  ctx.moveTo(x - t.radiusPx - t.gapPx - t.armPx + 0.5, y + 0.5);
  ctx.lineTo(x - t.radiusPx - t.gapPx + 0.5, y + 0.5);
  ctx.moveTo(x + t.radiusPx + t.gapPx + 0.5, y + 0.5);
  ctx.lineTo(x + t.radiusPx + t.gapPx + t.armPx + 0.5, y + 0.5);
  ctx.moveTo(x + 0.5, y - t.radiusPx - t.gapPx - t.armPx + 0.5);
  ctx.lineTo(x + 0.5, y - t.radiusPx - t.gapPx + 0.5);
  ctx.moveTo(x + 0.5, y + t.radiusPx + t.gapPx + 0.5);
  ctx.lineTo(x + 0.5, y + t.radiusPx + t.gapPx + t.armPx + 0.5);
  ctx.stroke();

  if (view.label.length > 0) {
    textAt(ctx, view.label, x, y + t.labelOffsetPx, color, 'center');
  }
}

// --------------------------------------------------------------------------
// The player list
// --------------------------------------------------------------------------

/** The icon a row leads with: how the seat is, before anything it is marked with. */
function rowIcon(entry: OrderEntry): { piece: IconPiece; fallback: IconName | null } {
  if (!entry.alive) return { piece: 'status/dead', fallback: 'skull' };
  if (!entry.connected) return { piece: 'status/offline', fallback: null };
  return { piece: 'status/heart', fallback: null };
}

/**
 * The player list (DESIGN §2.8): every seat in delay order, lowest first — the head of
 * the list is the only promise (§7 item 20) — then the fallen. Each row is the team's
 * chip, a heart (or a skull, or the disconnected cross), the nick, an HP bar, up to two
 * status icons and the delay. The seat whose turn it is is lit gold.
 */
export function drawPlayerList(
  ctx: CanvasRenderingContext2D,
  entries: OrderEntry[],
  variant: HudVariant = 'full',
): void {
  const o = hud.order;
  // The short variant lists one seat fewer, so the panel, the toggle row under it and
  // the debug readout under those all clear the bar (DESIGN §7 item 143).
  const rows = Math.min(entries.length, orderCount(variant));
  const h = o.headerHeightPx + rows * o.rowHeightPx + o.paddingPx;
  // On a phone one backbuffer pixel is about one CSS pixel, so the names and delays are
  // drawn twice as big there: 10 px tall rather than 5.
  const scale = variant === 'compact' ? hud.compact.order.textScale : o.textScale;
  const textY = Math.round((o.rowHeightPx - 1 - 5 * scale) / 2);
  nine(ctx, 'panel', o.x, o.y, o.widthPx, h);
  pixel(ctx, 'PLAYERS', o.x + o.nickX, o.y + o.headerTopPx, hud.muted);
  pixel(ctx, 'DELAY', o.x + o.widthPx - o.paddingPx - 1, o.y + o.headerTopPx, hud.muted, 'right');

  for (let i = 0; i < rows; i++) {
    const e = entries[i];
    if (!e) continue;
    const y = o.y + o.headerHeightPx + i * o.rowHeightPx;
    const left = o.x + 4;
    const width = o.widthPx - 8;
    if (e.active) {
      // Lit, framed and marked: at 10 px a tint alone is easy to miss.
      ctx.fillStyle = 'rgba(255, 210, 63, 0.2)';
      ctx.fillRect(left, y, width, o.rowHeightPx - 1);
      ctx.strokeStyle = o.active;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, y + 0.5, width - 1, o.rowHeightPx - 2);
    }
    // Every row wears its team down its left edge, so the list reads as two sides
    // taking turns rather than as a list of names.
    ctx.fillStyle = teamColor(e.team);
    ctx.fillRect(o.x + o.chipX, y + 1, o.teamChipPx, o.rowHeightPx - 3);

    const icon = rowIcon(e);
    kitIcon(ctx, icon.piece, icon.fallback, o.x + o.iconX + 6, y + 6, 1, e.alive ? 1 : 0.8);

    const nickRoom = o.hpX - o.nickX - 4;
    const selfW = e.self ? pixelTextWidth('YOU') + o.selfTagGapPx : 0;
    const nickColor = e.alive ? teamColor(e.team) : hud.dim;
    const nickW = nickAt(ctx, e.nick, o.x + o.nickX, y + textY, nickColor, nickRoom - selfW, scale);
    if (e.self) pixel(ctx, 'YOU', o.x + o.nickX + nickW + o.selfTagGapPx, y + 4, o.selfTag);

    const ratio = e.hpMax > 0 ? Math.max(0, Math.min(1, e.hp / e.hpMax)) : 0;
    drawTrough(
      ctx,
      rect(o.x + o.hpX, y + 2, o.hpWidthPx, 8),
      'trough-small',
      ratio > o.lowFraction ? 'green' : 'red',
      e.alive ? ratio : 0,
    );

    for (let k = 0; k < Math.min(2, e.status.length); k++) {
      const s = e.status[k];
      if (s) kitIcon(ctx, `status/${s}`, null, o.x + o.statusX + 6 + k * 12, y + 6);
    }

    pixel(
      ctx,
      e.alive ? `${Math.round(e.delay)}` : '-',
      o.x + o.widthPx - o.paddingPx - 1,
      y + textY,
      e.active ? hud.accent : hud.muted,
      'right',
      scale,
    );
  }
}

/** The old name for {@link drawPlayerList}: the list was the delay order alone. */
export const drawUpcomingOrder = drawPlayerList;

// --------------------------------------------------------------------------
// Toggles, the controls card and the connection badge
// --------------------------------------------------------------------------

/** The three toggle buttons under the player list: blue gem keys, sunk while on. */
export function drawToggles(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  view: TogglesView,
): void {
  const t = GEOMETRY[layout.variant].toggles;
  const key = (r: Rect, on: boolean, icon: IconName, enabled = true): void => {
    nine(ctx, `button/${enabled ? (on ? 'pressed' : 'normal') : 'disabled'}`, r.x, r.y, r.w, r.h);
    const push = on ? 1 : 0;
    drawIconCentred(ctx, icon, r.x + r.w / 2, r.y + r.h / 2 + push, t.iconScale);
  };

  // Sound on, music off, sound off: one key, three faces (DESIGN §8.3).
  const sound = view.muted ? 'muted' : view.musicOff ? 'musicOff' : 'sound';
  key(layout.toggles.mute, view.muted || view.musicOff, sound);
  key(layout.toggles.help, view.help, 'help');

  // The sandbox has no chat line, so its button is drawn dead rather than removed:
  // three buttons in a fixed row is one layout, not two.
  const chat = layout.toggles.chat;
  ctx.globalAlpha = view.chat ? 1 : hud.disabledAlpha;
  key(chat, view.chatOpen, 'chat', view.chat);
  ctx.globalAlpha = 1;
  if (view.chat && view.chatUnread > 0) {
    const pip = 3 * t.iconScale;
    ctx.fillStyle = skin.outline;
    ctx.fillRect(chat.x + chat.w - pip - 3, chat.y + 1, pip + 2, pip + 2);
    ctx.fillStyle = hud.warn;
    ctx.fillRect(chat.x + chat.w - pip - 2, chat.y + 2, pip, pip);
  }
}

/**
 * Split a help string into lines no longer than `maxChars`, breaking only at the
 * double spaces the help strings already use between entries — so "Space/FIRE charge"
 * is never cut in half.
 *
 * Pure and exported for the tests: a wrap that silently drops the last entry is
 * invisible in a screenshot at 10 px.
 */
export function wrapHelpLines(text: string, maxChars = hud.help.wrapChars): string[] {
  const entries = text
    .split(/ {2,}/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const entry of entries) {
    if (current.length === 0) {
      current = entry;
      continue;
    }
    const joined = `${current}  ${entry}`;
    if (joined.length > maxChars) {
      lines.push(current);
      current = entry;
    } else {
      current = joined;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * The controls card (H), sitting on top of the bottom bar. It is a panel rather than a
 * line so it can hold every key without running off the screen.
 *
 * Left edge on a desktop, right edge in the compact variant: the chat log is a DOM layer
 * pinned to the bottom left just above the bar (`.chat-overlay`, index.html), and on a
 * phone the two toggles that open them are neighbours in the same 44 px row, so the
 * collision is one tap away. Moved across, the card and the chat line can both be open.
 */
export function drawHelpCard(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  text: string,
): void {
  const h = GEOMETRY[layout.variant].help;
  const lines = wrapHelpLines(text, h.wrapChars);
  if (lines.length === 0) return;
  const pad = hud.paddingPx + 3;
  const height = (lines.length + 1) * hud.lineHeightPx + pad * 2 + h.titleGapPx;
  const x =
    layout.variant === 'compact'
      ? layout.bar.x + layout.bar.w - h.widthPx
      : layout.bar.x;
  const y = layout.bar.y - h.aboveBarPx - height;
  nine(ctx, 'panel', x, y, h.widthPx, height);
  pixel(ctx, 'CONTROLS  (H CLOSES)', x + pad, y + pad + 2, hud.accent);
  for (let i = 0; i < lines.length; i++) {
    textAt(
      ctx,
      lines[i] as string,
      x + pad,
      y + pad + h.titleGapPx + (i + 1) * hud.lineHeightPx,
      hud.fg,
    );
  }
}

/**
 * "RECONNECTING" above the right-hand end of the bar while the socket is away
 * (DESIGN §6.4). Nothing is drawn while the connection is healthy.
 */
export function drawNetBadge(
  ctx: CanvasRenderingContext2D,
  layout: BottomBarLayout,
  state: NetState,
  frameTick: number,
): void {
  if (state === 'online') return;
  const n = hud.netBadge;
  const x = layout.view.width - n.rightMarginPx - n.widthPx;
  const y = layout.bar.y - n.aboveBarPx - n.heightPx;
  drawSkinPanel(ctx, x, y, n.widthPx, n.heightPx, n.edge);
  const on = Math.floor(frameTick / n.blinkFrames) % 2 === 0;
  if (on) kitIcon(ctx, 'status/offline', null, x + 11, y + n.heightPx / 2);
  pixel(
    ctx,
    state === 'reconnecting' ? 'RECONNECTING' : 'OFFLINE',
    x + 20,
    y + n.textTopPx + 2,
    hud.warn,
  );
}

// --------------------------------------------------------------------------
// World-space tags
// --------------------------------------------------------------------------

/** Floating nickname + HP bar (+ shield bar) above a mobile. */
export function drawMobileTag(
  ctx: CanvasRenderingContext2D,
  info: { nick: string; team: TeamId; active: boolean },
  m: MobileState,
  def: MobileDef,
  screenX: number,
  screenY: number,
): void {
  const tag = hud.nameTag;
  const x = Math.round(screenX);
  // The sprite's anchor says how tall the mobile stands, so a 48 px chibi walker gets its
  // tag above its head instead of across its turret.
  const lift = Math.max(tag.minOffsetPx, def.sprite.anchor.y + tag.clearancePx);
  const y = Math.round(screenY - lift);
  const ratio = Math.max(0, Math.min(1, m.hp / def.hp));
  const left = Math.round(x - tag.barWidth / 2);

  // The nick sits over terrain, sky and explosions, so it carries its own outline. A
  // nickname can be written in any alphabet, so the pixel font only gets it when it can
  // actually spell it (see `pixel`).
  const upper = info.nick.toUpperCase();
  if (hasGlyphs(upper)) {
    drawPixelText(ctx, upper, x, y - tag.nickGapPx - 5, {
      color: teamColor(info.team),
      align: 'center',
      outline: tag.outline,
    });
  } else {
    ctx.font = hud.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = tag.outline;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      ctx.fillText(info.nick, x + dx, y - tag.nickGapPx + dy);
    }
    ctx.fillStyle = teamColor(info.team);
    ctx.fillText(info.nick, x, y - tag.nickGapPx);
    ctx.textAlign = 'left';
  }

  /** One outlined, glossy bar: the treatment every gauge in the HUD gets. */
  const bar = (
    by: number,
    h: number,
    value: number,
    back: string,
    fill: string,
    light: string,
  ): void => {
    ctx.fillStyle = tag.outline;
    ctx.fillRect(left - 1, by - 1, tag.barWidth + 2, h + 2);
    ctx.fillStyle = back;
    ctx.fillRect(left, by, tag.barWidth, h);
    const w = Math.round(tag.barWidth * Math.max(0, Math.min(1, value)));
    if (w > 0) {
      ctx.fillStyle = fill;
      ctx.fillRect(left, by, w, h);
      ctx.fillStyle = light;
      ctx.fillRect(left, by, w, 1);
    }
  };

  bar(
    y,
    tag.barHeight,
    ratio,
    tag.hpBack,
    ratio > tag.lowFraction ? tag.hp : hud.warn,
    ratio > tag.lowFraction ? tag.hpLight : '#ffb4a8',
  );
  drawPixelText(ctx, `${Math.max(0, Math.round(m.hp))}`, left + tag.barWidth + 8, y, {
    color: tag.hpText,
    scale: tag.textScale,
    outline: tag.outline,
  });

  if (def.shieldMax > 0) {
    const shieldRatio = Math.max(0, Math.min(1, m.shield / def.shieldMax));
    const sy = y + tag.barHeight + tag.barGapPx;
    bar(sy, tag.shieldHeight, shieldRatio, tag.shieldBack, tag.shield, tag.shieldLight);
  }

  if (info.active) {
    // Two brackets rather than a box: the active mobile already has the selection ring,
    // and a second full frame reads as clutter over a busy map.
    ctx.fillStyle = tag.activeEdge;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(left - 4 - i, y - 2 + i, 1, tag.barHeight + 4 - i * 2);
      ctx.fillRect(left + tag.barWidth + 3 + i, y - 2 + i, 1, tag.barHeight + 4 - i * 2);
    }
  }
}

// --------------------------------------------------------------------------
// Chat bubbles
// --------------------------------------------------------------------------

/** One line of in-match chat, floating over the mobile that said it. */
export interface ChatBubbleView {
  /** Backbuffer position of the speaker's feet. */
  screenX: number;
  screenY: number;
  /** How tall the speaker stands, i.e. its sprite's `anchor.y`. */
  liftPx: number;
  text: string;
  /** Frames since the line arrived; past `bubble.frames` nothing is drawn. */
  age: number;
}

/**
 * Wrap a chat line the way the bubble draws it: whole words, `maxChars` per line, at
 * most three lines, the last one cut with an ellipsis.
 *
 * Pure and exported because a bubble that silently swallows the end of a sentence is
 * invisible in a screenshot.
 */
export function wrapBubbleText(
  text: string,
  maxChars = hud.bubble.wrapChars,
  maxLines = 3,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const joined = current.length === 0 ? word : `${current} ${word}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = word.length > maxChars ? word.slice(0, maxChars) : word;
    if (lines.length === maxLines) break;
  }
  if (current.length > 0 && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last && words.join(' ').length > lines.join(' ').length) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
    }
  }
  return lines;
}

/**
 * A chat bubble over a mobile's head: a white plate with a hard outline and a tail, in
 * the same idiom as the rest of the skin. The text is the *player's*, so it is drawn
 * with the canvas font — the pixel font cannot spell most of what people type.
 */
export function drawChatBubble(ctx: CanvasRenderingContext2D, view: ChatBubbleView): void {
  const b = hud.bubble;
  if (view.age >= b.frames) return;
  const fade = b.frames - view.age;
  ctx.globalAlpha = fade < b.fadeFrames ? Math.max(0, fade / b.fadeFrames) : 1;

  const lines = wrapBubbleText(view.text);
  if (lines.length === 0) {
    ctx.globalAlpha = 1;
    return;
  }
  ctx.font = hud.font;
  let textW = 0;
  for (const line of lines) textW = Math.max(textW, Math.ceil(ctx.measureText(line).width));
  const w = Math.min(b.maxWidthPx, textW + b.paddingPx * 2);
  const h = lines.length * b.lineHeightPx + b.paddingPx * 2 - 2;
  const cx = Math.round(view.screenX);
  const bottom = Math.round(view.screenY - view.liftPx - b.gapPx - b.tailHeightPx);
  const x = Math.round(cx - w / 2);
  const y = bottom - h;

  ctx.fillStyle = b.outline;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = b.back;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b.backEdge;
  ctx.fillRect(x, y + h - 1, w, 1);
  // The tail, a 5 px wedge under the middle of the plate.
  for (let i = 0; i < b.tailHeightPx; i++) {
    const half = Math.max(1, Math.round((b.tailWidthPx * (b.tailHeightPx - i)) / b.tailHeightPx));
    ctx.fillStyle = b.outline;
    ctx.fillRect(cx - half - 1, bottom + i, half * 2 + 2, 1);
    ctx.fillStyle = b.back;
    ctx.fillRect(cx - half, bottom + i, half * 2, 1);
  }

  for (let i = 0; i < lines.length; i++) {
    textAt(
      ctx,
      lines[i] as string,
      cx,
      y + b.paddingPx - 1 + i * b.lineHeightPx,
      b.text,
      'center',
    );
  }
  ctx.globalAlpha = 1;
}

/** Dashed ring under the mobile whose turn it is. */
export function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  phase: number,
): void {
  const sel = hud.selection;
  ctx.save();
  ctx.strokeStyle = sel.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([sel.dashPx, sel.dashPx]);
  ctx.lineDashOffset = -phase;
  ctx.beginPath();
  ctx.ellipse(
    Math.round(screenX),
    Math.round(screenY) - 2,
    sel.radiusPx,
    sel.radiusPx * 0.45,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();
}

/** The end-of-match plate: the kit panel inside a gold frame. */
export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  title: string,
  lines: string[],
  view: ViewSize,
): void {
  const g = hud.gameOver;
  ctx.fillStyle = g.dim;
  ctx.fillRect(0, 0, view.width, view.height);
  const x = Math.round((view.width - g.widthPx) / 2);
  const y = Math.round((view.height - g.heightPx) / 2);
  nine(ctx, 'panel', x, y, g.widthPx, g.heightPx);
  nine(ctx, 'frame-gold', x - 4, y - 4, g.widthPx + 8, g.heightPx + 8);
  const cx = x + g.widthPx / 2;
  const upper = title.toUpperCase();
  if (hasGlyphs(upper)) {
    drawPixelText(ctx, upper, cx, y + g.titleTopPx, {
      color: hud.accent,
      align: 'center',
      scale: 5,
      shadow: skin.outline,
    });
  } else {
    textAt(ctx, title, cx, y + g.titleTopPx, hud.accent, 'center', hud.fontHuge);
  }
  for (let i = 0; i < lines.length; i++) {
    textAt(
      ctx,
      lines[i] as string,
      cx,
      y + g.linesTopPx + i * g.lineHeightPx,
      hud.fg,
      'center',
      hud.fontLarge,
    );
  }
}
