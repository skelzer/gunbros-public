/**
 * xoshiro128** — the one and only source of randomness in the simulation.
 *
 * `Math.random` is banned in shared: every draw has to be reproducible from the match
 * seed. The generator is a plain object of four uint32 words, so its state serialises
 * to JSON (see `net/protocol.ts` `FireMessage.rngState`) and can be restored exactly,
 * which is how a client replays a shot from the server's authoritative start point.
 */

/** Four uint32 words. Serialisable as-is. */
export type PrngState = [number, number, number, number];

const UINT32 = 4294967296;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** splitmix32: turns a single 32-bit seed into well-mixed state words. */
function splitmix32(state: number): { value: number; state: number } {
  let z = (state + 0x9e3779b9) >>> 0;
  let v = z;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x735a2d97) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  z = z >>> 0;
  return { value: v, state: z };
}

/** Build a xoshiro128** state from a 32-bit seed. Never produces the all-zero state. */
export function seedState(seed: number): PrngState {
  let s = seed >>> 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const out = splitmix32(s);
    s = out.state;
    words.push(out.value);
  }
  const state: PrngState = [words[0] ?? 1, words[1] ?? 2, words[2] ?? 3, words[3] ?? 4];
  if (state[0] === 0 && state[1] === 0 && state[2] === 0 && state[3] === 0) {
    state[0] = 0x9e3779b9;
  }
  return state;
}

export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: PrngState) {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
  }

  /** Create a generator from a 32-bit integer seed. */
  static seed(seed: number): Prng {
    return new Prng(seedState(seed));
  }

  /** Next raw 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return this.nextU32() / UINT32;
  }

  /** Uniform integer in [min, max], both inclusive. */
  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    const span = max - min + 1;
    return min + Math.floor(this.nextFloat() * span);
  }

  /** Uniform float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** -1 or 1. */
  nextSign(): -1 | 1 {
    return (this.nextU32() & 1) === 0 ? -1 : 1;
  }

  getState(): PrngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: PrngState): void {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
  }

  /** Independent generator positioned at the same point in the stream. */
  clone(): Prng {
    return new Prng(this.getState());
  }
}
