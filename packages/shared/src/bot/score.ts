/**
 * What a simulated shot was worth to the bot that fired it (DESIGN §11, §7 item 187).
 *
 * Read off the planner's private copy of the match once the shot has resolved: the hp
 * and shield every mobile lost, who died, and where the blasts went off. Damage to a
 * living enemy is the point, a kill is worth a bonus on top, friendly fire costs double,
 * and the bot's own death — by its shell or off the edge of the map — outweighs any
 * trade. A shot that touched nobody is scored by how close its nearest blast came to an
 * enemy, so the search always has a slope to climb. The numbers are `bots.score`.
 */
import { bots } from '../data/bots.js';
import { getMobileDef } from '../data/mobiles.js';
import type { TeamId } from '../entities/mobile.js';
import type { MatchState } from '../match/match.js';
import type { SimEvent } from '../match/events.js';

/** One mobile as it stood before the candidate was fired. */
export interface Vitals {
  seat: number;
  team: TeamId;
  /** hp + shield: a point off either is a point the target has to lose. */
  health: number;
  alive: boolean;
  /** Hull centre, which is what a blast measures its distance to. */
  x: number;
  y: number;
}

export function vitalsOf(state: MatchState): Vitals[] {
  const out: Vitals[] = [];
  for (let i = 0; i < state.mobiles.length; i++) {
    const m = state.mobiles[i];
    if (!m) continue;
    const h = getMobileDef(m.defId).footprint.h;
    out.push({
      seat: m.seat,
      team: m.team,
      health: m.hp + m.shield,
      alive: m.alive,
      x: m.x,
      y: m.y - h / 2,
    });
  }
  return out;
}

/** Where the shot went off: every explosion, and the foot of every beam. */
export function blastPoints(events: readonly SimEvent[], into: { x: number; y: number }[]): void {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.t === 'explosion' || e.t === 'mineExplode') into.push({ x: e.x, y: e.y });
    else if (e.t === 'beam') into.push({ x: e.x2, y: e.y2 });
  }
}

/**
 * Score the resolved copy `after` against the mobiles as they stood `before` the shot.
 * Higher is better; a shot that hurt only its own side is negative.
 */
export function scoreShot(
  before: readonly Vitals[],
  after: MatchState,
  seat: number,
  blasts: readonly { x: number; y: number }[],
): number {
  const w = bots.score;
  const self = before.find((v) => v.seat === seat);
  const team = self ? self.team : 'A';
  let score = 0;
  let enemyDamage = 0;
  for (let i = 0; i < before.length; i++) {
    const v = before[i];
    if (!v || !v.alive) continue;
    const m = after.mobiles.find((mob) => mob.seat === v.seat);
    if (!m) continue;
    const lost = Math.max(0, v.health - (m.alive ? m.hp + m.shield : 0));
    const died = !m.alive;
    if (v.seat === seat) {
      score -= lost * w.friendlyDamage;
      if (died) score -= w.selfDeath;
    } else if (v.team === team) {
      score -= lost * w.friendlyDamage;
      if (died) score -= w.allyDeath;
    } else {
      score += lost * w.enemyDamage;
      enemyDamage += lost;
      if (died) score += w.killBonus;
    }
  }
  if (enemyDamage > 0) return score;

  // A miss: how near did it come? The closest blast to the closest living enemy.
  let nearest = Infinity;
  for (let i = 0; i < before.length; i++) {
    const v = before[i];
    if (!v || !v.alive || v.team === team) continue;
    for (let j = 0; j < blasts.length; j++) {
      const b = blasts[j];
      if (!b) continue;
      const dx = b.x - v.x;
      const dy = b.y - v.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearest) nearest = d;
    }
  }
  return score - Math.min(w.missCap, nearest * w.missPerPx);
}
