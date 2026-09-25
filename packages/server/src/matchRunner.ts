/**
 * The authority (DESIGN §1.4, §6.3).
 *
 * One `MatchRunner` per running match. It owns a `MatchState` from `@gunbros/shared`,
 * drives it at the shared fixed timestep, validates every intent that arrives, and
 * broadcasts the *authoritative* version of each one so that every client's engine
 * applies the same intent in the same order. Clients send intents; they never send
 * numbers the server keeps.
 *
 * Two rules make the determinism contract work:
 *
 * 1. Everything a client needs to reproduce a shot is in the `fire` message — the
 *    shooter's position, facing and tilt, the clamped angle, the quantised power, the
 *    wind, the PRNG state *before* the shot, and the tick the server applied it on.
 * 2. The server broadcasts exactly what it applied, after it applied it. The capture
 *    happens before `applyIntent` (the PRNG moves), the broadcast after it succeeded,
 *    and nothing steps the simulation in between: the tick loop and the socket handlers
 *    are the same thread.
 *
 * `slot.connected` is deliberately never written here. It feeds `nextSeat`, it is not in
 * the state hash, and no client can know it — so a disconnect that flipped it would
 * desync every engine at once. A dropped player keeps their seat and their turns until
 * the grace period expires, and then forfeits (DESIGN §6.4, and the Assumptions entry).
 */
import {
  applyIntent,
  canUseItem,
  constants,
  createMatch,
  defOfSeat,
  encodeRle,
  getMapDef,
  isMobileImplemented,
  mobileOfSeat,
  quantisePower,
  randomMobileId,
  clamp,
  rollSkyEvent,
  ssAvailable,
  ssReady,
  slotOfSeat,
  snapshotForTurnEnd,
  step,
} from '@gunbros/shared';
import type {
  Prng,
  FireMsg,
  ItemRejection,
  ItemUsedMsg,
  MoveEchoMsg,
  MatchState,
  MobileId,
  MoveMsg,
  SeatInfo,
  SeatSpec,
  ShotSlot,
  SimEvent,
  SkyEventId,
  TeamId,
  TurnStartMsg,
  UseItemMsg,
} from '@gunbros/shared';
import { BotDriver } from './bot.js';
import { config } from './config.js';
import { log } from './log.js';
import { metrics } from './metrics.js';
import type { MatchRecord } from './metrics.js';
import type { Player } from './player.js';
import { NO_SEAT } from './player.js';
import type { Room } from './room.js';

/**
 * Resolve a lobby pick to a real mobile (DESIGN §6.1 `setMobile`, §7 item 10).
 *
 * A named pick is honoured as long as the id exists — the protocol guard has already
 * refused a `randomOnly` one (DESIGN §3: dragon and knight are Random-only). `random`
 * rolls over `randomWeight` across **every** definition including those two, which is
 * where their weight of 1 against everyone else's 10 gives them ~1.2 % each.
 *
 * The roll is one `nextFloat` from the *room's* PRNG (DESIGN §7 item 39), and the
 * weighting itself lives in shared data so a test can reproduce it exactly.
 */
export function resolveMobileChoice(choice: MobileId | 'random', rng: Prng): MobileId {
  if (choice !== 'random' && isMobileImplemented(choice)) return choice;
  return randomMobileId(rng.nextFloat());
}

export class MatchRunner {
  readonly room: Room;
  readonly state: MatchState;
  readonly seats: SeatInfo[];
  readonly seed: number;
  readonly skyEvent: SkyEventId;
  /** `SKY_EVENT` pinned the sky: no weather comes or goes this match (DESIGN §5). */
  readonly skyStatic: boolean;
  /** Wall clock at `matchStart`, for the admin portal. */
  readonly startedAt = Date.now();

  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTickAt = 0;
  private lastMoveEchoAt = 0;
  private running = false;
  private ended = false;
  /**
   * Why the *current* turn could end the match. A forfeit (grace expired, or the player
   * left the match on purpose) kills a mobile the same way a shell does, so the sim's
   * `matchEnd` event cannot tell the two apart — the runner remembers which it was, and
   * resets at every `turnStart` so a forfeit in turn 3 cannot label an elimination in
   * turn 9 (DESIGN §6.2 `matchEnd`).
   */
  private endCause: 'eliminated' | 'forfeit' = 'eliminated';
  /**
   * One driver per practice bot in the match (DESIGN §11). They act through the same
   * handlers a socket's intents reach, on the runner's own tick.
   */
  private readonly botDrivers: BotDriver[] = [];

  private constructor(
    room: Room,
    state: MatchState,
    seats: SeatInfo[],
    seed: number,
    skyEvent: SkyEventId,
  ) {
    this.room = room;
    this.state = state;
    this.seats = seats;
    this.seed = seed;
    this.skyEvent = skyEvent;
    this.skyStatic = state.skyStatic;
  }

  /**
   * Build the match from the room's lobby, tell everyone about it, and start the clock.
   * The seat order is the room's player order, and it is what `matchStart.players`
   * carries: every engine calls `createMatch(seed, map, seats, { mode: 'turns' })` with
   * the same arguments and gets byte-identical state (DESIGN §6.2).
   */
  static start(room: Room, seed: number): MatchRunner {
    const specs: SeatSpec[] = [];
    const seats: SeatInfo[] = [];
    for (let i = 0; i < room.players.length; i++) {
      const player = room.players[i];
      if (!player) continue;
      const mobileId = resolveMobileChoice(player.mobileId, room.rng);
      player.seat = seats.length;
      // The room's loadout travels with the seat (DESIGN §4): `createMatch` puts it on
      // `PlayerSlot.items` and `matchStart` carries it, so every engine agrees on what
      // each seat may spend.
      const items = player.items.slice();
      specs.push({ playerId: player.id, nick: player.nick, team: player.team, mobileId, items });
      const seat: SeatInfo = {
        seat: player.seat,
        playerId: player.id,
        nick: player.nick,
        team: player.team,
        mobileId,
        items,
      };
      // The one thing that tells a client this seat is a bot (DESIGN §7 item 186): the
      // HUD marks the name. The simulation never reads it.
      if (player.bot) seat.bot = { difficulty: player.bot.difficulty };
      seats.push(seat);
    }

    // Rolled off the room's stream, not the match's: the match PRNG has to be at
    // exactly the position `createMatch` leaves it at on every client. `SKY_EVENT`
    // pins it instead, which is how a test (and a local sky-event playtest) gets a
    // match whose numbers do not depend on a `node:crypto` seed — the roll is still
    // taken either way, so the room's stream advances the same.
    const rolled = rollSkyEvent(room.rng);
    const skyEvent = config.forcedSkyEvent ?? rolled;
    // A pinned sky also stays put: a test that pins `none` must not meet a tornado on
    // turn 5, and a `SKY_EVENT=tornado` playtest wants the tornado to stay.
    const skyStatic = config.forcedSkyEvent !== null;
    // Passed in rather than assigned afterwards: `createMatch` builds the tornado's
    // column and the Force band from it (DESIGN §5), and `matchStart` carries the same
    // id to every client so they build exactly the same sky.
    const state = createMatch(seed, getMapDef(room.mapId), specs, {
      mode: 'turns',
      skyEvent,
      skyStatic,
    });

    const runner = new MatchRunner(room, state, seats, seed, skyEvent);
    for (const player of room.players) {
      if (player.bot && player.seat !== NO_SEAT) runner.botDrivers.push(new BotDriver(runner, player));
    }
    room.broadcast({
      t: 'matchStart',
      seed,
      mapId: room.mapId,
      players: seats,
      skyEvent,
      skyStatic,
    });
    runner.resume();
    metrics.matchStarted();
    log.info(`room ${room.code}: match started, seed ${seed}, sky ${skyEvent}`);
    return runner;
  }

  // ------------------------------------------------------------------------
  // The clock
  // ------------------------------------------------------------------------

  private resume(): void {
    if (this.running) return;
    this.running = true;
    this.nextTickAt = Date.now() + config.tickMs;
    this.lastMoveEchoAt = 0;
    // Drift-corrected: the interval only wakes us up, the accumulator decides how many
    // ticks are owed. A late wake-up catches up (bounded), a very late one gives up on
    // the backlog rather than blocking the event loop with minutes of simulation.
    //
    // The wake-up is *finer* than a tick (`loopWakeMs`, 5 ms) on purpose. A timer set to
    // the tick period itself can only fire on a 17 ms grid, so a tick is processed up to
    // a whole tick late and the message it produces carries a tick number the client's
    // own clock has already passed — which is a desync at the next `turnEnd`
    // (DESIGN §7 item 45). Waking often and ticking on schedule keeps that lateness
    // inside a few milliseconds; an idle wake-up costs one comparison.
    this.timer = setInterval(() => this.pump(), Math.max(1, Math.round(config.loopWakeMs)));
  }

  /**
   * The timer callback. Everything it drives is wrapped: an exception thrown inside a
   * `setInterval` callback is an uncaught exception, and one bad tick in one room must
   * not take the process — and every other room — down with it. A match that throws is
   * ended as `abandoned` and the room goes back to the lobby.
   */
  private pump(): void {
    try {
      this.pumpOnce();
    } catch (err) {
      log.error(`room ${this.room.code}: match loop threw; ending the match`, err);
      this.abandon();
    }
  }

  private pumpOnce(): void {
    const now = Date.now();
    let caught = 0;
    while (this.running && now >= this.nextTickAt && caught < config.maxCatchUpTicks) {
      this.tickOnce();
      this.nextTickAt += config.tickMs;
      caught++;
    }
    if (this.running && now - this.nextTickAt > config.tickMs * config.maxCatchUpTicks) {
      log.warn(`room ${this.room.code}: match loop fell ${Math.round(now - this.nextTickAt)} ms behind`);
      this.nextTickAt = now + config.tickMs;
    }
    if (this.running) this.maybeMoveEcho(now);
  }

  /**
   * One simulation tick. The whole match runs at 60 Hz, including the long stretches
   * where a player is only aiming: the turn timer is a tick counter (DESIGN §7 item 17),
   * so a lazy loop would have to keep its own schedule for it anyway, and one armour
   * mobile costs microseconds per tick.
   */
  private tickOnce(): void {
    // The bots first: an intent a driver sends lands between two ticks, exactly where
    // one from a socket does, and carries the tick it was applied on (DESIGN §6.3).
    this.driveBots();
    if (this.ended) return;
    const events = step(this.state);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event) continue;
      this.onSimEvent(event);
      if (this.ended) return;
    }
  }

  /** Let the bot whose turn it is play (DESIGN §11). A no-op in a match of humans. */
  private driveBots(): void {
    if (this.botDrivers.length === 0) return;
    const now = Date.now();
    for (let i = 0; i < this.botDrivers.length; i++) {
      this.botDrivers[i]?.tick(now);
      if (this.ended) return;
    }
  }

  /** Is `player` played by a driver here? (The admin portal and tests ask.) */
  hasBot(player: Player): boolean {
    return this.botDrivers.some((d) => d.player === player);
  }

  private onSimEvent(event: SimEvent): void {
    switch (event.t) {
      case 'turnStart':
        this.endCause = 'eliminated';
        this.room.broadcast(this.turnStartMsg());
        break;
      case 'turnEnd': {
        // Quantise the authority too, then send: both sides land on the same q8 grid at
        // the same moment, which is what makes reconciliation converge (DESIGN §6.3.5).
        const snapshot = snapshotForTurnEnd(this.state);
        this.room.broadcast({ t: 'turnEnd', snapshot });
        break;
      }
      case 'matchEnd':
        this.room.broadcast({
          t: 'matchEnd',
          winnerTeam: event.winnerTeam,
          reason: this.endCause,
        });
        this.finish(this.endCause, event.winnerTeam);
        break;
      default:
        break;
    }
  }

  /** ~10 Hz position echo while a mobile is walking or falling (DESIGN §6.2). */
  private maybeMoveEcho(now: number): void {
    const interval = 1000 / Math.max(1, config.moveEchoHz);
    if (now - this.lastMoveEchoAt < interval) return;
    for (let i = 0; i < this.state.mobiles.length; i++) {
      const m = this.state.mobiles[i];
      if (!m || !m.alive) continue;
      if (m.moveDir === 0 && m.grounded) continue;
      this.lastMoveEchoAt = now;
      this.room.broadcast(this.moveEchoMsg(m.seat));
    }
  }

  // ------------------------------------------------------------------------
  // Message builders
  // ------------------------------------------------------------------------

  turnStartMsg(): TurnStartMsg {
    const state = this.state;
    const delays: number[] = [];
    const ready: boolean[] = [];
    for (let i = 0; i < state.seats.length; i++) {
      const slot = state.seats[i];
      delays.push(slot ? slot.delay : 0);
      ready.push(slot ? ssReady(slot) : false);
    }
    // Wall-clock deadline for the HUD only; the simulation counts ticks, and the two
    // are allowed to disagree by a frame (DESIGN §6.2 `turnStart`).
    let ticksToDeadline = 0;
    if (state.phase === 'starting') ticksToDeadline = state.turnTicksLeft + constants.turn.activeTicks;
    else if (state.phase === 'active') ticksToDeadline = state.turnTicksLeft;
    return {
      t: 'turnStart',
      seat: state.activeSeat,
      turn: state.turn,
      deadlineMs: Date.now() + ticksToDeadline * config.tickMs,
      wind: { strength: state.wind.strength, directionDeg: state.wind.directionDeg },
      delays,
      ssReady: ready,
    };
  }

  private moveEchoMsg(seat: number): MoveEchoMsg {
    const m = mobileOfSeat(this.state, seat);
    return {
      t: 'moveEcho',
      seat,
      dir: m ? m.moveDir : 0,
      x: m ? m.x : 0,
      y: m ? m.y : 0,
      facing: m ? m.facing : 1,
      gauge: m ? m.moveGauge : 0,
      tick: this.state.tick,
    };
  }

  /** Everything a returning or desynced client needs (DESIGN §6.4). */
  sendResync(player: Player): void {
    if (!player.conn) return;
    player.conn.send({
      t: 'resync',
      snapshot: snapshotForTurnEnd(this.state),
      width: this.state.terrain.width,
      height: this.state.terrain.height,
      rle: encodeRle(this.state.terrain),
      turn: turnStartPayload(this.turnStartMsg()),
    });
  }

  sendMatchStart(player: Player): void {
    player.conn?.send({
      t: 'matchStart',
      seed: this.seed,
      mapId: this.room.mapId,
      players: this.seats,
      skyEvent: this.skyEvent,
      skyStatic: this.skyStatic,
    });
  }

  sendTerrain(player: Player): void {
    player.conn?.send({
      t: 'terrainMask',
      width: this.state.terrain.width,
      height: this.state.terrain.height,
      rle: encodeRle(this.state.terrain),
    });
  }

  // ------------------------------------------------------------------------
  // Intents
  // ------------------------------------------------------------------------

  /** May this player act right now? Right seat, right phase, alive (DESIGN §7 item 25). */
  private canAct(player: Player): boolean {
    if (this.ended || player.seat === NO_SEAT) return false;
    if (this.state.phase !== 'active') return false;
    if (this.state.activeSeat !== player.seat) return false;
    const m = mobileOfSeat(this.state, player.seat);
    return !!m && m.alive;
  }

  onMove(player: Player, msg: MoveMsg): void {
    if (!this.canAct(player)) return;
    // Edge-triggered and ordered: a late duplicate of the key-up must not restart a walk.
    if (msg.seq <= player.lastMoveSeq) return;
    player.lastMoveSeq = msg.seq;
    applyIntent(this.state, { t: 'move', seat: player.seat, dir: msg.dir });
    this.room.broadcast(this.moveEchoMsg(player.seat));
  }

  onAim(player: Player, relAngle: number): void {
    if (!this.canAct(player)) return;
    const now = Date.now();
    if (now - player.lastAimAt < config.aimMinIntervalMs) return;
    player.lastAimAt = now;
    const def = defOfSeat(this.state, player.seat);
    if (!def) return;
    const clamped = clamp(relAngle, def.angleMin, def.angleMax);
    applyIntent(this.state, { t: 'aim', seat: player.seat, relAngle: clamped });
    const m = mobileOfSeat(this.state, player.seat);
    this.room.broadcast({
      t: 'aimEcho',
      seat: player.seat,
      relAngle: m ? m.relAngle : clamped,
      tick: this.state.tick,
    });
  }

  onSelectShot(player: Player, shot: ShotSlot): void {
    if (!this.canAct(player)) return;
    // The SS gate (DESIGN §2.9, §7 items 21 and 91). The simulation refuses the
    // selection on its own, silently, because a client replaying a stale message must
    // not throw; the server says *why* instead, so the HUD can explain the refusal
    // rather than leaving a button that appears to do nothing.
    if (shot === 'ss' && !ssAvailable(this.state, player.seat)) {
      player.conn?.sendError('ssNotReady', 'the SS gauge is not full yet');
      return;
    }
    // Every accepted selection is a broadcast to the whole room; a human presses Tab a
    // few times a turn, so a floor costs nothing and bounds what a script can do.
    const now = Date.now();
    if (now - player.lastShotSelectAt < config.shotSelectMinIntervalMs) return;
    player.lastShotSelectAt = now;
    applyIntent(this.state, { t: 'selectShot', seat: player.seat, shot });
    const slot = slotOfSeat(this.state, player.seat);
    this.room.broadcast({
      t: 'shotEcho',
      seat: player.seat,
      shot: slot ? slot.shot : shot,
      tick: this.state.tick,
    });
  }

  /**
   * The charge report, echoed to everyone (DESIGN §7 items 18 and 31). Without the echo
   * only the shooter's engine would fire on a timer expiry and every other engine would
   * skip, leave `active`, and then drop the authoritative `fire`.
   */
  onCharging(player: Player, power: number): void {
    if (!this.canAct(player)) return;
    const now = Date.now();
    // A stop report (negative power) is never throttled: it ends the charge.
    if (power >= 0 && now - player.lastChargeAt < config.chargeMinIntervalMs) return;
    player.lastChargeAt = now;
    applyIntent(this.state, { t: 'charging', seat: player.seat, power });
    this.room.broadcast({
      t: 'chargingEcho',
      seat: player.seat,
      power: this.state.chargingPower,
      tick: this.state.tick,
    });
  }

  /**
   * The authoritative fire (DESIGN §6.3 step 3). Captured before, applied, broadcast
   * after — and broadcast to *everyone including the shooter*, who has not fired
   * locally (DESIGN §7 item 12).
   */
  onFire(player: Player, msg: FireMsg): void {
    if (!this.canAct(player)) return;
    if (msg.seq <= player.lastFireSeq) return;
    const seat = player.seat;
    const m = mobileOfSeat(this.state, seat);
    const def = defOfSeat(this.state, seat);
    if (!m || !def || !def.shots[msg.shot]) return;
    // The same gate as `selectShot`, on the other route to a shot (DESIGN §7 item 91).
    // `performFire` refuses it too, so this only turns a silent no-op into a reason —
    // and it asks about the key that will actually be fired: a Dual+ turn fires S1
    // whatever was selected (§7 item 95), so refusing its `ss` here would refuse on the
    // button a shot the simulation fires on a timer expiry.
    const firstShot: ShotSlot = this.state.turnMods.dualPlus ? 's1' : msg.shot;
    if (firstShot === 'ss' && !ssAvailable(this.state, seat)) {
      player.conn?.sendError('ssNotReady', 'the SS gauge is not full yet');
      return;
    }

    const relAngle = clamp(msg.relAngle, def.angleMin, def.angleMax);
    const power = quantisePower(clamp(msg.power, 0, 1));
    // Captured *before* the shot: firing moves the PRNG and sets `relAngle`, and a
    // replay has to start from what the authority had, not from what it ended with.
    const shooter = { x: m.x, y: m.y, facing: m.facing, tilt: m.tilt };
    const rngState = this.state.rng.getState();
    const wind = { strength: this.state.wind.strength, directionDeg: this.state.wind.directionDeg };
    const tick = this.state.tick;
    // What the turn's items were, for a log or a label only. The modifiers themselves
    // are already in every engine's `turnMods`, put there by the `itemUsed` this
    // message cannot overtake (see `onUseItem`).
    const items = this.state.turnMods.usedThisTurn.slice();

    const events = applyIntent(this.state, { t: 'fire', seat, shot: msg.shot, relAngle, power });
    let fired = false;
    for (let i = 0; i < events.length; i++) if (events[i]?.t === 'fire') fired = true;
    if (!fired) return;

    player.lastFireSeq = msg.seq;
    this.room.broadcast({
      t: 'fire',
      seat,
      shot: msg.shot,
      relAngle,
      power,
      shooter,
      wind,
      rngState,
      items,
      tick,
    });
  }

  /**
   * The authoritative item use (DESIGN §4, §6.2 `itemUsed`). Same shape as `onFire`:
   * validate, capture, apply, broadcast to *everyone including the user*.
   *
   * **Order.** An item is a separate authoritative message, and it is always sent
   * before the `fire` it modifies — the server applies it the moment it arrives, the
   * broadcast leaves on the same turn of the event loop, and one WebSocket delivers in
   * order, so every engine has `turnMods.dual` (or `bunge`, or `powerUp`) set before it
   * applies the `fire`. That is why `FireBroadcastMsg` does not have to carry the
   * modifiers: by the time `performFire` runs on any engine, they are already in its
   * own state. The same ordering is what makes a heal or a teleport land whether or not
   * a shot follows it.
   *
   * The tick is captured *before* `applyIntent` because Wind Change draws from the
   * match PRNG, exactly as a shot does.
   */
  onUseItem(player: Player, msg: UseItemMsg): void {
    if (!this.canAct(player)) return;
    const seat = player.seat;
    // One gate, shared with every client (DESIGN §4): the server refuses here, and each
    // client's `applyUseItem` asks the same question again as it applies the broadcast,
    // so an item that reached one engine reached all of them.
    const check = canUseItem(this.state, seat, msg.itemId, msg.target);
    if (!check.ok) {
      player.conn?.sendError(itemErrorCode(check.reason), `${msg.itemId}: ${check.reason}`);
      return;
    }
    // Only an *accepted* use is throttled: a refusal broadcasts nothing, and the
    // per-socket token bucket already bounds how fast those can arrive. A throttled use
    // is answered like the validated refusals rather than dropped in silence, so the
    // player knows the press has to be repeated and nothing was spent.
    const now = Date.now();
    if (now - player.lastItemAt < config.itemMinIntervalMs) {
      player.conn?.sendError('itemTooFast', `${msg.itemId}: another item was used a moment ago`);
      return;
    }

    const tick = this.state.tick;
    const target = msg.target ? { x: msg.target.x, y: msg.target.y } : undefined;
    const events = applyIntent(this.state, { t: 'useItem', seat, itemId: msg.itemId, target });
    let used: Extract<SimEvent, { t: 'itemUsed' }> | null = null;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event && event.t === 'itemUsed') used = event;
    }
    // The simulation had the last word, exactly as it does for a shot: no event, no
    // broadcast, and nothing for any other engine to apply.
    if (!used) return;

    player.lastItemAt = now;
    // Built from the event the simulation emitted rather than from the request, so the
    // broadcast is exactly what the authority applied — a target on an item that has no
    // use for one is dropped here the same way the sim dropped it.
    const out: ItemUsedMsg = { t: 'itemUsed', seat, itemId: used.itemId, tick };
    if (used.target) out.target = { x: used.target.x, y: used.target.y };
    this.room.broadcast(out);
  }

  onSkip(player: Player): void {
    if (!this.canAct(player)) return;
    const tick = this.state.tick;
    applyIntent(this.state, { t: 'skip', seat: player.seat });
    // `skip` is the `fire` message's twin: without a broadcast the other engines would
    // sit on the turn timer for the remaining seconds and only agree again at `turnEnd`.
    if (this.state.phase !== 'active') {
      this.room.broadcast({ t: 'skipEcho', seat: player.seat, tick });
    }
  }

  onRequestTerrain(player: Player): void {
    const now = Date.now();
    if (now - player.lastTerrainRequestAt < config.terrainRequestMinIntervalMs) return;
    player.lastTerrainRequestAt = now;
    this.sendTerrain(player);
  }

  /**
   * The grace period ran out (DESIGN §6.4). The mobile dies where it stands, on every
   * engine, from one broadcast intent — no special "this seat is gone" state that
   * clients would have to guess at.
   */
  forfeit(seat: number): void {
    if (this.ended || seat === NO_SEAT) return;
    const m = mobileOfSeat(this.state, seat);
    if (!m || !m.alive) return;
    const tick = this.state.tick;
    this.endCause = 'forfeit';
    applyIntent(this.state, { t: 'forfeit', seat });
    this.room.broadcast({ t: 'playerForfeit', seat, tick });
    log.info(`room ${this.room.code}: seat ${seat} forfeited`);
  }

  // ------------------------------------------------------------------------
  // Shutdown
  // ------------------------------------------------------------------------

  /**
   * Run `fn` (an intent handler, a forfeit) so that a throw ends this match as
   * abandoned instead of leaving the authority half-updated and every client quietly
   * desynced from it.
   */
  guard(what: string, fn: () => void): void {
    if (this.ended) return;
    try {
      fn();
    } catch (err) {
      log.error(`room ${this.room.code}: ${what} threw; ending the match`, err);
      this.abandon();
    }
  }

  /**
   * The simulation itself failed (see `pump`). There is no winner to announce and no
   * state anyone can trust, so the match is closed as `abandoned` and the room goes
   * back to the lobby, where the two of them can simply start another one.
   */
  private abandon(): void {
    if (this.ended) return;
    this.room.broadcast({ t: 'matchEnd', winnerTeam: null, reason: 'abandoned' });
    this.finish('abandoned', null);
  }

  /** The match ended on its own terms: stop the clock and hand the room back. */
  private finish(reason: MatchRecord['reason'], winnerTeam: TeamId | null): void {
    if (this.ended) return;
    this.record(reason, winnerTeam);
    this.ended = true;
    this.stop();
    this.room.onMatchEnded();
  }

  /** Stop the clock without telling the room (used when the room itself is going away). */
  stop(): void {
    if (!this.ended) {
      this.ended = true;
      this.record('closed', null);
    }
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One line in the admin portal's recent matches (metrics.ts). */
  private record(reason: MatchRecord['reason'], winnerTeam: TeamId | null): void {
    metrics.matchEnded({
      room: this.room.code,
      mapId: this.room.mapId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      turns: this.state.turn,
      players: this.seats.map((s) => ({
        nick: s.nick,
        team: s.team,
        mobileId: s.mobileId,
        ...(s.bot ? { bot: s.bot.difficulty } : {}),
      })),
      winnerTeam,
      reason,
    });
  }
}

/**
 * The wire error code for a refused item (DESIGN §6.2 `error`).
 *
 * The simulation's `ItemRejection` is finer than the protocol needs — five of its
 * eleven values are all "that point will not do" — so the codes stay coarse and the
 * message carries the exact reason, which is what a HUD wanting to explain the refusal
 * reads.
 */
function itemErrorCode(reason: ItemRejection): string {
  switch (reason) {
    case 'unknownItem':
      return 'badItem';
    case 'notInLoadout':
      return 'itemNotOwned';
    case 'alreadySpent':
      return 'itemAlreadyUsed';
    case 'oneItemPerTurn':
      return 'itemThisTurn';
    case 'notYourTurn':
      return 'notYourTurn';
    case 'deadMobile':
      return 'deadMobile';
    default:
      // targetRequired, targetOutsideMap, targetNotAir, targetNoGround, targetOccupied.
      return 'badTarget';
  }
}

function turnStartPayload(msg: TurnStartMsg): Omit<TurnStartMsg, 't'> {
  return {
    seat: msg.seat,
    turn: msg.turn,
    deadlineMs: msg.deadlineMs,
    wind: msg.wind,
    delays: msg.delays,
    ssReady: msg.ssReady,
  };
}
