/**
 * Just enough PNG for the splash build: decode the game's sheets and map art (8-bit
 * RGBA/RGB, 1/2/4/8-bit palette, grey), composite in RGBA, and encode again — as a
 * palette PNG when the picture has 256 colours or fewer, which pixel art nearly always
 * does. Node built-ins only (zlib), so `pnpm site` needs no image dependency.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** An RGBA picture, 4 bytes per pixel, rows top to bottom. */
export class Bitmap {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  /** Source-over one pixel. */
  put(x, y, r, g, b, a = 255) {
    if (a === 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    if (a === 255 || d[i + 3] === 0) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a === 255 ? 255 : a;
      return;
    }
    const sa = a / 255;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    d[i] = (r * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  fillRect(x, y, w, h, [r, g, b, a = 255]) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.put(xx, yy, r, g, b, a);
  }

  /** Draw `src` (or its `sx, sy, sw, sh` part) with its top-left on `dx, dy`. */
  draw(src, dx, dy, { sx = 0, sy = 0, sw = src.width, sh = src.height, flipX = false, scale = 1 } = {}) {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = 0; y < sh * scale; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      const syy = sy + Math.floor(y / scale);
      for (let x = 0; x < sw * scale; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const fx = Math.floor(x / scale);
        const sxx = sx + (flipX ? sw - 1 - fx : fx);
        const i = (syy * src.width + sxx) * 4;
        const a = src.data[i + 3];
        if (a) this.put(tx, ty, src.data[i], src.data[i + 1], src.data[i + 2], a);
      }
    }
  }

  crop(x, y, w, h) {
    const out = new Bitmap(w, h);
    out.draw(this, -x, -y);
    return out;
  }

  /** Whole-pixel blow-up. */
  scaled(n) {
    const out = new Bitmap(this.width * n, this.height * n);
    out.draw(this, 0, 0, { scale: n });
    return out;
  }

  /** Bounding box of the non-transparent pixels, or null. */
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[(y * this.width + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

export function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
  }
  if (interlace) throw new Error('interlaced PNG not supported');
  if (depth === 16) throw new Error('16-bit PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = Math.ceil((width * bitsPP) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) v += paeth(a, b, c);
      out[i] = v & 255;
    }
    prev = out;
  }
  const bmp = new Bitmap(width, height);
  const d = bmp.data;
  const sample = (row, index) => {
    if (depth === 8) return row[index];
    const bit = index * depth;
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const p = sample(row, x);
        d[o] = palette[p * 3];
        d[o + 1] = palette[p * 3 + 1];
        d[o + 2] = palette[p * 3 + 2];
        d[o + 3] = trns && p < trns.length ? trns[p] : 255;
      } else if (type === 0 || type === 4) {
        const g = type === 0 ? Math.round((sample(row, x) * 255) / ((1 << depth) - 1)) : row[x * 2];
        d[o] = d[o + 1] = d[o + 2] = g;
        d[o + 3] = type === 4 ? row[x * 2 + 1] : 255;
      } else if (type === 2) {
        d[o] = row[x * 3];
        d[o + 1] = row[x * 3 + 1];
        d[o + 2] = row[x * 3 + 2];
        d[o + 3] = 255;
      } else {
        d[o] = row[x * 4];
        d[o + 1] = row[x * 4 + 1];
        d[o + 2] = row[x * 4 + 2];
        d[o + 3] = row[x * 4 + 3];
      }
    }
  }
  return bmp;
}

export function readPng(path) {
  return decodePng(readFileSync(path));
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const head = Buffer.from(kind, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head, body])));
  return Buffer.concat([len, head, body, crc]);
}

/** Filter every row with the heuristic that gives the smallest absolute sum. */
function filterRows(rows, stride, height, bpp) {
  const out = Buffer.alloc((stride + 1) * height);
  let prev = Buffer.alloc(stride);
  const cand = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    let best = 0;
    let bestSum = Infinity;
    let bestBuf = null;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 255;
        cand[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
        bestBuf = Buffer.from(cand);
      }
    }
    out[y * (stride + 1)] = best;
    bestBuf.copy(out, y * (stride + 1) + 1);
    prev = row;
  }
  return out;
}

export function encodePng(bmp) {
  const { width, height, data } = bmp;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Palette when it fits: a map, a sprite strip or the og card all do.
  const index = new Map();
  let fits = true;
  for (let i = 0; i < data.length; i += 4) {
    const key = data[i + 3] === 0 ? 0 : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    if (!index.has(key)) {
      if (index.size >= 256) {
        fits = false;
        break;
      }
      index.set(key, index.size);
    }
  }

  let idat;
  const parts = [SIGNATURE];
  if (fits) {
    // Opaque entries last so tRNS can stop early; transparent first.
    const keys = [...index.keys()].sort((a, b) => (a & 255) - (b & 255));
    keys.forEach((k, i) => index.set(k, i));
    const depth = keys.length <= 2 ? 1 : keys.length <= 4 ? 2 : keys.length <= 16 ? 4 : 8;
    ihdr[8] = depth;
    ihdr[9] = 3;
    const plte = Buffer.alloc(keys.length * 3);
    const alphas = [];
    keys.forEach((k, i) => {
      plte[i * 3] = k >>> 24;
      plte[i * 3 + 1] = (k >>> 16) & 255;
      plte[i * 3 + 2] = (k >>> 8) & 255;
      alphas.push(k & 255);
    });
    const stride = Math.ceil((width * depth) / 8);
    const rows = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const key = data[i + 3] === 0 ? 0 : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
        const p = index.get(key);
        const bit = x * depth;
        rows[y * stride + (bit >> 3)] |= p << (8 - depth - (bit & 7));
      }
    }
    idat = filterRows(rows, stride, height, 1);
    parts.push(chunk('IHDR', ihdr), chunk('PLTE', plte));
    let lastTrans = -1;
    alphas.forEach((a, i) => {
      if (a !== 255) lastTrans = i;
    });
    if (lastTrans >= 0) parts.push(chunk('tRNS', Buffer.from(alphas.slice(0, lastTrans + 1))));
  } else {
    ihdr[8] = 8;
    ihdr[9] = 6;
    idat = filterRows(Buffer.from(data.buffer, data.byteOffset, data.length), width * 4, height, 4);
    parts.push(chunk('IHDR', ihdr));
  }
  parts.push(chunk('IDAT', deflateSync(idat, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

export function writePng(path, bmp) {
  const buf = encodePng(bmp);
  writeFileSync(path, buf);
  return buf.length;
}
