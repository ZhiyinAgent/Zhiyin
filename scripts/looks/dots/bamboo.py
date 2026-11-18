"""The Dots look's bamboo, a transparent strip for the foot of the side column.

A stand of bamboo is drawn in the landscape's dots and palette, moonlit from
the right by night and in ink by day, on a canvas the side column's shape
(242 x 836 css px at the landscape's scale). It is then unmixed from its
ground (each pixel becomes a colour and an alpha that give it back over the
ground) and cropped to its lower third, where the stand is. The stalks rise
out of nothing over the strip's top third. The strip is drawn at full alpha;
the look shows it at the opacity measured against each theme.
"""

import numpy as np
from dots import (
    D_BG,
    D_FOREST,
    D_GREEN,
    D_TEAL,
    D_TEXT,
    N_AZURE,
    N_BG,
    N_TEAL,
    N_TEXT,
    Canvas,
    fbm,
    mix,
    render,
    smoothstep,
    unmix,
)

W, H = 440, 1520
FULL = (slice(0, H), slice(0, W))


class Bamboo:
    def __init__(self, seed=21):
        self.rng = np.random.default_rng(seed)
        self.Y, self.X = np.mgrid[0:H, 0:W].astype(np.float32)
        self.grain = fbm(H, W, 40, self.rng, 3, aspect=0.1).astype(np.float32)  # along the stalk
        self.night, self.day = Canvas(H, W, N_BG), Canvas(H, W, D_BG)
        # The stand keeps to the foot: the stalks rise out of mist, and the
        # bottom stays clear.
        self.calm = smoothstep(0.52 * H, 0.74 * H, self.Y) * (1 - 0.6 * smoothstep(0.93 * H, 0.99 * H, self.Y))

    def stalk(self, x0, lean, r, depth):
        """One culm: a lit cylinder with nodes, leaning a little from the foot."""
        Y, X = self.Y, self.X
        cx = x0 + lean * (H - Y) / H + 3 * np.sin(Y / 230)
        u = (X - cx) / r  # -1..1 across the stalk
        body = np.abs(u) < 1
        seg = 150 + 25 * depth
        phase = (Y + 37 * x0) % seg
        node = (phase < 5) | (phase > seg - 2)
        bulge = np.abs(u) < 1 + 0.18 * (phase < 6)
        m = body | (bulge & node)
        nx = np.clip(u, -1, 1)
        lit = smoothstep(-0.2, 0.9, nx)  # moon and sun to the right
        rim = smoothstep(0.55, 0.95, nx)
        fade = (0.55 + 0.45 * depth) * self.calm
        # Night: dim body, bright rim on the lit side, nodes as light rings.
        a = (0.16 + 0.4 * lit * (0.6 + 0.6 * self.grain) + 0.8 * rim + 0.45 * node) * fade
        c = mix(mix(N_TEAL, N_AZURE, 0.3) * 0.55, mix(N_TEAL, N_TEXT, 0.45), np.clip(rim + 0.5 * node, 0, 1))
        self.night.put(FULL, m, np.clip(a, 0, 1), c)
        # Day: ink, darker on the shaded side, nodes as dark bands.
        a = (0.35 + 0.45 * (1 - lit) + 0.4 * node) * (0.6 + 0.5 * self.grain) * fade
        c = mix(mix(D_GREEN, D_BG, 0.25), mix(D_FOREST, D_TEXT, 0.35), np.clip(1 - lit + 0.6 * node, 0, 1))
        c = mix(c, mix(D_TEAL, D_BG, 0.4), 1 - depth)
        self.day.put(FULL, m, np.clip(a, 0, 1), c)

    def twig(self, x0, y0, x1, y1, depth):
        q = np.linspace(0, 1, 200)
        xs, ys = x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - 10 * np.sin(np.pi * q)
        m = np.zeros((H, W), bool)
        for o in (0, 1, 2):
            xi, yi = np.round(xs + o).astype(int), np.round(ys).astype(int)
            ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
            m[yi[ok], xi[ok]] = True
        fade = (0.55 + 0.45 * depth) * self.calm
        self.night.put(FULL, m, 0.45 * fade, mix(N_TEAL, N_TEXT, 0.3))
        self.day.put(FULL, m, 0.85 * fade, mix(D_FOREST, D_TEXT, 0.35))

    def leaves(self, cx_of, sprays, side, depth):
        """Sprays of long narrow leaves fanning down from a twig's tip, as bamboo is painted."""
        rng = self.rng
        for y0, reach, count in sprays:
            x0 = cx_of(y0)
            tx, ty = x0 + side * reach, y0 - reach * 0.3
            self.twig(x0, y0, tx, ty, depth)
            base = rng.uniform(30, 45)
            for k in range(count):
                a = np.deg2rad(base + (k - (count - 1) / 2) * 17 + rng.normal(0, 4))
                dx, dy = side * np.cos(a), np.sin(a)  # outward and down
                L = rng.uniform(125, 175) * (0.7 + 0.3 * depth)
                w = L * rng.uniform(0.1, 0.13)
                sl = self.night.box(
                    min(tx, tx + dx * L) - w - 2,
                    max(tx, tx + dx * L) + w + 2,
                    min(ty, ty + dy * L) - w - 2,
                    max(ty, ty + dy * L) + w + 2,
                )
                if sl[0].stop <= sl[0].start or sl[1].stop <= sl[1].start:
                    continue
                X, Y = self.X[sl], self.Y[sl]
                along = ((X - tx) * dx + (Y - ty) * dy) / L
                across = -(X - tx) * dy + (Y - ty) * dx
                half = w * np.sin(np.pi * np.clip(along, 0, 1) ** 0.8)
                leaf = (along > 0) & (along < 1) & (np.abs(across) < half)
                vein = leaf & (np.abs(across) < 1.2)
                lit = across * dx < 0  # the upper half of the leaf catches the light
                fade = (0.55 + 0.45 * depth) * self.calm[sl]
                self.night.put(
                    sl,
                    leaf,
                    (0.18 + 0.5 * lit) * fade,
                    mix(N_TEAL * 0.6, mix(N_TEAL, N_TEXT, 0.4), lit.astype(np.float32)),
                )
                cd = mix(mix(D_GREEN, D_FOREST, 0.4), mix(D_FOREST, D_TEXT, 0.3), (~lit).astype(np.float32))
                cd = mix(cd, mix(D_TEAL, D_BG, 0.4), 1 - depth)
                self.day.put(sl, leaf, (0.7 + 0.25 * (~lit)) * fade, cd)
                self.day.put(sl, vein, 0.6 * fade, mix(D_GREEN, D_BG, 0.4))


def along(x0, lean):
    return lambda y: x0 + lean * (H - y) / H + 3 * np.sin(y / 230)


def stand(grain=True):
    """The whole stand by night and by day, as RGB images on the theme's ground."""
    s = Bamboo()
    # Far stalks first, pale; their spray behind; then the near stalks along
    # the right edge, and their sprays in front.
    for x0, lean, r in [(0.3 * W, -14, 12), (0.74 * W, 12, 13)]:
        s.stalk(x0, lean, r, 0.3)
    s.leaves(along(0.3 * W, -14), [(0.74 * H, 60, 4)], 1, 0.3)
    for x0, lean, r in [(0.52 * W, -22, 22), (0.84 * W, 16, 24)]:
        s.stalk(x0, lean, r, 1.0)
    s.leaves(along(0.52 * W, -22), [(0.7 * H, 45, 5), (0.8 * H, 40, 4)], -1, 1.0)
    s.leaves(along(0.84 * W, 16), [(0.86 * H, 40, 3)], -1, 1.0)
    return render(s.night, True), render(s.day, False, grain)


def strip(im, night, scale=1.0):
    """The stand's lower third as RGBA, its alpha multiplied by `scale`."""
    im = im.astype(np.float32)
    bg = np.median(im[:200, :].reshape(-1, 3), 0)  # the top is bare ground
    fg, a = unmix(im, bg, night)
    top = int(im.shape[0] * 0.66)
    a = np.clip(a[top:] * scale, 0, 1)
    y = np.linspace(0, 1, a.shape[0])[:, None]
    a = a * np.clip(y / 0.33, 0, 1) ** 1.5
    rgba = np.dstack([np.clip(fg[top:], 0, 255), a * 255]).astype(np.uint8)
    assert rgba.ndim == 3 and rgba.shape[2] == 4
    return rgba


def draw():
    """The strip by night and by day, as RGBA images at full alpha."""
    night, day = stand(grain=False)
    return strip(night, True), strip(day, False)
