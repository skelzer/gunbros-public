/**
 * Session settings (DESIGN §1.3 state/session.ts): nickname, the sound mode and the
 * reconnect token in localStorage.
 *
 * The token is the one the server hands out in `welcome` (DESIGN §6.4): sending it back
 * with the next `hello` rebinds this browser to the same player, room and seat.
 *
 * Every access is wrapped: Safari in private mode throws on `localStorage`, and a game
 * that cannot remember a nickname must still start.
 */
import { isItemId, validateLoadout } from '@gunbros/shared';
import type { ItemId } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';

const KEYS = {
  nick: 'gunbros.nick',
  mute: 'gunbros.mute',
  /** '0' once the music was turned off; absent means on (DESIGN §8.3). */
  music: 'gunbros.music',
  token: 'gunbros.token',
  items: 'gunbros.items',
} as const;

const DEFAULT_NICK = 'Player';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage disabled: nothing to forget.
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage disabled or full: the setting simply does not persist.
  }
}

/**
 * What the sound button is set to (DESIGN §8.3): everything, the effects without the
 * music, or nothing. One button and one key step through them in that order, so a
 * player who only wants the music gone presses once and loses nothing else.
 */
export type SoundMode = 'on' | 'noMusic' | 'off';

export interface Session {
  nick: string;
  /** Sound effects off. Also true in `sound: 'off'`, which is what `mute` always meant. */
  mute: boolean;
  sound: SoundMode;
  token: string | null;
}

export function loadSession(): Session {
  const sound = loadSoundMode();
  return {
    nick: read(KEYS.nick) ?? DEFAULT_NICK,
    mute: sound === 'off',
    sound,
    token: loadToken(),
  };
}

/**
 * The stored mode. Two keys rather than one, because `gunbros.mute` predates the music:
 * a browser that muted before there was any keeps its silence.
 */
export function loadSoundMode(): SoundMode {
  if (read(KEYS.mute) === '1') return 'off';
  return read(KEYS.music) === '0' ? 'noMusic' : 'on';
}

export function setSoundMode(mode: SoundMode): void {
  write(KEYS.mute, mode === 'off' ? '1' : '0');
  write(KEYS.music, mode === 'on' ? '1' : '0');
}

/** The mode the button goes to next: on, then no music, then off, then on again. */
export function nextSoundMode(mode: SoundMode): SoundMode {
  return mode === 'on' ? 'noMusic' : mode === 'noMusic' ? 'off' : 'on';
}

/** The mode in the controls card's words: "M sound on", "M sound music off". */
export function soundModeWord(mode: SoundMode): string {
  return mode === 'on' ? 'on' : mode === 'noMusic' ? 'music off' : 'off';
}

/** Step the stored mode and persist it. Returns the new mode. */
export function cycleSoundMode(): SoundMode {
  const next = nextSoundMode(loadSoundMode());
  setSoundMode(next);
  return next;
}

/**
 * The stored nickname, or null when this browser has never been given one. The lobby
 * needs the difference: an empty field asks for a name, `DEFAULT_NICK` does not.
 */
export function storedNick(): string | null {
  const nick = read(KEYS.nick);
  return nick !== null && nick.trim().length > 0 ? nick : null;
}

export function loadToken(): string | null {
  const token = read(KEYS.token);
  return token !== null && token.length > 0 ? token : null;
}

export function setToken(token: string): void {
  write(KEYS.token, token);
}

/** Forget the session token: the next `hello` mints a fresh player. */
export function clearToken(): void {
  remove(KEYS.token);
}

export function setNick(nick: string): void {
  const trimmed = nick.trim();
  write(KEYS.nick, trimmed.length > 0 ? trimmed : DEFAULT_NICK);
}

/**
 * The item loadout this browser last sent to a room (DESIGN §4), so a returning player
 * does not rebuild it every match.
 *
 * It is stored as ids and re-validated on the way out: `validateLoadout` drops anything
 * an item table no longer knows about and anything that no longer fits in the six
 * slots, so a renamed or removed item cannot wedge the picker.
 */
export function loadLoadout(): ItemId[] {
  const raw = read(KEYS.items);
  if (raw === null) return validateLoadout(clientConstants.loadout.default);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: ItemId[] = [];
    for (const entry of parsed) if (isItemId(entry)) ids.push(entry);
    return validateLoadout(ids);
  } catch {
    return [];
  }
}

export function setLoadout(items: readonly ItemId[]): void {
  write(KEYS.items, JSON.stringify(validateLoadout(items)));
}
