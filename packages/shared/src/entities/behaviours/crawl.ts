/**
 * `crawl` — jfrog S2 / SS — Crawl (DESIGN §3: "on terrain impact becomes a surface
 * crawler moving in the original travel direction for N px, then explodes").
 *
 * The slime hits the ground, sticks, and then walks the surface. While it crawls it is
 * moved by this module and by nothing else: its def is replaced (on that one projectile,
 * never on the shared data object) with a gravity- and wind-free copy, so the integrator
 * leaves it where onTick puts it. Every sub-step it steps `params.stepPx` along the
 * ground in its original direction, climbing rises up to `params.climbPx` and dropping
 * up to `params.dropPx`; walk off something taller than that and it falls again, ready
 * to stick to the next surface with the distance it has left.
 *
 * It explodes when it has covered `params.crawlPx`, when it walks into a mobile, or when
 * it reaches the edge of the map. The SS adds `params.splitCount` blobs thrown up and out
 * of that final explosion.
 *
 * Every number lives in `data/mobiles/jfrog.ts` under `ProjectileDef.params`; the
 * fallbacks here are neutral (a missing `crawlPx` means "do not crawl", a missing scale
 * means "unchanged"), so this module never hides a tunable.
 */
import type { Behaviour, BehaviourContext } from './registry.js';
import type { ProjectileDef, ProjectileState } from '../projectile.js';
import { NO_GROUND } from '../../terrain/terrain.js';
import { cosDeg, sinDeg } from '../../math/trig.js';

/** A tunable from the shot's data, or the neutral value that switches it off. */
function param(p: ProjectileState, key: string, neutral: number): number {
  const value = p.def.params?.[key];
  return value === undefined ? neutral : value;
}

/** What the ground under the crawler's next step turned out to be. */
type Footing = 'ground' | 'ledge' | 'wall';

/**
 * Put the crawler on the surface of the column it is standing over, `hoverPx` above the
 * first solid pixel.
 *
 * `ledge` = nothing to stand on within `dropPx`, so it falls again; `wall` = the rise is
 * taller than `climbPx`, so it is stopped dead. Both are bounded on purpose: a probe
 * that simply walked to the top of whatever run it found would let the slime tunnel up
 * through a cliff.
 */
function followSurface(p: ProjectileState, ctx: BehaviourContext): Footing {
  const climb = param(p, 'climbPx', 0);
  const drop = param(p, 'dropPx', 0);
  const hover = param(p, 'hoverPx', 0);
  // The highest point this step is allowed to end up on.
  const top = p.y - climb;
  if (ctx.terrain.isSolid(p.x, top)) return 'wall';
  const surface = ctx.terrain.groundBelow(p.x, top, climb + drop + hover + 1);
  if (surface === NO_GROUND) return 'ledge';
  p.y = surface - hover;
  return 'ground';
}

/** Blow up where it stands, and for the SS throw the remaining slime out of the crater. */
function detonate(p: ProjectileState, ctx: BehaviourContext): void {
  ctx.explode(p, p.x, p.y);

  const count = Math.floor(param(p, 'splitCount', 0));
  if (count > 0) {
    const speed = param(p, 'splitSpeed', 0);
    const spread = param(p, 'splitSpreadDeg', 0);
    const blob: ProjectileDef = {
      ...p.def,
      // The crawler's own gravity and wind were zeroed when it stuck to the ground; the
      // blobs are thrown, so they fly under the shot's original numbers again.
      gravity: p.data.gravity0 ?? p.def.gravity,
      windFactor: p.data.wind0 ?? p.def.windFactor,
      radius: Math.max(1, p.def.radius * param(p, 'childRadiusScale', 1)),
      carveRadius: p.def.carveRadius * param(p, 'childCarveScale', 1),
      damage: p.def.damage * param(p, 'childDamageScale', 1),
      damageRadius: p.def.damageRadius * param(p, 'childDamageRadiusScale', 1),
      behaviour: 'basic',
      params: undefined,
    };
    for (let i = 0; i < count; i++) {
      // Fanned around straight up, so the splash lands around the crater.
      const offset = count === 1 ? 0 : i / (count - 1) - 0.5;
      const angle = 90 + offset * spread;
      ctx.spawn(
        blob,
        p.x,
        p.y - param(p, 'hoverPx', 0) - 1,
        speed * cosDeg(angle),
        -speed * sinDeg(angle),
        p.ownerSeat,
        { blob: 1 },
      );
    }
  }

  p.alive = false;
}

export const crawlBehaviour: Behaviour = {
  onSpawn(p: ProjectileState): void {
    p.data.crawling = 0;
    p.data.travelled = 0;
    p.data.dir = 0;
    // Remembered so a crawler that walks off a ledge — and the SS blobs — can fly under
    // the shot's own ballistics again.
    p.data.gravity0 = p.def.gravity;
    p.data.wind0 = p.def.windFactor;
  },

  onImpact(p: ProjectileState, ctx: BehaviourContext, hit): boolean {
    // A direct hit on a mobile is a direct hit, crawling or not.
    if (hit.mobileSeat !== undefined) return false;
    // Terrain is the road once it has stuck: onTick owns where it goes from here.
    if (p.data.crawling === 1) return true;
    if (param(p, 'crawlPx', 0) <= 0) return false;

    p.data.crawling = 1;
    p.data.dir = p.vx >= 0 ? 1 : -1;
    p.x = hit.x;
    p.y = hit.y;
    p.vx = 0;
    p.vy = 0;
    p.def = { ...p.def, gravity: 0, windFactor: 0 };
    followSurface(p, ctx);
    return true;
  },

  onTick(p: ProjectileState, ctx: BehaviourContext): void {
    if (p.data.crawling !== 1) return;

    const stepPx = param(p, 'stepPx', 0);
    const crawlPx = param(p, 'crawlPx', 0);
    if (stepPx <= 0) {
      detonate(p, ctx);
      return;
    }

    const dir = (p.data.dir ?? 0) < 0 ? -1 : 1;
    const nextX = p.x + dir * stepPx;
    if (nextX < 0 || nextX > ctx.bounds.width) {
      detonate(p, ctx);
      return;
    }
    p.x = nextX;
    p.data.travelled = (p.data.travelled ?? 0) + stepPx;

    const footing = followSurface(p, ctx);
    if (footing === 'wall') {
      // Nose first into a rise it cannot climb: it splatters there.
      detonate(p, ctx);
      return;
    }
    if (footing === 'ledge') {
      // Walked off the end of the ground it was on. Fall, keeping the direction and the
      // distance still owed, and stick to whatever it lands on.
      p.data.crawling = 0;
      p.def = {
        ...p.def,
        gravity: p.data.gravity0 ?? p.def.gravity,
        windFactor: p.data.wind0 ?? p.def.windFactor,
      };
      p.vx = dir * param(p, 'fallVx', 0);
      p.vy = 0;
      return;
    }

    if ((p.data.travelled ?? 0) >= crawlPx) detonate(p, ctx);
  },
};
