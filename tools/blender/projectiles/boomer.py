"""
Zephyr (roster `boomer`, atlas `zephyr`): the bird mech's thrown blades.

The zephyr's gun is a throwing arm holding a lime hooked boomerang (its barrel layer),
and its shots weigh almost nothing and ride the wind (`windFactor` 3). Both keys
tumble (`spin`), clockwise on screen, reversed by the client when they fly left.

- `boomerang` (Boomerang, and the three blades of Triple): the blade from the zephyr's
  hand: a lime V with rounded tips and a teal grip wrapped round the elbow, tipped
  towards the sun so it catches the light.
- `boomerangBig` (Cyclone): a three-armed pinwheel of hooked lime blades, each hook
  trailing the spin like a gust, round a teal hub with a glass eye.
"""
import math

from projectile_kit import ball, mat, prism, projectile, roll


def ribbon(center, widths, cap=4):
    """A closed outline around a centre line with a half width per point and round caps."""
    n = len(center)
    left, right = [], []
    normals = []
    for i in range(n):
        a = center[max(i - 1, 0)]
        b = center[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1.0
        normals.append((-dy / ln, dx / ln))
    for (x, y), w, (nx, ny) in zip(center, widths, normals):
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))

    def arc(p, w, nrm, sign):
        # Half circle from one side to the other around the end point.
        nx, ny = nrm
        tx, ty = ny * sign, -nx * sign          # outward along the line
        pts = []
        for k in range(1, cap):
            t = math.pi * k / cap
            c, s = math.cos(t), math.sin(t)
            pts.append((p[0] + w * (nx * c * sign + tx * s), p[1] + w * (ny * c * sign + ty * s)))
        return pts

    end = arc(center[-1], widths[-1], normals[-1], 1)
    start = arc(center[0], widths[0], normals[0], -1)
    return left + end + list(reversed(right)) + start


def v_blade(open_deg=100.0, arm=4.3, w_elbow=2.0, w_tip=1.4, steps=4):
    """The boomerang's centre line: two arms from a rounded elbow, centred on its middle."""
    half = math.radians(open_deg / 2)
    elbow_r = 1.4
    pts = []
    # Arm A from its tip in to the elbow arc, then the arc, then out along arm B.
    ax, ay = -math.sin(half), -math.cos(half)
    bx, by = math.sin(half), -math.cos(half)
    for k in range(steps, 0, -1):
        t = k / steps
        pts.append((ax * (elbow_r + arm * t), ay * (elbow_r + arm * t)))
    for k in range(0, 5):
        t = -half + 2 * half * k / 4
        pts.append((math.sin(t) * elbow_r, -math.cos(t) * elbow_r + 0.0))
    for k in range(1, steps + 1):
        t = k / steps
        pts.append((bx * (elbow_r + arm * t), by * (elbow_r + arm * t)))
    # Flip so the elbow points up, and centre it on the blade's middle.
    pts = [(x, -y) for x, y in pts]
    cy = sum(y for _, y in pts) / len(pts)
    pts = [(x, y - cy) for x, y in pts]
    mid = len(pts) // 2
    widths = []
    for i in range(len(pts)):
        t = abs(i - mid) / mid
        widths.append(w_elbow + (w_tip - w_elbow) * t)
    return pts, widths


@projectile('boomerang', (15, 15), mode='spin', frames=8, spin_deg=360.0, frame_ticks=2,
            materials=('skin', 'shell'))
def boomerang(a):
    pts, widths = v_blade()
    blade = prism('blade', ribbon(pts, widths), 1.4, mat('skin'), bevel=0.5, group=1, smooth=True)
    mid = len(pts) // 2
    # The teal grip: a short wrap round the elbow, a little proud of the blade.
    (x0, y0), (x1, y1) = pts[mid - 1], pts[mid + 1]
    band = [(x0 * 0.35, y0 * 0.35 + pts[mid][1] * 0.65), (x1 * 0.35, y1 * 0.35 + pts[mid][1] * 0.65)]
    grip = prism('grip', ribbon(band, [widths[mid] + 0.2] * 2, cap=2), 2.0,
                 mat('shell'), bevel=0.4, group=2, smooth=True)
    objs = [blade, grip]
    for o in objs:
        roll(o, -18)
    return objs


def hook_arm(k, count, r0=1.5, r1=9.0, sweep=58.0, w0=2.4, w1=0.9, steps=7):
    """One arm of the pinwheel: out from the hub, curling counter-clockwise (trailing a
    clockwise spin) and tapering to a point."""
    base = 360.0 * k / count
    pts, widths = [], []
    for i in range(steps + 1):
        t = i / steps
        r = r0 + (r1 - r0) * t
        ang = math.radians(base + sweep * t ** 1.6)
        pts.append((r * math.cos(ang), r * math.sin(ang)))
        widths.append(w0 + (w1 - w0) * t ** 0.8)
    return pts, widths


@projectile('boomerangBig', (23, 23), mode='spin', frames=6, spin_deg=120.0, frame_ticks=2,
            materials=('skin', 'shell', 'glass'))
def boomerang_big(a):
    objs = []
    for k in range(3):
        pts, widths = hook_arm(k, 3)
        objs.append(prism(f'arm{k}', ribbon(pts, widths, cap=3), 1.6, mat('skin'), bevel=0.5, group=1,
                          smooth=True))
    objs.append(ball('hub', (0, 0), 3.0, mat('shell'), squash=(1, 1, 0.8), group=2))
    objs.append(ball('eye', (0, 0), 1.4, mat('glass'), d=2.1, squash=(1, 1, 0.5), group=3))
    for o in objs[:3]:
        roll(o, -18)
    return objs
