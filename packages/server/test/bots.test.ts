/**
 * Practice bots on the server (DESIGN §11, §7 items 186-192): the room rules, a whole
 * bot-versus-bot match on a fast clock, and a 2v2 of one human and three bots over real
 * sockets that has to stay in lockstep.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { bots } from '@gunbros/shared';
import type { FireBroadcastMsg, MoveEchoMsg, RoomStateMsg, ServerMessage, TurnStartMsg } from '@gunbros/shared';
import { Connection } from '../src/connection.js';
import { config } from '../src/config.js';
import { startServer } from '../src/index.js';
import type { RunningServer } from '../src/index.js';
import { MatchRunner } from '../src/matchRunner.js';
import { metrics } from '../src/metrics.js';
import { isConnected } from '../src/player.js';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/rooms.js';
import { TestClient } from './testClient.js';

/** A connection whose socket just records what the server sends (as in roomList.test). */
function client(manager: RoomManager, nick: string, address = '10.0.0.1') {
  const sent: ServerMessage[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => sent.push(JSON.parse(data) as ServerMessage),
    terminate: () => {},
    close: () => {
      socket.readyState = 3;
    },
  };
  const conn = new Connection(socket as unknown as WebSocket, address);
  manager.handle(conn, { t: 'hello', nick });
  const last = <T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> => {
    const found = [...sent].reverse().find((m) => m.t === t);
    if (!found) throw new Error(`no ${t} yet`);
    return found as Extract<ServerMessage, { t: T }>;
  };
  return { conn, sent, last, socket };
}

const savedSky = config.forcedSkyEvent;
const savedBurst = config.roomCreateBurst;
beforeAll(() => {
  // Pinned so that no test here plays under a random tornado (see match.test.ts).
  config.forcedSkyEvent = 'none';
  config.roomCreateBurst = 1000;
});
afterAll(() => {
  config.forcedSkyEvent = savedSky;
  config.roomCreateBurst = savedBurst;
});

describe('bots in the room', () => {
  const manager = new RoomManager();
  afterEach(() => manager.stop());

  it('practice opens an unlisted room with a Normal bot on team B', () => {
    const host = client(manager, 'Ana');
    manager.handle(host.conn, { t: 'createRoom', mapId: 'hills', listed: true, practice: true });
    const state = host.last('roomState');
    expect(state.players).toHaveLength(2);
    const [human, bot] = state.players;
    expect(human).toMatchObject({ nick: 'Ana', team: 'A', isHost: true });
    expect(human?.bot).toBeUndefined();
    expect(bot).toMatchObject({ team: 'B', ready: true, connected: true, bot: { difficulty: 'normal' } });
    const room = manager.rooms.get(state.code);
    expect(room?.listed).toBe(false);
    // Bots are the room's, not the server's: nobody can log in as one.
    expect(manager.players()).toHaveLength(1);
  });

  it('lets only the host add, change and remove bots, and only in the lobby', () => {
    const host = client(manager, 'Ana');
    manager.handle(host.conn, { t: 'createRoom', maxPlayers: 4 });
    const code = host.last('roomState').code;
    const guest = client(manager, 'Bruno', '10.0.0.2');
    manager.handle(guest.conn, { t: 'joinRoom', code });

    manager.handle(guest.conn, { t: 'addBot', team: 'B', difficulty: 'hard' });
    expect(guest.last('error').code).toBe('notHost');

    manager.handle(host.conn, { t: 'addBot', team: 'B', difficulty: 'hard' });
    manager.handle(host.conn, { t: 'addBot', team: 'A', difficulty: 'easy' });
    let state = host.last('roomState');
    const bots = state.players.filter((p) => p.bot);
    expect(bots.map((b) => [b.team, b.bot?.difficulty])).toEqual([
      ['B', 'hard'],
      ['A', 'easy'],
    ]);
    // Unique names.
    expect(new Set(bots.map((b) => b.nick)).size).toBe(2);

    manager.handle(host.conn, { t: 'addBot', team: 'A', difficulty: 'easy' });
    expect(host.last('error').code).toBe('roomFull');

    const first = bots[0];
    if (!first) throw new Error('no bot');
    manager.handle(guest.conn, { t: 'setBot', playerId: first.playerId, difficulty: 'easy' });
    expect(guest.last('error').code).toBe('notHost');
    manager.handle(host.conn, {
      t: 'setBot',
      playerId: first.playerId,
      team: 'A',
      mobileId: 'boomer',
      difficulty: 'normal',
    });
    state = host.last('roomState');
    expect(state.players.find((p) => p.playerId === first.playerId)).toMatchObject({
      team: 'A',
      mobileId: 'boomer',
      bot: { difficulty: 'normal' },
      ready: true,
    });
    // A human is not a bot to be set or removed.
    const bruno = state.players.find((p) => p.nick === 'Bruno');
    manager.handle(host.conn, { t: 'removeBot', playerId: bruno?.playerId ?? '' });
    expect(host.last('error').code).toBe('noSuchBot');

    manager.handle(host.conn, { t: 'removeBot', playerId: first.playerId });
    expect(host.last('roomState').players).toHaveLength(3);

    // In a match, the lobby picks are closed to bots as to everyone.
    manager.handle(host.conn, { t: 'setTeam', team: 'A' });
    manager.handle(guest.conn, { t: 'setTeam', team: 'B' });
    manager.handle(host.conn, { t: 'setReady', ready: true });
    manager.handle(guest.conn, { t: 'setReady', ready: true });
    manager.handle(host.conn, { t: 'start' });
    expect(host.last('matchStart').players.filter((p) => p.bot)).toHaveLength(1);
    manager.handle(host.conn, { t: 'addBot', team: 'A', difficulty: 'easy' });
    expect(host.last('error').code).toBe('notInLobby');
    const remaining = host.last('roomState').players.find((p) => p.bot);
    manager.handle(host.conn, { t: 'removeBot', playerId: remaining?.playerId ?? '' });
    expect(host.last('error').code).toBe('notInLobby');
  });

  it('starts a match with one human and one bot', () => {
    const host = client(manager, 'Ana');
    manager.handle(host.conn, { t: 'createRoom', practice: true });
    manager.handle(host.conn, { t: 'setReady', ready: true });
    manager.handle(host.conn, { t: 'start' });
    const start = host.last('matchStart');
    expect(start.players.map((p) => !!p.bot)).toEqual([false, true]);
    expect(start.players[1]?.bot).toEqual({ difficulty: 'normal' });
    const room = manager.rooms.get(host.last('roomState').code);
    expect(room?.runner).not.toBeNull();
    const bot = room?.players.find((p) => p.bot);
    if (!bot || !room?.runner) throw new Error('no bot');
    expect(room.runner.hasBot(bot)).toBe(true);
    expect(isConnected(bot)).toBe(true);
  });

  it('never makes a bot the host, and the bots leave with the last human', () => {
    const host = client(manager, 'Ana');
    manager.handle(host.conn, { t: 'createRoom', maxPlayers: 4, practice: true });
    const code = host.last('roomState').code;
    const guest = client(manager, 'Bruno', '10.0.0.2');
    manager.handle(guest.conn, { t: 'joinRoom', code });
    manager.handle(host.conn, { t: 'addBot', team: 'A', difficulty: 'hard' });

    manager.handle(host.conn, { t: 'leaveRoom' });
    const state = guest.last('roomState');
    expect(state.players.find((p) => p.isHost)?.nick).toBe('Bruno');
    expect(state.players.filter((p) => p.bot)).toHaveLength(2);

    manager.handle(guest.conn, { t: 'leaveRoom' });
    expect(manager.rooms.has(code)).toBe(false);
  });

  it('stops a match of bots alone when the last human leaves it', () => {
    const host = client(manager, 'Ana');
    manager.handle(host.conn, { t: 'createRoom', maxPlayers: 4, practice: true });
    const code = host.last('roomState').code;
    manager.handle(host.conn, { t: 'addBot', team: 'A', difficulty: 'hard' });
    manager.handle(host.conn, { t: 'setReady', ready: true });
    manager.handle(host.conn, { t: 'start' });
    const room = manager.rooms.get(code);
    const runner = room?.runner;
    if (!room || !runner) throw new Error('no match');
    const stop = vi.spyOn(runner, 'stop');
    manager.handle(host.conn, { t: 'leaveRoom' });
    expect(stop).toHaveBeenCalled();
    expect(manager.rooms.has(code)).toBe(false);
    expect(room.players).toEqual([]);
  });

  it('never sweeps a bot, and reaps the room once its human is gone for good', () => {
    const host = client(manager, 'Ana');
    manager.handle(host.conn, { t: 'createRoom', listed: true, maxPlayers: 4 });
    const code = host.last('roomState').code;
    manager.handle(host.conn, { t: 'addBot', team: 'B', difficulty: 'easy' });
    const looker = client(manager, 'Looker', '10.0.0.3');
    manager.handle(looker.conn, { t: 'listRooms' });
    // Bots take seats: two of four.
    expect(looker.last('roomList').rooms.find((r) => r.code === code)?.players).toBe(2);

    manager.sweep(Date.now() + config.reconnectGraceMs + 1);
    expect(manager.rooms.get(code)?.players).toHaveLength(2);

    // The human drops: a room with only a bot "connected" is nobody to play with.
    host.socket.close();
    manager.onSocketClose(host.conn);
    manager.handle(looker.conn, { t: 'listRooms' });
    expect(looker.last('roomList').rooms.find((r) => r.code === code)).toBeUndefined();
    manager.sweep(Date.now() + config.reconnectGraceMs + 1);
    expect(manager.rooms.has(code)).toBe(false);
  });
});

/**
 * Make every walk worth taking, so a lockstep test is sure to replay walks (§7 item
 * 190): a negative walking cost turns into a bonus for the furthest safe position.
 */
function forceWalking(): () => void {
  const saved = bots.walk.costPerPx;
  const savedBudget = bots.budgetMsPerTick;
  bots.walk.costPerPx = -1;
  // With `botTimeScale` shortening the think time, a slow CI runner ran out of it before
  // the walks were searched and fired the standing shot: let the plan finish in a tick.
  bots.budgetMsPerTick = 10_000;
  return () => {
    bots.walk.costPerPx = saved;
    bots.budgetMsPerTick = savedBudget;
  };
}

/** Bot walks in the messages: `moveEcho`s with a direction, from a bot's seat. */
function walks(received: ServerMessage[], seats: number[]): MoveEchoMsg[] {
  return received.filter((m): m is MoveEchoMsg => m.t === 'moveEcho' && m.dir !== 0 && seats.includes(m.seat));
}

describe('a bot-versus-bot match', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs to matchEnd, every intent through the runner, in lockstep with a replaying engine', () => {
    // Only the clock the runner schedules by is faked; the planner's per-tick budget
    // reads `performance.now()`, which stays real, so the search is timed as it would be.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const room = new Room('BOTS1', 2);
    room.mapId = 'hills';
    for (const team of ['A', 'B'] as const) {
      const bot = room.seatBot(team, 'hard');
      if (typeof bot === 'string') throw new Error(bot);
      bot.mobileId = 'armor';
    }
    // The shadow engine: everything the room broadcasts, applied as a client would.
    const shadow = TestClient.offline('shadow');
    const broadcast = room.broadcast.bind(room);
    room.broadcast = (msg, except) => {
      shadow.feed(msg);
      broadcast(msg, except);
    };
    const fires = vi.spyOn(MatchRunner.prototype, 'onFire');
    const before = metrics.matches.length;

    room.phase = 'match';
    room.runner = MatchRunner.start(room, 424242);
    const runner = room.runner;
    const rngAtStart = runner.state.rng.getState();

    // A match is a few minutes of game time; run it in one-second slices.
    let seconds = 0;
    while (room.phase === 'match' && seconds < 1800) {
      vi.advanceTimersByTime(1000);
      seconds++;
    }

    expect(room.phase).toBe('lobby');
    expect(metrics.matches.length).toBe(before + 1);
    const record = metrics.matches[0];
    expect(record?.reason).toBe('eliminated');
    expect(record?.winnerTeam).not.toBeNull();
    expect(record?.players.map((p) => p.bot)).toEqual(['hard', 'hard']);
    // Both bots fired, every turn was a shot, and the replaying engine agreed at every
    // turn end — which it could not if a plan had drawn from the match's PRNG.
    const shots = shadow.received.filter((m): m is FireBroadcastMsg => m.t === 'fire');
    expect(new Set(shots.map((m) => m.seat)).size).toBe(2);
    expect(fires).toHaveBeenCalled();
    expect(shadow.received.some((m) => m.t === 'skipEcho')).toBe(false);
    expect(shadow.turnEnds.length).toBeGreaterThan(1);
    expect(shadow.turnEnds.every((r) => r.matched)).toBe(true);
    expect(shadow.received.some((m) => m.t === 'matchEnd')).toBe(true);
    expect(runner.state.rng.getState()).not.toEqual(rngAtStart);
    // Back in the lobby, still ready, still there.
    expect(room.players.every((p) => p.ready && p.bot)).toBe(true);
    fires.mockRestore();
  }, 120_000);

  it('stays in lockstep when the bots walk before they fire', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const restore = forceWalking();
    try {
      const room = new Room('BOTS3', 2);
      room.mapId = 'temple';
      for (const team of ['A', 'B'] as const) {
        const bot = room.seatBot(team, 'hard');
        if (typeof bot === 'string') throw new Error(bot);
        bot.mobileId = 'armor';
      }
      const shadow = TestClient.offline('shadow');
      const broadcast = room.broadcast.bind(room);
      room.broadcast = (msg, except) => {
        shadow.feed(msg);
        broadcast(msg, except);
      };
      room.phase = 'match';
      room.runner = MatchRunner.start(room, 99);
      for (let s = 0; s < 90 && shadow.turnEnds.length < 6 && room.phase === 'match'; s++) vi.advanceTimersByTime(1000);
      room.dispose();
      expect(walks(shadow.received, [0, 1]).length).toBeGreaterThanOrEqual(3);
      expect(shadow.received.filter((m) => m.t === 'fire').length).toBeGreaterThanOrEqual(3);
      expect(shadow.turnEnds.length).toBeGreaterThanOrEqual(3);
      expect(shadow.turnEnds.every((r) => r.matched)).toBe(true);
    } finally {
      restore();
    }
  }, 120_000);
});

describe('a turn that ends under a bot', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops the turn quietly when its seat is forfeited mid-think', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const room = new Room('BOTS2', 2);
    for (const team of ['A', 'B'] as const) {
      const bot = room.seatBot(team, 'easy');
      if (typeof bot === 'string') throw new Error(bot);
      bot.mobileId = 'armor';
    }
    const sent: ServerMessage[] = [];
    const broadcast = room.broadcast.bind(room);
    room.broadcast = (msg, except) => {
      sent.push(msg);
      broadcast(msg, except);
    };
    room.phase = 'match';
    room.runner = MatchRunner.start(room, 7);
    const runner = room.runner;
    // Into the first turn's `active` phase: the bot is thinking (Easy thinks ≥ 1.6 s).
    vi.advanceTimersByTime(1000);
    expect(runner.state.phase).toBe('active');
    expect(sent.some((m) => m.t === 'fire' || m.t === 'aimEcho')).toBe(false);
    const thinking = runner.state.activeSeat;
    runner.guard('forfeit', () => runner.forfeit(thinking));
    vi.advanceTimersByTime(10_000);
    expect(room.phase).toBe('lobby');
    expect(sent.find((m) => m.t === 'matchEnd')).toMatchObject({ reason: 'forfeit' });
    // The forfeited bot never got its shot off, and nothing threw (no `abandoned`).
    expect(sent.some((m) => m.t === 'fire' && m.seat === thinking)).toBe(false);
  });
});

describe('one human and three bots over sockets', () => {
  let server: RunningServer;
  const savedScale = config.botTimeScale;
  beforeAll(async () => {
    config.botTimeScale = 0.25;
    server = await startServer(0, '127.0.0.1');
  });
  afterAll(async () => {
    config.botTimeScale = savedScale;
    await server.close();
  });

  it('plays a 2v2 in lockstep, the bots walking and taking their turns', async () => {
    const human = await TestClient.connect(server.wsUrl, 'Ana');
    const restore = forceWalking();
    try {
      human.send({ t: 'createRoom', maxPlayers: 4 });
      await human.wait((m) => m.t === 'roomState');
      human.send({ t: 'addBot', team: 'A', difficulty: 'normal' });
      human.send({ t: 'addBot', team: 'B', difficulty: 'hard' });
      human.send({ t: 'addBot', team: 'B', difficulty: 'easy' });
      human.send({ t: 'setTeam', team: 'A' });
      human.send({ t: 'setMobile', mobileId: 'armor' });
      human.send({ t: 'setReady', ready: true });
      const full = (await human.wait(
        (m) => m.t === 'roomState' && m.players.length === 4 && m.players.every((p) => p.ready),
      )) as RoomStateMsg;
      expect(full.players.filter((p) => p.bot)).toHaveLength(3);
      human.send({ t: 'start' });
      await human.wait((m) => m.t === 'matchStart');

      const botFires = new Set<number>();
      for (let turn = 1; turn <= 5; turn++) {
        const start = (await human.wait(
          (m) => (m.t === 'turnStart' && m.turn === turn) || m.t === 'matchEnd',
          30_000,
        )) as TurnStartMsg | ServerMessage;
        if (start.t !== 'turnStart') break;
        if (start.seat === human.seat) {
          // Our turn: fire past the `starting` half second, as match.test does.
          const shot = { t: 'fire', shot: 's1', relAngle: 50, power: 0.7, seq: turn } as const;
          const retry = setInterval(() => human.send({ ...shot }), 120);
          try {
            await human.wait((m) => m.t === 'fire' && m.seat === human.seat && human.received.indexOf(m) > human.received.indexOf(start));
          } finally {
            clearInterval(retry);
          }
        } else {
          const fire = (await human.wait(
            (m) => m.t === 'fire' && human.received.indexOf(m) > human.received.indexOf(start),
            15_000,
          )) as FireBroadcastMsg;
          expect(fire.seat).toBe(start.seat);
          botFires.add(fire.seat);
        }
        const end = await human.wait(
          (m) => (m.t === 'turnEnd' && m.snapshot.turn === turn) || m.t === 'matchEnd',
          30_000,
        );
        if (end.t !== 'turnEnd') break;
      }
      expect(botFires.size).toBeGreaterThanOrEqual(2);
      expect(walks(human.received, [...botFires]).length).toBeGreaterThanOrEqual(1);
      expect(human.turnEnds.length).toBeGreaterThanOrEqual(3);
      expect(human.turnEnds.every((r) => r.matched)).toBe(true);
      expect(human.received.some((m) => m.t === 'error')).toBe(false);
    } finally {
      restore();
      human.close();
    }
  }, 120_000);
});
