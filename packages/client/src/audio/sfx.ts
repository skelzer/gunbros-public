/**
 * What the game *sounds* like: the mapping from simulation events (DESIGN §1.2
 * `match/events.ts` — "consumed by render + audio") and UI actions onto the voices in
 * `audio/synth.ts`.
 *
 * The mapping is a set of pure functions over plain data, deliberately: it is the half
 * of the audio worth testing, and a test must not need an AudioContext to ask "does a
 * 60 px carve sound bigger than a 12 px one, and does one tick with eight hits still
 * only play one hit?". {@link SfxPlayer} is the thin impure shell that hands the answers
 * to the synth.
 *
 * Nothing here reads MatchState: an event carries everything a sound needs. The one
 * piece of context is `selfSeat`, so your own turn chime is a fifth above everyone
 * else's and you can hear whose turn it is without reading the banner.
 */
import { constants } from '@gunbros/shared';
import type { SimEvent } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';
import { Synth } from './synth.js';
import type { SfxCue, SfxName } from './synth.js';

export type { SfxCue, SfxName } from './synth.js';

const audio = clientConstants.audio;

/** UI actions that make a noise of their own; none of them is a simulation event. */
export type UiSfx = 'click' | 'denied' | 'select';

/**
 * Loudest-first priority, used when one tick produced more cues than
 * `audio.maxCuesPerTick`. A shot that kills two mobiles and chips a third should sound
 * like a death, not like three overlapping ticks of the same blip.
 */
const priority: Record<SfxName, number> = {
  matchEnd: 0,
  suddenDeath: 1,
  skyLevelUp: 2,
  death: 3,
  explosion: 4,
  zap: 5,
  fire: 6,
  tornadoIn: 7,
  tornadoOut: 8,
  teleport: 9,
  hit: 10,
  heal: 11,
  skyForce: 12,
  itemUsed: 13,
  windChange: 14,
  turnStart: 15,
  timerWarning: 16,
  mineDrop: 17,
  uiDenied: 18,
  uiClick: 19,
  chargeTick: 20,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Level in [0, 1] from a value measured against a reference that means "full". */
export function levelFrom(value: number, reference: number): number {
  if (reference <= 0) return 1;
  return clamp01(value / reference);
}

/**
 * The cues one event earns, or an empty list for the events that are picture-only
 * (`carve`, `spawn`, `turnEnd`, `mark`, …). Returning a list rather than one cue is
 * what lets a single event be a layered sound later without changing any caller.
 */
export function cuesForEvent(event: SimEvent, selfSeat = -1): SfxCue[] {
  const a = audio.mapping;
  switch (event.t) {
    case 'fire':
      // Power picks the pitch: a nudge sounds like a nudge, a full charge like a gun.
      return [
        {
          name: 'fire',
          level: a.fireMinLevel + (1 - a.fireMinLevel) * clamp01(event.power),
          pitch: a.firePitchHigh + (a.firePitchLow - a.firePitchHigh) * clamp01(event.power),
        },
      ];
    case 'explosion':
      return [
        {
          name: 'explosion',
          level: Math.max(
            a.explosionMinLevel,
            levelFrom(event.carveRadius, a.explosionRefRadiusPx),
          ),
        },
      ];
    case 'mineExplode':
      return [{ name: 'explosion', level: a.mineExplodeLevel }];
    case 'hit': {
      // Damage that got through matters more than damage the shield ate, but a shot
      // that only drained a shield still has to be audible.
      const felt = event.hpLost + event.shieldAbsorbed * a.shieldShare;
      return [
        {
          name: 'hit',
          level: Math.max(a.hitMinLevel, levelFrom(felt, a.hitRefDamage)),
          pitch: event.seat === selfSeat ? a.selfPitchDown : 1,
        },
      ];
    }
    case 'death':
      return [{ name: 'death', level: 1, pitch: event.seat === selfSeat ? a.selfPitchDown : 1 }];
    case 'turnStart':
      return [{ name: 'turnStart', pitch: event.seat === selfSeat ? a.selfPitchUp : 1 }];
    case 'timerWarning':
      return [{ name: 'timerWarning', pitch: event.seat === selfSeat ? 1 : a.otherPitchDown }];
    case 'windChange':
      return [
        {
          name: 'windChange',
          level: Math.max(
            a.windMinLevel,
            levelFrom(event.strength, constants.wind.maxStrength),
          ),
        },
      ];
    case 'itemUsed':
      return [{ name: 'itemUsed' }];
    case 'heal':
      return event.amount > 0 ? [{ name: 'heal' }] : [];
    case 'teleport':
      return [{ name: 'teleport' }];
    case 'beam':
      return [{ name: 'zap' }];
    // The sky (DESIGN §5). The satellite's own strike rides in on the `beam` it fires,
    // so `skyStrike` only has to make it unmistakably loud.
    case 'skyStrike':
      return [{ name: 'zap', level: 1 }];
    case 'skyLevelUp':
      return [{ name: 'skyLevelUp' }];
    case 'tornadoCapture':
      return [{ name: 'tornadoIn', pitch: event.ownerSeat === selfSeat ? a.selfPitchUp : 1 }];
    case 'tornadoRelease':
      return [{ name: 'tornadoOut', pitch: event.ownerSeat === selfSeat ? a.selfPitchUp : 1 }];
    case 'skyForce':
      return [{ name: 'skyForce' }];
    // Weather rolling in is the level-up fanfare; clearing is the softer wind cue.
    case 'skyChange':
      return event.kind === 'none'
        ? [{ name: 'windChange', level: a.windMinLevel }]
        : [{ name: 'skyLevelUp' }];
    case 'mineSpawn':
      return [{ name: 'mineDrop' }];
    case 'suddenDeath':
      return [{ name: 'suddenDeath' }];
    case 'matchEnd':
      return [{ name: 'matchEnd' }];
    default:
      // carve, spawn, land, projectileExpire, mark, mineMove, pull, turnEnd: the
      // renderer already says these; a sound each would be a wall of noise.
      return [];
  }
}

/**
 * Collapse the cues of one tick: one voice each, at the loudest level any of them
 * asked for, and at most `audio.maxCuesPerTick` of them, keeping the most important.
 *
 * A single shell routinely produces an explosion, a carve and three hits in the same
 * tick, and a split shot multiplies that by eight. Playing every cue would clip the
 * master gain and turn the blast into mush.
 */
export function mergeCues(cues: readonly SfxCue[], max = audio.maxCuesPerTick): SfxCue[] {
  const byName = new Map<SfxName, SfxCue>();
  for (const cue of cues) {
    const level = cue.level ?? 1;
    const seen = byName.get(cue.name);
    if (!seen) {
      byName.set(cue.name, { ...cue });
      continue;
    }
    // The loudest instance wins, and brings its own pitch with it.
    if (level > (seen.level ?? 1)) byName.set(cue.name, { ...cue });
  }
  const merged = [...byName.values()];
  merged.sort((a, b) => (priority[a.name] ?? 99) - (priority[b.name] ?? 99));
  return merged.slice(0, Math.max(0, max));
}

/** Every cue one tick's events earn, already merged. */
export function cuesForEvents(events: readonly SimEvent[], selfSeat = -1): SfxCue[] {
  if (events.length === 0) return [];
  const all: SfxCue[] = [];
  for (const event of events) {
    for (const cue of cuesForEvent(event, selfSeat)) all.push(cue);
  }
  return mergeCues(all);
}

// --------------------------------------------------------------------------
// The charge (DESIGN §2.10: "rising pitch during charge, tick at each major bar")
// --------------------------------------------------------------------------

/**
 * Which major bar a power level has reached: 0 before the first, `majorBars` at full.
 * The bars are the shared power data, so the click lines up with the bar the HUD draws.
 */
export function chargeBarIndex(power: number): number {
  const bars = constants.power.majorBars;
  return Math.min(bars, Math.floor(clamp01(power) * bars + 1e-9));
}

/**
 * The tick cues crossing from `previous` to `power` earns — usually none, one when the
 * bar passes a major mark, several if a frame was long enough to cross two.
 *
 * Each bar ticks a semitone higher than the last, which is how a player learns to hear
 * "three bars" without watching the bar.
 */
export function chargeTickCues(previous: number, power: number): SfxCue[] {
  const from = chargeBarIndex(previous);
  const to = chargeBarIndex(power);
  if (to <= from) return [];
  const cues: SfxCue[] = [];
  for (let bar = from + 1; bar <= to; bar++) {
    cues.push({ name: 'chargeTick', pitch: Math.pow(audio.mapping.chargeTickStep, bar - 1) });
  }
  return cues;
}

/** The cue a UI action makes. */
export function cueForUi(action: UiSfx): SfxCue {
  if (action === 'denied') return { name: 'uiDenied' };
  if (action === 'select') return { name: 'uiClick', pitch: audio.mapping.selectPitch };
  return { name: 'uiClick' };
}

// --------------------------------------------------------------------------
// The player
// --------------------------------------------------------------------------

/**
 * The impure shell: holds a {@link Synth}, applies the mapping above, and owns the one
 * piece of state the mapping cannot be pure about — which major bar the charge has
 * already ticked past.
 */
export class SfxPlayer {
  readonly synth: Synth;
  private chargePower = 0;
  private charging = false;

  constructor(muted = false) {
    this.synth = new Synth(muted);
  }

  get muted(): boolean {
    return this.synth.muted;
  }

  setMuted(muted: boolean): void {
    this.synth.setMuted(muted);
  }

  /** First gesture of the session: start (or resume) the AudioContext. */
  unlock(): void {
    this.synth.unlock();
  }

  destroy(): void {
    this.synth.destroy();
  }

  /** One tick's events. */
  events(events: readonly SimEvent[], selfSeat = -1): void {
    for (const cue of cuesForEvents(events, selfSeat)) this.synth.play(cue);
  }

  ui(action: UiSfx): void {
    this.synth.play(cueForUi(action));
  }

  play(cue: SfxCue): void {
    this.synth.play(cue);
  }

  /**
   * Follow the power bar. Called every frame while the charge is held: it starts the
   * rising tone on the first call, and ticks on each major bar it crosses.
   */
  charge(power: number): void {
    if (!this.charging) {
      this.charging = true;
      this.chargePower = 0;
      this.synth.startCharge();
    }
    for (const cue of chargeTickCues(this.chargePower, power)) this.synth.play(cue);
    this.chargePower = power;
    this.synth.updateCharge(power);
  }

  /** The charge ended — fired or taken away. The release sound is the `fire` event. */
  endCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    this.chargePower = 0;
    this.synth.stopCharge();
  }
}
