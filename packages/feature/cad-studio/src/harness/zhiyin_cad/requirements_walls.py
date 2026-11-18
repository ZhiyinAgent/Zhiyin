"""
How a part's wall spreads about its nominal: its thickest section, that
section against the nominal, and how much of its surface lies outside a band
about the nominal, for a moulding's sinks and warp or a print's or a
milling's even walls alike. Thickness is read at points spread over the
surface by area, two ways, as the build's own check of the way a part is
made reads it: the largest ball inside the part touching the surface there,
and straight in. A point is thin when straight in is, and thick when the
ball is, so a corner of even walls, whose ball is larger than the walls,
and the top of a rib, where straight in runs down the rib, read as the
walls they are. Its wall there is the reading of the two nearest the
nominal. Each limit answers its margin, and the worst of them is the
requirement's.
"""

import math

import numpy

from . import thickness
from .unchecked import Unchecked
from .words import mm as _mm
from .words import point as _at

# How many points of the surface the spread is read at.
POINTS = thickness.PROBES
# The walls the answer's spread of thicknesses gives, as shares of the nominal, each the upper end of a band.
SPREAD = (0.5, 0.75, 0.9, 1.1, 1.25, 1.5, 2.0)


def _spread_words(walls, nominal):
    """The share of the surface in each band of the nominal, the bands holding none left out."""
    edges = [0.0, *(share * nominal for share in SPREAD), math.inf]
    said = []
    for low, high in zip(edges, edges[1:]):
        share = 100 * float(((walls >= low) & (walls < high)).mean())
        if share < 0.5:
            continue
        band = f"under {_mm(high)}" if low == 0 else f"over {_mm(low)}" if high == math.inf else f"{_mm(low)} to {_mm(high)}"
        said.append(f"{share:.0f}% {band} mm")
    return ", ".join(said)


def _steepest(points, walls, spacing):
    """The steepest change of wall between neighbouring points: how much over how far, and where."""
    from scipy.spatial import cKDTree

    pairs = cKDTree(points).query_pairs(2.5 * spacing, output_type="ndarray")
    if not len(pairs):
        return None
    apart = numpy.linalg.norm(points[pairs[:, 0]] - points[pairs[:, 1]], axis=1)
    keep = apart >= spacing / 2
    if not keep.any():
        return None
    pairs, apart = pairs[keep], apart[keep]
    change = numpy.abs(walls[pairs[:, 0]] - walls[pairs[:, 1]])
    k = int(numpy.argmax(change / apart))
    if change[k] < 1e-3:
        return None
    return float(change[k]), float(apart[k]), (points[pairs[k, 0]] + points[pairs[k, 1]]) / 2


def spread(name, shape, asked):
    """
    The wall's limits other than its thinnest, measured on one part: each
    limit's margin, its unit and the limit, and the words of what was
    measured.
    """
    points, normals, ball, across, faces = thickness.thicknesses(shape, POINTS)
    if len(points) < 10:
        raise Unchecked(f"too few points of {name}'s walls could be measured")
    nominal = asked.get("nominal") or thickness.nominal_wall(shape, ball, faces)
    # Among points of the surface a ball reads large where they are sparse, as along a corner's edge: each
    # reading thick is measured again on the exact faces, and one that does not fit there reads at the limit.
    balls = thickness.Balls(shape)
    thick_from = nominal + asked["band"] if asked.get("band") is not None else nominal * SPREAD[3]
    for k in numpy.flatnonzero(ball > thick_from + 1e-6):
        if not balls.over(faces[k], points[k], normals[k], thick_from + 1e-6):
            ball[k] = thick_from
    walls = numpy.clip(nominal, ball, across)
    margins = []
    said = [f"{name}'s wall is {_mm(nominal)} mm nominal{' as asked' if asked.get('nominal') else ', over its largest faces'}"]
    if asked.get("max") is not None or asked.get("ratio") is not None:
        k = int(numpy.argmax(walls))
        thickest = float(walls[k])
        if ball[k] >= thickest - 1e-9:
            thickest = balls.largest(faces[k], points[k], normals[k], thickest + 2 * thickness.tolerance(shape))
        said.append(f"its thickest section is {_mm(thickest)} mm across, at {_at(points[k])}")
        if asked.get("max") is not None:
            margins.append((asked["max"] - thickest, "mm", asked["max"]))
            said[-1] += f", where at most {_mm(asked['max'])} mm is asked"
        if asked.get("ratio") is not None:
            limit = asked["ratio"] * nominal
            margins.append((limit - thickest, "mm", limit))
            said.append(f"{_mm(thickest / nominal)} times the nominal, where at most {_mm(asked['ratio'])} ({_mm(limit)} mm) is asked")
    if asked.get("band") is not None:
        band = asked["band"]
        low, high = nominal - band, nominal + band
        thin, thick = across < low, ball > high
        share = 100 * float((thin | thick).mean())
        allowed = asked.get("outside", 0)
        margins.append((allowed - share, "% of its surface", max(allowed, 1.0)))
        where = []
        for label, chosen, extreme in (("thinner", thin, numpy.argmin), ("thicker", thick, numpy.argmax)):
            if chosen.any():
                index = numpy.flatnonzero(chosen)
                k = index[extreme(walls[index])]
                where.append(f"{100 * chosen.mean():.1f}% {label}, to {_mm(walls[k])} mm at {_at(points[k])}")
        said.append(
            f"{share:.1f}% of its surface lies outside {_mm(low)} to {_mm(high)} mm"
            + (f" ({'; '.join(where)})" if where else "")
            + f", where at most {allowed:g}% is asked"
        )
    said.append(f"its walls over its surface: {_spread_words(walls, nominal)}")
    spacing = math.sqrt(shape.area / len(points))
    steepest = _steepest(points, walls, spacing)
    if steepest is not None:
        change, apart, at = steepest
        said.append(f"its wall changes most steeply by {_mm(change)} mm over {_mm(apart)} mm, at {_at(at)}")
    said.append(f"read at {len(points)} points about {_mm(spacing)} mm apart")
    return margins, "; ".join(said)
