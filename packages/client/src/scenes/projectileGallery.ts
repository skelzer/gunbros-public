/**
 * The projectile gallery (dev only, `/projectiles`): every sprite key the roster fires,
 * mobile by mobile, drawn from the Blender projectile atlas
 * (tools/blender/build_projectiles.py). Each key shows eight of its directions (or its
 * first frames) still, then flies a loop of arcs left and right across a strip of sky
 * so the direction picking, the spin and the flicker can be judged in motion. A key the
 * atlas does not have yet is flagged MISSING and drawn with the plain fallback square.
 *
 * Reached through the same `import.meta.env.DEV` guarded dynamic import as the sandbox.
 * `?scale=N` changes the CSS scale (default 3); `?bg=dark` swaps the sky for a cave.
 */
import { getMobileDef, mobileIds, shotSlots } from '@gunbros/shared';
import { drawMine, drawProjectile } from '../render/sprites.js';
import type { ProjectileLook } from '../render/sprites.js';
import {
  EXTRA_SPRITE_KEYS,
  projectileFrame,
  projectilePiece,
} from '../render/projectileSprites.js';
import { el } from '../ui/dom.js';

const INK = '#dfe7ef';
const DIM = '#8b9aa8';

const STYLE = `
.pj-gallery{position:absolute;inset:0;overflow:auto;padding:16px;color:${INK};font:12px ui-monospace,Menlo,Consolas,monospace;}
.pj-gallery h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${DIM};margin:18px 0 6px;}
.pj-gallery canvas{image-rendering:pixelated;display:block;}
.pj-gallery .row{display:flex;gap:12px;align-items:center;margin:4px 0;}
.pj-gallery .name{width:210px;flex:none;}
.pj-gallery .missing{color:#ff8f7a;}
`;

interface Cell {
  key: string;
  mine: boolean;
  canvas: HTMLCanvasElement;
  label: HTMLElement;
}

const STILL_W = 8 * 30;
const FLIGHT_W = 260;
const H = 40;

function look(key: string, vx: number, vy: number, age: number): ProjectileLook {
  const fragment = key.endsWith('Fragment');
  return {
    def: { sprite: fragment ? key.slice(0, -'Fragment'.length) : key },
    vx,
    vy,
    age,
    data: fragment ? { fragment: 1 } : {},
  };
}

function drawCell(cell: Cell, tick: number, dark: boolean): void {
  const ctx = cell.canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, dark ? '#1b1a22' : '#5f9fd8');
  g.addColorStop(1, dark ? '#302a2a' : '#a9d3f0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cell.canvas.width, H);
  const piece = projectilePiece(cell.key);
  cell.label.classList.toggle('missing', !piece);

  if (cell.mine) {
    ctx.fillStyle = dark ? '#4a3b30' : '#5a8a3a';
    ctx.fillRect(0, H - 8, cell.canvas.width, 8);
    for (let i = 0; i < 4; i++) drawMine(ctx, cell.key, 20 + i * 60, H - 8, tick + i * 7);
    return;
  }

  // Eight directions, every 45 degrees from right, counter-clockwise.
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const age = piece && piece.mode !== 'aim' ? i * piece.frameTicks : tick;
    drawProjectile(ctx, look(cell.key, Math.cos(a), -Math.sin(a), age), 15 + i * 30, H / 2);
  }

  // An arc: up and over, left to right then right to left, 120 ticks each way.
  const t = tick % 240;
  const dir = t < 120 ? 1 : -1;
  const u = (t % 120) / 120;
  const x0 = STILL_W + 16;
  const x = x0 + (dir > 0 ? u : 1 - u) * (FLIGHT_W - 32);
  const y = H - 6 - (1 - (2 * u - 1) ** 2) * (H - 14);
  const vx = (dir * (FLIGHT_W - 32)) / 120;
  const vy = (4 * (H - 14) * (2 * u - 1)) / 120;
  drawProjectile(ctx, look(cell.key, vx, vy, t % 120), x, y);
  if (piece) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillText(`${piece.mode} ${projectileFrame(piece, vx, vy, t % 120)}`, x0, 10);
  }
}

export function mountProjectileGallery(host: HTMLElement): void {
  host.replaceChildren();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const params = new URLSearchParams(window.location.search);
  const scale = Number(params.get('scale')) || 3;
  const dark = params.get('bg') === 'dark';
  const page = el('div', 'pj-gallery');
  page.style.background = '#1c2433';
  host.appendChild(page);

  const cells: Cell[] = [];
  const addRow = (key: string, note: string, mine = false): void => {
    const row = el('div', 'row');
    const label = el('div', 'name', `${key}\n${note}`);
    label.style.whiteSpace = 'pre';
    const canvas = document.createElement('canvas');
    canvas.width = STILL_W + FLIGHT_W;
    canvas.height = H;
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${H * scale}px`;
    row.append(label, canvas);
    page.appendChild(row);
    cells.push({ key, mine, canvas, label });
  };

  const seen = new Set<string>();
  for (const id of mobileIds) {
    const def = getMobileDef(id);
    page.appendChild(el('h2', '', `${def.displayName} (${id})`));
    for (const slot of shotSlots) {
      const shot = def.shots[slot];
      const key = shot.projectile.sprite;
      const note = `${slot} ${shot.displayName}${seen.has(key) ? ' (shared key)' : ''}`;
      seen.add(key);
      addRow(key, note);
    }
  }
  page.appendChild(el('h2', '', 'Spawned by behaviours, and mines'));
  for (const extra of EXTRA_SPRITE_KEYS) addRow(extra.key, extra.note, extra.mine);

  let tick = 0;
  const frame = (): void => {
    tick++;
    for (const cell of cells) drawCell(cell, tick, dark);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
