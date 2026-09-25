/**
 * Loadout geometry (DESIGN §4): turning a list of item ids into the six slots that the
 * room's picker and the HUD's item row both draw.
 *
 * A loadout is a *list*, not an array of slots — `PlayerSlot.items` holds the ids in
 * pick order — but a two-slot item has to look twice as wide wherever it is shown, so
 * both screens need the same answer to "which slot does entry i start at, and how many
 * does it cover". That answer is here, once, and it follows exactly the same packing
 * rule as the shared `validateLoadout`: entries are placed in order, and one that does
 * not fit in what is left is skipped rather than ending the pack (a 1-slot item can
 * still follow a rejected 2-slot one).
 *
 * Pure functions over plain lists: no DOM, no MatchState, no storage. The room adds and
 * removes with them, the HUD lays out with them, and the unit tests read them directly.
 */
import { canAddToLoadout, findItemDef, itemSlots } from '@gunbros/shared';
import type { ItemId } from '@gunbros/shared';

export interface LoadoutSlot {
  /** Index of the first of the {@link span} slots this entry occupies. */
  index: number;
  /** Slots it covers: 1 or 2 (`ItemDef.slots`). */
  span: number;
  itemId: ItemId;
  /** Its position in the loadout list, so a click can remove exactly this copy. */
  order: number;
}

/** Where every entry of `items` sits in the six-slot bar. */
export function layoutLoadout(items: readonly ItemId[], slots: number = itemSlots): LoadoutSlot[] {
  const out: LoadoutSlot[] = [];
  let next = 0;
  for (let i = 0; i < items.length; i++) {
    const id = items[i];
    if (id === undefined) continue;
    const def = findItemDef(id);
    if (!def) continue;
    if (next + def.slots > slots) continue;
    out.push({ index: next, span: def.slots, itemId: id, order: i });
    next += def.slots;
  }
  return out;
}

/** The entry covering slot `index`, or null when that slot is empty. */
export function slotAt(layout: readonly LoadoutSlot[], index: number): LoadoutSlot | null {
  for (let i = 0; i < layout.length; i++) {
    const entry = layout[i];
    if (!entry) continue;
    if (index >= entry.index && index < entry.index + entry.span) return entry;
  }
  return null;
}

/** Slots the loadout has spent of the {@link itemSlots} available. */
export function usedSlots(items: readonly ItemId[], slots: number = itemSlots): number {
  let total = 0;
  for (const entry of layoutLoadout(items, slots)) total += entry.span;
  return total;
}

/**
 * Would `id` still fit? The shared rule (DESIGN §7 item 98) and nothing else: the
 * budget has to have room for it, and a two-slot item may not be taken twice. The
 * server's `setItems` guard asks the same function, so a button the picker leaves
 * enabled is never answered with `badItems`.
 */
export function canAdd(items: readonly ItemId[], id: ItemId, slots: number = itemSlots): boolean {
  return canAddToLoadout(items, id, slots);
}

/** `items` with `id` appended, or the list unchanged when it does not fit. */
export function addItem(items: readonly ItemId[], id: ItemId, slots: number = itemSlots): ItemId[] {
  if (!canAdd(items, id, slots)) return items.slice();
  return [...items, id];
}

/** `items` without the entry at list position `order`. */
export function removeAt(items: readonly ItemId[], order: number): ItemId[] {
  if (order < 0 || order >= items.length) return items.slice();
  const out = items.slice();
  out.splice(order, 1);
  return out;
}

/**
 * Which entries of a match loadout have been spent, given what is still unspent
 * (`itemsRemaining`, DESIGN §7 item 92).
 *
 * Both lists can hold the same id twice, so this walks the loadout and hands each entry
 * one of the remaining copies while they last: the earlier copies of an id read as
 * spent, which is the same order `itemsRemaining` itself uses.
 */
export function markUsed(items: readonly ItemId[], remaining: readonly ItemId[]): boolean[] {
  const left = remaining.slice();
  const used: boolean[] = [];
  for (let i = 0; i < items.length; i++) {
    const id = items[i];
    if (id === undefined) {
      used.push(true);
      continue;
    }
    const at = left.indexOf(id);
    if (at >= 0) {
      left.splice(at, 1);
      used.push(false);
    } else {
      used.push(true);
    }
  }
  return used;
}
