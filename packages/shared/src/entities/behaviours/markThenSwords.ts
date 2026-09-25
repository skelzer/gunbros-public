/**
 * `markThenSwords` — knight — Mark then Swords (DESIGN §3: "mark; 3 swords fall
 * vertically with small spread", 5 for S2, 9 and wide for the SS).
 *
 * The shell itself is only a spotter: it does not explode. Where it lands it lays down
 * `params.swords` marks fanned over `params.spreadPx` (each nudged by up to
 * `params.jitterPx` from the match PRNG, drawn left to right so every engine draws the
 * same numbers in the same order), and each mark comes due a few ticks later as a sword —
 * a short vertical `beamStrike` dropping `params.fallHeightPx` onto the marked column and
 * biting `params.biteDepthPx` into the ground (DESIGN §7 item 68: a falling sword and a
 * lightning bolt are the same primitive).
 *
 * `ProjectileDef.damage` is therefore the damage of **one** sword, and what a target
 * takes is decided by how much of the rank it is standing under.
 *
 * Two notes on the scheduling. It goes through `scheduleTurnEffect` rather than
 * `ctx.mark` so the effect carries the *shooter's* seat rather than whoever the turn
 * machine thinks is active — the same seat in a `turns` match, a different one in free
 * play (the sandbox); the `mark` event the renderer blinks on is emitted here instead.
 * And the effect carries the whole sword as numbers, including the damage type as its
 * index in `damageTypes`, rather than a reference to the shot it came from: a
 * `TurnEffect` is numbers only (so it stays hash- and snapshot-safe), and a sword that
 * rebuilt its def by looking the shot up again would go out if anything — a Phase 5 item,
 * say — ever handed the projectile a modified copy of that def.
 *
 * Every number lives in `data/mobiles/knight.ts` under `ProjectileDef.params`; the
 * fallbacks here are neutral (no `swords` means "an ordinary shell"), so this module
 * never hides a tunable.
 */
import type { Behaviour, BehaviourContext, TurnEffect } from './registry.js';
import type { ProjectileDef, ProjectileState } from '../projectile.js';
import { damageTypes } from '../../data/damageTable.js';
import { forceMultiplierForFlag } from '../../rules/sky.js';

/** Render tag for the mark, the effect and the beam the effect becomes. */
const SWORD = 'sword';

/** A tunable from the shot's data, or the neutral value that switches it off. */
function param(p: ProjectileState, key: string, neutral: number): number {
  const value = p.def.params?.[key];
  return value === undefined ? neutral : value;
}

/** One sword, rebuilt from the numbers the effect carried. */
function swordDef(data: Record<string, number>): ProjectileDef {
  const type = damageTypes[Math.floor(data.type ?? 0)] ?? 'impact';
  return {
    speed: 0,
    gravity: 0,
    windFactor: 0,
    radius: 1,
    carveRadius: data.width ?? 0,
    // The swords are the whole shot, so a spotter that crossed the Force band scales
    // them the way `ctx.explode` scales an ordinary blast (DESIGN §7 item 130).
    damage: (data.damage ?? 0) * forceMultiplierForFlag(data.force),
    damageRadius: data.damageRadius ?? 0,
    damageType: type,
    sprite: SWORD,
  };
}

export const markThenSwordsBehaviour: Behaviour = {
  onImpact(p: ProjectileState, ctx: BehaviourContext, hit): boolean {
    const swords = Math.floor(param(p, 'swords', 0));
    const width = param(p, 'swordWidthPx', 0);
    const fall = param(p, 'fallHeightPx', 0);
    if (swords < 1 || width <= 0 || fall <= 0) return false;

    const spread = param(p, 'spreadPx', 0);
    const jitter = param(p, 'jitterPx', 0);
    const delay = param(p, 'delayTicks', 0);
    const stagger = param(p, 'staggerTicks', 0);
    const sword: Record<string, number> = {
      damage: p.def.damage,
      damageRadius: p.def.damageRadius,
      width,
      fall,
      bite: param(p, 'biteDepthPx', 0),
      type: Math.max(0, damageTypes.indexOf(p.def.damageType)),
      y: hit.y,
      force: p.data.force ?? 0,
    };

    for (let i = 0; i < swords; i++) {
      const offset = swords === 1 ? 0 : i / (swords - 1) - 0.5;
      const wobble = jitter > 0 ? ctx.rng.nextRange(-jitter, jitter) : 0;
      const x = hit.x + offset * spread + wobble;
      const ticksUntil = Math.floor(delay + i * stagger);
      ctx.scheduleTurnEffect({
        kind: SWORD,
        atTick: ctx.tick + ticksUntil,
        ownerSeat: p.ownerSeat,
        behaviour: 'markThenSwords',
        data: { ...sword, x },
      });
      ctx.emit({ t: 'mark', x, y: hit.y, kind: SWORD, ownerSeat: p.ownerSeat, ticksUntil });
    }

    // The spotter is spent, and it never explodes: the swords are the whole shot.
    p.alive = false;
    ctx.emit({
      t: 'projectileExpire',
      id: p.id,
      ownerSeat: p.ownerSeat,
      x: hit.x,
      y: hit.y,
      reason: 'lifetime',
    });
    return true;
  },

  onTurnEffect(effect: TurnEffect, ctx: BehaviourContext): void {
    const data = effect.data;
    const width = data.width ?? 0;
    const fall = data.fall ?? 0;
    if (width <= 0 || fall <= 0) return;
    const x = data.x ?? 0;
    const y = data.y ?? 0;
    // The blade stops `bite` px *below* the mark: a sword sticks into the ground it
    // lands on, which is also what leaves a notch in the terrain.
    ctx.beamStrike(x, y + (data.bite ?? 0), Math.max(0, y - fall), width, swordDef(data), effect.ownerSeat);
  },
};
