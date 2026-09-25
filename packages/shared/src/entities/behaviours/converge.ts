/**
 * `converge` — turtle S2 — Tide Split.
 *
 * One trigger pull, two water balls. They leave the muzzle together and are given
 * equal and opposite *lateral* velocity, `±params.lateral`, which flips sign every
 * `params.flipTicks` ticks — so the pair fans apart, comes back together, and fans out
 * the other way (DESIGN §3). A player who times the flip right lands both balls on one
 * target; one who does not brackets it.
 *
 * The lateral is added to `vx` rather than to `x`, so the pair is integrated and
 * collision-checked exactly like any other shot: the sub-step walk still samples every
 * pixel and neither ball can tunnel. Because the offset is applied and removed in
 * whole units, the separation is an exact triangle wave — `2 * lateral * t` px while
 * they spread, back to 0 at every second flip.
 *
 * The twin is spawned by the shot itself (`ShotDef.count` stays 1) so that both balls
 * share one `onSpawn` and the sign can never be drawn from anything but the pair:
 * the first one to be born takes `+1` and hands `-1` to its twin.
 *
 * Data (`ProjectileDef.params` in `data/mobiles/turtle.ts`):
 *   lateral     px/tick of sideways drift each ball carries (0 = a plain double shot)
 *   flipTicks   ticks between sign flips (0 = never flip; they simply diverge)
 */
import type { Behaviour } from './registry.js';

export const convergeBehaviour: Behaviour = {
  onSpawn(p, ctx) {
    const params = p.def.params ?? {};
    const lateral = params.lateral ?? 0;
    const flipTicks = Math.floor(params.flipTicks ?? 0);

    if (p.data.side === undefined) {
      // The ball the `fire` intent produced. Claim a side *before* spawning the twin,
      // so the twin's own onSpawn sees a side and does not spawn a third.
      p.data.side = 1;
      ctx.spawn(p.def, p.x, p.y, p.vx, p.vy, p.ownerSeat, { side: -1 });
    }

    const side = p.data.side;
    p.data.nextFlip = flipTicks > 0 ? flipTicks : 0;
    p.vx += side * lateral;
  },

  onTick(p) {
    const params = p.def.params ?? {};
    const flipTicks = Math.floor(params.flipTicks ?? 0);
    if (flipTicks <= 0) return;
    const next = p.data.nextFlip ?? flipTicks;
    if (p.age < next) return;

    // `onTick` runs once per sub-step, so move the deadline first: the flip has to
    // happen exactly once per `flipTicks` ticks whatever `constants.subSteps` is.
    p.data.nextFlip = next + flipTicks;
    const side = p.data.side ?? 1;
    const lateral = params.lateral ?? 0;
    p.vx -= 2 * side * lateral;
    p.data.side = -side;
  },
};
