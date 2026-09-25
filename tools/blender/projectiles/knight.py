"""
Paladin (roster `knight`, atlas `paladin`): the holy blades that spot for the rank of
falling swords (`markThenSwords`).

Every shot is the paladin's own greatsword in miniature, flying point first: a
diamond-section steel blade (two flat facets that catch the light differently), a gold
crossguard, a red grip and a gold pommel, so the cross silhouette says "sword" at 1x.

- `sword` (Three Swords): the plain blade.
- `swordRank` (Five Swords): longer, curled gold quillons and a cyan rune fuller that
  flickers, like the greatsword's rune sparks when it charges.
- `swordStorm` (Nine Swords): the great blade inside a gold halo ring, runes blazing and
  a holy star burning at the point.
"""
import bpy

from projectile_kit import GLOW, ball, lathe, mat, prism, projectile, rod


def blade(name, x0, x1, r, material, group=1, taper=0.85, tip=0.35):
    """Diamond-section blade: a four-sided lathe, flat shaded, pressed thin in depth."""
    shoulder = x1 - (x1 - x0) * tip
    o = lathe(name, [(x0, r), (shoulder, r * taper), (x1, 0.0)], material, seg=4, group=group, smooth=False)
    o.scale = (1.0, 0.55, 1.0)
    bpy.context.view_layer.update()
    return o


def hilt(xg, guard_h, guard_w, grip_len, grip_r, pommel_r, curl=0.0):
    """Crossguard at xg (its front face), grip behind it, pommel at the end."""
    h = guard_h / 2
    if curl > 0:
        # Quillons that sweep forward at the tips, as on the greatsword.
        pts = [(xg - guard_w, -h + curl * 0.3), (xg - guard_w * 0.4, -h), (xg + curl, -h - curl * 0.4),
               (xg + curl * 0.6, -h + guard_w * 0.9),
               (xg, -guard_w * 0.5), (xg, guard_w * 0.5),
               (xg + curl * 0.6, h - guard_w * 0.9),
               (xg + curl, h + curl * 0.4), (xg - guard_w * 0.4, h), (xg - guard_w, h - curl * 0.3)]
    else:
        pts = [(xg - guard_w, -h), (xg, -h), (xg, h), (xg - guard_w, h)]
    guard = prism('guard', pts, 1.8, mat('amber'), bevel=0.35, group=2)
    g0 = xg - guard_w
    grip = rod('grip', (g0 - grip_len, 0), (g0 + 0.2, 0), grip_r, mat('accent'), group=3)
    pommel = ball('pommel', (g0 - grip_len - pommel_r * 0.7, 0), pommel_r, mat('amber'), group=4)
    return [guard, grip, pommel]


def flank(name, dy, x0, length, r):
    """A spectral sword of the rank beside the lead blade: an ice blade on a gold bar."""
    objs = [blade(f'{name}_blade', x0, x0 + length, r, mat('ice'), group=6),
            prism(f'{name}_guard', [(x0 - 1.1, -2.1), (x0, -2.1), (x0, 2.1), (x0 - 1.1, 2.1)], 1.4,
                  mat('amber'), bevel=0.3, group=7)]
    for o in objs:
        o.location.z += dy / 10.0
        o.location.y += 0.1  # a pixel behind the lead sword
    return objs


@projectile('sword', (16, 16), materials=('white', 'amber', 'accent'))
def sword(a):
    return [
        blade('blade', -1.1, 6.4, 1.3, mat('white')),
        *hilt(-1.0, 5.6, 1.0, 1.9, 0.7, 1.0),
    ]


@projectile('swordRank', (20, 20), anim=2, frame_ticks=4, materials=('white', 'amber', 'accent', 'cyan'))
def sword_rank(a):
    rune = 6.0 if a == 0 else 4.4
    return [
        blade('blade', -1.4, 8.6, 1.65, mat('white')),
        rod('rune', (-0.4, 0), (rune, 0), 0.55, mat('cyan'), d=1.3, group=GLOW),
        *hilt(-1.3, 7.6, 1.2, 2.4, 0.8, 1.2, curl=1.2),
    ]


@projectile('swordStorm', (28, 28), anim=3, frame_ticks=3,
            materials=('white', 'ice', 'amber', 'accent', 'cyan', 'lamp', 'flash'))
def sword_storm(a):
    rune = (8.6, 6.8, 7.8)[a]
    star = (1.8, 1.3, 1.55)[a]
    return [
        *flank('up', 5.6, -3.6, 9.4, 1.2),
        *flank('dn', -5.6, -3.6, 9.4, 1.2),
        blade('blade', -1.8, 11.0, 2.1, mat('white')),
        rod('rune', (-0.6, 0), (rune, 0), 0.6, mat('cyan'), d=1.3, group=GLOW),
        *hilt(-1.7, 9.6, 1.6, 3.2, 1.0, 1.5, curl=1.6),
        ball('star', (11.0, 0), star, mat('flash'), d=2.0, group=GLOW + 1),
        ball('star_core', (11.0, 0), star * 0.55, mat('lamp'), d=2.5, group=GLOW + 2),
    ]
