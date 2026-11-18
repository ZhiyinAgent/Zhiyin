"""The Dots look's mark: the app's Z in dots, lit like the landscape.

The Z is taken from the app's icon and drawn as a raised brush stroke, lit
from the upper right with dry-brush texture, moonlit by night and in ink by
day. The large mark is a transparent square crop of it. The small marks are
read from the large one cell by cell: each cell becomes one square dot with
that cell's colour and coverage, so the lighting carries over. The one beside
the name is a bitmap for 24 css px on a 2x display. The one in a line of the
conversation is also written as SVG, its viewBox its grid of 11 cells, shown
at 22 css px so each dot lands on whole pixels at 1x and 2x.
"""

import numpy as np
from dots import (
    D_BG,
    D_SOFT,
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
from PIL import Image
from scipy import ndimage as ndi

N = 1440
SMALL_PITCH, SMALL_DOT = 3, 2


def big(icon_path, grain=True):
    """The Z by night and by day, as RGB images on the theme's ground."""
    rng = np.random.default_rng(5)
    size = 1100
    icon = Image.open(icon_path).convert("L").resize((size, size), Image.LANCZOS)
    icon = np.asarray(icon, np.float32) / 255
    m = np.zeros((N, N), np.float32)
    o = (N - size) // 2
    m[o : o + size, o : o + size] = icon > 0.5

    # The stroke as a raised brush mark: height from distance to its edge.
    d = ndi.distance_transform_edt(m)
    h = ndi.gaussian_filter(np.sqrt(d) * 7, 3)
    gy, gx = np.gradient(h)
    n = np.stack([-gx, gy, np.ones_like(h)], -1)  # x right, y up, z toward the viewer
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    L = np.array([0.72, 0.38, 0.58])
    L /= np.linalg.norm(L)
    diff = np.clip(n @ L, 0, 1)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    side = 0.45 + 0.55 * smoothstep(0.2, 0.8, xx + 0.3 * (0.5 - yy))  # light falls from the upper right
    # Dry-brush strokes along the Z's diagonal and its bars.
    diag = ndi.rotate(fbm(N, N, 80, rng, 5, aspect=7), -32, reshape=False, mode="reflect")
    bars = fbm(N, N, 60, rng, 4, aspect=9)
    level = smoothstep(0.42, 0.58, ndi.gaussian_filter(m, 30))  # how deep inside the stroke
    brush = 0.5 * diag + 0.5 * bars
    rim = np.exp(-d / 5) * np.clip(n[..., 0] * 1.3 + n[..., 1] * 0.6, 0, 1)
    soft = ndi.gaussian_filter(m, 3)
    spray = (rng.random((N, N)) < 0.004) * smoothstep(0.02, 0.2, ndi.gaussian_filter(m, 22)) * (1 - m)

    night, day = Canvas(N, N, N_BG), Canvas(N, N, D_BG)
    sl = (slice(0, N), slice(0, N))
    inside = soft > 0.02

    val = (0.1 + 0.9 * diff**1.3) * side * (0.55 + 0.75 * brush) * soft + 0.95 * rim * soft
    val = np.clip(val, 0, 1)
    hue = mix(N_AZURE, mix(N_TEAL, N_AZURE, 0.5), level)
    hi = np.clip((val - 0.55) / 0.45, 0, 1) ** 1.2
    cn = np.where((val < 0.55)[..., None], mix(hue * 0.45, hue, val / 0.55), mix(hue, N_TEXT, hi))
    night.put(sl, inside, val, cn, glow=np.clip(rim * 0.6, 0, 1))
    night.put(sl, spray > 0, 0.5, mix(N_AZURE, N_TEXT, 0.4))

    shade = 1 - diff
    ink = np.clip(
        (0.45 + 0.5 * shade) * (0.6 + 0.6 * brush) * (0.55 + 0.45 * side) * soft + 0.3 * np.exp(-d / 4) * soft, 0, 1
    )
    cd = mix(mix(D_SOFT, D_TEAL, 0.25), D_TEXT, np.clip(shade * 0.9 + (1 - brush) * 0.3, 0, 1))
    day.put(sl, inside, ink, cd)
    day.put(sl, spray > 0, 0.6, D_SOFT)
    return render(night, True), render(day, False, grain)


def tile(im, night):
    """A square, transparent crop of the Z with a margin, as RGBA."""
    im = im.astype(np.float32)
    bg = np.median(im[:40, :40].reshape(-1, 3), 0)
    fg, a = unmix(im, bg, night)
    ys, xs = np.nonzero(a > 0.15)
    cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
    half = max(xs.max() - xs.min(), ys.max() - ys.min()) // 2 + 24
    box = (slice(cy - half, cy + half), slice(cx - half, cx + half))
    return np.dstack([np.clip(fg[box], 0, 255), np.clip(a[box], 0, 1) * 255]).astype(np.uint8)


def small(tile_rgba, night, css):
    """The Z at a small size for a 2x display, one square dot per cell, as RGBA."""
    mark = tile_rgba.astype(np.float32)
    # Spend the cells on the letter: crop to the mark, square, with no margin.
    ys, xs = np.nonzero(mark[..., 3] > 110)  # the letter, not its glow
    half = max(ys.max() - ys.min(), xs.max() - xs.min()) // 2 + 1
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    mark = mark[cy - half : cy + half, cx - half : cx + half]
    # Small marks need more contrast than the large one: lift by night, deepen by day.
    toward = np.array([226, 236, 240], np.float32) if night else np.array([34, 31, 29], np.float32)
    mark[..., :3] = mark[..., :3] + (toward - mark[..., :3]) * (0.62 if night else 0.45)
    px = css * 2
    cells = px // SMALL_PITCH
    pad = (px - cells * SMALL_PITCH) // 2 + 1  # dots sit centred in the box
    # Mean colour and coverage of the large mark under each cell.
    n = mark.shape[0] // cells
    crop = mark[: n * cells, : n * cells].reshape(cells, n, cells, n, 4)
    a = crop[..., 3].mean((1, 3)) / 255
    rgb = (crop[..., :3] * crop[..., 3:4]).sum((1, 3)) / np.maximum(crop[..., 3].sum((1, 3))[..., None], 1)
    a = np.clip(a * 3.6, 0, 1)  # a cell the stroke crosses at all is a full dot
    a[a < 0.3] = 0
    a = np.maximum(a, 0.75 * (a > 0))
    out = np.zeros((px, px, 4), np.uint8)
    for j in range(cells):
        for i in range(cells):
            if a[j, i] > 0:
                y, x = pad + j * SMALL_PITCH, pad + i * SMALL_PITCH
                out[y : y + SMALL_DOT, x : x + SMALL_DOT, :3] = rgb[j, i]
                out[y : y + SMALL_DOT, x : x + SMALL_DOT, 3] = a[j, i] * 255
    return out


def svg(dots, css):
    """A small mark as SVG: one square per dot, with its colour and opacity.

    The viewBox is the grid itself, shifted a quarter of a dot so that, shown
    two pixels to a cell, each dot's centre falls on a pixel's centre.
    """
    px = css * 2
    cells = px // SMALL_PITCH
    pad = (px - cells * SMALL_PITCH) // 2 + 1
    rects = []
    for j in range(cells):
        for i in range(cells):
            y, x = pad + j * SMALL_PITCH, pad + i * SMALL_PITCH
            r, g, b, a = (int(v) for v in dots[y, x])
            if not a:
                continue
            opacity = "" if a >= 250 else f' fill-opacity="{a / 255:.2f}"'
            rects.append(
                f'<rect x="{x}" y="{y}" width="{SMALL_DOT}" height="{SMALL_DOT}" fill="#{r:02x}{g:02x}{b:02x}"{opacity}/>'
            )
    start = pad - 1.25
    size = cells * SMALL_PITCH
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{start:g} {start:g} {size} {size}">'
        + "".join(rects)
        + "</svg>\n"
    )


def draw(icon_path):
    """Every mark: {(theme, size): RGBA image}, the size "large", 17 or 24."""
    out = {}
    for theme, im in zip(("night", "day"), big(icon_path, grain=False)):
        large = tile(im, theme == "night")
        out[theme, "large"] = large
        for css in (17, 24):
            out[theme, css] = small(large, theme == "night", css)
    return out
