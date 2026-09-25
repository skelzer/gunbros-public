/**
 * Runtime validation of everything that arrives on a socket (DESIGN §1.4, §6.1).
 *
 * The shared package gives us the *types*; types are erased at runtime, so nothing here
 * may assume a field exists, has the right kind, or is inside its range. Hand-written
 * guards, no schema library: there are twenty messages, the rules are all one-liners,
 * and a dependency that validates JSON is a dependency that has to be audited.
 *
 * Rule of the house: `parseClientMessage` either returns a fully-typed message whose
 * every field has been checked, or an error code and a human-readable reason. The
 * callers never re-check and never coerce.
 */
import {
  canAddToLoadout,
  isBotDifficulty,
  isPickableMobile,
  itemSlots,
  getItemDef,
  itemDefs,
  maps,
  shotSlots,
} from '@gunbros/shared';
import type {
  ClientMessage,
  ClientMessageType,
  ItemId,
  MapId,
  MobileId,
  ShotSlot,
  TeamId,
} from '@gunbros/shared';
import { config } from './config.js';

/**
 * A sanity bound on any angle on the wire: the mobile's real range comes from its
 * definition and is applied by the simulation (`clamp(relAngle, def.angleMin, …)`), so
 * this only rejects nonsense like `1e9` before it reaches the sim.
 */
const ANGLE_SANITY_DEG = 360;

export interface ParseOk {
  ok: true;
  msg: ClientMessage;
}
export interface ParseErr {
  ok: false;
  code: string;
  message: string;
}
export type ParseResult = ParseOk | ParseErr;

function fail(code: string, message: string): ParseErr {
  return { ok: false, code, message };
}

type Record_ = Record<string, unknown>;

function isObject(v: unknown): v is Record_ {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function inRange(v: unknown, min: number, max: number): v is number {
  return isFiniteNum(v) && v >= min && v <= max;
}

function isDir(v: unknown): v is -1 | 0 | 1 {
  return v === -1 || v === 0 || v === 1;
}

function isShotSlot(v: unknown): v is ShotSlot {
  for (let i = 0; i < shotSlots.length; i++) if (shotSlots[i] === v) return true;
  return false;
}

function isTeam(v: unknown): v is TeamId {
  return v === 'A' || v === 'B';
}

function isItemId(v: unknown): v is ItemId {
  for (let i = 0; i < itemDefs.length; i++) if (itemDefs[i]?.id === v) return true;
  return false;
}

function isMapId(v: unknown): v is MapId {
  for (let i = 0; i < maps.length; i++) if (maps[i]?.id === v) return true;
  return false;
}

/**
 * 'random' or a mobile a player is allowed to choose by hand — every id in
 * `mobileDefs` except the `randomOnly` ones, which are reachable only through the
 * Random roll (DESIGN §3, §7 item 10).
 */
function isMobileChoice(v: unknown): v is MobileId | 'random' {
  return v === 'random' || (typeof v === 'string' && isPickableMobile(v));
}

/** A player id on the wire: ids are short hex strings (rooms.ts, bot.ts). */
function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= config.maxTokenLength;
}

/**
 * Nicknames and chat come from a text field: strip anything that would break a log
 * line or a canvas draw, collapse the whitespace, and cut to length. Never reject a
 * name for its contents — a trimmed name is friendlier than an error dialog.
 */
export function sanitiseText(raw: string, maxLength: number): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      // Control characters, including the newlines a chat line must not contain.
      out += ' ';
      continue;
    }
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > maxLength ? out.slice(0, maxLength) : out;
}

export function sanitiseNick(raw: unknown): string {
  const text = typeof raw === 'string' ? sanitiseText(raw, config.nickMaxLength) : '';
  return text.length > 0 ? text : 'Player';
}

/**
 * A client value quoted back in an error, cut short: an error must never cost the
 * server as many bytes as the junk that caused it (a 64 KB `t` echoed per frame).
 */
function clip(value: unknown): string {
  const text = typeof value === 'string' ? value : typeof value;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/**
 * Items chosen in the room: known ids, within the six slots, and duplicates of a
 * one-slot item only (DESIGN §4, §7 item 98).
 *
 * Every item is a consumable (DESIGN §7 item 92), so "three bandages" is a perfectly
 * sensible loadout and the picker offers it. A second copy of a two-slot item is
 * refused: it would spend four of the six slots on one trick, and the two big ones
 * (Dual, Dual+) already decide a turn on their own.
 *
 * No entry can cost less than one slot, so a list longer than `itemSlots` is over
 * budget by construction and is rejected before it is walked.
 */
function validateItems(value: unknown): ItemId[] | ParseErr {
  if (!Array.isArray(value)) return fail('badItems', 'items must be an array');
  if (value.length > itemSlots) return fail('badItems', 'too many items');
  const out: ItemId[] = [];
  let slots = 0;
  for (let i = 0; i < value.length; i++) {
    const id: unknown = value[i];
    if (!isItemId(id)) return fail('badItems', `unknown item "${clip(id)}"`);
    const def = getItemDef(id);
    slots += def.slots;
    // One rule, shared with the room's picker (`canAddToLoadout`), so a pick the client
    // offers is never a pick this refuses; the message only says which half failed.
    if (!canAddToLoadout(out, id)) {
      if (def.slots > 1 && out.includes(id)) {
        return fail('badItems', `"${id}" takes ${def.slots} slots and cannot be doubled`);
      }
      return fail('badItems', `loadout needs ${slots} of ${itemSlots} slots`);
    }
    out.push(id);
  }
  return out;
}

const clientMessageTypes: ClientMessageType[] = [
  'hello',
  'createRoom',
  'joinRoom',
  'listRooms',
  'leaveRoom',
  'setTeam',
  'setMobile',
  'setItems',
  'setMap',
  'setReady',
  'start',
  'addBot',
  'setBot',
  'removeBot',
  'chat',
  'move',
  'aim',
  'selectShot',
  'useItem',
  'fire',
  'skip',
  'charging',
  'requestTerrain',
  'ping',
];

export function isClientMessageType(v: unknown): v is ClientMessageType {
  for (let i = 0; i < clientMessageTypes.length; i++) if (clientMessageTypes[i] === v) return true;
  return false;
}

/**
 * Parse one raw frame. `raw` is whatever the socket produced: the size cap is applied
 * here as well as by `ws`'s own `maxPayload`, because a text frame that arrives in
 * fragments is only whole at this point.
 */
export function parseClientMessage(raw: string): ParseResult {
  if (raw.length > config.maxMessageBytes) {
    return fail('tooLarge', `message exceeds ${config.maxMessageBytes} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail('badJson', 'message is not valid JSON');
  }
  if (!isObject(value)) return fail('badMessage', 'message must be a JSON object');
  const t: unknown = value.t;
  if (!isClientMessageType(t)) return fail('unknownType', `unknown message type "${clip(t)}"`);

  switch (t) {
    case 'hello': {
      const token: unknown = value.token;
      if (
        token !== undefined &&
        (typeof token !== 'string' || token.length > config.maxTokenLength)
      ) {
        return fail('badToken', 'token must be a short string');
      }
      const msg: ClientMessage = { t: 'hello', nick: sanitiseNick(value.nick) };
      if (typeof token === 'string' && token.length > 0) msg.token = token;
      return { ok: true, msg };
    }
    case 'createRoom': {
      const mapId: unknown = value.mapId;
      const maxPlayers: unknown = value.maxPlayers;
      const listed: unknown = value.listed;
      const practice: unknown = value.practice;
      if (mapId !== undefined && !isMapId(mapId)) return fail('badMap', 'unknown map id');
      if (listed !== undefined && typeof listed !== 'boolean') {
        return fail('badListed', 'listed must be true or false');
      }
      if (practice !== undefined && typeof practice !== 'boolean') {
        return fail('badPractice', 'practice must be true or false');
      }
      if (
        maxPlayers !== undefined &&
        !(
          Number.isInteger(maxPlayers) &&
          inRange(maxPlayers, config.minPlayersToStart, config.maxPlayersPerRoom)
        )
      ) {
        return fail(
          'badMaxPlayers',
          `maxPlayers must be ${config.minPlayersToStart}..${config.maxPlayersPerRoom}`,
        );
      }
      const msg: ClientMessage = { t: 'createRoom' };
      if (isMapId(mapId)) msg.mapId = mapId;
      if (typeof maxPlayers === 'number') msg.maxPlayers = maxPlayers;
      if (listed === true) msg.listed = true;
      if (practice === true) msg.practice = true;
      return { ok: true, msg };
    }
    case 'joinRoom': {
      const code: unknown = value.code;
      if (typeof code !== 'string' || code.length === 0 || code.length > config.maxRoomCodeLength) {
        return fail('badCode', 'room code must be a short string');
      }
      return { ok: true, msg: { t: 'joinRoom', code: code.toUpperCase() } };
    }
    case 'listRooms':
      return { ok: true, msg: { t: 'listRooms' } };
    case 'leaveRoom':
      return { ok: true, msg: { t: 'leaveRoom' } };
    case 'setTeam': {
      if (!isTeam(value.team)) return fail('badTeam', 'team must be "A" or "B"');
      return { ok: true, msg: { t: 'setTeam', team: value.team } };
    }
    case 'setMobile': {
      if (!isMobileChoice(value.mobileId)) {
        return fail('badMobile', 'unknown or not-yet-implemented mobile');
      }
      return { ok: true, msg: { t: 'setMobile', mobileId: value.mobileId } };
    }
    case 'setItems': {
      const items = validateItems(value.items);
      if (!Array.isArray(items)) return items;
      return { ok: true, msg: { t: 'setItems', items } };
    }
    case 'setMap': {
      if (!isMapId(value.mapId)) return fail('badMap', 'unknown map id');
      return { ok: true, msg: { t: 'setMap', mapId: value.mapId } };
    }
    case 'setReady': {
      if (typeof value.ready !== 'boolean') return fail('badReady', 'ready must be a boolean');
      return { ok: true, msg: { t: 'setReady', ready: value.ready } };
    }
    case 'start':
      return { ok: true, msg: { t: 'start' } };
    case 'addBot': {
      if (!isTeam(value.team)) return fail('badTeam', 'team must be "A" or "B"');
      if (!isBotDifficulty(value.difficulty)) {
        return fail('badDifficulty', 'difficulty must be easy, normal or hard');
      }
      return { ok: true, msg: { t: 'addBot', team: value.team, difficulty: value.difficulty } };
    }
    case 'setBot': {
      const playerId: unknown = value.playerId;
      if (!isPlayerId(playerId)) return fail('badPlayer', 'playerId must be a short string');
      const msg: ClientMessage = { t: 'setBot', playerId };
      if (value.team !== undefined) {
        if (!isTeam(value.team)) return fail('badTeam', 'team must be "A" or "B"');
        msg.team = value.team;
      }
      if (value.mobileId !== undefined) {
        if (!isMobileChoice(value.mobileId)) {
          return fail('badMobile', 'unknown or not-yet-implemented mobile');
        }
        msg.mobileId = value.mobileId;
      }
      if (value.difficulty !== undefined) {
        if (!isBotDifficulty(value.difficulty)) {
          return fail('badDifficulty', 'difficulty must be easy, normal or hard');
        }
        msg.difficulty = value.difficulty;
      }
      return { ok: true, msg };
    }
    case 'removeBot': {
      const playerId: unknown = value.playerId;
      if (!isPlayerId(playerId)) return fail('badPlayer', 'playerId must be a short string');
      return { ok: true, msg: { t: 'removeBot', playerId } };
    }
    case 'chat': {
      if (typeof value.text !== 'string') return fail('badChat', 'text must be a string');
      const text = sanitiseText(value.text, config.chatMaxLength);
      if (text.length === 0) return fail('badChat', 'empty message');
      return { ok: true, msg: { t: 'chat', text } };
    }
    case 'move': {
      if (!isDir(value.dir)) return fail('badDir', 'dir must be -1, 0 or 1');
      if (!isFiniteNum(value.seq)) return fail('badSeq', 'seq must be a number');
      return { ok: true, msg: { t: 'move', dir: value.dir, seq: value.seq } };
    }
    case 'aim': {
      // The mobile's own range is applied by the sim; this only rejects nonsense.
      if (!inRange(value.relAngle, -ANGLE_SANITY_DEG, ANGLE_SANITY_DEG)) {
        return fail('badAngle', 'relAngle out of range');
      }
      return { ok: true, msg: { t: 'aim', relAngle: value.relAngle } };
    }
    case 'selectShot': {
      if (!isShotSlot(value.shot)) return fail('badShot', 'shot must be s1, s2 or ss');
      return { ok: true, msg: { t: 'selectShot', shot: value.shot } };
    }
    case 'useItem': {
      if (!isItemId(value.itemId)) return fail('badItem', 'unknown item id');
      const target: unknown = value.target;
      if (target !== undefined) {
        if (!isObject(target) || !isFiniteNum(target.x) || !isFiniteNum(target.y)) {
          return fail('badTarget', 'target must be { x, y }');
        }
        return {
          ok: true,
          msg: { t: 'useItem', itemId: value.itemId, target: { x: target.x, y: target.y } },
        };
      }
      return { ok: true, msg: { t: 'useItem', itemId: value.itemId } };
    }
    case 'fire': {
      if (!isShotSlot(value.shot)) return fail('badShot', 'shot must be s1, s2 or ss');
      if (!inRange(value.relAngle, -ANGLE_SANITY_DEG, ANGLE_SANITY_DEG)) {
        return fail('badAngle', 'relAngle out of range');
      }
      if (!inRange(value.power, 0, 1)) return fail('badPower', 'power must be in [0, 1]');
      if (!isFiniteNum(value.seq)) return fail('badSeq', 'seq must be a number');
      return {
        ok: true,
        msg: {
          t: 'fire',
          shot: value.shot,
          relAngle: value.relAngle,
          power: value.power,
          seq: value.seq,
        },
      };
    }
    case 'skip':
      return { ok: true, msg: { t: 'skip' } };
    case 'charging': {
      // Negative is legal and means "stopped charging" (DESIGN §7 item 18).
      if (!inRange(value.power, -1, 1)) return fail('badPower', 'power must be in [-1, 1]');
      return { ok: true, msg: { t: 'charging', power: value.power } };
    }
    case 'requestTerrain':
      return { ok: true, msg: { t: 'requestTerrain' } };
    case 'ping':
      return { ok: true, msg: { t: 'ping' } };
  }
}
