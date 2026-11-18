"""The dot renderer the Dots look's pictures are drawn with.

A picture is painted on two canvases, one for each theme: per pixel, how much
ink (0..1), its colour, and how much it glows. Rendering averages each 4 x 4
block into one cell, decides by an 8 x 8 Bayer threshold whether the cell
holds a dot, and draws the dot as a 3 x 3 square. By night the dots glow a
little into the ground; by day the paper has a faint grain. Every colour is a
token of the app's theme of that name.
"""

import numpy as np
from scipy import ndimage as ndi

PITCH, DOT = 4, 3  # a dot every 4 px, 3 px wide


def hexc(s):
    return np.array([int(s[i : i + 2], 16) for i in (1, 3, 5)], np.float32)


# Dark theme tokens (night).
N_BG, N_TEXT, N_SOFT, N_MUTED = hexc("#141211"), hexc("#f1ece6"), hexc("#d4cdc5"), hexc("#9b9da2")
N_TEAL, N_AZURE, N_GOLD, N_AMBER = hexc("#76b7b0"), hexc("#8fa7d8"), hexc("#d8b56a"), hexc("#e8b23a")
N_GREEN, N_ORANGE = hexc("#7fc27f"), hexc("#f2903f")
# Light theme tokens (day).
D_BG, D_TEXT, D_SOFT, D_STONE = hexc("#eeeae4"), hexc("#1d1a17"), hexc("#3b3632"), hexc("#bfb6aa")
D_TEAL, D_AZURE, D_FOREST, D_GREEN = hexc("#2f8a83"), hexc("#4766b0"), hexc("#107049"), hexc("#3d8a3d")


def mix(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[..., None]  # a per-pixel weight, applied to each channel
    assert t.ndim in (0, 1, 3) and (t.ndim < 3 or t.shape[-1] == 1), t.shape
    out = a + (b - a) * t
    assert out.ndim <= 3, out.shape  # never broadcast past one image
    return out


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(h, w, cell_y, cell_x, rng):
    gy, gx = int(np.ceil(h / cell_y)) + 3, int(np.ceil(w / cell_x)) + 3
    small = rng.random((gy, gx))
    big = ndi.zoom(small, (cell_y, cell_x), order=3, mode="reflect")
    return big[:h, :w]


def fbm(h, w, base, rng, octaves=5, aspect=1.0):
    """Fractal value noise in 0..1: octaves of noise, each half the size of the last."""
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        s = max(base / 2**o, 2)
        out += amp * value_noise(h, w, s, s * aspect, rng)
        total += amp
        amp *= 0.5
    return out / total


def bayer(n):
    m = np.array([[0, 2], [3, 1]])
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return (m + 0.5) / m.size


class Canvas:
    """One theme's paint: ink, colour and glow per pixel, over the theme's ground."""

    def __init__(self, h, w, bg):
        self.h, self.w, self.bg = h, w, bg
        self.a = np.zeros((h, w), np.float32)
        self.c = np.empty((h, w, 3), np.float32)
        self.c[:] = bg
        self.glow = np.zeros((h, w), np.float32)

    def box(self, x0, x1, y0, y1):
        """The part of the canvas between two columns and two rows, clipped to it."""
        x0, x1 = int(max(0, x0)), int(min(self.w, x1))
        y0, y1 = int(max(0, y0)), int(min(self.h, y1))
        return (slice(y0, y1), slice(x0, x1))

    def put(self, sl, m, a, c, glow=0.0):
        A, C, G = self.a[sl], self.c[sl], self.glow[sl]
        A[m] = np.broadcast_to(np.asarray(a, np.float32), m.shape)[m]
        C[m] = np.broadcast_to(np.asarray(c, np.float32), m.shape + (3,))[m]
        G[m] = np.broadcast_to(np.asarray(glow, np.float32), m.shape)[m]

    def under(self, sl, m, a, c, glow=0.0):
        """Paint only where the canvas holds less ink than this."""
        A = self.a[sl]
        a = np.broadcast_to(np.asarray(a, np.float32), m.shape)
        self.put(sl, m & (A < a), a, c, glow)


def render(cv, night, grain=True):
    """The canvas as dots: an RGB image, uint8, the canvas's size.

    `grain` gives the day's paper its faint grain; without it the gaps
    between the dots are the plain ground.
    """
    H, W = cv.h, cv.w
    ny, nx = H // PITCH, W // PITCH
    A = cv.a.reshape(ny, PITCH, nx, PITCH).mean((1, 3))
    wsum = cv.a.reshape(ny, PITCH, nx, PITCH).sum((1, 3))
    C = (cv.c * cv.a[..., None]).reshape(ny, PITCH, nx, PITCH, 3).sum((1, 3)) / np.maximum(wsum, 1e-6)[..., None]
    C = np.where((wsum > 1e-6)[..., None], C, cv.bg)
    G = cv.glow.reshape(ny, PITCH, nx, PITCH).max((1, 3))
    rng = np.random.default_rng(3)
    thr = np.tile(bayer(8), (ny // 8 + 1, nx // 8 + 1))[:ny, :nx]
    thr = 0.02 + 0.96 * thr + rng.normal(0, 0.02, (ny, nx))
    on = A > thr
    C = cv.bg + (C - cv.bg) * (0.9 + 0.1 * rng.random((ny, nx)))[..., None]
    C[~on] = cv.bg
    dm = np.zeros((PITCH, PITCH), bool)
    dm[:DOT, :DOT] = True
    gap = ~np.tile(dm, (ny, nx))
    img = np.repeat(np.repeat(C, PITCH, 0), PITCH, 1)
    img[gap] = cv.bg
    if night:
        src = img - cv.bg
        lights = np.repeat(np.repeat((G * on)[..., None] * (C - cv.bg), PITCH, 0), PITCH, 1)
        for c in range(3):
            img[..., c] += (
                0.32 * ndi.gaussian_filter(src[..., c], 1.3 * PITCH)
                + 0.2 * ndi.gaussian_filter(src[..., c], 9 * PITCH)
                + 0.9 * ndi.gaussian_filter(lights[..., c], 3 * PITCH)
            )
    elif grain:
        img += rng.normal(0, 1.8, (H, W, 1))
    return np.clip(img, 0, 255).astype(np.uint8)


def unmix(im, bg, night):
    """A picture on its ground as a colour and an alpha that, laid over the ground, give it back."""
    im = im.astype(np.float32)
    if night:  # lighter than the ground
        a = np.max((im - bg) / np.maximum(255 - bg, 1), -1)
    else:  # darker than the ground
        a = np.max((bg - im) / np.maximum(bg, 1), -1)
    a = np.clip(a, 0, 1)
    fg = bg + (im - bg) / np.maximum(a, 1e-3)[..., None]
    return fg, a
