# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""
The projectile renders to one game-ready atlas.

    uv run pack_projectiles.py --work work/projectiles \
        --assets ../../packages/client/public/sprites/blender --preview work/projectiles_preview.png

Every frame goes through `postprocess.process_frame`, the reduction the mobiles and the
UI kit get (majority vote downscale, palette quantise to the piece's own materials, part
lines, outline, orphan removal). Every module's last render in work/projectiles/*/ is
packed, so rendering one module never drops the others from the atlas.

`projectiles.json` maps each sprite key to its mode, size, frame rects and timing:
`aim` frames run direction-major (dirs x anim), `spin` and `loop` frames in order.
"""
import argparse
import json
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import postprocess as pp
from pack_ui_kit import GUTTER, shelf_pack

HERE = Path(__file__).resolve().parent
ATLAS_WIDTH = 512
SKY = (104, 164, 214, 255)


def palette_for(info, extra):
    names = info['materials']
    if not any(n in extra for n in names):
        return pp.Palette(names)
    data = json.loads((HERE / 'palette.json').read_text(encoding='utf-8'))
    data['ramps'].update({n: extra[n] for n in names if n in extra})
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as fh:
        json.dump(data, fh)
    return pp.Palette(names, path=fh.name)


def process(work, info, scale, glow_from, extra):
    pal = palette_for(info, extra)
    glow = range(glow_from, 27)
    out = []
    for name in info['frames']:
        a = pp.process_frame(work / 'img' / f'{name}.png', scale, pal, 'mode', True, glow)
        assert set(np.unique(a[..., 3])) <= {0, 255}, 'semi-transparent pixel survived'
        edge = np.concatenate([a[0, :, 3], a[-1, :, 3], a[:, 0, 3], a[:, -1, 3]])
        if edge.any():
            print(f'warning: {info["key"]} frame {name} touches the canvas edge (clipped outline)')
        out.append(a)
    return out


def pack(pieces, rendered, assets):
    items = []
    for info in pieces:
        w, h = info['size']
        n = len(rendered[info['key']])
        per_row = max(1, min(n, (ATLAS_WIDTH + GUTTER) // (w + GUTTER)))
        rows = -(-n // per_row)
        items.append((info['key'], per_row * (w + GUTTER) - GUTTER, rows * (h + GUTTER) - GUTTER))
    placed, height = shelf_pack(items, ATLAS_WIDTH)
    sheet = np.zeros((height, ATLAS_WIDTH, 4), dtype=np.uint8)
    atlas = {'image': 'projectiles.png', 'size': [ATLAS_WIDTH, height], 'pieces': {}}
    for info in pieces:
        key = info['key']
        w, h = info['size']
        ox, oy = placed[key]
        frames = rendered[key]
        per_row = max(1, min(len(frames), (ATLAS_WIDTH + GUTTER) // (w + GUTTER)))
        rects = []
        for k, a in enumerate(frames):
            x = ox + (k % per_row) * (w + GUTTER)
            y = oy + (k // per_row) * (h + GUTTER)
            sheet[y:y + h, x:x + w] = a
            rects.append([x, y, w, h])
        atlas['pieces'][key] = {
            'mode': info['mode'], 'size': [w, h], 'dirs': info['dirs'], 'anim': info['anim'],
            'frameTicks': info['frameTicks'], 'frames': rects,
        }
    assets = Path(assets)
    assets.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, 'RGBA').save(assets / 'projectiles.png', optimize=True)
    atlas['pieces'] = dict(sorted(atlas['pieces'].items()))
    (assets / 'projectiles.json').write_text(json.dumps(atlas, indent=1) + '\n', encoding='utf-8')
    return atlas, sheet


def write_preview(pieces, rendered, out, zoom=3):
    """One row per piece on a sky blue: every frame at 1x, then up to 8 of them at `zoom`x."""
    rows = []
    for info in pieces:
        frames = rendered[info['key']]
        if info['mode'] == 'aim':
            step = max(1, info['dirs'] // 8) * info['anim']
            pick = frames[::step][:8]
        else:
            pick = frames[:8]
        w, h = info['size']
        small = np.concatenate([np.pad(f, ((0, 0), (0, 1), (0, 0))) for f in frames[:32]], axis=1)
        big = np.concatenate([np.pad(np.kron(f, np.ones((zoom, zoom, 1), dtype=np.uint8)),
                                     ((0, 0), (0, 4), (0, 0))) for f in pick], axis=1)
        rows.append((info['key'], small, big))
    gap = 8
    width = max(max(s.shape[1] for _, s, _ in rows), max(b.shape[1] for _, _, b in rows)) + 2 * gap + 120
    height = sum(s.shape[0] + b.shape[0] + 3 * gap for _, s, b in rows) + gap
    img = Image.new('RGBA', (width, height), SKY)
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    y = gap
    for key, small, big in rows:
        draw.text((gap, y), key, fill=(20, 26, 43, 255))
        img.alpha_composite(Image.fromarray(small, 'RGBA'), (gap + 120, y))
        y += small.shape[0] + gap
        img.alpha_composite(Image.fromarray(big, 'RGBA'), (gap + 120, y))
        y += big.shape[0] + 2 * gap
    img.save(out)
    print('wrote', out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--work', default=str(HERE / 'work' / 'projectiles'))
    ap.add_argument('--assets', default=str(HERE / '../../packages/client/public/sprites/blender'))
    ap.add_argument('--preview', default=str(HERE / 'work' / 'projectiles_preview.png'))
    ap.add_argument('--preview-modules', default='', help='comma separated modules to preview (default: all)')
    ap.add_argument('--modules', default='', help='pack only these modules (a private test atlas)')
    args = ap.parse_args()
    pieces, rendered = [], {}
    pack_only = [m for m in args.modules.split(',') if m]
    for meta_path in sorted(Path(args.work).glob('*/meta.json')):
        if pack_only and meta_path.parent.name not in pack_only:
            continue
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        for info in meta['pieces']:
            info['module'] = meta['module']
            rendered[info['key']] = process(meta_path.parent, info, meta['scale'], meta['glowFrom'],
                                            meta.get('extraRamps', {}))
            pieces.append(info)
    if not pieces:
        raise SystemExit(f'nothing rendered in {args.work}')
    atlas, sheet = pack(pieces, rendered, args.assets)
    print(f'{len(atlas["pieces"])} pieces, atlas {atlas["size"][0]}x{atlas["size"][1]}')
    only = [m for m in args.preview_modules.split(',') if m]
    write_preview([p for p in pieces if not only or p['module'] in only], rendered, args.preview)


if __name__ == '__main__':
    main()
