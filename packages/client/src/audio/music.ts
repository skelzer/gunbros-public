/**
 * The music (DESIGN §8.3): the Farline OST, one track per map, one for the lobby and
 * the room, one for sudden death and one for the results.
 *
 * Two halves, like the sound effects. {@link trackFor} decides *what* should be playing
 * from plain data — which screen, which map, how far the match has got — and is tested
 * without an AudioContext. {@link MusicPlayer} is the impure shell that makes it so.
 *
 * Four rules shape the player:
 *
 * - **It outlives every scene.** The lobby, the room and the match each tear the page
 *   down, but the music runs across them; there is one player for the app
 *   ({@link appMusic}), and a scene only says which track it wants.
 * - **Streamed, not decoded.** A decoded three-minute track is 60 MB and more of PCM,
 *   which a phone will not keep. One `<audio>` element streams the file and is routed
 *   through WebAudio only for its gain: iOS ignores `volume` on a media element.
 * - **Nothing exists until a gesture** (DESIGN §7 items 111, 157). The context and the
 *   element are built in {@link MusicPlayer.unlock}, which is called from inside the
 *   first key or click; a scene may ask for a track long before that.
 * - **Silence, never an error.** A track that fails to load is dropped and never
 *   retried, a refused `play()` is swallowed, and the next gesture tries again. The
 *   smoke test fails a run with anything on the console (DESIGN §10).
 */
import { suddenDeathLevel } from '@gunbros/shared';
import type { MapId, MatchState } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';
import type { MusicTrack } from '../data/clientConstants.js';
import { loadSoundMode } from '../state/session.js';

export type { MusicTrack } from '../data/clientConstants.js';

const music = clientConstants.music;

/** Where the player is, as far as the music is concerned. */
export type MusicScene =
  | { kind: 'lobby' }
  | { kind: 'match'; mapId: MapId; suddenDeath: boolean; ended: boolean };

/** The track a scene plays, or null for silence (a map with no track). */
export function trackFor(scene: MusicScene): MusicTrack | null {
  if (scene.kind === 'lobby') return music.lobby;
  // The end panel sits over the match, so the results outrank everything else.
  if (scene.ended) return music.results;
  if (scene.suddenDeath) return music.suddenDeath;
  return music.maps[scene.mapId] ?? null;
}

/**
 * The scene a match is in, read from its state rather than from its events: a player
 * who reconnects into sudden death never saw the event that started it (DESIGN §6.4),
 * and still hears the right track.
 *
 * `over` is the scene's own word on whether the match has ended. Only the authority
 * ends a networked match (DESIGN §7 item 57), and it can end one the local simulation
 * never finishes (a forfeit, a disconnect), so when the scene knows, it wins; left out,
 * the simulation's `phase` decides (the offline sandbox).
 */
export function matchScene(match: MatchState, over?: boolean): MusicScene {
  return {
    kind: 'match',
    mapId: match.map.id,
    suddenDeath: suddenDeathLevel(match.completedTurns) > 0,
    ended: over ?? match.phase === 'ended',
  };
}

export function trackUrl(track: MusicTrack): string {
  return `${import.meta.env.BASE_URL}music/${track}.mp3`;
}

/** The player. See the module comment for the rules it keeps. */
export class MusicPlayer {
  private ctx: AudioContext | null = null;
  /** Per-track gain: the evening-out value, and the fades. */
  private fade: GainNode | null = null;
  private el: HTMLAudioElement | null = null;
  /** Latched once WebAudio or the element has refused us. */
  private broken = false;
  private enabled: boolean;
  /** Is the page in the background? The music waits for it to come back. */
  private hidden = false;
  /** What the scene asks for. */
  private wanted: MusicTrack | null = null;
  /** What the element holds (paused or not). */
  private loaded: MusicTrack | null = null;
  /** Tracks that failed to load; asked for again, they play silence. */
  private readonly failed = new Set<MusicTrack>();
  /** A fade-out in progress; the player re-reads what it wants when it ends. */
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** The track the scene asks for; null is silence. Cheap to call every frame. */
  setTrack(track: MusicTrack | null): void {
    if (track === this.wanted) return;
    this.wanted = track;
    this.sync();
  }

  /** The sound mode's music half: false while the mode is `noMusic` or `off`. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.sync();
  }

  /**
   * Build the graph, or resume a context the browser suspended, and start whatever is
   * wanted. Called from inside every key and click: it has to run in the gesture's own
   * call stack (DESIGN §7 item 157), and a later gesture is also the retry for a
   * `play()` the browser refused.
   */
  unlock(): void {
    if (this.broken) return;
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        void ctx.resume().catch(() => undefined);
      } catch {
        this.broken = true;
        return;
      }
    }
    this.sync();
  }

  private build(): void {
    try {
      const Ctor: typeof AudioContext | undefined =
        typeof window === 'undefined' ? undefined : window.AudioContext;
      if (!Ctor || typeof Audio === 'undefined') {
        this.broken = true;
        return;
      }
      const ctx = new Ctor();
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.addEventListener('error', () => this.onError());
      const source = ctx.createMediaElementSource(el);
      const fade = ctx.createGain();
      fade.gain.value = 0;
      const bus = ctx.createGain();
      bus.gain.value = music.busGain;
      source.connect(fade);
      fade.connect(bus);
      bus.connect(ctx.destination);
      this.ctx = ctx;
      this.el = el;
      this.fade = fade;
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.visibilityState === 'hidden';
        this.sync();
      });
    } catch {
      this.broken = true;
    }
  }

  /** What should be coming out of the speakers right now. */
  private target(): MusicTrack | null {
    if (!this.enabled || this.hidden) return null;
    const track = this.wanted;
    return track !== null && !this.failed.has(track) ? track : null;
  }

  /** Bring the element in line with {@link target}, fading on the way. */
  private sync(): void {
    const el = this.el;
    if (!el || this.broken || this.fadeTimer !== null) return;
    const want = this.target();
    if (want === this.loaded) {
      if (want !== null && el.paused) this.start();
      return;
    }
    if (this.loaded !== null && !el.paused) {
      this.rampTo(0, music.fadeOutS);
      this.fadeTimer = setTimeout(() => {
        this.fadeTimer = null;
        this.afterFade();
      }, music.fadeOutS * 1000);
      return;
    }
    this.afterFade();
  }

  /** The old track is silent: pause it, then load the new one, or resume the old. */
  private afterFade(): void {
    const el = this.el;
    if (!el) return;
    const want = this.target();
    if (want === null) {
      // Kept loaded, so turning the music back on resumes where it stopped.
      el.pause();
      return;
    }
    if (want !== this.loaded) {
      el.pause();
      el.src = trackUrl(want);
      this.loaded = want;
    }
    this.start();
  }

  /** Play the loaded track, fading up to its evening-out gain. */
  private start(): void {
    const el = this.el;
    const track = this.loaded;
    if (!el || track === null) return;
    this.rampTo(music.tracks[track].gain, music.fadeInS);
    try {
      // Refused before the first gesture, or by a strict autoplay policy: the next
      // gesture's `unlock` asks again.
      void el.play().catch(() => undefined);
    } catch {
      this.broken = true;
    }
  }

  private rampTo(gain: number, seconds: number): void {
    const ctx = this.ctx;
    const fade = this.fade;
    if (!ctx || !fade) return;
    try {
      const t = ctx.currentTime;
      fade.gain.cancelScheduledValues(t);
      fade.gain.setValueAtTime(fade.gain.value, t);
      fade.gain.linearRampToValueAtTime(gain, t + seconds);
    } catch {
      this.broken = true;
    }
  }

  /** The loaded file is missing or undecodable: never ask for it again. */
  private onError(): void {
    if (this.loaded !== null) this.failed.add(this.loaded);
    this.loaded = null;
    this.el?.removeAttribute('src');
  }
}

let shared: MusicPlayer | null = null;

/**
 * The one player the app has. Built on first use, not at import, so a test that only
 * wants {@link trackFor} never touches storage.
 */
export function appMusic(): MusicPlayer {
  shared ??= new MusicPlayer(loadSoundMode() === 'on');
  return shared;
}
