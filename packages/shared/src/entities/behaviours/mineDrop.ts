/**
 * `mineDrop` — raon S2/SS — Mine Drop.
 *
 * The shell bursts where it lands (a small blast, the projectile's own `damage` /
 * `damageRadius` / `carveRadius`) and leaves a walking mine on the ground under the
 * impact point. The mine is persistent: it lives in `MatchState.mines`, walks toward
 * the nearest enemy at every turn start and never blocks the turn from resolving
 * (DESIGN §3, §7 item 8).
 *
 * Every number the mine carries comes from `ProjectileDef.params` in
 * `data/mobiles/raon.ts`; `createMine` fills anything left out from `constants.mine`.
 * Nothing here draws from `ctx.rng`.
 */
import type { Behaviour, BehaviourContext, ImpactInfo } from './registry.js';
import { basicBehaviour } from './registry.js';
import type { ProjectileState } from '../projectile.js';
import { createMine, settleMineOnGround } from '../mines.js';

/**
 * Sprite keys for the two sizes. A sprite key is a render tag, not a tunable, so it
 * cannot live in `params` (which is numbers only); `params.variant` picks between them.
 */
const MINE_SPRITES = ['mine', 'mineHeavy'];

function mineSprite(variant: number): string {
  const index = variant >= 1 ? 1 : 0;
  return MINE_SPRITES[index] ?? 'mine';
}

/** Read a numeric tunable, or fall back to `createMine`'s own default. */
function param(p: ProjectileState, key: string): number | undefined {
  const value = p.def.params?.[key];
  return value === undefined ? undefined : value;
}

function dropMine(p: ProjectileState, ctx: BehaviourContext, x: number, y: number): void {
  const mine = createMine({
    x,
    y,
    ownerSeat: p.ownerSeat,
    hp: param(p, 'mineHp'),
    radius: param(p, 'mineRadius'),
    triggerRadius: param(p, 'mineTriggerRadius'),
    speed: param(p, 'mineSpeed'),
    climb: param(p, 'mineClimb'),
    ttlTurns: param(p, 'mineTtlTurns'),
    damage: param(p, 'mineDamage'),
    damageRadius: param(p, 'mineDamageRadius'),
    carveRadius: param(p, 'mineCarveRadius'),
    sprite: mineSprite(param(p, 'variant') ?? 0),
  });
  // Nothing under the impact point but sky (a shot that struck a mobile out over a
  // pit): there is no surface to walk, so the shell's own burst is all the shot does
  // rather than leaving a mine hanging in the air.
  if (!settleMineOnGround(mine, ctx.terrain)) return;
  ctx.addMine(mine);
}

export const mineDropBehaviour: Behaviour = {
  ...basicBehaviour,
  onImpact(p: ProjectileState, ctx: BehaviourContext, hit: ImpactInfo): boolean {
    // The deployment burst first (it carves the crater the mine then settles into),
    // then the mine itself.
    ctx.explode(p, hit.x, hit.y);
    dropMine(p, ctx, hit.x, hit.y);
    p.alive = false;
    return true;
  },
  onTimer(p: ProjectileState, ctx: BehaviourContext): void {
    ctx.explode(p, p.x, p.y);
    dropMine(p, ctx, p.x, p.y);
    p.alive = false;
  },
};
