"""
What a shaping step's answer is measured from: an object's shape as its steps leave it, how many
faces and points it has, its size, how its edges meet, and how much of it shades flat.
"""

import math

import bmesh
import bpy

from .cuts import Shape
from .geometry import own_dimensions


def evaluated_mesh(obj, world=False):
    """An object's mesh as its steps leave it, as a bmesh: in its own space, or in the world's."""
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
    finally:
        evaluated.to_mesh_clear()
    if world:
        bm.transform(obj.matrix_world)
    return bm


class Measure:
    """An object's shape as its steps leave it: its shape in the world, how many faces and points it has and its size."""

    def __init__(self, obj):
        bpy.context.view_layer.update()
        self.shape = Shape(obj)
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            self.faces = len(mesh.polygons)
            self.points = len(mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
        self.size = own_dimensions(obj)

    def alike(self, other):
        """Whether two shapes are the same solid or sheet: the same box and volume, however their faces are cut."""
        mine, theirs = self.shape.bounds(), other.shape.bounds()
        if mine is None or theirs is None:
            return mine is theirs
        reach = max(1e-9, max(mine[1][i] - mine[0][i] for i in range(3)))
        boxed = all(abs(a - b) <= 1e-6 * reach for corner in range(2) for a, b in zip(mine[corner], theirs[corner]))
        if self.shape.volume is None or other.shape.volume is None:
            return boxed and self.shape.volume is other.shape.volume and self.shape.same_as(other.shape)
        return boxed and abs(self.shape.volume - other.shape.volume) <= 1e-6 * max(other.shape.volume, 1e-12)


def sharp_edges(obj, limit):
    """How many of an object's edges, as its steps leave it, are sharper than an angle, and its sharpest in degrees."""
    bm = evaluated_mesh(obj)
    try:
        angles = [edge.calc_face_angle(0.0) for edge in bm.edges if edge.is_manifold]
    finally:
        bm.free()
    return sum(1 for a in angles if a > limit + 1e-6), math.degrees(max(angles, default=0.0))


# A face whose shading leans from its own facing by less than this, in degrees, shades flat.
FLAT_SHADED = 1.0


def flat_shading(obj):
    """
    How an object's faces shade as its steps leave it: how many of them shade flat, every corner's
    normal within a degree of the face's own, and the share of its surface those cover.
    """
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        normals = mesh.corner_normals
        limit = math.cos(math.radians(FLAT_SHADED))
        flat, area, total = 0, 0.0, 0.0
        for face in mesh.polygons:
            total += face.area
            if all(normals[i].vector.dot(face.normal) >= limit for i in face.loop_indices):
                flat += 1
                area += face.area
        return flat, len(mesh.polygons), area / total if total > 0 else 0.0
    finally:
        evaluated.to_mesh_clear()


def shading_text(before, after):
    """How many faces shade flat after a step and before it, and the share of the surface they cover."""
    flat, count, share = after
    was_flat, _, was_share = before
    return f"{flat:,} of its {count:,} faces shade flat, {share:.0%} of its surface ({was_flat:,} and {was_share:.0%} before)"
