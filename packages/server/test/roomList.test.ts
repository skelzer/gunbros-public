/** The lobby's open-rooms list: `listRooms` → `roomList`. */
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { RoomListMsg, ServerMessage } from '@gunbros/shared';
import { Connection } from '../src/connection.js';
import { parseClientMessage } from '../src/protocol.js';
import { RoomManager } from '../src/rooms.js';

/** A connection whose socket just records what the server sends. */
function client(manager: RoomManager, nick: string, address: string) {
  const sent: ServerMessage[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => sent.push(JSON.parse(data) as ServerMessage),
    terminate: () => {},
    close: () => {},
  };
  const conn = new Connection(socket as unknown as WebSocket, address);
  manager.handle(conn, { t: 'hello', nick });
  return { conn, sent };
}

function list(manager: RoomManager, conn: Connection, sent: ServerMessage[]): RoomListMsg['rooms'] {
  manager.handle(conn, { t: 'listRooms' });
  const reply = sent[sent.length - 1];
  if (reply?.t !== 'roomList') throw new Error(`expected roomList, got ${reply?.t}`);
  return reply.rooms;
}

function codeOf(sent: ServerMessage[]): string {
  const state = [...sent].reverse().find((m) => m.t === 'roomState');
  if (state?.t !== 'roomState') throw new Error('no roomState');
  return state.code;
}

describe('open-rooms list', () => {
  const manager = new RoomManager();
  afterEach(() => manager.stop());

  it('shows listed rooms with a free seat, fullest first, and never unlisted ones', () => {
    const looker = client(manager, 'Looker', '10.0.0.1');
    expect(list(manager, looker.conn, looker.sent)).toEqual([]);

    const solo = client(manager, 'Solo', '10.0.0.2');
    manager.handle(solo.conn, { t: 'createRoom', mapId: 'hills', maxPlayers: 4, listed: true });
    const soloCode = codeOf(solo.sent);

    const pair = client(manager, 'Pair', '10.0.0.3');
    manager.handle(pair.conn, { t: 'createRoom', maxPlayers: 4, listed: true });
    const pairCode = codeOf(pair.sent);
    const guest = client(manager, 'Guest', '10.0.0.4');
    manager.handle(guest.conn, { t: 'joinRoom', code: pairCode });

    const secret = client(manager, 'Secret', '10.0.0.5');
    manager.handle(secret.conn, { t: 'createRoom' });
    const secretCode = codeOf(secret.sent);

    const rooms = list(manager, looker.conn, looker.sent);
    expect(rooms.map((r) => r.code)).toEqual([pairCode, soloCode]);
    expect(rooms[0]).toMatchObject({ host: 'Pair', players: 2, maxPlayers: 4 });
    expect(rooms[1]).toMatchObject({ host: 'Solo', mapId: 'hills', players: 1 });
    expect(rooms.some((r) => r.code === secretCode)).toBe(false);
  });

  it('drops a room once it is full', () => {
    const looker = client(manager, 'Looker', '10.0.1.1');
    const host = client(manager, 'Host', '10.0.1.2');
    manager.handle(host.conn, { t: 'createRoom', maxPlayers: 2, listed: true });
    expect(list(manager, looker.conn, looker.sent)).toHaveLength(1);

    const guest = client(manager, 'Guest', '10.0.1.3');
    manager.handle(guest.conn, { t: 'joinRoom', code: codeOf(host.sent) });
    expect(list(manager, looker.conn, looker.sent)).toEqual([]);
  });

  it('drops a room whose only player has disconnected', () => {
    const looker = client(manager, 'Looker', '10.0.2.1');
    const host = client(manager, 'Host', '10.0.2.2');
    manager.handle(host.conn, { t: 'createRoom', listed: true });
    expect(list(manager, looker.conn, looker.sent)).toHaveLength(1);

    manager.onSocketClose(host.conn);
    expect(list(manager, looker.conn, looker.sent)).toEqual([]);
  });

  it('parses listRooms, and `listed` only as a boolean', () => {
    expect(parseClientMessage('{"t":"listRooms"}')).toEqual({ ok: true, msg: { t: 'listRooms' } });
    expect(parseClientMessage('{"t":"createRoom","listed":true}')).toEqual({
      ok: true,
      msg: { t: 'createRoom', listed: true },
    });
    expect(parseClientMessage('{"t":"createRoom","listed":false}')).toEqual({
      ok: true,
      msg: { t: 'createRoom' },
    });
    expect(parseClientMessage('{"t":"createRoom","listed":"yes"}')).toMatchObject({
      ok: false,
      code: 'badListed',
    });
  });
});
