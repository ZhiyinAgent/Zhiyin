"""
The parts written to files: STEP with their exact faces, STL and 3MF as
meshes for printing, their facets under a fiftieth of a millimetre from the
surface, or closer for a small part, and glTF binary as a mesh for viewing,
its facets within a thousandth of the part's size of the surface, a quarter
of a millimetre at most, or for close-ups, four times closer. A part meshed
for printing is many times heavier than the eye needs: an engine's crankshaft
half a million triangles, more than a scene of such parts can hold. A glTF
part keeps its groups of surfaces. Each mesh written says how far its facets
lie from the surface at most. Every mesh is made by the one meshing step,
and a file holding a part that step cannot mesh whole is not written: the
part is named, with why.
"""

import os
import struct
import zipfile
from xml.sax.saxutils import quoteattr

import build123d as bd
import numpy

from . import glb, meshing


def fresh(name, shape):
    """
    The same geometry as a shape of its own, named: grouping the script's
    own shapes would move them under the group, and a shape that already
    sits in one, or is shown twice, would be written as nothing.
    """
    copy = bd.Shape.cast(shape.wrapped)
    copy.label = name
    return copy


def together(parts):
    """One part, or a compound naming each, as STEP and glTF keep names."""
    if len(parts) == 1:
        return fresh(*parts[0])
    return bd.Compound(children=[fresh(name, shape) for name, shape in parts])


def deflection(shape):
    """How far a mesh for printing may lie from the surface: a fiftieth of a millimetre, less for a small part."""
    diagonal = shape.bounding_box().diagonal
    return max(0.001, min(0.02, diagonal / 2000))


def printing(shape):
    """A mesh for printing: its facets' distance from the surface, in mm, and the angle between them, in radians."""
    return deflection(shape), 0.1


def viewing(shape):
    """A mesh for viewing: within a thousandth of the part's size, a fiftieth to a quarter of a millimetre."""
    return max(0.02, min(0.25, shape.bounding_box().diagonal / 1000)), 0.25


def close_up(shape):
    """A mesh for close-ups: four times closer than one for viewing, a twentieth of a millimetre at most."""
    return max(0.01, min(0.05, shape.bounding_box().diagonal / 4000)), 0.15


def _printed(parts, whole_deflection=None):
    """
    Each part's points and triangles, meshed for printing, placed where it
    is: at its own fineness, or at `whole_deflection` for them all. Raises
    Unmeshed naming the first part that cannot be meshed whole.
    """
    meshed = []
    for name, shape in parts:
        linear, angular = printing(shape)
        try:
            points, triangles = meshing.whole(shape, whole_deflection or linear, angular)
        except meshing.Unmeshed as unmeshed:
            raise meshing.Unmeshed(f"{name} {unmeshed}") from None
        meshed.append((name, points, triangles))
    return meshed


def _closed(meshed):
    """How many triangles the parts' meshes hold, and how many of their edges, its points joined, no other triangle shares."""
    triangles = opened = 0
    for _, points, faces in meshed:
        points, faces = _welded(points, faces)
        triangles += len(faces)
        if not len(faces):
            continue
        edges = numpy.sort(numpy.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
        _, counts = numpy.unique(edges, axis=0, return_counts=True)
        opened += int((counts == 1).sum())
    return {"triangles": int(triangles), "open": opened}


def _stl(meshed, path):
    """A binary STL of the parts' triangles, each with its facing."""
    corners = [points[triangles] for _, points, triangles in meshed if len(triangles)]
    corners = numpy.concatenate(corners) if corners else numpy.zeros((0, 3, 3))
    facing = numpy.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    lengths = numpy.linalg.norm(facing, axis=1, keepdims=True)
    facing = numpy.where(lengths > 0, facing / numpy.maximum(lengths, 1e-300), 0.0)
    records = numpy.zeros(len(corners), dtype=[("normal", "<f4", 3), ("corners", "<f4", (3, 3)), ("attribute", "<u2")])
    records["normal"] = facing
    records["corners"] = corners
    with open(path, "wb") as out:
        out.write(b"Zhiyin CAD studio".ljust(80, b" "))
        out.write(struct.pack("<I", len(records)))
        out.write(records.tobytes())


def _welded(points, triangles):
    """
    The mesh with each place one point, as 3MF asks: its faces' meshes share
    the points along the edges where they meet. Triangles left with no area
    are dropped.
    """
    if not len(triangles):
        return numpy.zeros((0, 3)), triangles
    keys = numpy.round(points / 1e-5).astype(numpy.int64)
    _, first, index = numpy.unique(keys, axis=0, return_index=True, return_inverse=True)
    joined = index.reshape(-1)[triangles]
    kept = (joined[:, 0] != joined[:, 1]) & (joined[:, 1] != joined[:, 2]) & (joined[:, 2] != joined[:, 0])
    return points[first], joined[kept]


_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    "</Types>"
)
_RELATIONSHIPS = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    "</Relationships>"
)


def _3mf(meshed, path):
    """A 3MF package: one model file holding each part as a named object of its welded triangles, in millimetres."""
    model = [
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        "<resources>"
    ]
    for number, (name, points, triangles) in enumerate(meshed, start=1):
        points, triangles = _welded(points, triangles)
        model.append(f'<object id="{number}" name={quoteattr(name)} type="model"><mesh><vertices>')
        model.extend(f'<vertex x="{x:.9g}" y="{y:.9g}" z="{z:.9g}"/>' for x, y, z in points.tolist())
        model.append("</vertices><triangles>")
        model.extend(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in triangles.tolist())
        model.append("</triangles></mesh></object>")
    model.append("</resources><build>")
    model.extend(f'<item objectid="{number}"/>' for number in range(1, len(meshed) + 1))
    model.append("</build></model>")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", _TYPES)
        package.writestr("_rels/.rels", _RELATIONSHIPS)
        package.writestr("3D/3dmodel.model", "".join(model))


def write(kind, parts, path, detail=None, groups_of=None, marks=None):
    """
    Writes the parts as a file of `kind`; a .glb for close-ups when `detail`
    is "close-up", with each part's groups of surfaces from `groups_of` and
    the faces `marks` marks meshed coarser. Answers the file's size and, for
    a mesh, what it is meshed for and how far its facets lie from the
    surface at most, and for printing how many triangles it holds and how
    many of their edges are open. Raises Unmeshed, naming the part, when a part cannot be
    meshed whole, and writes nothing.
    """
    mesh = None
    if kind == "step":
        done = bd.export_step(together(parts), path)
    elif kind == "stl":
        # One fineness for the whole file, as it is one mesh.
        linear = printing(together(parts))[0]
        meshed = _printed(parts, linear)
        _stl(meshed, path)
        done = True
        mesh = {"for": "printing", "within": linear, **_closed(meshed)}
    elif kind == "3mf":
        meshed = _printed(parts)
        _3mf(meshed, path)
        done = True
        mesh = {"for": "printing", "within": max(printing(part)[0] for _, part in parts), **_closed(meshed)}
    elif kind == "glb":
        fineness = close_up if detail == "close-up" else viewing
        size, within, _ = glb.write(parts, path, fineness, groups_of, marks)
        done = size > 0
        mesh = {"for": "close-ups" if detail == "close-up" else "viewing", "within": within}
    else:
        raise ValueError(f"No export of kind {kind}.")
    if not done or not os.path.exists(path) or os.path.getsize(path) == 0:
        raise RuntimeError(f"No {kind.upper()} file was written.")
    return os.path.getsize(path), mesh


def preview(parts, path, marks=None):
    """
    The parts as one glTF binary for the person's view of them, each named,
    meshed for viewing so it loads at once. A part that cannot be meshed
    whole is left out, as the picture leaves it out and names it.
    """
    size, _, _ = glb.write(parts, path, viewing, marks=marks, leave_out=True)
    if size <= 0 or not os.path.exists(path) or os.path.getsize(path) == 0:
        raise RuntimeError("No preview was written.")
