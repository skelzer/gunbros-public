/**
 * A minimal PNG encoder built on Node built-ins only (`node:zlib` for the deflate
 * stream, hand-rolled chunks and CRC-32). The art pass needs to *look* at sprites, and
 * pulling a native canvas binding into the repo for that would be a build liability.
 *
 * Tooling only — never imported by `packages/shared` (DESIGN §1.2 purity).
 */
import { deflateSync } from 'node:zlib';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A writable RGBA8 image. Origin is top-left; out-of-bounds writes are dropped. */
export class Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, fill?: Rgba) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    if (fill) this.fillRect(0, 0, width, height, fill);
  }

  set(x: number, y: number, c: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    if (c.a >= 255) {
      this.data[o] = c.r;
      this.data[o + 1] = c.g;
      this.data[o + 2] = c.b;
      this.data[o + 3] = 255;
      return;
    }
    // Source-over, so translucent guide marks read against the checker.
    const sa = c.a / 255;
    const da = (this.data[o + 3] ?? 0) / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) {
      this.data[o + 3] = 0;
      return;
    }
    const mix = (s: number, d: number): number => Math.round((s * sa + d * da * (1 - sa)) / oa);
    this.data[o] = mix(c.r, this.data[o] ?? 0);
    this.data[o + 1] = mix(c.g, this.data[o + 1] ?? 0);
    this.data[o + 2] = mix(c.b, this.data[o + 2] ?? 0);
    this.data[o + 3] = Math.round(oa * 255);
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    }
  }

  /** A 1 px rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let xx = x; xx < x + w; xx++) {
      this.set(xx, y, c);
      this.set(xx, y + h - 1, c);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.set(x, yy, c);
      this.set(x + w - 1, yy, c);
    }
  }

  /** Bresenham, for the aim-line guide. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

// --------------------------------------------------------------------------
// PNG container
// --------------------------------------------------------------------------

const crcTable = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (crcTable[(c ^ (bytes[i] ?? 0)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(body).copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + body.length));
  out.writeUInt32BE(crc, 8 + body.length);
  return out;
}

/** Encode an RGBA8 bitmap as a PNG buffer (filter 0 on every scanline). */
export function encodePng(bmp: Bitmap): Buffer {
  const stride = bmp.width * 4;
  const raw = Buffer.alloc((stride + 1) * bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(bmp.data.buffer, bmp.data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bmp.width, 0);
  ihdr.writeUInt32BE(bmp.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// --------------------------------------------------------------------------
// Colours and a 3x5 label font
// --------------------------------------------------------------------------

/** `#rrggbb` (the palette format the sprite tests enforce) to RGBA. */
export function parseHex(hex: string): Rgba {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`bad palette colour: ${hex}`);
  const n = Number.parseInt(m[1] as string, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 };
}

/**
 * A 3x5 pixel font, as five 3-bit rows per glyph (MSB = left column). Only the
 * characters the sheets label with: A-Z, 0-9 and a few separators.
 */
const glyphs: Record<string, number[]> = {
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b010],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  Q: [0b010, 0b101, 0b101, 0b111, 0b011],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b011],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b011, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  '/': [0b001, 0b001, 0b010, 0b100, 0b100],
  '.': [0b000, 0b000, 0b000, 0b000, 0b010],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000],
  'x': [0b000, 0b101, 0b010, 0b101, 0b000],
  ' ': [0, 0, 0, 0, 0],
};

/** Width in px of {@link drawText} for `text` at `scale`. */
export function textWidth(text: string, scale = 1): number {
  return text.length === 0 ? 0 : (text.length * 4 - 1) * scale;
}

/** Draw uppercase 3x5 text with its top-left at (x, y). Unknown glyphs become blanks. */
export function drawText(bmp: Bitmap, text: string, x: number, y: number, c: Rgba, scale = 1): void {
  let cx = x;
  for (const raw of text) {
    const ch = raw === 'x' ? 'x' : raw.toUpperCase();
    const rows = glyphs[ch] ?? glyphs[' '];
    for (let ry = 0; ry < 5; ry++) {
      const bits = (rows as number[])[ry] ?? 0;
      for (let rx = 0; rx < 3; rx++) {
        if (!(bits & (1 << (2 - rx)))) continue;
        bmp.fillRect(cx + rx * scale, y + ry * scale, scale, scale, c);
      }
    }
    cx += 4 * scale;
  }
}
