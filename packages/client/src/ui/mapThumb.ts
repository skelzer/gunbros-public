/**
 * The map picker's picture (DESIGN §8.1): a map's `thumb.png` (160 x 90, written by
 * `pnpm maps`) in a gold kit frame, next to the dropdown that names it. The room and the
 * lobby's New room card both use it; `set` swaps the picture when the map changes (the
 * host picks another, or a `roomState` says so).
 *
 * A map without painted art, or a thumbnail that fails to load, shows the frame with the
 * map's name in it rather than a broken-image icon.
 */
import { maps } from '@gunbros/shared';
import type { MapId } from '@gunbros/shared';
import { mapArtUrl } from '../render/mapArt.js';
import { uiClassName } from '../render/uiKit.js';
import { el } from './dom.js';

export interface MapThumb {
  element: HTMLElement;
  set(mapId: MapId): void;
}

export function mapThumb(mapId: MapId, className = ''): MapThumb {
  const element = el('div', `map-thumb ${uiClassName('frame-gold')} ${className}`.trim());
  const img = document.createElement('img');
  img.width = 160;
  img.height = 90;
  img.decoding = 'async';
  img.draggable = false;
  const fallback = el('span', 'map-thumb-name');
  element.append(img, fallback);
  img.addEventListener('error', () => {
    img.hidden = true;
  });
  let shown: MapId | null = null;
  const set = (id: MapId): void => {
    if (id === shown) return;
    shown = id;
    const def = maps.find((m) => m.id === id);
    const name = def?.displayName ?? id;
    fallback.textContent = name;
    element.title = name;
    if (def?.art) {
      img.hidden = false;
      img.alt = `${name}: map preview`;
      img.src = mapArtUrl(id, def.art.thumb);
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }
  };
  set(mapId);
  return { element, set };
}
