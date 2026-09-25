/**
 * The turn state machine (DESIGN §2.9).
 *
 * ```
 *          starting (0.5 s)        the turn banner; no input
 *              |
 *          active (20 s)           move / aim / select / charge / fire / skip
 *              |                   timer expiry = skip, or fire at the charged power
 *          resolving               until isSettled(state)
 *              |                   delay banked, wind schedule, weather, turn counter
 *          ending (0.75 s)         the pause before the next seat is picked
 *              |
 *          starting …              or `ended` when only one team is left standing
 * ```
 *
 * Every duration is a tick count from `data/constants.ts`: the simulation has no clock
 * (DESIGN §2.1), so the timer is literally a counter this module decrements once per
 * `step()`.
 *
 * This module never spawns a projectile. The one thing it cannot do itself — firing the
 * shot of a player whose timer ran out mid-charge (DESIGN §7 item 3) — it asks the
 * reducer to do through {@link TurnHooks}, which keeps `fireShot` in one place and this
 * file free of the projectile machinery.
 */
import { constants } from '../data/constants.js';
import { getMobileDef } from '../data/mobiles.js';
import type { ShotDef } from '../data/mobiles.js';
import { setMoveDir } from '../entities/mobile.js';
import type { SimEvent } from '../match/events.js';
import type { MatchState } from '../match/match.js';
import { isSettled, livingTeams, mobileOfSeat, noTurnMods, slotOfSeat } from '../match/match.js';
import { generateWind, windChangesOnTurn } from './wind.js';
import { nextSeat, turnDelayCost } from './delay.js';
import { suddenDeathLevel, suddenDeathMultiplierForLevel } from './suddenDeath.js';
import { advanceWeather } from './sky.js';
import type { BehaviourContext } from '../entities/behaviours/registry.js';

/** What the machine needs the reducer to do for it. */
export interface TurnHooks {
  /**
   * Fire `seat`'s currently selected shot at `power`, exactly as a `fire` intent would.
   * Returns false when there is nothing to fire (dead mobile, unknown shot), in which
   * case the machine falls back to a skip rather than hanging on a dead timer.
   */
  fire(seat: number, power: number): boolean;
  /**
   * This tick's behaviour context, so that a registered {@link TurnHook} can carve,
   * damage, spawn and emit exactly as a behaviour does. Built once per `step()` by the
   * reducer.
   */
  ctx: BehaviourContext;
}

// --------------------------------------------------------------------------
// Turn hooks — the extension point for anything that happens per turn
// --------------------------------------------------------------------------

/**
 * A per-turn callback registered by a module that owns cross-turn state: mines walk on
 * one (DESIGN §3, §7 item 8), and Phase 5's items and Phase 6's sky events can too.
 * Hooks run in **sorted key order**, never in registration or insertion order, so two
 * engines that loaded their modules in a different order still agree (DESIGN §2.1).
 *
 * `onTurnStart` runs inside `beginTurn`, after the next seat has been chosen and its
 * gauge, shield and debuff decay applied, just before the `turnStart` event.
 * `onTurnEnd` runs inside `finishTurn`, after the delay has been banked and the
 * `turnEnd` event emitted, before the wind reroll and the match-end check.
 */
export interface TurnHook {
  onTurnStart?(state: MatchState, ctx: BehaviourContext): void;
  onTurnEnd?(state: MatchState, ctx: BehaviourContext): void;
}

const turnHooks = new Map<string, TurnHook>();

/** Register (or replace) the turn hook stored under `key`. */
export function registerTurnHook(key: string, hook: TurnHook): void {
  turnHooks.set(key, hook);
}

/** The registered hook keys, sorted — which is the order they run in. */
export function turnHookKeys(): string[] {
  return [...turnHooks.keys()].sort();
}

function runTurnHooks(
  phase: 'onTurnStart' | 'onTurnEnd',
  state: MatchState,
  ctx: BehaviourContext | undefined,
): void {
  if (!ctx || turnHooks.size === 0) return;
  const keys = turnHookKeys();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === undefined) continue;
    const hook = turnHooks.get(key);
    if (!hook) continue;
    const fn = phase === 'onTurnStart' ? hook.onTurnStart : hook.onTurnEnd;
    if (fn) fn(state, ctx);
  }
}

/** `chargingPower` when the active client is not charging. */
export const NOT_CHARGING = -1;

/** Put a fresh `turns` match at the gate. The first `step()` begins turn 1. */
export function initTurnState(state: MatchState): void {
  if (state.mode !== 'turns') return;
  state.phase = 'starting';
  state.turnTicksLeft = constants.turn.startingTicks;
  state.turn = 0;
  state.completedTurns = 0;
  state.pendingDelay = 0;
  state.turnMods = noTurnMods();
  state.chargingPower = NOT_CHARGING;
  // Seat order is by delay, so an all-zero table starts at seat 0 (DESIGN §2.8).
  const first = nextSeat(state);
  state.activeSeat = first === -1 ? 0 : first;
}

/**
 * May this seat's intent be applied right now? Free play accepts everything (the
 * Phase 1 sandbox drives both mobiles); a turn match accepts only the active seat, and
 * only while the turn is `active`.
 */
export function turnAcceptsIntent(state: MatchState, seat: number): boolean {
  if (state.mode !== 'turns') return true;
  return state.phase === 'active' && seat === state.activeSeat;
}

/** Ticks the active seat has spent on this turn so far. */
export function ticksUsed(state: MatchState): number {
  const used = state.tick - state.turnStartTick;
  return used > 0 ? used : 0;
}

/**
 * The active seat fired: bank what the turn costs and hand over to `resolving`.
 * Called by the reducer right after the projectiles are in the air.
 */
export function noteShotFired(state: MatchState, shot: ShotDef): void {
  if (state.mode !== 'turns' || state.phase !== 'active') return;
  endActive(state, turnDelayCost({ shot, ticksUsed: ticksUsed(state) }));
}

/** The active seat skipped (or its timer ran out with nothing charged). */
export function noteSkip(state: MatchState): void {
  if (state.mode !== 'turns' || state.phase !== 'active') return;
  endActive(state, turnDelayCost({ skipped: true, ticksUsed: ticksUsed(state) }));
}

/**
 * Every route out of `active` goes through here — a fired shot, a skip, a timeout, the
 * active mobile dying — so this is the one place that has to stop the walk. `resolving`
 * takes no input (DESIGN §2.9), and a mobile still holding a direction would otherwise
 * keep walking through `resolving` and the whole `ending` pause on the gauge it has
 * left, until `beginTurn` finally zeroed it.
 */
function endActive(state: MatchState, cost: number): void {
  const m = mobileOfSeat(state, state.activeSeat);
  if (m) setMoveDir(m, 0);
  state.pendingDelay += cost;
  state.chargingPower = NOT_CHARGING;
  state.phase = 'resolving';
  // Counted down as a watchdog: a shot that never settles must not freeze the match.
  state.turnTicksLeft = constants.turn.maxResolvingTicks;
}

/**
 * The active mobile died during its own turn — it walked off a ledge and fell out of
 * the world (DESIGN §2.4). `applyIntent` drops every intent from a dead mobile, so
 * nobody can skip and the turn would otherwise sit on the full 20 s timer with a corpse
 * in the chair. It costs no delay: a dead seat never takes another turn, so its delay
 * is meaningless (DESIGN §7 item 33), and `finishTurn` ends the match or hands over on
 * the next tick.
 */
function endActiveOnDeath(state: MatchState): void {
  endActive(state, 0);
}

/**
 * Only one team is left standing, outside any shot: an opponent forfeited, or a mine
 * went off at turn start. Match end is only looked at between turns, so without this
 * the winner would sit out the rest of the 20 s timer first. The turn closes like a
 * death in the chair (no delay) and `finishTurn` ends the match on the next tick.
 */
function decided(state: MatchState): boolean {
  return livingTeams(state).length <= 1;
}

/** One tick of the turn machine. Called by `step()` after the entities have moved. */
export function stepTurn(state: MatchState, events: SimEvent[], hooks: TurnHooks): void {
  if (state.mode !== 'turns') return;

  switch (state.phase) {
    case 'starting': {
      // Turn 0 is the gate `initTurnState` left the match at: begin the first turn.
      if (state.turn === 0) {
        beginTurn(state, events, hooks);
        return;
      }
      if (decided(state)) {
        endActiveOnDeath(state);
        return;
      }
      state.turnTicksLeft--;
      if (state.turnTicksLeft <= 0) {
        state.phase = 'active';
        state.turnTicksLeft = constants.turn.activeTicks;
        state.turnStartTick = state.tick;
      }
      return;
    }
    case 'active': {
      const active = mobileOfSeat(state, state.activeSeat);
      if (!active || !active.alive || decided(state)) {
        endActiveOnDeath(state);
        return;
      }
      state.turnTicksLeft--;
      if (state.turnTicksLeft === constants.turn.warningTicks) {
        events.push({
          t: 'timerWarning',
          seat: state.activeSeat,
          secondsLeft: constants.turn.warningSeconds,
        });
      }
      if (state.turnTicksLeft <= 0) onTimerExpired(state, hooks);
      return;
    }
    case 'resolving': {
      state.turnTicksLeft--;
      if (isSettled(state)) {
        finishTurn(state, events, hooks);
      } else if (state.turnTicksLeft <= 0) {
        // The watchdog fired: something in flight never settled. Clear it here, or the
        // same stuck entity keeps `isSettled` false and every following turn also burns
        // the full `maxResolvingTicks` (DESIGN §7 items 17 and 34).
        cullUnsettled(state, events);
        finishTurn(state, events, hooks);
      }
      return;
    }
    case 'ending': {
      state.turnTicksLeft--;
      if (state.turnTicksLeft <= 0) beginTurn(state, events, hooks);
      return;
    }
    case 'ended':
      return;
  }
}

/**
 * Timer expiry (DESIGN §2.9, §7 item 3): a skip, unless the client told us it was
 * charging — then the shot goes off at the power it last reported, which is why the
 * `charging` intent exists at all.
 */
function onTimerExpired(state: MatchState, hooks: TurnHooks): void {
  const power = state.chargingPower;
  if (power >= 0) {
    const fired = hooks.fire(state.activeSeat, power);
    // `fire` runs `noteShotFired`, which moves us to `resolving`. If it could not
    // (dead mobile, unknown shot) the turn still has to end: skip it.
    if (fired && state.phase !== 'active') return;
  }
  noteSkip(state);
}

/**
 * Empty everything the turn was waiting on. Only the watchdog calls this: a turn that
 * resolves normally has nothing left to clear. Cross-turn entities (mines, DESIGN §3)
 * must never live in `turnEffects`, precisely because this drops them.
 */
function cullUnsettled(state: MatchState, events: SimEvent[]): void {
  for (let i = 0; i < state.projectiles.length; i++) {
    const p = state.projectiles[i];
    if (!p || !p.alive) continue;
    p.alive = false;
    events.push({
      t: 'projectileExpire',
      id: p.id,
      ownerSeat: p.ownerSeat,
      x: p.x,
      y: p.y,
      reason: 'lifetime',
    });
  }
  state.projectiles = [];
  state.pendingSpawns = [];
  state.turnEffects = [];
}

/** Delay table in seat order, for the `turnEnd` event and the HUD. */
function delayTable(state: MatchState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.seats.length; i++) out.push(state.seats[i]?.delay ?? 0);
  return out;
}

/**
 * The shot has settled. Bank the delay, advance the counters, roll the wind on
 * schedule, and either end the match or move to the `ending` pause.
 */
function finishTurn(state: MatchState, events: SimEvent[], hooks: TurnHooks): void {
  const seat = state.activeSeat;
  const slot = slotOfSeat(state, seat);
  const cost = state.pendingDelay;
  if (slot) {
    slot.delay += cost;
    // The SS gauge earns its +1 for the completed turn (DESIGN §2.9, §7 item 1).
    // `performFire` is what spends it, at the trigger, so a turn that fired an SS both
    // zeroes the gauge and then earns this +1 towards the next one (§7 item 103).
    slot.ssGauge += constants.ss.gainPerOwnTurn;
  }
  state.pendingDelay = 0;
  state.chargingPower = NOT_CHARGING;
  // Items are applied to the current turn only (DESIGN §4): the Dual flag, the Bunge
  // and Power Up multipliers and the one-item-per-turn latch all stop here. The spent
  // items themselves stay spent — they are on the seat, not on the turn.
  const levelBefore = suddenDeathLevel(state.completedTurns);
  state.turnMods = noTurnMods();
  state.completedTurns++;

  events.push({ t: 'turnEnd', seat, delays: delayTable(state), cost });
  runTurnHooks('onTurnEnd', state, hooks.ctx);

  // Sudden death is a pure function of `completedTurns` (DESIGN §2.9, §7 item 11), so
  // nothing is stored; the event is announced the one turn the level changes on, which
  // is the only thing a banner needs.
  const level = suddenDeathLevel(state.completedTurns);
  if (level > levelBefore) {
    events.push({
      t: 'suddenDeath',
      level,
      multiplier: suddenDeathMultiplierForLevel(level),
      completedTurns: state.completedTurns,
    });
  }

  // Wind changes every `wind.changeEveryTurns` completed turns (DESIGN §2.7, §7 item 6).
  if (windChangesOnTurn(state.completedTurns)) {
    state.wind = generateWind(state.rng);
    events.push({
      t: 'windChange',
      strength: state.wind.strength,
      directionDeg: state.wind.directionDeg,
    });
  }

  // Weather comes and goes (DESIGN §5): the event up counts down a turn, or a clear
  // sky rolls for a new one. After the wind, so the wind's draws are where they were.
  advanceWeather(state, events);

  const teams = livingTeams(state);
  if (teams.length <= 1) {
    endMatch(state, events, teams[0] ?? null);
    return;
  }

  state.phase = 'ending';
  state.turnTicksLeft = constants.turn.endingTicks;
}

/**
 * Pick the next seat and open its turn: the move gauge refills here and only here
 * (DESIGN §2.4 — there is no per-tick refill in `turns` mode), and a shielded mobile
 * regenerates at the start of *its own* turn (DESIGN §7 item 7).
 */
function beginTurn(state: MatchState, events: SimEvent[], hooks: TurnHooks): void {
  const previous = mobileOfSeat(state, state.activeSeat);
  if (previous) setMoveDir(previous, 0);

  const teams = livingTeams(state);
  if (teams.length <= 1) {
    endMatch(state, events, teams[0] ?? null);
    return;
  }

  const seat = nextSeat(state);
  if (seat === -1) {
    // Both teams are still alive but nobody is `connected` right now. That is a lull,
    // not a result: hold in `ending` and look again in another `endingTicks`, so a
    // simultaneous blip at a turn boundary cannot kill a match that both players are
    // about to rejoin (DESIGN §6.4, §7 item 30).
    state.phase = 'ending';
    state.turnTicksLeft = constants.turn.endingTicks;
    return;
  }

  state.activeSeat = seat;
  state.turn++;
  state.pendingDelay = 0;
  // Belt and braces: `finishTurn` already cleared these, but a turn can also open
  // straight out of `initTurnState` or after a lull (§7 item 30) that never finished one.
  state.turnMods = noTurnMods();
  state.chargingPower = NOT_CHARGING;

  const m = mobileOfSeat(state, seat);
  if (m) {
    const def = getMobileDef(m.defId);
    m.moveGauge = def.moveGauge;
    setMoveDir(m, 0);
    if (def.shieldMax > 0 && def.shieldRegen > 0) {
      m.shield = Math.min(def.shieldMax, m.shield + def.shieldRegen);
    }
    // The stacking defence debuff (ice, DESIGN §2.6) thaws at the start of the
    // *victim's* own turn, by `constants.debuff.decayPerTurn`, never below zero.
    if (m.defenceMod > 0) {
      m.defenceMod = Math.max(0, m.defenceMod - constants.debuff.decayPerTurn);
    }
  }

  // Anything that happens per turn and is not the turn machine's own business —
  // mines walking (DESIGN §7 item 8), and later items and sky events.
  runTurnHooks('onTurnStart', state, hooks.ctx);

  state.phase = 'starting';
  state.turnTicksLeft = constants.turn.startingTicks;
  events.push({ t: 'turnStart', seat, turn: state.turn });
}

function endMatch(state: MatchState, events: SimEvent[], winner: MatchState['winnerTeam']): void {
  state.phase = 'ended';
  state.turnTicksLeft = 0;
  state.winnerTeam = winner;
  events.push({
    t: 'matchEnd',
    winnerTeam: winner,
    completedTurns: state.completedTurns,
  });
}

/** Seconds left on the turn timer, for the HUD. 0 outside `active`. */
export function secondsLeft(state: MatchState): number {
  if (state.phase !== 'active') return 0;
  return Math.max(0, Math.ceil(state.turnTicksLeft / constants.tickRate));
}
