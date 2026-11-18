"""
How far apart two colours look: CIEDE2000's colour difference between two sRGB colours, as a
viewer sees them on a screen. About 1 is the least a trained eye tells apart, 2 to 3 is seen side by
side, and past 5 they read as other colours.
"""

import math

# Past this, two colours read as other colours.
OTHER = 5


def to_lab(rgb):
    """An sRGB colour, each channel 0 to 255, in CIE L*a*b* under D65."""
    def linear(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(float(c)) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e(first, second):
    """CIEDE2000 between two sRGB colours, each channel 0 to 255."""
    return lab_difference(to_lab(first), to_lab(second))


def lab_difference(first, second):
    """CIEDE2000 between two colours in CIE L*a*b*."""
    l1, a1, b1 = first
    l2, a2, b2 = second
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    mean_c = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(mean_c**7 / (mean_c**7 + 25**7)))
    a1, a2 = a1 * (1 + g), a2 * (1 + g)
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    h1 = math.degrees(math.atan2(b1, a1)) % 360 if c1 else 0
    h2 = math.degrees(math.atan2(b2, a2)) % 360 if c2 else 0
    dl, dc = l2 - l1, c2 - c1
    dh = 0.0
    if c1 and c2:
        dh = h2 - h1
        if dh > 180:
            dh -= 360
        elif dh < -180:
            dh += 360
    big_dh = 2 * math.sqrt(c1 * c2) * math.sin(math.radians(dh / 2))
    mean_l, mean_c = (l1 + l2) / 2, (c1 + c2) / 2
    if c1 and c2:
        mean_h = (h1 + h2) / 2 if abs(h1 - h2) <= 180 else (h1 + h2 + 360) / 2 if h1 + h2 < 360 else (h1 + h2 - 360) / 2
    else:
        mean_h = h1 + h2
    t = (
        1
        - 0.17 * math.cos(math.radians(mean_h - 30))
        + 0.24 * math.cos(math.radians(2 * mean_h))
        + 0.32 * math.cos(math.radians(3 * mean_h + 6))
        - 0.20 * math.cos(math.radians(4 * mean_h - 63))
    )
    sl = 1 + 0.015 * (mean_l - 50) ** 2 / math.sqrt(20 + (mean_l - 50) ** 2)
    sc = 1 + 0.045 * mean_c
    sh = 1 + 0.015 * mean_c * t
    rt = -2 * math.sqrt(mean_c**7 / (mean_c**7 + 25**7)) * math.sin(math.radians(60 * math.exp(-(((mean_h - 275) / 25) ** 2))))
    return math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (big_dh / sh) ** 2 + rt * (dc / sc) * (big_dh / sh))
