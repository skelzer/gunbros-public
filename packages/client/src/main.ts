/**
 * The app shell and the scene router (DESIGN §1.3 main.ts).
 *
 * Routes: `/` is the lobby, `/r/CODE` (or `?room=CODE`) is the lobby with that code
 * filled in and joined as soon as there is a nickname to join with, and `/sandbox` is
 * the dev-only offline scene, reached through an `import.meta.env.DEV` guarded dynamic
 * import so a production build never emits it (DESIGN §7 item 14); `/uikit`, the UI kit
 * gallery, `/projectiles`, the projectile gallery, and `/effects`, the effects gallery, are
 * dev-only the same way.
 *
 * Which *screen* is on after that is not a URL question but a server question: one
 * socket carries the whole session, and the room and the match are the states the
 * server puts us in. So the shell owns the socket, keeps the last `roomState`, and
 * swaps scenes on the two messages that change everything — `roomState` (we are in a
 * room) and `matchStart` (the match is on). A reconnect replays exactly that burst
 * (`welcome`, `roomState`, `matchStart`, `resync`), so the same three lines that handle
 * the first arrival handle a returning player too (DESIGN §6.4).
 */
import type { MatchStartMsg, RoomStateMsg, ServerMessage } from '@gunbros/shared';
import { GameSocket } from './net/socket.js';
import type { SocketStatus } from './net/socket.js';
import { mountLobby } from './scenes/lobby.js';
import type { LobbyScene } from './scenes/lobby.js';
import { mountRoom } from './scenes/room.js';
import type { RoomScene } from './scenes/room.js';
import { mountMatch } from './scenes/match.js';
import type { MatchScene } from './scenes/match.js';
import { appMusic, trackFor } from './audio/music.js';
import { loadSession, storedNick } from './state/session.js';
import { installMobileShell } from './ui/viewport.js';
import { installUiKitCss } from './render/uiKit.js';

interface Screen {
  destroy(): void;
  handleMessage(msg: ServerMessage): void;
  setStatus(status: SocketStatus): void;
}

function requireRoot(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app is missing from index.html');
  return el;
}

const app: HTMLElement = requireRoot();

/** `/r/CODE` or `?room=CODE`, upper-cased; '' when the URL names no room. */
function codeFromUrl(): string {
  const path = window.location.pathname.replace(/\/+$/, '');
  const match = /^\/r\/([A-Za-z0-9]{1,16})$/.exec(path);
  if (match && match[1]) return match[1].toUpperCase();
  const query = new URLSearchParams(window.location.search).get('room');
  return query ? query.trim().toUpperCase() : '';
}

/**
 * `?debug=1`, read once at boot and then carried by hand: the shell rewrites the URL
 * when it enters a room (`/r/CODE`), and a query string it dropped there would turn the
 * debug panel off half a screen later.
 */
const DEBUG: boolean = new URLSearchParams(window.location.search).get('debug') === '1';

/** The query a history rewrite keeps. Only the debug flag survives; nothing else here
 * means anything after the first read. */
function keptQuery(): string {
  return DEBUG ? '?debug=1' : '';
}

// --------------------------------------------------------------------------
// The reconnecting plate: one element, outside every scene, because the socket
// outlives all of them.
// --------------------------------------------------------------------------
const overlay = document.createElement('div');
overlay.className = 'net-overlay';
overlay.hidden = true;
overlay.textContent = 'Reconnecting…';
document.body.appendChild(overlay);

/**
 * The music outlives every scene, and so does its unlock (DESIGN §8.3): every press
 * anywhere on the page, handled in the press's own call stack (DESIGN §7 item 157).
 * Capture phase, so a scene that stops propagation cannot keep it from the music.
 */
function installMusicUnlock(): void {
  const unlock = (): void => appMusic().unlock();
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

function boot(): void {
  installMusicUnlock();
  // The menus wear the Blender UI kit as CSS border-images. Until the atlas is in (or
  // if it never comes) they keep the hand-drawn plates in index.html; `uk-ready` is the
  // switch between the two.
  void installUiKitCss().then(
    () => document.documentElement.classList.add('uk-ready'),
    () => undefined,
  );
  let screen: Screen | null = null;
  let room: RoomStateMsg | null = null;
  let status: SocketStatus = 'connecting';
  /** What we are showing, which is not always what the server last told us. */
  let showing: 'lobby' | 'room' | 'match' = 'lobby';
  /**
   * The room we walked out of, until we ask for another. A `leaveRoom` sent while the
   * socket is down is flushed after `hello`, and the server answers that `hello` by
   * replaying the room (and match) first; without this the replay would pull us back
   * into the room we just left.
   */
  let leftRoom: string | null = null;

  const socket = new GameSocket({
    nick: () => storedNick() ?? loadSession().nick,
    onMessage: (msg) => onMessage(msg),
    onStatus: (next) => onStatus(next),
    onSend: (msg) => {
      if (msg.t === 'leaveRoom') leftRoom = room?.code ?? leftRoom;
      else if (msg.t === 'createRoom' || msg.t === 'joinRoom') leftRoom = null;
    },
  });

  /**
   * Tear the old screen down *before* the new one builds itself: both of them own
   * `#app`, and a `destroy()` that ran afterwards would wipe the screen that just
   * replaced it.
   */
  const swap = (build: () => Screen): void => {
    screen?.destroy();
    screen = null;
    const next = build();
    screen = next;
    next.setStatus(status);
  };

  const showLobby = (code = ''): void => {
    showing = 'lobby';
    appMusic().setTrack(trackFor({ kind: 'lobby' }));
    swap((): LobbyScene => mountLobby(app, { socket, initialCode: code }));
  };

  const showRoom = (state: RoomStateMsg): void => {
    showing = 'room';
    // The room keeps the lobby's track: the match view picks its own (DESIGN §8.3).
    appMusic().setTrack(trackFor({ kind: 'lobby' }));
    swap((): RoomScene => mountRoom(app, {
      socket,
      state,
      playerId: () => socket.playerId,
      onLeave: () => {
        room = null;
        history.pushState({}, '', `/${keptQuery()}`);
        showLobby();
      },
    }));
    // The room is worth a link even when it was created here.
    if (window.location.pathname !== `/r/${state.code}`) {
      history.replaceState({}, '', `/r/${state.code}${keptQuery()}`);
    }
  };

  const showMatch = (start: MatchStartMsg): void => {
    showing = 'match';
    swap((): MatchScene => mountMatch(app, {
      socket,
      start,
      playerId: () => socket.playerId,
      debug: DEBUG,
      onReturnToRoom: () => {
        if (room) showRoom(room);
        else showLobby();
      },
      onLeaveMatch: () => {
        room = null;
        history.pushState({}, '', `/${keptQuery()}`);
        showLobby();
      },
    }));
  };

  function onMessage(msg: ServerMessage): void {
    if (leftRoom !== null && room === null) {
      // The replay of the room we left: nothing in it is ours any more.
      if (msg.t === 'roomState' && msg.code === leftRoom) return;
      if (msg.t === 'matchStart' || msg.t === 'resync') return;
    }
    switch (msg.t) {
      case 'roomState':
        room = msg;
        // A player who is still looking at the lobby has just got in somewhere.
        if (showing === 'lobby') {
          showRoom(msg);
          return;
        }
        break;
      case 'matchStart':
        // Also the reconnect path: a fresh scene is built and the `resync` that follows
        // lands on it (DESIGN §6.4).
        showMatch(msg);
        return;
      case 'error':
        if (showing !== 'lobby' && EVICTING.includes(msg.code)) {
          room = null;
          history.replaceState({}, '', `/${keptQuery()}`);
          showLobby();
          screen?.handleMessage(msg);
          return;
        }
        break;
      default:
        break;
    }
    screen?.handleMessage(msg);
  }

  function onStatus(next: SocketStatus): void {
    const wasDown = status !== 'open';
    status = next;
    overlay.hidden = next === 'open';
    if (socket.wasReplaced) {
      overlay.hidden = false;
      overlay.textContent = 'This session was opened in another tab.';
    }
    screen?.setStatus(next);
    // Back on our feet with a room on screen: ask to be put back in it. If the token
    // was honoured the server has already re-sent everything and this is a no-op; if
    // the server forgot us (it restarted, or the grace expired) the answer is an error
    // and `onMessage` drops us back to the lobby, instead of leaving a dead room up.
    if (next === 'open' && wasDown && room) socket.send({ t: 'joinRoom', code: room.code });
  }

  /** Errors that mean "you are not in that room any more, whatever the screen says". */
  const EVICTING = ['noSuchRoom', 'roomInMatch', 'roomFull', 'notInRoom'];

  showLobby(codeFromUrl());
  socket.connect();

  window.addEventListener('popstate', () => {
    // Back out of a room link: the lobby is the only thing the URL really selects.
    if (showing === 'lobby') return;
    const code = codeFromUrl();
    if (code === '' && showing === 'room') {
      socket.send({ t: 'leaveRoom' });
      room = null;
      showLobby();
    }
  });
}

async function route(): Promise<void> {
  // Pinch zoom, double-tap zoom and the virtual keyboard's effect on the layout, all
  // dealt with once before any scene exists (DESIGN §7 items 148-149).
  installMobileShell();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (import.meta.env.DEV && path === '/sandbox') {
    const mod = await import('./scenes/sandbox.js');
    mod.mountSandbox(app);
    return;
  }
  // The Blender UI kit, every piece at 1x and 3x (tools/blender/build_ui_kit.py).
  if (import.meta.env.DEV && path === '/uikit') {
    const mod = await import('./scenes/uiKitGallery.js');
    mod.mountUiKitGallery(app);
    return;
  }
  // The Blender projectile atlas, every shot in flight (tools/blender/build_projectiles.py).
  if (import.meta.env.DEV && path === '/projectiles') {
    const mod = await import('./scenes/projectileGallery.js');
    mod.mountProjectileGallery(app);
    return;
  }
  // The Blender effects atlas, every flipbook looping (tools/blender/build_effects.py).
  if (import.meta.env.DEV && path === '/effects') {
    const mod = await import('./scenes/effectGallery.js');
    mod.mountEffectGallery(app);
    return;
  }

  boot();
}

void route();
