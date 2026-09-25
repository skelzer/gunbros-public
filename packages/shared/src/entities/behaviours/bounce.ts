/**
 * `bounce` — grub — the skipping shot.
 *
 * `ProjectileDef.bounces` and `restitution` already make a shell rebound off terrain
 * (`entities/projectile.ts`), but a pure reflection is not grub: a shell that keeps its
 * remaining energy after the last bounce detonates in mid-air on the next wall it
 * clips, and one that lands on a slope at a shallow angle jitters instead of running
 * down it. This module owns the feel.
 *
 * Every terrain contact is resolved here:
 *
 * - **Bounce** — the shell came down hard (normal speed ≥ `params.rollSpeed`) and has
 *   bounces left: the *into-surface* half of the velocity is reflected and keeps
 *   `restitution` of itself, the *along-surface* half keeps `params.bounceFriction`.
 *   Splitting the two is what makes it skip like a stone rather than stall: DESIGN §2.5
 *   calls `restitution` "bounce energy kept", which is the normal component, and a
 *   single scale on the whole vector would rob the shell of its run. One bounce is
 *   spent and a skip mark is emitted for the renderer.
 * - **Roll** — a glancing contact, or the bounces are spent: the velocity is projected
 *   onto the surface *tangent* and scaled by `params.rollFriction`. Gravity keeps
 *   pressing the shell into the ground, so it does this again a few times per tick and
 *   the result is a shell that runs along flat ground, accelerates down a slope and
 *   climbs the far side of a crater.
 * - **Rest** — the roll has fallen below `params.restSpeed` (or has gone on for
 *   `params.maxRollTicks`): it detonates where it stopped.
 *
 * A direct hit on a mobile always detonates: `onImpact` hands those back to the core.
 *
 * Data (`ProjectileDef.params` in `data/mobiles/grub.ts`):
 *   rollSpeed        normal speed below which a contact rolls instead of bouncing
 *   bounceFriction   along-surface speed kept per bounce
 *   rollFriction     speed kept per rolling contact
 *   restSpeed        speed at which a rolling shell stops and goes off
 *   clearancePx      px the shell is lifted off the surface after a contact; it is also
 *                    what sets how often a rolling shell touches down again, since
 *                    gravity has to pull it back through that gap every time
 *   maxRollTicks     safety cap, so a shell rolling down an endless slope still resolves
 */
import type { Behaviour, BehaviourContext } from './registry.js';
import { constants } from '../../data/constants.js';

/** Render tag for the skip marks. */
const BOUNCE_KIND = 'bounce';

/** `p.data.rollFrom` when the shell is not rolling. */
const NOT_ROLLING = -1;

/**
 * Surface normal at a contact point: sum the directions of the air pixels around it.
 * Deterministic — integer sums and one `Math.sqrt` (DESIGN §2.1). Same estimate the
 * core's own bounce uses; a behaviour cannot reach that copy, and duplicating five
 * lines is cheaper than exporting it from `entities/projectile.ts`, which no Phase 4
 * group may edit.
 */
function surfaceNormal(ctx: BehaviourContext, x: number, y: number): { x: number; y: number } {
  let nx = 0;
  let ny = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!ctx.terrain.isSolid(x + dx, y + dy)) {
        nx += dx;
        ny += dy;
      }
    }
  }
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len === 0) return { x: 0, y: -1 };
  return { x: nx / len, y: ny / len };
}

export const bounceBehaviour: Behaviour = {
  onImpact(p, ctx, hit) {
    // A shell that reaches a mobile is done skipping.
    if (hit.mobileSeat !== undefined) return false;

    const params = p.def.params ?? {};
    const n = surfaceNormal(ctx, hit.x, hit.y);
    // Negative while the shell is still moving into the surface.
    const vn = p.vx * n.x + p.vy * n.y;
    // Terrain collision samples the projectile's centre (`entities/projectile.ts`
    // walkSegment), so this is the centre's clearance above the surface, not the
    // sprite's.
    const clearance = params.clearancePx ?? 1;
    p.x = hit.x + n.x * clearance;
    p.y = hit.y + n.y * clearance;

    if (p.bouncesLeft > 0 && -vn >= (params.rollSpeed ?? 0)) {
      const restitution = p.def.restitution ?? constants.projectile.defaultRestitution;
      const keep = params.bounceFriction ?? 1;
      // Tangent keeps `bounceFriction`, normal is reflected and keeps `restitution`.
      const tx = p.vx - vn * n.x;
      const ty = p.vy - vn * n.y;
      p.vx = tx * keep - vn * n.x * restitution;
      p.vy = ty * keep - vn * n.y * restitution;
      p.bouncesLeft--;
      p.data.bounces = (p.data.bounces ?? 0) + 1;
      p.data.rollFrom = NOT_ROLLING;
      ctx.emit({
        t: 'mark',
        x: hit.x,
        y: hit.y,
        kind: BOUNCE_KIND,
        ownerSeat: p.ownerSeat,
        ticksUntil: 0,
      });
      return true;
    }

    // Rolling: keep the along-surface component, drop the into-surface one.
    if ((p.data.rollFrom ?? NOT_ROLLING) < 0) p.data.rollFrom = p.age;
    const friction = params.rollFriction ?? 1;
    p.vx = (p.vx - vn * n.x) * friction;
    p.vy = (p.vy - vn * n.y) * friction;

    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    const maxRollTicks = Math.floor(params.maxRollTicks ?? 0);
    const rolledFor = p.age - (p.data.rollFrom ?? p.age);
    if (speed <= (params.restSpeed ?? 0) || (maxRollTicks > 0 && rolledFor >= maxRollTicks)) {
      ctx.explode(p, p.x, p.y);
      p.alive = false;
    }
    return true;
  },
};
