/**
 * The networked match (DESIGN §1.3 scenes/match.ts, §6.3).
 *
 * The scene owns three things and delegates everything else:
 *
 * - a `MatchState` built exactly the way the server built its own (`matchStart` →
 *   `createMatchFromStart`), stepped locally at 60 Hz by `MatchView`;
 * - the socket half: local input becomes *intents on the wire* and nothing else. The
 *   local mobile does not walk, aim or fire until the authority echoes it back (DESIGN
 *   §7 item 12); every authoritative message goes through `net/playback.ts`, which
 *   steps to the tick the message names and applies it there;
 * - reconciliation: on every `turnEnd` the client quantises its own state the same way
 *   the authority did and compares hashes. Equal is the normal case and costs nothing;
 *   different overwrites from the snapshot, bumps the desync counter (visible with
 *   `?debug=1` and logged), and asks for the terrain mask when that is what differs.
 *
 * On top of the canvas sit two DOM layers, because they are text: the chat overlay
 * (Enter opens, Esc closes) and the end-of-match plate with its way back to the room.
 */
import { getMapDef, mobileOfSeat, turnAcceptsIntent } from '@gunbros/shared';
import type {
  Intent,
  MapDef,
  MatchStartMsg,
  MatchState,
  ServerMessage,
} from '@gunbros/shared';
import type { GameSocket, SocketStatus } from '../net/socket.js';
import { applyServerMessage, createMatchFromStart, seatOf } from '../net/playback.js';
import { ServerClock } from '../net/clock.js';
import { TurnEndHold } from '../net/turnEndHold.js';
import { MatchView } from './matchView.js';
import type { ControlName, MatchViewDriver } from './matchView.js';
import type { Keyboard } from '../input/keyboard.js';
import { ChatPanel } from '../ui/chat.js';
import { button, el } from '../ui/dom.js';
import { keepScreenAwake } from '../ui/wakeLock.js';
import { clientConstants } from '../data/clientConstants.js';
import { soundModeWord } from '../state/session.js';

export interface MatchScene {
  destroy(): void;
  handleMessage(msg: ServerMessage): void;
  setStatus(status: SocketStatus): void;
}

/**
 * The same numbers the `?debug=1` panel draws, readable from outside the canvas.
 *
 * The HUD is pixels, so a test harness cannot read a word of it. The Playwright smoke
 * test (DESIGN §10) needs three facts — whose turn it is, whether the turn changed, and
 * whether this engine ever disagreed with the authority — so the debug build hands them
 * over as live getters. It exists only when `?debug=1` is on and disappears with the
 * scene, and nothing in the client ever reads it.
 */
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
  /**
   * Where a HUD control is on the page, in CSS px, so a browser test can put a finger
   * on it: the bar is drawn pixels and has no DOM to query (DESIGN §10).
   */
  hudRect(name: ControlName): { x: number; y: number; w: number; h: number } | null;
}

declare global {
  interface Window {
    /** Present only with `?debug=1`; see `MatchProbe`. */
    __gunbrosMatch?: MatchProbe;
  }
}

export interface MatchOptions {
  socket: GameSocket;
  start: MatchStartMsg;
  playerId(): string;
  /** The player asked to go back to the room after the match ended. */
  onReturnToRoom(): void;
  /** The player forfeited and left the room while the match was running. */
  onLeaveMatch(): void;
  /** `?debug=1`: show the tick/desync panel. */
  debug: boolean;
}

export function mountMatch(host: HTMLElement, options: MatchOptions): MatchScene {
  const { socket } = options;

  const map: MapDef = getMapDef(options.start.mapId);
  const state: MatchState = createMatchFromStart(options.start);
  const mySeat = seatOf(options.start, options.playerId());

  let moveSeq = 0;
  let fireSeq = 0;
  let desyncs = 0;
  let ended = false;
  /**
   * The authority's clock (DESIGN §7 item 45). Every message that carries a tick feeds
   * it; it answers how far this engine may simulate, always at or behind the server.
   */
  const clock = new ServerClock();
  /**
   * Set when a `resync` lands mid-shot: the snapshot carries no projectiles, so the
   * local turn machine would see a settled `resolving` phase and end the turn before the
   * authority does. The local clock is held until the next authoritative message.
   */
  let holdForAuthority = false;
  /**
   * The same resync also throws away the shell this engine still had in the air, so the
   * *next* `turnEnd` hash cannot agree however healthy both sides are: the authority
   * carried the shot to its crater and this engine did not. That one overwrite is
   * expected, so it applies the snapshot and asks for the terrain as usual but is not
   * counted or warned about — a reload mid-flight used to read as "desync #1" for the
   * rest of the match. Cleared by the first `turnEnd` after it, agreed or not.
   */
  let expectedOverwrite = false;

  function noteServerTick(tick: number): void {
    clock.note(tick, performance.now());
  }

  /**
   * A `turnEnd` that arrived before this engine played up to it, and whatever came in
   * behind it (DESIGN §7 item 170): the rest of the shot is rendered in real time
   * rather than skipped, and the reconciliation runs when the engine reaches the tick.
   */
  const turnEndHold = new TurnEndHold(clientConstants.net.maxTurnEndHoldTicks);

  function tickCap(): number | null {
    if (holdForAuthority) return state.tick;
    const cap = clock.cap(performance.now());
    // Once per frame, before the tick loop: apply what the engine has now caught up
    // with, then stop the loop at the tick of anything still held.
    for (const msg of turnEndHold.release(state.tick, cap ?? state.tick)) handleNow(msg);
    const held = turnEndHold.heldTick;
    if (held === null) return cap;
    return Math.min(cap ?? held, held);
  }

  /** The tick a message was applied on, or null when it carries no clock. */
  function tickOf(msg: ServerMessage): number | null {
    switch (msg.t) {
      case 'moveEcho':
      case 'aimEcho':
      case 'shotEcho':
      case 'chargingEcho':
      case 'itemUsed':
      case 'fire':
      case 'skipEcho':
      case 'playerForfeit':
        return msg.tick;
      case 'turnEnd':
      case 'resync':
        return msg.snapshot.tick;
      default:
        return null;
    }
  }

  // --- DOM layers over the canvas -------------------------------------------
  const stage = el('div', 'stage');
  host.replaceChildren(stage);

  const chat = new ChatPanel((text) => socket.send({ t: 'chat', text }), 'say something');
  const chatLayer = el('div', 'chat-overlay');
  chatLayer.appendChild(chat.element);
  chat.setInputVisible(false);
  chat.input.addEventListener('blur', () => {
    chat.setInputVisible(false);
    stirChatLog();
    // *Going* away, not gone: see `unfreezeWhenWindowIsBack`.
    unfreezeWhenWindowIsBack();
  });

  /** Stops the watch below, whether it fired or not. Null while nothing is waiting. */
  let stopUnfreezeWatch: (() => void) | null = null;

  /**
   * Let the backbuffer listen to the window again — once the window is actually back.
   *
   * On iOS `blur` fires when the virtual keyboard *starts* to slide away, and the
   * visual viewport is still most of a keyboard short at that moment. Unfreezing there
   * fits the whole board into a 844x200 window and fits it back a fraction of a second
   * later, which is the entire HUD collapsing and springing open for every chat line
   * sent (DESIGN §7 item 159). So the freeze is lifted by the `visualViewport` event
   * that says the window is whole again, with a timeout for the browsers that never
   * send one — a desktop, where nothing shrank in the first place, takes that path
   * immediately because the window is already whole.
   */
  function unfreezeWhenWindowIsBack(): void {
    stopUnfreezeWatch?.();
    const vv = window.visualViewport;
    const whole = (): boolean =>
      !vv || Math.abs(vv.height + vv.offsetTop - window.innerHeight) <= 2;
    if (whole()) {
      view.setLayoutFrozen(false);
      return;
    }
    const timer = window.setTimeout(() => finish(), clientConstants.loop.keyboardSettleMs);
    function finish(): void {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', check);
      vv?.removeEventListener('scroll', check);
      stopUnfreezeWatch = null;
      view.setLayoutFrozen(false);
    }
    function check(): void {
      if (whole()) finish();
    }
    stopUnfreezeWatch = (): void => {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', check);
      vv?.removeEventListener('scroll', check);
      stopUnfreezeWatch = null;
    };
    vv?.addEventListener('resize', check);
    vv?.addEventListener('scroll', check);
  }

  /**
   * The log over the board fades a while after its last line (DESIGN §7 item 167). On a
   * phone it is most of the width of the screen and sits exactly where the mobiles
   * stand; a line from the start of the match has no business covering one at the end
   * of it. Opening the chat line brings it back, and the unread pip on the chat button
   * says when something arrived while it was faded.
   */
  let quietTimer: number | undefined;
  function stirChatLog(): void {
    chatLayer.classList.remove('quiet');
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => {
      if (!chat.focused) chatLayer.classList.add('quiet');
    }, clientConstants.ui.chatLogLingerMs);
  }

  /** A line from the client itself, shown the way a chat line is. */
  function noteLine(text: string): void {
    chat.note(text);
    stirChatLog();
  }

  /** Lines that arrived while the chat line was closed, for the pip on its button. */
  let chatUnread = 0;
  /** The socket as the HUD shows it (DESIGN §6.4): anything but `open` is visible. */
  let netStatus: SocketStatus = 'connecting';

  function openChat(): void {
    // Opening again while the last close is still waiting for the keyboard to go: that
    // wait is over, and its unfreeze would undo the freeze below.
    stopUnfreezeWatch?.();
    chat.setInputVisible(true);
    chatLayer.classList.remove('quiet');
    window.clearTimeout(quietTimer);
    // Hold the backbuffer at its current size while the virtual keyboard is up
    // (DESIGN §7 item 148): the visual viewport is about to halve, and a HUD re-laid
    // for a 800x180 window and back again is a scene that jumps under the player.
    view.setLayoutFrozen(true);
    chat.focus();
    chatUnread = 0;
  }

  function toggleChat(): void {
    if (chat.focused) {
      chat.input.blur();
      return;
    }
    openChat();
  }

  const endLayer = el('div', 'end-overlay');
  endLayer.hidden = true;

  // The only way out of a running match (DESIGN §7 item 41: leaving on purpose is an
  // immediate forfeit — there is no grace period for someone who closed the door).
  const leaveLayer = el('div', 'leave-overlay');
  leaveLayer.appendChild(
    // Not `small`: that class carries a 36 px minimum that beats the coarse-pointer
    // 44 px rule in index.html, and this button floats over the match canvas where a
    // mis-tap is a forfeit (DESIGN §7 item 160).
    button('Forfeit & leave', 'btn ghost', () => {
      socket.send({ t: 'leaveRoom' });
      options.onLeaveMatch();
    }),
  );

  // --- the view -------------------------------------------------------------
  const driver: MatchViewDriver = {
    sendIntent,
    controlledSeat: () => mySeat,
    focusSeat: () => (state.activeSeat >= 0 ? state.activeSeat : mySeat),
    acceptsInput(): boolean {
      if (mySeat < 0 || ended) return false;
      if (chat.focused) return false;
      if (!turnAcceptsIntent(state, mySeat)) return false;
      const m = mobileOfSeat(state, mySeat);
      return !!m && m.alive;
    },
    onInput(keyboard: Keyboard): void {
      if (keyboard.pressed('chat')) openChat();
    },
    onChatToggle: toggleChat,
    chatOpen: () => chat.focused,
    chatUnread: () => chatUnread,
    // The end panel is up: the authority said so (below), so the music can too.
    matchOver: () => ended,
    netState: () => (netStatus === 'open' ? 'online' : netStatus === 'closed' ? 'offline' : 'reconnecting'),
    // No `onTick`: the local simulation reaching `phase: 'ended'` is not the result.
    // Only the authority ends a match (DESIGN §7 item 57) — a client that applied one
    // shot a tick early could kill a mobile the server left standing, and latching the
    // end plate here would take this player's input away for the rest of a match that
    // is still being played.
    debugLines(): string[] {
      if (!options.debug) return [];
      return [
        `seat ${mySeat}  active ${state.activeSeat}`,
        `tick ${state.tick}  turn ${state.turn}`,
        `phase ${state.phase}  done ${state.completedTurns}`,
        `wind ${state.wind.strength} @ ${Math.round(state.wind.directionDeg)}`,
        `desyncs ${desyncs}`,
        `net ${socket.state}`,
      ];
    },
    helpText(touch: boolean): string {
      // A phone has none of these keys, so it is told about the three touch controls
      // this pass added instead (DESIGN §7 item 158).
      if (touch) {
        return (
          'Drag the dial to aim  Hold FIRE to charge  Hold < > to walk  ' +
          'Tap a shot or an item  Drag the map to look around  ' +
          `Sound ${soundModeWord(view.sound)}  Tap ? to close`
        );
      }
      return (
        'Tab shot  <- -> move  ^ v aim  Space/FIRE charge  X skip  1-6 items  Esc cancel  ' +
        `Enter chat  F cam${view.director.free ? '*' : ''}  M sound ${soundModeWord(view.sound)}  ` +
        'H this card'
      );
    },
    tickCap,
    aimSendMs: clientConstants.net.aimSendMs,
  };

  const view = new MatchView(stage, map, state, driver);
  stage.append(chatLayer, leaveLayer, endLayer);
  view.start();
  // A turn-based game is long stretches of watching, which is what a phone reads as
  // "nobody is here" before it dims the screen (DESIGN §7 item 151).
  const wakeLock = keepScreenAwake();

  if (options.debug) {
    window.__gunbrosMatch = {
      get seat(): number {
        return mySeat;
      },
      get activeSeat(): number {
        return state.activeSeat;
      },
      get turn(): number {
        return state.turn;
      },
      get completedTurns(): number {
        return state.completedTurns;
      },
      get phase(): string {
        return state.phase;
      },
      get tick(): number {
        return state.tick;
      },
      get desyncs(): number {
        return desyncs;
      },
      get ended(): boolean {
        return ended;
      },
      get power(): number {
        return view.chargePower;
      },
      hudRect(name: ControlName) {
        return view.controlRect(name);
      },
    };
  }

  // --------------------------------------------------------------------------
  // Local input -> the wire. Nothing is applied locally (DESIGN §6.3 step 3).
  // --------------------------------------------------------------------------
  function sendIntent(intent: Intent): void {
    if (mySeat < 0) return;
    switch (intent.t) {
      case 'move':
        moveSeq++;
        socket.send({ t: 'move', dir: intent.dir, seq: moveSeq });
        return;
      case 'aim':
        socket.send({ t: 'aim', relAngle: intent.relAngle });
        return;
      case 'selectShot':
        socket.send({ t: 'selectShot', shot: intent.shot });
        return;
      case 'useItem':
        // Like every other intent: onto the wire and nothing else. The item goes off
        // when the authority's `itemUsed` comes back with the tick it applied it on
        // (DESIGN §6.2), which is also how the other client learns about it.
        socket.send({
          t: 'useItem',
          itemId: intent.itemId,
          ...(intent.target ? { target: { x: intent.target.x, y: intent.target.y } } : {}),
        });
        return;
      case 'charging':
        socket.send({ t: 'charging', power: intent.power });
        return;
      case 'fire':
        fireSeq++;
        socket.send({
          t: 'fire',
          shot: intent.shot,
          relAngle: intent.relAngle,
          power: intent.power,
          seq: fireSeq,
        });
        return;
      case 'skip':
        socket.send({ t: 'skip' });
        return;
      case 'forfeit':
        // Never sent by a client: the server decides a forfeit (DESIGN §6.4).
        return;
    }
  }

  // --------------------------------------------------------------------------
  // The wire -> the local simulation.
  // --------------------------------------------------------------------------
  /** `winnerTeam` undefined: the match is over but we never heard how it ended. */
  function showEnd(winnerTeam: string | null | undefined, reason: string): void {
    if (ended) return;
    ended = true;
    const panel = el('div', 'end-panel');
    const mine = mySeat >= 0 ? state.seats[mySeat]?.team : undefined;
    const title =
      winnerTeam === undefined
        ? 'MATCH OVER'
        : winnerTeam === null
          ? 'DRAW'
          : mine !== undefined && winnerTeam === mine
            ? 'YOU WIN'
            : `TEAM ${winnerTeam} WINS`;
    panel.append(
      el('h2', 'end-title', title),
      el(
        'p',
        'muted',
        `${state.completedTurns} ${state.completedTurns === 1 ? 'turn' : 'turns'} played` +
          (reason === 'eliminated' ? '' : ` — ${reason}`),
      ),
      button('Back to the room', 'btn primary', options.onReturnToRoom),
    );
    endLayer.replaceChildren(panel);
    endLayer.hidden = false;
  }

  /**
   * Every message off the wire. The clock is fed here, at arrival, and never again
   * when a held message is applied later: a late reading would push the estimate of
   * the authority's clock back and leave this engine further behind.
   */
  function handleMessage(msg: ServerMessage): void {
    const tick = tickOf(msg);
    if (tick !== null) noteServerTick(tick);
    // Not while the clock is frozen after a mid-shot resync: this engine has no shell
    // left to play out, and the held message is the one that would unfreeze it.
    if (!holdForAuthority && turnEndHold.offer(msg, state.tick)) return;
    handleNow(msg);
  }

  function handleNow(msg: ServerMessage): void {
    switch (msg.t) {
      case 'turnStart':
        // HUD only. The local turn machine emits its own `turnStart` at the same tick;
        // applying this one would open the turn twice (DESIGN §6.2). The countdown is
        // *not* taken from `deadlineMs`: that is the server's wall clock, and comparing
        // it with this browser's would show the skew between two machines as a wrong
        // timer. The HUD counts `secondsLeft(state)` off the tick-aligned simulation
        // instead (DESIGN §7 item 45).
        view.resetControl();
        return;
      case 'chat':
        chat.push({ from: msg.from, text: msg.text, ts: msg.ts });
        if (!chat.focused) chatUnread++;
        stirChatLog();
        return;
      case 'playerLeft':
        noteLine(`${nickOf(msg.seat)} lost connection`);
        return;
      case 'playerReconnected':
        noteLine(`${nickOf(msg.seat)} is back`);
        return;
      case 'playerForfeit':
        noteLine(`${nickOf(msg.seat)} forfeited`);
        break;
      case 'matchEnd':
        applyToSim(msg);
        showEnd(msg.winnerTeam, msg.reason);
        return;
      case 'roomState':
        // The room left the match without a `matchEnd` reaching us: it ended while this
        // socket was down, and a reconnect only replays the room. Without this the local
        // sim would keep playing turns against nobody (the server has no match left).
        if (msg.phase !== 'match') showEnd(undefined, 'it ended while you were away');
        return;
      case 'error':
        noteLine(msg.message);
        return;
      default:
        break;
    }
    applyToSim(msg);
  }

  function nickOf(seat: number): string {
    return state.seats[seat]?.nick ?? `seat ${seat}`;
  }

  function applyToSim(msg: ServerMessage): void {
    const tick = tickOf(msg);
    // Any authoritative message means the authority has spoken since the resync, so
    // whatever the shot was doing is now decided here too.
    if (tick !== null && msg.t !== 'resync') holdForAuthority = false;
    const result = applyServerMessage(state, msg);
    if (!result.applied) return;
    // A `resync` taken while a shell was in the air carries no projectiles (DESIGN
    // §6.4), so the local turn machine would find the turn settled and end it before
    // the server does — banking delay and possibly rerolling the wind off the PRNG.
    // Hold the local clock until the authority's next message says what happened.
    if (msg.t === 'resync') {
      holdForAuthority = state.phase === 'resolving';
      expectedOverwrite = holdForAuthority;
    }
    view.handleEvents(result.events);
    if (msg.t === 'resync' || msg.t === 'terrainMask') {
      view.refreshTerrain();
      view.centreOnFocus();
    }
    if (result.desync) {
      if (expectedOverwrite) {
        console.info(`[gunbros] resync overwrite at turn ${state.turn}; snapshot applied`);
      } else {
        desyncs++;
        // Loud on purpose, and specific: a desync is the one thing that quietly ruins a
        // match, the e2e watches the console for it, and the hash on its own says only
        // that two engines disagree. `result.diff` names the fields.
        console.warn(
          `[gunbros] desync #${desyncs} at turn ${state.turn}; snapshot applied` +
            (result.diff.length > 0 ? ` — ${result.diff.join(', ')}` : ''),
        );
      }
      view.refreshTerrain();
    }
    if (msg.t === 'turnEnd') expectedOverwrite = false;
    if (result.needsTerrain) socket.send({ t: 'requestTerrain' });
  }

  return {
    destroy(): void {
      if (options.debug) delete window.__gunbrosMatch;
      stopUnfreezeWatch?.();
      window.clearTimeout(quietTimer);
      wakeLock.release();
      view.destroy();
      host.replaceChildren();
    },
    handleMessage,
    setStatus(status: SocketStatus): void {
      // The full-screen plate belongs to the app shell; the match keeps running (and
      // keeps simulating) while the socket is away. The HUD badge is this scene's own,
      // because a player mid-turn needs to know *why* nothing is being echoed back
      // without losing sight of the board (DESIGN §6.4).
      netStatus = status;
    },
  };
}
