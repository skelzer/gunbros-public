# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy>=1.26", "scipy>=1.11"]
# ///
"""
The effect renders to one game-ready atlas.

    python3 pack_effects.py --work work/effects \
        --assets ../../packages/client/public/sprites/blender --preview work/effects_preview.png

Every frame is reduced the way a mobile frame is (majority vote to the effect's own
palette, part lines from the id pass, specks dropped, a 1 px outline round the lit parts
in the effect's own outline colour, orphans removed), with the whole-array numpy steps of
`maps/pack_maps.py`: an effect frame is up to 128 px square and there are hundreds.

Each frame is then trimmed to what it draws and shelf-packed on its own, so a fireball's
first small frames and its big late ones do not each pay for the largest. `effects.json`
maps every key to its canvas `size`, `anchor` (the canvas pixel drawn on the event's
position), `ticks` per frame, `loop`, and per frame `[x, y, w, h, ox, oy]`: the rect in
the atlas and where its top left sits in the canvas. An empty frame is `[0, 0, 0, 0, 0, 0]`.

The atlas is an indexed PNG (slot 0 transparent), which the whole game's effects share.
"""
import argparse
import fnmatch
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'maps'))
from pack_maps import (N4, MapPalette, blocks, drop_specks,  # noqa: E402
                       remove_orphans, shifted, vote)
from pack_ui_kit import shelf_pack  # noqa: E402

ATLAS_WIDTH = 1024
MAX_COLOURS = 255
MAX_BYTES = 1_500_000
SKY = (104, 164, 214, 255)
DUSK = (40, 36, 60, 255)


def effect_palette(info):
    ramps = {n: v for n, (kind, v) in info['palette'].items() if kind == 'ramp'}
    flats = {n: v for n, (kind, v) in info['palette'].items() if kind == 'flat'}
    return MapPalette(info['outline'], ramps, flats)


def reduce(img_path, id_path, scale, pal, glow_from):
    img = np.array(Image.open(img_path).convert('RGBA'))
    opaque = img[..., 3] >= 128
    idx = pal.index_image(img[..., :3])
    mask = blocks(opaque, scale).sum(axis=2) * 2 >= scale * scale
    idx = vote(idx, opaque, scale).astype(np.uint8)
    group = np.zeros(idx.shape, dtype=np.int32)
    if id_path.exists():
        ida = np.array(Image.open(id_path).convert('RGBA'))
        digits = np.digitize(ida[..., :3].astype(np.int32), [64, 192])
        g = (digits[..., 0] + 3 * digits[..., 1] + 9 * digits[..., 2]).astype(np.int32)
        valid = (ida[..., 3] >= 128) & (g > 0)
        group = vote(g, valid, scale)
    mask = drop_specks(idx, mask, 3)
    group[~mask] = 0
    glow = mask & (group >= glow_from)
    # Part lines: where two lit groups meet, on the lower one, in its own shadow.
    line = np.zeros_like(mask)
    lit = mask & ~glow & (group > 0)
    for dy, dx in N4:
        ng = shifted(group, dy, dx)
        nl = shifted(lit, dy, dx, False)
        line |= lit & nl & (ng > group)
    idx = idx.copy()
    idx[line] = pal.line_index[idx[line]]
    # Outline round the lit parts only: glowing fire and light have no edge line.
    solid = mask & ~glow
    grown = np.zeros_like(mask)
    for dy, dx in N4:
        grown |= shifted(solid, dy, dx, False)
    ring = grown & ~mask
    idx[ring] = pal.outline_index
    mask = mask | ring
    idx = remove_orphans(idx, mask, pal.outline_index)
    return idx, mask


def process(work, info, scale, glow_from):
    pal = effect_palette(info)
    w, h = info['size']
    out = []
    for name in info['frames']:
        p = work / 'img' / f'{name}.png'
        if not p.exists():
            out.append((np.zeros((h, w, 4), dtype=np.uint8)))
            continue
        idx, mask = reduce(p, work / 'img_id' / f'{name}.png', scale, pal, glow_from)
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., :3] = pal.array[idx].astype(np.uint8)
        rgba[..., 3] = np.where(mask, 255, 0)
        rgba[~mask] = 0
        edge = np.concatenate([mask[:, 0], mask[:, -1]] + ([] if info.get('tile') else [mask[0], mask[-1]]))
        if edge.any():
            print(f'warning: {info["key"]} frame {name} touches the canvas edge (clipped)')
        out.append(rgba)
    return out


def trim(a):
    ys, xs = np.nonzero(a[..., 3])
    if ys.size == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def pack(effects, rendered, assets):
    items, crops = [], {}
    for info in effects:
        for k, a in enumerate(rendered[info['key']]):
            box = trim(a)
            if box is None:
                continue
            x0, y0, x1, y1 = box
            crops[(info['key'], k)] = box
            items.append(((info['key'], k), int(x1 - x0), int(y1 - y0)))
    placed, height = shelf_pack(items, ATLAS_WIDTH)
    sheet = np.zeros((height, ATLAS_WIDTH, 4), dtype=np.uint8)
    atlas = {'image': 'effects.png', 'size': [ATLAS_WIDTH, int(height)], 'tickRate': 60, 'effects': {}}
    for info in effects:
        key = info['key']
        rects = []
        for k, a in enumerate(rendered[key]):
            if (key, k) not in crops:
                rects.append([0, 0, 0, 0, 0, 0])
                continue
            x0, y0, x1, y1 = crops[(key, k)]
            x, y = placed[(key, k)]
            sheet[y:y + y1 - y0, x:x + x1 - x0] = a[y0:y1, x0:x1]
            rects.append([int(x), int(y), int(x1 - x0), int(y1 - y0), int(x0), int(y0)])
        atlas['effects'][key] = {
            'size': info['size'], 'anchor': info['anchor'], 'ticks': info['ticks'],
            'loop': info['loop'], 'tile': bool(info.get('tile')), 'frames': rects,
        }
    atlas['effects'] = dict(sorted(atlas['effects'].items()))
    return atlas, sheet


def save_indexed(path, sheet):
    """Indexed PNG, slot 0 transparent: the colours of every effect together."""
    mask = sheet[..., 3] > 0
    rgb = sheet[..., :3].astype(np.int32)
    packed = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    colours, inverse = np.unique(packed[mask], return_inverse=True)
    if len(colours) > MAX_COLOURS:
        raise SystemExit(f'{len(colours)} colours in the effects atlas, the cap is {MAX_COLOURS}')
    arr = np.zeros(mask.shape, dtype=np.uint8)
    arr[mask] = (inverse + 1).astype(np.uint8)
    img = Image.fromarray(arr, 'P')
    flat = [0, 0, 0]
    for c in colours:
        flat += [(int(c) >> 16) & 255, (int(c) >> 8) & 255, int(c) & 255]
    img.putpalette(flat)
    img.save(path, optimize=True, transparency=0)
    return len(colours)


def write_preview(effects, rendered, out, zoom=2, dusk=True):
    """
    One row per effect: every frame on its full canvas at `zoom`x, on sky and (with
    `dusk`) again on a dark sky, each frame trimmed to the effect's widest frame.
    """
    rows = []
    for info in effects:
        frames = rendered[info['key']]
        w, h = info['size']
        # Crop every frame of the row to the box all of them fit in.
        alpha = np.any([f[..., 3] > 0 for f in frames], axis=0)
        ys, xs = np.nonzero(alpha) if alpha.any() else (np.array([0, h - 1]), np.array([0, w - 1]))
        y0, y1 = max(0, ys.min() - 2), min(h, ys.max() + 3)
        x0, x1 = max(0, xs.min() - 2), min(w, xs.max() + 3)
        info = dict(info, anchor=[info['anchor'][0] - x0, info['anchor'][1] - y0], size=[x1 - x0, y1 - y0])
        strip = []
        for a in frames:
            a = a[y0:y1, x0:x1]
            big = np.kron(a, np.ones((zoom, zoom, 1), dtype=np.uint8))
            strip.append(np.pad(big, ((0, 0), (0, 4), (0, 0))))
        rows.append((info, np.concatenate(strip, axis=1)))
    gap = 6
    label = 150
    width = max(r.shape[1] for _, r in rows) + label + 2 * gap
    bgs = (SKY, DUSK) if dusk else (SKY,)
    height = sum(r.shape[0] * len(bgs) + (len(bgs) + 1) * gap for _, r in rows) + gap
    img = Image.new('RGBA', (width, height), (70, 74, 86, 255))
    draw = ImageDraw.Draw(img)
    y = gap
    for info, strip in rows:
        ticks = sum(info['ticks'])
        draw.text((gap, y), f'{info["key"]}\n{len(info["frames"])}f {ticks}t', fill=(240, 240, 240, 255))
        for bg in bgs:
            base = Image.new('RGBA', (strip.shape[1], strip.shape[0]), bg)
            base.alpha_composite(Image.fromarray(strip, 'RGBA'))
            # Mark the anchor on every frame.
            d = ImageDraw.Draw(base)
            ax, ay = info['anchor']
            fw = info['size'][0] * zoom + 4
            for k in range(len(info['frames'])):
                cx, cy = k * fw + ax * zoom, ay * zoom
                d.line([(cx - 3, cy), (cx + 3, cy)], fill=(255, 0, 255, 255))
            img.alpha_composite(base, (label, y))
            y += strip.shape[0] + gap
        y += gap
    img.save(out)
    print('wrote', out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--work', default=str(HERE / 'work' / 'effects'))
    ap.add_argument('--assets', default=str(HERE / '../../packages/client/public/sprites/blender'))
    ap.add_argument('--preview', default=str(HERE / 'work' / 'effects_preview.png'))
    ap.add_argument('--preview-only', default='', help='comma separated keys or key prefixes* to preview')
    ap.add_argument('--dry', action='store_true', help='reduce and preview, write no assets')
    args = ap.parse_args()
    effects, rendered = [], {}
    for meta_path in sorted(Path(args.work).glob('*/meta.json')):
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        for info in meta['effects']:
            info['module'] = meta['module']
            rendered[info['key']] = process(meta_path.parent, info, meta['scale'], meta['glowFrom'])
            effects.append(info)
    if not effects:
        raise SystemExit(f'nothing rendered in {args.work}')
    atlas, sheet = pack(effects, rendered, args.assets)
    only = [s for s in args.preview_only.split(',') if s]

    def wanted(key):
        return not only or any(fnmatch.fnmatchcase(key, o) for o in only)

    shown = [e for e in effects if wanted(e['key'])]
    write_preview(shown, rendered, args.preview, zoom=3 if len(shown) <= 4 else 2, dusk=len(shown) <= 8)
    if args.dry:
        print(f'{len(atlas["effects"])} effects, atlas {atlas["size"][0]}x{atlas["size"][1]} (dry, nothing written)')
        return
    assets = Path(args.assets)
    assets.mkdir(parents=True, exist_ok=True)
    png = assets / 'effects.png'
    n = save_indexed(png, sheet)
    (assets / 'effects.json').write_text(json.dumps(atlas, indent=1) + '\n', encoding='utf-8')
    size = png.stat().st_size
    print(f'{len(atlas["effects"])} effects, atlas {atlas["size"][0]}x{atlas["size"][1]}, {n} colours, {size} bytes')
    if size > MAX_BYTES:
        raise SystemExit(f'effects.png is {size} bytes, the budget is {MAX_BYTES}')


if __name__ == '__main__':
    main()
