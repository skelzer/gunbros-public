/**
 * DESIGN §10: our sin/cos/atan2 within 1e-6 of a high-precision reference, as fixed
 * literal expectations rather than calls to Math.sin — the whole point of trig.ts is
 * that we do not trust the engine's transcendentals to agree with each other.
 */
import { describe, expect, it } from 'vitest';
import {
  sin,
  cos,
  tan,
  atan,
  atan2,
  degToRad,
  radToDeg,
  sinDeg,
  cosDeg,
  wrapDeg,
  wrapRad,
  PI,
  TWO_PI,
  HALF_PI,
} from '../src/math/trig.js';

const TOL = 1e-6;
const FOUR_PI = 12.566370614359172;

/** [x, sin x, cos x] — reference values to 16 significant digits. */
const SIN_COS: Array<[number, number, number]> = [
  [0, 0, 1],
  [0.1, 0.09983341664682815, 0.9950041652780257],
  [0.5, 0.479425538604203, 0.8775825618903728],
  [1, 0.8414709848078965, 0.5403023058681398],
  [1.2345, 0.9439833239445111, 0.32999315767856785],
  [HALF_PI, 1, 6.123233995736766e-17],
  [2, 0.9092974268256817, -0.4161468365471424],
  [2.5, 0.5984721441039564, -0.8011436155469337],
  [3, 0.1411200080598672, -0.9899924966004454],
  [PI, 1.2246467991473532e-16, -1],
  [3.5, -0.35078322768961984, -0.9364566872907963],
  [4, -0.7568024953079282, -0.6536436208636119],
  [4.71238898038469, -1, -1.8369701987210297e-16],
  [5, -0.9589242746631385, 0.28366218546322625],
  [6, -0.27941549819892586, 0.9601702866503661],
  [TWO_PI, -2.4492935982947064e-16, 1],
  [7.5, 0.9379999767747389, 0.3466353178350258],
  [9, 0.4121184852417566, -0.9111302618846769],
  [10, -0.5440211108893698, -0.8390715290764524],
  [11, -0.9999902065507035, 0.004425697988050785],
  [FOUR_PI, -4.898587196589413e-16, 1],
  [-0.3, -0.29552020666133955, 0.955336489125606],
  [-0.7, -0.644217687237691, 0.7648421872844885],
  [-1.5, -0.9974949866040544, 0.0707372016677029],
  [-2.4, -0.675463180551151, -0.7373937155412454],
  [-PI, -1.2246467991473532e-16, -1],
  [-4.2, 0.8715757724135882, -0.4902608213406994],
  [-5.5, 0.7055403255703919, 0.70866977429126],
  [-TWO_PI, 2.4492935982947064e-16, 1],
  [-8.1, -0.9698898108450863, -0.2435441537357911],
  [-10.9, 0.9954362533063774, -0.09542885100095065],
  [-FOUR_PI, 4.898587196589413e-16, 1],
];

/** [y, x, atan2(y, x)]. */
const ATAN2: Array<[number, number, number]> = [
  [0, 1, 0],
  [1, 0, 1.5707963267948966],
  [1, 1, 0.7853981633974483],
  [-1, 1, -0.7853981633974483],
  [-1, -1, -2.356194490192345],
  [1, -1, 2.356194490192345],
  [0, -1, 3.141592653589793],
  [-1, 0, -1.5707963267948966],
  [3, 4, 0.6435011087932844],
  [-3, 4, -0.6435011087932844],
  [3, -4, 2.498091544796509],
  [-3, -4, -2.498091544796509],
  [0.001, 1000, 9.999999999996666e-7],
  [1000, 0.001, 1.5707953267948966],
  [5, 12, 0.39479111969976155],
  [-7, 24, -0.28379410920832787],
  [0.5, 0.5, 0.7853981633974483],
  [100, -3, 1.6007873316517747],
  [-0.25, 0.75, -0.3217505543966422],
  [2.5, -6.25, 2.761086276477428],
];

describe('trig', () => {
  it('sin matches the reference table within 1e-6 over [-4pi, 4pi]', () => {
    for (const [x, expected] of SIN_COS) {
      expect(Math.abs(sin(x) - expected), `sin(${x})`).toBeLessThan(TOL);
    }
  });

  it('cos matches the reference table within 1e-6 over [-4pi, 4pi]', () => {
    for (const [x, , expected] of SIN_COS) {
      expect(Math.abs(cos(x) - expected), `cos(${x})`).toBeLessThan(TOL);
    }
  });

  it('is in fact far more accurate than the 1e-6 contract', () => {
    let worst = 0;
    for (const [x, s, c] of SIN_COS) {
      worst = Math.max(worst, Math.abs(sin(x) - s), Math.abs(cos(x) - c));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('atan2 matches the reference table within 1e-6', () => {
    for (const [y, x, expected] of ATAN2) {
      expect(Math.abs(atan2(y, x) - expected), `atan2(${y}, ${x})`).toBeLessThan(TOL);
    }
  });

  it('holds the Pythagorean identity across a dense sweep', () => {
    let worst = 0;
    for (let i = 0; i <= 20000; i++) {
      const x = -FOUR_PI + (i / 20000) * 2 * FOUR_PI;
      const s = sin(x);
      const c = cos(x);
      worst = Math.max(worst, Math.abs(s * s + c * c - 1));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('is periodic and odd/even across the sweep', () => {
    for (let i = 0; i <= 2000; i++) {
      const x = -PI + (i / 2000) * TWO_PI;
      expect(Math.abs(sin(x + TWO_PI) - sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(cos(x + TWO_PI) - cos(x))).toBeLessThan(1e-9);
      expect(Math.abs(sin(-x) + sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(cos(-x) - cos(x))).toBeLessThan(1e-12);
    }
  });

  it('atan2 inverts sin/cos over the full circle', () => {
    for (let deg = -179; deg <= 180; deg++) {
      const r = degToRad(deg);
      const back = atan2(sin(r), cos(r));
      expect(Math.abs(back - r), `deg ${deg}`).toBeLessThan(1e-9);
    }
  });

  it('atan is the inverse of tan on (-pi/2, pi/2)', () => {
    for (let i = -1000; i <= 1000; i++) {
      const x = (i / 1000) * 1.5;
      expect(Math.abs(atan(tan(x)) - x), `x ${x}`).toBeLessThan(1e-9);
    }
  });

  it('converts and wraps angles', () => {
    expect(radToDeg(PI)).toBeCloseTo(180, 10);
    expect(degToRad(90)).toBeCloseTo(HALF_PI, 12);
    expect(sinDeg(30)).toBeCloseTo(0.5, 9);
    expect(cosDeg(60)).toBeCloseTo(0.5, 9);
    expect(wrapDeg(-90)).toBe(270);
    expect(wrapDeg(450)).toBe(90);
    expect(wrapRad(3 * PI)).toBeCloseTo(PI, 9);
  });
});
