"""The Dots look's landscape: Guilin karst over the river, in dots, 2560 x 1440.

Night (the dark theme) has the Mid-Autumn moon with geese crossing it; day
(the light theme) has the sun. Rounded peaks stand in two clusters along the
far shore, lit on the moonward flank and dissolving into mist, with a low line
of trees under them and their reflections broken by the ripples; the moon's
or sun's path lies on the water.

Every random draw is made in the order the shipped pictures were drawn with,
including the few whose values this drawing no longer uses, so the same
seeds give the same pictures.
"""

import numpy as np
from dots import (
    D_AZURE,
    D_BG,
    D_FOREST,
    D_GREEN,
    D_SOFT,
    D_STONE,
    D_TEAL,
    D_TEXT,
    N_AMBER,
    N_AZURE,
    N_BG,
    N_GOLD,
    N_GREEN,
    N_MUTED,
    N_ORANGE,
    N_TEAL,
    N_TEXT,
    Canvas,
    fbm,
    mix,
    render,
    smoothstep,
)
from scipy import ndimage as ndi

W, H = 2560, 1440
Y_H = 0.72 * H  # the river begins where the near peaks stand
MX, MY, MR = 0.735 * W, 0.175 * H, 80.0  # moon / sun


class Landscape:
    def __init__(self, seed=8):
        self.rng = rng = np.random.default_rng(seed)
        self.Y, self.X = np.mgrid[0:H, 0:W].astype(np.float32)
        self.veg = smoothstep(0.38, 0.72, fbm(H, W, 9, rng, 4)).astype(np.float32)
        fbm(H, W, 34, rng, 3)  # drawn, not used
        self.streak = fbm(H, W, 70, rng, 4, aspect=0.12).astype(np.float32)
        for base, octaves in ((60, 4), (5, 2), (2.5, 1), (16, 2)):
            fbm(1, W, base, rng, octaves)  # drawn, not used
        self.night, self.day = Canvas(H, W, N_BG), Canvas(H, W, D_BG)
        self.box = self.night.box
        self.water_field()
        fbm(H, W, 90, rng, 4, aspect=0.1)  # drawn, not used

    def water_field(self):
        """Perspective ripples: their texture, lines and sideways shift, per pixel of water."""
        tex = fbm(1024, 1024, 22, self.rng, 4).astype(np.float32)
        t = np.clip((self.Y - Y_H) / (H - Y_H), 0, 1)
        z = 1 / (t + 0.03)
        rows = (z * 260) % 1023
        cols = ((self.X - W / 2) * z * 0.018 + 512) % 1023
        rip = ndi.map_coordinates(tex, [rows.ravel(), cols.ravel()], order=1, mode="wrap").reshape(H, W)
        calm = smoothstep(0.0, 0.12, t)  # far water is too fine to resolve
        self.t = t
        self.rip = (0.5 + (rip - 0.5) * (0.4 + 0.6 * calm)).astype(np.float32)
        f = (self.rip * 5) % 1
        self.lines = ((1 - smoothstep(0.0, 0.09 + 0.08 * t, np.abs(f - 0.5))) * calm).astype(np.float32)
        self.dx = ((self.rip - 0.5) * (4 + 30 * t)).astype(np.float32)

    def sky(self):
        sl = self.box(0, W, 0, Y_H + 40)
        X, Y = self.X[sl], self.Y[sl]
        allm = np.ones(X.shape, bool)
        d = np.hypot(X - MX, Y - MY)
        cloud = smoothstep(0.56, 0.78, fbm(*X.shape, 150, self.rng, 5, aspect=5)).astype(np.float32)
        cloud *= smoothstep(0.05 * H, 0.16 * H, Y) * smoothstep(0.5 * H, 0.32 * H, Y)

        # Night: a dim glow over the far shore, stars, thin cloud lit by the moon.
        a = 0.075 * smoothstep(0.2 * H, Y_H, Y) + 0.05 * np.exp(-np.maximum(d - MR, 0) / 260)
        c = mix(N_AZURE * 0.55, N_GOLD * 0.7, np.exp(-np.maximum(d - MR, 0) / 300))
        self.night.put(sl, allm, a, c)
        moonlit = np.exp(-np.abs(X - MX) / 700)
        self.night.under(sl, cloud > 0.02, 0.14 * cloud * moonlit**2, mix(N_AZURE, N_TEXT, 0.5 * moonlit))
        stars = (self.rng.random(X.shape) < 0.0009) & (Y < 0.42 * H) & (d > MR * 3) & (cloud < 0.1)
        self.night.put(sl, stars, self.rng.uniform(0.35, 0.95, X.shape), mix(N_AZURE, N_TEXT, 0.6))

        # Day: an azure wash, paler toward the horizon, with clouds left as paper.
        sky_t = np.clip(Y / Y_H, 0, 1)
        a = (0.1 + 0.32 * (1 - sky_t) ** 1.3) * (1 - 0.9 * cloud)
        a *= 1 - 0.75 * np.exp(-np.maximum(d - MR, 0) / 170)
        c = mix(mix(D_AZURE, D_BG, 0.25), mix(D_AZURE, D_BG, 0.55), sky_t)
        c = mix(c, mix(D_AZURE, D_STONE, 0.6), smoothstep(0.0, 0.25, cloud) * (1 - smoothstep(0.25, 0.6, cloud)) * 0.6)
        self.day.put(sl, allm, a, c)

    def moon_and_sun(self):
        sl = self.box(MX - 520, MX + 520, MY - 520, MY + 520)
        X, Y = self.X[sl], self.Y[sl]
        d = np.hypot(X - MX, Y - MY)
        disc = d < MR
        maria = smoothstep(0.52, 0.66, fbm(*X.shape, 44, self.rng, 4)).astype(np.float32)
        rr = np.clip(d / MR, 0, 1)
        c = mix(mix(N_GOLD, N_TEXT, 0.62), mix(N_GOLD, N_MUTED, 0.45), maria * 0.75) * (1 - 0.14 * rr**4)[..., None]
        self.night.put(sl, disc, 1 - 0.22 * maria, c, glow=1.0)
        halo = (d >= MR) & (d < MR + 500)
        ring = (0.34 * np.exp(-(d - MR) / 30) + 0.08 * np.exp(-(d - MR) / 150)) * smoothstep(MR + 480, MR + 200, d)
        self.night.under(sl, halo, ring, mix(N_GOLD, N_TEXT, 0.4), glow=0.4)
        c = mix(mix(N_AMBER, N_TEXT, 0.6), mix(N_AMBER, N_ORANGE, 0.5), rr**2.5)
        self.day.put(sl, disc, np.ones(X.shape, np.float32), c)
        self.day.under(
            sl, halo, 0.42 * np.exp(-(d - MR) / 26) + 0.12 * np.exp(-(d - MR) / 140), mix(N_AMBER, D_BG, 0.25)
        )

    def geese(self):
        """Geese crossing the moon by night; birds over the river by day."""
        sl = self.box(MX - 320, MX + 200, MY - 120, MY + 160)
        X = self.X[sl]
        birds = np.zeros(X.shape, bool)
        for bx, by, s in [
            (MX - 70, MY + 22, 1.0),
            (MX - 125, MY + 50, 0.85),
            (MX - 178, MY + 74, 0.75),
            (MX - 20, MY + 64, 0.8),
            (MX - 250, MY + 98, 0.65),
        ]:
            for side in (-1, 1):
                q = np.linspace(0, 1, 40)
                xs = bx + side * 15 * s * q
                ys = by - 7 * s * np.sin(np.pi * q * 0.9) + 4 * s * q
                for off in (0, 1):
                    xi = np.round(xs).astype(int) - sl[1].start
                    yi = np.round(ys + off).astype(int) - sl[0].start
                    ok = (xi >= 0) & (xi < X.shape[1]) & (yi >= 0) & (yi < X.shape[0])
                    birds[yi[ok], xi[ok]] = True
        birds = ndi.binary_dilation(birds, iterations=1)
        self.night.put(sl, birds, 0.0, N_BG)
        self.day.put(sl, birds, 0.95, mix(D_SOFT, D_TEXT, 0.3))

    def river(self):
        sl = self.box(0, W, Y_H, H)
        X, Y, t = self.X[sl], self.Y[sl], self.t[sl]
        rip, lines, dx = self.rip[sl], self.lines[sl], self.dx[sl]
        allm = np.ones(X.shape, bool)
        near_far = smoothstep(Y_H + 90, Y_H, Y)
        path = np.exp(-(((X - MX - dx * 2) / (24 + 300 * t)) ** 2)) * (1 - 0.3 * t) * smoothstep(0.08, 0.25, t)
        sparkle = path * smoothstep(0.42, 0.72, rip + 0.2 * lines)

        a = 0.05 + 0.05 * t + lines * (0.1 + 0.32 * t)
        c = mix(mix(N_AZURE, N_TEAL, 0.5) * 0.5, mix(N_AZURE, N_TEXT, 0.45), np.clip(lines * 1.4, 0, 1))
        a = np.maximum(a, sparkle * 1.05)
        c = mix(c, mix(N_GOLD, N_TEXT, 0.45 * sparkle), np.clip(sparkle * 2.5, 0, 1))
        a = a * (1 - 0.5 * near_far) + 0.08 * near_far
        self.night.put(sl, allm, np.clip(a, 0, 1), c, glow=np.clip(sparkle - 0.3, 0, 1) * 0.5)

        a = (0.5 + 0.2 * t) * (1 - 0.85 * lines * (0.4 + 0.6 * t))
        c = mix(mix(D_TEAL, D_AZURE, 0.45), D_BG, 0.42 - 0.22 * t)
        c = mix(c, mix(D_AZURE, D_TEXT, 0.3), (1 - rip) * 0.35 * t)
        a = a * (1 - 0.8 * sparkle)
        amber = sparkle * smoothstep(0.55, 0.8, rip)
        c = mix(c, mix(N_AMBER, D_BG, 0.2), np.clip(amber * 3, 0, 1))
        a = np.maximum(a, amber * 0.7)
        c = mix(c, D_BG, near_far * 0.2)
        a = a * (1 - 0.2 * near_far)
        self.day.put(sl, allm, np.clip(a, 0, 1), c)

    def peaks(self):
        """Rounded peaks in two clusters, lit along the moonward flank, dissolving into mist.

        Each peak is drawn whole, taller ones behind, so overlaps read as one
        peak in front of another rather than a cut down the middle.
        """
        s = W / 1152  # the composition follows the website's hero
        k = W / 1920
        far = [(320, 150, 260, 300), (565, 200, 230, 230), (800, 165, 260, 260), (1050, 190, 220, 260)]
        near = [
            (30, 280, 80, 80),
            (105, 180, 150, 120),
            (225, 230, 110, 160),
            (372, 308, 90, 110),
            (590, 405, 75, 85),
            (770, 350, 90, 80),
            (890, 265, 150, 95),
            (985, 310, 90, 80),
            (1085, 340, 80, 90),
            (1150, 300, 100, 100),
        ]
        layers = [
            dict(peaks=far, base=0.72 * H, bright=0.42, mist=110 * k, jitter=24 * k, d=0.3),
            dict(peaks=near, base=0.72 * H, bright=0.95, mist=170 * k, jitter=34 * k, d=1.0),
        ]
        for ly in layers:
            noise = 0.65 * (fbm(1, W, 70 * k, self.rng, 5)[0] - 0.5) + 0.35 * (fbm(1, W, 18 * k, self.rng, 3)[0] - 0.5)
            noise = ndi.gaussian_filter1d(noise, 3 * k)
            for a, b, c, dd in sorted(ly["peaks"], key=lambda p: p[1]):
                self.peak(a * s, b * s, c * s * 1.25, dd * s * 1.25, ly, noise, k)

    def peak(self, px, top, lw, rw, ly, noise, k):
        base = ly["base"]
        # Its reflection first, broken by the ripples.
        sl = self.box(px - lw - 30, px + rw + 30, base, base + (base - top) + 20)
        X, Y = self.X[sl], self.Y[sl]
        inside, val, cn, ad, cd = self.shade(X + self.dx[sl], 2 * base - Y, sl, px, top, lw, rw, ly, noise, k)
        m = inside & (Y > max(base, Y_H))
        fade = np.exp(-(Y - base) / (0.8 * (base - top)))
        lines = self.lines[sl]
        self.night.put(sl, m, val * 0.3 * fade * (1 - 0.5 * lines), mix(cn, N_AZURE * 0.5, 0.3))
        self.day.put(sl, m, ad * (0.35 + 0.35 * fade) * (1 - 0.7 * lines), mix(cd, mix(D_TEAL, D_TEXT, 0.2), 0.35))
        sl = self.box(px - lw - 6, px + rw + 6, top - 40, base + 5)
        X, Y = self.X[sl], self.Y[sl]
        inside, val, cn, ad, cd = self.shade(X, Y, sl, px, top, lw, rw, ly, noise, k)
        self.night.put(sl, inside, val, cn)
        self.day.put(sl, inside, ad, cd)

    def shade(self, X, Y, sl, px, top, lw, rw, ly, noise, k):
        """Where a peak is, and its ink and colour by night and by day."""
        base = ly["base"]
        xi = np.clip(X.astype(int), 0, W - 1)
        hw = np.where(X < px, lw, rw)
        prof = ((1 + np.cos(np.pi * np.clip(np.abs(X - px) / hw, 0, 1))) / 2) ** 1.15
        r = base - (base - top) * prof + ly["jitter"] * noise[xi] * (prof > 0.01)
        depth = Y - r
        inside = (depth > 0) & (prof > 0.004) & (Y < base)
        level = np.clip((base - Y) / (base - top), 0, 1)
        half = np.arccos(np.clip(2 * level ** (1 / 1.15) - 1, -1, 1)) / np.pi * hw
        nx = np.clip((X - px) / np.maximum(half, 3), -1, 1)
        face = 0.12 + 0.88 * smoothstep(-0.35, 0.85, nx)  # the moonward flank
        cun = self.streak[sl]
        fade = smoothstep(base + 5, base - 150 * k, Y)
        height = np.clip((base - Y) / (0.4 * H), 0, 1)
        far = 1 - ly["d"]

        rim = np.exp(-depth / (12 * k)) * (0.5 + 0.5 * face)
        body = (0.32 + 0.68 * face) * (0.35 + 0.85 * cun) * np.exp(-depth / ly["mist"])
        val = ly["bright"] * np.clip(rim + 0.85 * body, 0, 1) * fade
        hue = mix(mix(N_TEAL, N_GREEN, 0.2), N_AZURE, smoothstep(0.25, 0.95, height))
        hue = mix(hue, N_AZURE * 0.8, far * 0.6)
        hi = np.clip((val - 0.6) / 0.4, 0, 1) ** 1.3 * 0.9
        cn = np.where((val < 0.6)[..., None], mix(hue * 0.45, hue, val / 0.6), mix(hue, N_TEXT, hi))

        shade = 1 - face
        ink = np.clip(
            0.85 * np.exp(-depth / (10 * k)) * (0.55 + 0.45 * shade)
            + (0.35 + 0.55 * shade) * (0.55 + 0.6 * cun) * np.exp(-depth / (ly["mist"] * 1.6)),
            0,
            1,
        )
        dfade = 0.4 + 0.6 * smoothstep(base + 5, base - 80 * k, Y)  # day mist is thin: the peaks reach the water
        ad = np.clip(ink * dfade * (0.75 + 0.25 * ly["bright"]), 0, 1)
        lit_c = mix(mix(D_GREEN, D_BG, 0.3), mix(D_TEAL, D_BG, 0.3), smoothstep(0.3, 1, height))
        dark_c = mix(mix(D_FOREST, D_TEXT, 0.3), mix(D_AZURE, D_TEXT, 0.35), smoothstep(0.4, 1, height))
        cd = mix(lit_c, dark_c, np.clip(shade * 0.85 + np.exp(-depth / (8 * k)) * 0.4, 0, 1))
        cd = mix(cd, mix(D_AZURE, D_BG, 0.45), far * 0.6)
        return inside, val, cn, ad, cd

    def shore(self):
        """A low line of trees along the far shore, so the peaks stand on land, not on a gap."""
        base = Y_H
        broad = fbm(1, W, 90, self.rng, 4)[0]
        crowns = fbm(1, W, 7, self.rng, 2)[0]
        h = (12 + 46 * smoothstep(0.3, 0.8, broad)) * (0.6 + 0.8 * crowns)
        sl = self.box(0, W, base - 90, base + 90)
        X, Y = self.X[sl], self.Y[sl]
        xi = np.clip(X.astype(int), 0, W - 1)
        top = base - h[xi]
        land = (Y > top) & (Y <= base + 2)
        edge = np.exp(-(Y - top) / 4)
        leaf = self.veg[sl]
        cd = mix(mix(D_FOREST, D_TEXT, 0.25), mix(D_GREEN, D_BG, 0.2), np.clip(edge * 0.7 + leaf * 0.3, 0, 1))
        self.day.put(sl, land, np.clip(0.55 + 0.4 * leaf, 0, 1), cd)
        moon = smoothstep(-900, 300, X - MX) * smoothstep(1400, 300, np.abs(X - MX))  # nearer the moon, brighter
        self.night.put(
            sl,
            land,
            0.1 + 0.08 * leaf + 0.35 * edge * (0.3 + 0.7 * moon),
            mix(N_TEAL * 0.6, mix(N_TEAL, N_TEXT, 0.35), edge),
        )
        # Its reflection.
        ry = 2 * base - Y
        refl = (Y > base + 2) & (ry > base - h[np.clip((X + self.dx[sl]).astype(int), 0, W - 1)])
        lines = self.lines[sl]
        self.day.put(sl, refl, 0.5 * (1 - 0.6 * lines), mix(D_FOREST, D_TEAL, 0.4))
        self.night.put(sl, refl, 0.07 * (1 - 0.5 * lines), N_TEAL * 0.6)

    def light_on_water(self):
        """The moon's (or sun's) path lies on the surface, over the reflections."""
        sl = self.box(MX - 700, MX + 700, Y_H, H)
        X, t = self.X[sl], self.t[sl]
        rip, lines, dx = self.rip[sl], self.lines[sl], self.dx[sl]
        path = np.exp(-(((X - MX - dx * 2) / (24 + 300 * t)) ** 2)) * (1 - 0.3 * t) * smoothstep(0.08, 0.25, t)
        sparkle = path * smoothstep(0.42, 0.72, rip + 0.2 * lines)
        m = sparkle > 0.03
        self.night.under(
            sl,
            m,
            np.clip(sparkle * 1.05, 0, 1),
            mix(N_GOLD, N_TEXT, 0.45 * sparkle),
            glow=np.clip(sparkle - 0.3, 0, 1) * 0.5,
        )
        self.day.a[sl] *= 1 - 0.8 * sparkle
        amber = sparkle * smoothstep(0.55, 0.8, rip)
        self.day.put(sl, amber > 0.25, amber * 0.8, mix(N_AMBER, D_BG, 0.2))


def draw(grain=False):
    """The landscape by night and by day, as RGB images. The app lays its own grain over the day's."""
    s = Landscape()
    s.sky()
    s.moon_and_sun()
    s.geese()
    s.river()
    s.peaks()
    s.shore()
    s.light_on_water()
    return render(s.night, True), render(s.day, False, grain)
