/**
 * Shot behaviour registry (DESIGN §2.5). Most shots are pure configuration; the ones
 * that are not get one small module in this directory and are referenced from data by
 * key — `ProjectileDef.behaviour` is a plain string and `getBehaviour` is the only way
 * a projectile finds its module.
 *
 * The types, the map and `basic` live in `./registry.ts`; this file is the one place
 * that knows which modules exist and in **which order** they register. That order is
 * fixed and must not change: `behaviourKeys()` is sorted, but registration order is
 * what decides who wins a duplicate key, and a stable list keeps diffs between the
 * four Phase 4 groups from touching each other.
 *
 * Each group owns its own behaviour files; nobody but the integrator edits this one.
 */
import { registerBehaviour, basicBehaviour } from './registry.js';

// Group 1 — mage, nak, trico, bigfoot
import { weaveBehaviour } from './weave.js';
import { shieldBreakBehaviour } from './shieldBreak.js';
import { burrowBehaviour } from './burrow.js';
import { orbitBehaviour } from './orbit.js';
// Group 2 — boomer, raon, lightning, jd, asate
import { mineDropBehaviour } from './mineDrop.js';
import { markThenBoltBehaviour } from './markThenBolt.js';
import { pullBehaviour } from './pull.js';
import { satelliteBehaviour } from './satellite.js';
// Group 3 — ice, turtle, grub, aduka
import { debuffBehaviour } from './debuff.js';
import { shatterBehaviour } from './shatter.js';
import { convergeBehaviour } from './converge.js';
import { bubbleBurstBehaviour } from './bubbleBurst.js';
import { bounceBehaviour } from './bounce.js';
import { thorCallBehaviour } from './thorCall.js';
// Group 4 — kalsiddon, jfrog, dragon, knight
import { splitBehaviour } from './split.js';
import { crawlBehaviour } from './crawl.js';
import { markThenSwordsBehaviour } from './markThenSwords.js';

export type {
  Behaviour,
  BehaviourContext,
  ImpactInfo,
  MarkPayload,
  TurnEffect,
  WorldBounds,
} from './registry.js';
export {
  registerBehaviour,
  getBehaviour,
  behaviourKeys,
  basicBehaviour,
} from './registry.js';

export { weaveBehaviour } from './weave.js';
export { shieldBreakBehaviour } from './shieldBreak.js';
export { burrowBehaviour } from './burrow.js';
export { orbitBehaviour } from './orbit.js';
export { mineDropBehaviour } from './mineDrop.js';
export { markThenBoltBehaviour } from './markThenBolt.js';
export { pullBehaviour } from './pull.js';
export { satelliteBehaviour } from './satellite.js';
export { debuffBehaviour } from './debuff.js';
export { shatterBehaviour } from './shatter.js';
export { convergeBehaviour } from './converge.js';
export { bubbleBurstBehaviour } from './bubbleBurst.js';
export { bounceBehaviour } from './bounce.js';
export { thorCallBehaviour } from './thorCall.js';
export { splitBehaviour } from './split.js';
export { crawlBehaviour } from './crawl.js';
export { markThenSwordsBehaviour } from './markThenSwords.js';

/** Registration order. Fixed (DESIGN §2.1: nothing in the sim depends on map order,
 *  but a stable list is what keeps this file out of four agents' diffs). */
registerBehaviour('basic', basicBehaviour);
registerBehaviour('weave', weaveBehaviour);
registerBehaviour('shieldBreak', shieldBreakBehaviour);
registerBehaviour('burrow', burrowBehaviour);
registerBehaviour('orbit', orbitBehaviour);
registerBehaviour('mineDrop', mineDropBehaviour);
registerBehaviour('markThenBolt', markThenBoltBehaviour);
registerBehaviour('pull', pullBehaviour);
registerBehaviour('satellite', satelliteBehaviour);
registerBehaviour('debuff', debuffBehaviour);
registerBehaviour('shatter', shatterBehaviour);
registerBehaviour('converge', convergeBehaviour);
registerBehaviour('bubbleBurst', bubbleBurstBehaviour);
registerBehaviour('bounce', bounceBehaviour);
registerBehaviour('thorCall', thorCallBehaviour);
registerBehaviour('split', splitBehaviour);
registerBehaviour('crawl', crawlBehaviour);
registerBehaviour('markThenSwords', markThenSwordsBehaviour);
