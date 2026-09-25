/**
 * `shieldBreak` — mage SS — Shield Break.
 *
 * An energy blast that hits shields for `ProjectileDef.shieldDamageMultiplier` (2.5)
 * and strips whatever shield is left on a mobile it damaged (DESIGN §3). The
 * multiplier is already applied by `rules/damage.ts`; this module runs the ordinary
 * explosion itself and then zeroes the remaining shield of everything inside
 * `damageRadius * params.stripRadiusFactor` of the blast.
 *
 * Stripping is measured from the hull centre, exactly as `damageArea` measures its
 * falloff, so "it was damaged" and "its shield is gone" cannot disagree.
 */
import type { Behaviour } from './registry.js';
import { basicBehaviour } from './registry.js';

export const shieldBreakBehaviour: Behaviour = {
  ...basicBehaviour,

  onImpact(p, ctx, hit) {
    // The blast itself is the ordinary one: carve, event, falloff damage, and the
    // shield multiplier the def carries.
    ctx.explode(p, hit.x, hit.y);

    const params = p.def.params ?? {};
    const radius = p.def.damageRadius * (params.stripRadiusFactor ?? 1);
    for (let i = 0; i < ctx.mobiles.length; i++) {
      const m = ctx.mobiles[i];
      if (!m || !m.alive || m.shield <= 0) continue;
      const def = ctx.defOf(m.seat);
      if (!def) continue;
      const dx = m.x - hit.x;
      const dy = m.y - def.footprint.h / 2 - hit.y;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) m.shield = 0;
    }

    p.alive = false;
    return true;
  },
};
