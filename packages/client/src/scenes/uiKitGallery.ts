/**
 * The UI kit gallery (dev only, `/uikit`): every piece of the Blender UI kit
 * (tools/blender/build_ui_kit.py) at 1x and 3x, the nine-slices stretched the way the
 * HUD and the menus will use them, and the same pieces in the DOM as CSS border-images.
 *
 * Reached through the same `import.meta.env.DEV` guarded dynamic import as the sandbox,
 * so a production build never emits it. `?scale=N` changes the CSS scale of the "in
 * use" board (default 2).
 */
import { itemIds, shotSlots } from '@gunbros/shared';
import { createOffscreen } from '../render/canvas.js';
import {
  BUTTON_STATES,
  CARD_STATES,
  FILL_COLOURS,
  installUiKitCss,
  loadUiKit,
  SLOT_STATES,
  drawBar,
  drawNineSlice,
  drawUiPiece,
  drawUiPieceAt,
  stripFrameFor,
  uiClassName,
  uiPieceElement,
  uiPieceNames,
} from '../render/uiKit.js';
import type { UiKit, UiPieceName } from '../render/uiKit.js';
import { drawPixelText, pixelTextWidth } from '../ui/pixelFont.js';
import { el } from '../ui/dom.js';

const BOARD = '#1c2433';
const INK = '#dfe7ef';
const DIM = '#6f7f8d';

const STYLE = `
.uk-gallery{position:absolute;inset:0;overflow:auto;padding:16px;color:${INK};font:13px ui-monospace,Menlo,Consolas,monospace;}
.uk-gallery h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${DIM};margin:18px 0 8px;}
.uk-gallery canvas{image-rendering:pixelated;display:block;}
.uk-gallery .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px;}
.uk-gallery button{font:inherit;color:#fff;text-transform:uppercase;letter-spacing:.1em;padding:0 10px;
  min-height:44px;cursor:pointer;text-shadow:0 2px 0 rgba(0,0,0,.5);}
.uk-gallery .uk-btn-gold{color:#2a1604;text-shadow:0 1px 0 rgba(255,255,255,.35);}
.uk-gallery .demo-panel{padding:4px 8px;max-width:340px;line-height:1.5;}
.uk-gallery .demo-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px;width:64px;}
.uk-gallery .demo-slot{display:flex;align-items:center;justify-content:center;width:52px;height:52px;box-sizing:border-box;}
.uk-gallery .demo-banner{padding:2px 22px;text-transform:uppercase;letter-spacing:.14em;font-weight:bold;}
`;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = DIM): void {
  drawPixelText(ctx, text, x, y, { color });
}

/** Every piece at 1x beside the same piece at 3x, flowed into rows. */
function drawEveryPiece(k: UiKit, width: number): HTMLCanvasElement {
  const pad = 10;
  const cells = uiPieceNames().map((name) => {
    const p = k.atlas.pieces[name];
    const frames = p?.frames ?? (p ? [p.rect] : []);
    const [w, h] = p ? [p.rect[2], p.rect[3]] : [0, 0];
    const shown = Math.min(frames.length, 8);
    const oneX = frames.length > 1 ? frames.length * (w + 1) : w;
    const threeX = shown * (w * 3 + 2);
    const cw = Math.max(pixelTextWidth(name) + 2, frames.length > 1 ? Math.max(oneX, threeX) : w + 4 + w * 3);
    const ch = 8 + (frames.length > 1 ? h + 4 + h * 3 : h * 3);
    return { name, frames: frames.length, w, h, cw, ch, missing: !p };
  });
  const place: Array<{ x: number; y: number }> = [];
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const c of cells) {
    if (x + c.cw > width - pad && x > pad) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    place.push({ x, y });
    x += c.cw + pad * 2;
    rowH = Math.max(rowH, c.ch);
  }
  const { canvas, ctx } = createOffscreen(width, y + rowH + pad);
  ctx.fillStyle = BOARD;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  cells.forEach((c, i) => {
    const at = place[i] ?? { x: 0, y: 0 };
    const name = c.name as UiPieceName;
    label(ctx, name, at.x, at.y, c.missing ? '#ff7b6b' : DIM);
    const top = at.y + 8;
    if (c.frames > 1) {
      for (let f = 0; f < c.frames; f++) drawUiPiece(ctx, name, at.x + f * (c.w + 1), top, 1, f);
      for (let f = 0; f < Math.min(c.frames, 8); f++) {
        drawUiPiece(ctx, name, at.x + f * (c.w * 3 + 2), top + c.h + 4, 3, f * Math.floor(c.frames / 8));
      }
    } else {
      drawUiPiece(ctx, name, at.x, top, 1);
      drawUiPiece(ctx, name, at.x + c.w + 4, top, 3);
    }
  });
  return canvas;
}

/** The pieces put together the way the HUD will use them. */
function drawInUse(): HTMLCanvasElement {
  const { canvas, ctx } = createOffscreen(420, 300);
  ctx.fillStyle = BOARD;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // A bottom bar with a dial, a power bar and six slots.
  drawNineSlice(ctx, 'panel-bar', 4, 196, 412, 100);
  drawUiPieceAt(ctx, 'dial', 44, 250);
  ctx.strokeStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(44.5, 250.5);
  ctx.lineTo(44.5 + Math.cos(-0.7) * 22, 250.5 + Math.sin(-0.7) * 22);
  ctx.stroke();
  drawUiPieceAt(ctx, 'dial-hub', 44, 250);
  drawNineSlice(ctx, 'trough', 84, 214, 200, 16);
  drawBar(ctx, 'fill/amber', 88, 218, 130);
  drawUiPieceAt(ctx, 'power-marker', 88 + 150, 216);
  drawNineSlice(ctx, 'trough-small', 84, 234, 200, 8);
  drawBar(ctx, 'fill-small/cyan', 87, 236, 140);
  itemIds.slice(0, 6).forEach((id, i) => {
    const state = i === 2 ? 'used' : i === 4 ? 'active' : i === 5 ? 'empty' : 'filled';
    drawNineSlice(ctx, `slot/${state}`, 84 + i * 34, 250, 31, 31);
    if (state !== 'empty') drawUiPieceAt(ctx, `item/${id}`, 84 + i * 34 + 15.5, 265.5);
  });
  BUTTON_STATES.forEach((s, i) => {
    drawNineSlice(ctx, i < 2 ? `button-gold/${s}` : `button/${s}`, 296 + (i % 2) * 58, 208 + Math.floor(i / 2) * 30, 54, 26);
    label(ctx, i < 2 ? 'FIRE' : 'SKIP', 296 + (i % 2) * 58 + 19, 218 + Math.floor(i / 2) * 30 + (s === 'pressed' ? 1 : 0), INK);
  });

  // Top furniture: wind, banner, a panel with a player list.
  drawUiPieceAt(ctx, 'wind-plate', 210, 30);
  drawUiPieceAt(ctx, 'wind-arrow', 210, 30, 1, stripFrameFor('wind-arrow', -30));
  drawNineSlice(ctx, 'banner/gold', 150, 58, 120, 24);
  label(ctx, 'YOUR TURN', 210 - Math.round(pixelTextWidth('YOUR TURN') / 2), 67, INK);
  drawNineSlice(ctx, 'banner/steel', 150, 86, 120, 24);
  label(ctx, 'WAITING', 210 - Math.round(pixelTextWidth('WAITING') / 2), 95, INK);
  drawNineSlice(ctx, 'panel', 6, 6, 120, 76);
  ['BRO A', 'BRO B', 'BRO C'].forEach((nick, i) => {
    drawUiPiece(ctx, i === 2 ? 'status/dead' : 'status/heart', 14, 16 + i * 20);
    label(ctx, nick, 30, 16 + i * 20, INK);
    drawNineSlice(ctx, 'trough-small', 60, 18 + i * 20, 56, 8);
    drawBar(ctx, i === 1 ? 'fill-small/red' : 'fill-small/green', 63, 20 + i * 20, i === 2 ? 0 : i === 1 ? 14 : 44);
  });
  drawNineSlice(ctx, 'panel-dark', 290, 6, 124, 40);
  label(ctx, 'NOTICE', 300, 14, INK);
  drawNineSlice(ctx, 'recess', 300, 24, 104, 14);
  drawNineSlice(ctx, 'frame-gold', 286, 52, 132, 30);

  // Weapon cards with the shot icons in them.
  CARD_STATES.forEach((s, i) => {
    drawNineSlice(ctx, `card/${s}`, 10 + i * 40, 104, 36, 48);
    const shot = shotSlots[i % shotSlots.length] ?? 's1';
    drawUiPieceAt(ctx, `shot/${shot}`, 28 + i * 40, 124);
    label(ctx, shot, 22 + i * 40, 138, s === 'locked' ? DIM : INK);
  });
  FILL_COLOURS.forEach((c, i) => {
    drawNineSlice(ctx, 'trough', 180, 104 + i * 18, 110, 16);
    drawBar(ctx, `fill/${c}`, 184, 108 + i * 18, 20 + i * 20);
  });
  // The same trough at 2x: corners scale, the middle stretches.
  drawNineSlice(ctx, 'trough', 300, 104, 110, 32, 2);
  drawBar(ctx, 'fill/violet', 308, 112, 94, 2);
  return canvas;
}

function domDemo(): HTMLElement {
  const wrap = el('div');
  const buttons = el('div', 'row');
  for (const [cls, text, disabled] of [
    ['uk-btn', 'Create room', false],
    ['uk-btn', 'Join', false],
    ['uk-btn', 'Disabled', true],
    ['uk-btn-gold', 'Ready!', false],
    ['uk-btn-gold', 'Start', true],
  ] as const) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.disabled = disabled;
    buttons.appendChild(b);
  }
  const panel = el('div', `${uiClassName('panel')} demo-panel`);
  panel.textContent =
    'A riveted panel as a CSS border-image, cut from the same PNG as the canvas pieces. ' +
    'Buttons above use .uk-btn and .uk-btn-gold: hover, press and disable them.';
  const dark = el('div', `${uiClassName('panel-dark')} demo-panel`, 'panel-dark, for read-only furniture.');
  const banners = el('div', 'row');
  banners.append(
    el('div', `${uiClassName('banner/gold')} demo-banner`, 'Your turn'),
    el('div', `${uiClassName('banner/steel')} demo-banner`, 'Bro B is aiming'),
  );
  const cards = el('div', 'row');
  CARD_STATES.forEach((s, i) => {
    const card = el('div', `${uiClassName(`card/${s}`)} demo-card`);
    const shot = shotSlots[i % shotSlots.length] ?? 's1';
    card.append(uiPieceElement(`shot/${shot}`, 2), el('span', '', shot.toUpperCase()));
    cards.appendChild(card);
  });
  const slots = el('div', 'row');
  SLOT_STATES.forEach((s, i) => {
    const slot = el('div', `${uiClassName(`slot/${s}`)} demo-slot`);
    const id = itemIds[i];
    if (s !== 'empty' && id) slot.appendChild(uiPieceElement(`item/${id}`, 2));
    slots.appendChild(slot);
  });
  wrap.append(buttons, panel, el('div', 'row'), dark, banners, cards, slots);
  return wrap;
}

export function mountUiKitGallery(host: HTMLElement): void {
  host.replaceChildren();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const page = el('div', 'uk-gallery');
  page.style.background = BOARD;
  page.appendChild(el('h2', '', 'UI kit (tools/blender/build_ui_kit.py) — loading…'));
  host.appendChild(page);

  const cssScale = Number(new URLSearchParams(window.location.search).get('scale')) || 2;
  void Promise.all([loadUiKit(), installUiKitCss()]).then(
    ([k]) => {
      page.replaceChildren();
      const [aw, ah] = k.atlas.size;
      page.appendChild(el('h2', '', `Every piece, 1x and 3x (atlas ${aw}x${ah}, ${Object.keys(k.atlas.pieces).length} pieces)`));
      page.appendChild(drawEveryPiece(k, Math.max(640, Math.min(1400, window.innerWidth - 40))));
      page.appendChild(el('h2', '', `In use, canvas at 1x shown ${cssScale}x`));
      const board = drawInUse();
      board.style.width = `${board.width * cssScale}px`;
      board.style.height = `${board.height * cssScale}px`;
      page.appendChild(board);
      page.appendChild(el('h2', '', 'In the DOM (border-image, --uk-scale 2)'));
      page.appendChild(domDemo());
    },
    (err: unknown) => {
      page.replaceChildren(el('h2', '', `UI kit failed to load: ${String(err)}`));
    },
  );
}
