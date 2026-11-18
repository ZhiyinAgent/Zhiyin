"""
The forms a part's exact faces make that a way of making sets limits on:
its inner corners, its ribs, its bends and the walls of its round holes. The
requirement kinds and the checks a build makes unasked both measure these,
so each is found one way.

Each measure takes a `deadline`, a time.time() value: past it, the measure
stops and answers what it found, with what it did not look at in `left`.
"""

import math
import time

import build123d as bd
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepOffset import BRepOffset_Analyse
from OCP.BRepTools import BRepTools
from OCP.ChFiDS import ChFiDS_TypeOfConcavity
from OCP.collections import IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher as EdgeFaces
from OCP.GeomAbs import GeomAbs_CurveType, GeomAbs_SurfaceType
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS

from . import measure

# Faces this far from parallel, in degrees, are taken as parallel.
PARALLEL = 1.0
# How far from opposite a rib's two sides may lean, in degrees, as drafted ones do.
RIB_LEAN = 10.0
# A rib runs at least this many times its thickness along its top; a pad or a boss does not.
RIB_LONG = 3.0
# Lengths closer than this, in mm, are the same.
NEAR = 1e-4
# Places of a millimetre to which two flat faces on one plane agree.
PLANE_PLACES = 4

# How the kernel tells an edge turns between its two faces, as a word. Mixed
# is two freeform faces whose edge turns in at places and out at others; the
# kernel gives the rest, free bound and other, to an edge of one face only.
_TURNS = {
    ChFiDS_TypeOfConcavity.ChFiDS_Concave: "concave",
    ChFiDS_TypeOfConcavity.ChFiDS_Convex: "convex",
    ChFiDS_TypeOfConcavity.ChFiDS_Tangential: "smooth",
    ChFiDS_TypeOfConcavity.ChFiDS_Mixed: "mixed",
}


class Measured(list):
    """What a measure found; `left` names what it had no time to look at, or is None when it looked at everything."""

    left = None


def _measured(found, done, total, what):
    result = Measured(found)
    if done < total:
        result.left = f"{total - done} of its {total} {what}"
    return result


def _late(deadline):
    return deadline is not None and time.time() > deadline


class Faces:
    """A part's faces and edges: which faces meet at each edge, and how the edge turns there."""

    def __init__(self, shape):
        self.shape = shape
        self.analysis = BRepOffset_Analyse(shape.wrapped, math.radians(PARALLEL))
        self.faces_of = EdgeFaces()
        TopExp.MapShapesAndAncestors_s(shape.wrapped, TopAbs_EDGE, TopAbs_FACE, self.faces_of)

    def count(self):
        return self.faces_of.Extent()

    def edges(self, deadline=None):
        """
        Each edge between two faces, with its two faces and how it turns:
        concave, convex, smooth, or mixed where it turns in at places and out
        at others; never smooth unless the kernel finds the faces tangent.
        Past the deadline it stops; `done` says how many edges it looked at.
        """
        self.done = 0
        for k in range(1, self.faces_of.Extent() + 1):
            if _late(deadline):
                return
            self.done = k
            listed = self.faces_of.FindFromIndex(k)
            # An edge between two faces is listed once for each; a seam twice for its one face.
            if listed.Size() != 2 or listed.First().IsSame(listed.Last()):
                continue
            edge = TopoDS.Edge(self.faces_of.FindKey(k))
            stretches = self.analysis.Type(edge)
            if stretches.Size() == 0:
                continue
            # The kernel tells an edge between two faces in one stretch; Python's walk through a kernel list is slow.
            word = _TURNS.get(stretches.First().Type(), "other")
            yield bd.Edge(edge), [bd.Face(TopoDS.Face(listed.First())), bd.Face(TopoDS.Face(listed.Last()))], word


def line(edge):
    """An edge's direction when it is straight, or None."""
    curve = BRepAdaptor_Curve(edge.wrapped)
    if curve.GetType() != GeomAbs_CurveType.GeomAbs_Line:
        return None
    d = curve.Line().Direction()
    return bd.Vector(d.X(), d.Y(), d.Z())


def plane(face):
    """A planar face's outward normal and a point on it, or None."""
    if BRepAdaptor_Surface(face.wrapped).GetType() != GeomAbs_SurfaceType.GeomAbs_Plane:
        return None
    middle = face.position_at(0.5, 0.5)
    return face.normal_at(middle), middle


def cylinder(face):
    """A cylindrical face's axis direction, a point on its axis and its radius, or None."""
    surface = BRepAdaptor_Surface(face.wrapped)
    if surface.GetType() != GeomAbs_SurfaceType.GeomAbs_Cylinder:
        return None
    found = surface.Cylinder()
    axis = found.Axis()
    d, p = axis.Direction(), axis.Location()
    return bd.Vector(d.X(), d.Y(), d.Z()), bd.Vector(p.X(), p.Y(), p.Z()), found.Radius()


def parallel(a, b, degrees=PARALLEL):
    return abs(a.normalized().dot(b.normalized())) >= math.cos(math.radians(degrees))


def distance(a, b):
    found = BRepExtrema_DistShapeShape(a.wrapped, b.wrapped)
    found.Perform()
    return found.Value() if found.IsDone() else math.inf


def _points(shape):
    """The corners of a face or an edge, as (x, y, z): plain numbers, as many corners are summed."""
    found = []
    corners = TopExp_Explorer(shape.wrapped, TopAbs_VERTEX)
    while corners.More():
        p = BRep_Tool.Pnt_s(TopoDS.Vertex(corners.Current()))
        found.append((p.X(), p.Y(), p.Z()))
        corners.Next()
    return found


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _walls(shape, deadline=None):
    """
    Each concave cylindrical face of a part with its bore, and whether it goes
    all the way round with the faces on its line; with how many of its round
    faces it looked at before the deadline.
    """
    rounds = shape.faces().filter_by(bd.GeomType.CYLINDER)
    bores = []
    for k, face in enumerate(rounds):
        if _late(deadline):
            return [], k, len(rounds)
        if found := measure.bore(face):
            bores.append((found, face))
    found = []
    for wall, face in bores:
        whole = wall["turn"][1] >= measure.FULL_TURN
        if not whole:
            round_with = [o["turn"] for o, _ in bores if abs(o["radius"] - wall["radius"]) < NEAR and measure.same_line(o["line"], wall["line"])]
            whole = measure.covered(round_with) >= measure.FULL_TURN
        found.append((wall, face, whole))
    return found, len(rounds), len(rounds)


def inner_corners(shape, along=None, *, deadline=None):
    """
    Each inner corner of a part: a concave edge where two faces meet at an
    angle, of radius 0, and each concave cylindrical face that rounds one
    without going all the way round, as a hole's wall does, with its radius.
    With `along`, only corners whose line or axis runs along it, as those a
    cutter on that axis leaves. Each is its radius, a point on it, and its
    depth: a sharp edge's length, or how far a round one runs along its axis.
    """
    corners = []
    faces = Faces(shape)
    for edge, _, word in faces.edges(deadline):
        if word != "concave":
            continue
        if along is not None:
            direction = line(edge)
            if direction is None or not parallel(direction, along):
                continue
        corners.append({"radius": 0.0, "at": edge.position_at(0.5), "depth": edge.length})
    if faces.done < faces.count():
        return _measured(corners, faces.done, faces.count(), "edges")
    walls, done, total = _walls(shape, deadline)
    for wall, face, whole in walls:
        direction, _ = wall["line"]
        if whole or (along is not None and not parallel(direction, along)):
            continue
        corners.append({"radius": wall["radius"], "at": face.position_at(0.5, 0.5), "depth": wall["span"][1] - wall["span"][0]})
    return _measured(corners, done, total, "round faces")


def hole_walls(shape, *, deadline=None):
    """The walls of a part's round holes, faces going all the way round together: each face, its radius and the middle of its axis."""
    found = []
    walls, done, total = _walls(shape, deadline)
    for wall, face, whole in walls:
        if not whole:
            continue
        direction, foot = wall["line"]
        found.append({"face": face, "radius": wall["radius"], "at": foot + direction * ((wall["span"][0] + wall["span"][1]) / 2)})
    return _measured(found, done, total, "round faces")


def _plane_key(normal, point):
    """The plane a flat face lies on, the same for every face on it."""
    return tuple(round(v, PLANE_PLACES) for v in (normal.X, normal.Y, normal.Z, normal.dot(point)))


def ribs(shape, *, deadline=None):
    """
    A part's ribs: each a flat-topped wall standing out from a face, much
    longer along its top than it is thick and at least as tall as it is
    thick, as a pad or a boss is not. Its top is a planar face; its two sides
    are the nearest opposite planes that turn down from the top at convex
    edges and end where the part goes on, at a concave edge or into a rounded
    root. A part's own edge, whose sides end at more convex edges, is no rib.
    Its height is how far it stands out of the face it rises from: the
    shorter of its two sides, so a lip flush with a wall stands out of the
    rim it is on, not the wall it shares a face with. A side two tops share,
    as a rib's end does where it meets another rib, belongs to the rib with
    the larger top, the one it runs along. Each is its thickness at the root,
    its height, the middle of its root on its shorter side, the way it stands
    out, and the way that side faces.
    """
    faces = Faces(shape)
    beside = {}
    for edge, pair, word in faces.edges(deadline):
        for one, other in ((pair[0], pair[1]), (pair[1], pair[0])):
            beside.setdefault(hash(one), (one, []))[1].append((other, edge, word))
    if faces.done < faces.count():
        return _measured([], faces.done, faces.count(), "edges")

    planes, corners = {}, {}

    def plane_of(face):
        key = hash(face)
        if key not in planes:
            planes[key] = plane(face)
        return planes[key]

    def points_of(face):
        key = hash(face)
        if key not in corners:
            corners[key] = _points(face)
        return corners[key]

    def depth(face, top, normal):
        """How far a face reaches below a plane through `top`, square to `normal`."""
        level, way = top.dot(normal), tuple(normal)
        return max(level - _dot(p, way) for p in points_of(face))

    def root_of(side, top, normal):
        """Where a side ends below the top: its reach and its lowest edges, or None when the part ends there other than at a root."""
        low = []
        deepest = depth(side, top, normal)
        reach = deepest
        for other, edge, word in beside[hash(side)][1]:
            at = edge.position_at(0.5)
            if (top - at).dot(normal) < deepest - NEAR:
                continue
            if word not in ("concave", "smooth"):
                return None
            if word == "smooth":
                # A rounded root flares out from the side to the face the rib
                # stands on; a round that bends back in is the part's own rounded edge.
                if (other.position_at(0.5, 0.5) - at).dot(plane_of(side)[0]) <= NEAR:
                    return None
                reach = max(reach, depth(other, top, normal))
            low.append(edge)
        return (reach, low) if low else None

    candidates = []
    tops = list(beside.values())
    for k, (top, around) in enumerate(tops):
        if _late(deadline):
            return _measured(_kept(candidates), k, len(tops), "faces")
        flat = plane_of(top)
        if flat is None:
            continue
        normal, middle = flat
        # The sides turning down from the top, by the plane each lies on.
        sides = {}
        for other, edge, word in around:
            if word != "convex" or line(edge) is None:
                continue
            side = plane_of(other)
            if side is None or abs(side[0].dot(normal)) > math.sin(math.radians(RIB_LEAN)):
                continue
            key = _plane_key(*side)
            sides.setdefault(key, {"normal": side[0], "point": side[1], "faces": {}})["faces"][hash(other)] = other
        paired, area = set(), None
        for key, a in sides.items():
            facing = sorted(
                (gap, other_key)
                for other_key, b in sides.items()
                if a["normal"].dot(b["normal"]) < -math.cos(math.radians(2 * RIB_LEAN)) and (gap := (a["point"] - b["point"]).dot(a["normal"])) >= NEAR
            )
            # The nearest opposite side that lies beside it somewhere along the top.
            nearest = next(((other_key, length) for _, other_key in facing if (length := _overlap(_turned(a, a, normal, points_of), _turned(sides[other_key], a, normal, points_of))) > NEAR), None)
            if nearest is None or frozenset((key, nearest[0])) in paired:
                continue
            paired.add(frozenset((key, nearest[0])))
            rib = _rib(normal, middle, a, sides[nearest[0]], nearest[1], root_of)
            if rib is not None:
                area = top.area if area is None else area
                candidates.append({**rib, "top": area})
    return _measured(_kept(candidates), len(tops), len(tops), "faces")


def _stretch(faces, along, points_of):
    """The stretches along a direction that some faces cover, apart where they are apart, in order."""
    way = tuple(along)
    spans = sorted((min(reach), max(reach)) for face in faces if (reach := [_dot(p, way) for p in points_of(face)]))
    merged = []
    for low, high in spans:
        if merged and low <= merged[-1][1] + NEAR:
            merged[-1][1] = max(merged[-1][1], high)
        else:
            merged.append([low, high])
    return merged


def _turned(side, to, normal, points_of):
    """A side's stretches along the top, the way another side runs: opposite sides run opposite ways."""
    for one in (side, to):
        if "along" not in one:
            one["along"] = normal.cross(one["normal"]).normalized()
            one["stretch"] = _stretch(one["faces"].values(), one["along"], points_of)
    if side["along"].dot(to["along"]) > 0:
        return side["stretch"]
    return [[-high, -low] for low, high in reversed(side["stretch"])]


def _overlap(a, b):
    """How long the stretches of two sides lie beside each other: the length both cover."""
    total, i, j = 0.0, 0, 0
    while i < len(a) and j < len(b):
        total += max(0.0, min(a[i][1], b[j][1]) - max(a[i][0], b[j][0]))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return total


def _rib(normal, middle, a, b, length, root_of):
    """The rib two opposite sides of a top make, or None when they make none."""
    reached = []
    for side in (a, b):
        roots = [(found, face) for face in side["faces"].values() if (found := root_of(face, middle, normal))]
        if not roots:
            return None
        (reach, low), face = max(roots, key=lambda one: one[0][0])
        reached.append((reach, low, face, side))
    # It stands out of the face it rises from by its shorter side.
    reach, low, _, side = min(reached, key=lambda one: one[0])
    facing = b if side is a else a
    thickness = max(min(distance(edge, other) for other in facing["faces"].values()) for edge in low)
    if length < RIB_LONG * thickness or reach < thickness - NEAR:
        return None
    return {
        "rib": {"thickness": thickness, "height": reach, "at": low[0].position_at(0.5), "way": normal, "out": side["normal"]},
        "sides": set(a["faces"]) | set(b["faces"]),
    }


def _kept(candidates):
    """The ribs, each side kept by the rib with the larger top where two tops share it."""
    kept, taken = [], set()
    for one in sorted(candidates, key=lambda one: -one["top"]):
        if one["sides"] & taken:
            continue
        taken |= one["sides"]
        kept.append(one["rib"])
    return kept


def bends(shape, *, deadline=None):
    """
    A sheet's bends: each a pair of cylindrical faces on one axis, neither
    going all the way round, their radii a sheet's thickness apart: its
    inside radius, the thickness, its axis and its two faces.
    """
    rounds = []
    every = shape.faces().filter_by(bd.GeomType.CYLINDER)
    for k, face in enumerate(every):
        if _late(deadline):
            return _measured([], k, len(every), "round faces")
        u0, u1, _, _ = BRepTools.UVBounds_s(face.wrapped)
        if u1 - u0 >= measure.FULL_TURN:
            continue
        rounds.append((face, *cylinder(face)))
    found = []
    used = set()
    for i, (face, axis, foot, radius) in enumerate(rounds):
        if _late(deadline):
            return _measured(found, i, len(rounds), "part-turn round faces")
        for j, (other, axis2, foot2, radius2) in enumerate(rounds):
            if j <= i or i in used or j in used:
                continue
            offset = foot2 - foot
            if not parallel(axis, axis2) or (offset - axis * offset.dot(axis)).length > 1e-3:
                continue
            thickness = abs(radius2 - radius)
            if thickness < NEAR:
                continue
            inside, outside = (face, other) if radius < radius2 else (other, face)
            found.append({"radius": min(radius, radius2), "thickness": thickness, "axis": axis, "inside": inside, "outside": outside})
            used.update((i, j))
    return _measured(found, len(rounds), len(rounds), "part-turn round faces")


def flanges(shape, found, *, deadline=None):
    """Each flat running from one of the bends `found`: how far it reaches square to the bend, and a point on it."""
    rounds = {hash(b["inside"]) for b in found} | {hash(b["outside"]) for b in found}
    reached = []
    faces = Faces(shape)
    for edge, pair, word in faces.edges(deadline):
        if word != "smooth":
            continue
        for one, other in ((pair[0], pair[1]), (pair[1], pair[0])):
            if hash(one) not in rounds or plane(other) is None:
                continue
            direction = line(edge)
            if direction is None:
                continue
            start = edge.position_at(0.5)
            reach = 0.0
            for w in _points(other):
                w = bd.Vector(*w) - start
                reach = max(reach, (w - direction.normalized() * w.dot(direction.normalized())).length)
            reached.append((reach, other.position_at(0.5, 0.5)))
    return _measured(reached, faces.done, faces.count(), "edges")
