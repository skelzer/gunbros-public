/**
 * A minimal PNG decoder for tests, on `node:zlib` alone (no dependency): enough for
 * what `pnpm maps` writes — non-interlaced, 8-bit RGB/RGBA and 1/2/4/8-bit indexed with
 * a `tRNS` chunk — decoded to straight RGBA bytes.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, row major. */
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (file[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < file.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...file.subarray(pos + 4, pos + 8));
    const body = file.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = body[8] as number;
      colourType = body[9] as number;
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      trns = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : colourType === 3 || colourType === 0 ? 1 : 0;
  if (channels === 0 || (colourType !== 3 && depth !== 8)) {
    throw new Error(`unsupported PNG: colour type ${colourType}, depth ${depth}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = (width * channels * depth + 7) >> 3;
  const rows = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (out[i - bpp] as number) : 0;
      const b = prev[i] as number;
      const c = i >= bpp ? (prev[i - bpp] as number) : 0;
      const x = line[i] as number;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`bad PNG filter ${filter}`);
      out[i] = v & 255;
    }
    prev = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colourType === 3) {
        const bit = x * depth;
        const idx = ((row[bit >> 3] as number) >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        data[o] = palette?.[idx * 3] ?? 0;
        data[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        data[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        data[o + 3] = trns && idx < trns.length ? (trns[idx] as number) : 255;
      } else if (colourType === 0) {
        const g = row[x] as number;
        data[o] = g;
        data[o + 1] = g;
        data[o + 2] = g;
        data[o + 3] = 255;
      } else {
        const i = x * channels;
        data[o] = row[i] as number;
        data[o + 1] = row[i + 1] as number;
        data[o + 2] = row[i + 2] as number;
        data[o + 3] = channels === 4 ? (row[i + 3] as number) : 255;
      }
    }
  }
  return { width, height, data };
}
