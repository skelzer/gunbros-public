/**
 * Delay accounting and turn ordering (DESIGN §2.8, §7 item 4).
 *
 * Every player carries an accumulated `delay`. The next player is the one with the
 * lowest delay among the seats that can actually take a turn (alive and connected);
 * ties go to the lower seat index. Nothing here mutates the match on its own — the turn
 * machine in `rules/turn.ts` is the only caller that writes a delay back.
 *
 * The costs:
 *
 * | action            | delay                                  |
 * |-------------------|----------------------------------------|
 * | shot              | `ShotDef.delay` (armor S1 250 … SS 800)|
 * | skip / timeout    | `constants.turn.skipDelay`             |
 * | time on turn      | `+1` per whole second used             |
 * | item (each)       | `ItemDef.delay` (`rules/items.ts`)     |
 * | movement          | 0 — it costs gauge and time            |
 */
import { constants } from '../data/constants.js';
import { getItemDef } from '../data/items.js';
import type { ItemId } from '../data/items.js';
import type { ShotDef } from '../data/mobiles.js';
import type { MatchState, PlayerSlot } from '../match/match.js';
import { mobileOfSeat } from '../match/match.js';

/** Delay a shot costs its owner. */
export function shotDelay(shot: ShotDef): number {
  return shot.delay;
}

/** Delay a skipped or timed-out turn costs. */
export function skipDelay(): number {
  return constants.turn.skipDelay;
}

/**
 * Delay for the time spent on a turn: `+1` per *whole* second used, so a snap decision
 * is free and a full 20 s turn costs 20 (DESIGN §7 item 4). Ticks, never milliseconds.
 */
export function timeDelay(ticksUsed: number): number {
  if (!(ticksUsed > 0)) return 0;
  return Math.floor(ticksUsed / constants.tickRate) * constants.turn.delayPerSecond;
}

/**
 * Delay the items used on a turn cost (DESIGN §2.8, §4). `applyUseItem` calls this with
 * the one item it accepted and banks the answer into `MatchState.pendingDelay`, so an
 * item is paid for at the end of the turn exactly as the shot is; `turnDelayCost` takes
 * a whole list for the callers that price a turn in one go.
 */
export function itemDelay(items: readonly ItemId[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const id = items[i];
    if (id === undefined) continue;
    total += getItemDef(id).delay;
  }
  return total;
}

/** Everything one turn can cost, in one call. */
export interface TurnCost {
  /** The shot that was fired, if any. */
  shot?: ShotDef;
  /** True when the turn ended as a skip or a timeout. */
  skipped?: boolean;
  /** Ticks spent in the `active` phase. */
  ticksUsed?: number;
  items?: readonly ItemId[];
}

export function turnDelayCost(cost: TurnCost): number {
  let total = 0;
  if (cost.shot) total += shotDelay(cost.shot);
  if (cost.skipped) total += skipDelay();
  total += timeDelay(cost.ticksUsed ?? 0);
  total += itemDelay(cost.items ?? []);
  return total;
}

/** Add delay to a seat. Returns the seat's new total (0 when the seat does not exist). */
export function addDelay(state: MatchState, seat: number, amount: number): number {
  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    if (!slot || slot.seat !== seat) continue;
    slot.delay += amount;
    return slot.delay;
  }
  return 0;
}

/** Can this seat take a turn at all? Alive and connected (DESIGN §2.8, §6.4). */
export function canTakeTurn(state: MatchState, seat: number): boolean {
  const slot = seatSlot(state, seat);
  if (!slot || !slot.connected) return false;
  const m = mobileOfSeat(state, seat);
  return !!m && m.alive;
}

function seatSlot(state: MatchState, seat: number): PlayerSlot | undefined {
  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    if (slot && slot.seat === seat) return slot;
  }
  return undefined;
}

/**
 * The seat that goes next: lowest delay among the seats that can take a turn, ties
 * broken by seat index (DESIGN §7 item 4). Returns -1 when nobody can play, which is
 * the turn machine's signal that the match is over.
 *
 * Iteration is over the seat array in index order, never over object keys, so the
 * result is identical on every engine (DESIGN §2.1).
 */
export function nextSeat(state: MatchState): number {
  let best = -1;
  let bestDelay = 0;
  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    if (!slot) continue;
    if (!canTakeTurn(state, slot.seat)) continue;
    if (best === -1 || slot.delay < bestDelay) {
      best = slot.seat;
      bestDelay = slot.delay;
    }
  }
  return best;
}

/**
 * The next `n` seats in turn order, for the HUD's delay list (DESIGN §2.8: "the HUD
 * shows the next 4 players sorted by delay").
 *
 * This is the *current* standing, not a forecast: it sorts the eligible seats by
 * (delay, seat) and takes the first `n`. Only the first entry is a promise — the
 * others shift as soon as the seat ahead of them pays for its turn — which is exactly
 * what the list in the original games showed.
 */
export function upcomingOrder(state: MatchState, n: number): number[] {
  const eligible: PlayerSlot[] = [];
  for (let i = 0; i < state.seats.length; i++) {
    const slot = state.seats[i];
    if (slot && canTakeTurn(state, slot.seat)) eligible.push(slot);
  }
  // Insertion sort by (delay, seat): stable, allocation-free and identical everywhere.
  for (let i = 1; i < eligible.length; i++) {
    const item = eligible[i] as PlayerSlot;
    let j = i - 1;
    while (j >= 0) {
      const prev = eligible[j] as PlayerSlot;
      if (prev.delay < item.delay || (prev.delay === item.delay && prev.seat <= item.seat)) break;
      eligible[j + 1] = prev;
      j--;
    }
    eligible[j + 1] = item;
  }
  const out: number[] = [];
  const count = Math.min(n < 0 ? 0 : n, eligible.length);
  for (let i = 0; i < count; i++) out.push((eligible[i] as PlayerSlot).seat);
  return out;
}

/**
 * Is this seat's SS unlocked? `ssGauge` gains +1 per own completed turn and +1 per hit
 * taken and unlocks at `constants.ss.gaugeMax` (DESIGN §2.9, §7 item 1). The HUD draws
 * the gauge from the same two numbers.
 */
export function ssReady(slot: PlayerSlot): boolean {
  return slot.ssGauge >= constants.ss.gaugeMax;
}

/**
 * May this seat select or fire its SS right now? The gate (Phase 5, DESIGN §7 item 21)
 * refuses an SS below `gaugeMax`; using one resets the gauge to 0 (`match/reducer.ts`).
 *
 * It only binds a `turns` match. A `freePlay` one has no completed turns to earn the
 * gauge with, and the dev sandbox (DESIGN §7 items 14 and 74) exists exactly so that
 * every mobile's SS can be looked at — a gate there would lock away a third of the
 * roster's content with no way to unlock it.
 */
export function ssAvailable(state: MatchState, seat: number): boolean {
  if (!constants.ss.gateEnabled) return true;
  if (state.mode !== 'turns') return true;
  const slot = seatSlot(state, seat);
  return !!slot && ssReady(slot);
}
