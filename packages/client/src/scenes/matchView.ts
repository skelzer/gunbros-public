/**
 * The playable view of a match: backbuffer, camera, world drawing, HUD, keyboard and
 * mouse, the real-time power charge and the fixed-timestep loop.
 *
 * It is everything the dev sandbox (DESIGN §7 item 14) and the networked match scene
 * (DESIGN §6.3) have in common, which is almost all of it. The one real difference is
 * where an intent *goes*: the sandbox hands it straight to `applyIntent`, the networked
 * scene puts it on the socket and waits for the authority to echo it back (DESIGN §7
 * item 12). That, and a handful of presentation hooks, is the whole `MatchViewDriver`
 * interface below.
 *
 * The view never decides anything about the simulation. It steps the state it is given
 * at 60 Hz, draws it, and reports input. The scene above it decides whose intents those
 * are, whether they are allowed, and what happens to them.
 */
import {
  canUseItem,
  checkTeleportTarget,
  constants,
  cosDeg,
  getItemDef,
  getMobileDef,
  itemsRemaining,
  mobileOfSeat,
  muzzlePosition,
  NO_SHOT_YET,
  NOT_CHARGING,
  quantisePower,
  secondsLeft,
  sinDeg,
  slotOfSeat,
  ssAvailable,
  ssReady,
  step,
  tiltDeg,
  upcomingOrder,
  worldAngleDeg,
  clamp,
} from '@gunbros/shared';
import type {
  Intent,
  ItemId,
  ItemRejection,
  ItemTarget,
  MapDef,
  MatchState,
  MobileId,
  MobileState,
  PlayerSlot,
  ShotSlot,
  SimEvent,
  SpriteRef,
} from '@gunbros/shared';
import { aimArrowPixels, drawAimArrow } from '../render/aimArrow.js';
import { createBackbuffer } from '../render/canvas.js';
import type { Backbuffer } from '../render/canvas.js';
import type { ViewSize } from '../render/viewSize.js';
import { Camera, CameraDirector } from '../render/camera.js';
import { TerrainRenderer } from '../render/terrain.js';
import { BackgroundRenderer } from '../render/background.js';
import { mapArtFor, preloadMapArt, waitForMapArt } from '../render/mapArt.js';
import { Effects } from '../render/effects.js';
import { SkyRenderer, skyEventTitle } from '../render/sky.js';
import {
  createSpriteSheet,
  drawMine,
  drawMobile,
  drawProjectile,
  frameCanvasFor,
} from '../render/sprites.js';
import type { SpriteSheet } from '../render/sprites.js';
import { blenderSheetFor, drawBlenderMobile } from '../render/blenderSprites.js';
import {
  bottomBarLayout,
  drawBottomBar,
  drawGameOver,
  drawHelpCard,
  drawMobileTag,
  drawNetBadge,
  drawNotices,
  drawPlayerList,
  drawSelectionRing,
  drawStatusTag,
  drawTargetCursor,
  drawTextPanel,
  drawToggles,
  drawTurnBanner,
  drawTurnTimer,
  drawWind,
  hudBlocksDrag,
  hudHitTest,
  turnBannerPose,
} from '../render/hud.js';
import type {
  BottomBarLayout,
  BottomBarView,
  HudTarget,
  ItemRowView,
  ItemSlotView,
  NetState,
  NoticeView,
  OrderEntry,
  Rect,
  ShotButtonView,
  ToggleName,
  TogglesView,
  TurnBannerView,
} from '../render/hud.js';
import { loadUiKit } from '../render/uiKit.js';
import { loadProjectileSprites } from '../render/projectileSprites.js';
import type { StatusIcon } from '../render/uiKit.js';
import { SfxPlayer } from '../audio/sfx.js';
import { appMusic, matchScene, trackFor } from '../audio/music.js';
import { Keyboard, itemActions } from '../input/keyboard.js';
import { aimHoldFactor, isTap, PointerInput } from '../input/pointer.js';
import type { PointerSample } from '../input/pointer.js';
import { releaseOutcome } from '../input/pointerRole.js';
import type { PointerRole } from '../input/pointerRole.js';
import { clientConstants, orderCount } from '../data/clientConstants.js';
import { isTouchScreen } from '../ui/viewport.js';
import { itemText } from '../ui/itemInfo.js';
import { layoutLoadout, markUsed, slotAt } from '../state/loadout.js';
import type { LoadoutSlot } from '../state/loadout.js';
import { cycleSoundMode, loadSoundMode } from '../state/session.js';
import type { SoundMode } from '../state/session.js';

export interface Scene {
  destroy(): void;
}

export const SHOT_ORDER: ShotSlot[] = ['s1', 's2', 'ss'];

/** Power gained per millisecond held: linear, 0 to 1 over `chargeSeconds` (§2.10). */
const POWER_PER_MS = 1 / (constants.power.chargeSeconds * 1000);
/** Milliseconds between two `charging` intents (DESIGN §7 item 18). */
const CHARGE_SEND_MS = 1000 / clientConstants.input.chargeSendHz;

export interface GameOverView {
  title: string;
  lines: string[];
}

/**
 * Why an item was refused, in words (DESIGN §4). `canUseItem` answers with a machine
 * reason and the HUD turns it into the one line that tells the player what to do
 * differently; the wording is here rather than in the rule so a refusal can be reworded
 * without touching the simulation.
 */
const rejectionText: Record<ItemRejection, string> = {
  unknownItem: 'UNKNOWN ITEM',
  notYourTurn: 'NOT YOUR TURN',
  deadMobile: 'MOBILE IS DOWN',
  notInLoadout: 'NOT IN YOUR LOADOUT',
  alreadySpent: 'ALREADY USED',
  oneItemPerTurn: 'ONE ITEM PER TURN',
  targetRequired: 'PICK A SPOT',
  targetOutsideMap: 'OFF THE MAP',
  targetNotAir: 'INSIDE THE GROUND',
  targetNoGround: 'NO GROUND BELOW',
  targetOccupied: 'SOMEONE IS THERE',
};


/**
 * The HUD controls a test can ask for by name (see {@link MatchView.controlRect}): the
 * single keys, the three shot cards by slot, the three toggles, and the item slots as
 * `item0` to `item5` (a two-slot item answers on its first slot).
 */
export type ControlName =
  | 'fire'
  | 'skip'
  | 'moveLeft'
  | 'moveRight'
  | 'angleUp'
  | 'angleDown'
  | 'dial'
  | ShotSlot
  | ToggleName
  | `item${0 | 1 | 2 | 3 | 4 | 5}`;

/** A short-lived line in the stack under the turn banner. */
interface Notice {
  text: string;
  color: string;
  /** Frames left, counted down every rendered frame. */
  life: number;
  big: boolean;
}

/**
 * What the scene above the view has to answer. Everything is optional except the three
 * questions the view cannot answer for itself: where does an intent go, which seat is
 * the local input driving, and may it act right now.
 */
export interface MatchViewDriver {
  /** Where an intent produced by the local input goes. */
  sendIntent(intent: Intent): void;
  /** The seat the local input drives, or -1 for a spectator. */
  controlledSeat(): number;
  /** May the local input act right now? */
  acceptsInput(): boolean;
  /**
   * The seat the camera, the selection ring and the bottom bar follow. Defaults to the
   * controlled seat; the networked scene points it at the *active* seat so a player
   * watches the opponent's turn instead of their own idle mobile.
   */
  focusSeat?(): number;
  /** Extra per-frame key handling (the sandbox's dev keys, the chat line). */
  onInput?(keyboard: Keyboard): void;
  /** Called after every simulated tick with that tick's events, already consumed here. */
  onTick?(events: SimEvent[]): void;
  /** Extra lines for the top-right debug panel. */
  debugLines?(): string[];
  /**
   * The controls the help card (H) lists; entries separated by two spaces. `touch` is
   * true on a phone or a tablet, where a list of key names is the one piece of text
   * that cannot help the player.
   */
  helpText?(touch: boolean): string;
  /** The chat button was pressed, or T. Scenes without a chat line leave it out. */
  onChatToggle?(): void;
  /** Is the chat line open right now? */
  chatOpen?(): boolean;
  /** Chat lines that arrived while the log was closed, for the pip on the button. */
  chatUnread?(): number;
  /** The socket, for the reconnecting badge (DESIGN §6.4). */
  netState?(): NetState;
  /** Replaces the turn banner entirely (the sandbox's FREE PLAY). */
  bannerOverride?(): { text: string; self: boolean } | null;
  /** Seconds on the turn timer; null falls back to the simulation's own count. */
  timerSeconds?(): number | null;
  /** The game-over plate, or null while the match runs. */
  gameOver?(): GameOverView | null;
  /**
   * Has the match ended, as far as this scene knows? The music plays the results from
   * then on (DESIGN §8.3). A networked match answers from the authority's `matchEnd`
   * (DESIGN §7 item 57); a scene without the hook falls back to the simulation's own
   * `phase: 'ended'`.
   */
  matchOver?(): boolean;
  /** An item slot was pressed (key 1-6 or the HUD button). */
  onItem?(index: number): void;
  /**
   * The highest absolute tick the local simulation may reach right now, or null for
   * "run free" (the sandbox, which is its own authority).
   *
   * A networked client uses it to stay *tick-aligned* with the server rather than
   * merely close to it: `state.turnStartTick` is part of the state hash (DESIGN §2.1),
   * so an engine whose tick counter has drifted by even one mismatches at every
   * `turnEnd` however perfectly it reproduced the shot. Capping the local clock at the
   * last tick the authority reported plus the real time since keeps the two counters
   * equal, one network latency apart (DESIGN §7 item 35).
   */
  tickCap?(): number | null;
  /** Milliseconds between two `aim` intents; 0 sends one per tick (the sandbox). */
  aimSendMs?: number;
}

export class MatchView {
  readonly backbuffer: Backbuffer;
  readonly camera: Camera;
  readonly director: CameraDirector;
  readonly effects = new Effects();
  /** Tornado column, Force band and the Thor satellite (DESIGN §5). */
  readonly skyRenderer = new SkyRenderer();
  readonly keyboard = new Keyboard();
  /**
   * One code path for a mouse and for fingers (DESIGN §7 item 144). The view keeps the
   * roles; the module only reports where each pointer is.
   */
  readonly pointer = new PointerInput();
  /**
   * Sound (DESIGN §8). The view owns it because the view owns the two things that make
   * noise: the event stream of every simulated tick and the real-time charge.
   */
  readonly sfx: SfxPlayer;

  match: MatchState;
  /** The sound button's mode (DESIGN §8.3): all on, the effects without the music, off. */
  sound: SoundMode;
  /** Is the controls card (H) open? Closed by default — the keys are a reminder. */
  helpOpen = false;
  /** Rendered frames since the view was mounted; drives every HUD animation. */
  frameTick = 0;

  private map: MapDef;
  private readonly host: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: BackgroundRenderer;
  private readonly terrainRenderer: TerrainRenderer;
  /** A painted map whose terrain picture had not arrived when the renderer was set up. */
  private artPending = false;
  /**
   * Rebuilt whenever the internal resolution changes (a rotation, a resized window):
   * the bar hangs off the bottom of the view, so every rectangle in it moves with the
   * height (DESIGN §7 item 142).
   */
  private layout: BottomBarLayout;
  private readonly unsubscribeResize: () => void;
  private readonly sheets = new Map<MobileId, SpriteSheet>();
  private readonly driver: MatchViewDriver;

  /** What each pointer that is currently down is doing. See {@link PointerRole}. */
  private readonly roles = new Map<number, PointerRole>();
  /** Set while a finger is sweeping the angle dial, so the HUD can light it up. */
  private aimDragging = false;
  /**
   * When the current aim hold started, for the acceleration ramp (DESIGN §7 item 145),
   * or null when nothing is held. Shared by the keyboard and the arrow buttons: one
   * ramp, whichever control started it.
   */
  private aimHoldSince: number | null = null;
  private charging = false;
  private power = 0;
  private chargeSendMs = 0;
  private chargeArmed = false;
  private firePressed = false;
  /**
   * A finger on FIRE was *cancelled* this frame — the browser took the gesture away (an
   * edge swipe, the home indicator, a call) — so `updateCharge` ends the charge without
   * firing it (DESIGN §7 item 168). Read and cleared once a frame.
   */
  private chargeAborted = false;
  private angleHold: -1 | 0 | 1 = 0;
  private moveHold: -1 | 0 | 1 = 0;
  private acceptedInput = false;
  /**
   * The angle the player is asking for, which is not the same as the mobile's angle
   * until the authority says so. It is cleared as soon as the simulation agrees, so the
   * sandbox (where `applyIntent` is immediate) drops it on the next tick and the
   * networked scene holds it for one round trip.
   */
  private aimTarget: number | null = null;
  private lastAimSentAt = 0;
  private notices: Notice[] = [];
  /**
   * The turn banner (DESIGN §2.9): which turn it announced, and the frame it went up
   * on. A new turn — a new `turn` number or a new active seat — puts up a new one.
   */
  private banner: { key: string; frame: number; view: Omit<TurnBannerView, 'age'> } | null = null;
  /**
   * The item waiting for a clicked point (Teleport, DESIGN §4). While it is set the
   * pointer is a crosshair, a click on the world sends the `useItem` and Esc — or
   * anything that takes the turn away — drops it.
   */
  private targeting: ItemId | null = null;
  /** Slot index flashing because its item has just been used, with its frame stamp. */
  private itemFlash: { index: number; frame: number } | null = null;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private running = false;
  /**
   * Is this a phone or a tablet? Read once, at mount: it decides the HUD geometry
   * (`hudVariantFor`) and the wording of the controls card, and a device does not grow
   * a mouse halfway through a match.
   */
  readonly touchScreen = isTouchScreen();

  constructor(host: HTMLElement, map: MapDef, state: MatchState, driver: MatchViewDriver) {
    this.map = map;
    this.host = host;
    this.match = state;
    this.driver = driver;
    this.backbuffer = createBackbuffer(host);
    this.ctx = this.backbuffer.ctx;
    this.camera = new Camera(this.backbuffer.width, this.backbuffer.height, map.width, map.height);
    this.director = new CameraDirector(this.camera);
    this.background = new BackgroundRenderer(map);
    // A painted map's pictures (DESIGN §8.1): usually already in from the room or the
    // scene that built this view; `start` holds the first frame until they are.
    void preloadMapArt(map);
    this.terrainRenderer = new TerrainRenderer(state.terrain, map.palette, this.terrainArt(map));
    this.sound = loadSoundMode();
    this.sfx = new SfxPlayer(this.muted);
    this.layout = bottomBarLayout(this.backbuffer.size, this.touchScreen);
    // The HUD draws a plainer fallback until the kit is in; start fetching it now
    // rather than on the first frame.
    void loadUiKit().catch(() => undefined);
    loadProjectileSprites();
    this.publishMetrics();
    this.unsubscribeResize = this.backbuffer.onResize((size) => this.onViewResize(size));
    this.centreOnFocus();
  }

  /** The terrain picture for `map` if it has arrived, and notes whether it has. */
  private terrainArt(map: MapDef): ImageData | null {
    const art = mapArtFor(map.id);
    this.artPending = map.art !== undefined && art === null;
    return art?.terrain ?? null;
  }

  /**
   * Put a painted map's picture under the terrain renderer the frame it arrives, when it
   * came in after the preload budget ran out. One map lookup a frame until then.
   */
  private adoptLateArt(): void {
    if (!this.artPending) return;
    const art = mapArtFor(this.map.id);
    if (!art) return;
    this.artPending = false;
    this.terrainRenderer.setArt(art.terrain);
  }

  /** The current internal resolution. Every HUD call is laid out against it. */
  get view(): ViewSize {
    return this.backbuffer.size;
  }

  /**
   * Where a HUD control is *on the page*, in CSS px, or null when the view has not been
   * fitted yet (DESIGN §10).
   *
   * The HUD is pixels on a canvas, so a browser test cannot find a button by role or by
   * text; without this the only way to press FIRE from Playwright is to reimplement
   * `bottomBarLayout` in the test and hope the two stay in step. It is read by the
   * `?debug=1` probe and by nothing in the client, and it is also how the e2e asserts
   * that a walk arrow really is 44 CSS px under a thumb.
   */
  controlRect(name: ControlName): { x: number; y: number; w: number; h: number } | null {
    const scale = this.backbuffer.scale;
    if (!(scale > 0)) return null;
    const rect = this.controlLayoutRect(name);
    if (!rect) return null;
    const box = this.backbuffer.canvas.getBoundingClientRect();
    return {
      x: box.left + rect.x * scale,
      y: box.top + rect.y * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    };
  }

  /** A control's rectangle in backbuffer px, or null when this layout has none. */
  private controlLayoutRect(name: ControlName): Rect | null {
    const l = this.layout;
    switch (name) {
      case 's1':
      case 's2':
      case 'ss':
        return l.shots.find((s) => s.shot === name)?.rect ?? null;
      case 'mute':
      case 'help':
      case 'chat':
        return l.toggles[name];
      case 'fire':
      case 'skip':
      case 'moveLeft':
      case 'moveRight':
      case 'angleUp':
      case 'angleDown':
      case 'dial':
        return l[name];
      default:
        return l.items[Number(name.slice('item'.length))] ?? null;
    }
  }

  /**
   * The window changed shape: re-lay the HUD, tell the camera how much map it can see
   * now, and hand the DOM layers over the canvas the two numbers they cannot work out
   * for themselves (the scale, and how tall the bottom bar is in CSS px).
   */
  private onViewResize(size: ViewSize): void {
    this.layout = bottomBarLayout(size, this.touchScreen);
    this.camera.setViewSize(size.width, size.height);
    this.publishMetrics();
  }

  /**
   * CSS custom properties on the host, for the DOM overlays that sit on the canvas (the
   * chat log, the forfeit button): they are laid out in CSS px and the HUD is laid out
   * in backbuffer px, and this is the only place that knows both.
   */
  private publishMetrics(): void {
    const scale = this.backbuffer.scale;
    const size = this.backbuffer.size;
    const style = this.host.style;
    style.setProperty('--hud-scale', `${scale}`);
    // From the top of the owner tab, which stands proud of the bar itself.
    style.setProperty('--hud-bar-h', `${Math.round((size.height - this.layout.top) * scale)}px`);
  }

  /**
   * The power bar as the local input holds it right now, or 0 when nothing is being
   * charged. Read by the debug probe (DESIGN §7 item 53) so a test can tell "the
   * charge key was seen" from "the frame swallowed it"; the HUD draws it from the same
   * two fields.
   */
  get chargePower(): number {
    return this.charging ? this.power : 0;
  }

  // ------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    // The unlock has to happen in the event handler's own call stack (DESIGN §7 item
    // 156): Safari starts an AudioContext only while a user gesture is being handled,
    // and by the time the animation frame runs there is no gesture left.
    const unlock = (): void => {
      this.sfx.unlock();
      appMusic().unlock();
    };
    this.keyboard.attach(unlock);
    this.pointer.attach(this.backbuffer.canvas, (x, y) => this.backbuffer.toBackbuffer(x, y), {
      onGesture: unlock,
      keepsFocus: (p) => this.isChatToggle(p.x, p.y),
      onRelease: (p) => this.releaseChatToggle(p),
    });
    // The first frame waits for the map's pictures (or `mapArt.preloadTimeoutMs`), so a
    // match opens on its painted ground rather than flipping to it a moment later.
    void waitForMapArt(this.map).then(() => {
      if (!this.running) return;
      this.adoptLateArt();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    });
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.keyboard.detach();
    this.pointer.detach();
    this.sfx.destroy();
    this.unsubscribeResize();
    this.backbuffer.destroy();
  }

  /** Swap in a different match (a new sandbox round, or a fresh `matchStart`). */
  setMatch(state: MatchState, map: MapDef = this.map): void {
    const mapChanged = map !== this.map;
    this.match = state;
    this.map = map;
    if (mapChanged) {
      // A different map is a different sky, a different parallax and a different set of
      // scroll limits. The networked match rebuilds the whole scene on `matchStart`
      // (DESIGN §7 item 52) so this only bites an in-place swap, but a swap that kept
      // the old mountains and the old camera bounds would be a puzzle to debug.
      this.background.setMap(map);
      this.camera.setMapSize(map.width, map.height);
    }
    if (mapChanged) void preloadMapArt(map);
    this.terrainRenderer.setTerrain(state.terrain, map.palette, this.terrainArt(map));
    this.effects.clear();
    this.skyRenderer.clear();
    this.resetControl();
    this.notices = [];
    this.banner = null;
    this.itemFlash = null;
    this.centreOnFocus();
  }

  /** The whole terrain changed under us (a resync or a requested mask). */
  refreshTerrain(): void {
    this.terrainRenderer.setTerrain(this.match.terrain, this.map.palette, this.terrainArt(this.map));
  }

  /**
   * Stop listening to the window's size for a moment (DESIGN §7 item 148): the chat
   * line is open and the virtual keyboard has taken half the viewport.
   */
  setLayoutFrozen(frozen: boolean): void {
    this.backbuffer.setFrozen(frozen);
  }

  resetControl(): void {
    this.roles.clear();
    this.aimDragging = false;
    this.aimHoldSince = null;
    this.charging = false;
    this.chargeArmed = false;
    this.chargeAborted = false;
    this.sfx.endCharge();
    this.power = 0;
    this.chargeSendMs = 0;
    this.firePressed = false;
    this.angleHold = 0;
    this.moveHold = 0;
    this.aimTarget = null;
    this.acceptedInput = false;
    this.targeting = null;
    this.keyboard.resetMove();
  }

  /**
   * Put a line in the stack under the banner. `flash` is the old one-line API the
   * sandbox still calls; both end up in the same queue so two events in the same tick
   * cannot overwrite one another.
   */
  notice(text: string, color: string = clientConstants.hud.accent, big = false): void {
    const n = clientConstants.hud.notices;
    this.notices.unshift({ text, color, life: big ? n.bigFrames : n.frames, big });
    while (this.notices.length > n.max) this.notices.pop();
  }

  flash(text: string): void {
    this.notice(text);
  }

  /**
   * A refusal: the line in the notice stack and the "no" blip together, so a press that
   * did nothing is never silent *and* off screen.
   */
  private refuse(text: string, color: string = clientConstants.hud.warn): void {
    this.notice(text, color);
    this.sfx.ui('denied');
  }

  /** Feed simulation events to the terrain patcher, the camera and the effects. */
  handleEvents(events: readonly SimEvent[]): void {
    if (events.length === 0) return;
    const hud = clientConstants.hud;
    for (const e of events) {
      if (e.t === 'carve') this.terrainRenderer.patchCircle(e.x, e.y, e.r);
      else if (e.t === 'timerWarning') this.notice(`${e.secondsLeft} SECONDS`);
      else if (e.t === 'windChange') this.notice(`WIND ${e.strength}`);
      else if (e.t === 'turnEnd') this.notice(`+${Math.round(e.cost)} DELAY`);
      else if (e.t === 'itemUsed') this.noteItemUsed(e.seat, e.itemId);
      else if (e.t === 'heal') this.noteHeal(e.seat, e.amount);
      else if (e.t === 'skyChange') {
        // Weather comes and goes at turn ends (DESIGN §5).
        if (e.kind === 'none') this.notice(`${skyEventTitle(e.previous)} PASSES — CLEAR SKY`);
        else this.notice(`${skyEventTitle(e.kind)} ROLLS IN — ${e.turnsLeft} TURNS`, hud.warn, true);
      } else if (e.t === 'suddenDeath') {
        this.notice(`SUDDEN DEATH ${e.level} — DAMAGE x${e.multiplier}`, hud.warn, true);
      } else if (e.t === 'matchEnd') this.notices = [];
    }
    this.director.consume(events);
    this.effects.consume(events);
    this.skyRenderer.consume(events);
    // Sound last, so an event that is going to be ignored above is ignored here too:
    // the mapping (`audio/sfx.ts`) decides what a tick sounds like, this only hands it
    // the same list the renderer got.
    this.sfx.events(events, this.driver.controlledSeat());
  }

  /**
   * An item went off (DESIGN §6.2 `itemUsed`): name it in the notice stack, and flash
   * the slot it came out of when it was one of ours.
   */
  private noteItemUsed(seat: number, itemId: ItemId): void {
    const slot = slotOfSeat(this.match, seat);
    const name = getItemDef(itemId).displayName.toUpperCase();
    const who = slot ? slot.nick : `SEAT ${seat}`;
    this.notice(`${who} USED ${name}`);
    if (seat !== this.driver.controlledSeat() || !slot) return;
    // The slot that was spent is the first unspent copy of that id, which is the same
    // copy `itemsRemaining` hands out (DESIGN §7 item 92).
    const layout = layoutLoadout(slot.items);
    const used = markUsed(slot.items, itemsRemaining(this.match, seat));
    for (const entry of layout) {
      if (entry.itemId === itemId && used[entry.order] === true) {
        this.itemFlash = { index: entry.index, frame: this.frameTick };
        break;
      }
    }
  }

  /** A heal (DESIGN §4): the number floats over the mobile that gained it. */
  private noteHeal(seat: number, amount: number): void {
    if (amount <= 0) return;
    const m = mobileOfSeat(this.match, seat);
    if (!m) return;
    this.effects.floatText(
      m.x,
      m.y - clientConstants.effects.hullHeightPx,
      `+${Math.round(amount)}`,
      clientConstants.effects.colors.heal,
    );
  }

  // ------------------------------------------------------------------------
  // Seats and focus
  // ------------------------------------------------------------------------

  private focusSeat(): number {
    return this.driver.focusSeat ? this.driver.focusSeat() : this.driver.controlledSeat();
  }

  private focusMobile(): MobileState | undefined {
    return mobileOfSeat(this.match, this.focusSeat());
  }

  private focusPoint(): { x: number; y: number } {
    const m = this.focusMobile();
    if (!m) return { x: this.map.width / 2, y: this.map.height / 2 };
    return { x: m.x, y: m.y - clientConstants.camera.focusHeightPx };
  }

  centreOnFocus(): void {
    const p = this.focusPoint();
    this.director.centreOn(p.x, p.y);
  }

  private sheetFor(id: MobileId): SpriteSheet {
    const cached = this.sheets.get(id);
    if (cached) return cached;
    const ref: SpriteRef = getMobileDef(id).sprite;
    const sheet = createSpriteSheet(ref);
    this.sheets.set(id, sheet);
    return sheet;
  }

  /**
   * The angle to draw for a seat: what the player is asking for while an `aim` is in
   * flight, otherwise what the simulation holds. Only the controlled seat can have an
   * angle in flight.
   */
  private displayRelAngle(m: MobileState): number {
    if (this.aimTarget !== null && m.seat === this.driver.controlledSeat()) return this.aimTarget;
    return m.relAngle;
  }

  // ------------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------------

  private send(intent: Intent): void {
    this.driver.sendIntent(intent);
  }

  /**
   * Tab: S1 → S2 → SS → S1, skipping an SS the gauge has not unlocked yet.
   *
   * The simulation ignores a `selectShot` of a locked SS outright (DESIGN §7 item 21),
   * so cycling onto it would look like a key that does nothing. Skipping it and saying
   * why is the honest version of the same rule.
   */
  private cycleShot(): void {
    const seat = this.driver.controlledSeat();
    const slot = slotOfSeat(this.match, seat);
    if (!slot) return;
    let index = SHOT_ORDER.indexOf(slot.shot);
    for (let i = 0; i < SHOT_ORDER.length; i++) {
      index = (index + 1) % SHOT_ORDER.length;
      const next = SHOT_ORDER[index] ?? 's1';
      if (next === 'ss' && !ssAvailable(this.match, seat)) {
        this.notice('SS NOT READY', clientConstants.hud.muted);
        continue;
      }
      this.send({ t: 'selectShot', seat, shot: next });
      return;
    }
  }

  /**
   * The three buttons that are live at every phase: sound, the controls card and the
   * chat line. They are handled apart from the bar because they must work while it is
   * greyed out — a player watching the opponent's turn may still mute or chat.
   */
  private pressToggle(toggle: ToggleName): void {
    switch (toggle) {
      case 'mute':
        this.setSound(cycleSoundMode());
        return;
      case 'help':
        this.helpOpen = !this.helpOpen;
        this.sfx.ui('click');
        return;
      case 'chat':
        if (!this.driver.onChatToggle) return;
        this.sfx.ui('click');
        this.driver.onChatToggle();
        return;
    }
  }

  /** Is this backbuffer point on the chat button? */
  private isChatToggle(x: number, y: number): boolean {
    const target = hudHitTest(this.layout, x, y);
    return target?.kind === 'toggle' && target.toggle === 'chat';
  }

  /**
   * The chat button acts on its *release*, inside the `pointerup` handler (DESIGN §7
   * item 166). Focusing the chat line raises the iOS keyboard only from the handler of
   * the gesture itself — for a finger that is the release, not the press — and a focus
   * from the next animation frame opened the line with no keyboard under it. Pressing
   * it again closes the line: the press no longer blurs the field first, so the toggle
   * sees it open.
   */
  private releaseChatToggle(p: PointerSample): void {
    if (!this.isChatToggle(p.startX, p.startY) || !this.isChatToggle(p.x, p.y)) return;
    this.pressToggle('chat');
  }

  /** Sound effects off: the sound mode's `off` step (the HUD and the help card ask). */
  get muted(): boolean {
    return this.sound === 'off';
  }

  /** Apply a new sound mode to the synth, the music, the HUD and the notice stack. */
  private setSound(mode: SoundMode): void {
    this.sound = mode;
    this.sfx.setMuted(mode === 'off');
    appMusic().setEnabled(mode === 'on');
    // After the synth, so the click is heard on the way *out* of mute and not into it.
    this.sfx.ui('click');
    const text = mode === 'on' ? 'SOUND ON' : mode === 'noMusic' ? 'MUSIC OFF' : 'SOUND OFF';
    this.notice(text, clientConstants.hud.muted);
  }

  private pressHud(target: HudTarget): void {
    const seat = this.driver.controlledSeat();
    switch (target.kind) {
      case 'toggle':
        // The chat button is the exception: it acts on the release, in the event
        // handler itself (`releaseChatToggle`).
        if (target.toggle !== 'chat') this.pressToggle(target.toggle);
        break;
      case 'shot':
        if (target.shot === 'ss' && !ssAvailable(this.match, seat)) {
          this.notice('SS NOT READY', clientConstants.hud.muted);
          this.sfx.ui('denied');
          break;
        }
        this.sfx.ui('select');
        this.send({ t: 'selectShot', seat, shot: target.shot });
        break;
      case 'fire':
        // The hold itself is tracked per pointer (`syncHolds`); this only arms it.
        this.chargeArmed = true;
        break;
      case 'skip':
        this.sfx.ui('click');
        this.send({ t: 'skip', seat });
        break;
      case 'angle':
        this.nudgeAim(target.delta * clientConstants.input.aimDegPerTap, true);
        break;
      case 'move':
      case 'aim':
        // Both are pure holds: the per-frame work is in `applyPointerHolds`.
        break;
      case 'item':
        this.pressItem(target.index);
        break;
    }
  }

  // ------------------------------------------------------------------------
  // Pointers (DESIGN §7 item 144)
  // ------------------------------------------------------------------------

  /**
   * What a fresh press means. The HUD widget under it is the role, with two exceptions
   * handled by the caller: a press on the world is a camera drag (or a teleport spot),
   * and a widget that acts at once — a shot key, an item, a toggle — is a `tap`.
   */
  private roleFor(target: HudTarget, sample: PointerSample): PointerRole {
    switch (target.kind) {
      case 'fire':
        return { kind: 'fire', frame: this.frameTick };
      case 'angle':
        return { kind: 'angle', delta: target.delta };
      case 'move':
        return { kind: 'move', dir: target.dir };
      case 'item':
        return { kind: 'item', index: target.index };
      case 'aim': {
        const m = mobileOfSeat(this.match, this.driver.controlledSeat());
        return {
          kind: 'aim',
          startY: sample.y,
          startAngle: this.aimTarget ?? m?.relAngle ?? 0,
        };
      }
      default:
        return { kind: 'tap' };
    }
  }

  /**
   * The three latched controls, recomputed from whichever pointers are still down.
   *
   * Derived rather than toggled, because two fingers may be on the same control and one
   * of them lifting must not release it — and because a pointer that was cancelled by
   * the browser never sends the release that a toggle would have needed.
   */
  private syncHolds(): void {
    let fire = false;
    let angle: -1 | 0 | 1 = 0;
    let move: -1 | 0 | 1 = 0;
    let aim = false;
    for (const role of this.roles.values()) {
      if (role.kind === 'fire') fire = true;
      else if (role.kind === 'angle') angle = role.delta;
      else if (role.kind === 'move') move = role.dir;
      else if (role.kind === 'aim') aim = true;
    }
    this.firePressed = fire;
    this.angleHold = angle;
    this.moveHold = move;
    this.aimDragging = aim;
  }

  /** Is a pointer already panning the camera? */
  private hasDrag(): boolean {
    for (const role of this.roles.values()) if (role.kind === 'drag') return true;
    return false;
  }

  /** Every pointer that is still down, once per frame: drags and the aim sweep. */
  private applyPointerHolds(): void {
    for (const [id, role] of this.roles) {
      const sample = this.pointer.active.get(id);
      if (!sample) continue;
      if (role.kind === 'drag') {
        if (!role.started) {
          // Not a drag until it has moved: a tap on the world is how a player dismisses
          // the chat line, and it should leave the camera following the action.
          if (isTap(sample, sample.x, sample.y)) continue;
          role.started = true;
          this.director.beginDrag(role.startX, role.startY, {
            resolving: this.match.phase === 'resolving',
          });
        }
        this.director.dragTo(sample.x, sample.y);
      } else if (role.kind === 'aim') {
        // Absolute, not incremental: the angle is a function of how far the finger has
        // travelled from where it landed, so a sweep that overshoots comes back to the
        // same number instead of drifting.
        const dragged = (role.startY - sample.y) * clientConstants.input.aimDragDegPerPx;
        this.setAim(role.startAngle + dragged, false);
      }
    }
  }

  /** The point the teleport crosshair is at: a finger holding it, or the mouse. */
  private crosshair(): { x: number; y: number } | null {
    for (const [id, role] of this.roles) {
      if (role.kind !== 'target') continue;
      const sample = this.pointer.active.get(id);
      if (sample) return { x: sample.x, y: sample.y };
    }
    return this.pointer.inside ? { x: this.pointer.x, y: this.pointer.y } : null;
  }

  // ------------------------------------------------------------------------
  // Items (DESIGN §4)
  // ------------------------------------------------------------------------

  /** The controlled seat's loadout, laid out over the six slots. */
  private itemLayout(): LoadoutSlot[] {
    const slot = slotOfSeat(this.match, this.driver.controlledSeat());
    return slot ? layoutLoadout(slot.items) : [];
  }

  /**
   * Key 1–6 or a click on a slot. An item that needs a point (Teleport) opens the
   * targeting mode instead of going out immediately; everything else is a `useItem`
   * on the spot, validated first so a refusal costs a line of text and not a round trip.
   */
  private pressItem(index: number): void {
    if (this.driver.onItem) {
      this.driver.onItem(index);
      return;
    }
    const seat = this.driver.controlledSeat();
    const entry = slotAt(this.itemLayout(), index);
    if (!entry) {
      this.refuse('EMPTY SLOT', clientConstants.hud.muted);
      return;
    }
    const def = getItemDef(entry.itemId);
    // Pressing the slot that is already asking for a point puts the crosshair away.
    if (this.targeting === entry.itemId) {
      this.cancelTargeting();
      return;
    }
    // This *copy*, not just this id. A loadout may hold the same one-slot item twice
    // (DESIGN §7 item 98) and the row draws the earlier copy struck through once it is
    // spent; `canUseItem` only counts copies, so without this the greyed slot would
    // quietly spend the one next to it.
    const slot = slotOfSeat(this.match, seat);
    const spent = slot ? markUsed(slot.items, itemsRemaining(this.match, seat)) : [];
    if (spent[entry.order]) {
      this.refuse(rejectionText.alreadySpent);
      return;
    }
    // A heal at full HP is legal — the simulation has no rule against it — and would
    // spend the entry and bank its delay for nothing. Stopped here, the way a locked SS
    // is (DESIGN §7 item 102), so the shared rule stays one that no engine can disagree
    // with while the player keeps the item.
    if ((def.params.heal ?? 0) > 0) {
      const m = mobileOfSeat(this.match, seat);
      if (m && m.hp >= getMobileDef(m.defId).hp) {
        this.refuse('ALREADY AT FULL HP');
        return;
      }
    }
    const check = canUseItem(this.match, seat, entry.itemId);
    // `targetRequired` is the only refusal that means "so far so good": every other
    // prerequisite passed and the item is simply waiting for its point.
    if (!check.ok && check.reason !== 'targetRequired') {
      this.refuse(rejectionText[check.reason]);
      return;
    }
    if (def.needsTarget) {
      this.targeting = entry.itemId;
      this.sfx.ui('select');
      this.notice(`${def.displayName.toUpperCase()}: PICK A SPOT · THE SLOT AGAIN CANCELS`);
      return;
    }
    this.sfx.ui('select');
    this.send({ t: 'useItem', seat, itemId: entry.itemId });
  }

  private cancelTargeting(): void {
    if (this.targeting === null) return;
    this.targeting = null;
    this.notice('CANCELLED', clientConstants.hud.muted);
  }

  /** The world point under the crosshair, in simulation coordinates. */
  private pointerTarget(point: { x: number; y: number }): ItemTarget {
    return this.camera.screenToWorld(point.x, point.y);
  }

  /**
   * Why the point under the pointer would be refused, or null when it is legal. Uses
   * the shared rule (`checkTeleportTarget`), so the crosshair and the simulation can
   * never disagree about what a legal landing spot is.
   */
  private targetRejection(target: ItemTarget): ItemRejection | null {
    const seat = this.driver.controlledSeat();
    const m = mobileOfSeat(this.match, seat);
    if (!m || !m.alive) return 'deadMobile';
    return checkTeleportTarget(this.match, m, getMobileDef(m.defId), target);
  }

  /** A click on the world while an item is waiting for its point. */
  private pressTarget(x: number, y: number): void {
    const itemId = this.targeting;
    if (itemId === null) return;
    const seat = this.driver.controlledSeat();
    const target = this.camera.screenToWorld(x, y);
    const bad = this.targetRejection(target);
    if (bad) {
      this.refuse(rejectionText[bad]);
      return;
    }
    this.targeting = null;
    this.send({ t: 'useItem', seat, itemId, target: { x: target.x, y: target.y } });
  }

  /**
   * Move the requested angle by `delta`, clamped to the mobile's range, and put it on
   * the wire no faster than the authority accepts it (`aimSendMs`). `force` sends
   * immediately, which is what a single tap of the arrow button wants.
   */
  private nudgeAim(delta: number, force: boolean): void {
    const m = mobileOfSeat(this.match, this.driver.controlledSeat());
    if (!m) return;
    this.setAim((this.aimTarget ?? m.relAngle) + delta, force);
  }

  /**
   * Ask for an absolute angle, clamped to the mobile's range. The drag pad works this
   * way (DESIGN §7 item 146); the arrow keys and buttons go through `nudgeAim`, which
   * is the same thing relative to where the aim already is.
   */
  private setAim(relAngle: number, force: boolean): void {
    const seat = this.driver.controlledSeat();
    const m = mobileOfSeat(this.match, seat);
    if (!m) return;
    const def = getMobileDef(m.defId);
    const next = clamp(relAngle, def.angleMin, def.angleMax);
    this.aimTarget = next;
    const minGap = this.driver.aimSendMs ?? 0;
    const now = performance.now();
    if (force || minGap <= 0 || now - this.lastAimSentAt >= minGap) {
      this.lastAimSentAt = now;
      this.send({ t: 'aim', seat, relAngle: next });
    }
  }

  /** The simulation caught up with the requested angle: stop overriding it. */
  private settleAim(): void {
    if (this.aimTarget === null) return;
    const m = mobileOfSeat(this.match, this.driver.controlledSeat());
    if (!m) {
      this.aimTarget = null;
      return;
    }
    if (Math.abs(m.relAngle - this.aimTarget) < 1e-9) this.aimTarget = null;
  }

  private handleDiscreteInput(): void {
    const accepts = this.driver.acceptsInput();
    // Belt and braces. The unlock that counts is the one `start` hands to the two input
    // modules, which fires inside the event handler; this catches a synth that was
    // created before the first gesture and costs nothing when it is already running.
    if (this.pointer.anyPressed || this.keyboard.anyPressed()) this.sfx.unlock();

    // Pointers: HUD widgets first, then the world (a camera drag). Every one of them
    // gets a role and keeps it until it comes up, so two fingers can work two controls.
    for (const p of this.pointer.downs) {
      const target = hudHitTest(this.layout, p.x, p.y);
      if (target) {
        // Items and the three toggles work while the bar is greyed out: a player
        // watching the opponent's turn may still mute, chat or read a tooltip.
        if (!accepts && target.kind !== 'item' && target.kind !== 'toggle') continue;
        const role = this.roleFor(target, p);
        this.roles.set(p.id, role);
        // Everything but a loadout slot acts on the way down; see `PointerRole`.
        if (role.kind !== 'item') this.pressHud(target);
        continue;
      }
      if (hudBlocksDrag(this.layout, p.x, p.y)) continue;
      // A press on the world picks the teleport spot while an item is asking for one,
      // and drags the camera the rest of the time.
      if (this.targeting !== null && accepts) {
        this.roles.set(p.id, { kind: 'target' });
        continue;
      }
      // One drag at a time: a second finger on the world while the first is panning
      // would fight it for the same camera.
      if (this.hasDrag()) continue;
      this.roles.set(p.id, { kind: 'drag', startX: p.x, startY: p.y, started: false });
    }

    for (const p of this.pointer.ups) {
      const role = this.roles.get(p.id);
      this.roles.delete(p.id);
      if (!role) continue;
      const outcome = releaseOutcome(role, p, this.frameTick);
      switch (outcome.kind) {
        case 'endDrag':
          this.director.endDrag();
          break;
        case 'commitTarget':
          this.pressTarget(outcome.x, outcome.y);
          break;
        case 'useItem':
          this.pressItem(outcome.index);
          break;
        case 'abortCharge':
          // A cancelled pointer was never released on purpose (DESIGN §7 item 168):
          // `updateCharge` ends the charge without shooting it.
          this.chargeAborted = true;
          break;
        case 'fireTooShort':
          // A press and a release of FIRE inside one frame never reaches `updateCharge`,
          // which reads the hold once a frame: the power would be zero and the shot would
          // never happen. Say so rather than eat the press in silence.
          if (accepts) this.refuse('HOLD FIRE TO CHARGE');
          break;
        case 'none':
          break;
      }
    }

    // Every frame, not only on an edge: the holds are derived from the role map, and a
    // role the browser dropped without a release (a lost capture, a cancelled pointer)
    // must not leave the walk arrow latched for the rest of the turn.
    this.syncHolds();
    this.applyPointerHolds();

    const seat = this.driver.controlledSeat();
    if (this.keyboard.pressed('cancel')) this.cancelTargeting();
    if (this.keyboard.pressed('charge') && accepts) this.chargeArmed = true;
    if (this.keyboard.pressed('cycleShot') && accepts) this.cycleShot();
    if (this.keyboard.pressed('skip') && accepts) this.send({ t: 'skip', seat });
    for (let i = 0; i < itemActions.length; i++) {
      const action = itemActions[i];
      if (action && this.keyboard.pressed(action)) this.pressItem(i);
    }
    // The crosshair belongs to a turn: losing the turn (or the mobile) drops it.
    if (this.targeting !== null && !accepts) this.targeting = null;
    if (this.keyboard.pressed('freeCamera')) this.director.toggleFree();
    if (this.keyboard.pressed('mute')) this.setSound(cycleSoundMode());
    if (this.keyboard.pressed('help')) this.pressToggle('help');

    this.driver.onInput?.(this.keyboard);
  }

  /**
   * The charge, in real time (DESIGN §2.10). `charging` intents keep the simulation
   * informed a few times a second so a timer expiry fires the shot instead of skipping
   * it (DESIGN §7 items 3 and 18); the release is the only thing that fires.
   */
  private updateCharge(elapsedMs: number): void {
    const allowed = this.driver.acceptsInput();
    const seat = this.driver.controlledSeat();
    // A cancelled FIRE finger disarms the whole charge, even if another finger (or the
    // key) is still down: the player has to press again to charge again.
    const aborted = this.chargeAborted;
    this.chargeAborted = false;
    if (aborted) this.chargeArmed = false;
    const held = this.keyboard.isDown('charge') || this.firePressed;
    // Letting go disarms; only a fresh press while this seat may act arms again.
    if (!held) this.chargeArmed = false;
    const wants = allowed && held && this.chargeArmed;

    if (wants) {
      if (!this.charging) {
        this.charging = true;
        this.power = 0;
        this.chargeSendMs = CHARGE_SEND_MS;
      }
      // Hold at the top rather than bouncing back (DESIGN §7 item 2).
      this.power = clamp(this.power + elapsedMs * POWER_PER_MS, 0, 1);
      // Rising pitch with a click at each major bar (DESIGN §2.10).
      this.sfx.charge(this.power);
      this.chargeSendMs += elapsedMs;
      if (this.chargeSendMs >= CHARGE_SEND_MS) {
        this.chargeSendMs = 0;
        this.send({ t: 'charging', seat, power: quantisePower(this.power) });
      }
      return;
    }

    if (!this.charging) return;
    this.charging = false;
    // This charge is spent, whether it fired or the turn was taken away mid-hold. The
    // release itself is silent: the shot's own `fire` event is the sound of it.
    this.sfx.endCharge();
    this.chargeArmed = false;
    if (allowed) {
      // The charge is over whatever happens next. Reported before the `fire` so that a
      // shot the authority never accepts — a refused SS, a message lost in a reconnect —
      // cannot leave every engine holding a stale power and firing it 20 s later on the
      // timer (DESIGN §6.1 `charging`, §7 item 31). The `fire` below overrides it.
      this.send({ t: 'charging', seat, power: NOT_CHARGING });
      if (aborted) {
        this.notice('SHOT CANCELLED', clientConstants.hud.muted);
        this.power = 0;
        this.firePressed = false;
        return;
      }
      const slot = slotOfSeat(this.match, seat);
      const m = mobileOfSeat(this.match, seat);
      const shot: ShotSlot = slot ? slot.shot : 's1';
      // The SS gate again, at the trigger (DESIGN §2.9): the server refuses it too, but
      // a shot that vanished into the socket would cost the player their whole charge
      // with nothing on screen to explain it. Asked about the key that will actually be
      // fired — a Dual+ turn fires S1 whatever is selected (§7 item 95) — so this gate
      // refuses exactly what `performFire` and the server refuse, and nothing more.
      const firstShot: ShotSlot = this.match.turnMods.dualPlus ? 's1' : shot;
      if (m && firstShot === 'ss' && !ssAvailable(this.match, seat)) {
        this.refuse('SS NOT READY');
      } else if (m) {
        this.send({
          t: 'fire',
          seat,
          shot,
          relAngle: this.aimTarget ?? m.relAngle,
          power: quantisePower(this.power),
        });
      }
    }
    this.power = 0;
    this.firePressed = false;
  }

  // ------------------------------------------------------------------------
  // The loop
  // ------------------------------------------------------------------------

  /**
   * The two controls that are *held* rather than pressed — the walk direction and the
   * aim ramp — put on the wire once per rendered **frame** (DESIGN §7 item 154).
   *
   * Not once per simulated tick, which is where this used to live. The local clock is
   * capped at the authority's (`MatchViewDriver.tickCap`), and while the mobile walks
   * the server echoes its position ten times a second: each echo steps this engine
   * straight to the tick it names, so the local sim sits *exactly* on the cap and the
   * tick loop stops running. Reading the held controls from in there meant that the
   * release of the walk key — the `move dir: 0` that stops the mobile — was never
   * sampled, and the walk ran on until the whole gauge was spent. Nothing here needs a
   * tick anyway: an intent is a message about what the player is doing *now*, and the
   * authority decides which of its own ticks to apply it on.
   */
  private sendHeldIntents(elapsedMs: number): void {
    const seat = this.driver.controlledSeat();
    const accepts = this.driver.acceptsInput();
    if (accepts && !this.acceptedInput) {
      // Everything sent while the seat was not accepting was dropped, so the held
      // direction has to be announced again now that it counts.
      this.keyboard.resetMove();
    }
    this.acceptedInput = accepts;

    const m = mobileOfSeat(this.match, seat);
    if (accepts && m && m.alive) {
      const moveIntent = this.keyboard.moveIntent(seat, this.moveHold);
      if (moveIntent) this.send(moveIntent);

      const aimUp = this.keyboard.isDown('aimUp') || this.angleHold === 1;
      const aimDown = this.keyboard.isDown('aimDown') || this.angleHold === -1;
      if (aimUp !== aimDown) {
        // Held longer means faster (DESIGN §7 item 145), so the whole range is
        // reachable with one press without losing the single-degree correction. The
        // step is quoted per tick and scaled by how long this frame was, so the sweep
        // runs at the same speed on a 60 Hz screen, a 120 Hz one and a stalled one.
        const now = performance.now();
        if (this.aimHoldSince === null) this.aimHoldSince = now;
        const factor = aimHoldFactor(now - this.aimHoldSince);
        const ticks = elapsedMs / constants.tickMs;
        this.nudgeAim(
          (aimUp ? 1 : -1) * clientConstants.input.aimDegPerTick * factor * ticks,
          false,
        );
      } else {
        this.aimHoldSince = null;
      }
    } else {
      this.aimHoldSince = null;
    }
    this.settleAim();
  }

  private simulateTick(): void {
    const events = step(this.match);
    this.handleEvents(events);
    this.driver.onTick?.(events);
    this.effects.trail(this.match.projectiles);
    this.effects.step();
  }

  /**
   * Age the notice stack. It runs on rendered frames rather than simulated ticks so a
   * message about a turn that has just ended does not sit frozen on screen while the
   * local clock waits for the authority (DESIGN §7 item 45).
   */
  private ageNotices(): void {
    for (let i = this.notices.length - 1; i >= 0; i--) {
      const notice = this.notices[i];
      if (!notice) continue;
      notice.life--;
      if (notice.life <= 0) this.notices.splice(i, 1);
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.adoptLateArt();
    const elapsed = Math.min(now - this.last, clientConstants.loop.maxFrameMs);
    this.last = now;
    this.accumulator += elapsed;
    this.frameTick++;

    this.handleDiscreteInput();
    this.updateCharge(elapsed);
    this.sendHeldIntents(elapsed);

    let ticks = 0;
    const cap = this.driver.tickCap?.() ?? null;
    while (
      this.accumulator >= constants.tickMs &&
      ticks < clientConstants.loop.maxTicksPerFrame
    ) {
      if (cap !== null && this.match.tick >= cap) {
        // Waiting for the authority's clock to move on: keep at most one tick of
        // credit so the sim does not sprint once it is allowed to run again.
        this.accumulator = Math.min(this.accumulator, constants.tickMs);
        break;
      }
      this.accumulator -= constants.tickMs;
      this.simulateTick();
      ticks++;
    }
    // A long stall (tab in the background) drops its backlog instead of fast-forwarding.
    if (ticks >= clientConstants.loop.maxTicksPerFrame) this.accumulator = 0;
    this.ageNotices();
    // The music follows the match (DESIGN §8.3): the map's track, sudden death's, the
    // results'. Read off the state every frame, so a resync lands on the right one.
    appMusic().setTrack(trackFor(matchScene(this.match, this.driver.matchOver?.())));
    this.keyboard.endFrame();
    this.pointer.endFrame();

    const focus = this.focusPoint();
    this.director.update({
      focusX: focus.x,
      focusY: focus.y,
      projectiles: this.match.projectiles,
      resolving: this.match.phase === 'resolving',
      pointer: { x: this.pointer.x, y: this.pointer.y, inside: this.pointer.inside },
    });

    this.ctx.fillStyle = clientConstants.canvas.background;
    this.ctx.fillRect(0, 0, this.backbuffer.width, this.backbuffer.height);
    this.drawWorld();
    this.drawHud();
  };

  // ------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------

  private drawAimLine(): void {
    const seat = this.focusSeat();
    const m = mobileOfSeat(this.match, seat);
    if (!m || !m.alive || this.match.phase === 'ended') return;
    const angle = worldAngleDeg(m, this.displayRelAngle(m));
    // The same muzzle the sim spawns the shell from, so the line starts at the shot.
    const muzzle = muzzlePosition(m, getMobileDef(m.defId), angle);
    const pixels = aimArrowPixels(
      muzzle.x - this.camera.offsetX,
      muzzle.y - this.camera.offsetY,
      cosDeg(angle),
      -sinDeg(angle),
    );
    drawAimArrow(this.ctx, pixels);
  }

  private drawWorld(): void {
    const ctx = this.ctx;
    this.background.draw(ctx, this.camera);
    // The sky event sits between the background and the terrain (DESIGN §5).
    this.skyRenderer.draw(ctx, this.camera, this.match.sky, this.map, this.frameTick);
    this.terrainRenderer.draw(ctx, this.camera);

    const focus = this.focusSeat();
    for (const m of this.match.mobiles) {
      if (!m) continue;
      if (!this.camera.isVisible(m.x, m.y, clientConstants.sandbox.cullMarginPx)) continue;
      const screenX = this.camera.worldToScreenX(m.x);
      const screenY = this.camera.worldToScreenY(m.y);
      if (m.seat === focus && m.alive && this.match.phase !== 'ended') {
        drawSelectionRing(
          ctx,
          screenX,
          screenY,
          this.frameTick * clientConstants.sandbox.ringPhasePerTick,
        );
      }
      const blender = blenderSheetFor(m.defId);
      if (blender) {
        // The simulation publishes the active seat's charge, so every client sees the wind-up.
        const charging = this.match.chargingPower >= 0 && m.seat === this.match.activeSeat;
        drawBlenderMobile(ctx, blender, m, this.displayRelAngle(m), screenX, screenY, charging);
      } else drawMobile(ctx, this.sheetFor(m.defId), m, screenX, screenY);
      const slot = slotOfSeat(this.match, m.seat);
      if (slot && m.alive) {
        drawMobileTag(
          ctx,
          { nick: slot.nick, team: slot.team, active: m.seat === focus },
          m,
          getMobileDef(m.defId),
          screenX,
          screenY,
        );
      }
    }

    this.drawAimLine();

    // Mines first, so a shell flying over one draws on top of it.
    for (const mine of this.match.mines) {
      if (!mine) continue;
      drawMine(
        ctx,
        mine.sprite,
        this.camera.worldToScreenX(mine.x),
        this.camera.worldToScreenY(mine.y),
        this.match.tick,
      );
    }

    for (const p of this.match.projectiles) {
      if (!p || !p.alive) continue;
      drawProjectile(
        ctx,
        p,
        this.camera.worldToScreenX(p.x),
        this.camera.worldToScreenY(p.y),
      );
    }

    this.effects.draw(ctx, this.camera);
    this.drawTargeting();
  }

  /**
   * Put up the turn banner when a turn starts: YOUR TURN, or the nick of whoever's turn
   * it is. Keyed on the turn number and the seat, so a resync inside the same turn does
   * not announce it twice.
   */
  private updateTurnBanner(): void {
    const match = this.match;
    if (match.mode !== 'turns') return;
    if (match.phase !== 'starting' && match.phase !== 'active') return;
    const key = `${match.turn}:${match.activeSeat}`;
    if (this.banner?.key === key) return;
    const self = match.activeSeat === this.driver.controlledSeat();
    const slot = slotOfSeat(match, match.activeSeat);
    this.banner = {
      key,
      frame: this.frameTick,
      view: {
        title: self ? 'YOUR TURN' : (slot?.nick ?? `SEAT ${match.activeSeat}`),
        sub: `TURN ${Math.max(1, match.turn)}`,
        self,
      },
    };
  }

  /** The status line under the top cluster; see `drawStatusTag`. */
  private bannerText(): { text: string; self: boolean } | null {
    const override = this.driver.bannerOverride?.();
    if (override) return override;
    const match = this.match;
    if (match.mode !== 'turns') return { text: 'FREE PLAY', self: false };
    const slot = slotOfSeat(match, match.activeSeat);
    const nick = slot ? slot.nick : `seat ${match.activeSeat}`;
    switch (match.phase) {
      case 'starting':
        return { text: `TURN ${Math.max(1, match.turn)} — ${nick}`, self: false };
      case 'active':
        return {
          text: `${match.activeSeat === this.driver.controlledSeat() ? 'YOUR TURN' : 'TURN'} — ${nick}`,
          self: match.activeSeat === this.driver.controlledSeat(),
        };
      case 'resolving':
        return { text: 'SHOT IN FLIGHT', self: false };
      case 'ending': {
        const next = upcomingOrder(match, 1)[0];
        const nextSlot = next === undefined ? undefined : slotOfSeat(match, next);
        return { text: `WAITING FOR ${nextSlot ? nextSlot.nick : '...'}`, self: false };
      }
      case 'ended':
        return null;
    }
  }

  /**
   * The player list: the seats that can still take a turn in delay order (the same
   * order the simulation will use), then the fallen, as many as the variant has rows.
   */
  private playerEntries(): OrderEntry[] {
    const match = this.match;
    const rows = orderCount(this.layout.variant);
    const seats = upcomingOrder(match, rows);
    for (const slot of match.seats) {
      if (seats.length >= rows) break;
      if (slot && !seats.includes(slot.seat)) seats.push(slot.seat);
    }
    const entries: OrderEntry[] = [];
    for (const seat of seats) {
      const slot = slotOfSeat(match, seat);
      if (!slot) continue;
      const m = mobileOfSeat(match, seat);
      const active = match.mode === 'turns' && seat === match.activeSeat;
      entries.push({
        seat,
        nick: slot.nick,
        team: slot.team,
        delay: slot.delay,
        active,
        self: seat === this.driver.controlledSeat(),
        alive: m?.alive ?? false,
        connected: slot.connected,
        hp: m?.hp ?? 0,
        hpMax: m ? getMobileDef(m.defId).hp : 1,
        status: m && m.alive ? this.statusIcons(slot, m, active) : [],
      });
    }
    return entries;
  }

  /**
   * What a seat is marked with in the player list, most telling first: this turn's items
   * on the active seat, then an SS ready to fire, a frozen hull and a shield.
   */
  private statusIcons(slot: PlayerSlot, m: MobileState, active: boolean): StatusIcon[] {
    const out: StatusIcon[] = [];
    const mods = this.match.turnMods;
    if (active && (mods.dual || mods.dualPlus)) out.push('dual');
    if (active && mods.powerUp) out.push('boost');
    if (active && mods.bunge) out.push('dig');
    if (ssReady(slot)) out.push('ssReady');
    if (m.defenceMod > 0) out.push('frozen');
    if (getMobileDef(m.defId).shieldMax > 0 && m.shield > 0) out.push('shield');
    return out;
  }

  /**
   * The six item slots (DESIGN §4).
   *
   * They always show the *controlled* seat's loadout, even while the bar beside them
   * follows the opponent's turn: keys 1–6 act on our own items, and a row that showed
   * somebody else's would be a row whose keys did something different from what it
   * drew. A spectator has no loadout of its own and watches the focused seat's.
   */
  private itemRowView(): ItemRowView {
    const seat = this.driver.controlledSeat() >= 0 ? this.driver.controlledSeat() : this.focusSeat();
    const slot = slotOfSeat(this.match, seat);
    const mine = seat === this.driver.controlledSeat();
    if (!slot) {
      return { slots: [], caption: 'no loadout', captionWarn: false, frameTick: this.frameTick };
    }

    const used = markUsed(slot.items, itemsRemaining(this.match, seat));
    const spentThisTurn =
      this.match.mode === 'turns' && this.match.turnMods.usedThisTurn.length > 0;
    const canAct = mine && this.driver.acceptsInput();

    const slots: ItemSlotView[] = [];
    for (const entry of layoutLoadout(slot.items)) {
      const isUsed = used[entry.order] === true;
      slots.push({
        index: entry.index,
        span: entry.span,
        name: getItemDef(entry.itemId).displayName,
        used: isUsed,
        enabled: canAct && !isUsed && !spentThisTurn,
        targeting: mine && this.targeting === entry.itemId && !isUsed,
        flashFrames:
          this.itemFlash && this.itemFlash.index === entry.index
            ? this.frameTick - this.itemFlash.frame
            : -1,
      });
    }

    // The caption says the one thing the slots cannot: why nothing may be pressed, or
    // what the pointer is hovering.
    let caption = `${slot.items.length === 0 ? 'no items' : 'one item per turn'}`;
    let captionWarn = false;
    if (spentThisTurn) {
      const last = this.match.turnMods.usedThisTurn[this.match.turnMods.usedThisTurn.length - 1];
      caption = last ? `used: ${getItemDef(last).displayName.toLowerCase()}` : 'item used';
      captionWarn = true;
    }
    if (mine && this.targeting !== null) {
      caption = `${getItemDef(this.targeting).displayName.toLowerCase()}: pick a spot`;
      captionWarn = false;
    }
    const hovered = this.hoveredItem();
    if (hovered) {
      const def = getItemDef(hovered.itemId);
      // What it does beats what it cost: the slots were paid for in the room.
      caption = `${def.displayName.toLowerCase()}: ${itemText(def.id).tagline.toLowerCase()} · +${def.delay} delay`;
      captionWarn = false;
    }
    return { slots, caption, captionWarn, frameTick: this.frameTick };
  }

  /**
   * The loadout entry the caption should name: the slot the mouse is hovering, or —
   * since a finger has no hover — the slot a finger is holding down right now.
   *
   * Without the second half, a player on a phone can never find out what an item does
   * before spending it: the compact row prints a four-letter name and the first tap
   * uses the item. Press and hold reads it out instead, and the press only acts on the
   * way down for slots that are already understood.
   */
  private hoveredItem(): LoadoutSlot | null {
    const point = this.pointer.inside ? { x: this.pointer.x, y: this.pointer.y } : this.heldPoint();
    if (!point) return null;
    const target = hudHitTest(this.layout, point.x, point.y);
    if (!target || target.kind !== 'item') return null;
    return slotAt(this.itemLayout(), target.index);
  }

  /** Where a finger is resting, if one is down on the HUD. */
  private heldPoint(): { x: number; y: number } | null {
    for (const sample of this.pointer.active.values()) return { x: sample.x, y: sample.y };
    return null;
  }

  private barView(): BottomBarView | null {
    const seat = this.focusSeat();
    const m = mobileOfSeat(this.match, seat);
    const slot = slotOfSeat(this.match, seat);
    if (!m || !slot) return null;
    const def = getMobileDef(m.defId);
    const mine = seat === this.driver.controlledSeat();

    const shots: ShotButtonView[] = [];
    // `ssReady` is "is the bar full", `ssAvailable` is "may it be fired": the gauge
    // fill reads the first and the button's enabled state the second (DESIGN §2.9).
    const available = ssAvailable(this.match, seat);
    for (const key of SHOT_ORDER) {
      shots.push({
        shot: key,
        name: def.shots[key].displayName,
        selected: slot.shot === key,
        gauge: slot.ssGauge / constants.ss.gaugeMax,
        ready: ssReady(slot),
        available: key === 'ss' ? available : true,
        gaugeText:
          key === 'ss' && !available
            ? `${Math.min(slot.ssGauge, constants.ss.gaugeMax)}/${constants.ss.gaugeMax}`
            : '',
      });
    }

    // Our own charge is the live one; somebody else's is whatever their `chargingEcho`
    // last reported (DESIGN §6.2), which is exactly what the simulation holds.
    const remoteCharge = this.match.chargingPower;
    const showPower = mine ? this.power : remoteCharge >= 0 ? remoteCharge : 0;
    const showCharging = mine ? this.charging : remoteCharge >= 0;
    const previous = this.match.lastShotPower[seat] ?? NO_SHOT_YET;
    const relAngle = this.displayRelAngle(m);

    return {
      nick: slot.nick,
      team: slot.team,
      mobileName: def.displayName,
      relAngle,
      trueAngle: worldAngleDeg(m, relAngle),
      tiltDeg: tiltDeg(m),
      rangeFromDeg: worldAngleDeg(m, def.angleMin),
      rangeToDeg: worldAngleDeg(m, def.angleMax),
      power: showPower,
      charging: showCharging,
      previousPower: previous >= 0 ? previous : null,
      shots,
      items: this.itemRowView(),
      moveGauge: m.moveGauge,
      moveGaugeMax: def.moveGauge,
      moveHeld: m.moveDir,
      angleHeld: mine ? this.heldAngle() : 0,
      enabled: this.driver.acceptsInput() && mine,
      firePressed: this.firePressed,
      aimActive: this.aimDragging,
      // A mouse has a hover; a finger resting on a key is already its pressed state.
      hover:
        !this.touchScreen && this.pointer.inside
          ? hudHitTest(this.layout, this.pointer.x, this.pointer.y)
          : null,
      frameTick: this.frameTick,
      // The idle frame of whatever we are looking at, so the header says *what* is
      // being driven and not only who drives it (DESIGN §8).
      portrait: frameCanvasFor(this.sheetFor(m.defId), 'idle', 0) ?? null,
    };
  }

  /** The angle key held down, on screen or on the keyboard, for the arrow keys' state. */
  private heldAngle(): -1 | 0 | 1 {
    if (this.angleHold !== 0) return this.angleHold;
    const up = this.keyboard.isDown('aimUp');
    const down = this.keyboard.isDown('aimDown');
    return up === down ? 0 : up ? 1 : -1;
  }

  /** The three always-live toggles under the player list. */
  private togglesView(): TogglesView {
    return {
      muted: this.muted,
      musicOff: this.sound === 'noMusic',
      help: this.helpOpen,
      chat: this.driver.onChatToggle !== undefined,
      chatOpen: this.driver.chatOpen?.() ?? false,
      chatUnread: this.driver.chatUnread?.() ?? 0,
    };
  }

  private noticeViews(): NoticeView[] {
    const fade = clientConstants.hud.notices.fadeFrames;
    return this.notices.map((n) => ({
      text: n.text,
      color: n.color,
      alpha: n.life >= fade ? 1 : Math.max(0, n.life / fade),
      big: n.big,
    }));
  }

  /**
   * The teleport crosshair, drawn over the world but under the bar. Its colour is the
   * shared rule's answer for the point under the pointer, so the player is told
   * *before* spending the item that a spot is inside the ground or already taken.
   */
  private drawTargeting(): void {
    if (this.targeting === null) return;
    const point = this.crosshair();
    if (!point) return;
    const seat = this.driver.controlledSeat();
    const m = mobileOfSeat(this.match, seat);
    if (!m) return;
    const def = getMobileDef(m.defId);
    const target = this.pointerTarget(point);
    const bad = this.targetRejection(target);
    drawTargetCursor(this.ctx, {
      x: point.x,
      y: point.y,
      valid: bad === null,
      label: bad ? rejectionText[bad] : getItemDef(this.targeting).displayName.toUpperCase(),
      hullW: def.footprint.w,
      hullH: def.footprint.h,
      frameTick: this.frameTick,
    });
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const match = this.match;
    const view = this.backbuffer.size;
    drawWind(ctx, match.wind, view);
    drawPlayerList(ctx, this.playerEntries(), this.layout.variant);
    this.skyRenderer.drawLabel(ctx, match.sky, this.layout.variant);

    if (match.mode === 'turns' && match.phase !== 'ended') {
      const override = this.driver.timerSeconds?.() ?? null;
      const active = match.phase === 'active';
      const seconds =
        override !== null
          ? override
          : active
            ? secondsLeft(match)
            : match.phase === 'starting'
              ? Math.ceil(constants.turn.activeTicks / constants.tickRate)
              : 0;
      drawTurnTimer(
        ctx,
        seconds,
        active && seconds <= constants.turn.warningSeconds,
        this.frameTick,
        view,
      );
    }

    // The banner announces a turn and then gets out of the way; the one-line tag under
    // the timer says the same thing for the rest of it.
    this.updateTurnBanner();
    const turnBanner = this.banner
      ? { ...this.banner.view, age: this.frameTick - this.banner.frame }
      : null;
    const bannerUp = turnBanner !== null && turnBannerPose(turnBanner.age) !== null;
    const status = this.bannerText();
    if (status && !bannerUp) drawStatusTag(ctx, status.text, status.self, view);

    const debug = this.driver.debugLines?.() ?? [];
    if (debug.length > 0) {
      // Top left, under the toggle row — not top right, where the match scene's DOM
      // "Forfeit & leave" button lives: a canvas panel drawn over it left the button
      // half readable and had to be clicked through. On the shortest views it is cut
      // to the lines that fit above the owner tab (free play adds a line), and it is
      // drawn before the bar so the live angle plate a dial drag puts above the bar
      // lands on top of it.
      const top = this.layout.belowPanelsY + clientConstants.sandbox.debugTopPx;
      const h = clientConstants.hud;
      const room = this.layout.top - clientConstants.sandbox.debugTopPx - top - h.paddingPx * 2;
      const fits = Math.max(1, Math.floor(room / h.lineHeightPx));
      drawTextPanel(
        ctx,
        h.marginPx,
        top,
        debug.slice(0, fits),
        clientConstants.sandbox.debugWidthPx,
      );
    }

    const bar = this.barView();
    if (bar) drawBottomBar(ctx, this.layout, bar);

    const notices = this.noticeViews();
    if (notices.length > 0) drawNotices(ctx, notices, view);
    if (turnBanner && bannerUp) drawTurnBanner(ctx, turnBanner, view);

    drawToggles(ctx, this.layout, this.togglesView());
    // The keys are a card you open with H, not a strip across the bottom of every
    // frame for the rest of the match.
    const help = this.driver.helpText?.(this.touchScreen) ?? '';
    if (this.helpOpen && help.length > 0) drawHelpCard(ctx, this.layout, help);

    drawNetBadge(ctx, this.layout, this.driver.netState?.() ?? 'online', this.frameTick);

    const over = this.driver.gameOver?.() ?? null;
    if (over) drawGameOver(ctx, over.title, over.lines, view);
  }
}
