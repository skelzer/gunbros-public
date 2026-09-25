/**
 * Six lines of DOM sugar for the menu screens.
 *
 * The lobby and the room are menus, so they are HTML rather than canvas (a text field
 * and a scrolling chat log are not worth reimplementing with a blitter). These helpers
 * exist only to keep those two files readable: no framework, no virtual DOM, no
 * reactivity — the room simply rebuilds its list whenever a `roomState` arrives, which
 * is exactly how the protocol delivers it (DESIGN §6.2: full state, no partial updates).
 */
import { hasGlyphs, pixelTextCanvas } from './pixelFont.js';
import type { PixelTextOptions } from './pixelFont.js';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function textInput(placeholder: string, value = '', maxLength = 64): HTMLInputElement {
  const node = el('input', 'field');
  node.type = 'text';
  node.placeholder = placeholder;
  node.value = value;
  node.maxLength = maxLength;
  node.autocomplete = 'off';
  node.spellcheck = false;
  return node;
}

export interface Option<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function select<T extends string>(
  options: Option<T>[],
  value: T,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const node = el('select', 'field');
  for (const option of options) {
    const item = el('option', '', option.label);
    item.value = option.value;
    if (option.disabled) item.disabled = true;
    node.appendChild(item);
  }
  node.value = value;
  node.addEventListener('change', () => onChange(node.value as T));
  return node;
}

/**
 * A caption above a control.
 *
 * `tag` is `'label'` for the single-control fields, where clicking the caption should
 * focus the control under it. A field whose "control" is a *group* of buttons must pass
 * `'div'`: a click anywhere on a `<label>` activates its first labelable descendant, so
 * a caption over a row of buttons would press the first button — on the item bar that
 * silently removed the first entry of the loadout. The styling is class-based, so the
 * two tags look the same.
 */
export function labelled(
  text: string,
  control: HTMLElement,
  tag: 'label' | 'div' = 'label',
): HTMLElement {
  const wrap = el(tag, 'labelled');
  wrap.appendChild(el('span', 'label', text));
  wrap.appendChild(control);
  return wrap;
}

/**
 * Text in the HUD's 3x5 pixel face (ui/pixelFont.ts), for the menus' headings, tags and
 * badges. The pixels are a canvas the screen reader is told to skip, and the words are
 * a visually hidden span beside it, so the label still reads, selects by role and name
 * in a test, and translates. Text the face cannot spell (a nickname in any alphabet)
 * stays ordinary text, because a glyph drawn as nothing is worse than a smooth one.
 */
export function pixelLabel(
  text: string,
  options: PixelTextOptions = {},
  className = '',
): HTMLSpanElement {
  const wrap = el('span', `pixel-label ${className}`.trim());
  if (!hasGlyphs(text)) {
    wrap.textContent = text;
    wrap.classList.add('plain');
    return wrap;
  }
  const art = pixelTextCanvas(text.toUpperCase(), { color: '#dfe7ef', shadow: '#050a12', ...options });
  art.setAttribute('aria-hidden', 'true');
  wrap.append(el('span', 'sr-only', text), art);
  return wrap;
}

/**
 * The menus' phone layout: a landscape screen too short for the desktop one. The same
 * test as the phone rules in index.html (chosen by height, like the canvas HUD), so
 * the few sizes that live in script — the portraits, which are canvases and cannot
 * stretch — change exactly when the style sheet does.
 */
export const COMPACT_QUERY = '(orientation: landscape) and (max-height: 520px)';

export function compactMenus(): boolean {
  return window.matchMedia?.(COMPACT_QUERY).matches ?? false;
}
