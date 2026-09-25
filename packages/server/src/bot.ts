/**
 * Practice bots on the server (DESIGN §11, §7 items 186-190).
 *
 * A bot is a {@link Player} with `bot` set and no socket. The room seats it like anybody;
 * the match runner builds it a {@link BotDriver}, and the driver plays its turns through
 * the runner's own intent handlers — `onMove`, `onAim`, `onSelectShot`, `onCharging`,
 * `onFire` — so every validation, every throttle and every broadcast is the one a human's
 * intent gets. Nothing here writes the match state, and nothing here draws from the
 * match PRNG: the search runs on a private copy (`planShot`), and the deliberate misses
 * come from the bot's own generator.
 *
 * One turn, as a human would play it (§7 item 190):
 *
 *   think      the search runs, `bots.budgetMsPerTick` of wall clock per server tick,
 *              for the difficulty's think time; then the best shot so far is chosen
 *   walk       if the shot is from somewhere else: `move dir`, exactly the number of
 *              ticks the plan simulated, `move 0` — so the live mobile stops where the
 *              plan's copy did; then wait for it to land and settle
 *   re-aim     after a walk only: a quick refine from the live state, in case the live
 *              walk ended a pixel or two from the copy's
 *   turn       if the shot faces the other way, a `move` pair on one tick (no step in
 *              between, so the mobile turns without walking)
 *   aim        the barrel sweeps to the angle in `aimSteps` `aim`s
 *   select     `selectShot` when the shot is not the one already selected
 *   charge     the bar rises at the human rate, reported through `charging`
 *   fire       `fire` with the next sequence number
 *
 * A turn can end under the bot at any step — the timer, a forfeit, the match itself —
 * and every tick starts by asking whether the turn it was playing is still the one
 * running; if not, it drops what it was doing and waits for its next one.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  Prng,
  bots,
  chooseShot,
  clamp,
  constants,
  defOfSeat,
  fallbackShot,
  mobileOfSeat,
  planShot,
  quantisePower,
  refineShot,
  slotOfSeat,
} from '@gunbros/shared';
import type { BotDifficulty, BotDifficultyDef, BotPlan, BotShot, PlayerId, TeamId } from '@gunbros/shared';
import { config } from './config.js';
import { log } from './log.js';
import type { MatchRunner } from './matchRunner.js';
import { NO_SEAT, createPlayer } from './player.js';
import type { Player } from './player.js';

/**
 * A new bot for a room: always ready, a Random mobile until the host picks one, an empty
 * loadout (§7 item 190: it does not use items in v1). `taken` are the nicks already in
 * the room, so the name is unique there (§7 item 191).
 */
export function createBot(team: TeamId, difficulty: BotDifficulty, taken: readonly string[]): Player {
  const id: PlayerId = `bot-${randomBytes(5).toString('hex')}`;
  const player = createPlayer(id, '', botNick(taken));
  player.bot = { difficulty };
  player.team = team;
  player.ready = true;
  return player;
}

function botNick(taken: readonly string[]): string {
  const names = bots.names;
  for (const name of names) if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    for (const name of names) {
      const numbered = `${name} ${n}`;
      if (!taken.includes(numbered)) return numbered;
    }
  }
}

type Stage = 'idle' | 'think' | 'walk' | 'arrive' | 'reaim' | 'aim' | 'charge' | 'done';

/** Seconds scaled by `BOT_TIME_SCALE` (tests and the e2e run bots faster), in ms. */
function ms(seconds: number): number {
  return seconds * 1000 * config.botTimeScale;
}

/**
 * Plays one bot's turns in one match. The runner calls {@link tick} on every simulation
 * tick, before `step()`, exactly where an intent from a socket would land.
 */
export class BotDriver {
  readonly player: Player;
  private readonly runner: MatchRunner;
  /** The bot's own stream: think times and the deliberate misses. Never the match's. */
  private readonly rng: Prng;

  private stage: Stage = 'idle';
  /** The turn number this driver is playing, or 0. */
  private turn = 0;
  private plan: Generator<BotPlan, BotPlan, void> | null = null;
  private best: BotPlan | null = null;
  private thinkUntil = 0;
  private shot: BotShot | null = null;
  /** Aim sweep: the angles still to send, and when the next may go. */
  private sweep: number[] = [];
  private nextAt = 0;
  private chargeStartAt = 0;
  /** The walk under way: the tick `move dir` went in on, and where the hull stood. */
  private walkStartTick = 0;
  private walkStartY = 0;
  private arriveTick = 0;
  private fireSeq = 0;
  private moveSeq = 0;

  constructor(runner: MatchRunner, player: Player, seed: number = randomInt(0, 0xffffffff)) {
    this.runner = runner;
    this.player = player;
    this.rng = Prng.seed(seed);
  }

  private get difficulty(): BotDifficultyDef {
    return bots.difficulties[this.player.bot?.difficulty ?? bots.defaultDifficulty];
  }

  /**
   * One server tick. A search that throws is logged and the bot fires its fallback
   * shot; a throw from a runner handler is the runner's to catch, exactly as it is for
   * a socket's intent (it ends the match as abandoned).
   */
  tick(now: number): void {
    const state = this.runner.state;
    const seat = this.player.seat;
    const mine = seat !== NO_SEAT && state.phase === 'active' && state.activeSeat === seat;
    if (!mine) {
      // Not our turn, or not any more: the timer, a forfeit or the match ended it. The
      // runner refuses stale intents anyway; this just stops us sending them.
      if (this.stage !== 'idle' && this.turn !== state.turn) this.reset();
      else if (this.stage !== 'idle' && state.phase !== 'active') this.reset();
      return;
    }
    if (this.turn !== state.turn) this.begin(now);

    switch (this.stage) {
      case 'think':
        this.think(now);
        return;
      case 'walk':
        this.walk();
        return;
      case 'arrive':
        this.arrive();
        return;
      case 'reaim':
        this.reaim();
        return;
      case 'aim':
        this.aim(now);
        return;
      case 'charge':
        this.charge(now);
        return;
      default:
        return;
    }
  }

  private reset(): void {
    this.stage = 'idle';
    this.turn = 0;
    this.plan = null;
    this.best = null;
    this.shot = null;
    this.sweep = [];
  }

  private begin(now: number): void {
    const state = this.runner.state;
    this.reset();
    this.turn = state.turn;
    this.stage = 'think';
    const [lo, hi] = this.difficulty.thinkSeconds;
    this.thinkUntil = now + ms(lo + (hi - lo) * this.rng.nextFloat());
    try {
      this.plan = planShot(state, this.player.seat, {
        useSs: this.difficulty.useSs,
        walk: this.difficulty.walk,
      });
    } catch (err) {
      log.warn(`room ${this.runner.room.code}: bot ${this.player.nick} could not plan`, err);
      this.plan = null;
    }
  }

  /** Run the current search for one tick's budget; drop it when it ends or throws. */
  private search(): void {
    if (!this.plan) return;
    const started = performance.now();
    try {
      while (performance.now() - started < bots.budgetMsPerTick) {
        const next = this.plan.next();
        this.best = next.value;
        if (next.done) {
          this.plan = null;
          break;
        }
      }
    } catch (err) {
      log.warn(`room ${this.runner.room.code}: bot ${this.player.nick}'s plan threw`, err);
      this.plan = null;
    }
  }

  /** Ms of turn timer left, from the simulation's own tick counter. */
  private msLeft(): number {
    return this.runner.state.turnTicksLeft * config.tickMs;
  }

  /** Search inside the tick budget; when thinking is over, decide and start aiming. */
  private think(now: number): void {
    this.search();
    // Out of think time: fire the best found so far, finished or not (§7 item 189). A
    // turn running short — a slow machine, a plan begun late — decides early, keeping
    // `reserveSeconds` of the real turn timer in hand to aim, charge and fire.
    const late = this.msLeft() < 1000 * bots.pacing.reserveSeconds;
    if (now < this.thinkUntil && !late) return;
    this.decide();
  }

  private decide(): void {
    const state = this.runner.state;
    const seat = this.player.seat;
    const def = defOfSeat(state, seat);
    // A walk has to leave the reserve intact once it has been walked and has landed
    // (§7 item 190); otherwise the best shot from here it is.
    const walkRoom = this.msLeft() - 1000 * bots.pacing.reserveSeconds;
    let shot: BotShot | null = null;
    if (this.best && def) {
      shot = chooseShot(this.best, this.difficulty, this.rng, def, { allowWalk: true });
      if (shot?.walk && (shot.walk.ticks + bots.pacing.arriveMaxTicks) * config.tickMs > walkRoom) {
        shot = chooseShot(this.best, this.difficulty, this.rng, def, { allowWalk: false });
      }
    }
    if (!shot) shot = fallbackShot(state, seat);
    this.shot = shot;
    this.plan = null;
    this.best = null;

    const m = mobileOfSeat(state, seat);
    if (shot.walk && m) {
      // Walk first. The echo of this edge carries the tick it went in on, and every
      // engine walks from it in lockstep, exactly as for a human's arrow key.
      this.runner.onMove(this.player, { t: 'move', dir: shot.walk.dir, seq: this.nextMoveSeq() });
      this.walkStartTick = state.tick;
      this.walkStartY = m.y;
      this.stage = 'walk';
      return;
    }
    this.startAim(shot);
  }

  /**
   * Count the walk's ticks on the live runner and stop on exactly the tick the plan's
   * copy stopped on. A gauge that runs out or a wall in the way stops the mobile by
   * itself (the simulation's rule, the same on every engine); a hull that starts to
   * fall — which the plan said it would not — is stopped at once.
   */
  private walk(): void {
    const state = this.runner.state;
    const shot = this.shot;
    const m = mobileOfSeat(state, this.player.seat);
    if (!shot?.walk || !m) {
      this.reset();
      return;
    }
    const falling = !m.grounded && m.y - this.walkStartY > bots.walk.maxDropPx;
    if (state.tick - this.walkStartTick < shot.walk.ticks && !falling) return;
    this.runner.onMove(this.player, { t: 'move', dir: 0, seq: this.nextMoveSeq() });
    this.arriveTick = state.tick;
    this.stage = 'arrive';
  }

  /** Let the hull land and its tilt settle, as the plan's copy did, then re-aim. */
  private arrive(): void {
    const state = this.runner.state;
    const shot = this.shot;
    const m = mobileOfSeat(state, this.player.seat);
    if (!shot || !m) {
      this.reset();
      return;
    }
    const waited = state.tick - this.arriveTick;
    const settled = m.grounded && waited >= bots.walk.settleTicks;
    if (!settled && waited < bots.pacing.arriveMaxTicks) return;
    try {
      this.plan = refineShot(state, this.player.seat, {
        facing: shot.facing,
        shot: shot.shot,
        relAngle: shot.relAngle,
        power: shot.power,
      });
    } catch (err) {
      log.warn(`room ${this.runner.room.code}: bot ${this.player.nick} could not re-aim`, err);
      this.plan = null;
    }
    this.best = null;
    this.stage = 'reaim';
  }

  /** The quick refine from where the walk really ended; then aim as usual. */
  private reaim(): void {
    const state = this.runner.state;
    const shot = this.shot;
    if (!shot) {
      this.reset();
      return;
    }
    this.search();
    const late = this.msLeft() < 1000 * bots.pacing.reserveSeconds;
    if (this.plan && !late) return;
    const def = defOfSeat(state, this.player.seat);
    const refined =
      this.best && def ? chooseShot(this.best, this.difficulty, this.rng, def, { allowWalk: false }) : null;
    this.plan = null;
    this.best = null;
    this.startAim(refined ?? { ...shot, walk: null });
  }

  /** Face the shot's way if need be, then sweep the barrel towards it. */
  private startAim(shot: BotShot): void {
    const state = this.runner.state;
    this.shot = shot;
    const m = mobileOfSeat(state, this.player.seat);
    if (m && m.facing !== shot.facing) {
      // Turn round without walking: both edges on one tick, nothing steps in between.
      this.runner.onMove(this.player, { t: 'move', dir: shot.facing, seq: this.nextMoveSeq() });
      this.runner.onMove(this.player, { t: 'move', dir: 0, seq: this.nextMoveSeq() });
    }

    // The barrel sweeps from where it is to where it is going.
    const from = m ? m.relAngle : shot.relAngle;
    const steps = Math.max(1, bots.pacing.aimSteps);
    this.sweep = [];
    for (let i = 1; i <= steps; i++) this.sweep.push(from + ((shot.relAngle - from) * i) / steps);
    this.nextAt = 0;
    this.stage = 'aim';
  }

  private aim(now: number): void {
    const shot = this.shot;
    if (!shot) return;
    if (now < this.nextAt) return;
    const angle = this.sweep.shift();
    if (angle !== undefined) {
      this.runner.onAim(this.player, angle);
      // Never faster than the server's own aim throttle, whatever the time scale.
      this.nextAt = now + Math.max(ms(bots.pacing.aimStepSeconds), config.aimMinIntervalMs + 5);
      return;
    }
    const slot = slotOfSeat(this.runner.state, this.player.seat);
    if (slot && slot.shot !== shot.shot) this.runner.onSelectShot(this.player, shot.shot);
    this.stage = 'charge';
    this.chargeStartAt = now + ms(bots.pacing.settleSeconds);
    this.nextAt = this.chargeStartAt;
  }

  private charge(now: number): void {
    const shot = this.shot;
    if (!shot) return;
    if (now < this.chargeStartAt) return;
    // The human rate: a full bar takes `constants.power.chargeSeconds` (DESIGN §2.10).
    const full = ms(constants.power.chargeSeconds);
    const bar = quantisePower(clamp((now - this.chargeStartAt) / Math.max(1, full), 0, 1));
    if (bar >= shot.power) {
      this.fire();
      return;
    }
    if (now >= this.nextAt) {
      this.runner.onCharging(this.player, bar);
      this.nextAt = now + Math.max(ms(bots.pacing.chargeReportSeconds), config.chargeMinIntervalMs + 5);
    }
  }

  private fire(): void {
    const shot = this.shot;
    if (!shot) return;
    this.stage = 'done';
    this.runner.onFire(this.player, {
      t: 'fire',
      shot: shot.shot,
      relAngle: shot.relAngle,
      power: shot.power,
      seq: this.nextFireSeq(),
    });
  }

  private nextFireSeq(): number {
    this.fireSeq = Math.max(this.fireSeq, this.player.lastFireSeq) + 1;
    return this.fireSeq;
  }

  private nextMoveSeq(): number {
    this.moveSeq = Math.max(this.moveSeq, this.player.lastMoveSeq) + 1;
    return this.moveSeq;
  }
}

