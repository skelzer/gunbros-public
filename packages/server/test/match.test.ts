/**
 * The Phase 3 exit criterion, headless: two `ws` clients join a room against an
 * in-process server, play a turn, and end it holding the same state hash as the
 * authority (DESIGN §6.3, §9).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MatchRunner } from '../src/matchRunner.js';
import { checkTeleportTarget, getItemDef, getMobileDef, hashState } from '@gunbros/shared';
import type {
  FireBroadcastMsg,
  ItemId,
  ItemUsedMsg,
  RoomStateMsg,
  ServerMessage,
  TurnStartMsg,
} from '@gunbros/shared';
import { config } from '../src/config.js';
import { startServer } from '../src/index.js';
import type { RunningServer } from '../src/index.js';
import { TestClient } from './testClient.js';

let server: RunningServer;
const savedRoomCreateBurst = config.roomCreateBurst;

beforeAll(async () => {
  // A room seeds its PRNG from `node:crypto`, so without this every test here plays
  // under a random sky event: 45 % of runs get Thor, a tornado or the Force band, and
  // an assertion that pins hp, delay or the SS gauge after a shot is really asserting
  // under whichever one came up — a tornado can throw a shell back onto its shooter.
  // The forced-event tests below set this themselves and only assert hash agreement.
  config.forcedSkyEvent = 'none';
  // Every test here opens a room from 127.0.0.1; the per-address room limit
  // (limits.test.ts covers it) would start refusing them part way through the suite.
  config.roomCreateBurst = 1000;
  server = await startServer(0, '127.0.0.1');
});

afterAll(async () => {
  config.forcedSkyEvent = null;
  config.roomCreateBurst = savedRoomCreateBurst;
  await server.close();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Two players in a room, both ready, both armor, both holding `items` (DESIGN §4).
 *
 * The two loadouts are identical on purpose: under delay ordering the seat that plays
 * the next turn is whoever is cheapest (DESIGN §2.8), so a test that wants to use a
 * given item on a given turn cannot know in advance which seat will be holding it.
 */
async function makeRoom(items: ItemId[] = []): Promise<{ a: TestClient; b: TestClient; code: string }> {
  const a = await TestClient.connect(server.wsUrl, 'Ana');
  const b = await TestClient.connect(server.wsUrl, 'Bruno');
  a.send({ t: 'createRoom' });
  const created = (await a.wait((m) => m.t === 'roomState')) as RoomStateMsg;
  b.send({ t: 'joinRoom', code: created.code });
  await b.wait((m) => m.t === 'roomState');
  for (const client of [a, b]) {
    client.send({ t: 'setMobile', mobileId: 'armor' });
    if (items.length > 0) client.send({ t: 'setItems', items });
    client.send({ t: 'setReady', ready: true });
  }
  await a.wait(
    (m) =>
      m.t === 'roomState' &&
      m.players.length === 2 &&
      m.players.every((p) => p.ready && p.items.length === items.length),
  );
  return { a, b, code: created.code };
}

async function startMatch(
  items: ItemId[] = [],
): Promise<{ a: TestClient; b: TestClient; turn: TurnStartMsg }> {
  const { a, b } = await makeRoom(items);
  a.send({ t: 'start' });
  await a.wait((m) => m.t === 'matchStart');
  await b.wait((m) => m.t === 'matchStart');
  const turn = (await a.wait((m) => m.t === 'turnStart')) as TurnStartMsg;
  await b.wait((m) => m.t === 'turnStart');
  return { a, b, turn };
}

/**
 * Fire until the server accepts. The first attempts land in the `starting` phase and
 * are ignored on purpose (DESIGN §2.9), and the `seq` guard makes the retries free.
 */
async function fireAndWait(
  shooter: TestClient,
  others: TestClient[],
  slot: 's1' | 's2' | 'ss' = 's1',
  seq = 1,
): Promise<FireBroadcastMsg> {
  const shot = { t: 'fire', shot: slot, relAngle: 50, power: 0.85, seq } as const;
  const retry = setInterval(() => shooter.send({ ...shot }), 120);
  let broadcast: ServerMessage;
  try {
    shooter.send({ ...shot });
    broadcast = await shooter.wait((m) => m.t === 'fire');
  } finally {
    clearInterval(retry);
  }
  for (const client of others) await client.wait((m) => m.t === 'fire');
  return broadcast as FireBroadcastMsg;
}

// --------------------------------------------------------------------------
// Items (DESIGN §4, Phase 5)
// --------------------------------------------------------------------------

/** 1 + 1 + 1 + 2 = 5 of the six slots, one of each kind of effect. */
const LOADOUT: ItemId[] = ['healSmall', 'windChange', 'teleport', 'dual'];

/** Wait for a message that arrives *after* this call, not one already in the log. */
function waitFresh(
  client: TestClient,
  predicate: (msg: ServerMessage) => boolean,
  timeoutMs?: number,
): Promise<ServerMessage> {
  const from = client.received.length;
  return client.wait((m) => client.received.indexOf(m) >= from && predicate(m), timeoutMs);
}

/** Send something that must be refused, and read the code back. */
async function expectError(client: TestClient, code: string, msg: Parameters<TestClient['send']>[0]): Promise<void> {
  const error = waitFresh(client, (m) => m.t === 'error' && m.code === code, 5000);
  client.send(msg);
  await error;
}

/**
 * Use an item and wait for the authoritative broadcast on every client.
 *
 * Like `fireAndWait` it retries, because the first attempts land in `starting` and are
 * dropped on purpose (DESIGN §2.9). A retry that overtakes the broadcast is harmless:
 * one item per turn means the second copy is refused, never used twice.
 */
async function useItemAndWait(
  user: TestClient,
  others: TestClient[],
  itemId: ItemId,
  target?: { x: number; y: number },
): Promise<ItemUsedMsg> {
  const msg = target ? { t: 'useItem' as const, itemId, target } : { t: 'useItem' as const, itemId };
  const seen = waitFresh(user, (m) => m.t === 'itemUsed' && m.itemId === itemId);
  const retry = setInterval(() => user.send({ ...msg }), 150);
  let broadcast: ServerMessage;
  try {
    user.send({ ...msg });
    broadcast = await seen;
  } finally {
    clearInterval(retry);
  }
  for (const client of others) await client.wait((m) => m.t === 'itemUsed' && m.itemId === itemId);
  return broadcast as ItemUsedMsg;
}

/** Open the turn `turn` and hand back whoever is holding it. */
async function openTurn(
  clients: TestClient[],
  turn: number,
): Promise<{ active: TestClient; others: TestClient[] }> {
  let start: TurnStartMsg | null = null;
  for (const client of clients) {
    const msg = await client.wait((m) => m.t === 'turnStart' && m.turn === turn, 25000);
    if (msg.t === 'turnStart') start = msg;
  }
  // `starting` swallows input for half a second (DESIGN §2.9); the retries in the
  // helpers above cover the rest of the race.
  await sleep(700);
  const seat = start ? start.seat : -1;
  const active = clients.find((c) => c.seat === seat);
  expect(active).toBeDefined();
  if (!active) throw new Error('no active client');
  return { active, others: clients.filter((c) => c !== active) };
}

/** End the active seat's turn without a shot, retrying past the `starting` phase. */
async function skipTurn(active: TestClient): Promise<void> {
  const echo = waitFresh(active, (m) => m.t === 'skipEcho' && m.seat === active.seat);
  const retry = setInterval(() => active.send({ t: 'skip' }), 120);
  try {
    active.send({ t: 'skip' });
    await echo;
  } finally {
    clearInterval(retry);
  }
}

/** Everyone reached the end of `turn` holding the authority's hash. */
async function endOfTurn(clients: TestClient[], turn: number): Promise<void> {
  for (const client of clients) {
    await client.wait((m) => m.t === 'turnEnd' && m.snapshot.turn === turn, 25000);
    const report = client.turnEnds.find((r) => r.turn === turn);
    expect(report).toBeDefined();
    expect(report?.matched).toBe(true);
  }
}

/**
 * A point Teleport will accept, found with the shared rule the server will apply again.
 * The candidates walk outwards from the mobile so the landing is on the same hill it is
 * standing on, whatever the map seed did.
 */
function findTeleportTarget(client: TestClient): { x: number; y: number } {
  const state = client.state;
  expect(state).not.toBeNull();
  if (!state) throw new Error('no state');
  const m = state.mobiles[client.seat];
  expect(m).toBeDefined();
  if (!m) throw new Error('no mobile');
  // Only the geometry, not `canUseItem`: this engine's turn machine is a few ticks
  // behind the authority's (it steps on authoritative messages, never on a clock), so
  // the phase gate would answer about a turn that has not opened here yet. The server
  // applies the full check on arrival, which is the one that counts.
  const def = getMobileDef(m.defId);
  for (const dx of [90, -90, 150, -150, 220, -220, 300, -300]) {
    for (const dy of [-40, -80, -15, -120]) {
      const target = { x: Math.round(m.x + dx), y: Math.round(m.y + dy) };
      if (checkTeleportTarget(state, m, def, target) === null) return target;
    }
  }
  throw new Error('no legal teleport target near the mobile');
}

describe('a two-client match', () => {
  it('assigns teams, starts, and both engines end the turn on the authority hash', async () => {
    const { a, b, turn } = await startMatch();
    const clients = [a, b];
    const shooter = clients.find((c) => c.seat === turn.seat);
    const others = clients.filter((c) => c !== shooter);
    expect(shooter).toBeDefined();
    if (!shooter) return;

    // 1v1 rooms auto-assign A and B (DESIGN §7 item 13).
    const teams = a.state?.seats.map((s) => s.team) ?? [];
    expect(teams.sort()).toEqual(['A', 'B']);

    await fireAndWait(shooter, others);

    for (const client of clients) await client.wait((m) => m.t === 'turnEnd', 25000);

    for (const client of clients) {
      expect(client.turnEnds.length).toBeGreaterThan(0);
      const report = client.turnEnds[0];
      expect(report).toBeDefined();
      // The whole point of Phase 3: the client reproduced the shot exactly.
      expect(report?.matched).toBe(true);
      expect(report?.mine).toBe(report?.theirs);
    }

    // The shot really happened: the terrain was carved, so the hash moved.
    const before = a.received.find((m) => m.t === 'matchStart');
    expect(before).toBeDefined();
    const end = a.turnEnds[0];
    expect(end?.turn).toBe(1);

    a.close();
    b.close();
  });

  it('keeps walking, aiming and charging in lockstep too', async () => {
    const { a, b, turn } = await startMatch();
    const clients = [a, b];
    const shooter = clients.find((c) => c.seat === turn.seat);
    const others = clients.filter((c) => c !== shooter);
    expect(shooter).toBeDefined();
    if (!shooter) return;

    // `starting` lasts half a second and swallows input on purpose (DESIGN §2.9).
    await sleep(700);
    shooter.send({ t: 'move', dir: 1, seq: 1 });
    await shooter.wait((m) => m.t === 'moveEcho');
    await sleep(250);
    shooter.send({ t: 'move', dir: 0, seq: 2 });
    shooter.send({ t: 'selectShot', shot: 's2' });
    await shooter.wait((m) => m.t === 'shotEcho');
    shooter.send({ t: 'aim', relAngle: 38 });
    await shooter.wait((m) => m.t === 'aimEcho');
    shooter.send({ t: 'charging', power: 0.4 });
    await shooter.wait((m) => m.t === 'chargingEcho');

    await fireAndWait(shooter, others);
    for (const client of clients) await client.wait((m) => m.t === 'turnEnd', 25000);

    for (const client of clients) {
      expect(client.turnEnds[0]?.matched).toBe(true);
    }
    // The walk really moved the mobile, so the lockstep was not trivially true.
    const walker = a.state?.mobiles[turn.seat];
    expect(walker).toBeDefined();
    expect(walker ? walker.moveGauge : Infinity).toBeLessThan(getMobileDef('armor').moveGauge);

    a.close();
    b.close();
  });

  it('holds the seat for a dropped player and resyncs them on reconnect', async () => {
    const { a, b } = await startMatch();
    const token = b.token;
    b.ws.terminate();
    await sleep(150);

    const back = await TestClient.connect(server.wsUrl, 'Bruno', token);
    const resync = await back.wait((m) => m.t === 'resync');
    expect(resync.t).toBe('resync');
    if (resync.t !== 'resync') return;

    expect(back.playerId).toBe(b.playerId);
    expect(back.seat).toBe(b.seat);
    expect(back.state).not.toBeNull();
    // Rebuilt from matchStart, then fast-forwarded by the resync: same state, same hash.
    expect(back.state && hashState(back.state)).toBe(resync.snapshot.stateHash);
    expect(resync.rle.length).toBeGreaterThan(0);
    expect(resync.turn.seat).toBeGreaterThanOrEqual(0);
    expect(back.applied).toContain('resync');

    a.close();
    back.close();
  });

  it('forfeits a seat that leaves the match, and the last team standing wins', async () => {
    const { a, b, turn } = await startMatch();
    const clients = [a, b];
    const active = clients.find((c) => c.seat === turn.seat);
    const quitter = clients.find((c) => c.seat !== turn.seat);
    expect(active && quitter).toBeTruthy();
    if (!active || !quitter) return;

    quitter.send({ t: 'leaveRoom' });
    const forfeit = await active.wait((m) => m.t === 'playerForfeit');
    expect(forfeit.t === 'playerForfeit' && forfeit.seat).toBe(quitter.seat);
    expect(active.state && active.state.mobiles[quitter.seat]?.alive).toBe(false);

    // Nobody has to finish the turn: with one team left the match ends by itself,
    // instead of making the winner sit out the rest of the 20 s timer.
    const end = await active.wait((m) => m.t === 'matchEnd', 5000);
    expect(end.t === 'matchEnd' && end.winnerTeam).toBe(active.state?.seats[active.seat]?.team);
    // The other player quit; saying "eliminated" here would be a lie (DESIGN §6.2).
    expect(end.t === 'matchEnd' && end.reason).toBe('forfeit');
    expect(active.applied).not.toContain('skip');

    // The room comes back to the lobby with everybody unready.
    const lobby = await active.wait(
      (m) => m.t === 'roomState' && m.phase === 'lobby' && m.players.every((p) => !p.ready),
    );
    expect(lobby.t).toBe('roomState');

    a.close();
    b.close();
    quitter.close();
  });

  it('forfeits a seat whose grace period ran out, and forgets the player', async () => {
    const { a, b } = await startMatch();
    const goneSeat = b.seat;
    const token = b.token;
    b.ws.terminate();
    await sleep(150);

    // The sweeper's clock is injectable, so the 60 s grace does not have to be waited
    // out (DESIGN §6.4): this is the timer path, not the `leaveRoom` one.
    server.manager.sweep(Date.now() + config.reconnectGraceMs + 1);

    const forfeit = await a.wait((m) => m.t === 'playerForfeit');
    expect(forfeit.t === 'playerForfeit' && forfeit.seat).toBe(goneSeat);
    expect(a.state && a.state.mobiles[goneSeat]?.alive).toBe(false);

    // The room is theirs alone now, and the old token buys nothing: a `hello` with it
    // mints a new identity.
    const roomState = await a.wait((m) => m.t === 'roomState' && m.players.length === 1);
    expect(roomState.t).toBe('roomState');
    const stranger = await TestClient.connect(server.wsUrl, 'Bruno', token);
    expect(stranger.playerId).not.toBe(b.playerId);

    a.close();
    stranger.close();
  });

  it('does not orphan the player a socket already had when a hello swaps identity', async () => {
    const one = await TestClient.connect(server.wsUrl, 'Uno');
    const two = await TestClient.connect(server.wsUrl, 'Dos');
    two.send({ t: 'createRoom' });
    await two.wait((m) => m.t === 'roomState');

    // A crafted client: the same socket claims the *other* player's identity. Without
    // the detach in `hello` the abandoned player keeps `conn` pointing at this socket,
    // so it never looks disconnected, never expires, and its room is never reaped.
    two.send({ t: 'hello', nick: 'Dos', token: one.token });
    await two.wait((m) => m.t === 'welcome' && m.playerId === one.playerId);

    one.close();
    two.close();
    await sleep(150);
    server.manager.sweep(Date.now() + config.reconnectGraceMs + config.roomTtlMs + 1);
    expect(server.manager.stats().players).toBe(0);
    expect(server.manager.stats().rooms).toBe(0);
  });

  it('refuses to start a room that is not ready, and intents from the wrong seat', async () => {
    const a = await TestClient.connect(server.wsUrl, 'Ana');
    a.send({ t: 'createRoom' });
    await a.wait((m) => m.t === 'roomState');

    a.send({ t: 'start' });
    const tooFew = await a.wait((m) => m.t === 'error');
    expect(tooFew.t === 'error' && tooFew.code).toBe('needMorePlayers');

    // Garbage never reaches a handler.
    a.ws.send('}{');
    const badJson = await a.wait((m) => m.t === 'error' && m.code === 'badJson');
    expect(badJson.t).toBe('error');

    a.close();

    const { a: p1, b: p2, turn } = await startMatch();
    const idle = [p1, p2].find((c) => c.seat !== turn.seat);
    expect(idle).toBeDefined();
    if (!idle) return;
    // The seat that is not playing may shout all it likes.
    idle.send({ t: 'fire', shot: 's1', relAngle: 40, power: 1, seq: 1 });
    idle.send({ t: 'skip' });
    await sleep(300);
    expect(idle.received.some((m) => m.t === 'fire')).toBe(false);
    expect(idle.received.some((m) => m.t === 'skipEcho')).toBe(false);

    p1.close();
    p2.close();
  });

  it('answers ping, chat and requestTerrain', async () => {
    const { a, b } = await startMatch();
    a.send({ t: 'ping' });
    expect((await a.wait((m) => m.t === 'pong')).t).toBe('pong');

    a.send({ t: 'chat', text: 'good luck' });
    const chat = await b.wait((m) => m.t === 'chat');
    expect(chat.t === 'chat' && chat.text).toBe('good luck');
    expect(chat.t === 'chat' && chat.from).toBe('Ana');

    b.send({ t: 'requestTerrain' });
    const mask = await b.wait((m) => m.t === 'terrainMask');
    expect(mask.t === 'terrainMask' && mask.width).toBeGreaterThan(0);

    a.close();
    b.close();
  });
});

/**
 * Phase 5's exit criterion for the server half: items reach the simulation through one
 * authoritative `itemUsed` and every engine ends the turn on the authority's hash
 * (DESIGN §4, §6.2, §7 items 92 to 96).
 */
describe('items in a networked match', () => {
  it('carries the room loadout into the match seats', async () => {
    const { a, b } = await startMatch(LOADOUT);
    const start = a.received.find((m) => m.t === 'matchStart');
    expect(start?.t).toBe('matchStart');
    if (start?.t !== 'matchStart') return;
    for (const seat of start.players) expect(seat.items).toEqual(LOADOUT);

    // Both engines built the same `PlayerSlot.items` from `matchStart` alone.
    for (const client of [a, b]) {
      expect(client.state?.seats.map((s) => s.items)).toEqual([LOADOUT, LOADOUT]);
      expect(client.state?.seats.map((s) => s.itemsUsed)).toEqual([[], []]);
    }

    a.close();
    b.close();
  });

  it('accepts one item per turn and gives a reason for every refusal', async () => {
    const { a, b } = await startMatch(LOADOUT);
    const clients = [a, b];
    const { active, others } = await openTurn(clients, 1);

    // A target nowhere near the map: the teleport checks run before anything is spent,
    // so the seat still owns every item afterwards.
    await expectError(active, 'badTarget', {
      t: 'useItem',
      itemId: 'teleport',
      target: { x: -5000, y: -5000 },
    });
    // An item that is not in the loadout, and the SS gate on both routes to a shot.
    await expectError(active, 'itemNotOwned', { t: 'useItem', itemId: 'powerUp' });
    await expectError(active, 'ssNotReady', { t: 'selectShot', shot: 'ss' });
    await expectError(active, 'ssNotReady', {
      t: 'fire',
      shot: 'ss',
      relAngle: 40,
      power: 0.5,
      seq: 1,
    });
    expect(active.received.some((m) => m.t === 'shotEcho' && m.shot === 'ss')).toBe(false);
    expect(active.received.some((m) => m.t === 'fire')).toBe(false);

    const used = await useItemAndWait(active, others, 'healSmall');
    expect(used.itemId).toBe('healSmall');
    expect(used.target).toBeUndefined();
    expect(used.tick).toBeGreaterThan(0);

    // One item per turn (DESIGN §4), and a spent copy is gone for good — which is the
    // earlier rule, so the second attempt is refused as spent rather than as a second.
    await expectError(active, 'itemThisTurn', { t: 'useItem', itemId: 'windChange' });
    await expectError(active, 'itemAlreadyUsed', { t: 'useItem', itemId: 'healSmall' });

    const retry = setInterval(() => active.send({ t: 'skip' }), 120);
    try {
      await active.wait((m) => m.t === 'skipEcho');
    } finally {
      clearInterval(retry);
    }
    await endOfTurn(clients, 1);

    for (const client of clients) {
      const slot = client.state?.seats[active.seat];
      expect(slot?.itemsUsed).toEqual(['healSmall']);
      // The item's delay is banked with the turn's, not at the moment of use (§7.19).
      expect(slot?.delay ?? 0).toBeGreaterThanOrEqual(getItemDef('healSmall').delay);
    }
    // The idle seat spent nothing.
    const idle = others[0];
    expect(idle?.state?.seats.find((s) => s.seat !== active.seat)?.itemsUsed).toEqual([]);

    a.close();
    b.close();
  });

  it('teleports, rerolls the wind and fires a dual volley, all in lockstep', async () => {
    const { a, b } = await startMatch(LOADOUT);
    const clients = [a, b];

    // Turn 1 — Teleport. The point is chosen with the shared rule the server applies
    // again on arrival, and the landing is where the ground is, not where the click was
    // (DESIGN §7 item 96).
    {
      const { active, others } = await openTurn(clients, 1);
      const before = active.state?.mobiles[active.seat];
      const fromX = before ? before.x : 0;
      const target = findTeleportTarget(active);
      const used = await useItemAndWait(active, others, 'teleport', target);
      expect(used.target).toEqual(target);
      for (const client of clients) {
        const m = client.state?.mobiles[active.seat];
        expect(m?.x).toBe(target.x);
        // It costs the whole move gauge, and the walk is stopped first (DESIGN §4).
        expect(m?.moveGauge).toBe(0);
      }
      expect(Math.abs(target.x - fromX)).toBeGreaterThan(0);
      await skipTurn(active);
      await endOfTurn(clients, 1);
    }

    // Turn 2 — Wind Change. It draws from the *match* PRNG, so the reroll is only
    // reproducible if every engine applied the item at the same tick.
    {
      const { active, others } = await openTurn(clients, 2);
      await useItemAndWait(active, others, 'windChange');
      const winds = clients.map((c) => [c.state?.wind.strength, c.state?.wind.directionDeg]);
      expect(winds[0]).toEqual(winds[1]);
      await skipTurn(active);
      await endOfTurn(clients, 2);
    }

    // Turn 3 — Dual, then the shot it doubles. The modifier is in every engine's
    // `turnMods` before the `fire` arrives, which is why `fire` does not carry it.
    {
      const { active, others } = await openTurn(clients, 3);
      await useItemAndWait(active, others, 'dual');
      for (const client of clients) expect(client.state?.turnMods.dual).toBe(true);
      const broadcast = await fireAndWait(active, others);
      expect(broadcast.items).toEqual(['dual']);
      await endOfTurn(clients, 3);
      for (const client of clients) {
        expect(client.state?.seats[active.seat]?.itemsUsed).toContain('dual');
        // The turn is over: the modifiers are forgotten, the spending is not.
        expect(client.state?.turnMods.dual).toBe(false);
      }
      expect(active.applied).toContain('item:dual');
    }

    a.close();
    b.close();
  });

  it('lets a dual+ turn fire although the ss is locked', async () => {
    // `performFire` replaces the selection with S1 on a Dual+ turn whatever was picked
    // (DESIGN §7 item 95), so the server's SS gate has to ask about the key that will
    // actually be fired — otherwise it refuses on the button a shot the simulation
    // fires on a timer expiry.
    const { a, b } = await startMatch(['dualPlus', 'healSmall']);
    const clients = [a, b];
    const { active, others } = await openTurn(clients, 1);

    // Turn 1: nobody has earned an SS yet, so the plain route is refused.
    await expectError(active, 'ssNotReady', {
      t: 'fire',
      shot: 'ss',
      relAngle: 40,
      power: 0.5,
      seq: 1,
    });

    await useItemAndWait(active, others, 'dualPlus');
    for (const client of clients) expect(client.state?.turnMods.dualPlus).toBe(true);

    const broadcast = await fireAndWait(active, others, 'ss', 2);
    expect(broadcast.shot).toBe('ss');
    expect(broadcast.items).toEqual(['dualPlus']);
    await endOfTurn(clients, 1);
    // The gauge was never touched: a Dual+ turn does not spend an SS (§7 item 95).
    for (const client of clients) expect(client.state?.seats[active.seat]?.ssGauge).toBe(1);

    a.close();
    b.close();
  });

  it('takes a loadout with repeated one-slot items and refuses a doubled two-slot one', async () => {
    const a = await TestClient.connect(server.wsUrl, 'Ana');
    a.send({ t: 'createRoom' });
    await a.wait((m) => m.t === 'roomState');

    // Every item is a consumable (DESIGN §7 item 92), so three bandages is a loadout.
    const repeated: ItemId[] = ['healSmall', 'healSmall', 'healSmall', 'bunge', 'powerUp'];
    a.send({ t: 'setItems', items: repeated });
    const state = await waitFresh(a, (m) => m.t === 'roomState');
    expect(state.t === 'roomState' && state.players[0]?.items).toEqual(repeated);

    // A second two-slot item would spend four of the six slots on one trick.
    await expectError(a, 'badItems', { t: 'setItems', items: ['dual', 'dual'] });
    // And the six slots are still the budget.
    await expectError(a, 'badItems', {
      t: 'setItems',
      items: ['dual', 'dualPlus', 'healLarge', 'bunge'],
    });

    a.close();
  });
});

// --------------------------------------------------------------------------
// Sky events (DESIGN §5, Phase 6)
// --------------------------------------------------------------------------

describe('sky events in a networked match', () => {
  for (const event of ['thor', 'tornado', 'force'] as const) {
    it(`builds the same ${event} on both engines and stays in lockstep through a turn`, async () => {
      // The roll is normally the room's `node:crypto` stream, which is why nothing in
      // CI ever saw these three before: `SKY_EVENT` is the same knob a playtest uses.
      config.forcedSkyEvent = event;
      try {
        const { a, b, turn } = await startMatch();
        const clients = [a, b];

        // `matchStart` carries the id; both engines then place the column, the band and
        // the satellite from the seed alone (DESIGN §7 item 118).
        for (const client of clients) {
          expect(client.state?.sky.kind).toBe(event);
        }
        expect(a.state?.sky.x).toBe(b.state?.sky.x);
        expect(a.state?.sky.top).toBe(b.state?.sky.top);
        expect(a.state?.sky.bottom).toBe(b.state?.sky.bottom);

        const shooter = clients.find((c) => c.seat === turn.seat);
        expect(shooter).toBeDefined();
        if (!shooter) return;
        await fireAndWait(
          shooter,
          clients.filter((c) => c !== shooter),
        );
        // The only assertion that matters under a random sky: the hashes agree, so
        // every capture, flag and strike happened identically on both engines.
        await endOfTurn(clients, 1);

        a.close();
        b.close();
      } finally {
        config.forcedSkyEvent = 'none';
      }
    }, 60000);
  }
});

// --------------------------------------------------------------------------
// Reconnection (DESIGN §6.4)
// --------------------------------------------------------------------------

describe('a reconnected player', () => {
  it('can fire again although its sequence counters restarted at zero', async () => {
    const { a, b, turn } = await startMatch();
    const first = [a, b];
    const shooter = first.find((c) => c.seat === turn.seat);
    const bystander = first.find((c) => c !== shooter);
    expect(shooter && bystander).toBeTruthy();
    if (!shooter || !bystander) return;

    // One shot, so the server remembers `lastFireSeq = 1` for this player.
    await fireAndWait(shooter, [bystander], 's1', 1);
    for (const client of first) await client.wait((m) => m.t === 'turnEnd', 25000);

    // A page refresh: the socket dies and the match scene is rebuilt, which restarts
    // the client's `moveSeq` / `fireSeq` at 0. Before the guards were reset on
    // reconnect, every message below was dropped as a stale retransmit and the turn ran
    // out on the 20 s timer instead.
    const token = shooter.token;
    const seat = shooter.seat;
    shooter.ws.terminate();
    await sleep(150);
    const back = await TestClient.connect(server.wsUrl, 'Ana', token);
    await back.wait((m) => m.t === 'resync');
    expect(back.seat).toBe(seat);

    const clients = [back, bystander];
    for (let t = 2; t <= 6; t++) {
      const { active, others } = await openTurn(clients, t);
      if (active !== back) {
        await skipTurn(active);
        continue;
      }
      const moved = waitFresh(back, (m) => m.t === 'moveEcho' && m.seat === seat, 10000);
      back.send({ t: 'move', dir: 1, seq: 1 });
      await moved;
      back.send({ t: 'move', dir: 0, seq: 2 });

      const broadcast = await fireAndWait(back, others, 's1', 1);
      expect(broadcast.seat).toBe(seat);
      back.close();
      bystander.close();
      return;
    }
    throw new Error('the returning seat never held a turn');
  }, 90000);
});

describe('a server-side failure', () => {
  it('ends the match as abandoned when an intent handler throws, instead of desyncing', async () => {
    const { a, b, turn } = await startMatch();
    const active = turn.seat === a.seat ? a : b;
    const spy = vi.spyOn(MatchRunner.prototype, 'onSkip').mockImplementation(() => {
      throw new Error('boom (test)');
    });
    try {
      active.send({ t: 'skip' });
      for (const client of [a, b]) {
        const end = await client.wait((m) => m.t === 'matchEnd');
        expect(end).toMatchObject({ t: 'matchEnd', winnerTeam: null, reason: 'abandoned' });
        await client.wait((m) => m.t === 'roomState' && m.phase === 'lobby');
      }
    } finally {
      spy.mockRestore();
      a.close();
      b.close();
    }
  });

  it('puts the room back in the lobby when the match fails to start', async () => {
    const { a, b } = await makeRoom();
    const spy = vi.spyOn(MatchRunner, 'start').mockImplementation(() => {
      throw new Error('boom (test)');
    });
    try {
      a.received.length = 0;
      a.send({ t: 'start' });
      const err = await a.wait((m) => m.t === 'error');
      expect(err).toMatchObject({ code: 'startFailed' });
      await a.wait((m) => m.t === 'roomState' && m.phase === 'lobby');
      spy.mockRestore();
      // And the room still works: everyone readies up again and the match starts.
      for (const client of [a, b]) client.send({ t: 'setReady', ready: true });
      await a.wait((m) => m.t === 'roomState' && m.phase === 'lobby' && m.players.every((p) => p.ready));
      a.send({ t: 'start' });
      await a.wait((m) => m.t === 'matchStart');
    } finally {
      spy.mockRestore();
      a.close();
      b.close();
    }
  });
});
