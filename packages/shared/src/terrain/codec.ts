/**
 * Run-length encoding of a terrain mask (DESIGN §2.3).
 *
 * No deflate: shared cannot import Node or DOM APIs. Runs alternate air/solid starting
 * with air, counts are base-36, separated by '.'. A typical mask lands well under 40 KB,
 * which is fine for the rare `terrainMask` resync message.
 */
import { Terrain } from './terrain.js';

const VERSION = 'r1';

export function encodeRle(terrain: Terrain): string {
  const m = terrain.mask;
  const runs: string[] = [];
  let current = 0; // runs always start with an air run, possibly of length 0
  let count = 0;
  for (let i = 0; i < m.length; i++) {
    const v = m[i] as number;
    if (v === current) {
      count++;
    } else {
      runs.push(count.toString(36));
      current = v;
      count = 1;
    }
  }
  runs.push(count.toString(36));
  return `${VERSION}:${terrain.width.toString(36)}:${terrain.height.toString(36)}:${runs.join('.')}`;
}

export function decodeRle(rle: string): Terrain {
  const parts = rle.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('bad terrain RLE payload');
  }
  const width = parseInt(parts[1] as string, 36);
  const height = parseInt(parts[2] as string, 36);
  const terrain = new Terrain(width, height);
  const mask = terrain.mask;
  const runs = (parts[3] as string).split('.');
  let i = 0;
  let value = 0;
  for (let r = 0; r < runs.length; r++) {
    const count = parseInt(runs[r] as string, 36);
    if (value === 1) {
      const end = i + count;
      for (let k = i; k < end; k++) mask[k] = 1;
    }
    i += count;
    value = value === 0 ? 1 : 0;
  }
  if (i !== mask.length) {
    throw new Error(`terrain RLE length mismatch: ${i} vs ${mask.length}`);
  }
  terrain.invalidateHash();
  return terrain;
}
