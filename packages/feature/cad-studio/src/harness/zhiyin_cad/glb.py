"""
The parts as one glTF binary, for viewing and for the 3D studio. Each part is
a mesh of its own, named, placed where the script put it about the origin it
was modelled at, in metres with y up as glTF has it. Each face is a run of
points of its own, with the surface's own normals, so a reader that welds
the points by place keeps sharp the edges where the faces meet at an angle,
and smooth where a round meets a face. A part's groups of surfaces are each
drawn with a material of the group's name, the rest with none, and the mesh
lists the groups in the order its pieces are drawn. Each mesh is marked as a
CAD part's.
"""

import json
import struct

import numpy
from build123d import Shape
from OCP.TopLoc import TopLoc_Location

from . import meshing, surfaces

# From the CAD's millimetres with z up to glTF's metres with y up.
TO_GLTF = numpy.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)
METRE = 0.001
FLOAT, UNSIGNED_INT = 5126, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


def matrix(trsf):
    """A placement as a 4 × 4 matrix, in millimetres."""
    rows = [[trsf.Value(r, c) for c in range(1, 5)] for r in range(1, 4)]
    return numpy.array(rows + [[0, 0, 0, 1]], dtype=float)


class _Buffer:
    def __init__(self):
        self.data = bytearray()
        self.views, self.accessors = [], []

    def add(self, array, kind, target, bounds=False):
        raw = array.tobytes()
        while len(self.data) % 4:
            self.data.append(0)
        self.views.append({"buffer": 0, "byteOffset": len(self.data), "byteLength": len(raw), "target": target})
        self.data.extend(raw)
        accessor = {
            "bufferView": len(self.views) - 1,
            "componentType": FLOAT if array.dtype == numpy.float32 else UNSIGNED_INT,
            "count": int(array.shape[0]) if array.ndim > 1 else int(array.size),
            "type": kind,
        }
        if bounds:
            accessor["min"] = array.min(axis=0).tolist()
            accessor["max"] = array.max(axis=0).tolist()
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def write(parts, path, fineness, groups_of=None, marks=None, leave_out=False):
    """
    Writes the parts, each (name, shape), each meshed as `fineness(shape)`
    says: its facets' distance from the surface in millimetres, and the
    angle between them in radians, or coarser where `marks` marks a thin
    wire's faces. `groups_of(name)` gives a part's groups of surfaces as
    {group: face numbers}. A part that cannot be meshed whole raises
    Unmeshed, naming it, or with `leave_out` is left out. Answers the
    file's size, the furthest any part's facets were allowed from its
    surface, and each part left out with why.
    """
    buffer, nodes, meshes, materials = _Buffer(), [], [], {}
    within, left_out = 0.0, []
    for name, shape in parts:
        place = matrix(shape.wrapped.Location().Transformation())
        own = Shape.cast(shape.wrapped.Located(TopLoc_Location()))
        linear, angular = fineness(shape)
        fine, turn = meshing.for_viewing(own, linear, angular, marks)
        try:
            meshing.mesh(own, fine, turn)
        except meshing.Unmeshed as unmeshed:
            if not leave_out:
                raise meshing.Unmeshed(f"{name} {unmeshed}") from None
            left_out.append((name, str(unmeshed)))
            continue
        within = max(within, fine)
        faces = surfaces.faces_of(own)
        groups = (groups_of(name) if groups_of else None) or {}
        member = numpy.full(len(faces), -1)
        for number, indexes in enumerate(groups.values()):
            member[indexes] = number
        all_points, all_normals, pieces, offset = [], [], {}, 0
        for index, face in enumerate(faces):
            points, normals, triangles = meshing.triangles(face)
            all_points.append(points)
            all_normals.append(normals)
            pieces.setdefault(int(member[index]), []).append(triangles + offset)
            offset += len(points)
        if not all_points:
            continue
        points = (numpy.concatenate(all_points) @ TO_GLTF.T * METRE).astype(numpy.float32)
        normals = (numpy.concatenate(all_normals) @ TO_GLTF.T).astype(numpy.float32)
        attributes = {
            "POSITION": buffer.add(points, "VEC3", ARRAY_BUFFER, bounds=True),
            "NORMAL": buffer.add(normals, "VEC3", ARRAY_BUFFER),
        }
        names = list(groups)
        primitives, drawn = [], []
        for number in sorted(pieces, key=lambda n: (n < 0, n)):
            indices = numpy.concatenate(pieces[number]).astype(numpy.uint32).reshape(-1)
            primitive = {"attributes": attributes, "indices": buffer.add(indices, "SCALAR", ELEMENT_ARRAY_BUFFER), "mode": 4}
            if number >= 0:
                group = names[number]
                if group not in materials:
                    materials[group] = len(materials)
                primitive["material"] = materials[group]
            primitives.append(primitive)
            drawn.append(names[number] if number >= 0 else "")
        # Marked as a CAD part's, so the 3D studio changes its shape only through the CAD.
        mesh = {"name": name, "primitives": primitives, "extras": {"zhiyin_cad_part": name}}
        # Its exact size along its own axes, in metres, which its facets only
        # approach: the 3D studio compares a new shape by it.
        exact = own.bounding_box(optimal=True).size
        mesh["extras"]["zhiyin_cad_size"] = [exact.X * METRE, exact.Y * METRE, exact.Z * METRE]
        if groups:
            mesh["extras"]["zhiyin_surfaces"] = drawn
        meshes.append(mesh)
        # The placement turned into glTF's axes, its length in metres.
        turned = numpy.eye(4)
        turned[:3, :3] = TO_GLTF @ place[:3, :3] @ TO_GLTF.T
        turned[:3, 3] = TO_GLTF @ place[:3, 3] * METRE
        node = {"name": name, "mesh": len(meshes) - 1}
        if not numpy.allclose(turned, numpy.eye(4)):
            node["matrix"] = turned.T.reshape(-1).tolist()
        nodes.append(node)
    document = {
        "asset": {"version": "2.0", "generator": "Zhiyin CAD studio"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": buffer.accessors,
        "bufferViews": buffer.views,
        "buffers": [{"byteLength": len(buffer.data)}],
    }
    if materials:
        document["materials"] = [
            {"name": group, "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.8, 1], "metallicFactor": 0, "roughnessFactor": 0.5}}
            for group in materials
        ]
    text = json.dumps(document, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    while len(buffer.data) % 4:
        buffer.data.append(0)
    total = 12 + 8 + len(text) + 8 + len(buffer.data)
    with open(path, "wb") as out:
        out.write(struct.pack("<4sII", b"glTF", 2, total))
        out.write(struct.pack("<I4s", len(text), b"JSON"))
        out.write(text)
        out.write(struct.pack("<I4s", len(buffer.data), b"BIN\0"))
        out.write(buffer.data)
    return total, within, left_out
