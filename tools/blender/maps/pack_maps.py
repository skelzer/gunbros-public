# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy>=1.26", "scipy>=1.11"]
# ///
"""
Map renders to game-ready assets (DESIGN §8.1).

    uv run tools/blender/maps/pack_maps.py --work tools/blender/work/maps --maps hills [--keep 03_trees]

Per map, from work/maps/<id>/ (what build_maps.py rendered at 4x):

1. Every canvas is reduced the way a mobile frame is (postprocess.py): each source pixel
   snapped to the map's palette, then each output pixel takes the *most common* colour
   of its 4 x 4 block, so no in-between colours appear. The same majority vote picks
   the part group from the id pass, and a dark line is drawn where two groups meet.
   postprocess.py loops in Python per pixel, which is fine for a 64 px sprite and hours
   for a 1800 x 1000 map, so the same steps are written here with whole-array numpy.
2. Terrain only: solid specks smaller than `MIN_SPECK_PX` are removed (render debris
   floating in the air would be terrain a mobile could stand on), enclosed air pockets
   smaller than `MAX_HOLE_PX` are filled, then the 1 px outline goes on the air side of
   the silhouette. The final alpha *is* the mask: `packages/shared/src/data/maps/masks/
   <id>.ts` gets its run-length encoding, in the format of `encodeRle` in
   `packages/shared/src/terrain/codec.ts`, along with the sky colours and the plate
   placements the TypeScript map file uses.
3. Plates: the same reduction and outline (in the plate's own outline colour), then the
   empty rows over the scenery are cropped into the plate's `y` and a run of flat rows at
   the bottom into its `fillBelow`.
4. `thumb.png` (160 x 90): sky, plates and terrain of the whole map.
5. Budgets (DESIGN §8.1) are checked before anything is written into the repo: at most
   48 colours in the terrain and 32 in a plate, all PNGs of the map together under
   1.2 MB, alpha exactly 0 or 255. A map over budget fails loudly and writes nothing.

Previews go to work/maps/<id>/preview.png (the whole map, plates laid in the way the
thumbnail does it) and preview_views.png (what the game shows at three camera
positions on a desktop and one on a phone, composed with the client's own parallax
arithmetic). `--keep <label>` also copies both into iterations/maps/<id>/.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
PUBLIC = ROOT / 'packages' / 'client' / 'public' / 'maps'
MASKS = ROOT / 'packages' / 'shared' / 'src' / 'data' / 'maps' / 'masks'
ITERATIONS = HERE.parent / 'iterations' / 'maps'

MAX_TERRAIN_COLOURS = 48
MAX_PLATE_COLOURS = 32
MAX_MAP_BYTES = 1_200_000
# Solid islands smaller than this are render debris, not terrain.
MIN_SPECK_PX = 24
# Air pockets sealed inside the rock and smaller than this are filled in.
MAX_HOLE_PX = 24
THUMB = (160, 90)
# Mirrors the client (clientConstants.background.skyBands, view size): previews only.
SKY_BANDS = 14
VIEW_W, VIEW_H, PHONE_H = 800, 600, 370


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_hex(c):
    return '#%02x%02x%02x' % tuple(int(v) for v in c)


# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

class MapPalette:
    """Outline first, then the ramps and flats one canvas used, deduplicated."""

    def __init__(self, outline, ramps, flats):
        colours = [hex_rgb(outline)]
        for ramp in ramps.values():
            colours += [hex_rgb(c) for c in ramp]
        colours += [hex_rgb(c) for c in flats.values()]
        self.colours = list(dict.fromkeys(colours))
        self.array = np.array(self.colours, dtype=np.int32)
        self.outline_index = 0
        # Interior line colour per slot: the darkest shadow of any ramp the colour sits
        # in above the bottom step (postprocess.Palette does the same for mobiles).
        lum = lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]  # noqa: E731
        self.line_index = np.arange(len(self.colours))
        for i, colour in enumerate(self.colours):
            shadows = [hex_rgb(r[0]) for r in ramps.values()
                       if colour in [hex_rgb(c) for c in r[1:]] and hex_rgb(r[0]) != colour]
            if shadows:
                self.line_index[i] = self.colours.index(min(shadows, key=lum))

    def index_image(self, rgb):
        """(h, w, 3) uint8 -> palette indices, via the few distinct colours a toon render has."""
        packed = (rgb[..., 0].astype(np.int32) << 16) | (rgb[..., 1].astype(np.int32) << 8) | rgb[..., 2]
        uniq, inverse = np.unique(packed.ravel(), return_inverse=True)
        u_rgb = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], axis=1)
        diff = u_rgb[:, None, :] - self.array[None, :, :]
        dist = (diff * diff * np.array([3, 4, 2])).sum(axis=2)
        return dist.argmin(axis=1)[inverse].reshape(rgb.shape[:2]).astype(np.uint8)


# --------------------------------------------------------------------------
# Reduction, whole-array
# --------------------------------------------------------------------------

def blocks(a, s):
    h, w = a.shape[0] // s, a.shape[1] // s
    return a[:h * s, :w * s].reshape(h, s, w, s).transpose(0, 2, 1, 3).reshape(h, w, s * s)


def vote(values, valid, s):
    """Most common value per s x s block among `valid` source pixels (ties: lowest)."""
    vb = blocks(values, s)
    ob = blocks(valid, s)
    best = np.zeros(vb.shape[:2], dtype=np.int32)
    best_n = np.full(vb.shape[:2], -1, dtype=np.int32)
    for v in np.unique(values[valid]):
        n = ((vb == v) & ob).sum(axis=2)
        better = n > best_n
        best[better] = v
        best_n[better] = n[better]
    return best


def load_canvas(work, layer, scale, pal):
    img = np.array(Image.open(work / layer / 'img.png').convert('RGBA'))
    opaque = img[..., 3] >= 128
    idx = pal.index_image(img[..., :3])
    mask = blocks(opaque, scale).sum(axis=2) * 2 >= scale * scale
    idx = vote(idx, opaque, scale)
    idp = work / f'{layer}_id' / 'img.png'
    group = np.zeros_like(idx)
    if idp.exists():
        ida = np.array(Image.open(idp).convert('RGBA'))
        digits = np.digitize(ida[..., :3].astype(np.int32), [64, 192])
        g = (digits[..., 0] + 3 * digits[..., 1] + 9 * digits[..., 2]).astype(np.uint8)
        valid = (ida[..., 3] >= 128) & (g > 0)
        group = vote(g, valid, scale)
    group[~mask] = 0
    return idx, mask, group


def shifted(a, dy, dx, fill=0):
    """a moved by (dy, dx): out[y, x] = a[y - dy, x - dx], `fill` where that is outside."""
    out = np.full_like(a, fill)
    h, w = a.shape
    ys = slice(max(dy, 0), h + min(dy, 0))
    xs = slice(max(dx, 0), w + min(dx, 0))
    yd = slice(max(-dy, 0), h + min(-dy, 0))
    xd = slice(max(-dx, 0), w + min(-dx, 0))
    out[ys, xs] = a[yd, xd]
    return out


N4 = ((0, 1), (1, 0), (0, -1), (-1, 0))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def drop_specks(idx, mask, min_px):
    labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, labels, index=np.arange(1, n + 1))
    small = np.zeros(n + 1, dtype=bool)
    small[1:] = sizes < min_px
    return mask & ~small[labels]


def fill_holes(idx, mask, group, max_px):
    """Air pockets sealed in the rock and smaller than max_px take their nearest colour."""
    air, n = ndimage.label(~mask)
    if n == 0:
        return idx, mask, group
    border = set(np.unique(np.concatenate([air[0], air[-1], air[:, 0], air[:, -1]])))
    sizes = ndimage.sum(~mask, air, index=np.arange(1, n + 1))
    fill = np.zeros(n + 1, dtype=bool)
    for k in range(1, n + 1):
        fill[k] = sizes[k - 1] < max_px and k not in border
    holes = fill[air]
    if not holes.any():
        return idx, mask, group
    _, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
    idx = np.where(holes, idx[iy, ix], idx)
    group = np.where(holes, group[iy, ix], group)
    return idx, mask | holes, group


def part_lines(idx, mask, group, pal):
    """Dark line where two groups meet, on the lower-numbered one, in its own shadow."""
    line = np.zeros_like(mask)
    for dy, dx in N4:
        ng = shifted(group, dy, dx)
        nm = shifted(mask, dy, dx, False)
        line |= mask & (group > 0) & nm & (ng > group)
    out = idx.copy()
    out[line] = pal.line_index[idx[line]]
    return out


def outline(idx, mask, colour_index):
    """1 px outline on the air pixels that touch the silhouette (4-neighbours)."""
    grown = np.zeros_like(mask)
    for dy, dx in N4:
        grown |= shifted(mask, dy, dx, False)
    ring = grown & ~mask
    idx = idx.copy()
    idx[ring] = colour_index
    return idx, mask | ring


def remove_orphans(idx, mask, keep_index):
    """A pixel that matches none of its 8 neighbours takes their commonest colour."""
    same = np.zeros_like(mask)
    stack = []
    for dy, dx in N8:
        n = shifted(idx, dy, dx)
        nm = shifted(mask, dy, dx, False)
        same |= nm & (n == idx)
        stack.append(np.where(nm, n, 255))
    orphans = mask & ~same & (idx != keep_index)
    out = idx.copy()
    stack = np.stack(stack)
    for y, x in zip(*np.nonzero(orphans)):
        around = stack[:, y, x]
        around = around[(around != 255) & (around != keep_index)]
        if around.size:
            out[y, x] = np.bincount(around).argmax()
    return out


def to_rgba(idx, mask, pal):
    out = np.zeros(idx.shape + (4,), dtype=np.uint8)
    out[..., :3] = pal.array[idx].astype(np.uint8)
    out[..., 3] = np.where(mask, 255, 0)
    out[~mask] = 0
    return out


def canvas_palette(meta, info, outline_hex):
    ramps = {n: meta['ramps'][n] for n in info['materials'] if n in meta['ramps']}
    flats = {n: meta['flats'][n] for n in info['materials'] if n in meta['flats']}
    return MapPalette(outline_hex, ramps, flats)


def process_terrain(work, meta):
    info = meta['canvases']['terrain']
    pal = canvas_palette(meta, info, meta['outline'])
    idx, mask, group = load_canvas(work, 'terrain', meta['scale'], pal)
    mask = drop_specks(idx, mask, MIN_SPECK_PX)
    idx, mask, group = fill_holes(idx, mask, group, MAX_HOLE_PX)
    group[~mask] = 0
    idx = part_lines(idx, mask, group, pal)
    idx, mask = outline(idx, mask, pal.outline_index)
    idx = remove_orphans(idx, mask, pal.outline_index)
    return idx, mask, pal


def process_plate(work, meta, layer):
    info = meta['canvases'][layer]
    pal = canvas_palette(meta, info, info.get('outline') or meta['outline'])
    idx, mask, group = load_canvas(work, layer, meta['scale'], pal)
    mask = drop_specks(idx, mask, 6)
    idx = part_lines(idx, mask, group, pal)
    idx, mask = outline(idx, mask, pal.outline_index)
    idx = remove_orphans(idx, mask, pal.outline_index)
    return idx, mask, pal


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def save_indexed(path, idx, mask, pal):
    """
    An indexed PNG: slot 0 transparent (a one-entry tRNS), then the colours used. Far
    smaller than RGBA for pixel art, and every browser and the client test decode it to
    alpha exactly 0 or 255.
    """
    used = np.unique(idx[mask])
    lut = np.zeros(max(len(pal.colours), 1), dtype=np.uint8)
    lut[used] = np.arange(1, len(used) + 1)
    arr = np.where(mask, lut[idx], 0).astype(np.uint8)
    img = Image.fromarray(arr, 'P')
    flat = [0, 0, 0]
    for u in used:
        flat += list(pal.colours[u])
    img.putpalette(flat)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True, transparency=0)
    return len(used)


def encode_rle(mask):
    """Same format as encodeRle in packages/shared/src/terrain/codec.ts."""
    flat = mask.ravel().astype(np.int8)
    change = np.nonzero(np.diff(flat))[0] + 1
    bounds = np.concatenate([[0], change, [flat.size]])
    runs = np.diff(bounds).tolist()
    if flat[0] == 1:
        runs = [0] + runs      # runs always start with air
    h, w = mask.shape
    b36 = np.base_repr
    return f'r1:{b36(w, 36).lower()}:{b36(h, 36).lower()}:' + '.'.join(b36(r, 36).lower() for r in runs)


def crop_plate(idx, mask, pal):
    """Empty rows over the scenery become `y`; flat rows at the bottom become `fillBelow`."""
    rows = np.nonzero(mask.any(axis=1))[0]
    top = int(rows[0]) if rows.size else 0
    bottom = mask.shape[0]
    fill_below = None
    last = idx[bottom - 1]
    if mask[bottom - 1].all() and (last == last[0]).all():
        colour = last[0]
        b = bottom
        while b - 1 > top and mask[b - 1].all() and (idx[b - 1] == colour).all():
            b -= 1
        # Keep one flat row so the image's own edge and the fill meet on a pixel.
        bottom = min(bottom, b + 1)
        fill_below = rgb_hex(pal.colours[colour])
    return top, bottom, fill_below


def ts_string(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def write_ts(map_id, rle, sky, plates):
    camel = ''.join(p[:1].upper() + p[1:] for p in map_id.replace('-', '_').split('_'))
    lower = camel[:1].lower() + camel[1:]
    plate_type = '{ ' + ' '.join(f'{p["name"]}: PlateLayer;' for p in plates) + ' }'
    lines = [
        '/**',
        f' * GENERATED by `pnpm maps` (tools/blender/maps/pack_maps.py) from the rendered art of',
        f' * `{map_id}`. Do not edit: change tools/blender/maps/{map_id}.py and run `pnpm maps {map_id}`.',
        ' *',
        ' * `' + lower + 'Mask` is the terrain mask, run-length encoded exactly like `encodeRle` in',
        ' * `terrain/codec.ts`, taken from the alpha of `public/maps/' + map_id + '/terrain.png`.',
        ' * `' + lower + 'Sky` is the sky gradient the thumbnail was composed on, and `' + lower + 'Plates`',
        ' * places every Blender-rendered backdrop (DESIGN §8.1).',
        ' */',
        "import type { PlateLayer } from '../types.js';",
        '',
        f'export const {lower}Sky: string[] = [{", ".join(ts_string(c) for c in sky)}];',
        '',
        f'export const {lower}Plates: {plate_type} = {{',
    ]
    for p in plates:
        fields = [f"kind: 'plate'", f'src: {ts_string(p["src"])}', f'parallax: {p["parallax"]}',
                  f'width: {p["width"]}', f'height: {p["height"]}', f'x: {p["x"]}', f'y: {p["y"]}']
        if p.get('fillAbove'):
            fields.append(f'fillAbove: {ts_string(p["fillAbove"])}')
        if p.get('fillBelow'):
            fields.append(f'fillBelow: {ts_string(p["fillBelow"])}')
        if p.get('drift'):
            fields.append(f'drift: {p["drift"]}')
        lines.append(f'  {p["name"]}: {{ ' + ', '.join(fields) + ' },')
    lines += ['};', '', f'export const {lower}Mask =', f'  {ts_string(rle)};', '']
    MASKS.mkdir(parents=True, exist_ok=True)
    (MASKS / f'{map_id}.ts').write_text('\n'.join(lines), encoding='utf-8')


# --------------------------------------------------------------------------
# Looking at it
# --------------------------------------------------------------------------

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky_bands(colours, count):
    cs = [hex_rgb(c) for c in colours]
    out = []
    for i in range(count):
        t = i / (count - 1) * (len(cs) - 1)
        k = min(len(cs) - 2, int(t))
        out.append(lerp(cs[k], cs[k + 1], t - k))
    return out


def sky_image(colours, w, h):
    bands = sky_bands(colours, max(SKY_BANDS, len(colours)))
    img = np.zeros((h, w, 4), dtype=np.uint8)
    bh = -(-h // len(bands))
    for i, c in enumerate(bands):
        img[i * bh:(i + 1) * bh, :, :3] = c
    img[..., 3] = 255
    return Image.fromarray(img, 'RGBA')


def view(meta, terrain, plates, ox, oy, vh):
    """What the client draws for a camera at (ox, oy): background.ts and terrain.ts arithmetic."""
    out = sky_image(meta['sky'], VIEW_W, vh)
    for p in plates:
        x = p['x'] - round(ox * p['parallax'])
        y = p['y'] - round(oy * p['parallax'])
        if p.get('fillBelow') and y + p['height'] < vh:
            out.paste(hex_rgb(p['fillBelow']) + (255,), (0, max(0, y + p['height']), VIEW_W, vh))
        layer = Image.new('RGBA', (VIEW_W, vh), (0, 0, 0, 0))
        layer.paste(p['image'], (x, y))
        out.alpha_composite(layer)
    out.alpha_composite(terrain.crop((ox, oy, ox + VIEW_W, oy + vh)))
    return out


def overview(meta, terrain, plates):
    """The whole map with every plate scaled to its width: the thumbnail's composition."""
    w, h = meta['size']
    out = sky_image(meta['sky'], w, h)
    for p in plates:
        s = w / p['image'].width
        img = p['image'].resize((w, round(p['image'].height * s)), Image.NEAREST)
        # Line the plate up on the map's horizon row, the row the layout helper maps.
        horizon = h * 0.6
        v0 = horizon * p['parallax'] + (VIEW_H / 2) * (1 - p['parallax']) - p['y']
        top = round(horizon - v0 * s)
        if p.get('fillBelow') and top + img.height < h:
            out.paste(hex_rgb(p['fillBelow']) + (255,), (0, top + img.height, w, h))
        layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        layer.paste(img, (0, top))
        out.alpha_composite(layer)
    out.alpha_composite(terrain)
    return out


def ground_top(mask, x):
    """Top of the lowest solid run in column x, the ground a mobile stands on (generate.ts)."""
    col = mask[:, x]
    ys = np.nonzero(col)[0]
    if ys.size == 0:
        return mask.shape[0]
    y = ys[-1]
    while y > 0 and col[y - 1]:
        y -= 1
    return int(y)


def follow(mask, x, vh):
    """Camera offsets the game uses when it follows a mobile standing at column x."""
    h, w = mask.shape
    ox = min(max(0, x - VIEW_W // 2), w - VIEW_W)
    oy = min(max(0, ground_top(mask, x) - 22 - vh // 2), h - vh)
    return ox, oy


def write_previews(work, meta, terrain, plates, keep):
    w, h = meta['size']
    full = overview(meta, terrain, plates)
    full.save(work / 'preview.png')
    mask = np.array(terrain)[..., 3] > 0
    xs = (int(w * 0.3), w // 2, int(w * 0.7))
    shots = [view(meta, terrain, plates, *follow(mask, x, VIEW_H), VIEW_H) for x in xs]
    shots.append(view(meta, terrain, plates, *follow(mask, int(w * 0.8), PHONE_H), PHONE_H))
    sheet = Image.new('RGBA', (VIEW_W * 2 + 8, VIEW_H * 2 + 8), (20, 20, 28, 255))
    for i, s in enumerate(shots):
        sheet.paste(s, ((i % 2) * (VIEW_W + 8), (i // 2) * (VIEW_H + 8)))
    sheet.save(work / 'preview_views.png')
    if keep:
        dest = ITERATIONS / meta['map']
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy(work / 'preview.png', dest / f'{keep}.png')
        shutil.copy(work / 'preview_views.png', dest / f'{keep}_views.png')
        print('kept', dest / f'{keep}.png')
    return full


# --------------------------------------------------------------------------
# One map
# --------------------------------------------------------------------------

def pack(work, keep=None, dry=False):
    meta = json.loads((work / 'meta.json').read_text(encoding='utf-8'))
    map_id = meta['map']
    w, h = meta['size']
    problems = []

    idx, mask, pal = process_terrain(work, meta)
    if mask.shape != (h, w):
        problems.append(f'terrain render is {mask.shape[::-1]}, the map is {w} x {h}')
    t_colours = len(np.unique(idx[mask]))
    if t_colours > MAX_TERRAIN_COLOURS:
        problems.append(f'terrain uses {t_colours} colours, the budget is {MAX_TERRAIN_COLOURS}')
    terrain_rgba = to_rgba(idx, mask, pal)
    terrain_img = Image.fromarray(terrain_rgba, 'RGBA')

    out_dir = work / 'out'
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    save_indexed(out_dir / 'terrain.png', idx, mask, pal)

    plates = []
    for name in meta['plates']:
        layer = f'plate_{name}'
        if layer not in meta['canvases']:
            problems.append(f'plate {name} has not been rendered')
            continue
        info = meta['canvases'][layer]
        p_idx, p_mask, p_pal = process_plate(work, meta, layer)
        n = len(np.unique(p_idx[p_mask]))
        if n > MAX_PLATE_COLOURS:
            problems.append(f'plate {name} uses {n} colours, the budget is {MAX_PLATE_COLOURS}')
        top, bottom, fill_below = crop_plate(p_idx, p_mask, p_pal)
        p_idx, p_mask = p_idx[top:bottom], p_mask[top:bottom]
        src = f'{name}.png'
        save_indexed(out_dir / src, p_idx, p_mask, p_pal)
        plates.append({
            'name': name, 'src': src, 'parallax': info['parallax'],
            'width': int(p_mask.shape[1]), 'height': int(p_mask.shape[0]), 'x': 0, 'y': int(top),
            'fillAbove': info.get('fillAbove'), 'fillBelow': fill_below, 'drift': info.get('drift') or 0,
            'image': Image.fromarray(to_rgba(p_idx, p_mask, p_pal), 'RGBA'), 'colours': n,
        })

    full = write_previews(work, meta, terrain_img, plates, keep)
    thumb = full.convert('RGB').resize((THUMB[0], round(h * THUMB[0] / w)), Image.BOX)
    canvas = Image.new('RGB', THUMB, hex_rgb(meta['sky'][0]))
    canvas.paste(thumb, (0, THUMB[1] - thumb.height))
    canvas.save(out_dir / 'thumb.png', optimize=True)

    # Alpha is exactly the mask, by construction; check it the way the client test will.
    back = np.array(Image.open(out_dir / 'terrain.png').convert('RGBA'))
    if not set(np.unique(back[..., 3])) <= {0, 255}:
        problems.append('terrain.png has semi-transparent pixels')
    if not np.array_equal(back[..., 3] == 255, mask):
        problems.append('terrain.png alpha does not match the mask')
    sizes = {f.name: f.stat().st_size for f in sorted(out_dir.iterdir())}
    total = sum(sizes.values())
    if total > MAX_MAP_BYTES:
        problems.append(f'PNGs total {total} bytes, the budget is {MAX_MAP_BYTES}')

    print(f'{map_id}: terrain {w} x {h}, {t_colours} colours, {int(mask.sum())} solid px')
    for p in plates:
        print(f'  plate {p["name"]}: {p["width"]} x {p["height"]} at y {p["y"]}, parallax {p["parallax"]}, '
              f'{p["colours"]} colours, fillBelow {p["fillBelow"]}')
    for name, size in sizes.items():
        print(f'  {name:14s} {size / 1024:7.1f} KB')
    print(f'  total          {total / 1024:7.1f} KB of {MAX_MAP_BYTES / 1024:.0f}')
    if problems:
        raise SystemExit(f'{map_id} is over budget or broken, nothing written:\n  ' + '\n  '.join(problems))
    if dry:
        return

    public = PUBLIC / map_id
    shutil.rmtree(public, ignore_errors=True)
    public.mkdir(parents=True)
    for f in out_dir.iterdir():
        shutil.copy(f, public / f.name)
    write_ts(map_id, encode_rle(mask), meta['sky'], plates)
    print(f'  wrote {public} and {MASKS / (map_id + ".ts")}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--work', default=str(HERE.parent / 'work' / 'maps'))
    ap.add_argument('--maps', required=True, help='comma separated map ids')
    ap.add_argument('--keep', default='', help='also copy the previews into iterations/maps/<id>/<keep>.png')
    ap.add_argument('--dry', action='store_true', help='check and preview only, write nothing into the repo')
    args = ap.parse_args()
    for map_id in [m for m in args.maps.split(',') if m]:
        work = Path(args.work) / map_id
        if not (work / 'meta.json').exists():
            sys.exit(f'{work} has no render; run make_maps.py {map_id}')
        pack(work, args.keep or None, args.dry)


if __name__ == '__main__':
    main()
