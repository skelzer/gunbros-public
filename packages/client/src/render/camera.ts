/**
 * Camera (DESIGN §1.3 render/camera.ts): world -> screen offset, clamped to the map,
 * with eased follow, a "return to" move for after a shot, mouse drag and edge scroll.
 *
 * The camera holds the top-left of the view in world pixels. Drawing always uses the
 * rounded offsets so the terrain and the sprites land on whole backbuffer pixels.
 */
import { clamp } from '@gunbros/shared';
import type { ProjectileState, SimEvent } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';

export interface CameraTarget {
  x: number;
  y: number;
}

export class Camera {
  x = 0;
  y = 0;
  /** Free camera: follow calls are ignored until it is turned back off. */
  free = false;

  private dragging = false;
  private dragAnchorX = 0;
  private dragAnchorY = 0;
  private dragCameraX = 0;
  private dragCameraY = 0;

  constructor(
    public viewWidth: number,
    public viewHeight: number,
    private mapWidth: number,
    private mapHeight: number,
  ) {}

  setMapSize(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
    this.clampSelf();
  }

  /**
   * The internal resolution changed under us — a rotation, a resized window (DESIGN §7
   * item 142). The view is the window onto the map, so its size is the clamp: a shorter
   * view can see further down before it runs out of map.
   */
  setViewSize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.clampSelf();
  }

  /** Rounded offsets: what every draw call should subtract. */
  get offsetX(): number {
    return Math.round(this.x);
  }

  get offsetY(): number {
    return Math.round(this.y);
  }

  worldToScreenX(worldX: number): number {
    return worldX - this.offsetX;
  }

  worldToScreenY(worldY: number): number {
    return worldY - this.offsetY;
  }

  screenToWorld(screenX: number, screenY: number): CameraTarget {
    return { x: screenX + this.offsetX, y: screenY + this.offsetY };
  }

  /** Is a world circle anywhere near the view? Used to skip off-screen work. */
  isVisible(worldX: number, worldY: number, margin = 0): boolean {
    return (
      worldX >= this.x - margin &&
      worldX <= this.x + this.viewWidth + margin &&
      worldY >= this.y - margin &&
      worldY <= this.y + this.viewHeight + margin
    );
  }

  /** Snap the view so (x, y) is in the middle. */
  centreOn(x: number, y: number): void {
    this.x = x - this.viewWidth / 2;
    this.y = y - this.viewHeight / 2;
    this.clampSelf();
  }

  /** Ease toward centring (x, y). Call once per rendered frame. */
  follow(x: number, y: number, ease = clientConstants.camera.followEase): void {
    if (this.free || this.dragging) return;
    const targetX = x - this.viewWidth / 2;
    const targetY = y - this.viewHeight / 2;
    this.x += (targetX - this.x) * ease;
    this.y += (targetY - this.y) * ease;
    this.clampSelf();
  }

  /** The slower move back to the mobile once a shot has resolved. */
  returnTo(x: number, y: number): void {
    this.follow(x, y, clientConstants.camera.returnEase);
  }

  /**
   * Keep (worldX, worldY) out of the block of fixed HUD in the top-left corner — the
   * upcoming-order panel, the toggles and the sky badge under them. `follow` centres the
   * mobile, which is clear of all of it, but the clamp to the map edge is not: a mobile
   * near the top-left corner of the map ends up drawn behind the panel with its name tag
   * under the badge.
   *
   * Whichever way out is shorter is taken, and only as far as the map allows — at the
   * very corner of the map there is nowhere left to go, which is why the badge itself
   * lives on the other side of the screen (`sky.drawLabel`).
   */
  clearHudCorner(worldX: number, worldY: number): void {
    if (this.free || this.dragging) return;
    const c = clientConstants.camera.hudCorner;
    const screenX = worldX - this.x;
    const screenY = worldY - this.y;
    if (screenX > c.widthPx || screenY > c.heightPx) return;
    const down = c.heightPx - screenY;
    const right = c.widthPx - screenX;
    if (down <= right) this.y -= down;
    else this.x -= right;
    this.clampSelf();
  }

  // --- free camera --------------------------------------------------------

  beginDrag(screenX: number, screenY: number): void {
    this.dragging = true;
    this.dragAnchorX = screenX;
    this.dragAnchorY = screenY;
    this.dragCameraX = this.x;
    this.dragCameraY = this.y;
  }

  dragTo(screenX: number, screenY: number): void {
    if (!this.dragging) return;
    this.x = this.dragCameraX - (screenX - this.dragAnchorX);
    this.y = this.dragCameraY - (screenY - this.dragAnchorY);
    this.clampSelf();
  }

  endDrag(): void {
    this.dragging = false;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  /**
   * Edge scroll from a pointer position in backbuffer space. Only active while the free
   * camera is on, so it cannot fight the follow during a shot.
   */
  edgeScroll(screenX: number, screenY: number): void {
    if (!this.free || this.dragging) return;
    const margin = clientConstants.camera.edgeScrollMarginPx;
    const speed = clientConstants.camera.edgeScrollSpeedPx;
    if (screenX < 0 || screenY < 0 || screenX > this.viewWidth || screenY > this.viewHeight) return;
    if (screenX < margin) this.x -= speed;
    else if (screenX > this.viewWidth - margin) this.x += speed;
    if (screenY < margin) this.y -= speed;
    else if (screenY > this.viewHeight - margin) this.y += speed;
    this.clampSelf();
  }

  /** Nudge the view by world px (keyboard panning in free mode). */
  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampSelf();
  }

  private clampSelf(): void {
    const maxX = Math.max(0, this.mapWidth - this.viewWidth);
    const maxY = Math.max(0, this.mapHeight - this.viewHeight);
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
  }
}

export function createCamera(
  viewWidth: number,
  viewHeight: number,
  mapWidth: number,
  mapHeight: number,
): Camera {
  return new Camera(viewWidth, viewHeight, mapWidth, mapHeight);
}

// --------------------------------------------------------------------------
// Director
// --------------------------------------------------------------------------

/** What the director needs to know about the world this frame. */
export interface DirectorFrame {
  /** Where the camera rests: the active mobile, already offset by `focusHeightPx`. */
  focusX: number;
  focusY: number;
  /** Projectiles in flight. The biggest, most recent one is the one worth watching. */
  projectiles: readonly ProjectileState[];
  /** True while the turn is `resolving`: the shot owns the camera, not the mouse. */
  resolving: boolean;
  /** Pointer in backbuffer space; only `inside` positions edge-scroll. */
  pointer: { x: number; y: number; inside: boolean };
}

/**
 * The camera rules of DESIGN §1.3 (`render/camera.ts`: "follow projectile, return to
 * next player, free drag / edge scroll"), in one place:
 *
 * - while a shot is in flight the camera follows it — the largest projectile, and the
 *   most recently spawned one of equal size, so a multi-shot tracks its newest shell;
 * - `projectileExpire` (a shot that left the world) cuts the linger short, because
 *   there is no explosion to look at (DESIGN §7 item 24);
 * - `turnStart` eases the view to the seat that is about to play;
 * - the player may drag or edge-scroll while waiting or aiming, and that manual move
 *   sticks until the next shot is fired, which takes the camera back.
 */
export class CameraDirector {
  /** Sticky free-camera toggle (the `F` key). Released when a shot is fired. */
  free = false;

  private manual = false;
  private lingerTicks = 0;
  private turnEaseTicks = 0;
  private explosionX = 0;
  private explosionY = 0;
  private hasExplosion = false;

  constructor(public readonly camera: Camera) {}

  /** Is the camera under manual control (free toggle or a drag) right now? */
  get isManual(): boolean {
    return this.free || this.manual;
  }

  toggleFree(): boolean {
    this.free = !this.free;
    if (!this.free) this.camera.endDrag();
    this.camera.free = this.free;
    return this.free;
  }

  /** Drop every manual override and take the camera back (a shot was fired). */
  release(): void {
    this.manual = false;
    if (this.free) {
      this.free = false;
      this.camera.free = false;
    }
    this.camera.endDrag();
  }

  /** React to the events of one step. */
  consume(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'fire') {
        // "Any camera manual move is overridden when a shot is fired."
        this.release();
        this.lingerTicks = 0;
      } else if (e.t === 'turnStart') {
        this.manual = false;
        this.lingerTicks = 0;
        this.hasExplosion = false;
        this.turnEaseTicks = clientConstants.camera.returnDelayTicks;
      } else if (e.t === 'explosion') {
        this.explosionX = e.x;
        this.explosionY = e.y;
        this.hasExplosion = true;
        this.lingerTicks = clientConstants.camera.returnDelayTicks;
      } else if (e.t === 'projectileExpire') {
        // Nothing exploded: come back almost at once instead of staring at the sky.
        this.lingerTicks = Math.min(
          this.lingerTicks,
          clientConstants.camera.expireReturnDelayTicks,
        );
      }
    }
  }

  /** A drag may start here (world area, not over the HUD). */
  beginDrag(screenX: number, screenY: number, frame: { resolving: boolean }): void {
    if (frame.resolving && !this.free) return;
    this.manual = true;
    this.camera.beginDrag(screenX, screenY);
  }

  dragTo(screenX: number, screenY: number): void {
    this.camera.dragTo(screenX, screenY);
  }

  endDrag(): void {
    this.camera.endDrag();
  }

  /** Snap the view, ignoring every rule (a new match, a new map). */
  centreOn(x: number, y: number): void {
    this.manual = false;
    this.lingerTicks = 0;
    this.turnEaseTicks = 0;
    this.hasExplosion = false;
    this.camera.centreOn(x, y);
  }

  /** One rendered frame of camera movement. */
  update(frame: DirectorFrame): void {
    if (this.lingerTicks > 0) this.lingerTicks--;
    if (this.turnEaseTicks > 0) this.turnEaseTicks--;

    if (this.free) {
      if (frame.pointer.inside) this.camera.edgeScroll(frame.pointer.x, frame.pointer.y);
      this.manual = true;
      return;
    }

    const followed = pickProjectile(frame.projectiles);
    if (followed) {
      this.manual = false;
      this.camera.follow(followed.x, followed.y);
      return;
    }

    if (this.manual) {
      // The player moved the camera themselves; leave it where they put it. Edge
      // scrolling keeps working while they are waiting or aiming.
      if (frame.pointer.inside && !frame.resolving) {
        this.camera.free = true;
        this.camera.edgeScroll(frame.pointer.x, frame.pointer.y);
        this.camera.free = false;
      }
      return;
    }

    if (this.lingerTicks > 0 && this.hasExplosion) {
      this.camera.follow(this.explosionX, this.explosionY);
      return;
    }

    this.camera.follow(
      frame.focusX,
      frame.focusY,
      this.turnEaseTicks > 0
        ? clientConstants.camera.turnStartEase
        : clientConstants.camera.returnEase,
    );
    this.camera.clearHudCorner(frame.focusX, frame.focusY);
  }
}

/**
 * The projectile worth watching: the largest one (a bigfoot salvo's fat missile beats
 * its escorts), and among equals the most recent, which is the one the player just saw
 * leave the barrel. Ids increase with spawn order (DESIGN §2.5).
 */
function pickProjectile(
  projectiles: readonly ProjectileState[],
): ProjectileState | undefined {
  let best: ProjectileState | undefined;
  for (const p of projectiles) {
    if (!p || !p.alive) continue;
    if (!best) {
      best = p;
      continue;
    }
    if (p.def.radius > best.def.radius) best = p;
    else if (p.def.radius === best.def.radius && p.id > best.id) best = p;
  }
  return best;
}
