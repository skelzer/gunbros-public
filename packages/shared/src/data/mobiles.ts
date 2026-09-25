/**
 * Compatibility shim. The roster was one file until Phase 4 gave every mobile its own
 * (`data/mobiles/<id>.ts`) so that four agents could work on it at once; this module
 * re-exports the directory so that every import path written before the split — and
 * `packages/shared/dist`, which the server resolves — keeps working unchanged.
 *
 * New code may import either; `data/mobiles/index.js` is the real thing.
 */
export * from './mobiles/index.js';
