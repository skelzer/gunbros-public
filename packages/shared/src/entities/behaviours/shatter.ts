/**
 * `shatter` — ice SS — Shatter.
 *
 * The shell is a hollow icicle on a fuse: when `lifetimeTicks` runs out it cracks open
 * mid-flight (a small frost burst) and throws `params.shards` shards fanned over
 * `params.spreadDeg` around its own direction of travel (DESIGN §3). The shards are
 * ordinary `basic` projectiles cut from the parent's def, so they carry the shot's ice
 * type and its `defenceDebuff` with them and every one that lands chills again.
 *
 * Aiming it is the trade: the fuse is a fixed number of ticks, so the player picks the
 * power that puts the crack over the target rather than the angle that hits it.
 *
 * Every number is data (`ProjectileDef.params` in `data/mobiles/ice.ts`):
 *   shards             how many shards (0 = the shell simply dies)
 *   spreadDeg          total fan across the shards, centred on the travel direction
 *   shardSpeedScale    shard speed as a fraction of the parent's speed at the crack
 *   shardDamageScale   shard damage / radius as fractions of the parent's
 *   shardRadiusScale
 *   burstDamageScale   the crack itself, as a fraction of parent damage (0 = silent)
 *   burstCarveScale
 */
import type { Behaviour } from './registry.js';
import type { ProjectileDef } from '../projectile.js';
import { atan2, cosDeg, sinDeg, RAD_TO_DEG } from '../../math/trig.js';

/** Render tag for the shards; the client keys its sprite off this string. */
const SHARD_SPRITE = 'iceShard';

export const shatterBehaviour: Behaviour = {
  onTimer(p, ctx) {
    const params = p.def.params ?? {};
    const burstScale = params.burstDamageScale ?? 0;
    if (burstScale > 0) {
      ctx.explode(p, p.x, p.y, {
        damage: p.def.damage * burstScale,
        carveRadius: p.def.carveRadius * (params.burstCarveScale ?? 1),
      });
    }

    const shards = Math.floor(params.shards ?? 0);
    if (shards > 0) {
      const radiusScale = params.shardRadiusScale ?? 1;
      const shardDef: ProjectileDef = {
        ...p.def,
        damage: p.def.damage * (params.shardDamageScale ?? 1),
        damageRadius: p.def.damageRadius * radiusScale,
        carveRadius: p.def.carveRadius * radiusScale,
        radius: Math.max(1, p.def.radius * radiusScale),
        // A shard is a plain shell: no fuse of its own, or it would shatter forever.
        lifetimeTicks: undefined,
        behaviour: 'basic',
        params: undefined,
        sprite: SHARD_SPRITE,
        trail: 'spark',
      };
      const speed =
        Math.sqrt(p.vx * p.vx + p.vy * p.vy) * (params.shardSpeedScale ?? 1);
      // Fan around where the shell was already going, so the spray follows the shot.
      const baseDeg = atan2(-p.vy, p.vx) * RAD_TO_DEG;
      const spreadDeg = params.spreadDeg ?? 0;
      for (let i = 0; i < shards; i++) {
        const offset = shards === 1 ? 0 : (i / (shards - 1) - 0.5) * spreadDeg;
        const deg = baseDeg + offset;
        ctx.spawn(
          shardDef,
          p.x,
          p.y,
          cosDeg(deg) * speed,
          -sinDeg(deg) * speed,
          p.ownerSeat,
        );
      }
    }

    p.alive = false;
  },
};
