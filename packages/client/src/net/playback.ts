/**
 * Playback and reconciliation (DESIGN §1.3 net/playback.ts, §6.3, §6.4).
 *
 * Every function here takes a `MatchState` and a server message and returns what the
 * renderer needs to know; none of them touch the DOM, the socket or any module state,
 * so they are unit-testable in isolation and the scene above them is only wiring.
 *
 * The contract they implement is the determinism contract (DESIGN §7 item 35): the
 * server applies exactly what it broadcasts, at the tick named in the message. A client
 * that steps to that tick before applying stays bit-identical; a real-time browser
 * client, which is what the match scene is, drifts by a few ticks in the banked time
 * cost and is corrected at every `turnEnd`:
 *
 * - step to the message's tick when behind (bounded — a suspended tab reconciles from
 *   the snapshot instead of replaying minutes of simulation),
 * - apply the authoritative intent,
 * - at `turnEnd`, quantise our own state the same way the authority did
 *   (`snapshotForTurnEnd`) and compare hashes; equal means nothing to do, different
 *   means overwrite from the snapshot, count a desync, and ask for the terrain mask if
 *   that is what differs.
 */
import {
  applyIntent,
  applySnapshot,
  createMatch,
  decodeRle,
  getMapDef,
  makeWind,
  mobileOfSeat,
  snapshotForTurnEnd,
  step,
} from '@gunbros/shared';
import type {
  MatchStartMsg,
  MatchState,
  ResyncMsg,
  SeatInfo,
  SeatSpec,
  ServerMessage,
  SimEvent,
  Snapshot,
} from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';

export interface PlaybackResult {
  /** Simulation events produced by the catch-up steps and by the applied intent. */
  events: SimEvent[];
  /** Did this message move the simulation at all? (`false` for HUD-only messages.) */
  applied: boolean;
  /** `turnEnd` only: the two hashes disagreed and the snapshot was applied. */
  desync: boolean;
  /** `turnEnd` only: the terrain hash disagreed too, so ask for the full mask. */
  needsTerrain: boolean;
  /**
   * `turnEnd` only, and only when the hashes disagreed: which fields differ, named.
   *
   * The hash says *that* two engines disagree and nothing about what — which turns
   * every desync into an afternoon of instrumenting a build by hand. Both sides are
   * already quantised at this point, so the comparison is exact and the answer is
   * short: "mobile 1 x 336691 vs 336178". Computed only on the failing path.
   */
  diff: string[];
  /** Ticks fast-forwarded to reach the message's tick. */
  caughtUp: number;
}

function empty(applied = false): PlaybackResult {
  return { events: [], applied, desync: false, needsTerrain: false, caughtUp: 0, diff: [] };
}

/**
 * Which fields of two quantised snapshots disagree, in words (see `PlaybackResult.diff`).
 *
 * Only the fields the hash is taken over, because a difference anywhere else is not the
 * desync. Capped, because a client that rebuilt from the wrong seed differs in every
 * field and a hundred lines of that says nothing the first three did not.
 */
function snapshotDiff(mine: Snapshot, theirs: Snapshot): string[] {
  const out: string[] = [];
  const note = (name: string, a: unknown, b: unknown): void => {
    if (out.length < 12 && a !== b) out.push(`${name} ${String(a)} vs ${String(b)}`);
  };
  note('terrainHash', mine.terrainHash, theirs.terrainHash);
  note('tick', mine.tick, theirs.tick);
  note('turn', mine.turn, theirs.turn);
  note('completedTurns', mine.completedTurns, theirs.completedTurns);
  note('phase', mine.phase, theirs.phase);
  note('turnTicksLeft', mine.turnTicksLeft, theirs.turnTicksLeft);
  note('turnStartTick', mine.turnStartTick, theirs.turnStartTick);
  note('pendingDelay', mine.pendingDelay, theirs.pendingDelay);
  note('activeSeat', mine.activeSeat, theirs.activeSeat);
  note('wind', `${mine.wind.strength}@${mine.wind.directionDeg}`, `${theirs.wind.strength}@${theirs.wind.directionDeg}`);
  note('rng', mine.rng.join(','), theirs.rng.join(','));
  note('mines', mine.mines.length, theirs.mines.length);
  note('nextProjectileId', mine.nextProjectileId, theirs.nextProjectileId);
  note('nextMineId', mine.nextMineId, theirs.nextMineId);
  for (let i = 0; i < Math.max(mine.delays.length, theirs.delays.length); i++) {
    note(`delay ${i}`, mine.delays[i], theirs.delays[i]);
    note(`ssGauge ${i}`, mine.ssGauges[i], theirs.ssGauges[i]);
    note(`shot ${i}`, mine.shots[i], theirs.shots[i]);
    note(`itemsUsed ${i}`, (mine.itemsUsed[i] ?? []).join('+'), (theirs.itemsUsed[i] ?? []).join('+'));
  }
  for (let i = 0; i < Math.max(mine.mobiles.length, theirs.mobiles.length); i++) {
    const a = mine.mobiles[i];
    const b = theirs.mobiles[i];
    if (!a || !b) {
      note(`mobile ${i}`, a ? 'present' : 'missing', b ? 'present' : 'missing');
      continue;
    }
    for (const key of [
      'x', 'y', 'vx', 'hp', 'shield', 'defenceMod', 'moveGauge', 'alive',
      'facing', 'tilt', 'relAngle', 'moveDir',
    ] as const) {
      note(`mobile ${a.seat} ${key}`, a[key], b[key]);
    }
  }
  return out;
}

/**
 * Build the match exactly the way the server did (DESIGN §6.2 `matchStart`): same seed,
 * same map, same seats in the same order, `turns` mode, then the rolled sky event. Any
 * deviation here and every later hash is meaningless.
 */
export function createMatchFromStart(msg: MatchStartMsg): MatchState {
  const seats: SeatSpec[] = msg.players.map((p) => ({
    playerId: p.playerId,
    // A practice bot's name carries its marker into every HUD label that shows a seat
    // (DESIGN §11). The nick is display only: neither the hash nor a snapshot reads it.
    nick: seatNick(p),
    team: p.team,
    mobileId: p.mobileId,
    // The loadout (DESIGN §4). Without it this engine would hold empty item lists and
    // refuse every authoritative `itemUsed` the server sends.
    items: p.items ?? [],
  }));
  // The sky event goes in as an option, not as an assignment afterwards: it is what
  // `createMatch` places the tornado's column and the Force band from (DESIGN §5).
  return createMatch(msg.seed, getMapDef(msg.mapId), seats, {
    mode: 'turns',
    skyEvent: msg.skyEvent,
    skyStatic: msg.skyStatic ?? false,
  });
}

/** The name a seat is shown under: a bot's is marked, so nobody mistakes it for a person. */
export function seatNick(seat: Pick<SeatInfo, 'nick' | 'bot'>): string {
  return seat.bot ? `${seat.nick} (bot)` : seat.nick;
}

/** Our own seat in a `matchStart`, or -1 when this player is only watching. */
export function seatOf(msg: MatchStartMsg, playerId: string): number {
  for (const p of msg.players) if (p.playerId === playerId) return p.seat;
  return -1;
}

/**
 * Run the simulation forward to `tick`, collecting the events on the way. Never
 * rewinds: a client that is already past the tick applies the intent immediately and
 * takes the `turnEnd` reconciliation instead (DESIGN §7 item 35).
 */
export function stepTo(state: MatchState, tick: number, maxTicks: number): SimEvent[] {
  const events: SimEvent[] = [];
  let stepped = 0;
  while (state.tick < tick && stepped < maxTicks) {
    for (const e of step(state)) events.push(e);
    stepped++;
  }
  return events;
}

/**
 * Everything a returning client needs, in one message (DESIGN §6.4): the terrain mask
 * first, then the snapshot, which also restores `tick`, the PRNG and the whole turn
 * machine. After this `hashState(state) === snapshot.stateHash`.
 */
export function applyResync(state: MatchState, msg: ResyncMsg): void {
  state.terrain.replaceMask(decodeRle(msg.rle).mask);
  applySnapshot(state, msg.snapshot);
}

/**
 * The events a snapshot's arrival implies for the *renderer*.
 *
 * `applySnapshot` drops whatever this engine still had in flight when the authority's
 * snapshot says the shot is over (DESIGN §6.3 step 5). The simulation is right to drop
 * them, but the camera is following one of those shells and the effects layer is
 * holding its trail, so each one is reported as an ordinary `projectileExpire` — the
 * same event the sim emits for a shell that leaves the world.
 */
function expireEventsFor(state: MatchState, snapshotPhase: string): SimEvent[] {
  if (snapshotPhase === 'resolving') return [];
  const events: SimEvent[] = [];
  for (const p of state.projectiles) {
    events.push({
      t: 'projectileExpire',
      id: p.id,
      ownerSeat: p.ownerSeat,
      x: p.x,
      y: p.y,
      reason: 'outOfWorld',
    });
  }
  return events;
}

export interface PlaybackOptions {
  /** Ticks the local sim may fast-forward to meet a message. */
  maxCatchUpTicks?: number;
  /** Px of disagreement with `moveEcho` tolerated before the mobile is snapped. */
  moveSnapPx?: number;
}

/**
 * Apply one authoritative message to the local simulation.
 *
 * Messages that are pure presentation (`turnStart`, `chat`, `roomState`, …) return
 * `applied: false` and leave the state alone — `turnStart` in particular must never be
 * applied, because the client's own turn machine emits the same event at the same tick
 * and applying it again would double the turn.
 */
export function applyServerMessage(
  state: MatchState,
  msg: ServerMessage,
  options: PlaybackOptions = {},
): PlaybackResult {
  const maxCatchUp = options.maxCatchUpTicks ?? clientConstants.net.maxCatchUpTicks;
  const snapPx = options.moveSnapPx ?? clientConstants.net.moveSnapPx;

  switch (msg.t) {
    case 'moveEcho': {
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      for (const e of applyIntent(state, { t: 'move', seat: msg.seat, dir: msg.dir })) {
        events.push(e);
      }
      // The echo carries where the authority's mobile actually is. A real-time client
      // is a few ticks off, so a small difference is expected and is reconciled at
      // `turnEnd`; a visible one is snapped now rather than letting the two drift apart
      // on screen for the rest of the turn.
      //
      // A `dir: 0` echo is the third case and is not a matter of taste (DESIGN §7 item
      // 156): it says the walk is *over* and this is where it ended, so there is nothing
      // left to reconcile later and every reason to take the authority's numbers now.
      //
      // Without it the difference this leaves behind is invisible and permanent. The
      // first echo of a walk names the tick the authority applied the direction on, and
      // a client whose clock is a few ticks past that cannot rewind (`stepTo`), so it
      // starts walking late and spends that much less of its move gauge — three ticks in
      // one measured run. The *position* is put right at the end of the turn anyway,
      // because the authoritative `fire` overwrites the shooter's x and y; the gauge is
      // not, and the gauge is in the turn hash. That was one "desync #1" per client per
      // match, always on its first walking turn.
      //
      // `late` is the same reasoning applied mid-walk. Mid-walk differences under
      // `moveSnapPx` are still left alone, so an ordinary walk stays smooth rather than
      // being tugged into place ten times a second.
      const late = state.tick > msg.tick;
      const m = mobileOfSeat(state, msg.seat);
      const settled = msg.dir === 0;
      const adrift = m ? Math.abs(m.x - msg.x) > snapPx || Math.abs(m.y - msg.y) > snapPx : false;
      if (m && (settled || late || adrift)) {
        m.x = msg.x;
        m.y = msg.y;
        m.facing = msg.facing;
        m.moveGauge = msg.gauge;
      }
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'aimEcho': {
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      for (const e of applyIntent(state, { t: 'aim', seat: msg.seat, relAngle: msg.relAngle })) {
        events.push(e);
      }
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'shotEcho': {
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      for (const e of applyIntent(state, { t: 'selectShot', seat: msg.seat, shot: msg.shot })) {
        events.push(e);
      }
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'chargingEcho': {
      // Applied on *every* client, not just the active one (DESIGN §7 item 31), or a
      // timer expiry would skip here while the authority fires.
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      for (const e of applyIntent(state, { t: 'charging', seat: msg.seat, power: msg.power })) {
        events.push(e);
      }
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'itemUsed': {
      // The authoritative item use (DESIGN §6.2), applied exactly like `fire`: step to
      // the tick the server named, then run the same intent. Anything less and this
      // engine holds empty `turnMods` — it would miss Dual's second volley, Bunge's
      // crater, the heal and the wind roll, and mismatch at the next `turnEnd`.
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      const applied = applyIntent(state, {
        t: 'useItem',
        seat: msg.seat,
        itemId: msg.itemId,
        ...(msg.target ? { target: { x: msg.target.x, y: msg.target.y } } : {}),
      });
      for (const e of applied) events.push(e);
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'fire': {
      // The authoritative shot, in the exact order DESIGN §6.2 prescribes: catch up,
      // overwrite the shooter, restore the wind and the PRNG, then fire with the
      // angle and power the server already clamped and quantised.
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      const m = mobileOfSeat(state, msg.seat);
      if (m) {
        m.x = msg.shooter.x;
        m.y = msg.shooter.y;
        m.facing = msg.shooter.facing;
        m.tilt = msg.shooter.tilt;
      }
      state.wind = makeWind(msg.wind.strength, msg.wind.directionDeg);
      state.rng.setState(msg.rngState);
      const fired = applyIntent(state, {
        t: 'fire',
        seat: msg.seat,
        shot: msg.shot,
        relAngle: msg.relAngle,
        power: msg.power,
      });
      for (const e of fired) events.push(e);
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'skipEcho': {
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      for (const e of applyIntent(state, { t: 'skip', seat: msg.seat })) events.push(e);
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'playerForfeit': {
      const before = state.tick;
      const events = stepTo(state, msg.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      for (const e of applyIntent(state, { t: 'forfeit', seat: msg.seat })) events.push(e);
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
    }

    case 'turnEnd': {
      // The reconcile point (DESIGN §6.3 step 5). Both sides quantise at the same
      // moment — otherwise the client would hold rounded values while the authority
      // held raw floats and every later turn would mismatch forever.
      const before = state.tick;
      const events = stepTo(state, msg.snapshot.tick, maxCatchUp);
      const caughtUp = state.tick - before;
      const mine = snapshotForTurnEnd(state);
      const matched = mine.stateHash === msg.snapshot.stateHash;
      if (matched) {
        return { events, applied: true, desync: false, needsTerrain: false, caughtUp, diff: [] };
      }
      const diff = snapshotDiff(mine, msg.snapshot);
      for (const e of expireEventsFor(state, msg.snapshot.phase)) events.push(e);
      applySnapshot(state, msg.snapshot);
      const needsTerrain = msg.snapshot.terrainHash !== state.terrain.hash();
      return { events, applied: true, desync: true, needsTerrain, caughtUp, diff };
    }

    case 'resync': {
      const events = expireEventsFor(state, msg.snapshot.phase);
      applyResync(state, msg);
      return { events, applied: true, desync: false, needsTerrain: false, caughtUp: 0, diff: [] };
    }

    case 'terrainMask': {
      state.terrain.replaceMask(decodeRle(msg.rle).mask);
      return empty(true);
    }

    default:
      // Presentation only: `turnStart`, `chat`, `roomState`, `matchEnd`, `playerLeft`,
      // `playerReconnected`, `pong`, `error`, `welcome`, `matchStart`.
      return empty(false);
  }
}
