/**
 * The lobby (DESIGN §1.3 scenes/lobby.ts): a nickname, and one of two doors — create a
 * room, or join one: from the list of open rooms, or by its code. Beside Create room,
 * "Practice vs bot" is the way in for somebody with nobody to play (DESIGN §7 item 192).
 *
 * Plain DOM on purpose. It is a menu: text fields, buttons and a list. The canvas is
 * for the match. It wears the Blender UI kit (render/uiKit.ts, docs/ART.md §12) — a
 * riveted panel, ribboned cards and gem keys — and the whole roster idles along the
 * bottom, so the first screen already looks like the game it opens.
 *
 * A link of the form `/r/CODE` (or `?room=CODE`) lands here with the code already
 * filled in; if this browser has a nickname stored, it joins immediately, so sending
 * "gunbros.example/r/7KQ2P" to the other brother is the whole invitation.
 */
import { maps, mobileDefs } from '@gunbros/shared';
import type { MapId, OpenRoomInfo, ServerMessage } from '@gunbros/shared';
import type { GameSocket, SocketStatus } from '../net/socket.js';
import { setNick, storedNick } from '../state/session.js';
import { button, el, labelled, pixelLabel, select, textInput } from '../ui/dom.js';
import type { Option } from '../ui/dom.js';
import { mapThumb } from '../ui/mapThumb.js';
import { wordmarkCanvas } from '../ui/pixelFont.js';
import { mobilePortraitCanvas } from '../ui/mobilePortrait.js';
import { uiClassName } from '../render/uiKit.js';
import type { NinePiece } from '../render/uiKit.js';
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen } from '../ui/fullscreen.js';
import { soundButton } from '../ui/soundButton.js';
import { clientConstants } from '../data/clientConstants.js';

export interface LobbyScene {
  destroy(): void;
  handleMessage(msg: ServerMessage): void;
  setStatus(status: SocketStatus): void;
}

export interface LobbyOptions {
  socket: GameSocket;
  /** Code from the URL (`/r/CODE` or `?room=CODE`), or ''. */
  initialCode: string;
  /** Maximum players for a room created here. */
  defaultMaxPlayers?: number;
}

const MAX_PLAYER_CHOICES = clientConstants.ui.roomSizes;

/** A card with its title on a ribbon: gold for the main door, steel for the other. */
function doorCard(title: string, ribbon: NinePiece): HTMLElement {
  const card = el('section', `card ${uiClassName('panel-dark')}`);
  const heading = el('h2', `card-title ${uiClassName(ribbon)}`);
  heading.appendChild(pixelLabel(title, { scale: 2 }));
  card.appendChild(heading);
  return card;
}

/**
 * Every mobile in the roster idling on a strip of ground: decoration, so the screen
 * reader is told to skip it, and the phone layout drops it for the height.
 */
function parade(): HTMLElement {
  const strip = el('div', 'lobby-parade');
  strip.setAttribute('aria-hidden', 'true');
  const box = clientConstants.ui.portrait.tile;
  for (const def of mobileDefs) {
    const art = mobilePortraitCanvas(def.id, { width: box.widthPx, height: box.heightPx, maxScale: 1 });
    art.title = def.displayName;
    strip.appendChild(art);
  }
  return strip;
}

export function mountLobby(host: HTMLElement, options: LobbyOptions): LobbyScene {
  const { socket } = options;
  const page = el('div', 'menu lobby');

  // The logo is drawn, not typed: a pixel wordmark with a hard outline and a drop
  // shadow, the same face the HUD uses (docs/ART.md). The `h1` stays for screen readers
  // and for anyone with images or canvas turned off.
  const brand = el('div', 'brand');
  const title = el('h1', 'title', 'GunBros');
  brand.append(title, wordmarkCanvas('GunBros', { scale: clientConstants.ui.wordmark.lobbyScale }));
  const subtitle = el('p', 'tagline', 'Turn-based artillery for two brothers in different cities.');
  brand.appendChild(subtitle);

  const nickField = textInput('your name', storedNick() ?? '', clientConstants.ui.nickMaxLength);
  nickField.addEventListener('change', () => {
    setNick(nickField.value);
  });

  const mapOptions: Option<MapId>[] = maps.map((m) => ({ value: m.id, label: m.displayName }));
  let mapId: MapId = maps[0]?.id ?? 'hills';
  const mapPicture = mapThumb(mapId, 'lobby-map-thumb');
  const mapSelect = select(mapOptions, mapId, (value) => {
    mapId = value;
    mapPicture.set(value);
  });
  // The caption is a <div> now (it wraps two things), so the select names itself.
  mapSelect.setAttribute('aria-label', 'Map');
  const mapField = el('div', 'map-field');
  mapField.append(mapSelect, mapPicture.element);

  let maxPlayers = options.defaultMaxPlayers ?? 2;
  const maxSelect = select(
    MAX_PLAYER_CHOICES.map((n) => ({ value: String(n), label: `${n} players` })),
    String(maxPlayers),
    (value) => {
      maxPlayers = Number(value);
    },
  );

  // Rooms a stranger may join are listed; a room between friends stays behind its code.
  const listedBox = el('input');
  listedBox.type = 'checkbox';
  listedBox.checked = true;
  const listedField = el('label', 'check-field');
  listedField.append(listedBox, el('span', '', 'List publicly'));

  const codeField = textInput('room code', options.initialCode, clientConstants.ui.codeMaxLength);
  codeField.classList.add('code-input');
  codeField.addEventListener('input', () => {
    codeField.value = codeField.value.toUpperCase();
  });

  const message = el('p', 'message');
  const statusLine = el('p', 'status');

  /**
   * The whole glass, please (DESIGN §7 item 150). A phone browser keeps a third of a
   * landscape screen for its own chrome, and this is the one screen with a spare
   * gesture to ask for it on. Hidden where the browser has no fullscreen at all (iOS
   * Safari), because a button that does nothing is worse than no button.
   */
  const fullscreenButton = button('Fullscreen', 'btn uk-btn small', () => {
    void (isFullscreen() ? exitFullscreen() : enterFullscreen()).then(syncFullscreen);
  });
  const syncFullscreen = (): void => {
    fullscreenButton.textContent = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
  };
  fullscreenButton.hidden = !fullscreenSupported();
  document.addEventListener('fullscreenchange', syncFullscreen);

  const nick = (): string => {
    const value = nickField.value.trim();
    return value.length > 0 ? value : '';
  };

  const needNick = (): boolean => {
    if (nick().length > 0) return false;
    say('Pick a name first.', true);
    nickField.focus();
    return true;
  };

  const say = (text: string, bad = false): void => {
    message.textContent = text;
    message.classList.toggle('bad', bad);
  };

  const create = (): void => {
    if (needNick()) return;
    setNick(nick());
    socket.syncNick();
    say('Creating a room…');
    socket.send({ t: 'createRoom', mapId, maxPlayers, listed: listedBox.checked });
  };

  /**
   * A room of your own with a Normal bot on the other team (DESIGN §7 item 192). It is
   * the ordinary room screen: the map, the size and the bot's picks can all still be
   * changed, and more bots added, before Start.
   */
  const practice = (): void => {
    if (needNick()) return;
    setNick(nick());
    socket.syncNick();
    say('Setting up a practice match…');
    socket.send({ t: 'createRoom', mapId, maxPlayers, practice: true });
  };

  const join = (picked?: string): void => {
    if (needNick()) return;
    const code = (picked ?? codeField.value).trim().toUpperCase();
    if (code.length === 0) {
      say('Type the room code your opponent sent you.', true);
      codeField.focus();
      return;
    }
    setNick(nick());
    socket.syncNick();
    say(`Joining ${code}…`);
    socket.send({ t: 'joinRoom', code });
  };

  const createButton = button('Create room', 'btn uk-btn-gold primary', create);
  const practiceButton = button('Practice vs bot', 'btn uk-btn practice', practice);
  const joinButton = button('Join', 'btn uk-btn', () => join());

  /**
   * Open rooms, so someone who arrived without a code still finds a game. The server
   * lists only rooms whose host asked to be listed, still in their lobby, with a seat
   * free and somebody in them; this asks again every few seconds while it is shown.
   */
  const roomList = el('ul', 'open-rooms');
  roomList.setAttribute('aria-label', 'Open rooms');
  let online = false;
  const renderRooms = (rooms: OpenRoomInfo[]): void => {
    if (rooms.length === 0) {
      roomList.replaceChildren(el('li', 'open-rooms-empty', 'No open rooms right now. Create one!'));
      return;
    }
    roomList.replaceChildren(
      ...rooms.map((r) => {
        const row = el('li', 'open-room');
        const mapName = maps.find((m) => m.id === r.mapId)?.displayName ?? r.mapId;
        const info = el('span', 'open-room-info');
        info.append(
          el('span', 'open-room-host', r.host || r.code),
          el('span', 'open-room-meta', `${mapName} · ${r.players}/${r.maxPlayers}`),
        );
        const go = button('Join', 'btn uk-btn small', () => join(r.code));
        go.disabled = !online;
        go.setAttribute('aria-label', `Join ${r.host || r.code}'s room`);
        row.append(info, go);
        return row;
      }),
    );
  };
  renderRooms([]);
  const askForRooms = (): void => {
    if (online && document.visibilityState === 'visible') socket.send({ t: 'listRooms' });
  };
  const roomPoll = setInterval(askForRooms, clientConstants.ui.roomListPollMs);
  // Back on the tab: a fresh list now, not at the next tick of the poll.
  document.addEventListener('visibilitychange', askForRooms);

  codeField.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') join();
  });
  nickField.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') (options.initialCode ? joinButton : createButton).click();
  });

  for (const field of [nickField, mapSelect, maxSelect, codeField, roomList]) {
    field.classList.add(uiClassName('recess'));
  }

  const createCard = doorCard('New room', 'banner/gold');
  createCard.appendChild(labelled('Map', mapField, 'div'));
  createCard.appendChild(labelled('Size', maxSelect));
  createCard.appendChild(listedField);
  // Side by side: on a landscape phone a second full-width key would push Practice
  // under the fold, and it is the key someone alone came for.
  const createRow = el('div', 'create-row');
  createRow.append(createButton, practiceButton);
  createCard.appendChild(createRow);

  const joinCard = doorCard('Join a room', 'banner/steel');
  // The code and its key share a row, which pays for the height of the list above them.
  const codeRow = el('div', 'code-row');
  codeRow.append(labelled('Code', codeField), joinButton);
  joinCard.appendChild(roomList);
  joinCard.appendChild(codeRow);

  const cards = el('div', 'cards');
  cards.append(createCard, joinCard);

  const footer = el('div', 'row lobby-footer');
  footer.append(
    fullscreenButton,
    soundButton(),
    el('span', 'hint', 'Landscape, please — the board is wide.'),
  );

  statusLine.setAttribute('role', 'status');
  message.setAttribute('role', 'status');
  const board = el('div', `lobby-board ${uiClassName('panel')}`);
  board.append(labelled('Your name', nickField), cards, message, statusLine);

  page.append(brand, board, footer, parade());
  host.replaceChildren(page);

  // A link with a code in it joins as soon as we have a name to join with.
  if (options.initialCode) {
    codeField.value = options.initialCode.toUpperCase();
    if (storedNick()) join();
    else say('Pick a name and join.');
  } else if (!storedNick()) {
    nickField.focus();
  }

  return {
    destroy(): void {
      clearInterval(roomPoll);
      document.removeEventListener('visibilitychange', askForRooms);
      document.removeEventListener('fullscreenchange', syncFullscreen);
      host.replaceChildren();
    },
    handleMessage(msg: ServerMessage): void {
      if (msg.t === 'error') say(msg.message, true);
      else if (msg.t === 'roomList') renderRooms(msg.rooms);
    },
    setStatus(status: SocketStatus): void {
      statusLine.textContent =
        status === 'open'
          ? ''
          : status === 'connecting'
            ? 'Connecting to the server…'
            : status === 'reconnecting'
              ? 'Reconnecting…'
              : 'Disconnected.';
      online = status === 'open';
      createButton.disabled = !online;
      practiceButton.disabled = !online;
      joinButton.disabled = !online;
      for (const go of roomList.querySelectorAll('button')) go.disabled = !online;
      askForRooms();
    },
  };
}
