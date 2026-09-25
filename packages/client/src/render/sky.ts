/**
 * Sky events on screen (DESIGN §5, §1.3 "render/effects.ts: … sky-event visuals").
 *
 * The simulation owns what a sky event *does*; this module owns what it looks like.
 * Three things are drawn:
 *
 * - the **tornado**'s column, a translucent funnel with swirl bands riding up it;
 * - the **Force** band, a glowing horizontal strip with chevrons drifting through it;
 * - **Thor**, a satellite at the top of the map with its level badge, and a flash down
 *   the column every time it strikes.
 *
 * Plus one HUD line naming the active event, so a player who cannot see the satellite
 * (the map is two screens wide) still knows what the sky is doing.
 *
 * Nothing here is read by the simulation: every number it draws with lives in
 * `data/clientConstants.sky`, with the rest of the presentation tunables.
 */
import { cosDeg, sinDeg, sky } from '@gunbros/shared';
import type { SimEvent, SkyState } from '@gunbros/shared';
import type { Camera } from './camera.js';
import { drawNineSlice } from './uiKit.js';
import { belowOrderPanelY, clientConstants } from '../data/clientConstants.js';
import type { HudVariant } from '../data/clientConstants.js';

/** What the renderer reads: the simulation's own sky state (DESIGN §5). */
export type SkyView = SkyState;

/** Map bounds the sky is drawn against. */
export interface SkyBounds {
  width: number;
  height: number;
}

/** Presentation tunables for everything below (DESIGN §7 item 123). */
const skyRender = clientConstants.sky;

interface Flash {
  x: number;
  y: number;
  life: number;
}

/** Name of the event as the HUD writes it, with the turns it has left. */
function labelFor(view: SkyView): string | null {
  let name: string;
  switch (view.kind) {
    case 'thor':
      name = `SKY: THOR  LV ${Math.max(1, Math.round(view.level))}`;
      break;
    case 'tornado':
      name = 'SKY: TORNADO';
      break;
    case 'force':
      name = `SKY: FORCE  x${sky.force.multiplier}`;
      break;
    default:
      return null;
  }
  // A pinned sky has no countdown (DESIGN §5); weather that comes and goes says when.
  if (view.turnsLeft <= 0) return name;
  return `${name}  ${view.turnsLeft === 1 ? 'LAST TURN' : `${view.turnsLeft} TURNS`}`;
}

/** What the arrival banner calls each event. */
export function skyEventTitle(kind: SkyView['kind']): string {
  switch (kind) {
    case 'thor':
      return 'THOR';
    case 'tornado':
      return 'TORNADO';
    case 'force':
      return 'FORCE BAND';
    default:
      return 'CLEAR SKY';
  }
}

export class SkyRenderer {
  private flashes: Flash[] = [];
  private levelPulse = 0;
  private frame = 0;

  clear(): void {
    this.flashes = [];
    this.levelPulse = 0;
  }

  /** Thor's own events (DESIGN §5); everything else is drawn from the state. */
  consume(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'skyStrike') {
        this.flashes.push({ x: e.x, y: e.y, life: skyRender.thor.flashFrames });
      } else if (e.t === 'skyLevelUp') {
        this.levelPulse = skyRender.thor.levelPulseFrames;
      }
    }
  }

  /**
   * The world layer: the funnel, the band and the satellite, in world coordinates, so
   * they scroll with the camera like everything else.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    view: SkyView,
    bounds: SkyBounds,
    frameTick: number,
  ): void {
    this.frame = frameTick;
    if (this.levelPulse > 0) this.levelPulse--;
    if (view.kind === 'tornado') this.drawTornado(ctx, camera, view, bounds);
    else if (view.kind === 'force') this.drawForce(ctx, camera, view);
    else if (view.kind === 'thor') this.drawThor(ctx, camera, view, bounds);
    this.drawFlashes(ctx, camera);
  }

  /**
   * One line naming the active event, under the upcoming-order panel. `variant` comes
   * from the HUD's own layout rather than from the canvas height: the two have to name
   * the same row, and only `bottomBarLayout` knows which one it picked.
   */
  drawLabel(ctx: CanvasRenderingContext2D, view: SkyView, variant: HudVariant): void {
    const text = labelFor(view);
    if (text === null) return;
    const l = skyRender.label;
    // Same row as the toggles, derived from the order panel above it so a fifth seat
    // in the list pushes both down together — but against the right edge, because the
    // left of the screen is where a mobile ends up when the camera runs out of map.
    const y = belowOrderPanelY(variant);
    ctx.font = clientConstants.hud.font;
    // Grows to fit the countdown, from its right edge, so it never runs off the plate.
    const width = Math.max(l.widthPx, Math.ceil(ctx.measureText(text).width) + l.textLeftPx * 2);
    const x = ctx.canvas.width - width - l.rightInsetPx;
    // The HUD's dark plate from the UI kit, or the plain one until the kit is in.
    if (!drawNineSlice(ctx, 'panel-dark', x, y, width, l.heightPx)) {
      ctx.fillStyle = l.back;
      ctx.fillRect(x, y, width, l.heightPx);
      ctx.strokeStyle = l.edge;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, l.heightPx - 1);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle =
      view.kind === 'thor' && this.levelPulse > 0
        ? clientConstants.hud.accent
        : clientConstants.hud.fg;
    ctx.fillText(text, x + l.textLeftPx, y + l.textTopPx);
  }

  // ----------------------------------------------------------------------
  // Tornado
  // ----------------------------------------------------------------------

  /** Half-width of the funnel at a world y: wide at the top, tight at the foot. */
  private funnelHalfWidth(worldY: number, bounds: SkyBounds): number {
    const t = Math.max(0, Math.min(1, worldY / Math.max(1, bounds.height)));
    const c = skyRender.tornado;
    return sky.tornado.halfWidth * (c.topScale + (c.bottomScale - c.topScale) * t);
  }

  /**
   * How far the funnel leans at a world y. The phase lags with height, so the column
   * snakes rather than sliding sideways in one piece, and the foot barely moves — it is
   * the end that is pinned to the ground.
   */
  private funnelSway(worldY: number, bounds: SkyBounds): number {
    const c = skyRender.tornado;
    const t = Math.max(0, Math.min(1, worldY / Math.max(1, bounds.height)));
    return sinDeg(this.frame * c.swayPerFrame - worldY * c.swayPerPx) * c.swayPx * (1 - t * 0.75);
  }

  private drawTornado(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    view: SkyView,
    bounds: SkyBounds,
  ): void {
    const c = skyRender.tornado;
    const screenX = camera.worldToScreenX(view.x);
    const top = camera.worldToScreenY(0);
    const bottom = camera.worldToScreenY(bounds.height);
    if (screenX + sky.tornado.halfWidth * c.topScale < 0) return;
    if (screenX - sky.tornado.halfWidth * c.topScale > ctx.canvas.width) return;

    // The body is stacked slabs, not a smooth fill: each slab takes the next tone of a
    // four step ramp and the ramp walks down every frame, so the column reads as one
    // spiralling sheet rather than a pane of glass. Each slab keeps its own 1 px edge.
    const slab = c.slabHeightPx;
    const tones = c.slabTones;
    const spin = Math.floor(this.frame * c.slabSpinPerFrame);
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(ctx.canvas.height, bottom); y += slab) {
      const worldY = camera.screenToWorld(0, y).y;
      const full = this.funnelHalfWidth(worldY, bounds);
      // Each slab is a slice of a turning funnel: it slides off centre and narrows as
      // the side it shows rotates away, which is what makes the stack read as a spiral.
      const phase = worldY * c.slabTwistPerPx + this.frame * c.slabTwistPerFrame;
      const half = full * (1 - c.slabPinch * (1 - cosDeg(phase)) * 0.5);
      const cx = screenX + this.funnelSway(worldY, bounds) + sinDeg(phase) * full * c.slabShift;
      const band = Math.floor(y / slab) + spin;
      const tone = tones[((band % tones.length) + tones.length) % tones.length] as string;
      const height = Math.min(slab, Math.min(ctx.canvas.height, bottom) - y);
      ctx.fillStyle = tone;
      ctx.fillRect(Math.round(cx - half), y, Math.round(half * 2), height);
      ctx.fillStyle = c.outline;
      ctx.fillRect(Math.round(cx - half), y, 1, height);
      ctx.fillRect(Math.round(cx + half) - 1, y, 1, height);
      // A hard line between slabs is what turns the ramp into banding at 1x.
      ctx.fillStyle = c.slabSeam;
      ctx.fillRect(Math.round(cx - half), y, Math.round(half * 2), 1);
    }

    // Swirl bands riding up the column. Each band is a horizontal slab whose ends are
    // offset by a sine of its height, which reads as rotation without any rotation.
    const spacing = c.bandSpacingPx;
    const travel = (this.frame * c.bandRisePx) % spacing;
    for (let worldY = -spacing; worldY <= bounds.height + spacing; worldY += spacing) {
      const bandY = worldY - travel;
      const screenY = camera.worldToScreenY(bandY);
      if (screenY < -c.bandHeightPx || screenY > ctx.canvas.height) continue;
      const half = this.funnelHalfWidth(bandY, bounds);
      const phase = bandY * c.swirlPerPx + this.frame * c.swirlPerFrame;
      const offset = sinDeg(phase) * half * 0.55;
      const width = half * (0.5 + 0.45 * Math.abs(cosDeg(phase)));
      const cx = screenX + this.funnelSway(bandY, bounds);
      const left = Math.round(cx + offset - width / 2);
      const w = Math.max(2, Math.round(width));
      ctx.fillStyle = sinDeg(phase) > 0 ? c.band : c.bandDim;
      ctx.fillRect(left, Math.round(screenY), w, c.bandHeightPx);
      // Outline the band so it stands off the body instead of dissolving into it.
      ctx.fillStyle = c.bandEdge;
      ctx.fillRect(left, Math.round(screenY) - 1, w, 1);
      ctx.fillRect(left, Math.round(screenY) + c.bandHeightPx, w, 1);
    }

    // The core, snaking with the same twist as the slabs: a straight line down the
    // middle is exactly what made this read as a pane of glass.
    ctx.fillStyle = c.bodyEdge;
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(ctx.canvas.height, bottom); y += 2) {
      const worldY = camera.screenToWorld(0, y).y;
      const full = this.funnelHalfWidth(worldY, bounds);
      const phase = worldY * c.slabTwistPerPx + this.frame * c.slabTwistPerFrame;
      const cx = screenX + this.funnelSway(worldY, bounds) + sinDeg(phase) * full * c.slabShift;
      ctx.fillRect(Math.round(cx) - 1, y, 2, 2);
    }

    // Torn-up ground spiralling up the funnel. Each speck keeps a fixed phase and its
    // height is the frame counter modulo the map height, so the whole flight is one
    // expression and nothing has to be stored between frames.
    for (let i = 0; i < c.debris; i++) {
      const phase = (i * 360) / c.debris;
      const climbed = (this.frame * c.debrisRisePx + i * 37) % (bounds.height + 40);
      const worldY = bounds.height - climbed;
      const screenY = camera.worldToScreenY(worldY);
      if (screenY < -4 || screenY > ctx.canvas.height) continue;
      const half = this.funnelHalfWidth(worldY, bounds);
      const swing = sinDeg(phase + worldY * c.swirlPerPx + this.frame * c.swirlPerFrame);
      const size = climbed < bounds.height * 0.4 ? 2 : 1;
      // Every fourth speck is a leaf: torn foliage rides the funnel with the grit.
      ctx.fillStyle = i % 4 === 0 ? c.leafColor : swing > 0 ? c.debrisColor : c.debrisDarkColor;
      const cx = screenX + this.funnelSway(worldY, bounds);
      ctx.fillRect(Math.round(cx + swing * half * 0.95), Math.round(screenY), size, size);
    }

    // A skirt of dust where the funnel touches down: three widening bands.
    const footY = camera.worldToScreenY(bounds.height);
    const footSway = this.funnelSway(bounds.height, bounds);
    ctx.fillStyle = c.skirtColor;
    for (let i = 0; i < 3; i++) {
      const y = Math.round(footY - c.skirtHeightPx + (i * c.skirtHeightPx) / 3);
      const width = this.funnelHalfWidth(bounds.height, bounds) * (2.2 + i * 1.1);
      ctx.fillRect(
        Math.round(screenX + footSway - width / 2),
        y,
        Math.round(width),
        Math.ceil(c.skirtHeightPx / 3),
      );
    }

    // A ring of chunks tumbling round the touchdown, drawn on an ellipse so the ones at
    // the back sit higher: the foot of the funnel is where the ground is coming apart,
    // and a flat skirt alone never said that.
    const ringHalf = this.funnelHalfWidth(bounds.height, bounds);
    for (let i = 0; i < c.footChunks; i++) {
      const phase = (i * 360) / c.footChunks + this.frame * c.footSpinPerFrame;
      const x = screenX + footSway + cosDeg(phase) * ringHalf * c.footRingScale;
      const y = footY - c.footRingLiftPx + sinDeg(phase) * c.footRingRisePx;
      const size = sinDeg(phase) > 0 ? 2 : 3;
      ctx.fillStyle = sinDeg(phase) > 0 ? c.debrisDarkColor : c.debrisColor;
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
    }
  }

  // ----------------------------------------------------------------------
  // Force
  // ----------------------------------------------------------------------

  private drawForce(ctx: CanvasRenderingContext2D, camera: Camera, view: SkyView): void {
    const c = skyRender.force;
    const top = camera.worldToScreenY(view.top);
    const bottom = camera.worldToScreenY(view.bottom);
    if (bottom < 0 || top > ctx.canvas.height) return;
    const height = Math.max(1, bottom - top);
    const stripHeight = height / c.strips;

    for (let i = 0; i < c.strips; i++) {
      // Brightest through the middle of the band, fading to both edges.
      const t = Math.abs((i + 0.5) / c.strips - 0.5) * 2;
      const alpha = c.edgeAlpha + (c.coreAlpha - c.edgeAlpha) * (1 - t);
      ctx.fillStyle = `rgba(${c.color}, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, Math.round(top + i * stripHeight), ctx.canvas.width, Math.ceil(stripHeight));
    }

    ctx.fillStyle = c.edge;
    ctx.fillRect(0, Math.round(top), ctx.canvas.width, 1);
    ctx.fillRect(0, Math.round(bottom) - 1, ctx.canvas.width, 1);

    // Chevrons drifting along the band, which is what makes it read as a current.
    const midY = Math.round(top + height / 2);
    const drift = (this.frame * c.chevronSpeedPx) % c.chevronSpacingPx;
    ctx.fillStyle = c.chevron;
    for (let x = -c.chevronSpacingPx; x < ctx.canvas.width + c.chevronSpacingPx; x += c.chevronSpacingPx) {
      const cx = Math.round(x + drift);
      for (let i = 0; i < c.chevronHeightPx; i++) {
        const w = Math.max(1, Math.round((c.chevronWidthPx * (c.chevronHeightPx - i)) / c.chevronHeightPx));
        ctx.fillRect(cx, midY - i, w, 1);
        if (i > 0) ctx.fillRect(cx, midY + i, w, 1);
      }
    }
  }

  // ----------------------------------------------------------------------
  // Thor
  // ----------------------------------------------------------------------

  private drawThor(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    view: SkyView,
    bounds: SkyBounds,
  ): void {
    const c = skyRender.thor;
    const bob = sinDeg((this.frame / c.bobFrames) * 360) * c.bobPx;
    const x = Math.round(
      Math.max(
        c.edgeMarginPx,
        Math.min(ctx.canvas.width - c.edgeMarginPx, camera.worldToScreenX(bounds.width / 2)),
      ),
    );
    const y = Math.round(Math.max(c.minScreenY, camera.worldToScreenY(c.topPx)) + bob);
    if (y > ctx.canvas.height) return;

    const hot = this.levelPulse > 0 && Math.floor(this.frame / 4) % 2 === 0;

    // Solar panels.
    ctx.fillStyle = c.panel;
    ctx.fillRect(x - c.bodyW / 2 - c.panelW, y - c.panelH / 2, c.panelW, c.panelH);
    ctx.fillRect(x + c.bodyW / 2, y - c.panelH / 2, c.panelW, c.panelH);
    ctx.fillStyle = c.panelEdge;
    ctx.fillRect(x - c.bodyW / 2 - c.panelW, y - c.panelH / 2, c.panelW, 1);
    ctx.fillRect(x + c.bodyW / 2, y - c.panelH / 2, c.panelW, 1);

    // Hull.
    ctx.fillStyle = c.bodyDark;
    ctx.fillRect(x - c.bodyW / 2, y - c.bodyH / 2, c.bodyW, c.bodyH);
    ctx.fillStyle = c.body;
    ctx.fillRect(x - c.bodyW / 2 + 1, y - c.bodyH / 2 + 1, c.bodyW - 2, c.bodyH / 2);

    // Hull detail: a panel seam, a dish on top and a mast with a blinking beacon, so
    // the satellite reads as a machine rather than as a grey box.
    ctx.fillStyle = c.bodyDark;
    ctx.fillRect(x - c.bodyW / 2 + 2, y, c.bodyW - 4, 1);
    ctx.fillStyle = c.body;
    for (let r = 0; r < c.dishPx; r++) {
      const half = Math.round((c.dishPx / 2) * (r / c.dishPx));
      ctx.fillRect(x - half - 1, y - c.bodyH / 2 - c.dishPx + r, half * 2 + 2, 1);
    }
    ctx.fillStyle = c.bodyDark;
    ctx.fillRect(x + c.bodyW / 2 - 3, y - c.bodyH / 2 - c.antennaPx, 1, c.antennaPx);
    if (Math.floor(this.frame / c.beaconFrames) % 2 === 0) {
      ctx.fillStyle = c.beacon;
      ctx.fillRect(x + c.bodyW / 2 - 4, y - c.bodyH / 2 - c.antennaPx - 2, 3, 2);
    }

    // The lens it fires through, pointing down, with its charge glow behind it.
    ctx.fillStyle = c.lensGlow;
    ctx.fillRect(x - c.lensGlowPx, y + c.bodyH / 2, c.lensGlowPx * 2, c.lensGlowPx);
    ctx.fillStyle = hot ? c.lensHot : c.lens;
    ctx.fillRect(x - 3, y + c.bodyH / 2, 6, 3);
    ctx.fillRect(x - 1, y + c.bodyH / 2 + 3, 2, 2);

    // Level badge.
    const level = Math.max(1, Math.min(sky.thor.maxLevel, Math.round(view.level)));
    const bx = x - c.badgeWidthPx / 2;
    const by = y + c.bodyH / 2 + 8;
    ctx.fillStyle = c.badgeBack;
    ctx.fillRect(bx, by, c.badgeWidthPx, c.badgeHeightPx);
    ctx.strokeStyle = c.badgeEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, c.badgeWidthPx - 1, c.badgeHeightPx - 1);
    ctx.font = clientConstants.hud.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = c.badgeFg;
    ctx.fillText(`LV ${level}`, x, by + 1);
    ctx.textAlign = 'left';
  }

  /** The column of light a strike leaves behind, fading over `flashFrames`. */
  private drawFlashes(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.flashes.length === 0) return;
    const c = skyRender.thor;
    const alive: Flash[] = [];
    for (const f of this.flashes) {
      const t = f.life / c.flashFrames;
      const x = camera.worldToScreenX(f.x);
      const bottom = camera.worldToScreenY(f.y);
      const top = camera.worldToScreenY(0);
      ctx.fillStyle = `rgba(${c.flashGlow}, ${(0.35 * t).toFixed(3)})`;
      ctx.fillRect(Math.round(x - c.flashWidthPx / 2), top, c.flashWidthPx, Math.round(bottom - top));
      ctx.fillStyle = `rgba(${c.flashCore}, ${(0.8 * t).toFixed(3)})`;
      const core = Math.max(2, Math.round(c.flashWidthPx * 0.25 * t));
      ctx.fillRect(Math.round(x - core / 2), top, core, Math.round(bottom - top));
      f.life--;
      if (f.life > 0) alive.push(f);
    }
    this.flashes = alive;
  }
}
