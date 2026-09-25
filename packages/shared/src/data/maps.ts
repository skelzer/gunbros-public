/**
 * Compatibility shim. The map pool was one file until the map pass (DESIGN §8.1) gave
 * every map its own (`data/maps/<id>.ts`) so that several agents could work on it at
 * once; this module re-exports the directory so that every import path written before
 * the split keeps working unchanged.
 *
 * New code may import either; `data/maps/index.js` is the real thing.
 */
export * from './maps/index.js';
