"""
Dragon (atlas `wyvern`): everything the wyvern throws is its own breath, the same
flame / lamp / flash fire its barrel layer shows, wrapped in an outlined skin so it
reads against the sky.

- `fireball` (S1 Ember): a round comet of fire, orange skin, a short licking tail.
- `flame` (S2 Triple Flame): a slim yellow spear of flame with a flickering tip of
  tongues; three fly in a fan, so each is smaller and sharper than the Ember.
- `breath` (SS Dragon Breath): a huge roaring fireball, crimson outside like the
  wyvern's own hide, a white-hot heart, a mane of long tongues streaming back.

Every flame is one outlined silhouette (a head plus tongues, all one group so no lines
cut it up) with glowing layers stacked in front of it, hottest at the leading edge.
"""
import math

from projectile_kit import GLOW, W, ball, mat, projectile, tube

FIRE = ('flame', 'lamp', 'flash')


def shift(obj, d):
    """Push a piece towards the camera by `d` px (inner layers of a nested flame)."""
    obj.location = obj.location + W(0, 0, d)
    return obj


def tongue(name, x0, y0, length, r0, angle, wave, phase, material, group, d=0.0, n=7):
    """A tapering flame tongue from (x0, y0) streaming back at `angle` deg off straight back."""
    pts, radii = [], []
    a = math.radians(angle)
    for k in range(n + 1):
        t = k / n
        s = length * t
        x = x0 - s * math.cos(a)
        y = y0 + s * math.sin(a) + wave * t * t * math.sin(phase + t * 3.2)
        pts.append((x, y, d))
        radii.append(r0 * (1 - t) ** 1.1 + 0.1)
    return tube(name, pts, radii, material, group=group)


def fire(prefix, head, r, tongues, skin, cores, phase):
    """
    head: (x, y) of the fireball's centre; r its radius. tongues: list of
    (angle deg, length, radius scale, wave). skin: lit outlined material. cores: list of
    (material, radius, dx) glowing blobs stacked towards the camera.
    """
    hx, hy = head
    objs = [ball(f'{prefix}_head', (hx, hy), r, mat(skin), squash=(1.05, 1, 1), group=1)]
    for i, (ang, length, k, wave) in enumerate(tongues):
        objs.append(tongue(f'{prefix}_t{i}', hx - r * 0.2, hy + r * 0.35 * math.sin(math.radians(ang)) * 2,
                           length, r * k, ang, wave, phase + i * 2.3, mat(skin), 1))
    for i, (m, rc_, dx, tail) in enumerate(cores):
        g = GLOW + i
        d = r + 1.0 + i * 1.6
        objs.append(shift(ball(f'{prefix}_c{i}', (hx + dx, hy), rc_, mat(m), squash=(1.1, 1, 0.4), group=g), d))
        if tail > 0:
            objs.append(shift(tongue(f'{prefix}_ct{i}', hx + dx, hy, tail, rc_ * 0.9, 0, 0.6, phase + i, mat(m), g), d))
    return objs


@projectile('fireball', (14, 14), anim=3, frame_ticks=3,
            materials=('orange',) + FIRE)
def fireball(a):
    ph = a * 2 * math.pi / 3
    flick = (0.0, 0.5, -0.4)[a]
    return fire('ember', (1.9, 0.0), 3.2,
                tongues=[(0, 6.6 + flick, 0.85, 0.7), (20, 5.0 - flick, 0.7, 0.5), (-20, 5.2 + flick * 0.5, 0.7, 0.5)],
                skin='orange',
                cores=[('lamp', 2.2, 0.4, 3.0), ('flash', 1.2, 0.9, 0)],
                phase=ph)


@projectile('flame', (12, 12), anim=3, frame_ticks=3,
            materials=('amber',) + FIRE)
def flame(a):
    ph = a * 2 * math.pi / 3
    flick = (0.0, 0.5, -0.4)[a]
    # A slim lick of flame: small head, one long wriggling tongue and two short licks.
    return fire('lick', (2.2, 0.0), 2.2,
                tongues=[(0, 5.9 + flick, 0.8, 1.3), (28, 3.4 - flick, 0.55, 0.4), (-28, 3.6 + flick, 0.55, 0.4)],
                skin='amber',
                cores=[('flash', 1.3, 0.4, 2.6)],
                phase=ph)


@projectile('breath', (28, 28), anim=3, frame_ticks=3,
            materials=('crimson',) + FIRE)
def breath(a):
    ph = a * 2 * math.pi / 3
    f = (0.0, 0.9, -0.6)[a]
    return fire('roar', (4.0, 0.0), 6.0,
                tongues=[(0, 15.0 + f, 0.85, 1.0), (13, 12.8 - f, 0.75, 0.9), (-13, 13.2 + f, 0.75, 0.9),
                         (30, 8.6 + f, 0.6, 0.6), (-30, 9.0 - f, 0.6, 0.6)],
                skin='crimson',
                cores=[('flame', 4.6, 0.4, 9.0), ('lamp', 3.0, 1.2, 4.0), ('flash', 1.7, 2.0, 0)],
                phase=ph)
