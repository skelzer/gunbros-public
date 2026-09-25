/**
 * The room screen (DESIGN §1.3 scenes/room.ts, §6.1): team, mobile, map, items, chat,
 * and the host's start button.
 *
 * Plain DOM, like the lobby. Every control sends one intent and then waits: the server
 * answers every change with a complete `roomState` (DESIGN §6.2 — there are no partial
 * lobby updates), so this screen is a pure function of the last one that arrived and is
 * rebuilt wholesale each time. Nothing here is optimistic, which means two clients can
 * never hold different ideas of the room.
 *
 * The code is shown large with a copy-link button, because the only way into a room is
 * somebody sending it: the link is `<origin>/r/CODE`, which the lobby joins on its own.
 *
 * The host also seats practice bots here (DESIGN §11): an empty seat offers "+ Bot" for
 * either team, and a bot's card carries its difficulty, its mobile, its team and a
 * remove key. Everyone else sees the bot badge and the difficulty.
 *
 * It wears the Blender UI kit (render/uiKit.ts, docs/ART.md §12) like the HUD does:
 * riveted panels, gem keys, a card per player slot with that player's mobile idling in
 * it, and a picker of mobile cards beside the chosen one's stats and shots.
 */
import {
  botDifficulties,
  bots,
  getItemDef,
  getMobileDef,
  itemDefs,
  itemSlots,
  maps,
  pickableMobiles,
} from '@gunbros/shared';
import type {
  BotDifficulty,
  ItemId,
  MapId,
  MobileDef,
  PlayerInfo,
  RoomStateMsg,
  ServerMessage,
  TeamId,
} from '@gunbros/shared';
import type { GameSocket, SocketStatus } from '../net/socket.js';
import { button, COMPACT_QUERY, compactMenus, el, labelled, pixelLabel, select } from '../ui/dom.js';
import type { Option } from '../ui/dom.js';
import { ChatPanel } from '../ui/chat.js';
import { mobilePortraitCanvas } from '../ui/mobilePortrait.js';
import { mapThumb } from '../ui/mapThumb.js';
import { mobileInfoPanel } from '../ui/mobileInfo.js';
import type { MobileChoice } from '../ui/mobileInfo.js';
import { itemCost, itemText, renderItemInfo } from '../ui/itemInfo.js';
import { wordmarkCanvas } from '../ui/pixelFont.js';
import { soundButton } from '../ui/soundButton.js';
import { uiClassName, uiPieceElement } from '../render/uiKit.js';
import { preloadMapArt } from '../render/mapArt.js';
import type { NinePiece } from '../render/uiKit.js';
import { clientConstants, shortItemName } from '../data/clientConstants.js';
import { addItem, canAdd, layoutLoadout, removeAt, usedSlots } from '../state/loadout.js';
import { loadLoadout, setLoadout } from '../state/session.js';

export interface RoomScene {
  destroy(): void;
  handleMessage(msg: ServerMessage): void;
  setStatus(status: SocketStatus): void;
}

export interface RoomOptions {
  socket: GameSocket;
  state: RoomStateMsg;
  playerId(): string;
  /** The player asked to go back to the lobby. */
  onLeave(): void;
}

const GOLD = '#ffd23f';

/** A section of the screen: a riveted panel under a gold ribbon with its title. */
function panel(title: string, className = ''): { section: HTMLElement; heading: HTMLElement } {
  const section = el('section', `card ${uiClassName('panel')} ${className}`.trim());
  const heading = el('h2', `card-title ${uiClassName('banner/gold')}`);
  heading.appendChild(pixelLabel(title, { scale: 2 }));
  section.appendChild(heading);
  return { section, heading };
}

/** Swap one kit frame class for another, e.g. a card from `normal` to `selected`. */
function setFrame(node: HTMLElement, frames: readonly NinePiece[], on: NinePiece): void {
  for (const f of frames) node.classList.toggle(uiClassName(f), f === on);
}

const CARD_FRAMES = ['card/normal', 'card/selected', 'card/locked'] as const;

export function mountRoom(host: HTMLElement, options: RoomOptions): RoomScene {
  const { socket } = options;
  let state = options.state;
  const sizes = (): typeof clientConstants.ui.portrait.compact =>
    compactMenus() ? clientConstants.ui.portrait.compact : clientConstants.ui.portrait;

  const page = el('div', 'menu room');

  // --- header ---------------------------------------------------------------
  const header = el('header', 'room-header');
  const codeBox = el('div', `code-box ${uiClassName('frame-gold')}`);
  const codeValue = el('div', 'code', state.code);
  codeBox.append(el('div', 'label', 'Room code'), codeValue);
  const copied = el('span', 'copied');
  copied.setAttribute('role', 'status');
  /**
   * Sending the link *is* the invitation (DESIGN §7 item 152). On a phone the share
   * sheet is how a link reaches a brother — WhatsApp, Messages, whatever — so
   * `navigator.share` is tried first and the clipboard is the fallback everywhere it
   * does not exist (every desktop browser) or is refused (a cancelled sheet).
   */
  const shareButton = button(canShare() ? 'Share link' : 'Copy link', 'btn uk-btn', () => {
    const link = roomLink();
    void shareOrCopy(link, state.code).then((how) => {
      if (how === 'shared') return;
      copied.textContent = how === 'copied' ? 'link copied' : link;
      window.setTimeout(() => {
        copied.textContent = '';
      }, clientConstants.ui.copiedToastMs);
    });
  });
  const codeCluster = el('div', 'code-cluster');
  codeCluster.append(codeBox, shareButton, copied);
  const leaveButton = button('Leave', 'btn uk-btn small', () => {
    socket.send({ t: 'leaveRoom' });
    options.onLeave();
  });
  const headerRight = el('div', 'row');
  headerRight.append(soundButton(), leaveButton);
  const brand = el('div', 'brand');
  brand.appendChild(wordmarkCanvas('GunBros', { scale: clientConstants.ui.wordmark.roomScale }));
  header.append(brand, codeCluster, headerRight);

  // --- player slots ---------------------------------------------------------
  const players = panel('Players', 'players-panel');
  const list = el('div', 'players');
  players.section.appendChild(list);

  // --- the mobile picker ----------------------------------------------------
  // Only mobiles that are not `randomOnly` may be picked by hand (DESIGN §7 item 10);
  // dragon and knight are reachable through Random alone.
  //
  // A wall of cards rather than a dropdown: a mobile is a character, and a list of
  // eighteen words tells a player nothing about what they are about to drive. The
  // cards play the real idle animation through the match's own sprite loaders, and the
  // chosen one's numbers and shots sit beside them.
  const picker = panel('Choose your mobile', 'picker-panel');
  const mobileGrid = el('div', 'mobile-grid');
  mobileGrid.setAttribute('role', 'group');
  mobileGrid.setAttribute('aria-label', 'Mobile');
  const info = el('div', `info-box ${uiClassName('panel-dark')}`);
  info.setAttribute('aria-live', 'polite');
  const pickerBody = el('div', 'picker');
  pickerBody.append(mobileGrid, info);
  picker.section.appendChild(pickerBody);

  const choices: MobileChoice[] = ['random', ...pickableMobiles().map((d) => d.id)];
  const mobileTiles = new Map<MobileChoice, HTMLButtonElement>();
  for (const value of choices) {
    const label = mobileLabel(value);
    const node = button('', `mobile-tile ${uiClassName('card/normal')}`, () =>
      socket.send({ t: 'setMobile', mobileId: value }),
    );
    node.title = label;
    mobileTiles.set(value, node);
    mobileGrid.appendChild(node);
  }
  /** The art in each tile, sized for the layout the screen is in right now. */
  const paintTiles = (): void => {
    const box = sizes().tile;
    for (const [value, node] of mobileTiles) {
      const art =
        value === 'random'
          ? el('div', 'tile-random', '?')
          : mobilePortraitCanvas(value, { width: box.widthPx, height: box.heightPx });
      if (value === 'random') {
        art.style.width = `${box.widthPx}px`;
        art.style.height = `${box.heightPx}px`;
      }
      node.replaceChildren(art, el('span', 'tile-name', mobileLabel(value)));
    }
  };
  paintTiles();

  // --- own setup ------------------------------------------------------------
  const setup = panel('Your setup', 'setup-panel');

  const teamRow = el('div', 'row');
  const teamA = button('Team A', 'btn uk-btn team-a', () => socket.send({ t: 'setTeam', team: 'A' }));
  const teamB = button('Team B', 'btn uk-btn team-b', () => socket.send({ t: 'setTeam', team: 'B' }));
  teamRow.append(teamA, teamB);
  // A row of buttons, not one control: a `<label>` here would press Team A on a click
  // anywhere in the caption (see `labelled`).
  const teamField = labelled('Team', teamRow, 'div');

  const mapOptions: Option<MapId>[] = maps.map((m) => ({ value: m.id, label: m.displayName }));
  const mapSelect = select<MapId>(mapOptions, state.mapId, (value) => {
    socket.send({ t: 'setMap', mapId: value });
  });
  mapSelect.classList.add(uiClassName('recess'));
  // The picture of the chosen map beside its name: a name alone tells a new player
  // nothing about the ground they are about to fight on.
  const mapPicture = mapThumb(state.mapId, 'room-map-thumb');
  // The caption is a <div> now (it wraps two things), so the select names itself.
  mapSelect.setAttribute('aria-label', 'Map');
  const mapField = el('div', 'map-field');
  mapField.append(mapSelect, mapPicture.element);

  // --- the item loadout (DESIGN §4) -----------------------------------------
  // Six slots, some items costing two of them. The bar is the loadout the *server*
  // holds (`roomState.players[].items`), never a local guess: click an item to add it,
  // click a slot to give it back, and the screen redraws when the answer arrives.
  const itemBar = el('div', 'items');
  const itemPicker = el('div', 'item-picker');
  const itemHint = el('span', 'hint');
  // What an item does, for the one last pointed at, focused or tapped. A phone has no
  // hover, so a tap (which also adds the item) is what brings its card up there.
  const itemInfo = el('div', `item-info ${uiClassName('recess')}`);
  const itemField = labelled('Items', itemBar, 'div');
  itemField.append(itemPicker, itemInfo, itemHint);
  let shownItem: ItemId | null = null;
  const showItem = (id: ItemId): void => {
    if (id === shownItem) return;
    shownItem = id;
    renderItemInfo(itemInfo, id);
  };
  renderItemInfo(itemInfo, null);
  const explains = (node: HTMLElement, id: ItemId): void => {
    node.addEventListener('pointerenter', () => showItem(id));
    node.addEventListener('focus', () => showItem(id));
  };

  const itemButtons = new Map<ItemId, HTMLButtonElement>();
  for (const def of itemDefs) {
    const node = button('', 'btn uk-btn item-pick', () => {
      showItem(def.id);
      setItems(addItem(myItems(), def.id));
    });
    const text = itemText(def.id);
    node.appendChild(uiPieceElement(`item/${def.id}`, clientConstants.ui.itemIconScale));
    node.append(
      el('span', 'item-name', def.displayName),
      el('span', 'item-tagline', text.tagline),
      el('span', 'item-cost', `${def.slots === 1 ? '1 slot' : `${def.slots} slots`} · +${def.delay}`),
    );
    node.title = `${text.effect} ${itemCost(def)}.`;
    explains(node, def.id);
    itemButtons.set(def.id, node);
    itemPicker.appendChild(node);
  }
  const clearItems = button('Clear', 'btn uk-btn small', () => setItems([]));
  itemPicker.appendChild(clearItems);

  const readyButton = button('Ready', 'btn uk-btn-gold primary', () => {
    socket.send({ t: 'setReady', ready: !me()?.ready });
  });
  const startButton = button('Start match', 'btn uk-btn-gold primary', () => {
    socket.send({ t: 'start' });
  });
  // `room-actions` is the phone rule's handle: on a landscape phone these two get the
  // full width of the card and a 44 px height (index.html).
  const actions = el('div', 'row room-actions');
  actions.append(readyButton, startButton);

  setup.section.append(teamField, labelled('Map', mapField, 'div'), itemField, actions);

  // --- chat -----------------------------------------------------------------
  const chat = new ChatPanel((text) => socket.send({ t: 'chat', text }));
  chat.log.classList.add(uiClassName('recess'));
  chat.input.classList.add(uiClassName('recess'));
  chat.input.setAttribute('aria-label', 'Chat message');
  chat.sendButton.classList.add('uk-btn');
  const chatPanel = panel('Chat', 'chat-panel');
  chatPanel.section.appendChild(chat.element);

  const message = el('p', 'message');
  const statusLine = el('p', 'status');
  statusLine.setAttribute('role', 'status');

  const grid = el('div', 'room-grid');
  grid.append(players.section, picker.section, setup.section, chatPanel.section);
  page.append(header, grid, message, statusLine);
  host.replaceChildren(page);

  // A phone turned between the two layouts gets the portraits redrawn at the new
  // size: they are canvases at one backing pixel per CSS pixel, so they cannot stretch.
  const layoutQuery = window.matchMedia(COMPACT_QUERY);
  const onLayout = (): void => {
    paintTiles();
    shownInfo = null;
    render();
  };
  layoutQuery.addEventListener('change', onLayout);

  // --------------------------------------------------------------------------
  // Rendering the room
  // --------------------------------------------------------------------------

  function me(): PlayerInfo | undefined {
    const id = options.playerId();
    return state.players.find((p) => p.playerId === id);
  }

  function roomLink(): string {
    return `${window.location.origin}/r/${state.code}`;
  }

  /** Has this player touched the loadout in this room? (See `renderItems`.) */
  let itemsTouched = false;

  /** The loadout the server holds for us — the only version that counts. */
  function myItems(): ItemId[] {
    return me()?.items ?? [];
  }

  /**
   * Ask for a loadout. Nothing is drawn — and nothing is remembered — until the
   * `roomState` comes back with the list the server accepted, so what the bar shows and
   * what this browser stores for next time are always a loadout the match would start
   * with. Storing the request instead would persist a list a `badItems` refusal had
   * already thrown away, and offer it again on the next join.
   */
  function setItems(items: ItemId[]): void {
    if (state.phase !== 'lobby') return;
    itemsTouched = true;
    socket.send({ t: 'setItems', items });
  }

  function itemNames(items: readonly ItemId[]): string {
    const names: string[] = [];
    for (const entry of layoutLoadout(items)) names.push(getItemDef(entry.itemId).displayName);
    return names.length > 0 ? names.join(', ') : 'no items';
  }

  /**
   * The six slots and the eight items that can go in them (DESIGN §4). A two-slot item
   * covers two slots visibly, which is the whole point of showing a bar rather than a
   * list: six is a budget, not a count.
   */
  function renderItems(): void {
    const items = myItems();
    const layout = layoutLoadout(items);
    const inLobby = state.phase === 'lobby';
    // The accepted list is the one worth remembering for next time (see `setItems`).
    // Only once this player has asked for something, though: a fresh join starts with an
    // empty server-side list, and storing *that* would throw away the loadout the room
    // is about to offer back.
    if (inLobby && (items.length > 0 || itemsTouched)) setLoadout(items);

    itemBar.replaceChildren();
    let index = 0;
    while (index < itemSlots) {
      const entry = layout.find((e) => e.index === index);
      if (!entry) {
        itemBar.appendChild(el('div', `item-slot ${uiClassName('slot/empty')}`, String(index + 1)));
        index++;
        continue;
      }
      const def = getItemDef(entry.itemId);
      const node = button('', `item-slot filled ${uiClassName('slot/filled')}`, () => {
        setItems(removeAt(myItems(), entry.order));
      });
      node.appendChild(uiPieceElement(`item/${def.id}`, clientConstants.ui.itemIconScale));
      // A one-slot cell is narrower than "Teleport": the short label fits where the
      // full name would be cut to "Telepo…" (the title below still spells it out).
      node.appendChild(
        el('span', 'item-name', entry.span > 1 ? def.displayName : shortItemName(def.displayName)),
      );
      node.style.gridColumn = `span ${entry.span}`;
      node.title = `${def.displayName}: ${itemText(def.id).effect} ${itemCost(def)}. Click to remove.`;
      node.setAttribute('aria-label', `Remove ${def.displayName}`);
      explains(node, def.id);
      node.disabled = !inLobby;
      itemBar.appendChild(node);
      index += entry.span;
    }

    const spent = usedSlots(items);
    // The delay is spelled out because the per-slot explanation is a `title`, which a
    // phone never shows: the total is the number that actually decides a loadout, and
    // "tap" rather than "click" is what the player holding one is doing.
    let delay = 0;
    for (const entry of layout) delay += getItemDef(entry.itemId).delay;
    itemHint.textContent =
      `${spent} / ${itemSlots} slots · +${delay} delay if you use them all · ` +
      'one item per turn · tap a slot to remove';
    for (const def of itemDefs) {
      const node = itemButtons.get(def.id);
      if (!node) continue;
      node.disabled = !inLobby || !canAdd(items, def.id);
    }
    clearItems.disabled = !inLobby || items.length === 0;
  }

  function teamLabel(team: TeamId): string {
    return team === 'A' ? 'A' : 'B';
  }

  function mobileDef(id: MobileChoice): MobileDef | undefined {
    if (id === 'random') return undefined;
    try {
      return getMobileDef(id);
    } catch {
      return undefined;
    }
  }

  function difficultyLabel(difficulty: BotDifficulty): string {
    return bots.difficulties[difficulty].displayName;
  }

  function mobileLabel(id: MobileChoice): string {
    if (id === 'random') return 'Random';
    return mobileDef(id)?.displayName ?? id;
  }

  /** Every condition the server checks in `start` (DESIGN §6.1), so the button is honest. */
  function canStart(): boolean {
    if (state.phase !== 'lobby') return false;
    if (state.players.length < 2 || state.players.length > state.maxPlayers) return false;
    let a = 0;
    let b = 0;
    for (const p of state.players) {
      if (!p.ready || !p.connected) return false;
      if (p.team === 'A') a++;
      else b++;
    }
    return a > 0 && b > 0;
  }

  /**
   * One player's card: team, host crown, their mobile idling, name, loadout and a
   * ready badge. The badges are plain text in a key's frame, not buttons: only your
   * own Ready key does anything, and it lives in your setup.
   */
  function playerCard(p: PlayerInfo): HTMLElement {
    const self = p.playerId === options.playerId();
    const card = el('div', `player team-${p.team.toLowerCase()}`);
    if (self) card.classList.add('self');
    if (!p.connected) card.classList.add('offline');
    setFrame(card, CARD_FRAMES, !p.connected ? 'card/locked' : self ? 'card/selected' : 'card/normal');

    const top = el('div', 'player-top');
    const team = el('span', 'player-team');
    team.appendChild(pixelLabel(`Team ${teamLabel(p.team)}`, { scale: 2, color: '#10141c', shadow: 'transparent' }));
    top.appendChild(team);
    if (p.isHost) top.appendChild(pixelLabel('Host', { scale: 2, color: GOLD }, 'player-host'));
    if (p.bot) {
      card.classList.add('bot');
      top.appendChild(pixelLabel('Bot', { scale: 2, color: '#10141c', shadow: 'transparent' }, 'player-bot'));
    }

    const art = el('div', 'player-art');
    const box = sizes().slot;
    art.style.height = `${box.heightPx}px`;
    if (p.mobileId === 'random') {
      const q = el('div', 'tile-random', '?');
      q.style.height = `${box.heightPx}px`;
      art.appendChild(q);
    } else {
      art.appendChild(mobilePortraitCanvas(p.mobileId, { width: box.widthPx, height: box.heightPx }));
    }

    // Your own card is the gold one, with your name in gold: no "(you)" to crowd it.
    const nick = el('div', 'player-nick');
    nick.title = p.nick;
    nick.appendChild(pixelLabel(p.nick, { scale: 2, color: self ? GOLD : '#dfe7ef' }));

    const loadout = el('div', 'player-items');
    loadout.title = itemNames(p.items);
    loadout.setAttribute('aria-label', `Items: ${itemNames(p.items)}`);
    for (const entry of layoutLoadout(p.items)) {
      loadout.appendChild(uiPieceElement(`item/${entry.itemId}`, 1));
    }

    const ready = el(
      'span',
      `player-ready ${p.ready ? 'yes' : 'no'} ${uiClassName(p.ready ? 'button-gold/normal' : 'button/disabled')}`,
    );
    ready.appendChild(
      pixelLabel(p.ready ? 'Ready' : 'Waiting', {
        scale: 2,
        color: p.ready ? '#2a1604' : '#dfe7ef',
        shadow: p.ready ? 'transparent' : '#050a12',
      }),
    );

    const status = el('div', 'player-status');
    status.append(ready);
    if (p.bot) {
      // Everyone can see how hard the bot plays; the host's card also has the picker.
      status.appendChild(el('span', 'player-difficulty', difficultyLabel(p.bot.difficulty)));
    }
    if (!p.connected) {
      const conn = el('span', 'player-conn no');
      conn.append(uiPieceElement('status/offline', 1), el('span', '', 'offline'));
      status.appendChild(conn);
    }

    card.append(top, art, nick, el('span', 'player-mobile', mobileLabel(p.mobileId)), loadout, status);
    if (p.bot && hostHere()) card.appendChild(botControls(p));
    return card;
  }

  /** Is this player the host, with the room still in its lobby? The bot keys need both. */
  function hostHere(): boolean {
    return state.phase === 'lobby' && options.playerId() === state.hostId;
  }

  /**
   * The host's keys on a bot's card (DESIGN §11): difficulty, mobile, team, remove. Each
   * sends one `setBot` / `removeBot` and waits for the `roomState` like every control
   * here; nothing changes on screen until the server says so.
   */
  function botControls(p: PlayerInfo): HTMLElement {
    const row = el('div', 'bot-controls');
    const level = select<BotDifficulty>(
      botDifficulties.map((d) => ({ value: d, label: difficultyLabel(d) })),
      p.bot?.difficulty ?? bots.defaultDifficulty,
      (difficulty) => socket.send({ t: 'setBot', playerId: p.playerId, difficulty }),
    );
    level.classList.add(uiClassName('recess'), 'bot-difficulty');
    level.setAttribute('aria-label', `${p.nick}'s difficulty`);
    const mobile = select<MobileChoice>(
      choices.map((value) => ({ value, label: mobileLabel(value) })),
      p.mobileId,
      (mobileId) => socket.send({ t: 'setBot', playerId: p.playerId, mobileId }),
    );
    mobile.classList.add(uiClassName('recess'), 'bot-mobile');
    mobile.setAttribute('aria-label', `${p.nick}'s mobile`);
    row.append(level, mobile);
    // A 1v1 room assigns the teams itself (§7 item 13), for a bot as for a person.
    if (state.maxPlayers > 2) {
      const other: TeamId = p.team === 'A' ? 'B' : 'A';
      const swap = button(`To ${other}`, `btn uk-btn small team-${other.toLowerCase()}`, () =>
        socket.send({ t: 'setBot', playerId: p.playerId, team: other }),
      );
      swap.setAttribute('aria-label', `Move ${p.nick} to team ${other}`);
      row.appendChild(swap);
    }
    const remove = button('Remove', 'btn uk-btn small bot-remove', () =>
      socket.send({ t: 'removeBot', playerId: p.playerId }),
    );
    remove.setAttribute('aria-label', `Remove ${p.nick}`);
    row.appendChild(remove);
    return row;
  }

  /**
   * An empty seat: a dimmed card, so "2 of 4" is something you can see. The host can
   * fill it with a bot for either team (DESIGN §11) instead of sending the link.
   */
  function openSlot(): HTMLElement {
    const card = el('div', `player-slot empty ${uiClassName('card/locked')}`);
    const text = el('div', 'slot-text');
    text.append(pixelLabel('Open', { scale: 2, color: '#5b6874' }), el('span', 'hint', 'send the link'));
    card.appendChild(text);
    if (hostHere()) {
      const add = el('div', 'slot-bots');
      for (const team of ['A', 'B'] as const) {
        const key = button(`+ Bot ${team}`, `btn uk-btn small add-bot team-${team.toLowerCase()}`, () =>
          socket.send({ t: 'addBot', team, difficulty: bots.defaultDifficulty }),
        );
        key.setAttribute('aria-label', `Add a bot to team ${team}`);
        add.appendChild(key);
      }
      card.appendChild(add);
    }
    return card;
  }

  /** What the info box is showing, so a `roomState` that changed nothing else keeps it. */
  let shownInfo: MobileChoice | null = null;

  function renderInfo(choice: MobileChoice): void {
    if (choice === shownInfo) return;
    shownInfo = choice;
    info.replaceChildren(mobileInfoPanel(choice, sizes().detail, mobileDef(choice)));
  }

  function render(): void {
    codeValue.textContent = state.code;
    players.heading.replaceChildren(
      pixelLabel(`Players ${state.players.length} / ${state.maxPlayers}`, { scale: 2 }),
    );

    list.replaceChildren();
    for (const p of state.players) list.appendChild(playerCard(p));
    for (let i = state.players.length; i < state.maxPlayers; i++) list.appendChild(openSlot());

    const self = me();
    const isHost = !!self && self.playerId === state.hostId;
    const inLobby = state.phase === 'lobby';

    // A 1v1 room assigns the two teams by itself (DESIGN §7 item 13); the toggle only
    // earns its place once a room can hold more than two.
    teamField.hidden = state.maxPlayers <= 2;
    teamA.classList.toggle('on', self?.team === 'A');
    teamB.classList.toggle('on', self?.team === 'B');
    teamA.disabled = !inLobby;
    teamB.disabled = !inLobby;

    for (const [value, node] of mobileTiles) {
      const on = self?.mobileId === value;
      node.classList.toggle('on', on);
      node.setAttribute('aria-pressed', String(on));
      node.disabled = !inLobby;
      setFrame(node, CARD_FRAMES, !inLobby ? 'card/locked' : on ? 'card/selected' : 'card/normal');
    }
    renderInfo(self?.mobileId ?? 'random');

    mapSelect.value = state.mapId;
    mapPicture.set(state.mapId);
    mapSelect.disabled = !inLobby || !isHost;
    // Fetch the chosen map's pictures while people pick mobiles, so the match opens on
    // them without waiting (DESIGN §8.1). One load per map for the life of the page.
    const chosen = maps.find((m) => m.id === state.mapId);
    if (chosen) void preloadMapArt(chosen);

    readyButton.textContent = self?.ready ? 'Not ready' : 'Ready';
    readyButton.classList.toggle('on', !!self?.ready);
    // Ready is the gold key; once pressed it turns into the blue one that takes it back.
    readyButton.classList.toggle('uk-btn-gold', !self?.ready);
    readyButton.classList.toggle('uk-btn', !!self?.ready);
    readyButton.disabled = !inLobby;

    startButton.hidden = !isHost;
    startButton.disabled = !canStart();

    renderItems();

    if (!inLobby) {
      message.textContent = state.phase === 'match' ? 'A match is running.' : '';
    }
  }

  render();
  // The loadout this browser used last time (DESIGN §4), offered as soon as we are in
  // the room: joining resets the server's copy to empty, and re-picking six items every
  // match is exactly the chore a stored one removes.
  const remembered = loadLoadout();
  if (remembered.length > 0 && myItems().length === 0) setItems(remembered);

  return {
    destroy(): void {
      layoutQuery.removeEventListener('change', onLayout);
      host.replaceChildren();
    },
    handleMessage(msg: ServerMessage): void {
      switch (msg.t) {
        case 'roomState':
          state = msg;
          render();
          break;
        case 'chat':
          chat.push({ from: msg.from, text: msg.text, ts: msg.ts });
          break;
        case 'error':
          message.textContent = msg.message;
          message.classList.add('bad');
          break;
        default:
          break;
      }
    },
    setStatus(status: SocketStatus): void {
      statusLine.textContent = status === 'open' ? '' : 'Reconnecting…';
    },
  };
}

/** Does this browser have a share sheet? Desktop Chrome and Firefox do not. */
function canShare(): boolean {
  return typeof navigator.share === 'function';
}

/**
 * Share the link, or copy it, or give up and let the caller show it.
 *
 * A cancelled share sheet rejects exactly like a failed one, so it falls through to the
 * clipboard rather than being reported: either way the player still has the link.
 */
async function shareOrCopy(link: string, code: string): Promise<'shared' | 'copied' | 'failed'> {
  if (canShare()) {
    try {
      await navigator.share({ title: 'GunBros', text: `Room ${code}`, url: link });
      return 'shared';
    } catch {
      // Cancelled, or refused: fall through to the clipboard.
    }
  }
  return (await copyText(link)) ? 'copied' : 'failed';
}

/** Clipboard access is permission-gated and fails silently in some browsers. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
