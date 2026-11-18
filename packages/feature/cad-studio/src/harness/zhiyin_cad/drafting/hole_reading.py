"""
A hole read from the part's solid, as its callout writes it: the faces round
one axis that open from a face of the part, a counterbore or a countersink
at its mouth, the drilled bore, how deep it goes or that it goes through, and
its thread where bd_warehouse's hole classes made it. A hole is read along
the axis of the circle a view shows end on, so what the callout says is what
the solid holds, never what was asked.
"""

import math

import build123d as bd
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Pnt
from OCP.TopAbs import TopAbs_OUT

from .. import bom_record
from ..measure import bore

# How near, in mm, a face's axis lies to the hole's to be on it, and two faces' ends to meet.
ON_AXIS = 1e-3
MEETS = 1e-3
# How near a recorded hole's axis lies to the one read, in mm, to be the hole bd_warehouse made.
RECORDED = 1e-2
# How far past a hole's end, in mm, the solid is looked into for whether it opens there.
PAST = 1e-2


class Unread(Exception):
    """What a callout points at is no hole the solid holds, said so the model can mend it."""


def _cone(face, direction):
    """A cone's two ends along `direction` as (along, radius), and whether it faces its axis as a hole's wall does."""
    surface = BRepAdaptor_Surface(face.wrapped)
    cone = surface.Cone()
    axis = cone.Axis()
    foot = bd.Vector(axis.Location().X(), axis.Location().Y(), axis.Location().Z())
    way = bd.Vector(axis.Direction().X(), axis.Direction().Y(), axis.Direction().Z()).normalized()
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face.wrapped)
    ends = []
    for v in (v0, v1):
        p = surface.Value((u0 + u1) / 2, v)
        point = bd.Vector(p.X(), p.Y(), p.Z())
        away = point - foot
        ends.append((point.dot(direction), (away - way * away.dot(way)).length, point))
    middle = surface.Value((u0 + u1) / 2, (v0 + v1) / 2)
    m = bd.Vector(middle.X(), middle.Y(), middle.Z())
    away = m - foot
    radial = away - way * away.dot(way)
    faces_in = radial.length > 1e-9 and radial.dot(face.normal_at(m)) < 0
    return way, foot, ends, faces_in


def _on_axis(way, foot, origin, direction):
    if way.cross(direction).length > 1e-6:
        return False
    away = foot - origin
    return (away - direction * away.dot(direction)).length < ON_AXIS


def _pieces(shape, origin, direction):
    """The faces of a solid that wall a hole on this axis, each as (kind, start, end, radius at start, radius at end), start nearer the viewer."""
    pieces = []
    for face in shape.faces():
        kind = str(face.geom_type).rpartition(".")[2].lower()
        if kind == "cylinder":
            found = bore(face)
            if not found:
                continue
            way, foot = found["line"]
            if not _on_axis(way, foot, origin, direction):
                continue
            sign = 1.0 if way.dot(direction) > 0 else -1.0
            low, high = sorted(sign * v for v in found["span"])
            pieces.append(("bore", low, high, found["radius"], found["radius"]))
        elif kind == "cone":
            way, foot, ends, faces_in = _cone(face, direction)
            if not faces_in or not _on_axis(way, foot, origin, direction):
                continue
            (a, ra, _), (b, rb, _) = sorted(ends, key=lambda one: one[0])
            pieces.append(("cone", a, b, ra, rb))
    return pieces


def _outside(shape, point):
    classifier = BRepClass3d_SolidClassifier(shape.wrapped, gp_Pnt(point.X, point.Y, point.Z), 1e-7)
    return classifier.State() == TopAbs_OUT


def _chain(pieces, start):
    """The pieces that meet end to end with `start`, in order along the axis."""
    chain = [start]
    rest = [p for p in pieces if p is not start]
    grown = True
    while grown:
        grown = False
        for piece in list(rest):
            if abs(piece[1] - chain[-1][2]) < MEETS:
                chain.append(piece)
            elif abs(piece[2] - chain[0][1]) < MEETS:
                chain.insert(0, piece)
            else:
                continue
            rest.remove(piece)
            grown = True
    return chain


def _thread_text(record):
    thread = record["thread"]
    if thread is None:
        return None
    if thread["metric"]:
        return f"M{_n(thread['diameter'])}×{_n(thread['pitch'])}-6H"
    size = record["fastener"].rpartition(" ")[2]
    return f"{size} UN-2B"


def _n(value):
    from .dimensions import number

    return number(value)


def read(shapes, origin, direction, radius):
    """
    The hole on the axis through `origin` along `direction`, the way the
    view looks, whose wall or mouth is `radius` mm round: its callout's text
    and what the answer says of it. Raises Unread when there is none.
    """
    origin, direction = bd.Vector(origin), bd.Vector(direction).normalized()
    for shape in shapes:
        for solid in shape.solids():
            pieces = _pieces(solid, origin, direction)
            start = next((p for p in pieces if abs(p[3] - radius) < 1e-4 * max(1.0, radius) or abs(p[4] - radius) < 1e-4 * max(1.0, radius)), None)
            if start is None:
                continue
            return _described(solid, _chain(pieces, start), origin, direction)
    raise Unread("no hole of the part lies on that circle's axis; a callout points at a hole seen end on, by its circle or its centre")


def _described(solid, chain, origin, direction):
    along = origin.dot(direction)
    at = lambda s: origin + direction * (s - along)
    top, bottom = chain[0][1], chain[-1][2]
    open_top, open_bottom = _outside(solid, at(top - PAST)), _outside(solid, at(bottom + PAST))
    if not (open_top or open_bottom):
        raise Unread("the circle there is of a hollow closed inside the part, no hole opening from a face of it")
    main_radius = min(p[3] for p in chain if p[0] == "bore") if any(p[0] == "bore" for p in chain) else None
    wide = lambda radius: main_radius is not None and radius > main_radius + 1e-9
    # A hole is entered from the side it opens to; going right through, from
    # the side of its counterbore or countersink, else the viewer's.
    reverse = (open_bottom and not open_top) or (open_top and open_bottom and wide(chain[-1][4]) and not wide(chain[0][3]))
    if reverse:
        chain = [(kind, -end, -start, r_end, r_start) for kind, start, end, r_start, r_end in reversed(chain)]
        entry = -bottom
    else:
        entry = top
    through = open_top and open_bottom
    bores = [p for p in chain if p[0] == "bore"]
    if not bores:
        raise Unread("the circle there is of a cone alone, no bore")
    main = min(bores, key=lambda p: p[3])
    first = chain[0]
    counterbore = countersink = None
    if first[0] == "bore" and first is not main and first[3] > main[3] + 1e-9:
        counterbore = (2 * first[3], first[2] - entry)
    elif first[0] == "cone" and first[3] > first[4] + 1e-9:
        countersink = (2 * first[3], 2 * math.degrees(math.atan2(first[3] - first[4], first[2] - first[1])))
    depth = main[2] - entry
    tip = chain[-1] if chain[-1][0] == "cone" and chain[-1][4] < 1e-6 else None
    record = _recorded(origin, direction, 2 * main[3])
    thread = _thread_text(record) if record and record["kind"] in ("tapped", "threaded") else None
    reach = "THRU" if through else f"↧{_n(depth)}"
    text = f"{thread} {reach}" if thread else f"Ø{_n(2 * main[3])} {reach}"
    if counterbore:
        text += f" ⌴Ø{_n(counterbore[0])} ↧{_n(counterbore[1])}"
    if countersink:
        text += f" ⌵Ø{_n(countersink[0])}×{_n(countersink[1])}°"
    said = [f"drilled Ø{_n(2 * main[3])}" + (" right through" if through else f", {_n(depth)} deep from its face")]
    if tip is not None:
        said.append(f"to a drill point of {_n(2 * math.degrees(math.atan2(tip[3], tip[2] - tip[1])))}°")
    if counterbore:
        said.append(f"counterbored Ø{_n(counterbore[0])}, {_n(counterbore[1])} deep")
    if countersink:
        said.append(f"countersunk Ø{_n(countersink[0])} at {_n(countersink[1])}°")
    if reverse:
        said.append("entered from the far side of the view")
    if thread:
        said.append(
            f"threaded {thread.rpartition('-')[0]} as bd_warehouse's {'TapHole' if record['kind'] == 'tapped' else 'ThreadedHole'} made it, "
            f"its class {thread.rpartition('-')[2]} the standard's medium fit, as the model holds none"
        )
    elif record:
        said.append(f"made by bd_warehouse for {record['fastener']}, unthreaded")
    else:
        said.append(
            "no thread is known of it: a hole tapped with bd_warehouse's TapHole or ThreadedHole in a BuildPart, "
            "and not moved after, is written with its thread"
        )
    return {"text": text, "diameter": 2 * main[3], "said": ", ".join(said), "point": at(-entry if reverse else entry)}


def _recorded(centre, direction, diameter):
    """The hole bd_warehouse recorded on this axis, of this drilled diameter, or nothing."""
    for one in bom_record.holes():
        way = bd.Vector(*one["way"]).normalized()
        if way.cross(direction).length > 1e-6:
            continue
        away = bd.Vector(*one["at"]) - centre
        if (away - direction * away.dot(direction)).length > RECORDED:
            continue
        if one["drilled"] is not None and abs(one["drilled"] - diameter) > 1e-3:
            continue
        return one
    return None
