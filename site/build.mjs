#!/usr/bin/env node
/**
 * Builds the GunBros splash page into `site/dist/`.
 *
 *     pnpm site              # or: node site/build.mjs
 *
 * Everything the page shows is cut from the game's own files at build time, so the
 * splash can never drift from the game:
 *
 * - the hero scene: Rolling Hills' terrain and plates, copied from
 *   `packages/client/public/maps/hills/`, placed with the plate numbers in
 *   `packages/shared/src/data/maps/masks/hills.ts`;
 * - the roster: every mobile's idle loop, cut from its Blender sheet
 *   (`public/sprites/blender/<atlas>.png|json`) with the barrel composited over the body,
 *   cropped to the loop's bounds; names, classes and shots from `shared/src/data/mobiles`;
 * - the map cards: each painted map rendered through its plates and terrain at a fixed
 *   camera (no HUD, no debug text), names from `shared/src/data/maps`;
 * - the wordmark: the lobby's 7x9 letters, read from `client/src/ui/pixelFont.ts`;
 * - the UI kit atlas, the favicons and `site/og.png` (made by `site/og.mjs`).
 *
 * Node built-ins only. Nothing here touches the game's own build.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePng } from './lib/png.mjs';
import { MAP_IDS, PUBLIC, floorY, readMap, readMobiles, renderScene, idleStrip, wordmark } from './lib/game.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const DIST = join(SITE, 'dist');

/** The one-line idea of each map (docs/PROGRESS.md, "Painted maps"). */
const MAP_IDEAS = {
  hills: 'Two high grounds and a valley between them: lob over the cottage, or shoot the cover away.',
  pit: 'A straight exchange across a chasm, over a rope bridge that one shot drops.',
  islands: 'Floating isles and a central crag that forces the lob. Every rim is a drop.',
  cave: 'A roof takes the lob away. Flat shots through windows between fangs and crystals.',
  glacier: 'Shelves that end in overhangs you can shoot away, and an ice spire mid-valley that stops flat shots.',
  forge: 'A volcano wall down the middle: lob over it or tunnel through it.',
  temple: 'Height against cover, and a covered gallery with one clean sightline.',
  scrapyard: 'An airship hull is the only bridge, between lattice girder towers.',
};

/** Where each map card looks: the world point at the centre of the picture. */
const MAP_FOCUS = {
  hills: [960, 545],
  pit: [930, 520],
  islands: [1000, 520],
  cave: [900, 570],
  glacier: [900, 620],
  forge: [900, 450],
  temple: [950, 590],
  scrapyard: [940, 630],
};
/**
 * Two mobiles squaring up on each map card: [left one, right one], and optionally where
 * across the picture (0..1) each one looks for ground first.
 */
const MAP_CAST = {
  hills: ['armor', 'jfrog', [0.24, 0.56]],
  pit: ['raon', 'boomer'],
  islands: ['aduka', 'dragon'],
  cave: ['nak', 'trico'],
  glacier: ['ice', 'turtle'],
  forge: ['bigfoot', 'lightning'],
  temple: ['knight', 'mage'],
  scrapyard: ['kalsiddon', 'grub', [0.24, 0.9]],
};
const CARD_W = 640;
const CARD_H = 300;

/** Mobiles standing on the hero's hills: atlas, world x, facing. */
const HERO_MOBILES = [
  { id: 'armor', x: 520, facing: 1 },
  { id: 'jfrog', x: 1000, facing: 1 },
  { id: 'dragon', x: 1380, facing: -1 },
];
/** Barrel angle the hero's mobiles hold (the roster's portraits keep it level, like the room). */
const HERO_AIM = 32;

/** UI kit pieces the page uses, as CSS classes over the atlas. */
const UI_PIECES = [
  'dial-small', 'wind-plate', 'shot/s1', 'shot/s2', 'shot/ss',
  'item/dual', 'item/dualPlus', 'item/teleport', 'item/healSmall', 'item/healLarge', 'item/bunge', 'item/powerUp', 'item/windChange',
  'status/delay', 'status/heart', 'status/thor', 'status/tornado', 'status/force', 'status/shield', 'status/ssReady', 'power-marker',
];

const CLASS_LABEL = { mechanical: 'Mechanical', bionic: 'Bionic', shielded: 'Shielded' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function main() {
  const t0 = Date.now();
  rmSync(DIST, { recursive: true, force: true });
  for (const d of ['art/mobiles', 'art/maps', 'art/hero', 'icons']) mkdirSync(join(DIST, d), { recursive: true });

  // --- wordmark -------------------------------------------------------------
  const mark = wordmark('GunBros');
  writePng(join(DIST, 'art', 'wordmark.png'), mark);

  // --- mobiles ----------------------------------------------------------------
  const mobiles = readMobiles();
  const strips = {};
  for (const m of mobiles) {
    if (!m.atlas) throw new Error(`mobile ${m.id} has no Blender atlas`);
    // Row 0: barrel level (the roster). Row 1: barrel raised (the hero).
    const s = idleStrip(m.atlas, [0, HERO_AIM]);
    writePng(join(DIST, 'art', 'mobiles', `${m.atlas}.png`), s.strip);
    strips[m.id] = s;
  }
  const roster = mobiles
    .map((m) => {
      const s = strips[m.id];
      const vars = `--fw:${s.frameW};--fh:${s.frameH};--n:${s.frames};--ms:${s.frameMs};--ax:${s.anchorX};--ay:${s.anchorY}`;
      const badge = m.randomOnly ? '<span class="tag tag-random" title="Only reachable through a Random pick">Random only</span>' : '';
      return `        <li class="mobile-card" style="${vars}">
          <div class="mobile-stage"><div class="sprite"><img src="art/mobiles/${m.atlas}.png" width="${s.frameW * s.frames}" height="${s.frameH * 2}" alt="" loading="lazy" decoding="async"></div></div>
          <h3>${esc(m.name)}</h3>
          <p class="mobile-meta"><span class="tag tag-${m.class}">${CLASS_LABEL[m.class] ?? m.class}</span>${badge}</p>
          <p class="mobile-ss"><span class="ui ui-shot-ss" aria-hidden="true"></span>${esc(m.shots[2] ?? '')}</p>
        </li>`;
    })
    .join('\n');

  // --- maps -------------------------------------------------------------------
  const maps = MAP_IDS.map((id) => readMap(id));
  for (const map of maps) {
    const [fx, fy] = MAP_FOCUS[map.id];
    const camX = Math.max(0, Math.min(map.width - CARD_W, Math.round(fx - CARD_W / 2)));
    const camY = Math.max(0, Math.min(map.height - CARD_H, Math.round(fy - CARD_H / 2)));
    const scene = renderScene(map, { camX, camY, w: CARD_W, h: CARD_H });
    // Stand the pair on the ground: search outwards from a quarter in from each side for
    // a column with floor under it inside the picture, and face them at each other.
    const [left, right, at = [0.24, 0.76]] = MAP_CAST[map.id] ?? [];
    [left, right].filter(Boolean).forEach((id, side) => {
      const s = strips[id];
      const facing = side === 0 ? 1 : -1;
      const target = camX + Math.round(CARD_W * at[side]);
      for (let d = 0; d < CARD_W * 0.2; d += 4) {
        const x = target + (side === 0 ? d : -d);
        const y = floorY(map.id, x, camY + CARD_H - 4, camY + s.frameH);
        const yl = y && floorY(map.id, x - 8, camY + CARD_H - 4, camY + s.frameH);
        const yr = y && floorY(map.id, x + 8, camY + CARD_H - 4, camY + s.frameH);
        if (y == null || yl == null || yr == null || Math.abs(yl - y) > 6 || Math.abs(yr - y) > 6) continue;
        const ax = facing === 1 ? s.anchorX : s.frameW - 1 - s.anchorX;
        scene.draw(s.frame(0, 1), x - camX - ax, y - camY - s.anchorY, { flipX: facing === -1 });
        break;
      }
    });
    writePng(join(DIST, 'art', 'maps', `${map.id}.png`), scene);
  }
  const mapCards = maps
    .map(
      (map) => `        <li class="map-card">
          <div class="map-media"><img src="art/maps/${map.id}.png" width="${CARD_W}" height="${CARD_H}" alt="${esc(map.name)}, as it looks in the game" loading="lazy" decoding="async"></div>
          <div class="map-text">
            <h3>${esc(map.name)}</h3>
            <p>${esc(MAP_IDEAS[map.id] ?? '')}</p>
          </div>
        </li>`,
    )
    .join('\n');

  // --- hero scene ---------------------------------------------------------------
  const hills = maps.find((m) => m.id === 'hills');
  const heroDir = join(PUBLIC, 'maps', 'hills');
  copyFileSync(join(heroDir, 'terrain.png'), join(DIST, 'art', 'hero', 'terrain.png'));
  for (const p of hills.plates) copyFileSync(join(heroDir, p.src), join(DIST, 'art', 'hero', p.src));
  const heroData = {
    map: {
      width: hills.width,
      height: hills.height,
      sky: hills.sky,
      terrain: 'art/hero/terrain.png',
      plates: hills.plates.map((p) => ({ ...p, src: `art/hero/${p.src}` })),
    },
    mobiles: HERO_MOBILES.map((h) => {
      const m = mobiles.find((mm) => mm.id === h.id);
      const s = strips[h.id];
      return {
        name: m.name,
        src: `art/mobiles/${m.atlas}.png`,
        x: h.x,
        facing: h.facing,
        fw: s.frameW,
        fh: s.frameH,
        n: s.frames,
        ms: s.frameMs,
        ax: s.anchorX,
        ay: s.anchorY,
      };
    }),
  };

  // --- UI kit -----------------------------------------------------------------
  const kit = JSON.parse(readFileSync(join(PUBLIC, 'ui', 'blender', 'ui_kit.json'), 'utf8'));
  copyFileSync(join(PUBLIC, 'ui', 'blender', 'ui_kit.png'), join(DIST, 'art', 'ui_kit.png'));
  const uiCss = UI_PIECES.map((name) => {
    const piece = kit.pieces[name];
    if (!piece) throw new Error(`ui kit has no piece ${name}`);
    const [x, y, w, h] = piece.rect;
    return `.ui-${name.replace(/\//g, '-')}{--x:${x};--y:${y};--w:${w};--h:${h}}`;
  }).join('\n');
  const arrow = kit.pieces['wind-arrow'];
  const arrowCss = arrow.frames.map(([x, y], i) => `.wind-arrow[data-dir="${i}"]{--x:${x};--y:${y}}`).join('\n');

  // --- icons and og ---------------------------------------------------------------
  for (const f of ['icon-32.png', 'icon-180.png', 'icon-192.png']) copyFileSync(join(PUBLIC, 'icons', f), join(DIST, 'icons', f));
  copyFileSync(join(SITE, 'og.png'), join(DIST, 'og.png'));

  // --- page -------------------------------------------------------------------
  let html = readFileSync(join(SITE, 'index.html'), 'utf8');
  const fill = (marker, value) => {
    if (!html.includes(marker)) throw new Error(`index.html has no ${marker}`);
    html = html.replace(marker, () => value);
  };
  fill('<!--ROSTER-->', roster);
  fill('<!--MAPS-->', mapCards);
  fill('/*UI_CSS*/', `${uiCss}\n${arrowCss}`);
  fill('<!--MOBILE_COUNT-->', String(mobiles.length));
  fill('<!--MAP_COUNT-->', String(maps.length));
  fill('"__HERO_DATA__"', JSON.stringify(heroData).replace(/</g, '\\u003c'));
  writeFileSync(join(DIST, 'index.html'), html);
  for (const f of ['style.css', 'script.js', 'robots.txt', '_headers']) copyFileSync(join(SITE, f), join(DIST, f));

  // --- report -------------------------------------------------------------------
  let total = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  walk(DIST);
  console.log(`site: ${mobiles.length} mobiles, ${maps.length} maps -> site/dist (${(total / 1024).toFixed(0)} KiB) in ${Date.now() - t0} ms`);
}

main();
