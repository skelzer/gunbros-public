/**
 * DESIGN §10 / §2.1: same seed + same intents => bit-identical state on every engine.
 *
 * Two scripts run here. The free-play one hashes every single tick of six fires; the
 * turn-mode one plays a full 12-turn match through the turn machine and hashes at every
 * `turnEnd`, which is the exact comparison the server and the clients make over the
 * wire (DESIGN §6.3 step 5).
 */
import { describe, expect, it } from 'vitest';
import { createMatch, applyIntent, step } from '../src/match/reducer.js';
import type { FireIntent, MoveIntent } from '../src/match/reducer.js';
import {
  hashState,
  takeSnapshot,
  snapshotForTurnEnd,
  applySnapshot,
} from '../src/match/snapshot.js';
import { isSettled, slotOfSeat } from '../src/match/match.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import { constants } from '../src/data/constants.js';
import type { ShotSlot } from '../src/data/mobiles.js';
import type { ItemId } from '../src/data/items.js';
import { mobileIds } from '../src/data/mobiles/index.js';
import { hillsMap } from '../src/data/maps.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
];

interface ScriptEntry {
  seat: number;
  relAngle: number;
  power: number;
  shot: FireIntent['shot'];
  walkTicks: number;
  walkDir: MoveIntent['dir'];
}

/** Six fires, alternating seats, with a little walking in between. */
const SCRIPT: ScriptEntry[] = [
  // Powers are sized to the ~780 px spawn separation of seed 1234 on `hills`, so the
  // shells land near the other mobile and the script exercises craters, falling and
  // damage rather than six shots into empty ground.
  { seat: 0, relAngle: 45, power: 0.78, shot: 's1', walkTicks: 0, walkDir: 0 },
  { seat: 1, relAngle: 52, power: 0.82, shot: 's1', walkTicks: 20, walkDir: -1 },
  { seat: 0, relAngle: 38, power: 0.82, shot: 's2', walkTicks: 15, walkDir: 1 },
  { seat: 1, relAngle: 60, power: 0.9, shot: 's1', walkTicks: 0, walkDir: 0 },
  { seat: 0, relAngle: 41, power: 0.86, shot: 'ss', walkTicks: 30, walkDir: -1 },
  { seat: 1, relAngle: 47, power: 0.88, shot: 's2', walkTicks: 10, walkDir: 1 },
];

const MAX_RESOLVE_TICKS = 600;

/**
 * Fill a seat's SS gauge. Phase 5 turned it into a real gate (DESIGN §7 item 21), so a
 * script that wants an SS fired has to earn it first — and a script whose SS was quietly
 * refused would still pass a "same hashes twice" comparison while testing nothing.
 * Deterministic: it is the same write on both runs.
 */
function grantSs(state: MatchState, seat: number): void {
  const slot = slotOfSeat(state, seat);
  if (slot) slot.ssGauge = constants.ss.gaugeMax;
}

function runScript(seed: number): number[] {
  const state = createMatch(seed, hillsMap, seats);
  const hashes: number[] = [hashState(state)];

  for (const entry of SCRIPT) {
    if (entry.walkTicks > 0) {
      applyIntent(state, { t: 'move', seat: entry.seat, dir: entry.walkDir });
      for (let i = 0; i < entry.walkTicks; i++) {
        step(state);
        hashes.push(hashState(state));
      }
      applyIntent(state, { t: 'move', seat: entry.seat, dir: 0 });
    }
    applyIntent(state, { t: 'aim', seat: entry.seat, relAngle: entry.relAngle });
    applyIntent(state, {
      t: 'fire',
      seat: entry.seat,
      shot: entry.shot,
      relAngle: entry.relAngle,
      power: entry.power,
    });
    for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
      step(state);
      hashes.push(hashState(state));
      if (isSettled(state)) break;
    }
    state.turn++;
  }
  return hashes;
}

describe('determinism', () => {
  it('replays a scripted sequence to the same hash at every tick', () => {
    const a = runScript(1234);
    const b = runScript(1234);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(100);
    for (let i = 0; i < a.length; i++) {
      expect(a[i], `hash at step ${i}`).toBe(b[i]);
    }
  });

  it('diverges for a different seed', () => {
    const a = runScript(1234);
    const c = runScript(4321);
    expect(a[0]).not.toBe(c[0]);
    expect(a[a.length - 1]).not.toBe(c[c.length - 1]);
  });

  it('actually moves the world along (the hash is not a constant)', () => {
    const a = runScript(1234);
    // The hash covers terrain, mobiles, wind and the turn counter but deliberately not
    // projectiles (DESIGN §2.1), so the long stretches while a shell is in flight hash
    // the same; what matters is that walking, craters and damage all move it.
    expect(new Set(a).size).toBeGreaterThan(50);
    expect(a[0]).not.toBe(a[a.length - 1]);
  });

  it('builds the same initial state from the same seed', () => {
    const one = createMatch(99, hillsMap, seats);
    const two = createMatch(99, hillsMap, seats);
    expect(hashState(one)).toBe(hashState(two));
    expect(one.terrain.hash()).toBe(two.terrain.hash());
    expect(one.wind).toEqual(two.wind);
    expect(one.mobiles.map((m) => [m.x, m.y])).toEqual(two.mobiles.map((m) => [m.x, m.y]));
  });

  it('stays in lockstep after a reconcile: both sides land on the same numbers', () => {
    // A snapshot is q8-lossy. If only the client applies it, its floats differ from the
    // server's in the last bits and every later turn end mismatches (DESIGN §6.3 step 5).
    const server = createMatch(31337, hillsMap, seats);
    const client = createMatch(31337, hillsMap, seats);
    const drifted = client.mobiles[1];
    if (!drifted) throw new Error('no mobile');
    drifted.x += 0.37;
    drifted.hp -= 12;

    // Both sides quantise at the reconcile point; the client also takes the snapshot.
    const snap = snapshotForTurnEnd(server);
    applySnapshot(client, snap);
    expect(hashState(client)).toBe(hashState(server));

    const serverMobiles = server.mobiles.map((m) => [m.x, m.y, m.vy, m.hp, m.relAngle]);
    expect(client.mobiles.map((m) => [m.x, m.y, m.vy, m.hp, m.relAngle])).toEqual(serverMobiles);
    expect(client.rng.getState()).toEqual(server.rng.getState());

    // Now walk and fire identically on both sides: the hashes must agree every tick.
    for (const state of [server, client]) {
      applyIntent(state, { t: 'move', seat: 0, dir: 1 });
    }
    for (let i = 0; i < 40; i++) {
      step(server);
      step(client);
      expect(hashState(client), `hash at walk tick ${i}`).toBe(hashState(server));
    }
    for (const state of [server, client]) {
      applyIntent(state, { t: 'move', seat: 0, dir: 0 });
      applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 44, power: 0.83 });
    }
    for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
      step(server);
      step(client);
      expect(hashState(client), `hash at shot tick ${i}`).toBe(hashState(server));
      if (isSettled(server)) break;
    }
    expect(isSettled(client)).toBe(true);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('carries the PRNG position in the snapshot', () => {
    const server = createMatch(555, hillsMap, seats);
    const client = createMatch(555, hillsMap, seats);
    for (let i = 0; i < 5; i++) server.rng.nextU32();
    expect(client.rng.getState()).not.toEqual(server.rng.getState());
    applySnapshot(client, takeSnapshot(server));
    expect(client.rng.getState()).toEqual(server.rng.getState());
    expect(client.rng.nextU32()).toBe(server.rng.nextU32());
  });

  it('hashes the stacking defence debuff, and carries it through a snapshot', () => {
    const server = createMatch(777, hillsMap, seats);
    const client = createMatch(777, hillsMap, seats);
    const chilled = server.mobiles[0];
    if (!chilled) throw new Error('no mobile');

    // `defenceMod` is persistent cross-turn state and multiplies every later damage roll
    // (DESIGN §2.6), so a client that dropped a stack must not pass the turnEnd hash
    // check and only diverge a turn later, when the damage lands differently.
    const before = hashState(server);
    // 0.25 is exact on the q8 grid a snapshot quantises to.
    chilled.defenceMod = 0.25;
    expect(hashState(server)).not.toBe(before);
    expect(hashState(client)).not.toBe(hashState(server));

    applySnapshot(client, takeSnapshot(server));
    expect(client.mobiles[0]?.defenceMod).toBe(0.25);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('carries the projectile id counter, so volley bodies match on both engines', () => {
    // `weave` reads `id % 2` and `orbit` `id % count` to decide which body of a volley
    // they are (DESIGN §2.1). A reconnecting client rebuilds through `createMatch` with
    // the counter back at 1, so without this the same shot would give the two engines
    // different bodies and carve the terrain in a different order.
    const server = createMatch(888, hillsMap, seats);
    const client = createMatch(888, hillsMap, seats);
    server.nextProjectileId = 17;
    expect(client.nextProjectileId).not.toBe(server.nextProjectileId);
    applySnapshot(client, takeSnapshot(server));
    expect(client.nextProjectileId).toBe(17);
  });

  it('reconciles a diverged client from a snapshot', () => {
    const server = createMatch(2468, hillsMap, seats);
    const client = createMatch(2468, hillsMap, seats);
    expect(hashState(server)).toBe(hashState(client));

    // The client drifts: damage, movement, a different wind.
    const drifted = client.mobiles[0];
    if (!drifted) throw new Error('no mobile');
    drifted.hp -= 137;
    drifted.x += 9;
    client.wind.strength += 3;
    client.turn += 1;
    expect(hashState(client)).not.toBe(hashState(server));

    applySnapshot(client, takeSnapshot(server));
    expect(hashState(client)).toBe(hashState(server));
  });
});

// --------------------------------------------------------------------------
// The 12-turn scripted match (DESIGN §10)
// --------------------------------------------------------------------------

interface TurnPlan {
  walkDir: MoveIntent['dir'];
  walkTicks: number;
  relAngle: number;
  /** `fire` releases at `power`; `skip` gives the turn up; `charge` lets the timer
   *  expire mid-charge, which must fire at the reported power (DESIGN §7 item 3). */
  action: 'fire' | 'skip' | 'charge';
  shot: ShotSlot;
  power: number;
}

/**
 * Twelve turns of the same match, alternating seats by delay. Powers are deliberately
 * short of the ~780 px spawn separation on `hills`, so the script always gets its
 * twelve turns instead of ending early on a lucky kill — what is under test is the
 * machine, not the ballistics.
 */
const TURN_PLAN: TurnPlan[] = [
  { walkDir: 1, walkTicks: 20, relAngle: 45, action: 'fire', shot: 's1', power: 0.62 },
  { walkDir: -1, walkTicks: 12, relAngle: 52, action: 'fire', shot: 's1', power: 0.7 },
  { walkDir: 0, walkTicks: 2, relAngle: 38, action: 'fire', shot: 's2', power: 0.55 },
  { walkDir: 1, walkTicks: 30, relAngle: 60, action: 'skip', shot: 's1', power: 0 },
  { walkDir: -1, walkTicks: 15, relAngle: 41, action: 'fire', shot: 'ss', power: 0.5 },
  { walkDir: 0, walkTicks: 2, relAngle: 47, action: 'charge', shot: 's1', power: 0.48 },
  { walkDir: 1, walkTicks: 8, relAngle: 55, action: 'fire', shot: 's1', power: 0.66 },
  { walkDir: -1, walkTicks: 25, relAngle: 33, action: 'fire', shot: 's2', power: 0.6 },
  { walkDir: 0, walkTicks: 2, relAngle: 50, action: 'skip', shot: 's1', power: 0 },
  { walkDir: 1, walkTicks: 18, relAngle: 44, action: 'fire', shot: 's1', power: 0.72 },
  { walkDir: -1, walkTicks: 10, relAngle: 58, action: 'charge', shot: 's2', power: 0.53 },
  { walkDir: 1, walkTicks: 5, relAngle: 46, action: 'fire', shot: 'ss', power: 0.58 },
];

const TURNS = TURN_PLAN.length;
const MAX_MATCH_TICKS = 300_000;

/**
 * Hashes at every `turnEnd` of a scripted match in `turns` mode. `turnCount` turns of
 * {@link TURN_PLAN} are played by `matchSeats`, which defaults to armor vs armor.
 */
function runTurnMatch(
  seed: number,
  matchSeats: SeatSpec[] = seats,
  turnCount: number = TURNS,
): number[] {
  const state: MatchState = createMatch(seed, hillsMap, matchSeats, { mode: 'turns' });
  const hashes: number[] = [];
  let ticks = 0;

  while (hashes.length < turnCount && state.phase !== 'ended' && ticks < MAX_MATCH_TICKS) {
    ticks++;
    if (state.phase === 'active') {
      const plan = TURN_PLAN[(state.turn - 1) % TURNS] as TurnPlan;
      const seat = state.activeSeat;
      // Ticks the active seat has spent on this turn; the first one it can act on is 1.
      const t = state.tick - state.turnStartTick;
      if (t === 1) {
        if (plan.shot === 'ss') grantSs(state, seat);
        applyIntent(state, { t: 'aim', seat, relAngle: plan.relAngle });
        applyIntent(state, { t: 'selectShot', seat, shot: plan.shot });
        if (plan.walkDir !== 0) applyIntent(state, { t: 'move', seat, dir: plan.walkDir });
      } else if (t === plan.walkTicks) {
        applyIntent(state, { t: 'move', seat, dir: 0 });
      } else if (t === plan.walkTicks + 5) {
        if (plan.action === 'fire') {
          applyIntent(state, {
            t: 'fire',
            seat,
            shot: plan.shot,
            relAngle: plan.relAngle,
            power: plan.power,
          });
        } else if (plan.action === 'skip') {
          applyIntent(state, { t: 'skip', seat });
        } else {
          // Charge and never release: the 20 s timer fires it for us.
          applyIntent(state, { t: 'charging', seat, power: plan.power });
        }
      }
    }
    for (const e of step(state)) {
      if (e.t === 'turnEnd') hashes.push(hashState(state));
    }
  }
  return hashes;
}

describe('determinism in turns mode', () => {
  it('replays a 12-turn match to the same hash at every turn end', () => {
    const a = runTurnMatch(1234);
    const b = runTurnMatch(1234);
    expect(a).toHaveLength(TURNS);
    expect(b).toHaveLength(TURNS);
    for (let i = 0; i < a.length; i++) {
      expect(a[i], `hash at turn end ${i + 1}`).toBe(b[i]);
    }
  });

  it('diverges for a different seed', () => {
    const a = runTurnMatch(1234);
    const c = runTurnMatch(4321);
    expect(c).toHaveLength(TURNS);
    expect(a).not.toEqual(c);
  });

  it('moves the world along over the twelve turns', () => {
    const a = runTurnMatch(1234);
    expect(new Set(a).size).toBe(TURNS);
  });
});

// --------------------------------------------------------------------------
// The whole roster (DESIGN §9 Phase 4)
// --------------------------------------------------------------------------

/**
 * Every mobile, six scripted turns against armor, replayed twice from one seed: the
 * hashes must agree at every `turnEnd`. This is the net under Phase 4 — a behaviour
 * that reaches for `Math.random`, iterates an object's keys, or grows a piece of state
 * that the hash and the snapshot do not carry fails here without anybody having to
 * write a test for it.
 *
 * The shot is picked **per seat**, not per turn: delay ordering (DESIGN §2.8) gives a
 * seat that fired a cheap shot two turns in a row, so a plan indexed by turn number
 * hands the same slot to the same seat twice and skips another entirely. Under the old
 * turn-indexed plan the SS was never fired by anybody, and five mobiles never fired
 * their S2 either — which left the mine, mark, debuff and satellite state that only a
 * special creates outside the net this test is supposed to be.
 *
 * Six turns is three shots each, and {@link ROSTER_SHOTS} cycles s1 → s2 → ss, so both
 * seats fire all three slots whatever the delay ordering does. Powers stay short of the
 * spawn separation so a lucky kill cannot end the script early.
 */
const ROSTER_TURNS = 6;
const ROSTER_SEED = 90210;
const ROSTER_SHOTS: ShotSlot[] = ['s1', 's2', 'ss'];
const ROSTER_ANGLES = [45, 52, 38, 60, 41, 47];
const ROSTER_POWERS = [0.55, 0.6, 0.5, 0.58, 0.52, 0.56];

/**
 * Like {@link runTurnMatch}, but every seat fires `ROSTER_SHOTS` in order regardless of
 * who the turn machine calls next. Returns the hashes and what each seat actually fired,
 * so the test can prove the specials were exercised instead of assuming it.
 */
function runRosterMatch(
  seed: number,
  matchSeats: SeatSpec[],
  turnCount: number,
): { hashes: number[]; fired: ShotSlot[][] } {
  const state: MatchState = createMatch(seed, hillsMap, matchSeats, { mode: 'turns' });
  const hashes: number[] = [];
  const fired: ShotSlot[][] = matchSeats.map(() => []);
  const shotsTaken: number[] = matchSeats.map(() => 0);
  let ticks = 0;

  while (hashes.length < turnCount && state.phase !== 'ended' && ticks < MAX_MATCH_TICKS) {
    ticks++;
    if (state.phase === 'active') {
      const seat = state.activeSeat;
      const n = shotsTaken[seat] ?? 0;
      const shot = ROSTER_SHOTS[n % ROSTER_SHOTS.length] as ShotSlot;
      const relAngle = ROSTER_ANGLES[(state.turn - 1) % ROSTER_ANGLES.length] as number;
      const power = ROSTER_POWERS[(state.turn - 1) % ROSTER_POWERS.length] as number;
      const t = state.tick - state.turnStartTick;
      if (t === 1) {
        if (shot === 'ss') grantSs(state, seat);
        applyIntent(state, { t: 'aim', seat, relAngle });
        applyIntent(state, { t: 'selectShot', seat, shot });
        applyIntent(state, { t: 'move', seat, dir: n % 2 === 0 ? 1 : -1 });
      } else if (t === 10) {
        applyIntent(state, { t: 'move', seat, dir: 0 });
      } else if (t === 15) {
        applyIntent(state, { t: 'fire', seat, shot, relAngle, power });
        shotsTaken[seat] = n + 1;
        fired[seat]?.push(shot);
      }
    }
    for (const e of step(state)) {
      if (e.t === 'turnEnd') hashes.push(hashState(state));
    }
  }
  return { hashes, fired };
}

describe('determinism for every mobile', () => {
  for (const id of mobileIds) {
    it(`replays a ${ROSTER_TURNS}-turn ${id} vs armor match to the same hashes`, () => {
      const duel: SeatSpec[] = [
        { playerId: 'p1', nick: 'one', team: 'A', mobileId: id },
        { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
      ];
      const a = runRosterMatch(ROSTER_SEED, duel, ROSTER_TURNS);
      const b = runRosterMatch(ROSTER_SEED, duel, ROSTER_TURNS);
      // The mobile under test really fired all three of its slots, specials included.
      expect(a.fired[0], `${id} shot slots`).toEqual(ROSTER_SHOTS);
      expect(a.hashes).toHaveLength(ROSTER_TURNS);
      expect(a.hashes).toEqual(b.hashes);
      expect(a.fired).toEqual(b.fired);
      // A constant hash would pass the comparison above and mean nothing.
      expect(new Set(a.hashes).size).toBeGreaterThan(1);
    });
  }
});

// --------------------------------------------------------------------------
// Items (DESIGN §9 Phase 5, §10)
// --------------------------------------------------------------------------

/**
 * A scripted match in which the items are actually used, replayed twice from one seed.
 *
 * The four in the plan are the four that could break determinism in a different way:
 * `windChange` draws from the match PRNG (a client whose stream is one draw off diverges
 * from there on), `teleport` moves a mobile outside the physics that produced its
 * position, `dual` puts a whole volley in `pendingSpawns` for a later tick, and `bunge`
 * multiplies both the crater and the damage. All four are per-turn or per-seat state
 * that `hashState` has to carry, and this is the test that says so.
 */
const ITEM_LOADOUT: ItemId[] = ['dual', 'teleport', 'bunge', 'windChange'];

interface ItemTurnPlan {
  item: ItemId | null;
  target?: { x: number; y: number };
  relAngle: number;
  power: number;
  shot: ShotSlot;
}

const ITEM_PLAN: ItemTurnPlan[] = [
  { item: 'windChange', relAngle: 45, power: 0.6, shot: 's1' },
  { item: 'bunge', relAngle: 50, power: 0.62, shot: 's1' },
  { item: 'dual', relAngle: 42, power: 0.58, shot: 's1' },
  { item: 'teleport', target: { x: 760, y: 420 }, relAngle: 48, power: 0.6, shot: 's2' },
  { item: null, relAngle: 46, power: 0.64, shot: 's1' },
  { item: null, relAngle: 52, power: 0.56, shot: 's2' },
];

function runItemMatch(seed: number, turnCount: number): { hashes: number[]; used: ItemId[] } {
  const itemSeats: SeatSpec[] = [
    { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor', items: ITEM_LOADOUT },
    { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor', items: ITEM_LOADOUT },
  ];
  const state: MatchState = createMatch(seed, hillsMap, itemSeats, { mode: 'turns' });
  const hashes: number[] = [];
  const used: ItemId[] = [];
  let ticks = 0;

  while (hashes.length < turnCount && state.phase !== 'ended' && ticks < MAX_MATCH_TICKS) {
    ticks++;
    if (state.phase === 'active') {
      const plan = ITEM_PLAN[(state.turn - 1) % ITEM_PLAN.length] as ItemTurnPlan;
      const seat = state.activeSeat;
      const t = state.tick - state.turnStartTick;
      if (t === 1) {
        applyIntent(state, { t: 'aim', seat, relAngle: plan.relAngle });
        applyIntent(state, { t: 'selectShot', seat, shot: plan.shot });
      } else if (t === 8 && plan.item) {
        const before = slotOfSeat(state, seat)?.itemsUsed.length ?? 0;
        applyIntent(
          state,
          plan.target
            ? { t: 'useItem', seat, itemId: plan.item, target: plan.target }
            : { t: 'useItem', seat, itemId: plan.item },
        );
        if ((slotOfSeat(state, seat)?.itemsUsed.length ?? 0) > before) used.push(plan.item);
      } else if (t === 16) {
        applyIntent(state, {
          t: 'fire',
          seat,
          shot: plan.shot,
          relAngle: plan.relAngle,
          power: plan.power,
        });
      }
    }
    for (const e of step(state)) {
      if (e.t === 'turnEnd') hashes.push(hashState(state));
    }
  }
  return { hashes, used };
}

describe('determinism with items', () => {
  const TURNS_WITH_ITEMS = 6;

  it('replays an item match to the same hash at every turn end', () => {
    const a = runItemMatch(60613, TURNS_WITH_ITEMS);
    const b = runItemMatch(60613, TURNS_WITH_ITEMS);
    expect(a.hashes).toHaveLength(TURNS_WITH_ITEMS);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.used).toEqual(b.used);
    // A constant hash would pass the comparison above and mean nothing.
    expect(new Set(a.hashes).size).toBeGreaterThan(1);
  });

  it('really used the four items the plan asks for', () => {
    const { used } = runItemMatch(60613, TURNS_WITH_ITEMS);
    for (const id of ['windChange', 'bunge', 'dual', 'teleport'] as ItemId[]) {
      expect(used, `item ${id} was never accepted`).toContain(id);
    }
  });

  it('diverges for a different seed', () => {
    const a = runItemMatch(60613, TURNS_WITH_ITEMS);
    const c = runItemMatch(11719, TURNS_WITH_ITEMS);
    expect(c.hashes).toHaveLength(TURNS_WITH_ITEMS);
    expect(a.hashes).not.toEqual(c.hashes);
  });
});
