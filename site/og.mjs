#!/usr/bin/env node
/**
 * The social card (Open Graph / Twitter), 1200 x 630, composed from game art:
 * Rolling Hills through its plates at 2x, three mobiles on it, the wordmark and a line
 * in the game's 3x5 font. Committed as `site/og.png`; `site/build.mjs` copies it.
 *
 *     node site/og.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bitmap, writePng } from './lib/png.mjs';
import { groundY, idleStrip, pixelText, readMap, renderScene, wordmark } from './lib/game.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const W = 600;
const H = 315;
const CAM_X = 250;
const CAM_Y = 318;

const map = readMap('hills');
const scene = renderScene(map, { camX: CAM_X, camY: CAM_Y, w: W, h: H, skyBands: 8 });

// Mobiles on the ground, feet on the first solid pixel of their column.
const cast = [
  { atlas: 'frog', x: 352, facing: 1, aim: 24 },
  { atlas: 'tank', x: 522, facing: 1, aim: 38 },
];
for (const c of cast) {
  const s = idleStrip(c.atlas, [c.aim]);
  const frame = s.frame(0);
  const gy = groundY('hills', c.x, 300);
  const ax = c.facing === 1 ? s.anchorX : s.frameW - 1 - s.anchorX;
  scene.draw(frame, c.x - CAM_X - ax, gy - CAM_Y - s.anchorY, { flipX: c.facing === -1 });
}

// A shot in flight: the tank's shell arcing off to the right, dotted like a trail.
{
  const ox = 522 - CAM_X + 18;
  const oy = groundY('hills', 522, 300) - CAM_Y - 26;
  const vx = 3.1;
  const vy = -3.3;
  const g = 0.05;
  for (let t = 6; t < 200; t += 5) {
    const x = Math.round(ox + vx * t);
    const y = Math.round(oy + vy * t + (g * t * t) / 2);
    if (x > W) break;
    if (y < 108 && x < 428) continue; // behind the title: the arc reappears past it
    scene.fillRect(x - 1, y - 1, 3, 3, [16, 20, 28, 255]);
    scene.fillRect(x, y, 1, 1, [255, 243, 196, 255]);
  }
}

const card = scene.scaled(2);

// Wordmark: 8x, centred, near the top.
const mark = wordmark('GunBros');
const markScale = 8;
card.draw(mark, Math.round((1200 - mark.width * markScale) / 2), 34, { scale: markScale });

// Tagline in the HUD's 3x5 face.
const line = 'TURN-BASED ARTILLERY FOR BROS';
const scale = 4;
const width = line.length * 4 * scale - scale;
const plate = new Bitmap(width + 36, 5 * scale + 24);
plate.fillRect(0, 0, plate.width, plate.height, [5, 10, 18, 255]);
plate.fillRect(1, 1, plate.width - 2, plate.height - 2, [27, 42, 62, 255]);
plate.fillRect(1, 1, plate.width - 2, Math.round(plate.height * 0.42), [36, 55, 79, 255]);
plate.fillRect(1, 1, plate.width - 2, 1, [70, 100, 138, 255]);
plate.fillRect(1, plate.height - 2, plate.width - 2, 1, [10, 16, 23, 255]);
pixelText(plate, line, 18, 12, '#ffd23f', { scale, shadow: '#070d18' });
card.draw(plate, Math.round((1200 - plate.width) / 2), 34 + mark.height * markScale + 10);

const bytes = writePng(join(SITE, 'og.png'), card);
console.log(`og.png: 1200x630, ${(bytes / 1024).toFixed(0)} KiB`);
