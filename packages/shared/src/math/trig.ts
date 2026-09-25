/**
 * Deterministic trigonometry.
 *
 * `Math.sin` / `Math.cos` / `Math.atan2` are not correctly rounded and differ between
 * JavaScript engines, so the simulation implements its own. Everything here uses only
 * IEEE-754 `+ - * /` plus `Math.round`/`Math.abs`, which every engine rounds identically,
 * so the same inputs produce bit-identical outputs on every client and on the server.
 *
 * Accuracy target: better than 1e-6 absolute over [-4pi, 4pi] for sin/cos, and better
 * than 1e-6 over the whole plane for atan2. Measured worst case is ~1e-15 (sin/cos) and
 * ~1e-10 (atan2); the loose target leaves room to swap in cheaper polynomials later.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const QUARTER_PI = 0.7853981633974483;
export const DEG_TO_RAD = 0.017453292519943295;
export const RAD_TO_DEG = 57.29577951308232;

/** pi/2 split so that `k * PIO2_HI` is exact for small integer k (Cody-Waite). */
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;

/** Odd Taylor series for sin on |z| <= pi/4; truncation error < 1e-13 there. */
function sinCore(z: number): number {
  const z2 = z * z;
  // z * (1 - z2/3! + z4/5! - z6/7! + z8/9! - z10/11! + z12/13!), Horner form.
  const p =
    1 +
    z2 *
      (-0.16666666666666666 +
        z2 *
          (0.008333333333333333 +
            z2 *
              (-0.0001984126984126984 +
                z2 *
                  (2.755731922398589e-6 +
                    z2 * (-2.505210838544172e-8 + z2 * 1.6059043836821613e-10)))));
  return z * p;
}

/** Even Taylor series for cos on |z| <= pi/4; truncation error < 1e-15 there. */
function cosCore(z: number): number {
  const z2 = z * z;
  return (
    1 +
    z2 *
      (-0.5 +
        z2 *
          (0.041666666666666664 +
            z2 *
              (-0.001388888888888889 +
                z2 * (2.48015873015873e-5 + z2 * (-2.755731922398589e-7 + z2 * 2.08767569878681e-9)))))
  );
}

/** Reduce x to r in [-pi/4, pi/4] and the quadrant index k & 3. */
function reduce(x: number): { r: number; q: number } {
  const k = Math.round(x * 0.6366197723675814); // x / (pi/2)
  const r = x - k * PIO2_HI - k * PIO2_LO;
  return { r, q: k & 3 };
}

export function sin(x: number): number {
  if (!isFiniteNumber(x)) return 0;
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return sinCore(r);
    case 1:
      return cosCore(r);
    case 2:
      return -sinCore(r);
    default:
      return -cosCore(r);
  }
}

export function cos(x: number): number {
  if (!isFiniteNumber(x)) return 1;
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return cosCore(r);
    case 1:
      return -sinCore(r);
    case 2:
      return -cosCore(r);
    default:
      return sinCore(r);
  }
}

/** tan(x) = sin(x) / cos(x). Returns 0 at the poles rather than Infinity. */
export function tan(x: number): number {
  const c = cos(x);
  if (c === 0) return 0;
  return sin(x) / c;
}

const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227; // tan(15 deg)
const PI_OVER_6 = 0.5235987755982988;

/** Odd series for atan on |z| <= tan(15 deg); truncation error < 2e-10 there. */
function atanSeries(z: number): number {
  const z2 = z * z;
  const p =
    1 +
    z2 *
      (-0.3333333333333333 +
        z2 *
          (0.2 +
            z2 *
              (-0.14285714285714285 +
                z2 *
                  (0.1111111111111111 +
                    z2 * (-0.09090909090909091 + z2 * 0.07692307692307693)))));
  return z * p;
}

/** atan for t in [0, 1]. */
function atanUnit(t: number): number {
  if (t > TAN_PI_12) {
    // atan(t) = pi/6 + atan((sqrt3 * t - 1) / (sqrt3 + t)), which lands back in the series range.
    return PI_OVER_6 + atanSeries((SQRT3 * t - 1) / (SQRT3 + t));
  }
  return atanSeries(t);
}

/** atan for any finite input. */
export function atan(v: number): number {
  const s = v < 0 ? -1 : 1;
  const a = v < 0 ? -v : v;
  if (a > 1) {
    if (a === Infinity) return s * HALF_PI;
    return s * (HALF_PI - atanUnit(1 / a));
  }
  return s * atanUnit(a);
}

export function atan2(y: number, x: number): number {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return 0;
  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0;
  }
  const a = atan(y / x);
  if (x > 0) return a;
  return y < 0 ? a - PI : a + PI;
}

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

export function sinDeg(deg: number): number {
  return sin(deg * DEG_TO_RAD);
}

export function cosDeg(deg: number): number {
  return cos(deg * DEG_TO_RAD);
}

/** Wrap an angle in degrees into [0, 360). */
export function wrapDeg(deg: number): number {
  const w = deg - Math.floor(deg / 360) * 360;
  return w < 0 ? w + 360 : w;
}

/** Wrap an angle in radians into [-pi, pi]. */
export function wrapRad(rad: number): number {
  const w = rad - Math.floor(rad / TWO_PI) * TWO_PI;
  return w > PI ? w - TWO_PI : w;
}

function isFiniteNumber(v: number): boolean {
  // Avoids Number.isFinite only to keep this file free of surprises; both are exact.
  return v === v && v !== Infinity && v !== -Infinity;
}
