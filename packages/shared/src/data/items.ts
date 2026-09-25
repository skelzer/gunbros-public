/**
 * Items (DESIGN §4). Six slots per player, chosen in the room before the match; one
 * item per turn; every item is a consumable — a loadout entry is spent the moment it is
 * used and is gone for the rest of the match.
 *
 * This file is data only. `rules/items.ts` reads it and is the only module that knows
 * what an item *does*; the mechanics every item shares (Dual's gap, the teleport
 * probes) are in `constants.items`, and the magnitudes below are per item so one can be
 * retuned without touching a rule.
 */

export type ItemId =
  | 'dual'
  | 'dualPlus'
  | 'teleport'
  | 'healSmall'
  | 'healLarge'
  | 'bunge'
  | 'powerUp'
  | 'windChange';

export interface ItemDef {
  id: ItemId;
  displayName: string;
  /** Slots consumed of the six available in the room loadout. */
  slots: number;
  /** Delay added when the item is used (DESIGN §2.8), banked at the end of the turn. */
  delay: number;
  /** Does the item need a clicked point? Only Teleport does. */
  needsTarget: boolean;
  /** This item's own magnitudes. Shared mechanics live in `constants.items`. */
  params: Record<string, number>;
}

/**
 * Every item, in the order the room's picker and the six HUD slots show them. The id is
 * the mechanical key and `displayName` is what a player reads (DESIGN §3 conventions),
 * so either can be changed without touching the other.
 */
export const itemDefs: ItemDef[] = [
  { id: 'dual', displayName: 'Dual', slots: 2, delay: 300, needsTarget: false, params: {} },
  { id: 'dualPlus', displayName: 'Dual+', slots: 2, delay: 350, needsTarget: false, params: {} },
  { id: 'teleport', displayName: 'Teleport', slots: 1, delay: 250, needsTarget: true, params: {} },
  {
    id: 'healSmall',
    displayName: 'Bandage',
    slots: 1,
    delay: 150,
    needsTarget: false,
    params: { heal: 150 },
  },
  {
    id: 'healLarge',
    displayName: 'Med Kit',
    slots: 2,
    delay: 300,
    needsTarget: false,
    params: { heal: 400 },
  },
  {
    id: 'bunge',
    displayName: 'Bunge',
    slots: 1,
    delay: 200,
    needsTarget: false,
    params: { carveMultiplier: 2.2, damageMultiplier: 0.7 },
  },
  {
    id: 'powerUp',
    displayName: 'Power Up',
    slots: 1,
    delay: 250,
    needsTarget: false,
    params: { damageMultiplier: 1.5 },
  },
  {
    id: 'windChange',
    displayName: 'Wind Change',
    slots: 1,
    delay: 200,
    needsTarget: false,
    params: {},
  },
];

/** Slots available per player loadout (DESIGN §4). */
export const itemSlots = 6;

/** Every item id, in table order — the order a picker and the HUD slots use. */
export const itemIds: ItemId[] = itemDefs.map((def) => def.id);

export function isItemId(value: unknown): value is ItemId {
  for (let i = 0; i < itemDefs.length; i++) if (itemDefs[i]?.id === value) return true;
  return false;
}

export function getItemDef(id: ItemId): ItemDef {
  for (let i = 0; i < itemDefs.length; i++) {
    const def = itemDefs[i];
    if (def && def.id === id) return def;
  }
  throw new Error(`unknown item id: ${id}`);
}

/** Like {@link getItemDef}, but `undefined` instead of a throw for an unknown id. */
export function findItemDef(id: string): ItemDef | undefined {
  for (let i = 0; i < itemDefs.length; i++) {
    const def = itemDefs[i];
    if (def && def.id === id) return def;
  }
  return undefined;
}

/** Slots a loadout occupies of the {@link itemSlots} available. */
export function loadoutSlots(items: readonly ItemId[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const id = items[i];
    if (id === undefined) continue;
    const def = findItemDef(id);
    if (def) total += def.slots;
  }
  return total;
}

/**
 * May `id` be appended to `items`? The whole loadout rule in one predicate (DESIGN §4,
 * §7 item 98): the six-slot budget has to have room for it, and a *two*-slot item may
 * not be taken twice — a one-slot one may, because every item is a consumable and
 * "three bandages" is a sensible six-slot loadout.
 *
 * The room's picker, the server's `setItems` guard and {@link validateLoadout} all read
 * this one function, so a pick the picker offers is never a pick the server refuses.
 */
export function canAddToLoadout(
  items: readonly ItemId[],
  id: ItemId,
  slots: number = itemSlots,
): boolean {
  const def = findItemDef(id);
  if (!def) return false;
  if (def.slots > 1 && items.includes(id)) return false;
  return loadoutSlots(items) + def.slots <= slots;
}

/**
 * The loadout a match will actually honour: known ids, in the order given, dropping
 * anything {@link canAddToLoadout} refuses (over budget, or a second copy of a two-slot
 * item). Never throws — a malformed lobby list must not be able to stop a match from
 * starting (the server's own guard rejects it long before, DESIGN §6.1 `setItems`).
 */
export function validateLoadout(items: readonly ItemId[] | undefined): ItemId[] {
  const out: ItemId[] = [];
  if (!items) return out;
  for (let i = 0; i < items.length; i++) {
    const id = items[i];
    if (id === undefined) continue;
    if (!canAddToLoadout(out, id)) continue;
    out.push(id);
  }
  return out;
}
