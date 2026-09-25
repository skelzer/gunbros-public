/**
 * The painted art of a map (DESIGN §8.1): `public/maps/<id>/terrain.png` and one PNG per
 * `plate` layer, rendered by `pnpm maps` (tools/blender/maps/).
 *
 * Loading is a preload, not a lazy fetch: a map's art is asked for when a match or the
 * sandbox is being set up, and `MatchView.start` waits for it — up to
 * `clientConstants.mapArt.preloadTimeoutMs` — before its first frame, so a match never
 * opens on the band painter and then flips to the picture. Whatever has not arrived by
 * then is drawn the old way (bands for the ground, nothing for a plate) and swapped in
 * the frame it lands; a file that fails to load stays on the fallback for good.
 *
 * Every image is decoded before it is handed out (`HTMLImageElement.decode`), so the
 * first `drawImage` of a plate costs a blit and not a decode on the frame it appears.
 * The terrain is also read back once into an `ImageData`: the terrain renderer needs
 * its pixels to repaint around a crater, not just a picture to blit.
 *
 * Presentation only: nothing here reaches the simulation, which builds the ground from
 * the mask string in the map definition and never from a picture.
 */
import type { MapDef, PlateLayer } from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';
import { createOffscreen } from './canvas.js';

export interface LoadedMapArt {
  /** The terrain picture's pixels, map sized, or null when the map has none or it failed. */
  terrain: ImageData | null;
  /** Decoded plate images by `src`; a plate that failed is simply absent. */
  plates: Map<string, HTMLImageElement>;
}

const ROOT = `${import.meta.env.BASE_URL}maps/`;

/** One load per map id for the life of the page: the art never changes under a tab. */
const loads = new Map<string, Promise<LoadedMapArt>>();
const loaded = new Map<string, LoadedMapArt>();

export function mapArtUrl(mapId: string, file: string): string {
  return `${ROOT}${mapId}/${file}`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = (): void => {
      img.decode().then(
        () => resolve(img),
        () => resolve(img),
      );
    };
    img.onerror = (): void => resolve(null);
    img.src = url;
  });
}

function readPixels(img: HTMLImageElement, width: number, height: number): ImageData | null {
  // A picture of the wrong size is a stale export: the mask would not line up with it.
  if (img.naturalWidth !== width || img.naturalHeight !== height) return null;
  const { ctx } = createOffscreen(width, height);
  ctx.drawImage(img, 0, 0);
  try {
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
}

function platesOf(map: MapDef): PlateLayer[] {
  return map.background.filter((l): l is PlateLayer => l.kind === 'plate');
}

/** Start (or join) loading a map's art. Resolves once every file has loaded or failed. */
export function preloadMapArt(map: MapDef): Promise<LoadedMapArt> {
  const existing = loads.get(map.id);
  if (existing) return existing;
  const art = map.art;
  const plates = platesOf(map);
  const promise = Promise.all([
    art ? loadImage(mapArtUrl(map.id, art.terrain)) : Promise.resolve(null),
    Promise.all(plates.map((p) => loadImage(mapArtUrl(map.id, p.src)))),
  ]).then(([terrainImg, plateImgs]) => {
    const result: LoadedMapArt = {
      terrain: terrainImg ? readPixels(terrainImg, map.width, map.height) : null,
      plates: new Map(),
    };
    plates.forEach((p, i) => {
      const img = plateImgs[i];
      if (img) result.plates.set(p.src, img);
    });
    loaded.set(map.id, result);
    return result;
  });
  loads.set(map.id, promise);
  return promise;
}

/** What has arrived for a map so far, or null while it is still loading. */
export function mapArtFor(mapId: string): LoadedMapArt | null {
  return loaded.get(mapId) ?? null;
}

/**
 * Resolve when a map's art is in, or after `timeoutMs` (default: the preload budget),
 * whichever is first. Never rejects: a slow or missing file means the fallback.
 */
export function waitForMapArt(
  map: MapDef,
  timeoutMs: number = clientConstants.mapArt.preloadTimeoutMs,
): Promise<void> {
  if (loaded.has(map.id)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void preloadMapArt(map).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
