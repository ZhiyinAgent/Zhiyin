"""
Where wear and dirt land, estimated without rendering: points sampled evenly over each object's
surface as it renders, each read by rays cast in metres where the shader reads ambient occlusion,
and each mark's own coverage worked out at each. A point is on an edge where the shape closes in
round it from inside within the reach of wear, in a recess where it closes in from outside within
the reach of grime, and on an open face elsewhere.
"""

import math
import random

import bpy
import mathutils
import numpy
from mathutils.bvhtree import BVHTree

from .finding import scene
from .finishes_marks import DUST_REACH, RUST_REACH, edge_of, recess_of
from .finishes_shape import DOWN, RUNS, Point, Sampled, steep
from .mesh_math import spread_over
from .wording import length

# Points sampled on each object, fewer each when many share a call; rays cast from each.
SAMPLES, ALL_SAMPLES, FEWEST = 3000, 12000, 600
RAYS = 12
# How far off a surface a ray starts, so it does not meet the surface it leaves.
LIFT = 1e-5
SHAPED = {"MESH", "CURVE", "FONT", "SURFACE", "META"}


def hemisphere():
    """Directions spread over a half sphere round +z as ambient occlusion weighs them: most near the top."""
    found = []
    for i in range(RAYS):
        height = (i + 0.5) / RAYS
        turn = i * math.pi * (3 - math.sqrt(5))
        spread = math.sqrt(height)
        found.append(mathutils.Vector((spread * math.cos(turn), spread * math.sin(turn), math.sqrt(1 - height))))
    return found


def triangles_of(obj, depsgraph):
    """An object's triangles as it renders, in the scene, with its mesh to read and free."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    return evaluated, mesh


def scene_tree(targets, depsgraph):
    """Every surface that renders within reach of the objects, as one tree of triangles in the scene."""
    low = mathutils.Vector([math.inf] * 3)
    high = mathutils.Vector([-math.inf] * 3)
    for obj in targets:
        for corner in obj.bound_box:
            place = obj.matrix_world @ mathutils.Vector(corner)
            low = mathutils.Vector([min(a, b) for a, b in zip(low, place)])
            high = mathutils.Vector([max(a, b) for a, b in zip(high, place)])
    low -= mathutils.Vector([DUST_REACH] * 3)
    high += mathutils.Vector([DUST_REACH] * 3)
    places, faces = [], []
    for obj in scene().objects:
        if obj.type not in SHAPED or obj.hide_render or not obj.visible_get():
            continue
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        if any(max(c[i] for c in corners) < low[i] or min(c[i] for c in corners) > high[i] for i in range(3)):
            continue
        evaluated, mesh = triangles_of(obj, depsgraph)
        world = obj.matrix_world
        start = len(places)
        places.extend(world @ v.co for v in mesh.vertices)
        faces.extend(tuple(start + i for i in tri.vertices) for tri in mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(places, faces, all_triangles=True) if faces else None


def cast(tree, origin, directions, reach):
    found = []
    for direction in directions:
        hit = tree.ray_cast(origin, direction, reach) if tree is not None else (None,)
        found.append(hit[3] if hit[0] is not None else math.inf)
    return found


def sampled_points(obj, depsgraph, tree, count):
    """Points spread evenly by area over an object's surface as it renders, each with its rays cast."""
    evaluated, mesh = triangles_of(obj, depsgraph)
    try:
        world = obj.matrix_world
        turned = world.to_3x3()
        normals = world.inverted_safe().transposed().to_3x3()
        scale = [turned.col[i].length for i in range(3)]
        corners = [world @ v.co for v in mesh.vertices]
        triangles = list(mesh.loop_triangles)
        placed = numpy.array([[corners[i][:] for i in tri.vertices] for tri in triangles], dtype=float).reshape(-1, 3, 3)
        found = spread_over(placed, count)
        if found is None:
            return [], 0.0
        a, b, c = placed[:, 0], placed[:, 1], placed[:, 2]
        total = float(numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1).sum()) / 2
        told = mesh.attributes.get(RUNS)
        runs = [d.value for d in told.data] if told is not None and told.domain == "POINT" else None
        down = mathutils.Vector(obj[DOWN]) if DOWN in obj else mathutils.Vector((0, 0, 0))
        # The points are laid evenly; each one's rays are turned at random round it.
        rng = random.Random(obj.name)
        rays = hemisphere()
        points = []
        for pick, u, v in zip(*(part.tolist() for part in found), strict=True):
            tri = triangles[pick]
            weights = (1 - u - v, u, v)
            local = sum((mesh.vertices[i].co * w for i, w in zip(tri.vertices, weights)), mathutils.Vector())
            place = world @ local
            normal = (normals @ tri.normal).normalized()
            # A frame round the normal, turned at random so no two points cast the same rays.
            side = normal.orthogonal().normalized()
            side.rotate(mathutils.Quaternion(normal, rng.random() * 2 * math.pi))
            frame = mathutils.Matrix((side, normal.cross(side), normal)).transposed()
            outward = [frame @ d for d in rays]
            outside = cast(tree, place + normal * LIFT, outward, DUST_REACH)
            inside = cast(tree, place - normal * LIFT, [-d for d in outward], RUST_REACH)
            at = mathutils.Vector([local[i] * scale[i] for i in range(3)])
            told_here = sum(runs[i] * w for i, w in zip(tri.vertices, weights)) if runs is not None else 0.0
            points.append(Point(at, normal, inside, outside, told_here, down))
        return points, total
    finally:
        evaluated.to_mesh_clear()


def share_said(part, whole):
    if part == 0:
        return "none"
    share = 100 * part / whole
    return "under 1%" if share < 0.5 else f"{share:.0f}%"


def landed(mark, amount, how, obj, points):
    """Where one mark lands on one object, in the answer's words."""
    covered = edges = recesses = 0
    deepest = 0.0
    for point in points:
        k = Sampled(point)
        if mark.cover(k, point.at, amount, how) <= 0.5:
            continue
        covered += 1
        if edge_of(k) >= 0.5:
            edges += 1
        elif recess_of(k) >= 0.5:
            recesses += 1
        laid, below = k.runs()
        if mark.runs and laid and steep(k) > 0.5:
            deepest = max(deepest, below)
    if not covered:
        return f"none of {obj.name}"
    where = [
        f"{share_said(count, covered)} {place}"
        for count, place in ((edges, "on edges"), (recesses, "in recesses"), (covered - edges - recesses, "on open faces"))
        if count
    ]
    if deepest > 0:
        where.append(f"running as far as {length(round(deepest, 3))} down")
    # Sampled with other noise than the picture's, so the share is an estimate.
    share = share_said(covered, len(points))
    return f"{share if share.startswith('under') else 'about ' + share} of {obj.name} ({', '.join(where)})"


def where_marks_land(given, how, targets):
    """For each mark given, how much of each object it covers and where on it: {key: [phrase per object]}."""
    shaped = [obj for obj in targets if obj.type in SHAPED]
    if not shaped or not given:
        return {}
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = scene_tree(shaped, depsgraph)
    count = max(FEWEST, min(SAMPLES, ALL_SAMPLES // len(shaped)))
    found = {mark.key: [] for mark, _ in given}
    for obj in shaped:
        points, _ = sampled_points(obj, depsgraph, tree, count)
        if not points:
            continue
        for mark, amount in given:
            found[mark.key].append(landed(mark, amount, how, obj, points))
    return found
