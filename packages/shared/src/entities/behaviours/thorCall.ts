/**
 * `thorCall` — aduka S2/SS — Thor Call.
 *
 * aduka's own shells are feeble; what it really fires is a targeting round. Wherever
 * the shell lands it paints the ground (a `mark` event the client blinks a crosshair
 * on), and `params.delayTicks` later the Thor satellite burns a column of light down
 * onto that point through `rules/sky.ts` `thorStrike`, scaled by the Thor level —
 * level 1 when the map rolled no Thor sky event (DESIGN §5, §7 item 9).
 *
 * The SS calls `params.calls` strikes instead of one, `params.staggerTicks` apart and
 * walking `params.stepPx` across the mark, so the barrage sweeps a line rather than
 * hitting the same crater three times. Each strike schedules the next one, which is
 * how a `TurnEffect` chains (DESIGN §7 item 67): the turn cannot resolve until the
 * queue has drained, so the whole barrage lands inside the shooter's own turn.
 *
 * Data (`ProjectileDef.params` in `data/mobiles/aduka.ts`):
 *   calls          strikes per call-in
 *   delayTicks     shell impact → first strike
 *   staggerTicks   strike → strike
 *   stepPx         px between consecutive strikes, centred on the mark
 *   level          Thor level to use; 0 = whatever the match's Thor is at
 *   damageScale    beam damage as a fraction of `sky.thor.baseDamage * level`
 *   beamCarveRadius / beamRadiusScale   the column's carve radius and falloff radius
 */
import type { Behaviour, TurnEffect } from './registry.js';
import type { ProjectileDef } from '../projectile.js';
import { sky } from '../../data/sky.js';
import { defaultThorLevel, forceMultiplierForFlag, thorStrike } from '../../rules/sky.js';

/** Behaviour key: what an effect scheduled here names so it comes back to us. */
const KEY = 'thorCall';

/** Render tag for the mark, the effect and the beam. */
const THOR_KIND = 'thor';

export const thorCallBehaviour: Behaviour = {
  onImpact(p, ctx, hit) {
    const params = p.def.params ?? {};
    ctx.mark(hit.x, hit.y, Math.floor(params.delayTicks ?? 0), {
      behaviour: KEY,
      kind: THOR_KIND,
      ownerSeat: p.ownerSeat,
      data: {
        calls: Math.max(1, Math.floor(params.calls ?? 1)),
        index: 0,
        stagger: Math.max(1, Math.floor(params.staggerTicks ?? 1)),
        stepPx: params.stepPx ?? 0,
        level: Math.floor(params.level ?? 0),
        damageScale: params.damageScale ?? 1,
        carveRadius: params.beamCarveRadius ?? 0,
        radiusScale: params.beamRadiusScale ?? 1,
        // The spotting round's Force flag, carried across the delay: the barrage is the
        // shot, so the band has to reach it and not only the spotter (DESIGN §7 item 130).
        force: p.data.force ?? 0,
      },
    });
    // The spotting round still goes off where it landed; `false` keeps the default
    // explode, which is the whole of aduka's direct damage.
    return false;
  },

  onTurnEffect(effect, ctx) {
    const data = effect.data;
    const calls = Math.max(1, data.calls ?? 1);
    const index = data.index ?? 0;
    // What the data asks for, else the satellite the map rolled (the reducer stamps its
    // level onto every mark, DESIGN §5), else a level-1 Thor only aduka can call
    // (DESIGN §7 item 9).
    const asked = data.level ?? 0;
    const match = data.skyThorLevel ?? 0;
    const level = asked > 0 ? asked : match > 0 ? match : defaultThorLevel();

    // Walk the barrage across the mark: one call lands on it, three straddle it.
    const offset = (index - (calls - 1) / 2) * (data.stepPx ?? 0);
    const carveRadius = data.carveRadius ?? 0;
    const beam: Partial<ProjectileDef> = {
      damage:
        sky.thor.baseDamage *
        level *
        (data.damageScale ?? 1) *
        forceMultiplierForFlag(data.force),
    };
    if (carveRadius > 0) {
      beam.carveRadius = carveRadius;
      beam.damageRadius = carveRadius * (data.radiusScale ?? 1);
    }
    thorStrike(ctx, (data.x ?? 0) + offset, data.y ?? 0, {
      level,
      ownerSeat: effect.ownerSeat,
      def: beam,
    });

    if (index + 1 < calls) {
      const next: TurnEffect = {
        kind: effect.kind,
        atTick: ctx.tick + Math.max(1, data.stagger ?? 1),
        ownerSeat: effect.ownerSeat,
        behaviour: KEY,
        data: { ...data, index: index + 1 },
      };
      ctx.scheduleTurnEffect(next);
    }
  },
};
