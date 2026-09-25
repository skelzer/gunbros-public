/**
 * Reads the game's own sources, so the splash page can never drift from the game: the
 * mobile roster (names, classes, shots) from `packages/shared/src/data/mobiles`, the
 * maps (names, sky, plate placements) from `packages/shared/src/data/maps`, the sheet
 * each mobile is drawn from from the client's `blenderSprites.ts`, and the wordmark's
 * pixel letters from `pixelFont.ts`. Plain regular expressions over TypeScript: the
 * shapes read here are simple object literals and stable, and a failed match throws.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bitmap, parseHex, readPng } from './png.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUBLIC = join(ROOT, 'packages', 'client', 'public');
const SHARED_DATA = join(ROOT, 'packages', 'shared', 'src', 'data');
const CLIENT_SRC = join(ROOT, 'packages', 'client', 'src');

function need(match, what) {
  if (!match) throw new Error(`site build: could not read ${what}`);
  return match;
}

// ---------------------------------------------------------------------------
// Mobiles
// ---------------------------------------------------------------------------

/** Mobile id -> atlas name (`armor` -> `tank`), from the client's ATLASES table. */
export function readAtlasNames() {
  const src = readFileSync(join(CLIENT_SRC, 'render', 'blenderSprites.ts'), 'utf8');
  const block = need(src.match(/const ATLASES[^=]*=\s*\{([\s\S]*?)\};/), 'ATLASES')[1];
  const out = {};
  for (const m of block.matchAll(/(\w+):\s*'(\w+)'/g)) out[m[1]] = m[2];
  return out;
}

/** Every mobile definition file, in the roster order of `mobiles/index.ts`. */
export function readMobiles() {
  const dir = join(SHARED_DATA, 'mobiles');
  const atlases = readAtlasNames();
  const index = readFileSync(join(dir, 'index.ts'), 'utf8');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  const defs = files.map((f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    const id = need(src.match(/^\s+id:\s*'(\w+)'/m), `${f} id`)[1];
    const names = [...src.matchAll(/displayName:\s*'([^']+)'/g)].map((m) => m[1]);
    const cls = need(src.match(/^\s+class:\s*'(\w+)'/m), `${f} class`)[1];
    const randomOnly = /randomOnly:\s*true/.test(src);
    return {
      id,
      name: names[0],
      class: cls,
      shots: names.slice(1, 4),
      randomOnly,
      atlas: atlases[id],
    };
  });
  // Roster order: the order the ids first appear in the index's import list.
  const order = (id) => {
    const i = index.indexOf(`'./${id}.js'`);
    return i < 0 ? 1e9 : i;
  };
  defs.sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name));
  return defs;
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

function readPlateLiteral(text) {
  const num = (k) => {
    const m = text.match(new RegExp(`${k}:\\s*(-?[\\d.]+)`));
    return m ? Number(m[1]) : undefined;
  };
  const str = (k) => {
    const m = text.match(new RegExp(`${k}:\\s*'([^']*)'`));
    return m ? m[1] : undefined;
  };
  return {
    src: str('src'),
    parallax: num('parallax'),
    width: num('width'),
    height: num('height'),
    x: num('x') ?? 0,
    y: num('y') ?? 0,
    fillAbove: str('fillAbove'),
    fillBelow: str('fillBelow'),
  };
}

/** One painted map: name, size, sky, and its plates back to front. */
export function readMap(id) {
  const src = readFileSync(join(SHARED_DATA, 'maps', `${id}.ts`), 'utf8');
  const masks = readFileSync(join(SHARED_DATA, 'maps', 'masks', `${id}.ts`), 'utf8');
  const name = need(src.match(/displayName:\s*'([^']+)'/), `${id} displayName`)[1];
  const width = Number(need(src.match(/^\s+width:\s*(\d+)/m), `${id} width`)[1]);
  const height = Number(need(src.match(/^\s+height:\s*(\d+)/m), `${id} height`)[1]);
  const sky = [...need(masks.match(/Sky:\s*string\[\]\s*=\s*\[([^\]]*)\]/), `${id} sky`)[1].matchAll(/'(#[0-9a-fA-F]+)'/g)].map((m) => m[1]);
  const plateDefs = {};
  const platesBlock = need(masks.match(/Plates:[^=]*=\s*\{([\s\S]*?)\n\};/), `${id} plates`)[1];
  for (const m of platesBlock.matchAll(/(\w+):\s*(\{[^}]*kind:\s*'plate'[^}]*\})/g)) plateDefs[m[1]] = readPlateLiteral(m[2]);
  // Back to front, as the map's background array lists them.
  const background = need(src.match(/Background:\s*ParallaxLayer\[\]\s*=\s*\[([\s\S]*?)\n\];/), `${id} background`)[1];
  const plates = [...background.matchAll(/\w+Plates\.(\w+)/g)].map((m) => plateDefs[m[1]]).filter(Boolean);
  return { id, name, width, height, sky, plates };
}

export const MAP_IDS = ['hills', 'pit', 'islands', 'cave', 'glacier', 'forge', 'temple', 'scrapyard'];

/** Colour at `t` (0..1) along a ramp of hex stops. */
export function rampAt(colors, t) {
  const stops = colors.map(parseHex);
  const f = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * k)).concat(255);
}

const imageCache = new Map();
function image(path) {
  if (!imageCache.has(path)) imageCache.set(path, readPng(path));
  return imageCache.get(path);
}

/**
 * The map as the camera sees it at `camX, camY` (world px of the view's top-left) in a
 * `w x h` view: banded sky, plates by parallax, then the terrain. The same arithmetic
 * as the client's background (`PlateLayer`); the code-drawn layers (sun, clouds,
 * birds) are left out.
 */
export function renderScene(map, { camX, camY, w, h, skyBands = 10 }) {
  const out = new Bitmap(w, h);
  for (let i = 0; i < skyBands; i++) {
    const y0 = Math.floor((i * h) / skyBands);
    const y1 = Math.floor(((i + 1) * h) / skyBands);
    out.fillRect(0, y0, w, y1 - y0, rampAt(map.sky, i / (skyBands - 1)));
  }
  const dir = join(PUBLIC, 'maps', map.id);
  for (const p of map.plates) {
    const img = image(join(dir, p.src));
    const x = Math.round(p.x - camX * p.parallax);
    const y = Math.round(p.y - camY * p.parallax);
    if (p.fillAbove && y > 0) out.fillRect(0, 0, w, y, parseHex(p.fillAbove));
    if (p.fillBelow && y + img.height < h) out.fillRect(0, y + img.height, w, h - y - img.height, parseHex(p.fillBelow));
    out.draw(img, x, y);
  }
  out.draw(image(join(dir, 'terrain.png')), -camX, -camY);
  return out;
}

/**
 * The standing surface in column `x` seen from below: walks up from `bottomY` through
 * solid ground and returns the first empty row's y + 1, or null when `bottomY` is air
 * (a chasm) or the solid run reaches above `topY` (a wall).
 */
export function floorY(mapId, x, bottomY, topY) {
  const t = image(join(PUBLIC, 'maps', mapId, 'terrain.png'));
  const solid = (y) => t.data[(y * t.width + x) * 4 + 3] !== 0;
  let y = Math.min(bottomY, t.height - 1);
  if (!solid(y)) return null;
  while (y > topY && solid(y)) y--;
  return y > topY ? y + 1 : null;
}

/** World y of the first solid terrain pixel in column `x`, scanning down from `fromY`. */
export function groundY(mapId, x, fromY = 0) {
  const t = image(join(PUBLIC, 'maps', mapId, 'terrain.png'));
  for (let y = fromY; y < t.height; y++) if (t.data[(y * t.width + x) * 4 + 3]) return y;
  return t.height;
}

// ---------------------------------------------------------------------------
// Mobile sprites
// ---------------------------------------------------------------------------

/**
 * A mobile's idle loop as one strip: body with the barrel over it at `aimDeg` (rotated
 * about the frame's pivot with nearest-neighbour sampling, as the game's canvas does with
 * smoothing off), cropped to the loop's union bounds so the page does not ship air.
 * Returns the frames side by side and where the feet (the atlas anchor) land.
 */
export function idleStrip(atlasName, aims = [0]) {
  const dir = join(PUBLIC, 'sprites', 'blender');
  const atlas = JSON.parse(readFileSync(join(dir, `${atlasName}.json`), 'utf8'));
  const body = image(join(dir, atlas.sheets.body));
  const barrel = image(join(dir, atlas.sheets.barrel));
  const [fw, fh] = atlas.frameSize;
  const [ax, ay] = atlas.anchor;
  const idle = atlas.states.idle;
  const pad = 24;
  const frames = [];
  for (const aim of aims) {
    for (const f of idle.frames) {
      const [sx, sy] = f.rect;
      const bmp = new Bitmap(fw + pad * 2, fh + pad * 2);
      bmp.draw(body, pad, pad, { sx, sy, sw: fw, sh: fh });
      if (f.barrel) {
        const [px, py] = f.pivot;
        const th = (aim * Math.PI) / 180;
        const cos = Math.cos(th);
        const sin = Math.sin(th);
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x++) {
            // Destination relative to the pivot, rotated back into the barrel frame.
            const vx = x - pad + 0.5 - px;
            const vy = y - pad + 0.5 - py;
            const bx = Math.floor(cos * vx - sin * vy + px);
            const by = Math.floor(sin * vx + cos * vy + py);
            if (bx < 0 || by < 0 || bx >= fw || by >= fh) continue;
            const [r, g, b, a] = barrel.get(sx + bx, sy + by);
            if (a) bmp.put(x, y, r, g, b, a);
          }
        }
      }
      frames.push(bmp);
    }
  }
  let box = null;
  for (const f of frames) {
    const b = f.bounds();
    if (!b) continue;
    if (!box) box = { ...b };
    else {
      const x1 = Math.max(box.x + box.w, b.x + b.w);
      const y1 = Math.max(box.y + box.h, b.y + b.h);
      box.x = Math.min(box.x, b.x);
      box.y = Math.min(box.y, b.y);
      box.w = x1 - box.x;
      box.h = y1 - box.y;
    }
  }
  const n = idle.frames.length;
  const strip = new Bitmap(box.w * n, box.h * aims.length);
  frames.forEach((f, i) => strip.draw(f.crop(box.x, box.y, box.w, box.h), (i % n) * box.w, Math.floor(i / n) * box.h));
  const frameMs = Math.round((Math.max(1, idle.frameTicks) * 1000) / atlas.tickRate);
  return {
    strip,
    frameW: box.w,
    frameH: box.h,
    frames: n,
    frameMs,
    anchorX: ax + pad - box.x,
    anchorY: ay + pad - box.y,
    // Each strip row, one frame: for a still picture (og image).
    frame(i, row = 0) {
      return strip.crop((i % n) * box.w, row * box.h, box.w, box.h);
    },
  };
}

// ---------------------------------------------------------------------------
// Pixel letters
// ---------------------------------------------------------------------------

function readGlyphTable(name) {
  const src = readFileSync(join(CLIENT_SRC, 'ui', 'pixelFont.ts'), 'utf8');
  const block = need(src.match(new RegExp(`const ${name}:[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`)), `pixelFont ${name}`)[1];
  const out = {};
  for (const m of block.matchAll(/(?:'((?:\\.|[^'])+)'|"([^"]+)"|([A-Za-z0-9_]))\s*:\s*\[([^\]]*)\]/g)) {
    const key = (m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1');
    out[key] = [...m[4].matchAll(/'([.#]+)'/g)].map((r) => r[1]);
  }
  return out;
}

const WORDMARK_RAMP = ['#fff3c4', '#ffd23f', '#f0a020', '#b4620e'];

/**
 * "GunBros" as the lobby draws it (`drawWordmark` in pixelFont.ts): 7x9 letters, a 1 px
 * near-black outline, a four-band ramp, plus a hard drop shadow for the sky behind it.
 */
export function wordmark(text = 'GunBros', { shadow = '#0b1220' } = {}) {
  const glyphs = readGlyphTable('DISPLAY');
  const W = 7;
  const H = 9;
  const pad = 3;
  const width = [...text].length * (W + 1) - 1 + pad * 2;
  const bmp = new Bitmap(width, H + pad * 2);
  const paint = (dx, dy, colorAt) => {
    let px = pad + dx;
    for (const ch of text) {
      const g = glyphs[ch] ?? glyphs[ch.toUpperCase()] ?? glyphs[ch.toLowerCase()];
      if (g) {
        for (let row = 0; row < H; row++) {
          const c = colorAt(row);
          for (let col = 0; col < W; col++) if (g[row][col] === '#') bmp.put(px + col, pad + dy + row, ...c);
        }
      }
      px += W + 1;
    }
  };
  const sh = parseHex(shadow);
  if (shadow) {
    for (let oy = 1; oy <= 3; oy++) for (let ox = -1; ox <= 1; ox++) paint(ox, oy, () => sh);
  }
  const outline = parseHex('#10141c');
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) paint(ox, oy, () => outline);
  const ramp = WORDMARK_RAMP.map(parseHex);
  paint(0, 0, (row) => (row <= 1 ? ramp[0] : row <= 4 ? ramp[1] : row <= 6 ? ramp[2] : ramp[3]));
  return bmp;
}

/** Text in the game's 3x5 body font, `scale` whole pixels per font pixel. */
export function pixelText(bmp, text, x, y, color, { scale = 1, outline, shadow } = {}) {
  const glyphs = readGlyphTable('GLYPHS');
  const c = parseHex(color);
  const draw = (dx, dy, col) => {
    let px = x + dx;
    for (const ch of text) {
      const g = glyphs[ch] ?? glyphs[ch.toUpperCase()] ?? glyphs[' '];
      for (let row = 0; row < 5; row++) for (let colI = 0; colI < 3; colI++) {
        if (g[row][colI] === '#') bmp.fillRect(px + colI * scale, y + dy + row * scale, scale, scale, col);
      }
      px += 4 * scale;
    }
  };
  if (shadow) draw(0, scale, parseHex(shadow));
  if (outline) {
    const o = parseHex(outline);
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) draw(ox * scale, oy * scale, o);
  }
  draw(0, 0, c);
  return text.length * 4 * scale - scale;
}
