"""
Parts divided into triangles, one way for every mesh the studio makes: the
picture, the person's preview and the STL, 3MF and glTF files. Each face of a
part is meshed on its own, and a part with a face the kernel gives no
triangles, as a solid that crosses itself, is said by name and why, never
written with a hole where that face was.

How fine a part is meshed for viewing: a part is meshed to a fiftieth of a
millimetre or finer, as printing needs; a coil of wire meshed so is hundreds
of thousands of triangles, more than a scene of them can hold, though its
wire is round to the eye at far fewer. The faces a helper makes of a thin
wire carry a fineness of their own, set by the wire's thickness, and a part
holding them is meshed for viewing at the coarser of that and its own.
Printing keeps the fine mesh.
"""

import numpy
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.IMeshTools import IMeshTools_Parameters
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location

# Faces of thin wire, by their shape at no place, each with its (deflection, angle).
_wire = {}


class Unmeshed(Exception):
    """A part some face of which the kernel could not divide into triangles; says why, after the part's name."""


def why(shape, problem=None):
    """Why a part's faces could not be divided into triangles, said after its name."""
    if not shape.is_valid:
        return "is not a valid solid, so its faces could not be divided into triangles"
    said = (str(problem).strip() or type(problem).__name__) if problem is not None else "a face has no triangles"
    return f"could not be divided into triangles: {said}"


def _key(face):
    return hash(face.Located(TopLoc_Location()))


def wire(faces, deflection, angular):
    """Marks faces as a thin wire's, meshed for viewing `deflection` mm from the surface and `angular` radians."""
    for face in faces:
        _wire[_key(face.wrapped)] = (deflection, angular)


def forget():
    """Each run starts with no faces marked."""
    _wire.clear()


def marked():
    """The faces marked in this run, kept with the run's parts."""
    return dict(_wire)


def marked_faces(faces, marks):
    """Which of a part's faces `marks` marks, by their place among them, each with its (deflection, angle)."""
    return [[index, *marks[k]] for index, face in enumerate(faces) if (k := _key(face.wrapped)) in marks]


def mark_faces(faces, listing, marks):
    """Marks in `marks` each face of `listing`, by its place among the part's faces, with its fineness."""
    for index, deflection, angular in listing:
        marks[_key(faces[index].wrapped)] = (deflection, angular)


def for_viewing(shape, deflection, angular, marks=None):
    """The deflection and angle a part is meshed at for viewing: its own, or a wire's it holds, whichever is coarser."""
    marks = marks or {}
    found = [marks[k] for k in (_key(f.wrapped) for f in shape.faces()) if k in marks]
    if not found:
        return deflection, angular
    return max(deflection, *(d for d, _ in found)), max(angular, *(a for _, a in found))


def mesh(shape, deflection, angular, smallest=None):
    """
    Divides each face of the shape into triangles, at most `deflection` mm
    from the surface and `angular` radians apart, none smaller than
    `smallest` when given, and leaves them on its faces for `triangles` to
    read. A mesh left from before is cleared first, so it is of this
    fineness. Raises Unmeshed when any face has none.
    """
    BRepTools.Clean_s(shape.wrapped)
    given = IMeshTools_Parameters()
    given.Deflection = deflection
    given.Angle = angular
    given.Relative = False
    given.InParallel = True
    if smallest is not None:
        given.MinSize = smallest
    try:
        BRepMesh_IncrementalMesh(shape.wrapped, given)
    except Exception as problem:  # noqa: BLE001 - the kernel's own failure, said as the part's
        raise Unmeshed(why(shape, problem)) from None
    for face in shape.faces():
        if BRep_Tool.Triangulation_s(face.wrapped, TopLoc_Location()) is None:
            raise Unmeshed(why(shape))


def _matrix(trsf):
    rows = [[trsf.Value(r, c) for c in range(1, 5)] for r in range(1, 4)]
    return numpy.array(rows + [[0, 0, 0, 1]], dtype=float)


def triangles(face, normals=True):
    """
    A meshed face's points, normals (or nothing) and triangles, placed as
    the face is, its triangles turned to face out.
    """
    where = TopLoc_Location()
    poly = BRep_Tool.Triangulation_s(face.wrapped, where)
    if poly is None:
        raise Unmeshed("has a face with no triangles")
    place = _matrix(where.Transformation())
    count = poly.NbNodes()
    points = numpy.empty((count, 3))
    for i in range(1, count + 1):
        p = poly.Node(i)
        points[i - 1] = (p.X(), p.Y(), p.Z())
    points = points @ place[:3, :3].T + place[:3, 3]
    found = numpy.empty((poly.NbTriangles(), 3), dtype=numpy.int64)
    for i, t in enumerate(poly.Triangles(), start=0):
        found[i] = (t.Value(1) - 1, t.Value(2) - 1, t.Value(3) - 1)
    if face.wrapped.Orientation() == TopAbs_REVERSED:
        found = found[:, [0, 2, 1]]
    if not normals:
        return points, None, found
    # The surface's own normals at the points, turned to face out as the triangles do.
    BRepLib_ToolTriangulatedShape.ComputeNormals_s(face.wrapped, poly)
    turned = numpy.empty((count, 3))
    for i in range(1, count + 1):
        d = poly.Normal(i)
        turned[i - 1] = (d.X(), d.Y(), d.Z())
    turned = turned @ place[:3, :3].T
    a, b, c = (points[found[:, k]] for k in range(3))
    facing = numpy.cross(b - a, c - a)
    if len(found) and numpy.einsum("ij,ij->", facing, turned[found[:, 0]]) < 0:
        turned = -turned
    lengths = numpy.linalg.norm(turned, axis=1, keepdims=True)
    turned = numpy.where(lengths > 1e-12, turned / numpy.maximum(lengths, 1e-12), 0.0)
    return points, turned, found


def whole(shape, deflection, angular, smallest=None):
    """The part's points and triangles, every face meshed, placed where it is; raises Unmeshed when a face cannot be."""
    mesh(shape, deflection, angular, smallest)
    points, found, offset = [], [], 0
    for face in shape.faces():
        own, _, made = triangles(face, normals=False)
        points.append(own)
        found.append(made + offset)
        offset += len(own)
    if not points:
        return numpy.zeros((0, 3)), numpy.zeros((0, 3), dtype=numpy.int64)
    return numpy.concatenate(points), numpy.concatenate(found)
