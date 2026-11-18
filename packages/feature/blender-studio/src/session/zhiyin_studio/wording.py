"""Sizes, places, areas, volumes, colours and choices in the words an answer gives them."""

import math
import re

# How many of the names objects share a count of them by stems gives; the rest are counted.
STEMS_SAID = 6


def one_of(names):
    """Names as a choice between them: a, b or c."""
    names = list(names)
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} or {names[-1]}"


def listed(names, most=None):
    """
    Names in a sentence: one, two joined by and, or a list ending in and: a, b and c. Past `most`,
    the first `most` and how many more: a, b and 3 more.
    """
    names = list(names)
    if most is not None and len(names) > most:
        names = names[:most] + [f"{len(names) - most} more"]
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def enumerated(names, most):
    """Names as a list, each after a comma: a, b, c; past `most`, the first `most` and how many more."""
    names = list(names)
    more = f" and {len(names) - most} more" if len(names) > most else ""
    return ", ".join(names[:most]) + more


def stems(names):
    """Names grouped by the name they share without a number at its end, as Rock 2 and Rock.003 share Rock."""
    found = {}
    for name in names:
        found.setdefault(re.sub(r"[\s._-]*\d+$", "", name) or name, []).append(name)
    return found


def stems_text(names):
    """Names by the name they share: “Rock ×37, Log”, past STEMS_SAID of them the rest counted."""
    grouped = list(stems(names).items())
    said = [f"{stem} ×{len(group)}" if len(group) > 1 else group[0] for stem, group in grouped[:STEMS_SAID]]
    more = len(grouped) - STEMS_SAID
    return ", ".join(said) + (f" and {more} more names" if more > 0 else "")


def in_brief(names):
    """Names in a sentence; past six, by the names they share."""
    names = list(names)
    return stems_text(names) if len(names) > 6 else listed(names)


def hex_of(rgba):
    def srgb(c):
        c = max(0.0, min(1.0, c))
        return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

    return "#" + "".join(f"{round(srgb(c) * 255):02x}" for c in rgba[:3])


def clean(value):
    """Less than a thousandth of a millimetre is arithmetic, not a size or a position."""
    value = float(value)
    return 0.0 if abs(value) < 1e-6 else value


def in_millimetres(metres):
    """Whether a length reads in millimetres: under 1000 once rounded, so 0.99999994 m reads 1 m."""
    return abs(float(f"{metres * 1000:.4g}")) < 1000


def length(metres):
    metres = clean(metres)
    return f"{metres * 1000:.4g} mm" if in_millimetres(metres) else f"{metres:.4g} m"


def area_text(square_metres):
    """An area in the unit that keeps it a plain number: mm², cm², then m²."""
    if square_metres < 1e-4:
        return f"{square_metres * 1e6:.4g} mm²"
    if square_metres < 1:
        return f"{square_metres * 1e4:.4g} cm²"
    return f"{square_metres:.4g} m²"


def volume_text(cubic_metres):
    """A volume in the unit that keeps it a plain number: cm³, litres, then m³."""
    if cubic_metres < 1e-3:
        return f"{cubic_metres * 1e6:.4g} cm³"
    if cubic_metres < 1:
        return f"{cubic_metres * 1e3:.4g} L"
    return f"{cubic_metres:.4g} m³"


def size_text(values):
    values = [clean(v) for v in values]
    if in_millimetres(max(abs(v) for v in values)):
        return " × ".join(f"{v * 1000:.4g}" for v in values) + " mm"
    return " × ".join(f"{v:.4g}" for v in values) + " m"


def point_text(values):
    values = [clean(v) for v in values]
    if in_millimetres(max(abs(v) for v in values)):
        return "(" + ", ".join(f"{v * 1000:.4g}" for v in values) + " mm)"
    return "(" + ", ".join(f"{v:.4g}" for v in values) + " m)"


def turned_text(obj):
    """How an object is turned in the world, or nothing when it is not."""
    # To a hundredth of a degree: what is left beyond is arithmetic, not a turn.
    turned = [round(math.degrees(a), 2) + 0.0 for a in obj.matrix_world.decompose()[1].to_euler()]
    return "turned (" + ", ".join(f"{a:g}°" for a in turned) + ")" if any(turned) else None
