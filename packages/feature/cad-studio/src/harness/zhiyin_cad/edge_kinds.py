"""
A part's outside edges by kind: how many are sharp, how many rounded and how
many chamfered, measured from its exact faces. Inside edges, where the part's
faces meet in a hollow, as a pocket's floor and corners, are not counted.

An edge is outside where its two faces meet at a convex angle, the material
between them less than a half turn. It is sharp when the surface turns there
by more than SHARP degrees: less than that, as between the sides of a polygon
of twelve or more, reads in a picture as a crease, not a corner. A round is
a curved face that runs smoothly into at least two flatter faces, as a
fillet does along its two sides; a curved face that only runs into ones more curved than
it, as a bar's side between the fillets at its ends, is the part's own shape.
Where three rounds meet at a corner, the patch between them is no round of
its own. A chamfer is a narrow flat or conical face set between two wider
faces at a shallow angle to each, as a chamfered edge leaves it; a facet
whose neighbours are all chamfers, at a corner where three meet, is none.
An edge a round or a chamfer bounds is counted with that face, not as sharp
of its own.
"""

import math

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Curve2d, BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepTools import BRepTools
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Plane
from OCP.gp import gp_Pnt, gp_Pnt2d, gp_Vec
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS

# More than this turn of the surface across an edge, in degrees, is a corner.
SHARP = 30.0
# Below what the kernel's normals can tell apart, in degrees: a dodecagon's sides turn by 30 exactly.
ANGLE_NOISE = 0.01
# Less than this, in degrees, two faces run into each other smoothly.
SMOOTH = 1.0
# A chamfer meets each of its two neighbours at a turn between these, in degrees.
CHAMFER_TURN = (5.0, 80.0)
# A chamfer is at most this share of the width of each face it lies between.
CHAMFER_WIDTH = 0.5
# A round is more curved than the faces it runs into by at least this share.
FLATTER = 0.9
# A face curved less than this, per mm, is flat for these counts.
FLAT_CURVATURE = 1e-6


class _Face:
    """One face of the part, with what the counts need of it, worked out when first asked."""

    def __init__(self, face):
        self.face = face
        self.surface = BRepAdaptor_Surface(face)
        self.reversed = face.Orientation() == TopAbs_REVERSED
        self.kind = self.surface.GetType()
        self._bend = None
        self._area = None

    def normal(self, u, v):
        """The face's outward normal at (u, v), or None where it has none."""
        props = BRepLProp_SLProps(self.surface, u, v, 1, 1e-9)
        if not props.IsNormalDefined():
            return None
        n = props.Normal()
        return gp_Vec(-n.X(), -n.Y(), -n.Z()) if self.reversed else gp_Vec(n.X(), n.Y(), n.Z())

    def bend(self):
        """
        How curved the face is at its middle, per mm, its sharpest way:
        positive where it bulges out of the part, as a ball's face, negative
        where it hollows in, as a hole's wall.
        """
        if self._bend is None:
            self._bend = 0.0 if self.kind == GeomAbs_Plane else self._curvature()
        return self._bend

    def _curvature(self):
        try:
            u0, u1, v0, v1 = BRepTools.UVBounds_s(self.face)
            props = BRepLProp_SLProps(self.surface, (u0 + u1) / 2, (v0 + v1) / 2, 2, 1e-9)
            if not props.IsCurvatureDefined():
                return 0.0
            sharpest = max(props.MaxCurvature(), props.MinCurvature(), key=abs)
        except Exception:  # noqa: BLE001 - a face the kernel cannot evaluate counts as flat
            return 0.0
        # The kernel's curvature is positive where the face bends toward its surface's normal.
        return sharpest if self.reversed else -sharpest

    def area(self):
        if self._area is None:
            props = GProp_GProps()
            BRepGProp.SurfaceProperties_s(self.face, props)
            self._area = props.Mass()
        return self._area


def _length(edge):
    props = GProp_GProps()
    BRepGProp.LinearProperties_s(edge, props)
    return props.Mass()


def _meeting(edge, sides):
    """
    How two faces meet along an edge, at its middle: the turn of the surface
    across it, in degrees, and whether it is convex; None where either face
    has no normal there.
    """
    curve = BRepAdaptor_Curve(edge)
    t = (curve.FirstParameter() + curve.LastParameter()) / 2
    at, tangent = gp_Pnt(), gp_Vec()
    curve.D1(t, at, tangent)
    if tangent.Magnitude() < 1e-12:
        return None
    found = []
    for face, oriented in sides:
        uv = gp_Pnt2d()
        BRepAdaptor_Curve2d(oriented, face.face).D0(t, uv)
        normal = face.normal(uv.X(), uv.Y())
        if normal is None:
            return None
        along = tangent.Reversed() if oriented.Orientation() == TopAbs_REVERSED else tangent
        # The face lies to the left of its edges, seen from outside.
        found.append((normal, normal.Crossed(along)))
    (first, into_first), (second, _) = found
    turn = math.degrees(first.Angle(second))
    return turn, into_first.Dot(second) < 0


def edges_by_kind(shape):
    """How many of a part's outside edges are sharp, how many rounded and how many chamfered."""
    face_map, edge_map = ShapeMap(), ShapeMap()
    TopExp.MapShapes_s(shape.wrapped, TopAbs_FACE, face_map)
    TopExp.MapShapes_s(shape.wrapped, TopAbs_EDGE, edge_map)
    faces = [_Face(TopoDS.Face(face_map.FindKey(i))) for i in range(1, face_map.Extent() + 1)]
    sides = {}
    for index, face in enumerate(faces):
        explorer = TopExp_Explorer(face.face, TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge(explorer.Current())
            sides.setdefault(edge_map.FindIndex(edge), []).append((index, edge))
            explorer.Next()
    # Each edge between two faces, with how they meet; a seam, where a face meets itself, is none.
    meetings = []
    for key, found in sides.items():
        if len(found) != 2 or found[0][0] == found[1][0]:
            continue
        edge = found[0][1]
        if BRep_Tool.Degenerated_s(edge):
            continue
        try:
            how = _meeting(edge, [(faces[i], oriented) for i, oriented in found])
        except Exception:  # noqa: BLE001 - an edge the kernel cannot evaluate is not counted
            continue
        if how is not None:
            meetings.append((key, found[0][0], found[1][0], *how))
    smooth = {i: set() for i in range(len(faces))}
    for _, a, b, turn, _convex in meetings:
        if turn < SMOOTH:
            smooth[a].add(b)
            smooth[b].add(a)
    rounds = set()
    for i, face in enumerate(faces):
        bend = abs(face.bend())
        if face.kind == GeomAbs_Plane or bend < FLAT_CURVATURE:
            continue
        if sum(1 for j in smooth[i] if abs(faces[j].bend()) < FLATTER * bend) >= 2:
            rounds.add(i)
    chamfers = _chamfers(faces, meetings, edge_map, rounds)
    rounded = sum(1 for i in rounds if faces[i].bend() > 0)
    sharp = sum(
        1
        for _, a, b, turn, convex in meetings
        if convex and turn > SHARP + ANGLE_NOISE and not ({a, b} & (rounds | chamfers))
    )
    return {"sharp": sharp, "rounded": rounded, "chamfered": len(chamfers)}


def _chamfers(faces, meetings, edge_map, rounds):
    """The faces that are chamfers: narrow, flat or conical, at a shallow convex turn to two wider faces."""
    low, high = CHAMFER_TURN
    rails = {}
    for key, a, b, turn, convex in meetings:
        if convex and low < turn < high:
            rails.setdefault(a, []).append((b, key))
            rails.setdefault(b, []).append((a, key))
    candidates = {}
    for i, these in rails.items():
        face = faces[i]
        if face.kind not in (GeomAbs_Plane, GeomAbs_Cone) or i in rounds or len({j for j, _ in these}) < 2:
            continue
        lengths = {key: _length(TopoDS.Edge(edge_map.FindKey(key))) for _, key in these}
        width = face.area() / max(lengths.values())
        wider = {j for j, key in these if lengths[key] > 0 and width < CHAMFER_WIDTH * faces[j].area() / lengths[key]}
        if len(wider) >= 2:
            candidates[i] = wider
    # A facet among chamfers alone, where three meet at a corner, is none of its own.
    return {i for i, wider in candidates.items() if len(wider - candidates.keys()) >= 2}
