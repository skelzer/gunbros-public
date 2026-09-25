/** Tiny 2-D vector helpers. Plain objects; no allocation-heavy abstractions. */
import { cos, sin, atan2, DEG_TO_RAD, RAD_TO_DEG } from './trig.js';

export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lenSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b));
}

export function normalise(a: Vec2): Vec2 {
  const l = len(a);
  if (l === 0) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

/**
 * Unit vector for a world angle in degrees, where 0 = right and 90 = up.
 * World +y points down, so the y component is negated.
 */
export function fromAngleDeg(deg: number): Vec2 {
  const r = deg * DEG_TO_RAD;
  return { x: cos(r), y: -sin(r) };
}

/** World angle in degrees (0 = right, 90 = up) of a vector. */
export function angleDegOf(a: Vec2): number {
  return atan2(-a.y, a.x) * RAD_TO_DEG;
}

export function rotateRad(a: Vec2, rad: number): Vec2 {
  const c = cos(rad);
  const s = sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}
