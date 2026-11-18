"""
The smooth requirement: how a part's faces meet across their edges, as a
surface someone sees or touches is judged. Along each edge between two of
the faces checked, at points of its length, the two faces' outward normals
are compared (G1: tangent, within an angle), and, at level G2, their
curvature across the edge, square to it, each face's own (G2: alike, within
a share of the larger). A face meeting itself along a seam, as a
cylinder's does, is smooth there by its own surface and not checked. The
faces checked are the part's named surfaces given, or all of the part.
"""

import math

import numpy

from . import forms
from .unchecked import Unchecked
from .words import mm as _mm
from .words import point as _at

# The points along each edge, as shares of its length, its ends left out where faces meet others.
ALONG = (0.1, 0.3, 0.5, 0.7, 0.9)
# Below this curvature, in 1/mm (a radius of 10 m), a face is flat.
FLAT = 1e-4
# The defaults: the angle in degrees two faces may turn by, and the share curvature may jump by.
ANGLE = 0.5
CURVATURE = 0.1
# At most how many edges past the limit the answer names.
PLACES = 4


def _faces_of(name, shape, asked, named):
    """The part as shown and the faces checked: those of the named surfaces asked, or every face."""
    wanted = asked.get("surfaces")
    if not wanted:
        return shape, list(shape.faces())
    held, groups = named.get(name, (None, {}))
    missing = [one for one in wanted if one not in groups]
    if missing:
        names = ", ".join(groups) or "none"
        raise Unchecked(f"{name} has no named surface {', '.join(missing)}; its named surfaces are {names}")
    shape = held if held is not None else shape
    faces = list(shape.faces())
    return shape, [faces[k] for one in wanted for k in groups[one] if k < len(faces)]


def _edges_between(shape, faces):
    """Each edge of the part between two different faces of those checked, with the two faces."""
    chosen = [face.wrapped for face in faces]
    return [
        (edge, a, b)
        for edge, (a, b), _ in forms.Faces(shape).edges()
        if all(any(face.wrapped.IsSame(c) for c in chosen) for face in (a, b))
    ]


def _surface_at(face, point):
    """A face's outward normal at the point of it nearest `point`, and its curvature there by direction."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepLProp import BRepLProp_SLProps
    from OCP.gp import gp_Dir, gp_Pnt
    from OCP.ShapeAnalysis import ShapeAnalysis_Surface
    from OCP.TopAbs import TopAbs_REVERSED

    uv = ShapeAnalysis_Surface(BRep_Tool.Surface_s(face.wrapped)).ValueOfUV(gp_Pnt(*map(float, point)), 1e-7)
    props = BRepLProp_SLProps(BRepAdaptor_Surface(face.wrapped), uv.X(), uv.Y(), 2, 1e-7)
    if not props.IsNormalDefined():
        return None
    flip = -1.0 if face.wrapped.Orientation() == TopAbs_REVERSED else 1.0
    n = props.Normal()
    normal = flip * numpy.array([n.X(), n.Y(), n.Z()])
    if not props.IsCurvatureDefined():
        return normal, None
    k1, k2 = props.MaxCurvature() * flip, props.MinCurvature() * flip
    if abs(k1 - k2) < 1e-12:
        return normal, lambda d: k1
    first, second = gp_Dir(), gp_Dir()
    props.CurvatureDirections(first, second)
    d1 = numpy.array([first.X(), first.Y(), first.Z()])
    d2 = numpy.array([second.X(), second.Y(), second.Z()])
    return normal, lambda d: k1 * float(d @ d1) ** 2 + k2 * float(d @ d2) ** 2


def smooth(parts, asked, named):
    level = asked.get("level", "G1")
    limit = asked.get("angle", ANGLE)
    jump_limit = asked.get("curvature", CURVATURE)
    worst = None
    for name, shape in parts:
        edges = _edges_between(*_faces_of(name, shape, asked, named))
        if not edges:
            raise Unchecked(f"no edge of {name} lies between two of the faces checked")
        steepest, sharpest, past = (0.0, None), (0.0, None), []
        for edge, a, b in edges:
            angle_here, jump_here, at = 0.0, 0.0, None
            for share in ALONG:
                p = numpy.array(tuple(edge.position_at(share)))
                tangent = numpy.array(tuple(edge.tangent_at(share)))
                one, other = _surface_at(a, p), _surface_at(b, p)
                if one is None or other is None:
                    continue
                angle = math.degrees(math.acos(max(-1.0, min(1.0, float(one[0] @ other[0])))))
                if angle > angle_here:
                    angle_here, at = angle, p
                if level == "G2" and one[1] is not None and other[1] is not None:
                    across_a = numpy.cross(one[0], tangent)
                    across_b = numpy.cross(other[0], tangent)
                    ka, kb = one[1](across_a / numpy.linalg.norm(across_a)), other[1](across_b / numpy.linalg.norm(across_b))
                    larger = max(abs(ka), abs(kb))
                    jump = abs(ka - kb) / larger if larger > FLAT else 0.0
                    if jump > jump_here:
                        jump_here = jump
                        at = at if at is not None else p
            at = at if at is not None else numpy.array(tuple(edge.position_at(0.5)))
            if angle_here > steepest[0]:
                steepest = (angle_here, at)
            if jump_here > sharpest[0]:
                sharpest = (jump_here, at)
            if angle_here > limit + 1e-9 or (level == "G2" and jump_here > jump_limit + 1e-9):
                past.append((angle_here, jump_here, at))
        said = f"{name}'s faces meet across {len(edges)} {'edge' if len(edges) == 1 else 'edges'}, turning at most {_mm(steepest[0])}°"
        if steepest[1] is not None and steepest[0] >= 0.005:
            said += f" at {_at(steepest[1])}"
        margins = [((limit - steepest[0]) / limit, limit - steepest[0], "°")]
        if level == "G2":
            said += f", their curvature jumping at most {100 * sharpest[0]:.0f}% across one"
            if sharpest[1] is not None and sharpest[0] >= 0.005:
                said += f" at {_at(sharpest[1])}"
            margins.append(((jump_limit - sharpest[0]) / jump_limit, 100 * (jump_limit - sharpest[0]), "% of the larger curvature"))
            said += f", where at most {_mm(limit)}° and {100 * jump_limit:.0f}% are asked"
        else:
            said += f", where at most {_mm(limit)}° is asked"
        if past:
            past.sort(key=lambda one: (-one[0], -one[1]))
            listed = "; ".join(
                f"{_mm(angle)}°{f', curvature {100 * jump:.0f}%' if level == 'G2' else ''} at {_at(at)}" for angle, jump, at in past[:PLACES]
            )
            more = f"; and {len(past) - PLACES} more" if len(past) > PLACES else ""
            said += f"; {len(past)} {'edge is' if len(past) == 1 else 'edges are'} past it: {listed}{more}"
        _, margin, unit = min(margins)
        if worst is None or min(margins)[0] < worst[0]:
            worst = (min(margins)[0], {"margin": margin, "unit": unit, "measured": said})
    return worst[1]
