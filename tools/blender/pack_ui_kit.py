# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""
The UI kit's renders to one game-ready atlas.

    uv run pack_ui_kit.py --work work/ui --assets ../../packages/client/public/ui/blender \
        --preview work/ui_kit_preview.png

Every frame goes through `postprocess.process_frame`, the same reduction the mobiles get
(majority vote downscale, palette quantise to the piece's own materials, part lines,
outline, orphan removal). Then, by kind:

- `nine`: the edge strips and the centre are made exactly uniform along their length,
  from the middle row or column of each, so stretching or tiling them is lossless and
  the client can scale them without seams.
- `hbar`: every column is the middle column, so the piece tiles along x.

Pieces are shelf-packed, tallest first, with a 1 px transparent gutter, into
`ui_kit.png`, and `ui_kit.json` records each piece's rect, kind, slices, pivot and
frames. The preview shows everything at 1x and 3x plus stretched nine-slices.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import postprocess as pp

HERE = Path(__file__).resolve().parent
ATLAS_WIDTH = 256
GUTTER = 1


def uniform_nine(a, slices):
    """Edges and centre copied from their middle row / column (corners untouched)."""
    t, r, b, l = slices
    h, w = a.shape[:2]
    out = a.copy()
    mx = l + (w - l - r) // 2
    my = t + (h - t - b) // 2
    out[:, l:w - r] = out[:, mx:mx + 1]           # top edge, centre, bottom edge: constant along x
    out[t:h - b, :] = out[my:my + 1, :]           # left edge, centre, right edge: constant along y
    # The centre is now the single pixel at (my, mx) repeated.
    return out


def uniform_x(a):
    return np.repeat(a[:, a.shape[1] // 2:a.shape[1] // 2 + 1], a.shape[1], axis=1)


def process(work, info, scale, glow_from):
    pal = pp.Palette(info['materials'])
    glow = range(glow_from, 27)
    frames = []
    for name in info['frames']:
        a = pp.process_frame(work / 'ui' / f'{name}.png', scale, pal, 'mode', True, glow)
        if info['kind'] == 'nine':
            a = uniform_nine(a, info['slices'])
        elif info['kind'] == 'hbar':
            a = uniform_x(a)
        assert set(np.unique(a[..., 3])) <= {0, 255}, 'semi-transparent pixel survived'
        frames.append(a)
    return frames


def shelf_pack(items, width):
    """items: (key, w, h). Tallest first, left to right, a new shelf when a row is full."""
    placed = {}
    x = y = shelf = 0
    for key, w, h in sorted(items, key=lambda it: (-it[2], -it[1], it[0])):
        if x + w > width:
            x, y, shelf = 0, y + shelf + GUTTER, 0
        placed[key] = (x, y)
        x += w + GUTTER
        shelf = max(shelf, h)
    return placed, y + shelf


def pack(meta, rendered, assets):
    items = []
    for info in meta['pieces']:
        w, h = info['size']
        n = len(info['frames'])
        # A strip keeps its frames side by side; wrap it onto rows of the atlas width.
        per_row = max(1, min(n, (ATLAS_WIDTH + GUTTER) // (w + GUTTER)))
        rows = -(-n // per_row)
        items.append((info['name'], per_row * (w + GUTTER) - GUTTER, rows * (h + GUTTER) - GUTTER))
    placed, height = shelf_pack(items, ATLAS_WIDTH)
    sheet = np.zeros((height, ATLAS_WIDTH, 4), dtype=np.uint8)
    atlas = {'image': 'ui_kit.png', 'size': [ATLAS_WIDTH, height], 'pieces': {}}
    for info in meta['pieces']:
        name = info['name']
        w, h = info['size']
        ox, oy = placed[name]
        per_row = max(1, min(len(info['frames']), (ATLAS_WIDTH + GUTTER) // (w + GUTTER)))
        rects = []
        for k, a in enumerate(rendered[name]):
            x = ox + (k % per_row) * (w + GUTTER)
            y = oy + (k // per_row) * (h + GUTTER)
            sheet[y:y + h, x:x + w] = a
            rects.append([x, y, w, h])
        entry = {'kind': info['kind'], 'rect': rects[0]}
        if info['slices']:
            entry['slices'] = info['slices']
        if info['pivot']:
            entry['pivot'] = info['pivot']
        if len(rects) > 1:
            entry['frames'] = rects
        if info.get('stepDeg'):
            entry['stepDeg'] = info['stepDeg']
        atlas['pieces'][name] = entry
    assets = Path(assets)
    assets.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, 'RGBA').save(assets / 'ui_kit.png', optimize=True)
    (assets / 'ui_kit.json').write_text(json.dumps(atlas, indent=1) + '\n', encoding='utf-8')
    return atlas, sheet


# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------

def nine_stretch(a, slices, w, h):
    """The nine-slice drawn at w x h, the way the client does it (edges stretched)."""
    t, r, b, l = slices
    sh, sw = a.shape[:2]
    xs = list(range(l)) + [l + (i * (sw - l - r)) // max(1, w - l - r) for i in range(w - l - r)] + \
        list(range(sw - r, sw))
    ys = list(range(t)) + [t + (i * (sh - t - b)) // max(1, h - t - b) for i in range(h - t - b)] + \
        list(range(sh - b, sh))
    return a[np.ix_(ys, xs)]


def write_preview(meta, rendered, out):
    bg = (38, 44, 58, 255)
    tiles = []
    for info in meta['pieces']:
        frames = rendered[info['name']]
        strip = np.concatenate([np.pad(f, ((0, 0), (0, 2), (0, 0))) for f in frames[:8]], axis=1)
        tiles.append(strip)
        if info['kind'] == 'nine':
            w, h = info['size']
            tiles.append(nine_stretch(frames[0], info['slices'], w * 3, max(h, 20) + 6))
        if info['kind'] == 'hbar':
            tiles.append(np.repeat(frames[0], 12, axis=1))
    gap = 6
    cols_w = 400
    x = y = gap
    row_h = 0
    pos = []
    for t in tiles:
        h, w = t.shape[:2]
        if x + w * 4 + gap > cols_w * 3:
            x, y, row_h = gap, y + row_h + gap, 0
        pos.append((x, y))
        x += w + gap + w * 3 + gap
        row_h = max(row_h, h * 3)
    img = Image.new('RGBA', (cols_w * 3, y + row_h + gap), bg)
    for t, (x, y) in zip(tiles, pos):
        im = Image.fromarray(t, 'RGBA')
        img.alpha_composite(im, (x, y))
        img.alpha_composite(im.resize((im.width * 3, im.height * 3), Image.NEAREST), (x + im.width + gap, y))
    img.save(out)
    print('wrote', out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--work', default=str(HERE / 'work' / 'ui'))
    ap.add_argument('--assets', default=str(HERE / '../../packages/client/public/ui/blender'))
    ap.add_argument('--preview', default=str(HERE / 'work' / 'ui_kit_preview.png'))
    args = ap.parse_args()
    work = Path(args.work)
    meta = json.loads((work / 'meta.json').read_text(encoding='utf-8'))
    rendered = {info['name']: process(work, info, meta['scale'], meta['glowFrom']) for info in meta['pieces']}
    atlas, sheet = pack(meta, rendered, args.assets)
    used = {tuple(c) for c in sheet[sheet[..., 3] == 255][:, :3]}
    print(f'{len(atlas["pieces"])} pieces, atlas {atlas["size"][0]}x{atlas["size"][1]}, {len(used)} colours')
    write_preview(meta, rendered, args.preview)


if __name__ == '__main__':
    main()
