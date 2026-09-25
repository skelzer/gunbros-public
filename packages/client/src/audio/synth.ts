/**
 * WebAudio sound effects (DESIGN §1.3 `audio/synth.ts`, §8: "builds every SFX from
 * oscillators + noise + envelopes"). No samples, no music, no assets.
 *
 * Three rules shape this module:
 *
 * - **Nothing exists until a gesture.** Browsers refuse to start an `AudioContext`
 *   that no user action asked for, and one created eagerly sits `suspended` and eats
 *   the first shot of the match. {@link Synth.unlock} is called from the first key or
 *   click the match view sees; everything before that is silent by design.
 * - **A missing or broken WebAudio must never cost a frame.** Every entry point is
 *   wrapped: an engine that throws sets `broken` once and the game plays on in silence.
 * - **No game knowledge.** This module knows `SfxName` and volumes, nothing about
 *   MatchState or events; `audio/sfx.ts` owns that mapping.
 *
 * Every number lives in `clientConstants.audio` (DESIGN §1.3: presentation tunables in
 * one file), because "pleasant" is a thing you tune by ear, not by editing a draw call.
 */
import { clientConstants } from '../data/clientConstants.js';

const audio = clientConstants.audio;

/** Every sound the game can make. `audio/sfx.ts` decides which one an event earns. */
export type SfxName =
  | 'fire'
  | 'explosion'
  | 'hit'
  | 'death'
  | 'turnStart'
  | 'timerWarning'
  | 'itemUsed'
  | 'teleport'
  | 'heal'
  | 'suddenDeath'
  | 'zap'
  | 'tornadoIn'
  | 'tornadoOut'
  | 'skyForce'
  | 'skyLevelUp'
  | 'windChange'
  | 'mineDrop'
  | 'matchEnd'
  | 'uiClick'
  | 'uiDenied'
  | 'chargeTick';

/**
 * One sound to play. `level` scales its volume (a small carve is quieter than a big
 * one), `pitch` multiplies its frequencies (the same voice, a fifth up, reads as a
 * different actor). Both default to 1, so `{ name }` alone is a valid cue.
 */
export interface SfxCue {
  name: SfxName;
  /** 0..1 loudness scale. */
  level?: number;
  /** Frequency multiplier, 1 = as written. */
  pitch?: number;
}

interface ToneOptions {
  type: OscillatorType;
  fromHz: number;
  /** Sweep target; omit for a steady note. */
  toHz?: number;
  durS: number;
  gain: number;
  /** Seconds from now before the note starts, for arpeggios and double beeps. */
  delayS?: number;
  /** Attack time; the rest of the note is the decay. */
  attackS?: number;
  detuneCents?: number;
}

interface NoiseOptions {
  durS: number;
  gain: number;
  /** Band or low pass sweep across the burst. */
  fromHz: number;
  toHz: number;
  type: BiquadFilterType;
  q?: number;
  delayS?: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** The charge loop while the power bar fills (DESIGN §2.10: rising pitch). */
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  private mutedFlag: boolean;
  /** Latched once WebAudio has refused us, so we stop asking every frame. */
  private broken = false;
  /**
   * Has the page been touched yet? Creating an `AudioContext` before the first gesture
   * is not merely useless — Chrome logs a warning for it, and the smoke test (DESIGN
   * §10) fails a match that put anything on the console. So nothing is built until
   * {@link unlock} says a key or a click has happened.
   */
  private gestured = false;

  constructor(muted = false) {
    this.mutedFlag = muted;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** True once an AudioContext exists — the tests and the debug panel ask. */
  get started(): boolean {
    return this.ctx !== null;
  }

  /**
   * Mute is a master-gain ramp rather than a flag checked per sound: a note already
   * scheduled is cut off with everything else, and unmuting needs no bookkeeping.
   */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (muted) this.stopCharge();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(
        muted ? 0 : audio.masterGain,
        ctx.currentTime,
        audio.muteRampS,
      );
    } catch {
      this.broken = true;
    }
  }

  /**
   * Create the context, or resume one the browser suspended. Safe to call on every
   * gesture: it is a no-op once the context is running.
   */
  unlock(): void {
    this.gestured = true;
    const ctx = this.context();
    if (!ctx || ctx.state !== 'suspended') return;
    try {
      void ctx.resume().catch(() => undefined);
    } catch {
      this.broken = true;
    }
  }

  /** Release the audio hardware when the view goes away. */
  destroy(): void {
    this.stopCharge();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    if (!ctx) return;
    try {
      void ctx.close().catch(() => undefined);
    } catch {
      // Already closed, or an engine that does not implement it: nothing to do.
    }
  }

  // ------------------------------------------------------------------------
  // Plumbing
  // ------------------------------------------------------------------------

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (this.broken || !this.gestured) return null;
    try {
      const Ctor: typeof AudioContext | undefined =
        typeof window === 'undefined' ? undefined : window.AudioContext;
      if (!Ctor) {
        this.broken = true;
        return null;
      }
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.mutedFlag ? 0 : audio.masterGain;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      this.broken = true;
      return null;
    }
  }

  /** White noise, generated once and reused by every burst. */
  private noise(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * audio.noiseBufferS));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }

  private tone(o: ToneOptions): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + (o.delayS ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type;
    if (o.detuneCents) osc.detune.value = o.detuneCents;
    osc.frequency.setValueAtTime(Math.max(1, o.fromHz), t0);
    if (o.toHz !== undefined && o.toHz !== o.fromHz) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toHz), t0 + o.durS);
    }
    const attack = o.attackS ?? audio.attackS;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, o.gain), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.durS);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.durS + audio.tailS);
  }

  private burst(o: NoiseOptions): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const buffer = this.noise(ctx);
    if (!buffer) return;
    const t0 = ctx.currentTime + (o.delayS ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(Math.max(1, o.fromHz), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, o.toHz), t0 + o.durS);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, o.gain), t0 + audio.attackS);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.durS);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + o.durS + audio.tailS);
  }

  // ------------------------------------------------------------------------
  // The charge loop (DESIGN §2.10: rising pitch while the bar fills)
  // ------------------------------------------------------------------------

  /** Start the rising tone. Idempotent: a second call while it runs does nothing. */
  startCharge(): void {
    if (this.charge || this.mutedFlag) return;
    const ctx = this.context();
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const v = audio.voices.charge;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = v.type as OscillatorType;
      osc.frequency.setValueAtTime(v.fromHz, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(v.gain, ctx.currentTime + v.fadeInS);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      this.charge = { osc, gain };
    } catch {
      this.broken = true;
    }
  }

  /** Follow the power bar: `power` in [0, 1] sets the pitch of the running tone. */
  updateCharge(power: number): void {
    const charge = this.charge;
    const ctx = this.ctx;
    if (!charge || !ctx) return;
    const v = audio.voices.charge;
    const hz = v.fromHz + (v.toHz - v.fromHz) * clamp01(power);
    try {
      charge.osc.frequency.setTargetAtTime(hz, ctx.currentTime, v.glideS);
    } catch {
      this.stopCharge();
    }
  }

  /** Fade the tone out. Called on release, on mute, and when the view goes away. */
  stopCharge(): void {
    const charge = this.charge;
    const ctx = this.ctx;
    this.charge = null;
    if (!charge || !ctx) return;
    try {
      const v = audio.voices.charge;
      const t = ctx.currentTime;
      charge.gain.gain.cancelScheduledValues(t);
      charge.gain.gain.setValueAtTime(Math.max(0.0001, charge.gain.gain.value), t);
      charge.gain.gain.exponentialRampToValueAtTime(0.0001, t + v.fadeOutS);
      charge.osc.stop(t + v.fadeOutS + audio.tailS);
    } catch {
      // The node is already gone; nothing else to release.
    }
  }

  // ------------------------------------------------------------------------
  // Voices
  // ------------------------------------------------------------------------

  /**
   * Play one cue. Everything is scheduled relative to `currentTime`, so a cue costs a
   * few node allocations and nothing else — the loop never waits on audio.
   */
  play(cue: SfxCue): void {
    if (this.mutedFlag) return;
    const ctx = this.context();
    if (!ctx) return;
    const level = clamp01(cue.level ?? 1);
    if (level <= 0) return;
    const pitch = cue.pitch && cue.pitch > 0 ? cue.pitch : 1;
    try {
      this.voice(cue.name, level, pitch);
    } catch {
      this.broken = true;
    }
  }

  private voice(name: SfxName, level: number, pitch: number): void {
    const v = audio.voices;
    switch (name) {
      case 'fire': {
        const c = v.fire;
        this.tone({
          type: 'sawtooth',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        this.burst({
          type: 'lowpass',
          fromHz: c.noiseFromHz,
          toHz: c.noiseToHz,
          durS: c.noiseDurS,
          gain: c.noiseGain * level,
        });
        return;
      }
      case 'explosion': {
        const c = v.explosion;
        // A big carve is longer and lower, a small one shorter and tighter, so the
        // blast tells you how much terrain went with it without looking.
        const size = 0.5 + 0.5 * level;
        this.burst({
          type: 'lowpass',
          fromHz: c.filterFromHz / pitch,
          toHz: c.filterToHz,
          durS: c.durS * size,
          gain: c.gain * level,
          q: c.q,
        });
        this.tone({
          type: 'sine',
          fromHz: c.thumpFromHz / pitch,
          toHz: c.thumpToHz,
          durS: c.thumpDurS * size,
          gain: c.thumpGain * level,
        });
        return;
      }
      case 'hit': {
        const c = v.hit;
        this.tone({
          type: 'triangle',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        this.burst({
          type: 'bandpass',
          fromHz: c.noiseFromHz * pitch,
          toHz: c.noiseToHz,
          durS: c.noiseDurS,
          gain: c.noiseGain * level,
          q: c.q,
        });
        return;
      }
      case 'death': {
        const c = v.death;
        this.tone({
          type: 'sawtooth',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz,
          durS: c.durS,
          gain: c.gain * level,
        });
        this.burst({
          type: 'lowpass',
          fromHz: c.noiseFromHz,
          toHz: c.noiseToHz,
          durS: c.durS,
          gain: c.noiseGain * level,
        });
        return;
      }
      case 'turnStart':
        this.arpeggio(v.turnStart, level, pitch, 'sine');
        return;
      case 'heal':
        this.arpeggio(v.heal, level, pitch, 'sine');
        return;
      case 'matchEnd':
        this.arpeggio(v.matchEnd, level, pitch, 'triangle');
        return;
      case 'timerWarning': {
        const c = v.timerWarning;
        for (let i = 0; i < c.beeps; i++) {
          this.tone({
            type: 'square',
            fromHz: c.hz * pitch,
            durS: c.durS,
            gain: c.gain * level,
            delayS: i * c.stepS,
          });
        }
        return;
      }
      case 'itemUsed': {
        const c = v.itemUsed;
        this.tone({
          type: 'triangle',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        return;
      }
      case 'teleport': {
        const c = v.teleport;
        this.tone({
          type: 'sine',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        this.tone({
          type: 'sine',
          fromHz: c.toHz * pitch,
          toHz: c.fromHz * pitch,
          durS: c.durS,
          gain: c.gain * level * c.tailGain,
          delayS: c.durS,
        });
        return;
      }
      case 'suddenDeath': {
        const c = v.suddenDeath;
        this.tone({
          type: 'sawtooth',
          fromHz: c.hz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
          attackS: c.attackS,
        });
        this.tone({
          type: 'sawtooth',
          fromHz: c.hz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
          attackS: c.attackS,
          detuneCents: c.detuneCents,
        });
        return;
      }
      case 'zap': {
        const c = v.zap;
        this.tone({
          type: 'square',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        this.burst({
          type: 'highpass',
          fromHz: c.noiseFromHz,
          toHz: c.noiseToHz,
          durS: c.durS,
          gain: c.noiseGain * level,
        });
        return;
      }
      // The sky (DESIGN §5). A capture is a rising whoosh and a release a falling one,
      // so a shell going into the funnel and one coming out of it never sound alike.
      case 'tornadoIn':
      case 'tornadoOut': {
        const c = name === 'tornadoIn' ? v.tornadoIn : v.tornadoOut;
        this.burst({
          type: 'bandpass',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
          q: c.q,
        });
        return;
      }
      case 'skyForce':
        this.arpeggio(v.skyForce, level, pitch, 'sine');
        return;
      case 'skyLevelUp':
        this.arpeggio(v.skyLevelUp, level, pitch, 'triangle');
        return;
      case 'windChange': {
        const c = v.windChange;
        // Up then down: a gust, not a siren.
        this.burst({
          type: 'bandpass',
          fromHz: c.fromHz,
          toHz: c.peakHz,
          durS: c.durS / 2,
          gain: c.gain * level,
          q: c.q,
        });
        this.burst({
          type: 'bandpass',
          fromHz: c.peakHz,
          toHz: c.fromHz,
          durS: c.durS / 2,
          gain: c.gain * level,
          q: c.q,
          delayS: c.durS / 2,
        });
        return;
      }
      case 'mineDrop': {
        const c = v.mineDrop;
        this.tone({
          type: 'square',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        return;
      }
      case 'chargeTick': {
        const c = v.chargeTick;
        this.tone({
          type: 'square',
          fromHz: c.hz * pitch,
          durS: c.durS,
          gain: c.gain * level,
          attackS: c.attackS,
        });
        return;
      }
      case 'uiClick': {
        const c = v.uiClick;
        this.tone({
          type: 'square',
          fromHz: c.hz * pitch,
          durS: c.durS,
          gain: c.gain * level,
          attackS: c.attackS,
        });
        return;
      }
      case 'uiDenied': {
        const c = v.uiDenied;
        this.tone({
          type: 'square',
          fromHz: c.fromHz * pitch,
          toHz: c.toHz * pitch,
          durS: c.durS,
          gain: c.gain * level,
        });
        return;
      }
    }
  }

  /** A short run of notes: the chime, the heal, the end-of-match flourish. */
  private arpeggio(
    c: { gain: number; notes: readonly number[]; stepS: number; durS: number },
    level: number,
    pitch: number,
    type: OscillatorType,
  ): void {
    for (let i = 0; i < c.notes.length; i++) {
      const hz = c.notes[i];
      if (hz === undefined) continue;
      this.tone({
        type,
        fromHz: hz * pitch,
        durS: c.durS,
        gain: c.gain * level,
        delayS: i * c.stepS,
      });
    }
  }
}
