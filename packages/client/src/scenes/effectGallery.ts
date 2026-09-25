/**
 * The effects gallery (dev only, `/effects`): every flipbook in the Blender effects
 * atlas (tools/blender/build_effects.py), looping at game speed over a strip of sky and
 * ground with its anchor on the ground line, grouped by kind. Beams are tiled three
 * segments tall so a seam would show. A clip the client asks for that the atlas lacks
 * is listed in red.
 *
 * Reached through the same `import.meta.env.DEV` guarded dynamic import as the sandbox.
 * `?scale=N` changes the CSS scale (default 3); `?bg=dark` swaps the sky for a cave;
 * `?only=blast_` shows only keys containing that text.
 */
import { damageTypes } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';
import {
  clipFrameAt,
  clipLength,
  drawEffectFrame,
  effectClip,
  effectSpritesReady,
} from '../render/effectSprites.js';
import type { EffectClip } from '../render/effectSprites.js';
import { el } from '../ui/dom.js';

const INK = '#dfe7ef';
const DIM = '#8b9aa8';
const HOLD_TICKS = 20;

const STYLE = `
.fx-gallery{position:absolute;inset:0;overflow:auto;padding:16px;color:${INK};font:12px ui-monospace,Menlo,Consolas,monospace;}
.fx-gallery h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${DIM};margin:18px 0 6px;}
.fx-gallery canvas{image-rendering:pixelated;display:block;}
.fx-gallery .strip{display:flex;flex-wrap:wrap;gap:10px;}
.fx-gallery .cell{display:flex;flex-direction:column;gap:2px;}
.fx-gallery .missing{color:#ff8f7a;}
`;

interface Cell {
  key: string;
  canvas: HTMLCanvasElement;
  label: HTMLElement;
  sized: boolean;
}

/** Every key the client can ask for, by group. */
function wantedKeys(): [string, string[]][] {
  const sp = clientConstants.effects.sprites;
  const blasts: [string, string[]][] = damageTypes.map((t) => [
    `Blast: ${t}`,
    [...sp.blastTiers.map((tier) => `blast_${t}_${tier.tier}`), `hit_${t}`],
  ]);
  const smoke: string[] = [];
  for (const size of ['s', 'l']) for (const v of ['a', 'b', 'c']) smoke.push(`smoke_${size}_${v}`);
  return [
    ...blasts,
    ['Death and smoke', ['death_blast', ...smoke]],
    [
      'Beams, teleport, vortex',
      [...sp.beamTiers.map((t) => `beam_${t.tier}`), 'beam_hit', 'teleport', 'vortex'],
    ],
  ];
}

function drawCell(cell: Cell, clip: EffectClip | undefined, tick: number, dark: boolean): void {
  const ctx = cell.canvas.getContext('2d');
  if (!ctx) return;
  cell.label.classList.toggle('missing', !clip);
  if (!clip) return;
  const beam = clip.tile === true;
  const w = clip.size[0] + 16;
  const h = beam ? clip.size[1] * 3 + 8 : clip.size[1] + 8;
  if (!cell.sized) {
    const scale = Number(new URLSearchParams(window.location.search).get('scale')) || 3;
    cell.canvas.width = w;
    cell.canvas.height = h;
    cell.canvas.style.width = `${w * scale}px`;
    cell.canvas.style.height = `${h * scale}px`;
    cell.sized = true;
  }
  ctx.imageSmoothingEnabled = false;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, dark ? '#1b1a22' : '#5f9fd8');
  g.addColorStop(1, dark ? '#302a2a' : '#a9d3f0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const age = tick % (clipLength(clip) + HOLD_TICKS);
  const frame = clipFrameAt(clip, age);
  const x = 8 + clip.anchor[0];
  if (beam) {
    for (let k = 0; k < 3; k++)
      if (frame >= 0) drawEffectFrame(ctx, clip, frame, x, 4 + k * clip.size[1]);
    return;
  }
  const groundY = 4 + clip.anchor[1];
  ctx.fillStyle = dark ? '#4a3b30' : '#5a8a3a';
  ctx.fillRect(0, groundY, w, h - groundY);
  if (frame >= 0) drawEffectFrame(ctx, clip, frame, x, groundY);
}

export function mountEffectGallery(host: HTMLElement): void {
  host.replaceChildren();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const params = new URLSearchParams(window.location.search);
  const dark = params.get('bg') === 'dark';
  const only = params.get('only') ?? '';
  const page = el('div', 'fx-gallery');
  page.style.background = '#1c2433';
  host.appendChild(page);

  const cells: Cell[] = [];
  for (const [title, keys] of wantedKeys()) {
    const shown = keys.filter((k) => k.includes(only));
    if (shown.length === 0) continue;
    page.appendChild(el('h2', '', title));
    const strip = el('div', 'strip');
    page.appendChild(strip);
    for (const key of shown) {
      const cell = el('div', 'cell');
      const label = el('div', '', key);
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      cell.append(label, canvas);
      strip.appendChild(cell);
      cells.push({ key, canvas, label, sized: false });
    }
  }

  // Sim ticks at 60 a second, whatever the display runs at.
  let tick = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    tick += Math.floor((now - last) / (1000 / 60));
    last = now - ((now - last) % (1000 / 60));
    if (effectSpritesReady())
      for (const cell of cells) drawCell(cell, effectClip(cell.key), tick, dark);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
