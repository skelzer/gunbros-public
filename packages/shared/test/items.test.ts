/**
 * Items (DESIGN §4, §10: "items.test.ts").
 *
 * One block per item's effect, plus the rules that apply to all of them: the loadout is
 * six slots, an item is a consumable, one per turn, the delay is banked into the turn's
 * cost, and everything an item does is in the state hash.
 *
 * The arena is the flat 1600×900 test map with no wind, in `turns` mode, so a shot goes
 * where the numbers say it does.
 */
import { describe, expect, it } from 'vitest';
import { createMatch, applyIntent, step } from '../src/match/reducer.js';
import { isSettled, mobileOfSeat, slotOfSeat } from '../src/match/match.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import type { SimEvent } from '../src/match/events.js';
import { hashState } from '../src/match/snapshot.js';
import { takeSnapshot, applySnapshot } from '../src/match/snapshot.js';
import { constants } from '../src/data/constants.js';
import {
  canAddToLoadout,
  getItemDef,
  itemDefs,
  itemIds,
  itemSlots,
  loadoutSlots,
  validateLoadout,
} from '../src/data/items.js';
import type { ItemId } from '../src/data/items.js';
import { armor } from '../src/data/mobiles.js';
import {
  canUseItem,
  itemCarveMultiplier,
  itemDamageMultiplier,
  itemsRemaining,
} from '../src/rules/items.js';
import { makeWind } from '../src/rules/wind.js';
import { flatTestMap } from './helpers.js';

const GROUND_Y = 600;

function seatsWith(a: ItemId[], b: ItemId[] = []): SeatSpec[] {
  return [
    { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor', items: a },
    { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor', items: b },
  ];
}

/** A numeric item param, which `noUncheckedIndexedAccess` makes optional. */
function param(id: ItemId, key: string): number {
  return getItemDef(id).params[key] ?? 0;
}

/** A turns match sitting in `active` on seat 0, with the two mobiles placed. */
function itemMatch(items: ItemId[], options: { xA?: number; xB?: number; seed?: number } = {}) {
  const state = createMatch(options.seed ?? 5150, flatTestMap(), seatsWith(items), {
    mode: 'turns',
  });
  state.wind = makeWind(0, 0);
  const a = mobileOfSeat(state, 0);
  const b = mobileOfSeat(state, 1);
  if (!a || !b) throw new Error('no mobiles');
  a.x = options.xA ?? 600;
  a.y = GROUND_Y;
  a.facing = 1;
  b.x = options.xB ?? 900;
  b.y = GROUND_Y;
  b.facing = -1;
  while (state.phase !== 'active') step(state);
  return state;
}

function use(
  state: MatchState,
  itemId: ItemId,
  target?: { x: number; y: number },
  seat = 0,
): SimEvent[] {
  return applyIntent(state, target ? { t: 'useItem', seat, itemId, target } : { t: 'useItem', seat, itemId });
}

function resolve(state: MatchState, max = 900): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    for (const e of step(state)) events.push(e);
    if (state.phase !== 'resolving' && isSettled(state)) break;
  }
  return events;
}

function fire(state: MatchState, shot: 's1' | 's2' | 'ss', relAngle: number, power: number): SimEvent[] {
  return applyIntent(state, { t: 'fire', seat: 0, shot, relAngle, power });
}

function countOf(events: readonly SimEvent[], type: SimEvent['t']): number {
  let n = 0;
  for (const e of events) if (e.t === type) n++;
  return n;
}

function carvedPixels(before: Uint8Array, after: Uint8Array): number {
  let carved = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== 0 && after[i] === 0) carved++;
  return carved;
}

// --------------------------------------------------------------------------
// The table
// --------------------------------------------------------------------------

describe('the item table (DESIGN §4)', () => {
  it('holds all eight items with an id separate from the display name', () => {
    expect(itemIds).toEqual([
      'dual',
      'dualPlus',
      'teleport',
      'healSmall',
      'healLarge',
      'bunge',
      'powerUp',
      'windChange',
    ]);
    for (const def of itemDefs) {
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(def.displayName).not.toBe(def.id);
      expect(def.slots).toBeGreaterThan(0);
      expect(def.delay).toBeGreaterThan(0);
    }
  });

  it('gives Dual and Dual+ two slots and everything else one', () => {
    expect(getItemDef('dual').slots).toBe(2);
    expect(getItemDef('dualPlus').slots).toBe(2);
    expect(getItemDef('healLarge').slots).toBe(2);
    expect(getItemDef('teleport').slots).toBe(1);
    expect(getItemDef('bunge').slots).toBe(1);
    expect(getItemDef('powerUp').slots).toBe(1);
    expect(getItemDef('windChange').slots).toBe(1);
    expect(getItemDef('healSmall').slots).toBe(1);
  });

  it('only Teleport needs a target', () => {
    for (const def of itemDefs) expect(def.needsTarget).toBe(def.id === 'teleport');
  });
});

describe('loadout validation', () => {
  it('counts slots and accepts a six-slot loadout', () => {
    const full: ItemId[] = ['dual', 'dualPlus', 'teleport', 'healSmall'];
    expect(loadoutSlots(full)).toBe(itemSlots);
    expect(validateLoadout(full)).toEqual(full);
  });

  it('drops whatever does not fit in the six slots', () => {
    // 2 + 2 + 2 fills the six; the last two would be a seventh slot each.
    const tooMany: ItemId[] = ['dual', 'dualPlus', 'healLarge', 'powerUp', 'bunge'];
    const kept = validateLoadout(tooMany);
    expect(kept).toEqual(['dual', 'dualPlus', 'healLarge']);
    expect(loadoutSlots(kept)).toBe(itemSlots);
  });

  it('repeats a one-slot item but never a two-slot one (§7 item 98)', () => {
    expect(canAddToLoadout(['healSmall'], 'healSmall')).toBe(true);
    expect(canAddToLoadout(['dual'], 'dual')).toBe(false);
    expect(canAddToLoadout(['healLarge'], 'healLarge')).toBe(false);
    // Still a budget as well: five one-slot picks leave room for a sixth, never for a
    // two-slot one.
    const five: ItemId[] = ['healSmall', 'healSmall', 'healSmall', 'teleport', 'powerUp'];
    expect(canAddToLoadout(five, 'dual')).toBe(false);
    expect(canAddToLoadout(five, 'healSmall')).toBe(true);
    // And the same rule decides what a match honours, so a hand-made list cannot smuggle
    // a doubled two-slot item past the room.
    expect(validateLoadout(['dual', 'dual', 'bunge'])).toEqual(['dual', 'bunge']);
    expect(validateLoadout(['healSmall', 'healSmall', 'healSmall'])).toEqual([
      'healSmall',
      'healSmall',
      'healSmall',
    ]);
  });

  it('ignores unknown ids and a missing list', () => {
    expect(validateLoadout(undefined)).toEqual([]);
    expect(validateLoadout(['nope' as ItemId, 'bunge'])).toEqual(['bunge']);
  });

  it('is what createMatch puts on the seat', () => {
    const state = itemMatch(['dual', 'bunge']);
    expect(slotOfSeat(state, 0)?.items).toEqual(['dual', 'bunge']);
    expect(slotOfSeat(state, 0)?.itemsUsed).toEqual([]);
    expect(slotOfSeat(state, 1)?.items).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// canUseItem
// --------------------------------------------------------------------------

describe('canUseItem', () => {
  it('accepts an item the seat owns on its own active turn', () => {
    const state = itemMatch(['powerUp']);
    expect(canUseItem(state, 0, 'powerUp')).toMatchObject({ ok: true });
  });

  it('refuses an item that is not in the loadout', () => {
    const state = itemMatch(['powerUp']);
    expect(canUseItem(state, 0, 'bunge')).toEqual({ ok: false, reason: 'notInLoadout' });
  });

  it('refuses an unknown id', () => {
    const state = itemMatch(['powerUp']);
    expect(canUseItem(state, 0, 'nonsense' as ItemId)).toEqual({
      ok: false,
      reason: 'unknownItem',
    });
  });

  it('refuses a seat that is not the active one, and any phase but active', () => {
    const state = itemMatch(['powerUp'], {});
    expect(canUseItem(state, 1, 'powerUp')).toEqual({ ok: false, reason: 'notYourTurn' });
    applyIntent(state, { t: 'skip', seat: 0 });
    expect(state.phase).not.toBe('active');
    expect(canUseItem(state, 0, 'powerUp')).toEqual({ ok: false, reason: 'notYourTurn' });
  });

  it('refuses a dead mobile', () => {
    const state = itemMatch(['powerUp']);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    m.alive = false;
    expect(canUseItem(state, 0, 'powerUp')).toEqual({ ok: false, reason: 'deadMobile' });
  });

  it('refuses Teleport without a target', () => {
    const state = itemMatch(['teleport']);
    expect(canUseItem(state, 0, 'teleport')).toEqual({ ok: false, reason: 'targetRequired' });
  });
});

// --------------------------------------------------------------------------
// Consumption, one per turn, delay
// --------------------------------------------------------------------------

describe('items are consumables', () => {
  it('spends the item and refuses it for the rest of the match', () => {
    const state = itemMatch(['powerUp', 'bunge']);
    expect(itemsRemaining(state, 0)).toEqual(['powerUp', 'bunge']);
    use(state, 'powerUp');
    expect(slotOfSeat(state, 0)?.itemsUsed).toEqual(['powerUp']);
    expect(itemsRemaining(state, 0)).toEqual(['bunge']);
    expect(canUseItem(state, 0, 'powerUp')).toEqual({ ok: false, reason: 'alreadySpent' });
  });

  it('allows one item per turn', () => {
    const state = itemMatch(['powerUp', 'bunge']);
    expect(use(state, 'powerUp').length).toBeGreaterThan(0);
    expect(canUseItem(state, 0, 'bunge')).toEqual({ ok: false, reason: 'oneItemPerTurn' });
    expect(use(state, 'bunge')).toEqual([]);
    expect(slotOfSeat(state, 0)?.itemsUsed).toEqual(['powerUp']);
  });

  it('lets the next turn use another one', () => {
    const state = itemMatch(['powerUp', 'bunge']);
    use(state, 'powerUp');
    applyIntent(state, { t: 'skip', seat: 0 });
    // Run through the other seat's turn back to seat 0.
    for (let i = 0; i < 6000 && !(state.phase === 'active' && state.activeSeat === 0); i++) {
      if (state.phase === 'active') applyIntent(state, { t: 'skip', seat: state.activeSeat });
      step(state);
    }
    expect(state.activeSeat).toBe(0);
    expect(state.turnMods.usedThisTurn).toEqual([]);
    expect(canUseItem(state, 0, 'bunge')).toMatchObject({ ok: true });
  });

  it('banks the item delay into the turn, through the itemDelay hook', () => {
    const state = itemMatch(['healSmall']);
    expect(state.pendingDelay).toBe(0);
    use(state, 'healSmall');
    expect(state.pendingDelay).toBe(getItemDef('healSmall').delay);

    // And the turn end moves it onto the seat together with the shot's own cost.
    const before = slotOfSeat(state, 0)?.delay ?? 0;
    applyIntent(state, { t: 'skip', seat: 0 });
    for (let i = 0; i < 400 && state.phase === 'resolving'; i++) step(state);
    const after = slotOfSeat(state, 0)?.delay ?? 0;
    expect(after - before).toBeGreaterThanOrEqual(
      getItemDef('healSmall').delay + constants.turn.skipDelay,
    );
  });

  it('charges nothing for a refused item', () => {
    const state = itemMatch(['powerUp']);
    use(state, 'bunge');
    expect(state.pendingDelay).toBe(0);
    expect(slotOfSeat(state, 0)?.itemsUsed).toEqual([]);
  });

  it('emits itemUsed with the seat and the id', () => {
    const state = itemMatch(['windChange']);
    const events = use(state, 'windChange');
    const used = events.find((e) => e.t === 'itemUsed');
    expect(used).toMatchObject({ t: 'itemUsed', seat: 0, itemId: 'windChange' });
  });
});

// --------------------------------------------------------------------------
// One block per effect
// --------------------------------------------------------------------------

describe('dual', () => {
  it('fires the selected shot twice, the second dualGapTicks later', () => {
    const state = itemMatch(['dual']);
    use(state, 'dual');
    expect(state.turnMods.dual).toBe(true);
    const events = fire(state, 's1', 45, 0.6);
    // One volley in the air now, one queued.
    expect(countOf(events, 'spawn')).toBe(1);
    expect(state.pendingSpawns).toHaveLength(1);
    expect(state.pendingSpawns[0]?.atTick).toBe(state.tick + constants.items.dualGapTicks);
    // A single `fire` event: the trigger was pulled once.
    expect(countOf(events, 'fire')).toBe(1);

    const rest = resolve(state);
    expect(countOf(rest, 'spawn')).toBe(1);
    expect(countOf(rest, 'explosion')).toBe(2);
  });

  it('gives both volleys the same angle and power', () => {
    const state = itemMatch(['dual']);
    use(state, 'dual');
    const first = fire(state, 's1', 45, 0.6).find((e) => e.t === 'spawn');
    const second = resolve(state).find((e) => e.t === 'spawn');
    if (first?.t !== 'spawn' || second?.t !== 'spawn') throw new Error('no spawns');
    expect(second.vx).toBeCloseTo(first.vx, 9);
    expect(second.vy).toBeCloseTo(first.vy, 9);
    expect(second.x).toBeCloseTo(first.x, 9);
  });

  it('is spent with the turn: the next shot is single', () => {
    const state = itemMatch(['dual']);
    use(state, 'dual');
    fire(state, 's1', 45, 0.6);
    resolve(state, 2000);
    expect(state.turnMods.dual).toBe(false);
  });
});

describe('dual+', () => {
  it('fires S1 then S2', () => {
    const state = itemMatch(['dualPlus']);
    use(state, 'dualPlus');
    const events = fire(state, 's1', 45, 0.6);
    expect(countOf(events, 'spawn')).toBe(1);
    const first = events.find((e) => e.t === 'spawn');
    expect(first?.t === 'spawn' && first.sprite).toBe(armor.shots.s1.projectile.sprite);
    const queued = state.pendingSpawns[0];
    expect(queued?.def.sprite).toBe(armor.shots.s2.projectile.sprite);
    expect(queued?.def.damage).toBe(armor.shots.s2.projectile.damage);
    expect(queued?.atTick).toBe(state.tick + constants.items.dualGapTicks);
  });

  it('replaces the selection: an SS pick still fires S1 then S2', () => {
    const state = itemMatch(['dualPlus']);
    const slot = slotOfSeat(state, 0);
    if (!slot) throw new Error('no slot');
    slot.ssGauge = constants.ss.gaugeMax;
    use(state, 'dualPlus');
    const events = fire(state, 'ss', 45, 0.6);
    const first = events.find((e) => e.t === 'spawn');
    expect(first?.t === 'spawn' && first.sprite).toBe(armor.shots.s1.projectile.sprite);
    // The SS was not spent, because it was not fired.
    expect(slot.ssGauge).toBe(constants.ss.gaugeMax);
  });
});

describe('teleport', () => {
  it('moves the mobile to the target, settles it and empties the move gauge', () => {
    const state = itemMatch(['teleport']);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const fromX = m.x;
    const events = use(state, 'teleport', { x: 1200, y: GROUND_Y - 120 });
    expect(m.x).toBe(1200);
    // Settled onto the ground, not left hanging where it was clicked.
    expect(m.y).toBeGreaterThanOrEqual(GROUND_Y - 1);
    expect(m.grounded).toBe(true);
    expect(m.moveGauge).toBe(0);
    const jump = events.find((e) => e.t === 'teleport');
    expect(jump).toMatchObject({ t: 'teleport', seat: 0, fromX });
    expect(jump?.t === 'teleport' && jump.x).toBe(1200);
  });

  it('refuses a target outside the map', () => {
    const state = itemMatch(['teleport']);
    expect(canUseItem(state, 0, 'teleport', { x: -50, y: 300 })).toEqual({
      ok: false,
      reason: 'targetOutsideMap',
    });
    expect(canUseItem(state, 0, 'teleport', { x: 1_000_000, y: 300 })).toEqual({
      ok: false,
      reason: 'targetOutsideMap',
    });
  });

  it('refuses a target inside the ground', () => {
    const state = itemMatch(['teleport']);
    expect(canUseItem(state, 0, 'teleport', { x: 1200, y: GROUND_Y + 40 })).toEqual({
      ok: false,
      reason: 'targetNotAir',
    });
  });

  it('refuses a target with no ground within reach below it', () => {
    const state = itemMatch(['teleport']);
    expect(canUseItem(state, 0, 'teleport', { x: 1200, y: 10 })).toEqual({
      ok: false,
      reason: 'targetNoGround',
    });
  });

  it('refuses a target on top of another mobile', () => {
    const state = itemMatch(['teleport']);
    const other = mobileOfSeat(state, 1);
    if (!other) throw new Error('no mobile');
    expect(canUseItem(state, 0, 'teleport', { x: other.x, y: other.y - 30 })).toEqual({
      ok: false,
      reason: 'targetOccupied',
    });
    // A few hull widths away is fine.
    expect(canUseItem(state, 0, 'teleport', { x: other.x + 200, y: GROUND_Y - 60 })).toMatchObject({
      ok: true,
    });
  });

  it('changes nothing when the target is refused', () => {
    const state = itemMatch(['teleport']);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    const { x, y } = m;
    const gauge = m.moveGauge;
    expect(use(state, 'teleport', { x: 1200, y: 10 })).toEqual([]);
    expect(m.x).toBe(x);
    expect(m.y).toBe(y);
    expect(m.moveGauge).toBe(gauge);
    expect(slotOfSeat(state, 0)?.itemsUsed).toEqual([]);
  });
});

describe('the heals', () => {
  it('Bandage adds its hp and emits heal', () => {
    const state = itemMatch(['healSmall']);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    m.hp = 100;
    const events = use(state, 'healSmall');
    expect(m.hp).toBe(100 + param('healSmall', 'heal'));
    expect(events.find((e) => e.t === 'heal')).toMatchObject({
      t: 'heal',
      seat: 0,
      amount: param('healSmall', 'heal'),
    });
  });

  it('Med Kit heals more', () => {
    const state = itemMatch(['healLarge']);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    m.hp = 100;
    use(state, 'healLarge');
    expect(m.hp).toBe(100 + param('healLarge', 'heal'));
    expect(param('healLarge', 'heal')).toBeGreaterThan(param('healSmall', 'heal'));
  });

  it('caps at the mobile definition hp and reports what was actually gained', () => {
    const state = itemMatch(['healLarge']);
    const m = mobileOfSeat(state, 0);
    if (!m) throw new Error('no mobile');
    m.hp = armor.hp - 10;
    const events = use(state, 'healLarge');
    expect(m.hp).toBe(armor.hp);
    expect(events.find((e) => e.t === 'heal')).toMatchObject({ t: 'heal', amount: 10 });
  });
});

describe('bunge', () => {
  it('widens the crater and softens the damage', () => {
    const plain = itemMatch([]);
    const bunged = itemMatch(['bunge']);
    use(bunged, 'bunge');
    expect(bunged.turnMods.bunge).toBe(true);

    const damageOf = (state: MatchState): { damage: number; carved: number } => {
      const target = mobileOfSeat(state, 1);
      if (!target) throw new Error('no target');
      target.hp = 10_000;
      const hp = target.hp;
      const before = state.terrain.mask.slice();
      fire(state, 's1', 20, 0.52);
      resolve(state, 900);
      return { damage: hp - target.hp, carved: carvedPixels(before, state.terrain.mask) };
    };

    const a = damageOf(plain);
    const b = damageOf(bunged);
    expect(a.damage).toBeGreaterThan(0);
    expect(b.damage).toBeCloseTo(a.damage * (param('bunge', 'damageMultiplier')), 4);
    expect(b.carved).toBeGreaterThan(a.carved);
  });

  it('reports the widened radius on the explosion event', () => {
    const state = itemMatch(['bunge']);
    use(state, 'bunge');
    fire(state, 's1', 20, 0.52);
    const events = resolve(state);
    const boom = events.find((e) => e.t === 'explosion');
    expect(boom?.t === 'explosion' && boom.carveRadius).toBeCloseTo(
      armor.shots.s1.projectile.carveRadius * (param('bunge', 'carveMultiplier')),
      6,
    );
  });

  it('applies to the active seat only, not to anything another seat set off', () => {
    // A mine another seat dropped, or a shell still in the air from a previous turn,
    // goes off during my turn. It is not my shot and must not carry my item.
    const state = itemMatch(['bunge']);
    use(state, 'bunge');
    expect(state.activeSeat).toBe(0);
    expect(itemDamageMultiplier(state, 0)).toBeCloseTo(
      param('bunge', 'damageMultiplier'),
      9,
    );
    expect(itemCarveMultiplier(state, 0)).toBeCloseTo(
      param('bunge', 'carveMultiplier'),
      9,
    );
    expect(itemDamageMultiplier(state, 1)).toBe(1);
    expect(itemCarveMultiplier(state, 1)).toBe(1);
  });
});

describe('power up', () => {
  it('multiplies this turn\u2019s damage', () => {
    const plain = itemMatch([]);
    const boosted = itemMatch(['powerUp']);
    use(boosted, 'powerUp');

    const damageOf = (state: MatchState): number => {
      const target = mobileOfSeat(state, 1);
      if (!target) throw new Error('no target');
      target.hp = 10_000;
      const hp = target.hp;
      fire(state, 's1', 20, 0.52);
      resolve(state, 900);
      return hp - target.hp;
    };

    const a = damageOf(plain);
    const b = damageOf(boosted);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a * (param('powerUp', 'damageMultiplier')), 4);
  });

  it('leaves the crater alone', () => {
    const plain = itemMatch([]);
    const boosted = itemMatch(['powerUp']);
    use(boosted, 'powerUp');
    const carveOf = (state: MatchState): number => {
      const before = state.terrain.mask.slice();
      fire(state, 's1', 20, 0.52);
      resolve(state, 900);
      return carvedPixels(before, state.terrain.mask);
    };
    expect(carveOf(boosted)).toBe(carveOf(plain));
  });
});

describe('wind change', () => {
  it('rerolls the wind from the match PRNG and says so', () => {
    const state = itemMatch(['windChange']);
    state.wind = makeWind(3, 17);
    const rngBefore = state.rng.getState();
    const events = use(state, 'windChange');
    expect(state.rng.getState()).not.toEqual(rngBefore);
    const change = events.find((e) => e.t === 'windChange');
    expect(change).toMatchObject({
      t: 'windChange',
      strength: state.wind.strength,
      directionDeg: state.wind.directionDeg,
    });
    expect(state.wind.strength).toBeGreaterThanOrEqual(0);
    expect(state.wind.strength).toBeLessThanOrEqual(constants.wind.maxStrength);
  });

  it('rolls the same wind on two engines at the same PRNG position', () => {
    const a = itemMatch(['windChange']);
    const b = itemMatch(['windChange']);
    use(a, 'windChange');
    use(b, 'windChange');
    expect(a.wind).toEqual(b.wind);
  });
});

// --------------------------------------------------------------------------
// Hash and snapshot
// --------------------------------------------------------------------------

describe('items are authoritative state', () => {
  it('changes the state hash when an item is used', () => {
    const state = itemMatch(['powerUp']);
    const before = hashState(state);
    use(state, 'powerUp');
    expect(hashState(state)).not.toBe(before);
  });

  it('travels through a snapshot', () => {
    const server = itemMatch(['powerUp', 'bunge']);
    const client = itemMatch(['powerUp', 'bunge']);
    use(server, 'powerUp');
    expect(hashState(client)).not.toBe(hashState(server));

    applySnapshot(client, takeSnapshot(server));
    expect(slotOfSeat(client, 0)?.itemsUsed).toEqual(['powerUp']);
    expect(client.turnMods.powerUp).toBe(true);
    expect(client.turnMods.usedThisTurn).toEqual(['powerUp']);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('carries the loadout too, so a rebuilt client is offered the same items', () => {
    const server = itemMatch(['teleport', 'healSmall']);
    const client = itemMatch([]);
    applySnapshot(client, takeSnapshot(server));
    expect(slotOfSeat(client, 0)?.items).toEqual(['teleport', 'healSmall']);
  });
});
