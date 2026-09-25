/**
 * What an item *does*, in words a player reads before spending a slot on it: a tagline
 * short enough for a picker button or the HUD's caption line, and a sentence for the
 * room's info card.
 *
 * The wording is the client's (DESIGN §3 conventions: `displayName` is the only player
 * text the shared data carries), but every number comes from `@gunbros/shared` — the
 * heal, the multipliers, the Dual gap — so a retune in `data/items.ts` or
 * `constants.items` shows up here by itself. What each effect means is DESIGN §4 and
 * `rules/items.ts`; keep the two in step when an item changes behaviour.
 */
import { constants, getItemDef, itemSlots } from '@gunbros/shared';
import type { ItemDef, ItemId } from '@gunbros/shared';
import { el, pixelLabel } from './dom.js';
import { uiPieceElement } from '../render/uiKit.js';

export interface ItemText {
  /** A few words: "Fire twice", "+150 HP". Fits a picker button and the HUD caption. */
  tagline: string;
  /** One or two sentences for the info card. */
  effect: string;
}

/** The rules every item shares, for the card before anything has been picked. */
export const itemRules =
  `Fill ${itemSlots} slots before the match. In battle you can use one item per turn, ` +
  'and each one is gone once used. Using an item adds its delay to your turn, which ' +
  'pushes your next turn back.';

/** 1.5 → "50%", 0.7 → "70%". */
function percent(multiplier: number): string {
  return `${Math.round(multiplier * 100)}%`;
}

/** Ticks as seconds, trimmed: 20 → "0.33 s", 60 → "1 s". */
function seconds(ticks: number): string {
  const s = ticks / constants.tickRate;
  return `${Number(s.toFixed(2))} s`;
}

export function itemText(id: ItemId): ItemText {
  const def = getItemDef(id);
  const p = def.params;
  switch (id) {
    case 'dual':
      return {
        tagline: 'Fire twice',
        effect:
          'Your shot this turn fires twice: the second volley follows ' +
          `${seconds(constants.items.dualGapTicks)} later at the same angle and power.`,
      };
    case 'dualPlus':
      return {
        tagline: 'S1 then S2',
        effect:
          'Fires your S1, then your S2 right after it, at the same angle and power, ' +
          'whichever shot you had selected.',
      };
    case 'teleport':
      return {
        tagline: 'Jump to a spot',
        effect:
          'Pick a point to jump to: open air with ground below it, clear of other ' +
          'mobiles. Uses up your whole move gauge for the turn.',
      };
    case 'healSmall':
    case 'healLarge':
      return {
        tagline: `+${p.heal ?? 0} HP`,
        effect: `Restores ${p.heal ?? 0} HP right away, up to your mobile's full health.`,
      };
    case 'bunge':
      return {
        tagline: 'Huge crater',
        effect:
          `This turn's shot digs a crater ${p.carveMultiplier ?? 1}× as wide, ` +
          `but deals only ${percent(p.damageMultiplier ?? 1)} of its damage.`,
      };
    case 'powerUp': {
      const extra = (p.damageMultiplier ?? 1) - 1;
      return {
        tagline: `+${percent(extra)} damage`,
        effect: `This turn's shot deals ${percent(extra)} more damage.`,
      };
    }
    case 'windChange':
      return {
        tagline: 'New wind',
        effect: "Rerolls the wind's direction and strength right away, before you shoot.",
      };
  }
}

/** "2 slots · +300 delay". */
export function itemCost(def: ItemDef): string {
  return `${def.slots === 1 ? '1 slot' : `${def.slots} slots`} · +${def.delay} delay`;
}

/**
 * The room's info card: the item last pointed at, focused or tapped, or the shared
 * rules when `id` is null. Rebuilt whole on every change; it is a handful of nodes.
 */
export function renderItemInfo(host: HTMLElement, id: ItemId | null): void {
  if (id === null) {
    host.replaceChildren(el('p', 'item-info-effect', itemRules));
    return;
  }
  const def = getItemDef(id);
  const text = itemText(id);
  const icon = el('div', 'item-info-icon');
  icon.appendChild(uiPieceElement(`item/${id}`, 2));
  const head = el('div', 'item-info-head');
  head.append(
    pixelLabel(def.displayName, { scale: 2, color: '#ffd23f' }, 'item-info-name'),
    el('span', 'item-info-cost', itemCost(def)),
  );
  host.replaceChildren(icon, head, el('p', 'item-info-effect', text.effect));
}
