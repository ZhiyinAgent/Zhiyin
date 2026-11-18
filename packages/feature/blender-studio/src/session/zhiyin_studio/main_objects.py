"""
The objects a scene is mostly about, for close-ups when none are named: those the camera's picture
shows most, past the setting, a floor, a wall or a table that fills much of the picture or is far
larger than the rest, with any
whose pieces of one material pass into each other first, as a spout pushed into its teapot, since
that is where a picture of the whole hides most. Without a camera, the largest come first.
"""

import math

from .finding import is_backdrop, scene, subjects
from .form_measures import shares_material
from .geometry import bounds_of, has_shape
from .look_counts import islands, passing_into
from .measure_shapes import Mesh, Shape, into
from .soundness import MOST_FACES, mesh_of

# An object meeting more of the camera's rays than this share is the setting the rest stand in,
# and so is one this many times as large across as the middle one of those in view.
SETTING = 0.2
LARGER = 3.0
# Rays across the picture, each way.
GRID = 48
# The most candidates measured for pieces passing into each other.
MEASURED = 12


def root_of(obj):
    while obj.parent is not None:
        obj = obj.parent
    return obj


def size_of(obj):
    box = bounds_of(obj)
    return math.dist(box[0], box[1]) if box else 0.0


def pushed_together(obj):
    """Whether any of an object's meshes has pieces of one material passing into each other, or a part pushed into the mesh it belongs to."""
    for part in [obj, *obj.children_recursive]:
        if part.type != "MESH":
            continue
        bm = mesh_of(part)
        try:
            if len(bm.faces) <= MOST_FACES and passing_into(part, islands(bm))[0]:
                return True
        finally:
            bm.free()
        parent = part.parent
        if parent is not None and parent.type == "MESH" and shares_material(part, parent):
            if into(Shape(Mesh.of_own(part)), Shape(Mesh.of_own(parent))) is not None:
                return True
    return False


def main_objects(count):
    """Up to `count` of the objects the scene is mostly about, first to last."""
    from .describe import rays_met, shapes_in_scene

    shown = [o for o in subjects() if has_shape(o) or o.children]
    roots = []
    for obj in shown:
        root = root_of(obj)
        if root not in roots and not is_backdrop(root):
            roots.append(root)
    camera = scene().camera
    if camera is None:
        ranked = sorted(roots, key=size_of, reverse=True)
    else:
        everything, owners = shapes_in_scene()
        met = {}
        for part, rays in rays_met(camera, everything, owners, GRID).items():
            met[root_of(part)] = met.get(root_of(part), 0) + rays
        total = GRID * GRID
        seen = sorted((r for r in roots if met.get(r)), key=lambda r: met[r], reverse=True)
        sizes = sorted(size_of(r) for r in seen)
        middle = sizes[len(sizes) // 2] if sizes else 0.0
        ranked = [r for r in seen if met[r] / total <= SETTING and size_of(r) <= LARGER * middle] or seen
    joined = [r for r in ranked[:MEASURED] if pushed_together(r)]
    return (joined + [r for r in ranked if r not in joined])[:count]
