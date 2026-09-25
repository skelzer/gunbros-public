/**
 * Reconciliation, without a browser (DESIGN §6.3 step 5, §6.4).
 *
 * `net/playback.ts` is pure: a `MatchState`, a server message, a result. That is what
 * makes the one thing a match cannot survive — a client that quietly stops agreeing
 * with the authority — testable here rather than only in the Playwright run, where it
 * shows up as a flake.
 */
import { describe, expect, it } from 'vitest';
import {
  applyIntent,
  createMatch,
  encodeRle,
  getMapDef,
  hashState,
  snapshotForTurnEnd,
  step,
} from '@gunbros/shared';
import type { MatchStartMsg, MatchState, SeatSpec, Snapshot } from '@gunbros/shared';
import { applyServerMessage, createMatchFromStart, seatOf, stepTo } from '../src/net/playback.js';

const mapId = 'hills';
const seed = 4242;

const start: MatchStartMsg = {
  t: 'matchStart',
  seed,
  mapId,
  players: [
    { seat: 0, playerId: 'p0', nick: 'Ana', team: 'A', mobileId: 'armor', items: [] },
    { seat: 1, playerId: 'p1', nick: 'Bruno', team: 'B', mobileId: 'armor', items: [] },
  ],
  skyEvent: 'none',
};

/** Two engines built exactly the way the server and a client build theirs. */
function pair(): { server: MatchState; client: MatchState } {
  return { server: createMatchFromStart(start), client: createMatchFromStart(start) };
}

/** Walk both engines to the point where the active seat may act. */
function toActive(state: MatchState): void {
  let guard = 0;
  while (state.phase !== 'active' && guard < 600) {
    step(state);
    guard++;
  }
}

describe('createMatchFromStart', () => {
  it('rebuilds the authority’s state from the message alone', () => {
    const specs: SeatSpec[] = start.players.map((p) => ({
      playerId: p.playerId,
      nick: p.nick,
      team: p.team,
      mobileId: p.mobileId,
    }));
    const authority = createMatch(seed, getMapDef(mapId), specs, { mode: 'turns' });
    const mine = createMatchFromStart(start);
    expect(hashState(mine)).toBe(hashState(authority));
    expect(mine.terrain.hash()).toBe(authority.terrain.hash());
    expect(seatOf(start, 'p1')).toBe(1);
    expect(seatOf(start, 'nobody')).toBe(-1);
  });
});

describe('stepTo', () => {
  it('runs to the tick a message names and never past it', () => {
    const state = createMatchFromStart(start);
    stepTo(state, 30, 240);
    expect(state.tick).toBe(30);
  });

  it('stops at maxCatchUpTicks instead of replaying a stalled tab', () => {
    const state = createMatchFromStart(start);
    stepTo(state, 10_000, 50);
    expect(state.tick).toBe(50);
  });

  it('never rewinds', () => {
    const state = createMatchFromStart(start);
    stepTo(state, 40, 240);
    stepTo(state, 10, 240);
    expect(state.tick).toBe(40);
  });
});

describe('moveEcho', () => {
  /** One echo, with everything but the interesting fields taken from the mobile. */
  function echo(
    m: { seat: number; x: number; y: number; facing: -1 | 1; moveGauge: number },
    over: { dir?: -1 | 0 | 1; x?: number; y?: number; gauge?: number; tick: number },
  ) {
    return {
      t: 'moveEcho' as const,
      seat: m.seat,
      dir: over.dir ?? 1,
      x: over.x ?? m.x,
      y: over.y ?? m.y,
      facing: m.facing,
      gauge: over.gauge ?? m.moveGauge,
      tick: over.tick,
    };
  }

  it('leaves an ordinary mid-walk difference alone, and snaps a visible one', () => {
    const { client } = pair();
    toActive(client);
    const m = client.mobiles[client.activeSeat];
    expect(m).toBeDefined();
    if (!m) return;

    const near = m.x + 2;
    applyServerMessage(client, echo(m, { dir: 1, x: near, tick: client.tick }));
    // 2 px is ordinary latency: left alone for `turnEnd` to reconcile (DESIGN §7 item 47).
    expect(m.x).not.toBe(near);

    const far = m.x + 40;
    applyServerMessage(client, echo(m, { dir: 1, x: far, tick: client.tick }));
    expect(m.x).toBe(far);
  });

  it('takes the authority outright when the walk has stopped', () => {
    // The walk is over and the echo says where it ended, gauge included. Anything left
    // over here goes into the turn's hash and shows up as a desync (DESIGN §7 item 156).
    const { client } = pair();
    toActive(client);
    const m = client.mobiles[client.activeSeat];
    expect(m).toBeDefined();
    if (!m) return;

    const stoppedAt = m.x + 2;
    const gauge = m.moveGauge - 3;
    applyServerMessage(client, echo(m, { dir: 0, x: stoppedAt, gauge, tick: client.tick }));
    expect(m.x).toBe(stoppedAt);
    expect(m.moveGauge).toBe(gauge);
  });

  it('takes it too when the local clock was already past the echo', () => {
    // `stepTo` cannot rewind, so the direction landed late here and this mobile will
    // walk that much less than the authority's did unless it is put right.
    const { client } = pair();
    toActive(client);
    const m = client.mobiles[client.activeSeat];
    expect(m).toBeDefined();
    if (!m) return;

    const behindUs = client.tick - 3;
    const authority = m.x + 2;
    const gauge = m.moveGauge - 2;
    applyServerMessage(client, echo(m, { dir: 1, x: authority, gauge, tick: behindUs }));
    expect(m.x).toBe(authority);
    expect(m.moveGauge).toBe(gauge);
  });
});

describe('turnEnd', () => {
  it('reports no desync when the two engines agree', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const snapshot = snapshotForTurnEnd(server);
    const result = applyServerMessage(client, { t: 'turnEnd', snapshot });
    expect(result.applied).toBe(true);
    expect(result.desync).toBe(false);
    expect(result.needsTerrain).toBe(false);
  });

  it('applies the snapshot and counts a desync when they do not', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const drifted = client.mobiles[0];
    expect(drifted).toBeDefined();
    if (!drifted) return;
    drifted.hp -= 173;
    drifted.x += 11;

    const snapshot = snapshotForTurnEnd(server);
    const result = applyServerMessage(client, { t: 'turnEnd', snapshot });
    expect(result.desync).toBe(true);
    // After the snapshot both sides are on the same q8 grid, so the hash agrees again.
    expect(hashState(client)).toBe(snapshot.stateHash);
  });

  it('asks for the terrain mask when it is the terrain that differs', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const under = client.mobiles[0];
    expect(under).toBeDefined();
    if (!under) return;
    client.terrain.carve(under.x, under.y + 40, 30);
    expect(client.terrain.hash()).not.toBe(server.terrain.hash());

    const snapshot = snapshotForTurnEnd(server);
    const result = applyServerMessage(client, { t: 'turnEnd', snapshot });
    expect(result.desync).toBe(true);
    expect(result.needsTerrain).toBe(true);

    // And the mask puts it right without another round trip.
    applyServerMessage(client, {
      t: 'terrainMask',
      width: server.terrain.width,
      height: server.terrain.height,
      rle: encodeRle(server.terrain),
    });
    expect(client.terrain.hash()).toBe(server.terrain.hash());
  });

  it('drops a shell this engine still had in flight, and says so', () => {
    // The double-explosion case. A snapshot names a tick this engine has already passed
    // (ordinary jitter, DESIGN §7 item 35: apply it immediately), and the phase it
    // carries is not `resolving` — so the authority has already decided what that shell
    // did. Left in the state it flies on and explodes a second time, damaging a mobile
    // the server left alive, which can end the match on this screen alone.
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;
    const snapshot: Snapshot = snapshotForTurnEnd(server);
    expect(snapshot.phase).not.toBe('resolving');

    applyIntent(client, { t: 'fire', seat, shot: 's1', relAngle: 40, power: 0.9 });
    for (let i = 0; i < 5; i++) step(client);
    expect(client.projectiles.length).toBeGreaterThan(0);
    expect(client.tick).toBeGreaterThan(snapshot.tick);

    const result = applyServerMessage(client, { t: 'turnEnd', snapshot });

    expect(result.desync).toBe(true);
    expect(client.projectiles).toHaveLength(0);
    expect(client.pendingSpawns).toHaveLength(0);
    // The camera is following that shell, so its removal is reported as an expiry.
    expect(result.events.some((e) => e.t === 'projectileExpire')).toBe(true);
    expect(hashState(client)).toBe(snapshot.stateHash);
  });
});

describe('resync', () => {
  it('rebuilds terrain, tick, PRNG and the turn machine in one message', () => {
    const { server, client } = pair();
    toActive(server);
    for (let i = 0; i < 90; i++) step(server);
    const ground = server.mobiles[0];
    expect(ground).toBeDefined();
    if (!ground) return;
    server.terrain.carve(ground.x, ground.y + 40, 24);

    const result = applyServerMessage(client, {
      t: 'resync',
      snapshot: snapshotForTurnEnd(server),
      width: server.terrain.width,
      height: server.terrain.height,
      rle: encodeRle(server.terrain),
      turn: {
        seat: server.activeSeat,
        turn: server.turn,
        deadlineMs: Date.now() + 20_000,
        wind: { strength: server.wind.strength, directionDeg: server.wind.directionDeg },
        delays: server.seats.map((s) => s.delay),
        ssReady: server.seats.map(() => false),
      },
    });

    expect(result.applied).toBe(true);
    expect(client.tick).toBe(server.tick);
    expect(client.terrain.hash()).toBe(server.terrain.hash());
    expect(hashState(client)).toBe(hashState(server));
  });
});

describe('presentation messages', () => {
  it('never touch the simulation', () => {
    const client = createMatchFromStart(start);
    stepTo(client, 20, 240);
    const before = hashState(client);
    for (const msg of [
      { t: 'chat', from: 'Ana', text: 'hi', ts: 1 },
      { t: 'playerLeft', seat: 1 },
      { t: 'playerReconnected', seat: 1 },
      { t: 'matchEnd', winnerTeam: 'A', reason: 'eliminated' },
      { t: 'pong' },
    ] as const) {
      const result = applyServerMessage(client, msg);
      expect(result.applied).toBe(false);
    }
    // `turnStart` above all: the local turn machine emits its own at the same tick.
    expect(
      applyServerMessage(client, {
        t: 'turnStart',
        seat: 0,
        turn: 1,
        deadlineMs: Date.now(),
        wind: { strength: 0, directionDeg: 0 },
        delays: [0, 0],
        ssReady: [false, false],
      }).applied,
    ).toBe(false);
    expect(hashState(client)).toBe(before);
  });
});
