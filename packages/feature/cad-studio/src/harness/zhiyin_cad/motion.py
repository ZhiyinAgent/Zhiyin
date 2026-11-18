"""
Where each part that moves is at each position a build is checked at, for
the 3D studio to key its parts by: how each part as built at a position is
moved from the part as built at the first, found from the part's own corners
and points along its edges, so it holds however the script placed it. The
edges' points fix how a round part turned: a plain shaft's corners all lie
on its axis's seam, and a quarter turn about the axis moves them as a slide
sideways would. A part stretched between positions, as a spring compressed,
is moved, turned and stretched; one that changes shape otherwise, or whose
points leave a turn open, is said.
"""

import json

import numpy
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GCPnts import GCPnts_AbscissaPoint

# How far, in mm, a part's points may stray from the move found for them.
FIT_OFF = 1e-3
# Below this, in mm or as a share, a move is no move.
STILL = 1e-7
# Where along each edge, as shares of its length, its points are taken.
ALONG = (0.25, 0.5, 0.75)


def _along(edge):
    """Points along an edge at the shares of its length ALONG names, in the curve's own direction; none for an edge of no length."""
    if BRep_Tool.Degenerated_s(edge.wrapped):
        return []
    curve = BRepAdaptor_Curve(edge.wrapped)
    start, end = curve.FirstParameter(), curve.LastParameter()
    length = GCPnts_AbscissaPoint.Length_s(curve)
    if length <= STILL:
        return []
    points = []
    for share in ALONG:
        found = GCPnts_AbscissaPoint(curve, share * length, start)
        at = curve.Value(found.Parameter() if found.IsDone() else start + share * (end - start))
        points.append((at.X(), at.Y(), at.Z()))
    return points


def corners(parts):
    """
    Each named part's points, by name: its corners in the order the kernel
    lists them, then points along each of its edges in their order, which a
    part keeps from one position to the next.
    """
    found = {}
    for name, shape in parts:
        if not name:
            continue
        points = [(v.X, v.Y, v.Z) for v in shape.vertices()]
        for edge in shape.edges():
            points += _along(edge)
        found[name] = numpy.array(points, dtype=float).reshape(-1, 3)
    return found


def _rigid(first, then):
    """The turn and move that take `first` onto `then` most closely, as a 4 × 4 matrix."""
    middle_a, middle_b = first.mean(axis=0), then.mean(axis=0)
    u, _, vt = numpy.linalg.svd((first - middle_a).T @ (then - middle_b))
    turn = (u @ vt).T
    if numpy.linalg.det(turn) < 0:
        vt[-1] *= -1
        turn = (u @ vt).T
    matrix = numpy.eye(4)
    matrix[:3, :3] = turn
    matrix[:3, 3] = middle_b - turn @ middle_a
    return matrix


def _affine(first, then):
    """The move, turn and stretch that take `first` onto `then` most closely, or nothing where the corners do not fix one."""
    given = numpy.hstack([first, numpy.ones((len(first), 1))])
    if numpy.linalg.matrix_rank(given) < 4:
        return None
    solved, *_ = numpy.linalg.lstsq(given, then, rcond=None)
    matrix = numpy.eye(4)
    matrix[:3, :] = solved.T
    return matrix


def _off(matrix, first, then):
    return float(numpy.abs((first @ matrix[:3, :3].T + matrix[:3, 3]) - then).max()) if len(first) else 0.0


def fitted(first, then):
    """How a part's points at a position are moved from the first's: a matrix, or why none fits."""
    if len(first) != len(then):
        return None, "it has other corners or edges at another position than at the first"
    if not len(first):
        return numpy.eye(4), None
    if numpy.linalg.matrix_rank(first - first.mean(axis=0), tol=FIT_OFF) < 2:
        # Every turn about that line fits them alike, so none is picked.
        return None, "its corners and edges all lie on one line, which leaves how it turns about that line open"
    matrix = _rigid(first, then)
    if _off(matrix, first, then) <= FIT_OFF:
        return matrix, None
    stretched = _affine(first, then)
    if stretched is not None and _off(stretched, first, then) <= FIT_OFF:
        return stretched, None
    return None, f"its corners and edges stray {_off(stretched if stretched is not None else matrix, first, then):.3g} mm from the nearest move, turn and stretch"


def write(path, positions, at_each, base=None, straight=False):
    """
    Writes the motion file: for each part that moves, its matrix at each
    position, row by row, in mm, from the part as built, which is the first
    position unless `base` gives its corners. A straight one, as an assembly
    sequence, has each part go straight from one position to the next.
    Answers how many parts move, how many stay put, and those that change
    shape, by name.
    """
    first = at_each[0] if base is None else base
    parts, unfitted, still = {}, {}, 0
    for name, corners_first in first.items():
        matrices = []
        for later in at_each:
            matrix, why = fitted(corners_first, later.get(name, numpy.empty((0, 3))))
            if matrix is None:
                unfitted[name] = why
                break
            matrices.append(matrix)
        if name in unfitted:
            continue
        if all(numpy.abs(m - numpy.eye(4)).max() <= STILL for m in matrices):
            still += 1
            continue
        parts[name] = [[round(float(v), 9) for v in m.flatten()] for m in matrices]
    with open(path, "w", encoding="utf-8") as out:
        json.dump(
            {
                "motion": 1,
                "positions": positions[: len(at_each)],
                "parts": parts,
                "unfitted": unfitted,
                "still": still,
                **({"straight": True} if straight else {}),
            },
            out,
        )
    return {"moving": len(parts), "still": still, "unfitted": unfitted, "positions": len(at_each)}
