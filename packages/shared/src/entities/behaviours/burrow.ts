/**
 * `burrow` — nak S2/SS — Burrow.
 *
 * On terrain impact the shell keeps going underground at `params.digSpeed` px/tick for
 * `params.ticks` ticks, carving a tunnel of `params.tunnelRadius` as it goes, and
 * explodes on mobile contact, on leaving the terrain, or on the timer (DESIGN §3).
 *
 * How it digs: a projectile inside solid terrain is reported as an impact at the first
 * sample ahead of it on every sub-step, so `onImpact` is the dig step — it carves a
 * circle at that sample and walks the body onto it, which clears the next
 * `tunnelRadius` px of the path. The circles overlap, so the tunnel is continuous, and
 * it costs one `carve` event per `tunnelRadius` px rather than one per sub-step.
 *
 * While burrowing the velocity is renormalised to `digSpeed` every sub-step: gravity
 * still bends the heading a little (it is added before the renormalisation), so the
 * tunnel curves gently downward instead of the shell accelerating into the floor.
 *
 * Breaking out is tested by probing `params.probePx` and twice that far ahead along the
 * heading: inside its own tunnel those points are still uncut rock, and once both are
 * air the shell has cleared the far side and detonates there.
 *
 * `params.maxDepthPx` is the third exit, and the one that makes the shot worth firing at
 * a target standing on open ground: a shell that went into a floor rather than a wall has
 * no far side to reach, so it would otherwise spend its whole dig budget diving (gravity
 * bends the heading a little further down every sub-step) and detonate a few hundred px
 * of solid rock below anything it could hurt. Detonating once it is `maxDepthPx` under
 * the point it went in at puts the crater back at the surface, next to where it landed —
 * the carve radius of both digging shots is wider than their depth cap, so the hole
 * always breaks through. A tunnel through a wall runs level and never reaches the cap.
 */
import type { Behaviour, BehaviourContext } from './registry.js';
import { basicBehaviour } from './registry.js';
import type { ProjectileState } from '../projectile.js';

/** Unit heading of a projectile, or null when it is standing still. */
function heading(p: ProjectileState): { x: number; y: number } | null {
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed === 0) return null;
  return { x: p.vx / speed, y: p.vy / speed };
}

function detonate(p: ProjectileState, ctx: BehaviourContext): void {
  ctx.explode(p, p.x, p.y);
  p.alive = false;
}

export const burrowBehaviour: Behaviour = {
  ...basicBehaviour,

  onImpact(p, ctx, hit) {
    // A mobile stops the drill dead, above ground or below it.
    if (hit.mobileSeat !== undefined) return false;

    const params = p.def.params ?? {};
    if ((p.data.burrowing ?? 0) === 0) {
      p.data.burrowing = 1;
      p.data.burrowStartAge = p.age;
      p.data.burrowEntryY = hit.y;
    }

    ctx.carve(hit.x, hit.y, params.tunnelRadius ?? p.def.radius);
    p.x = hit.x;
    p.y = hit.y;
    return true;
  },

  onTick(p, ctx) {
    if ((p.data.burrowing ?? 0) === 0) return;
    const params = p.def.params ?? {};

    const dir = heading(p);
    if (!dir) return;
    const digSpeed = params.digSpeed ?? 0;
    if (digSpeed > 0) {
      p.vx = dir.x * digSpeed;
      p.vy = dir.y * digSpeed;
    }

    // Out of drill: it has chewed as far as this shot goes.
    const ticks = params.ticks ?? 0;
    if (p.age - (p.data.burrowStartAge ?? 0) >= ticks) {
      detonate(p, ctx);
      return;
    }

    // Too deep to be worth anything: it went into a floor, not through a wall.
    const maxDepth = params.maxDepthPx ?? 0;
    if (maxDepth > 0 && p.y - (p.data.burrowEntryY ?? p.y) >= maxDepth) {
      detonate(p, ctx);
      return;
    }

    // Broken out of the far side: two probes ahead, so a pocket is not an exit.
    const probe = params.probePx ?? 0;
    if (probe > 0) {
      const nearSolid = ctx.terrain.isSolid(p.x + dir.x * probe, p.y + dir.y * probe);
      const farSolid = ctx.terrain.isSolid(p.x + dir.x * probe * 2, p.y + dir.y * probe * 2);
      if (!nearSolid && !farSolid) detonate(p, ctx);
    }
  },
};
