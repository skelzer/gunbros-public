/**
 * The mobile roster (DESIGN §3): the types every mobile is written against, one file
 * per mobile, and the lookups the rest of the game uses.
 *
 * One file per mobile is the whole point — Phase 4 is four agents working in the same
 * tree, and `mobiles/<id>.ts` is the only file each of them writes for a given mobile.
 * This index is the integration point: it declares the id union, the shapes, the
 * ordered `mobileDefs` list and the helpers. Nobody but the integrator edits it.
 *
 * `../mobiles.ts` re-exports everything here, so every import path written before the
 * split still resolves.
 *
 * Note on imports: a mobile file imports `MobileDef` from this module with
 * `import type`, which `verbatimModuleSyntax` erases — so there is no runtime cycle
 * between this index and the eighteen files it loads.
 */
import type { ProjectileDef } from '../../entities/projectile.js';
import type { MobileClass } from '../damageTable.js';
import type { SpriteRef } from '../../sprites/pixelArt.js';

export type MobileId =
  | 'armor'
  | 'mage'
  | 'nak'
  | 'trico'
  | 'bigfoot'
  | 'boomer'
  | 'raon'
  | 'lightning'
  | 'jd'
  | 'asate'
  | 'ice'
  | 'turtle'
  | 'grub'
  | 'aduka'
  | 'kalsiddon'
  | 'jfrog'
  | 'dragon'
  | 'knight';

export type ShotSlot = 's1' | 's2' | 'ss';

export const shotSlots: ShotSlot[] = ['s1', 's2', 'ss'];

export interface ShotDef {
  displayName: string;
  /** Delay added to the shooter's turn order (DESIGN §2.8). */
  delay: number;
  projectile: ProjectileDef;
  /** Projectiles fired per shot (bigfoot, boomer). */
  count?: number;
  /** Total fan in degrees across `count` projectiles. */
  spreadDeg?: number;
  /** Ticks between projectiles of a multi-shot. */
  stagger?: number;
}

export interface MobileDef {
  id: MobileId;
  /** Player-facing name. Separate from `id` so it can be renamed freely (DESIGN §3). */
  displayName: string;
  class: MobileClass;
  hp: number;
  shieldMax: number;
  /** Shield regained at the start of the owner's turn (DESIGN §7 item 7). */
  shieldRegen: number;
  /** Flat multiplier on incoming damage, 0.8–1.1. */
  defence: number;
  /** Px per tick while walking. */
  moveSpeed: number;
  /** Px of walking per turn. */
  moveGauge: number;
  /** Tallest rise, in px, the mobile can step up. */
  maxStep: number;
  /** Relative aim range in degrees (DESIGN §7 item 16). */
  angleMin: number;
  angleMax: number;
  footprint: { w: number; h: number };
  /** Only reachable through the Random pick (dragon, knight). */
  randomOnly: boolean;
  /** Weight in the Random pick: 10 normally, 1 for dragon and knight. */
  randomWeight: number;
  shots: { s1: ShotDef; s2: ShotDef; ss: ShotDef };
  sprite: SpriteRef;
}

import { armor } from './armor.js';
import { mage } from './mage.js';
import { nak } from './nak.js';
import { trico } from './trico.js';
import { bigfoot } from './bigfoot.js';
import { boomer } from './boomer.js';
import { raon } from './raon.js';
import { lightning } from './lightning.js';
import { jd } from './jd.js';
import { asate } from './asate.js';
import { ice } from './ice.js';
import { turtle } from './turtle.js';
import { grub } from './grub.js';
import { aduka } from './aduka.js';
import { kalsiddon } from './kalsiddon.js';
import { jfrog } from './jfrog.js';
import { dragon } from './dragon.js';
import { knight } from './knight.js';

export { armor } from './armor.js';
export { mage } from './mage.js';
export { nak } from './nak.js';
export { trico } from './trico.js';
export { bigfoot } from './bigfoot.js';
export { boomer } from './boomer.js';
export { raon } from './raon.js';
export { lightning } from './lightning.js';
export { jd } from './jd.js';
export { asate } from './asate.js';
export { ice } from './ice.js';
export { turtle } from './turtle.js';
export { grub } from './grub.js';
export { aduka } from './aduka.js';
export { kalsiddon } from './kalsiddon.js';
export { jfrog } from './jfrog.js';
export { dragon } from './dragon.js';
export { knight } from './knight.js';

/**
 * All eighteen mobiles, in DESIGN §3 table order. This array is the ordered source of
 * truth: the Random pick walks it, the room picker lists it and the determinism test
 * iterates it, so its order is part of the simulation (a different order would draw a
 * different mobile from the same PRNG value).
 */
export const mobileDefs: MobileDef[] = [
  armor,
  mage,
  nak,
  trico,
  bigfoot,
  boomer,
  raon,
  lightning,
  jd,
  asate,
  ice,
  turtle,
  grub,
  aduka,
  kalsiddon,
  jfrog,
  dragon,
  knight,
];

/** Lookup table. Keyed access only — iterate {@link mobileDefs} when order matters. */
const byId: Record<MobileId, MobileDef> = {
  armor,
  mage,
  nak,
  trico,
  bigfoot,
  boomer,
  raon,
  lightning,
  jd,
  asate,
  ice,
  turtle,
  grub,
  aduka,
  kalsiddon,
  jfrog,
  dragon,
  knight,
};

/** Every mobile id, in {@link mobileDefs} order. */
export const mobileIds: MobileId[] = mobileDefs.map((def) => def.id);

/** The definition for an id. Throws for an id that is not a {@link MobileId}. */
export function defOf(id: MobileId): MobileDef {
  const def = byId[id];
  if (!def) throw new Error(`mobile "${id}" has no definition`);
  return def;
}

/** The name the rest of the codebase already uses. Identical to {@link defOf}. */
export function getMobileDef(id: MobileId): MobileDef {
  return defOf(id);
}

/** Does this id name a real mobile? (Guards a value that came off the wire.) */
export function isMobileImplemented(id: MobileId | string): boolean {
  return Object.prototype.hasOwnProperty.call(byId, id);
}

/** Mobiles a player may choose by hand: everything that is not `randomOnly`. */
export function pickableMobiles(): MobileDef[] {
  const out: MobileDef[] = [];
  for (let i = 0; i < mobileDefs.length; i++) {
    const def = mobileDefs[i];
    if (def && !def.randomOnly) out.push(def);
  }
  return out;
}

/** May a player pick this id in the room screen? */
export function isPickableMobile(id: MobileId | string): boolean {
  if (!isMobileImplemented(id)) return false;
  return !defOf(id as MobileId).randomOnly;
}

/**
 * The Random pick pool (DESIGN §7 item 10): **every** mobile, including the
 * `randomOnly` ones, paired with its weight, in `mobileDefs` order.
 */
export function randomWeights(): Array<{ id: MobileId; weight: number }> {
  const out: Array<{ id: MobileId; weight: number }> = [];
  for (let i = 0; i < mobileDefs.length; i++) {
    const def = mobileDefs[i];
    if (def) out.push({ id: def.id, weight: def.randomWeight });
  }
  return out;
}

/** Total weight of the Random pick pool. */
export function randomPickWeightTotal(): number {
  let total = 0;
  for (let i = 0; i < mobileDefs.length; i++) total += mobileDefs[i]?.randomWeight ?? 0;
  return total;
}

/**
 * Roll a mobile from the Random pool with `roll` in [0, 1). Deterministic and shared,
 * so the room (which rolls from its own PRNG, DESIGN §7 item 39) and any test agree.
 */
export function randomMobileId(roll: number): MobileId {
  const total = randomPickWeightTotal();
  const fallback = mobileDefs[0]?.id ?? 'armor';
  if (total <= 0) return fallback;
  let remaining = roll * total;
  for (let i = 0; i < mobileDefs.length; i++) {
    const def = mobileDefs[i];
    if (!def) continue;
    remaining -= def.randomWeight;
    if (remaining < 0) return def.id;
  }
  return fallback;
}
