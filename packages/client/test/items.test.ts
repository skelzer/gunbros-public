/**
 * Items on the client (DESIGN §4, §6.2).
 *
 * Two things can go wrong on this side and neither shows up in a screenshot:
 *
 * - the authoritative `itemUsed` is not applied, so this engine's `turnMods` stay empty
 *   and it desyncs on the first Dual, Bunge or wind change — the hash comparison below
 *   is the same one `turnEnd` makes in a real match;
 * - the six slots are laid out as a list rather than a budget, so a two-slot item ends
 *   up on the wrong key and the HUD fires something other than what it drew.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, hashState, itemsRemaining, snapshotForTurnEnd, step } from '@gunbros/shared';
import type { ItemId, MatchStartMsg, MatchState } from '@gunbros/shared';
import { applyServerMessage, createMatchFromStart, stepTo } from '../src/net/playback.js';
import {
  addItem,
  canAdd,
  layoutLoadout,
  markUsed,
  removeAt,
  slotAt,
  usedSlots,
} from '../src/state/loadout.js';

const loadout: ItemId[] = ['dual', 'teleport', 'healSmall', 'bunge', 'powerUp'];

const start: MatchStartMsg = {
  t: 'matchStart',
  seed: 9091,
  mapId: 'hills',
  players: [
    { seat: 0, playerId: 'p0', nick: 'Ana', team: 'A', mobileId: 'armor', items: loadout },
    { seat: 1, playerId: 'p1', nick: 'Bruno', team: 'B', mobileId: 'armor', items: loadout },
  ],
  skyEvent: 'none',
};

function pair(): { server: MatchState; client: MatchState } {
  return { server: createMatchFromStart(start), client: createMatchFromStart(start) };
}

/** Walk an engine to the point where the active seat may act. */
function toActive(state: MatchState): void {
  let guard = 0;
  while (state.phase !== 'active' && guard < 600) {
    step(state);
    guard++;
  }
}

describe('createMatchFromStart', () => {
  it('carries the loadout each seat starts with', () => {
    const state = createMatchFromStart(start);
    expect(state.seats[0]?.items).toEqual(loadout);
    expect(itemsRemaining(state, 0)).toEqual(loadout);
  });
});

describe('itemUsed playback', () => {
  it('applies the authority’s item at its tick and stays hash-identical', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;

    // The authority: validate, note the tick, apply, broadcast (DESIGN §6.2).
    const tick = server.tick;
    const events = applyIntent(server, { t: 'useItem', seat, itemId: 'bunge' });
    expect(events.some((e) => e.t === 'itemUsed')).toBe(true);

    const result = applyServerMessage(client, { t: 'itemUsed', seat, itemId: 'bunge', tick });
    expect(result.applied).toBe(true);
    expect(result.events.some((e) => e.t === 'itemUsed')).toBe(true);
    expect(client.turnMods.bunge).toBe(true);
    expect(hashState(client)).toBe(hashState(server));
    expect(itemsRemaining(client, seat)).not.toContain('bunge');
  });

  it('follows a wind change through the shared PRNG', () => {
    // The one item that draws from the match PRNG: an engine that skipped it would run
    // every later roll one number out of step, which nothing short of `turnEnd` would
    // catch — and it moves the wind, which every shot after it depends on.
    const windStart: MatchStartMsg = {
      ...start,
      players: start.players.map((p) => ({ ...p, items: ['windChange', 'bunge'] as ItemId[] })),
    };
    const server = createMatchFromStart(windStart);
    const client = createMatchFromStart(windStart);
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;
    const tick = server.tick;

    const events = applyIntent(server, { t: 'useItem', seat, itemId: 'windChange' });
    expect(events.some((e) => e.t === 'windChange')).toBe(true);

    const result = applyServerMessage(client, { t: 'itemUsed', seat, itemId: 'windChange', tick });
    expect(result.events.some((e) => e.t === 'windChange')).toBe(true);
    expect(client.wind.strength).toBe(server.wind.strength);
    expect(client.wind.directionDeg).toBe(server.wind.directionDeg);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('refuses an item the seat does not own, on both engines alike', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;
    const before = client.wind.strength;
    const tick = server.tick;
    // `windChange` is not in this loadout: the authority would never broadcast it, and
    // a stale or forged message must change nothing here either.
    applyServerMessage(client, { t: 'itemUsed', seat, itemId: 'windChange', tick });
    expect(client.wind.strength).toBe(before);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('desyncs at turnEnd when the item is dropped instead of applied', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;
    applyIntent(server, { t: 'useItem', seat, itemId: 'powerUp' });

    // The client never hears the `itemUsed`: the turn-end hashes part company.
    const result = applyServerMessage(client, { t: 'turnEnd', snapshot: snapshotForTurnEnd(server) });
    expect(result.desync).toBe(true);
  });

  it('carries a teleport target and leaves the mobile on the ground', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;
    const m = server.mobiles[seat];
    expect(m).toBeDefined();
    if (!m) return;

    // A point well above the mobile's own ground: air, with ground below it.
    const target = { x: m.x, y: m.y - 60 };
    const tick = server.tick;
    const events = applyIntent(server, { t: 'useItem', seat, itemId: 'teleport', target });
    expect(events.some((e) => e.t === 'teleport')).toBe(true);

    const result = applyServerMessage(client, {
      t: 'itemUsed',
      seat,
      itemId: 'teleport',
      target,
      tick,
    });
    expect(result.applied).toBe(true);
    expect(client.mobiles[seat]?.x).toBe(server.mobiles[seat]?.x);
    expect(client.mobiles[seat]?.y).toBe(server.mobiles[seat]?.y);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('ignores an item the rules refuse, on both engines alike', () => {
    const { server, client } = pair();
    toActive(server);
    stepTo(client, server.tick, 240);
    const seat = server.activeSeat;
    applyIntent(server, { t: 'useItem', seat, itemId: 'bunge' });
    const tick = server.tick;
    applyServerMessage(client, { t: 'itemUsed', seat, itemId: 'bunge', tick });

    // One item per turn (DESIGN §4): a replayed or stale second one changes nothing.
    const before = hashState(client);
    const result = applyServerMessage(client, { t: 'itemUsed', seat, itemId: 'powerUp', tick });
    expect(result.applied).toBe(true);
    expect(hashState(client)).toBe(before);
    expect(client.turnMods.powerUp).toBe(false);
  });
});

describe('loadout layout', () => {
  it('gives a two-slot item two slots', () => {
    const layout = layoutLoadout(['dual', 'teleport']);
    expect(layout).toEqual([
      { index: 0, span: 2, itemId: 'dual', order: 0 },
      { index: 2, span: 1, itemId: 'teleport', order: 1 },
    ]);
    // Both of Dual's keys reach Dual; the teleport sits on key 3.
    expect(slotAt(layout, 0)?.itemId).toBe('dual');
    expect(slotAt(layout, 1)?.itemId).toBe('dual');
    expect(slotAt(layout, 2)?.itemId).toBe('teleport');
    expect(slotAt(layout, 3)).toBeNull();
  });

  it('fills the six slots exactly and refuses the seventh', () => {
    const full: ItemId[] = ['dual', 'dualPlus', 'healLarge'];
    expect(usedSlots(full)).toBe(6);
    expect(canAdd(full, 'bunge')).toBe(false);
    expect(addItem(full, 'bunge')).toEqual(full);
    expect(layoutLoadout(full).map((e) => e.index)).toEqual([0, 2, 4]);
  });

  it('skips an entry that does not fit but keeps a later one that does', () => {
    // Same packing rule as the shared `validateLoadout`, so the bar shows what the
    // match will actually hold.
    const items: ItemId[] = ['dual', 'dualPlus', 'healLarge', 'bunge'];
    expect(layoutLoadout(items).map((e) => e.itemId)).toEqual(['dual', 'dualPlus', 'healLarge']);
    const mixed: ItemId[] = ['dual', 'dualPlus', 'bunge', 'healLarge', 'powerUp'];
    expect(layoutLoadout(mixed).map((e) => e.itemId)).toEqual([
      'dual',
      'dualPlus',
      'bunge',
      'powerUp',
    ]);
  });

  it('refuses a second copy of a two-slot item, the way the server does', () => {
    // The room picker and `validateItems` in the server read one shared rule
    // (`canAddToLoadout`, DESIGN §7 item 98): a button the picker leaves enabled must
    // never be answered with `badItems`.
    expect(canAdd(['dual'], 'dual')).toBe(false);
    expect(canAdd(['healLarge'], 'healLarge')).toBe(false);
    expect(canAdd(['healSmall'], 'healSmall')).toBe(true);
    expect(addItem(['dual'], 'dual')).toEqual(['dual']);
    expect(addItem(['healSmall'], 'healSmall')).toEqual(['healSmall', 'healSmall']);
  });

  it('removes exactly the copy that was clicked', () => {
    const items: ItemId[] = ['bunge', 'dual', 'bunge'];
    expect(removeAt(items, 2)).toEqual(['bunge', 'dual']);
    expect(removeAt(items, 0)).toEqual(['dual', 'bunge']);
    expect(removeAt(items, 9)).toEqual(items);
  });

  it('marks the earlier copy of a repeated item as the spent one', () => {
    expect(markUsed(['bunge', 'dual', 'bunge'], ['bunge', 'dual'])).toEqual([false, false, true]);
    expect(markUsed(['bunge', 'bunge'], [])).toEqual([true, true]);
    expect(markUsed([], [])).toEqual([]);
  });

  it('agrees with the simulation about which slot is spent', () => {
    const state = createMatchFromStart(start);
    toActive(state);
    const seat = state.activeSeat;
    applyIntent(state, { t: 'useItem', seat, itemId: 'bunge' });
    const slot = state.seats[seat];
    expect(slot).toBeDefined();
    if (!slot) return;
    const used = markUsed(slot.items, itemsRemaining(state, seat));
    const layout = layoutLoadout(slot.items);
    const bunge = layout.find((e) => e.itemId === 'bunge');
    expect(bunge).toBeDefined();
    if (!bunge) return;
    expect(used[bunge.order]).toBe(true);
    // Bunge sits on slot 4 (Dual takes 1 and 2, Teleport 3, Bandage 4 — zero-based 4).
    expect(bunge.index).toBe(4);
  });
});
