/**
 * `split` — kalsiddon S2 — Split (DESIGN §3: "at apex (vy >= 0) splits into 4
 * projectiles with fanned vx").
 *
 * The shell climbs like an ordinary one and comes apart the first sub-step it stops
 * rising: `params.pieces` fragments leave the break-up point with the parent's velocity
 * plus a symmetric fan of `params.spreadVx`, so the cluster opens along the direction of
 * travel — which is the direction of whatever was being aimed at. The parent is spent
 * (it never explodes itself); the fragments are ordinary `basic` shells scaled down from
 * the parent's def by the `child*Scale` params.
 *
 * Every number lives in `data/mobiles/kalsiddon.ts` under `ProjectileDef.params`. The
 * fallbacks here are all *neutral* — a missing `pieces` means "do not split", a missing
 * scale means "unchanged" — so this module never hides a tunable.
 */
import type { Behaviour, BehaviourContext } from './registry.js';
import type { ProjectileDef, ProjectileState } from '../projectile.js';

/** A tunable from the shot's data, or the neutral value that switches it off. */
function param(p: ProjectileState, key: string, neutral: number): number {
  const value = p.def.params?.[key];
  return value === undefined ? neutral : value;
}

/** One fragment: the parent shell scaled down, flying itself with no behaviour. */
function fragmentDef(p: ProjectileState): ProjectileDef {
  return {
    ...p.def,
    radius: Math.max(1, p.def.radius * param(p, 'childRadiusScale', 1)),
    carveRadius: p.def.carveRadius * param(p, 'childCarveScale', 1),
    damage: p.def.damage * param(p, 'childDamageScale', 1),
    damageRadius: p.def.damageRadius * param(p, 'childDamageRadiusScale', 1),
    behaviour: 'basic',
    params: undefined,
  };
}

export const splitBehaviour: Behaviour = {
  onSpawn(p: ProjectileState): void {
    p.data.split = 0;
  },

  onTick(p: ProjectileState, ctx: BehaviourContext): void {
    if (p.data.split === 1) return;
    const pieces = Math.floor(param(p, 'pieces', 0));
    if (pieces < 2) return;
    // `minTicks` keeps a flat or downward shot from coming apart in the barrel: at the
    // muzzle `vy` is already >= 0 for anything aimed below the horizon.
    if (p.age < param(p, 'minTicks', 0)) return;
    if (p.vy < 0) return;

    p.data.split = 1;
    const spread = param(p, 'spreadVx', 0);
    const lift = param(p, 'liftVy', 0);
    const def = fragmentDef(p);
    for (let i = 0; i < pieces; i++) {
      const offset = i / (pieces - 1) - 0.5;
      ctx.spawn(def, p.x, p.y, p.vx + offset * spread, p.vy - lift, p.ownerSeat, {
        fragment: 1,
      });
    }

    // The casing is gone rather than exploded. `projectileExpire` is what brings the
    // camera home (DESIGN §7 item 24); the fragments take the eye from here.
    p.alive = false;
    ctx.emit({
      t: 'projectileExpire',
      id: p.id,
      ownerSeat: p.ownerSeat,
      x: p.x,
      y: p.y,
      reason: 'lifetime',
    });
  },
};
