/**
 * `debuff` — ice S1/S2 — the chilling hit.
 *
 * The shot itself is ordinary: it flies, it explodes, and the core stacks its
 * `ProjectileDef.defenceDebuff` onto everything it damaged, caps it at
 * `constants.debuff.max` and thaws it at the victim's own turn start (DESIGN §2.6,
 * §7 item 69). Nothing here has to help with that.
 *
 * What this module adds is the second half of ice's identity: the crater keeps
 * freezing. On impact it marks the point, and `params.lingerTicks` later a frost bloom
 * goes off there — no carve, a fraction of the shell's damage, and another, smaller
 * bite of defence debuff. So one shell chills twice, and a target that stays in the
 * crater is softened for everything that follows.
 *
 * Data (`ProjectileDef.params` in `data/mobiles/ice.ts`):
 *   lingerTicks         impact → bloom (0 = no bloom, just the frost marker)
 *   lingerDamageScale   bloom damage / radius as fractions of the shell's
 *   lingerRadiusScale
 *   lingerDebuff        defence debuff the bloom stacks on what it catches
 */
import type { Behaviour } from './registry.js';
import type { ProjectileDef } from '../projectile.js';
import { forceMultiplierForFlag } from '../../rules/sky.js';

/** Behaviour key: what an effect scheduled here names so it comes back to us. */
const KEY = 'debuff';

/** Render tag for the frost marker and the bloom. */
const FROST_KIND = 'frost';

/** The bloom's damage type — ice, like every shot that uses this behaviour. */
const FROST_DAMAGE_TYPE = 'ice';

export const debuffBehaviour: Behaviour = {
  onImpact(p, ctx, hit) {
    const params = p.def.params ?? {};
    const lingerTicks = Math.floor(params.lingerTicks ?? 0);
    if (lingerTicks > 0) {
      ctx.mark(hit.x, hit.y, lingerTicks, {
        behaviour: KEY,
        kind: FROST_KIND,
        ownerSeat: p.ownerSeat,
        data: {
          damage: p.def.damage * (params.lingerDamageScale ?? 0),
          radius: p.def.damageRadius * (params.lingerRadiusScale ?? 1),
          debuff: params.lingerDebuff ?? 0,
          // The shell's Force flag rides across the linger (DESIGN §7 item 130).
          force: p.data.force ?? 0,
        },
      });
    } else {
      // No bloom: still tell the renderer where the frost landed.
      ctx.emit({
        t: 'mark',
        x: hit.x,
        y: hit.y,
        kind: FROST_KIND,
        ownerSeat: p.ownerSeat,
        ticksUntil: 0,
      });
    }
    // `false`: the shell explodes exactly as a plain shot does, and the core applies
    // the shot's own `defenceDebuff` to everything inside the blast.
    return false;
  },

  onTurnEffect(effect, ctx) {
    const data = effect.data;
    const damage = (data.damage ?? 0) * forceMultiplierForFlag(data.force);
    const debuff = data.debuff ?? 0;
    if (damage <= 0 && debuff <= 0) return;

    const x = data.x ?? 0;
    const y = data.y ?? 0;
    const bloom: ProjectileDef = {
      speed: 0,
      gravity: 0,
      windFactor: 0,
      radius: 1,
      // The bloom is cold, not explosive: it never touches the terrain.
      carveRadius: 0,
      damage,
      damageRadius: data.radius ?? 0,
      damageType: FROST_DAMAGE_TYPE,
      defenceDebuff: debuff,
      sprite: FROST_KIND,
    };
    ctx.damageArea(x, y, bloom, effect.ownerSeat);
    ctx.emit({
      t: 'explosion',
      x,
      y,
      radius: bloom.damageRadius,
      carveRadius: 0,
      damageType: FROST_DAMAGE_TYPE,
      ownerSeat: effect.ownerSeat,
    });
  },
};
