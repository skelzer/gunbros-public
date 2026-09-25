# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""
Raw Blender renders to game-ready pixel art.

    uv run postprocess.py sprites  --work work/tank --assets ../../packages/client/public/sprites/blender
    uv run postprocess.py preview  --work work/tank --out iterations/01_first_pass.png
    uv run postprocess.py compare  --assets <dir> --out comparison.png

Steps, in order, per frame and per layer:
  1. downscale to sprite size          4. 1 px dark outline from the alpha silhouette
  2. threshold alpha to on or off      5. remove orphan pixels
  3. quantise to the mobile's palette  6. pack sheets, write the atlas

Steps 1 to 3 run together: every source pixel is snapped to the palette first and each
sprite pixel then takes the *most common* colour of its block, so the downscale cannot
invent in-between colours the way an averaging filter does.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
LAYERS = ('body', 'barrel')
# `charge` is optional: a looping wind-up the client shows while the player holds the
# fire key. Mobiles without it simply stay in idle.
STATE_ORDER = ('idle', 'move', 'charge', 'fire', 'hurt', 'death')


# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Palette:
    def __init__(self, names=None, path=HERE / 'palette.json'):
        """`names`: the ramps and flats one mobile declared. None means everything."""
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        if names is not None:
            data['ramps'] = {k: v for k, v in data['ramps'].items() if k in names}
            data['flats'] = {k: v for k, v in data['flats'].items() if k in names}
        self.outline = hex_rgb(data['outline'])
        colours = [self.outline]
        for ramp in data['ramps'].values():
            colours += [hex_rgb(c) for c in ramp]
        colours += [hex_rgb(c) for c in data['flats'].values()]
        self.colours = list(dict.fromkeys(colours))
        cap = data.get('maxColoursPerMobile', 24)
        if names is not None and len(self.colours) > cap:
            raise SystemExit(f'{len(self.colours)} colours declared, the cap per mobile is {cap}')
        self.array = np.array(self.colours, dtype=np.int32)
        self.outline_index = 0
        # Interior line colour per palette slot: the darkest shadow of any ramp the
        # colour sits in above the bottom step. Colours already at the bottom stay put.
        lum = lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
        self.line_index = list(range(len(self.colours)))
        for i, colour in enumerate(self.colours):
            shadows = [hex_rgb(r[0]) for r in data['ramps'].values()
                       if colour in [hex_rgb(c) for c in r[1:]] and hex_rgb(r[0]) != colour]
            if shadows:
                self.line_index[i] = self.colours.index(min(shadows, key=lum))

    def nearest(self, rgb):
        """(..., 3) uint8 -> palette indices."""
        flat = rgb.reshape(-1, 1, 3).astype(np.int32)
        # Weighted distance: the eye forgives blue errors first.
        diff = flat - self.array[None, :, :]
        dist = (diff * diff * np.array([3, 4, 2])).sum(axis=2)
        return dist.argmin(axis=1).reshape(rgb.shape[:-1])

    def to_rgba(self, index, mask):
        out = np.zeros(index.shape + (4,), dtype=np.uint8)
        out[..., :3] = self.array[index].astype(np.uint8)
        out[..., 3] = np.where(mask, 255, 0)
        out[~mask] = 0
        return out


# --------------------------------------------------------------------------
# Steps 1 to 3
# --------------------------------------------------------------------------

def downscale_mode(rgba, scale, pal):
    """Majority vote per block. Returns (palette index, opaque mask) at sprite size."""
    h, w = rgba.shape[0] // scale, rgba.shape[1] // scale
    idx = pal.nearest(rgba[..., :3])
    opaque = rgba[..., 3] >= 128
    if scale == 1:
        return idx, opaque
    idx_b = idx.reshape(h, scale, w, scale).transpose(0, 2, 1, 3).reshape(h, w, -1)
    op_b = opaque.reshape(h, scale, w, scale).transpose(0, 2, 1, 3).reshape(h, w, -1)
    mask = op_b.sum(axis=2) * 2 >= scale * scale
    out = np.zeros((h, w), dtype=np.int64)
    for y, x in zip(*np.nonzero(mask)):
        votes = idx_b[y, x][op_b[y, x]]
        counts = np.bincount(votes)
        out[y, x] = counts.argmax()
    return out, mask


def downscale_box(rgba, scale, pal):
    """Averaging filter, kept for comparison: it muddies edges into wrong palette slots."""
    img = Image.fromarray(rgba, 'RGBA')
    premult = np.array(img).astype(np.float32)
    premult[..., :3] *= premult[..., 3:4] / 255.0
    h, w = rgba.shape[0] // scale, rgba.shape[1] // scale
    small = premult.reshape(h, scale, w, scale, 4).mean(axis=(1, 3))
    alpha = small[..., 3]
    rgb = np.where(alpha[..., None] > 0, small[..., :3] * 255.0 / np.maximum(alpha[..., None], 1e-6), 0)
    mask = alpha >= 128
    return pal.nearest(np.clip(rgb, 0, 255).astype(np.uint8)), mask


def downscale_ids(id_rgba, scale):
    """Part group per sprite pixel from the id pass (0 where empty), by majority vote."""
    digits = np.digitize(id_rgba[..., :3].astype(np.int32), [64, 192])
    group = digits[..., 0] + 3 * digits[..., 1] + 9 * digits[..., 2]
    group[id_rgba[..., 3] < 128] = 0
    if scale == 1:
        return group
    h, w = group.shape[0] // scale, group.shape[1] // scale
    blocks = group.reshape(h, scale, w, scale).transpose(0, 2, 1, 3).reshape(h, w, -1)
    out = np.zeros((h, w), dtype=np.int64)
    for y in range(h):
        for x in range(w):
            votes = blocks[y, x][blocks[y, x] > 0]
            if votes.size:
                out[y, x] = np.bincount(votes).argmax()
    return out


def add_part_lines(idx, mask, group, pal, glow):
    """
    Dark line where two parts meet, drawn on the part with the lower group number and
    in that pixel's own shadow colour, so interior lines are softer than the outline.
    """
    out = idx.copy()
    h, w = idx.shape
    for y, x in zip(*np.nonzero(mask)):
        g = group[y, x]
        if g == 0 or glow[y, x]:
            continue
        for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and group[ny, nx] > g and not glow[ny, nx]:
                out[y, x] = pal.line_index[idx[y, x]]
                break
    return out


def drop_specks(mask, min_size=3):
    """Opaque islands smaller than `min_size` pixels are render debris."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = mask.copy()
    for sy, sx in zip(*np.nonzero(mask)):
        if seen[sy, sx]:
            continue
        stack, comp = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(comp) < min_size:
            for y, x in comp:
                out[y, x] = False
    return out


# --------------------------------------------------------------------------
# Steps 4 and 5
# --------------------------------------------------------------------------

def add_outline(idx, mask, pal, glow):
    """Outline on the transparent pixels that touch the silhouette (4-neighbours)."""
    solid = mask & ~glow   # flashes and fireballs glow, no outline
    grown = np.zeros_like(solid)
    grown[1:, :] |= solid[:-1, :]
    grown[:-1, :] |= solid[1:, :]
    grown[:, 1:] |= solid[:, :-1]
    grown[:, :-1] |= solid[:, 1:]
    ring = grown & ~mask
    idx = idx.copy()
    idx[ring] = pal.outline_index
    return idx, mask | ring


def remove_orphans(idx, mask, pal):
    """A pixel that matches none of its 8 neighbours becomes its commonest neighbour."""
    h, w = idx.shape
    out = idx.copy()
    for y, x in zip(*np.nonzero(mask)):
        if idx[y, x] == pal.outline_index:
            continue
        around = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if (dy or dx) and 0 <= ny < h and 0 <= nx < w and mask[ny, nx]:
                    around.append(int(idx[ny, nx]))
        if not around or idx[y, x] in around:
            continue
        inner = [c for c in around if c != pal.outline_index] or around
        out[y, x] = Counter(inner).most_common(1)[0][0]
    return out


def process_frame(path, scale, pal, method='mode', lines=True, glow_groups=()):
    rgba = np.array(Image.open(path).convert('RGBA'))
    idx, mask = (downscale_box if method == 'box' else downscale_mode)(rgba, scale, pal)
    mask = drop_specks(mask)
    id_path = path.parent.with_name(path.parent.name + '_id') / path.name
    glow = np.zeros_like(mask)
    if id_path.exists():
        group = downscale_ids(np.array(Image.open(id_path).convert('RGBA')), scale)
        glow = np.isin(group, list(glow_groups))
        if lines:
            idx = add_part_lines(idx, mask, group, pal, glow)
    idx, mask = add_outline(idx, mask, pal, glow)
    idx = remove_orphans(idx, mask, pal)
    return pal.to_rgba(idx, mask)


# --------------------------------------------------------------------------
# Whole mobile
# --------------------------------------------------------------------------

def load_frames(work, method='mode', lines=True):
    work = Path(work)
    meta = json.loads((work / 'meta.json').read_text(encoding='utf-8'))
    pal = Palette(meta.get('materials'))
    frames = {}
    for state in STATE_ORDER:
        if state not in meta['states']:
            continue
        frames[state] = []
        for i, info in enumerate(meta['states'][state]['frames']):
            entry = {'pivot': info['pivot'], 'barrelVisible': info['barrelVisible']}
            for layer in LAYERS:
                entry[layer] = process_frame(work / layer / f'{state}_{i}.png', meta['scale'], pal, method, lines,
                                             meta.get('glowGroups', ()))
            frames[state].append(entry)
    return meta, frames


def pack(meta, frames, assets):
    """Step 6: one sheet per layer, a row per state, plus the JSON atlas."""
    assets = Path(assets)
    assets.mkdir(parents=True, exist_ok=True)
    name = meta['mobile']
    fw, fh = meta['canvas']
    states = [s for s in STATE_ORDER if s in frames]
    cols = max(len(frames[s]) for s in states)
    sheets = {layer: np.zeros((fh * len(states), fw * cols, 4), dtype=np.uint8) for layer in LAYERS}
    atlas = {
        'mobile': name,
        'frameSize': [fw, fh],
        'anchor': meta['anchor'],
        'barrelLength': meta['barrelLength'],
        'tickRate': 60,
        'sheets': {layer: f'{name}_{layer}.png' for layer in LAYERS},
        'states': {},
    }
    for row, state in enumerate(states):
        info = meta['states'][state]
        out_frames = []
        for col, fr in enumerate(frames[state]):
            rect = [col * fw, row * fh, fw, fh]
            for layer in LAYERS:
                sheets[layer][row * fh:(row + 1) * fh, col * fw:(col + 1) * fw] = fr[layer]
            px_, py_ = fr['pivot']
            out_frames.append({
                'rect': rect,
                'barrel': bool(fr['barrelVisible']),
                'pivot': [px_, py_],
                'muzzle': [round(px_ + meta['barrelLength'], 2), py_],
            })
        atlas['states'][state] = {
            'frameTicks': info['frameTicks'],
            'frameMs': round(info['frameTicks'] * 1000 / 60),
            'loop': info['loop'],
            'frames': out_frames,
        }
    for layer in LAYERS:
        Image.fromarray(sheets[layer], 'RGBA').save(assets / f'{name}_{layer}.png', optimize=True)
    (assets / f'{name}.json').write_text(json.dumps(atlas, indent=2) + '\n', encoding='utf-8')
    return atlas


# --------------------------------------------------------------------------
# Looking at it
# --------------------------------------------------------------------------

BACKDROPS = {
    # name: (sky, far band, terrain outline, crust, soil)
    'hills': ('#89c9f0', '#5d8c55', '#a6e069', '#6fbb4e', '#8a6a3c'),
    'chasm': ('#d4714f', '#7d4e79', '#f3cd8b', '#c9854a', '#8c4f2f'),
    'isles': ('#2f74b8', '#8e97ad', '#b8f08c', '#66bf57', '#7c7e8e'),
    'caves': ('#191630', '#2d2749', '#9a94c4', '#635d80', '#403b58'),
}


def backdrop(name, w, h, ground_y):
    sky, far, line, crust, soil = (hex_rgb(c) for c in BACKDROPS[name])
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = sky
    img[ground_y - 14:ground_y] = far
    img[ground_y - 14:ground_y, : w // 2] = sky
    img[ground_y:] = soil
    img[ground_y:ground_y + 1] = line
    img[ground_y + 1:ground_y + 4] = crust
    return Image.fromarray(img, 'RGB').convert('RGBA')


def composite(fr, angle_deg=0.0):
    """Body plus barrel the way the client draws them: barrel rotated about the pivot."""
    body = Image.fromarray(fr['body'], 'RGBA')
    out = body.copy()
    if fr['barrelVisible']:
        barrel = Image.fromarray(fr['barrel'], 'RGBA')
        if angle_deg:
            barrel = barrel.rotate(angle_deg, resample=Image.NEAREST, center=tuple(fr['pivot']))
        out.alpha_composite(barrel)
    return out


def stand_on(name, sprite, anchor, pad=8):
    w, h = sprite.size[0] + pad * 2, sprite.size[1] + pad
    ground_y = pad // 2 + anchor[1]
    tile = backdrop(name, w, h + 6, ground_y)
    tile.alpha_composite(sprite, (pad, pad // 2))
    return tile


def cmd_preview(args):
    meta, frames = load_frames(args.work, args.method, not args.no_lines)
    anchor = meta['anchor']
    idle = frames['idle'][0] if 'idle' in frames else next(iter(frames.values()))[0]
    names = list(BACKDROPS)

    small = [stand_on(n, composite(idle, a), anchor) for n, a in zip(names, (0, 25, 50, 70))]
    big = [stand_on(n, composite(idle, a), anchor) for n, a in (('hills', 20), ('caves', 0))]
    tw, th = small[0].size
    gap = 8
    width = max(len(small) * (tw + gap), len(big) * (tw * 8 + gap)) + gap
    height = gap + th + gap + th * 8 + gap
    sheet = Image.new('RGBA', (width, height), (24, 24, 32, 255))
    for i, tile in enumerate(small):
        sheet.alpha_composite(tile, (gap + i * (tw + gap), gap))
    for i, tile in enumerate(big):
        sheet.alpha_composite(tile.resize((tw * 8, th * 8), Image.NEAREST), (gap + i * (tw * 8 + gap), gap * 2 + th))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)

    # Every frame of every state, for flicker hunting.
    z = 4
    fw, fh = meta['canvas']
    states = [s for s in STATE_ORDER if s in frames]
    cols = max(len(frames[s]) for s in states)
    strip = Image.new('RGBA', (cols * fw * z, len(states) * fh * z), hex_rgb(BACKDROPS['hills'][0]) + (255,))
    for row, state in enumerate(states):
        for col, fr in enumerate(frames[state]):
            strip.alpha_composite(composite(fr, 0).resize((fw * z, fh * z), Image.NEAREST), (col * fw * z, row * fh * z))
    strip.save(out.with_name(out.stem + '_frames.png'))

    for state in states:
        changes = []
        seq = frames[state]
        for a, b in zip(seq, seq[1:]):
            changes.append(int((np.array(composite(a)) != np.array(composite(b))).any(axis=2).sum()))
        print(f'{state:6s} pixels changed between frames: {changes}')
    print('wrote', out)


def cmd_sprites(args):
    meta, frames = load_frames(args.work, args.method, not args.no_lines)
    atlas = pack(meta, frames, args.assets)
    used = set()
    for seq in frames.values():
        for fr in seq:
            for layer in LAYERS:
                a = fr[layer]
                assert set(np.unique(a[..., 3])) <= {0, 255}, 'semi-transparent pixel survived'
                used |= {tuple(c) for c in a[a[..., 3] == 255][:, :3]}
    print(f'{sum(len(s["frames"]) for s in atlas["states"].values())} frames, {len(used)} colours used')
    # A sprite that reaches the edge of its canvas has probably been cut off by it.
    for state, seq in frames.items():
        for i, fr in enumerate(seq):
            for layer in LAYERS:
                a = fr[layer][..., 3]
                edges = [n for n, hit in (('top', a[0].any()), ('bottom', a[-1].any()),
                                          ('left', a[:, 0].any()), ('right', a[:, -1].any())) if hit]
                if edges:
                    print(f'WARNING clipped? {meta["mobile"]} {layer} {state}_{i} touches {", ".join(edges)}')


def read_old_sprite(ts_path, width, height):
    """First idle frame of the hand-drawn armor sprite, straight from its TypeScript data."""
    text = Path(ts_path).read_text(encoding='utf-8')
    palette = [hex_rgb(h) for h in re.findall(r"'(#[0-9a-fA-F]{6})'", text.split('frameTicks')[0])]
    rows = re.findall(r"'([0-9a-z.]{%d})'" % width, text)[:height]
    img = np.zeros((height, width, 4), dtype=np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.':
                img[y, x, :3] = palette[int(ch, 36)]
                img[y, x, 3] = 255
    return Image.fromarray(img, 'RGBA')


def cmd_compare(args):
    assets = Path(args.assets)
    atlas = json.loads((assets / f'{args.name}.json').read_text(encoding='utf-8'))
    fw, fh = atlas['frameSize']
    body = Image.open(assets / f'{args.name}_body.png').convert('RGBA').crop((0, 0, fw, fh))
    barrel = Image.open(assets / f'{args.name}_barrel.png').convert('RGBA').crop((0, 0, fw, fh))
    new = body.copy()
    new.alpha_composite(barrel)
    ow, oh = args.old_size
    old = read_old_sprite(HERE / f'../../packages/shared/src/sprites/mobiles/{args.old}.ts', ow, oh)
    old_canvas = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
    ax, ay = atlas['anchor']
    old_canvas.alpha_composite(old, (ax - ow // 2, ay - oh))

    gap = 8
    rows = []
    for name in ('hills', 'caves'):
        tiles = [stand_on(name, s, atlas['anchor']) for s in (old_canvas, new)]
        tw, th = tiles[0].size
        row = Image.new('RGBA', (gap * 5 + tw * 2 + tw * 8, th * 4 + gap), (24, 24, 32, 255))
        x = gap
        for t in tiles:
            row.alpha_composite(t, (x, gap))
            x += tw + gap
        for t in tiles:
            row.alpha_composite(t.resize((tw * 4, th * 4), Image.NEAREST), (x, gap))
            x += tw * 4 + gap
        rows.append(row)
    sheet = Image.new('RGBA', (rows[0].size[0], sum(r.size[1] for r in rows) + gap), (24, 24, 32, 255))
    y = 0
    for r in rows:
        sheet.alpha_composite(r, (0, y))
        y += r.size[1]
    sheet.save(args.out)
    print('wrote', args.out, '(old left, new right; 1x then 4x)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name, fn in (('sprites', cmd_sprites), ('preview', cmd_preview), ('compare', cmd_compare)):
        p = sub.add_parser(name)
        p.set_defaults(fn=fn)
        p.add_argument('--work', default=str(HERE / 'work/tank'))
        p.add_argument('--assets', default=str(HERE / '../../packages/client/public/sprites/blender'))
        p.add_argument('--out', default=str(HERE / 'work/preview.png'))
        p.add_argument('--method', choices=('mode', 'box'), default='mode')
        p.add_argument('--name', default='tank', help='atlas name, for compare')
        p.add_argument('--old', default='armor', help='hand-drawn sprite to compare against')
        p.add_argument('--old-size', type=int, nargs=2, default=(56, 48))
        p.add_argument('--no-lines', action='store_true', help='skip the interior part lines')
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
