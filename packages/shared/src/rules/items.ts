/**
 * Item rules (DESIGN §4). What an item costs is in `data/items.ts`; what it *does* is
 * here, and nowhere else.
 *
 * Three kinds of effect, and the difference matters for determinism:
 *
 * - **Immediate**: teleport, the two heals and the wind change change the world the
 *   moment the item is used. They are applied here, from {@link applyUseItem}.
 * - **Deferred to the shot**: Dual and Dual+ set a flag the reducer reads when the turn's
 *   `fire` goes off, which is when it knows the angle, the power and the muzzle.
 * - **Multipliers**: Bunge and Power Up set a flag that {@link itemDamageMultiplier} and
 *   {@link itemCarveMultiplier} turn into a number at the point of effect, so every body
 *   of a volley, every shard a behaviour splits into and every bolt it calls down is
 *   covered by one rule instead of a copy per behaviour.
 *
 * All of it lives in `MatchState` (`turnMods`, `PlayerSlot.itemsUsed`), is hashed and is
 * snapshotted, so the server and every client reach the same state from the same
 * broadcast `itemUsed` (DESIGN §6.2).
 *
 * Nothing here throws. The server validates before it broadcasts; a client replaying a
 * stale or malformed message must get a no-op, never an exception.
 */
import { constants } from '../data/constants.js';
import { findItemDef, getItemDef, isItemId } from '../data/items.js';
import type { ItemDef, ItemId } from '../data/items.js';
import { getMobileDef } from '../data/mobiles.js';
import type { MobileDef } from '../data/mobiles.js';
import { isFiniteNumber } from '../math/fixed.js';
import { NO_GROUND } from '../terrain/terrain.js';
import type { Terrain } from '../terrain/terrain.js';
import { setMoveDir, settleOnGround } from '../entities/mobile.js';
import type { MobileState } from '../entities/mobile.js';
import type { SimEvent } from '../match/events.js';
import type { MatchState } from '../match/match.js';
import { mobileOfSeat, noTurnMods, slotOfSeat } from '../match/match.js';
import { generateWind } from './wind.js';
import { itemDelay } from './delay.js';
import { turnAcceptsIntent } from './turn.js';

/** A point on the map. Only Teleport uses one today. */
export interface ItemTarget {
  x: number;
  y: number;
}

/** Why an item may not be used. One string per rule, so a HUD can explain the refusal. */
export type ItemRejection =
  | 'unknownItem'
  | 'notYourTurn'
  | 'deadMobile'
  | 'notInLoadout'
  | 'alreadySpent'
  | 'oneItemPerTurn'
  | 'targetRequired'
  | 'targetOutsideMap'
  | 'targetNotAir'
  | 'targetNoGround'
  | 'targetOccupied';

export interface ItemCheckOk {
  ok: true;
  def: ItemDef;
}
export interface ItemCheckFail {
  ok: false;
  reason: ItemRejection;
}
export type ItemCheck = ItemCheckOk | ItemCheckFail;

function fail(reason: ItemRejection): ItemCheckFail {
  return { ok: false, reason };
}

/** How many of `id` a list holds. Loadouts are short; a scan is the honest way. */
function countOf(list: readonly ItemId[], id: ItemId): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === id) n++;
  return n;
}

/** Does this seat still own an unspent `id`? */
export function itemsRemaining(state: MatchState, seat: number): ItemId[] {
  const slot = slotOfSeat(state, seat);
  if (!slot) return [];
  const used = slot.itemsUsed.slice();
  const out: ItemId[] = [];
  for (let i = 0; i < slot.items.length; i++) {
    const id = slot.items[i];
    if (id === undefined) continue;
    const at = used.indexOf(id);
    if (at >= 0) {
      used.splice(at, 1);
      continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * May this seat use this item right now (DESIGN §4: "slots owned, not already used this
 * turn, prerequisites")? The one gate the server calls before it broadcasts and every
 * engine calls again as it applies the broadcast, so all of them agree by construction.
 */
export function canUseItem(
  state: MatchState,
  seat: number,
  itemId: ItemId,
  target?: ItemTarget,
): ItemCheck {
  if (!isItemId(itemId)) return fail('unknownItem');
  const def = findItemDef(itemId);
  if (!def) return fail('unknownItem');

  // The phase and the seat: the same gate every other intent goes through, so a
  // `freePlay` sandbox can use items freely and a `turns` match cannot (DESIGN §7.25).
  if (!turnAcceptsIntent(state, seat)) return fail('notYourTurn');

  const m = mobileOfSeat(state, seat);
  if (!m || !m.alive) return fail('deadMobile');

  const slot = slotOfSeat(state, seat);
  if (!slot) return fail('notInLoadout');
  const owned = countOf(slot.items, itemId);
  if (owned === 0) return fail('notInLoadout');
  if (countOf(slot.itemsUsed, itemId) >= owned) return fail('alreadySpent');

  // One item per turn (DESIGN §2.9, §4). A `freePlay` match has no turn boundary to
  // clear the list at, so the rule would mean "one item ever" there; the sandbox is a
  // workbench and gets to use as many as it likes.
  if (state.mode === 'turns' && state.turnMods.usedThisTurn.length > 0) {
    return fail('oneItemPerTurn');
  }

  if (def.needsTarget) {
    if (!target || !isFiniteNumber(target.x) || !isFiniteNumber(target.y)) {
      return fail('targetRequired');
    }
    const bad = checkTeleportTarget(state, m, getMobileDef(m.defId), target);
    if (bad) return fail(bad);
  }

  return { ok: true, def };
}

// --------------------------------------------------------------------------
// Teleport target validation (DESIGN §4: "must be air above ground")
// --------------------------------------------------------------------------

/** Is the hull box a mobile would occupy at (x, y) free of terrain? */
function hullIsAir(terrain: Terrain, def: MobileDef, x: number, y: number): boolean {
  const half = def.footprint.w / 2;
  const step = Math.max(1, constants.items.teleportClearanceStepPx);
  for (let dy = 0; dy <= def.footprint.h; dy += step) {
    const sy = y - dy;
    if (terrain.isSolid(x - half, sy) || terrain.isSolid(x, sy) || terrain.isSolid(x + half, sy)) {
      return false;
    }
  }
  // The feet row itself, which the loop above samples at dy = 0, plus the very top of
  // the hull, which a step size that does not divide the height would otherwise miss.
  const top = y - def.footprint.h;
  return !(terrain.isSolid(x - half, top) || terrain.isSolid(x, top) || terrain.isSolid(x + half, top));
}

/** Do the two hull boxes overlap, with `pad` px of breathing room? */
function hullsOverlap(
  ax: number,
  ay: number,
  aDef: MobileDef,
  bx: number,
  by: number,
  bDef: MobileDef,
  pad: number,
): boolean {
  const dx = Math.abs(ax - bx);
  if (dx > aDef.footprint.w / 2 + bDef.footprint.w / 2 + pad) return false;
  const aTop = ay - aDef.footprint.h - pad;
  const bTop = by - bDef.footprint.h - pad;
  return aTop <= by + pad && bTop <= ay + pad;
}

/**
 * The teleport prerequisites, in the order a player would think of them: on the map, in
 * the air, with ground close enough underneath to land on, and not on top of somebody.
 * Returns the rejection or `null` when the point is legal.
 */
export function checkTeleportTarget(
  state: MatchState,
  m: MobileState,
  def: MobileDef,
  target: ItemTarget,
): ItemRejection | null {
  const margin = constants.items.teleportMarginPx;
  const terrain = state.terrain;
  if (
    target.x < margin ||
    target.x > terrain.width - margin ||
    target.y < 0 ||
    target.y > terrain.height - margin
  ) {
    return 'targetOutsideMap';
  }
  if (!hullIsAir(terrain, def, target.x, target.y)) return 'targetNotAir';
  const ground = terrain.groundBelow(target.x, target.y, constants.items.teleportGroundProbePx);
  if (ground === NO_GROUND) return 'targetNoGround';

  const pad = constants.items.teleportMinSeparationPx;
  for (let i = 0; i < state.mobiles.length; i++) {
    const other = state.mobiles[i];
    if (!other || !other.alive || other.seat === m.seat) continue;
    const otherDef = getMobileDef(other.defId);
    // Checked where it would *land*, not where it was clicked: that is where it ends up.
    if (hullsOverlap(target.x, ground, def, other.x, other.y, otherDef, pad)) {
      return 'targetOccupied';
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Per-turn multipliers (Bunge, Power Up)
// --------------------------------------------------------------------------

/**
 * Damage multiplier the active seat's items apply to `ownerSeat`'s damage this turn.
 *
 * Keyed off the *owner* of the blast, not off whose turn it is, so a mine another seat
 * dropped three turns ago is not boosted by my Power Up when it goes off during my turn.
 */
export function itemDamageMultiplier(state: MatchState, ownerSeat: number): number {
  if (ownerSeat !== state.activeSeat) return 1;
  let mult = 1;
  if (state.turnMods.bunge) mult *= getItemDef('bunge').params.damageMultiplier ?? 1;
  if (state.turnMods.powerUp) mult *= getItemDef('powerUp').params.damageMultiplier ?? 1;
  return mult;
}

/** Carve-radius multiplier for `ownerSeat`'s explosions this turn (Bunge). */
export function itemCarveMultiplier(state: MatchState, ownerSeat: number): number {
  if (ownerSeat !== state.activeSeat) return 1;
  if (!state.turnMods.bunge) return 1;
  return getItemDef('bunge').params.carveMultiplier ?? 1;
}

/** Ticks between Dual's two volleys. */
export function dualGapTicks(): number {
  return constants.items.dualGapTicks;
}

/** Everything a turn's items changed, forgotten (DESIGN §4: current turn only). */
export function resetTurnMods(state: MatchState): void {
  state.turnMods = noTurnMods();
}

// --------------------------------------------------------------------------
// Application
// --------------------------------------------------------------------------

/**
 * Spend `itemId` for `seat` and apply whatever it does. Returns true when the item was
 * used; a rejected item changes nothing at all, not even the delay.
 *
 * The delay is banked into `state.pendingDelay` through `itemDelay` (DESIGN §7 item 19):
 * like the shot's own cost it is only moved onto the seat when the turn ends, so the
 * HUD's order does not reshuffle while the shell that item paid for is still in the air.
 */
export function applyUseItem(
  state: MatchState,
  events: SimEvent[],
  seat: number,
  itemId: ItemId,
  target?: ItemTarget,
): boolean {
  const check = canUseItem(state, seat, itemId, target);
  if (!check.ok) return false;
  const def = check.def;
  const slot = slotOfSeat(state, seat);
  const m = mobileOfSeat(state, seat);
  if (!slot || !m) return false;

  slot.itemsUsed.push(itemId);
  state.turnMods.usedThisTurn.push(itemId);
  state.pendingDelay += itemDelay([itemId]);

  const usedTarget = def.needsTarget && target ? { x: target.x, y: target.y } : undefined;
  events.push(
    usedTarget
      ? { t: 'itemUsed', seat, itemId, target: usedTarget }
      : { t: 'itemUsed', seat, itemId },
  );

  switch (itemId) {
    case 'dual':
      state.turnMods.dual = true;
      break;
    case 'dualPlus':
      state.turnMods.dualPlus = true;
      break;
    case 'bunge':
      state.turnMods.bunge = true;
      break;
    case 'powerUp':
      state.turnMods.powerUp = true;
      break;
    case 'healSmall':
    case 'healLarge':
      applyHeal(state, events, m, def);
      break;
    case 'teleport':
      if (target) applyTeleport(state, events, m, target);
      break;
    case 'windChange':
      state.wind = generateWind(state.rng);
      events.push({
        t: 'windChange',
        strength: state.wind.strength,
        directionDeg: state.wind.directionDeg,
      });
      break;
  }
  return true;
}

/** +hp, capped at the mobile's own maximum (DESIGN §4). */
function applyHeal(state: MatchState, events: SimEvent[], m: MobileState, def: ItemDef): void {
  const mobileDef = getMobileDef(m.defId);
  const before = m.hp;
  m.hp = Math.min(mobileDef.hp, m.hp + (def.params.heal ?? 0));
  events.push({ t: 'heal', seat: m.seat, amount: m.hp - before });
}

/**
 * Move the mobile to the target and let it settle on the ground under it. It costs the
 * whole move gauge (DESIGN §4), and the walk is stopped first: a mobile that teleports
 * mid-stride would otherwise keep walking from its new spot on a gauge it no longer has.
 */
function applyTeleport(
  state: MatchState,
  events: SimEvent[],
  m: MobileState,
  target: ItemTarget,
): void {
  const def = getMobileDef(m.defId);
  const fromX = m.x;
  const fromY = m.y;
  setMoveDir(m, 0);
  m.x = target.x;
  m.y = target.y;
  m.vx = 0;
  m.vy = 0;
  m.grounded = false;
  settleOnGround(m, def, state.terrain);
  m.moveGauge = 0;
  events.push({ t: 'teleport', seat: m.seat, fromX, fromY, x: m.x, y: m.y });
}
