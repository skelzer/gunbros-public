/**
 * Effects (DESIGN §1.3 render/effects.ts): explosions, trails and floating damage,
 * driven entirely by the `SimEvent` stream each tick returns.
 *
 * A blast is five things at once — a white core flash, two shock rings, a fireball of
 * overlapping puffs that cools along a ramp as it climbs, a column of smoke that greys
 * and spreads behind it, and chunks of ground thrown out on ballistic arcs. The ramp is
 * chosen by the event's own `damageType`, so an ice shell bursts white and blue and a
 * fire shell bursts yellow and red without either of them carrying a single extra byte.
 * Trails work the same way: the projectile def says how the trail *behaves* (puffs,
 * sparks, bubbles) and its damage type says what colour it is.
 *
 * When the Blender effects atlas is in (render/effectSprites.ts) the flash, rings,
 * fireball and smoke of a blast are one flipbook per damage type instead, in the size
 * tier nearest the carve radius (satellite blasts past the largest), and so are the hit
 * pop, the death blast and its smoke column, beams, the teleport and the vortex. The
 * thrown ground, debris, sparks, trails, marks, damage numbers and the shake stay code:
 * they are already chunky fillRects in the map's own colours, they fly on real arcs no
 * flipbook could know, and they layer well over the sprites. Without the atlas (still
 * loading, failed, or `?sprites=pixel`) everything below is drawn in code as before.
 *
 * Everything in here is decoration. It uses `Math.random` freely because no value ever
 * flows back into MatchState — the simulation's own randomness is the shared PRNG.
 */
import type { ProjectileState, SimEvent } from '@gunbros/shared';
import type { Camera } from './camera.js';
import { clientConstants } from '../data/clientConstants.js';
import { drawPixelText } from '../ui/pixelFont.js';
import {
  clipFrameAt,
  drawEffectFrame,
  effectClip,
  effectSpritesReady,
  hasEffect,
  keyForType,
  loadEffectSprites,
  nearestTier,
  satelliteCount,
} from './effectSprites.js';

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  core: string;
  edge: string;
}

interface Ring {
  x: number;
  y: number;
  from: number;
  to: number;
  life: number;
  maxLife: number;
  /** Frames before the ring starts, so a second ring can trail the first. */
  delay: number;
  color: string;
  width: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  /** A chunk of thrown ground gets a 1 px dark side; a spark does not. */
  edge: string | null;
}

/**
 * A ball of fire or of smoke: a circle that grows, rises, drifts and walks a colour
 * ramp as it ages. Overlapping several of them is what makes a blast chunky rather than
 * a single expanding disc.
 */
interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  life: number;
  maxLife: number;
  delay: number;
  ramp: string[];
  /** Smoke draws behind the blast, fire in front of it. */
  smoke: boolean;
}

/**
 * A column of light: a lightning bolt, a satellite beam, a Thor laser, a falling
 * sword. Every one of them arrives as the same `beam` event (DESIGN §3), so one
 * renderer covers all of them and a Phase 4 group never edits the client.
 */
interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  life: number;
  maxLife: number;
}

/** A blinking target where something has been marked and is about to be struck. */
interface Mark {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  /**
   * The seat this number belongs to, when it came from a `hit`. A barrage (bigfoot's S2
   * drops eight pellets on one spot) would otherwise stack eight popups a pixel apart;
   * instead the running total for a seat keeps climbing inside one popup.
   */
  seat?: number;
  /** Running damage total behind {@link text}, for the same reason. */
  total?: number;
}

/**
 * A Blender flipbook in the world (render/effectSprites.ts). `age` counts sim ticks and
 * starts negative for one that waits its turn (a satellite blast, lingering smoke).
 * Smoke is `back`: drawn behind everything else, like the code smoke.
 */
interface SpriteFx {
  key: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  back: boolean;
}

/** A column of light as tiled segments, plus the burst where it lands. */
interface SpriteBeam {
  key: string;
  x: number;
  top: number;
  bottom: number;
  age: number;
}

/** Keeps laying smoke puffs over a wreck, so the column is as tall as it has had time to be. */
interface SmokeEmitter {
  x: number;
  y: number;
  wait: number;
  left: number;
  count: number;
}

function pick<T>(list: readonly T[]): T {
  const i = Math.min(list.length - 1, Math.floor(Math.random() * list.length));
  return list[i] as T;
}

/** The colour a ramp shows at age `t` in [0, 1]. */
function rampAt(ramp: readonly string[], t: number): string {
  if (ramp.length === 0) return '#ffffff';
  const i = Math.min(ramp.length - 1, Math.max(0, Math.floor(t * ramp.length)));
  return ramp[i] as string;
}

function blastRamp(damageType: string): string[] {
  const table = clientConstants.effects.blastColors;
  return table[damageType] ?? (table.explosive as string[]);
}

function trailRamp(damageType: string): string[] {
  const table = clientConstants.effects.trailColors;
  return table[damageType] ?? clientConstants.effects.colors.smoke;
}

/**
 * Screen shake, presentation only.
 *
 * There is no third place to put it: the thing that has to move is the camera, and the
 * thing that decides it should move is the blast, which arrives here. So the world draw
 * *borrows* the camera — `beginWorldFrame` biases it by a few px and advances the
 * oscillation, `endWorldFrame` puts it back — and nothing outside one `drawWorld` ever
 * sees a shaken camera. `beginWorldFrame` removes its own previous bias before applying
 * the new one, so a frame that somehow never reaches `endWorldFrame` cannot make the
 * offset drift; the bias is added and subtracted as the same double, so it is exact.
 *
 * `render/background.ts` opens the world frame (it draws first) and `Effects.draw`
 * closes it (it draws last).
 */
class WorldShake {
  private amplitude = 0;
  private angleDeg = 0;
  private appliedX = 0;
  private appliedY = 0;

  /** Shake by `px`, or keep the shake already running if it is stronger. */
  kick(px: number): void {
    const s = clientConstants.effects.shake;
    this.amplitude = Math.min(s.maxPx, Math.max(this.amplitude, px));
  }

  /**
   * Drop the shake between matches. It forgets the bias it has out as well as the
   * amplitude: the next match brings a new camera, and a bias owed to the old one must
   * never be subtracted from it.
   */
  clear(): void {
    this.amplitude = 0;
    this.angleDeg = 0;
    this.appliedX = 0;
    this.appliedY = 0;
  }

  beginWorldFrame(camera: Camera): void {
    this.endWorldFrame(camera);
    const s = clientConstants.effects.shake;
    if (this.amplitude < s.minPx) {
      this.amplitude = 0;
      return;
    }
    this.angleDeg += s.degPerFrame;
    const rad = (this.angleDeg * Math.PI) / 180;
    this.appliedX = Math.cos(rad) * this.amplitude;
    // A different rate vertically, so the motion is a wobble rather than a diagonal.
    this.appliedY = Math.sin(rad * 1.7) * this.amplitude * 0.6;
    camera.x += this.appliedX;
    camera.y += this.appliedY;
    this.amplitude *= s.decay;
  }

  endWorldFrame(camera: Camera): void {
    if (this.appliedX === 0 && this.appliedY === 0) return;
    camera.x -= this.appliedX;
    camera.y -= this.appliedY;
    this.appliedX = 0;
    this.appliedY = 0;
  }
}

/** The one shake. Owned here because the events that drive it arrive here. */
export const worldShake = new WorldShake();

export class Effects {
  private flashes: Flash[] = [];
  private rings: Ring[] = [];
  private particles: Particle[] = [];
  private puffs: Puff[] = [];
  private texts: FloatingText[] = [];
  private beams: Beam[] = [];
  private marks: Mark[] = [];
  private sprites: SpriteFx[] = [];
  private spriteBeams: SpriteBeam[] = [];
  private emitters: SmokeEmitter[] = [];
  private tick = 0;
  /** Where the last explosion happened, so the camera can linger on it. */
  lastExplosion: { x: number; y: number; tick: number } | null = null;

  constructor() {
    // Fetch the flipbooks now, so the first blast of the match is already a sprite.
    loadEffectSprites();
  }

  clear(): void {
    this.flashes = [];
    this.rings = [];
    this.particles = [];
    this.puffs = [];
    this.texts = [];
    this.beams = [];
    this.marks = [];
    this.sprites = [];
    this.spriteBeams = [];
    this.emitters = [];
    this.lastExplosion = null;
    worldShake.clear();
  }

  /** Feed one tick's events. */
  consume(events: readonly SimEvent[]): void {
    const fx = clientConstants.effects;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e) continue;
      switch (e.t) {
        case 'explosion': {
          this.blast(e.x, e.y, e.carveRadius, e.radius, e.damageType);
          this.lastExplosion = { x: e.x, y: e.y, tick: this.tick };
          break;
        }
        case 'hit': {
          if (e.amount <= 0) break;
          this.damageNumber(e.seat, e.x, e.y - fx.hullHeightPx, e.amount);
          this.impactSparks(
            e.x,
            e.y - fx.hullHeightPx / 2,
            e.damageType,
            this.hitSprite(e.x, e.y - fx.hullHeightPx / 2, e.damageType),
          );
          break;
        }
        case 'beam': {
          if (!this.beamSprite(e.x2, e.y1, e.y2, e.width))
            this.beams.push({
              x1: e.x1,
              y1: e.y1,
              x2: e.x2,
              y2: e.y2,
              width: e.width,
              life: fx.beamTicks,
              maxLife: fx.beamTicks,
            });
          for (let d = 0; d < fx.debrisPerExplosion / 2; d++) {
            const speed = Math.random() * fx.debrisSpeed;
            this.addParticle({
              x: e.x2,
              y: e.y2,
              vx: (Math.random() - 0.5) * 2 * speed,
              vy: -Math.random() * speed,
              life: fx.sparkLifeTicks * 2,
              maxLife: fx.sparkLifeTicks * 2,
              size: 1,
              color: pick(fx.colors.spark),
              gravity: fx.debrisGravity,
              edge: null,
            });
          }
          this.lastExplosion = { x: e.x2, y: e.y2, tick: this.tick };
          break;
        }
        case 'pull': {
          // A vortex has no explosion of its own to draw (the shell's blast is a
          // separate event), so the collapse is the ring run inwards; with sprites the
          // spiralling eye sits in the middle of it (the ring still shows the reach).
          if (effectSpritesReady() && hasEffect('vortex')) this.addSprite('vortex', e.x, e.y);
          this.rings.push({
            x: e.x,
            y: e.y,
            from: e.radius,
            to: e.radius * fx.pullCollapse,
            life: fx.pullTicks,
            maxLife: fx.pullTicks,
            delay: 0,
            color: fx.colors.ring,
            width: 1,
          });
          break;
        }
        case 'mark': {
          // `ticksUntil` is how long until the strike lands; blink at least once.
          const life = e.ticksUntil > 0 ? e.ticksUntil : fx.markTicks;
          this.marks.push({ x: e.x, y: e.y, life, maxLife: life });
          break;
        }
        case 'teleport': {
          // Both ends of the jump (DESIGN §4), so a mobile that vanishes from one side
          // of the map and appears on the other leaves something the eye can follow.
          for (const end of [
            { x: e.fromX, y: e.fromY },
            { x: e.x, y: e.y },
          ]) {
            if (effectSpritesReady() && hasEffect('teleport')) {
              // The burst carries its own rings and motes; the code sparks stay on top.
              this.addSprite('teleport', end.x, end.y - fx.sprites.teleportLiftPx);
            } else
              this.rings.push({
                x: end.x,
                y: end.y - fx.hullHeightPx / 2,
                from: fx.teleportRadiusPx,
                to: 2,
                life: fx.teleportTicks,
                maxLife: fx.teleportTicks,
                delay: 0,
                color: fx.colors.teleport,
                width: 1,
              });
            for (let d = 0; d < fx.teleportSparks; d++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = Math.random() * fx.debrisSpeed * 0.6;
              this.addParticle({
                x: end.x,
                y: end.y - fx.hullHeightPx / 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: fx.teleportTicks,
                maxLife: fx.teleportTicks,
                size: 2,
                color: fx.colors.teleport,
                gravity: 0,
                edge: null,
              });
            }
          }
          break;
        }
        case 'death': {
          // A wreck throws its own debris and smokes for a good while after.
          const b = fx.blast;
          const sprites = effectSpritesReady() && hasEffect('death_blast');
          if (sprites) {
            const sp = fx.sprites;
            this.addSprite('death_blast', e.x, e.y - fx.hullHeightPx / 2);
            this.emitters.push({
              x: e.x,
              y: e.y - fx.hullHeightPx,
              wait: sp.deathSmokeDelayTicks,
              left: sp.deathSmokeForTicks,
              count: 0,
            });
            worldShake.kick(fx.shake.maxPx);
          }
          for (let d = 0; d < fx.debrisPerExplosion; d++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * fx.debrisSpeed * 1.2;
            this.addParticle({
              x: e.x,
              y: e.y - fx.hullHeightPx,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - fx.debrisSpeed,
              life: fx.debrisLifeTicks,
              maxLife: fx.debrisLifeTicks,
              size: fx.debrisSizePx,
              color: pick(fx.colors.smoke),
              gravity: fx.debrisGravity,
              edge: null,
            });
          }
          for (let s = 0; s < (sprites ? 0 : b.smokePuffs); s++) {
            this.puffs.push({
              x: e.x + (Math.random() - 0.5) * fx.hullHeightPx,
              y: e.y - fx.hullHeightPx * 0.6,
              vx: (Math.random() - 0.5) * 0.2,
              vy: -b.smokeRisePx,
              r: 4 + Math.random() * 4,
              grow: b.smokeGrowPx,
              life: b.smokeTicks,
              maxLife: b.smokeTicks,
              delay: s * 3,
              ramp: fx.colors.smoke,
              smoke: true,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * One explosion: flash, two rings, a fireball, a smoke column, thrown ground and a
   * kick to the camera, all sized off the carve radius the event carries.
   */
  private blast(x: number, y: number, carveRadius: number, damageRadius: number, damageType: string): void {
    const fx = clientConstants.effects;
    const b = fx.blast;
    const ramp = blastRamp(damageType);
    const sprite = this.blastSprite(x, y, carveRadius, damageRadius, damageType);

    // Chunks, debris and the shake are shared; the flash, rings, fireball and smoke are
    // what the sprite replaces.
    if (!sprite) this.codeBlast(x, y, carveRadius, damageRadius, ramp);

    // Chunks of ground: fat pixels on ballistic arcs, outlined on their dark side.
    for (let i = 0; i < b.chunks; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.4 + Math.random() * 0.6) * b.chunkSpeed;
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - b.chunkSpeed * 0.55,
        life: b.chunkTicks * (0.5 + Math.random() * 0.5),
        maxLife: b.chunkTicks,
        size: Math.round(b.chunkMinPx + Math.random() * (b.chunkMaxPx - b.chunkMinPx)),
        color: pick(fx.colors.chunk),
        gravity: fx.debrisGravity,
        edge: fx.colors.chunkEdge,
      });
    }

    // Fine debris, as before, so the air between the chunks is not empty.
    for (let d = 0; d < fx.debrisPerExplosion; d++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * fx.debrisSpeed;
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - fx.debrisSpeed * 0.4,
        life: fx.debrisLifeTicks * (0.6 + Math.random() * 0.4),
        maxLife: fx.debrisLifeTicks,
        size: fx.debrisSizePx,
        color: pick(fx.colors.debris),
        gravity: fx.debrisGravity,
        edge: null,
      });
    }

    worldShake.kick((carveRadius / fx.shake.radiusForFullPx) * fx.shake.maxPx);
  }

  /** The code-drawn blast: flash, two rings, a fireball of puffs and a smoke column. */
  private codeBlast(x: number, y: number, carveRadius: number, damageRadius: number, ramp: string[]): void {
    const fx = clientConstants.effects;
    const b = fx.blast;
    this.flashes.push({
      x,
      y,
      r: carveRadius,
      life: fx.flashTicks,
      maxLife: fx.flashTicks,
      core: rampAt(ramp, 0),
      edge: rampAt(ramp, 0.45),
    });
    this.rings.push({
      x,
      y,
      from: carveRadius * 0.6,
      to: damageRadius * fx.ringGrowth,
      life: fx.ringTicks,
      maxLife: fx.ringTicks,
      delay: 0,
      color: fx.colors.ring,
      width: 2,
    });
    this.rings.push({
      x,
      y,
      from: carveRadius * 0.5,
      to: damageRadius * b.outerRingGrowth,
      life: fx.ringTicks,
      maxLife: fx.ringTicks,
      delay: b.outerRingDelayTicks,
      color: fx.colors.ringOuter,
      width: 1,
    });

    // Fireball: puffs scattered over the carve radius, rising as they cool.
    for (let i = 0; i < b.fireballPuffs; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * carveRadius * b.fireballSpreadFraction;
      this.puffs.push({
        x: x + Math.cos(angle) * spread,
        y: y + Math.sin(angle) * spread * 0.7,
        vx: Math.cos(angle) * 0.25,
        vy: -b.fireballRisePx - Math.random() * 0.2,
        r: carveRadius * b.fireballRadiusFraction * (0.5 + Math.random() * 0.6),
        grow: b.fireballGrowPx,
        life: b.fireballTicks * (0.5 + Math.random() * 0.9),
        maxLife: b.fireballTicks,
        // A spread of start times, so the ball boils instead of pulsing as one disc.
        delay: Math.floor(Math.random() * 7),
        ramp,
        smoke: false,
      });
    }

    // Smoke: fewer, slower, bigger, and behind the fire in time.
    for (let i = 0; i < b.smokePuffs; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * carveRadius * b.smokeSpreadFraction;
      this.puffs.push({
        x: x + Math.cos(angle) * spread,
        y: y + Math.sin(angle) * spread * 0.6,
        vx: Math.cos(angle) * 0.14,
        vy: -b.smokeRisePx * (0.7 + Math.random() * 0.6),
        r: carveRadius * b.smokeRadiusFraction * (0.5 + Math.random() * 0.7),
        grow: b.smokeGrowPx,
        life: b.smokeTicks * (0.7 + Math.random() * 0.5),
        maxLife: b.smokeTicks,
        delay: b.smokeDelayTicks + Math.floor(Math.random() * 6),
        ramp: fx.colors.smoke,
        smoke: true,
      });
    }
  }

  // ------------------------------------------------------------------------
  // Sprite effects. Each returns false when the atlas (or the clip) is not there, and
  // the caller draws its code effect instead.
  // ------------------------------------------------------------------------

  private addSprite(key: string, x: number, y: number, delay = 0, vx = 0, vy = 0, back = false): void {
    const max = clientConstants.effects.maxParticles;
    if (this.sprites.length >= max) this.sprites.shift();
    this.sprites.push({ key, x, y, vx, vy, age: -delay, back });
  }

  /** A smoke puff that rises and drifts while it plays. */
  private addSmoke(x: number, y: number, big: boolean, delay: number): void {
    const sp = clientConstants.effects.sprites;
    const key = `smoke_${big ? 'l' : 's'}_${pick(['a', 'b', 'c'])}`;
    if (!hasEffect(key)) return;
    const drift = (Math.random() * 2 - 1) * sp.smokeDriftPx;
    this.addSprite(key, x, y, delay, drift, -sp.smokeRisePx * (big ? 0.85 : 1), true);
  }

  /**
   * The blast flipbook for this damage type at the tier nearest the carve radius; past
   * the largest tier, satellite blasts round it; smoke left hanging for the big ones.
   */
  private blastSprite(
    x: number,
    y: number,
    carveRadius: number,
    damageRadius: number,
    damageType: string,
  ): boolean {
    if (!effectSpritesReady()) return false;
    const sp = clientConstants.effects.sprites;
    const radius = carveRadius > 0 ? carveRadius : damageRadius * sp.noCarveRadiusFraction;
    const tier = nearestTier(sp.blastTiers, radius);
    const key = keyForType('blast', damageType, `_${tier.tier}`, hasEffect);
    if (!key) return false;
    this.addSprite(key, x, y);
    const extra = satelliteCount(radius, sp.satelliteFromPx, sp.satellitePerPx, sp.maxSatellites);
    const satKey = keyForType('blast', damageType, `_${sp.satelliteTier}`, hasEffect);
    const turn = Math.random() * Math.PI * 2;
    for (let i = 0; i < extra && satKey; i++) {
      const a = turn + (i * Math.PI * 2) / extra;
      const r = radius * sp.satelliteSpread;
      this.addSprite(
        satKey,
        x + Math.cos(a) * r,
        y + Math.sin(a) * r * 0.6,
        (i + 1) * sp.satelliteDelayTicks,
      );
    }
    if (sp.lingerSmokeTypes.includes(damageType)) {
      const n = (sp.lingerSmoke[tier.tier] ?? 0) + extra;
      for (let i = 0; i < n; i++) {
        const ox = (Math.random() * 2 - 1) * radius * 0.4;
        this.addSmoke(
          x + ox,
          y - radius * 0.9,
          i % 2 === 0,
          sp.lingerSmokeDelayTicks + i * sp.lingerSmokeGapTicks,
        );
      }
    }
    return true;
  }

  /** The hit pop for this damage type; the code sparks still fly off on top. */
  private hitSprite(x: number, y: number, damageType: string): boolean {
    if (!effectSpritesReady()) return false;
    const key = keyForType('hit', damageType, '', hasEffect);
    if (!key) return false;
    this.addSprite(key, x, y);
    return true;
  }

  /** A column of light as tiled segments of the nearest width, and its ground burst. */
  private beamSprite(x: number, y1: number, y2: number, width: number): boolean {
    if (!effectSpritesReady()) return false;
    const tier = nearestTier(clientConstants.effects.sprites.beamTiers, width);
    const key = `beam_${tier.tier}`;
    if (!hasEffect(key)) return false;
    this.spriteBeams.push({ key, x, top: Math.min(y1, y2), bottom: Math.max(y1, y2), age: 0 });
    if (hasEffect('beam_hit')) this.addSprite('beam_hit', x, Math.max(y1, y2));
    return true;
  }

  /** The fan of sparks a shell throws off a hull it actually damaged. */
  private impactSparks(x: number, y: number, damageType: string, sprite: boolean): void {
    const fx = clientConstants.effects;
    const h = fx.hit;
    const ramp = trailRamp(damageType);
    if (!sprite)
      this.flashes.push({
        x,
        y,
        r: h.popRadiusPx,
        life: h.popTicks,
        maxLife: h.popTicks,
        core: rampAt(ramp, 0),
        edge: rampAt(ramp, 0.5),
      });
    for (let i = 0; i < h.sparks; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.3 + Math.random() * 0.7) * h.sparkSpeed;
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - h.sparkSpeed * 0.3,
        life: h.sparkTicks * (0.5 + Math.random() * 0.6),
        maxLife: h.sparkTicks,
        size: 1,
        color: rampAt(ramp, Math.random() * 0.7),
        gravity: fx.debrisGravity * 0.7,
        edge: null,
      });
    }
  }

  /** Push a particle, dropping the oldest once the cap is reached. */
  private addParticle(p: Particle): void {
    const max = clientConstants.effects.maxParticles;
    if (this.particles.length >= max) this.particles.shift();
    this.particles.push(p);
  }

  /**
   * A floating number over a point, for something the event stream cannot place on its
   * own: a `heal` names a seat, not a position (DESIGN §4), so the scene looks the
   * mobile up and hands the coordinates over.
   */
  floatText(x: number, y: number, text: string, color: string): void {
    const fx = clientConstants.effects;
    this.texts.push({
      x,
      y,
      text,
      color,
      life: fx.damageTextTicks,
      maxLife: fx.damageTextTicks,
    });
  }

  /**
   * Damage over a mobile. Hits landing on the same seat inside
   * `damageTextMergeTicks` add into the popup already up — a multi-pellet shot reads as
   * one growing number instead of a column of overlapping ones — and anything that does
   * open a second popup is nudged sideways so the two never sit on top of each other.
   */
  private damageNumber(seat: number, x: number, y: number, amount: number): void {
    const fx = clientConstants.effects;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i] as FloatingText;
      if (t.seat !== seat || t.total === undefined) continue;
      if (t.maxLife - t.life > fx.damageTextMergeTicks) break;
      t.total += amount;
      t.text = `-${Math.round(t.total)}`;
      t.life = t.maxLife;
      return;
    }
    let px = x;
    for (let i = 0; i < this.texts.length; i++) {
      const t = this.texts[i] as FloatingText;
      if (Math.abs(t.x - px) < fx.damageTextSpreadPx && Math.abs(t.y - y) < fx.damageTextSpreadPx) {
        px += fx.damageTextSpreadPx;
      }
    }
    this.texts.push({
      x: px,
      y,
      text: `-${Math.round(amount)}`,
      color: fx.colors.damage,
      life: fx.damageTextTicks,
      maxLife: fx.damageTextTicks,
      seat,
      total: amount,
    });
  }

  /** Trail puffs behind every live projectile. Call once per simulated tick. */
  trail(projectiles: ProjectileState[]): void {
    const fx = clientConstants.effects;
    if (this.tick % fx.smokeEveryTicks !== 0) return;
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p || !p.alive) continue;
      const kind = p.def.trail ?? 'none';
      if (kind === 'none') continue;
      const ramp = trailRamp(p.def.damageType);
      const jitter = () => (Math.random() - 0.5) * 2;
      if (kind === 'smoke') {
        this.addParticle({
          x: p.x + jitter(),
          y: p.y + jitter(),
          vx: jitter() * 0.15,
          vy: -0.12 - Math.random() * 0.1,
          life: fx.smokeLifeTicks,
          maxLife: fx.smokeLifeTicks,
          size: fx.smokeSizePx,
          // Fresh puffs are the bright end of the ramp, older ones the dark end; the
          // fade to nothing does the rest.
          color: rampAt(ramp, Math.random() * 0.9),
          gravity: 0,
          edge: null,
        });
      } else if (kind === 'spark') {
        this.addParticle({
          x: p.x,
          y: p.y,
          vx: jitter() * 0.6,
          vy: jitter() * 0.6,
          life: fx.sparkLifeTicks,
          maxLife: fx.sparkLifeTicks,
          size: Math.random() < 0.25 ? 2 : 1,
          color: rampAt(ramp, Math.random() * 0.7),
          gravity: 0,
          edge: null,
        });
      } else {
        this.addParticle({
          x: p.x + jitter() * 2,
          y: p.y,
          vx: jitter() * 0.2,
          vy: -0.25,
          life: fx.bubbleLifeTicks,
          maxLife: fx.bubbleLifeTicks,
          size: 2,
          color: rampAt(ramp, Math.random() * 0.6),
          gravity: 0,
          edge: null,
        });
      }
    }
  }

  /** Advance every particle one tick. */
  step(): void {
    this.tick++;
    const fx = clientConstants.effects;

    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const sp = this.sprites[i] as SpriteFx;
      sp.age++;
      if (sp.age <= 0) continue;
      sp.x += sp.vx;
      sp.y += sp.vy;
      const clip = effectClip(sp.key);
      if (!clip || clipFrameAt(clip, sp.age) < 0) this.sprites.splice(i, 1);
    }
    for (let i = this.spriteBeams.length - 1; i >= 0; i--) {
      const b = this.spriteBeams[i] as SpriteBeam;
      b.age++;
      const clip = effectClip(b.key);
      if (!clip || clipFrameAt(clip, b.age) < 0) this.spriteBeams.splice(i, 1);
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i] as SmokeEmitter;
      if (em.wait > 0) {
        em.wait--;
        continue;
      }
      if (em.left % fx.sprites.deathSmokeEveryTicks === 0) {
        this.addSmoke(em.x + (Math.random() * 2 - 1) * 4, em.y, em.count % 3 !== 2, 0);
        em.count++;
      }
      em.left--;
      if (em.left <= 0) this.emitters.splice(i, 1);
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i] as Flash;
      f.life--;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring;
      if (r.delay > 0) {
        r.delay--;
        continue;
      }
      r.life--;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i] as Puff;
      if (p.delay > 0) {
        p.delay--;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.grow;
      p.life--;
      if (p.life <= 0) this.puffs.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i] as FloatingText;
      t.y -= fx.damageTextRisePx;
      t.life--;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i] as Beam;
      b.life--;
      if (b.life <= 0) this.beams.splice(i, 1);
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i] as Mark;
      m.life--;
      if (m.life <= 0) this.marks.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const fx = clientConstants.effects;
    const ox = camera.offsetX;
    const oy = camera.offsetY;

    // Smoke first, so the fire and the sparks sit in front of their own cloud.
    this.drawPuffs(ctx, camera, true);
    this.drawSprites(ctx, camera, true);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p || !camera.isVisible(p.x, p.y, 16)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      const x = Math.round(p.x - ox);
      const y = Math.round(p.y - oy);
      if (p.edge) {
        // A chunk of ground: lit fill, dark on its lower right, 1 px of ground shadow.
        ctx.fillStyle = p.edge;
        ctx.fillRect(x, y, p.size + 1, p.size + 1);
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    this.drawPuffs(ctx, camera, false);
    this.drawSpriteBeams(ctx, camera);
    this.drawSprites(ctx, camera, false);

    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      if (!f || !camera.isVisible(f.x, f.y, f.r + 32)) continue;
      const t = f.life / f.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = f.edge;
      ctx.beginPath();
      ctx.arc(f.x - ox, f.y - oy, f.r * (0.7 + (1 - t) * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = f.core;
      ctx.beginPath();
      ctx.arc(f.x - ox, f.y - oy, f.r * 0.45 * t + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r || r.delay > 0) continue;
      const t = 1 - r.life / r.maxLife;
      const radius = r.from + (r.to - r.from) * t;
      if (!camera.isVisible(r.x, r.y, radius + 32)) continue;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x - ox, r.y - oy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // Beams: a white core inside a coloured glow, fading over their life.
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (!b) continue;
      const t = b.life / b.maxLife;
      const midX = (b.x1 + b.x2) / 2;
      const midY = (b.y1 + b.y2) / 2;
      if (!camera.isVisible(midX, midY, Math.abs(b.y2 - b.y1) / 2 + b.width + 32)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      ctx.lineCap = 'butt';
      ctx.strokeStyle = fx.colors.beamGlow;
      ctx.lineWidth = b.width + fx.beamGlowPx * 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(b.x1 - ox), Math.round(b.y1 - oy));
      ctx.lineTo(Math.round(b.x2 - ox), Math.round(b.y2 - oy));
      ctx.stroke();
      ctx.strokeStyle = fx.colors.beamCore;
      ctx.lineWidth = Math.max(1, b.width * fx.beamCoreFraction);
      ctx.beginPath();
      ctx.moveTo(Math.round(b.x1 - ox), Math.round(b.y1 - oy));
      ctx.lineTo(Math.round(b.x2 - ox), Math.round(b.y2 - oy));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    this.drawMarks(ctx, camera);

    // The same 3x5 face the HP plates use, at 2x: a damage number is a HUD number that
    // happens to stand in the world.
    for (let i = 0; i < this.texts.length; i++) {
      const t = this.texts[i];
      if (!t || !camera.isVisible(t.x, t.y, 32)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.maxLife));
      drawPixelText(ctx, t.text, Math.round(t.x - ox), Math.round(t.y - oy), {
        color: t.color,
        scale: fx.damageTextScale,
        align: 'center',
        shadow: clientConstants.canvas.background,
      });
    }
    ctx.globalAlpha = 1;

    // The world layer ends here: give the camera back whatever the shake borrowed.
    worldShake.endWorldFrame(camera);
  }

  /** The flipbooks, back (smoke) or front (everything else), each at its own age. */
  private drawSprites(ctx: CanvasRenderingContext2D, camera: Camera, back: boolean): void {
    const ox = camera.offsetX;
    const oy = camera.offsetY;
    for (let i = 0; i < this.sprites.length; i++) {
      const sp = this.sprites[i];
      if (!sp || sp.back !== back || sp.age < 0) continue;
      const clip = effectClip(sp.key);
      if (!clip) continue;
      const reach = Math.max(clip.size[0], clip.size[1]);
      if (!camera.isVisible(sp.x, sp.y, reach)) continue;
      const frame = clipFrameAt(clip, sp.age);
      if (frame >= 0) drawEffectFrame(ctx, clip, frame, sp.x - ox, sp.y - oy);
    }
  }

  /** Beams: the segment tiled from the top of the column to where it lands, the last one cut. */
  private drawSpriteBeams(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const ox = camera.offsetX;
    const oy = camera.offsetY;
    for (let i = 0; i < this.spriteBeams.length; i++) {
      const b = this.spriteBeams[i];
      if (!b) continue;
      const clip = effectClip(b.key);
      if (!clip) continue;
      const frame = clipFrameAt(clip, b.age);
      if (frame < 0) continue;
      const tile = clip.size[1];
      const view = camera.viewHeight;
      // Only the tiles on screen: a sky beam starts at the top of the world.
      const first = Math.max(b.top, oy - tile);
      const start = b.top + Math.floor((first - b.top) / tile) * tile;
      for (let y = start; y < b.bottom && y < oy + view + tile; y += tile) {
        if (!camera.isVisible(b.x, y + tile / 2, tile + clip.size[0])) continue;
        drawEffectFrame(ctx, clip, frame, b.x - ox, y - oy, b.bottom - y);
      }
    }
  }

  /** Fire or smoke, as chunky filled circles walking their ramp. */
  private drawPuffs(ctx: CanvasRenderingContext2D, camera: Camera, smoke: boolean): void {
    const ox = camera.offsetX;
    const oy = camera.offsetY;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (!p || p.delay > 0) continue;
      if (p.smoke !== smoke) continue;
      if (!camera.isVisible(p.x, p.y, p.r + 24)) continue;
      const age = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.life / p.maxLife) * 1.6));
      ctx.fillStyle = rampAt(p.ramp, age);
      ctx.beginPath();
      ctx.arc(Math.round(p.x - ox), Math.round(p.y - oy), Math.max(1, Math.round(p.r)), 0, Math.PI * 2);
      ctx.fill();
      // A brighter heart while the puff is young: two tones beat one flat disc.
      if (age < 0.5) {
        ctx.fillStyle = rampAt(p.ramp, Math.max(0, age - 0.2));
        ctx.beginPath();
        ctx.arc(
          Math.round(p.x - ox - p.r * 0.2),
          Math.round(p.y - oy - p.r * 0.2),
          Math.max(1, Math.round(p.r * 0.55)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A mark: four corner brackets that breathe in toward a pip, blinking on and off.
   * Chunkier than a circle and much easier to see over textured ground.
   */
  private drawMarks(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const fx = clientConstants.effects;
    const ox = camera.offsetX;
    const oy = camera.offsetY;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (!m) continue;
      const elapsed = m.maxLife - m.life;
      if (Math.floor(elapsed / fx.markBlinkTicks) % 2 !== 0) continue;
      if (!camera.isVisible(m.x, m.y, fx.markRadiusPx + 16)) continue;
      // The brackets close in as the strike gets nearer, which is the countdown.
      const t = Math.max(0, Math.min(1, m.life / m.maxLife));
      const r = Math.round(fx.markRadiusPx + fx.markBreathePx * t);
      const arm = fx.markBracketPx;
      const x = Math.round(m.x - ox);
      const y = Math.round(m.y - oy);
      ctx.fillStyle = fx.colors.mark;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const cx = x + sx * r;
          const cy = y + sy * r;
          ctx.fillRect(sx < 0 ? cx : cx - arm + 1, cy, arm, 1);
          ctx.fillRect(cx, sy < 0 ? cy : cy - arm + 1, 1, arm);
        }
      }
      ctx.fillRect(x - fx.markPipPx, y - fx.markPipPx, fx.markPipPx * 2, fx.markPipPx * 2);
    }
  }
}
