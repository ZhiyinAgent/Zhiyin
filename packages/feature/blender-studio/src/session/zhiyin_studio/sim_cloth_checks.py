"""
What a simulated cloth did, measured on its evaluated shape in the world: whether it came to rest,
how its grid spacing compares with the folds it formed, how far it rests off each collider, and
whether it stayed sound: stretched, exploded, crossed itself or went into a collider.
"""

import math

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .geometry import world_mesh
from .shown_mesh import is_inside
from .wording import length, volume_text

# Folds sharper than this between neighbouring faces are as tight as the grid can bend.
SHARP_FOLD = 60
# The share of edges folded that sharp past which the grid, not the fabric, sets the folds.
GRID_BOUND = 0.02
# Stretched past this share of its rest length, a cloth reads as rubber; past the second it has burst.
STRETCHED = 1.3
EXPLODED = 3.0
LAST = 10


def points_of(obj):
    """The evaluated cloth's points in the world, as an array of rows."""
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.data
    found = numpy.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", found)
    found = found.reshape(-1, 3)
    matrix = numpy.array(obj.matrix_world)
    return found @ matrix[:3, :3].T + matrix[:3, 3]


def motion(track, last=LAST):
    """How far any point moved over the last frames of a track of point arrays."""
    if len(track) <= last:
        return math.inf
    return float(numpy.linalg.norm(track[-1] - track[-1 - last], axis=1).max())


def cloth_bmesh(obj, world_points):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    for v, p in zip(bm.verts, world_points):
        v.co = mathutils.Vector(p)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    return bm


def folds_line(obj, world_points, spacing):
    bm = cloth_bmesh(obj, world_points)
    try:
        angles = [math.degrees(e.calc_face_angle(0)) for e in bm.edges if len(e.link_faces) == 2]
    finally:
        bm.free()
    if not angles:
        return None
    sharp = sum(1 for a in angles if a > SHARP_FOLD)
    said = f"Folds: {sharp} of {len(angles)} edges fold past {SHARP_FOLD}°, the sharpest {max(angles):.0f}°"
    if sharp > GRID_BOUND * len(angles):
        return (
            f"{said}: the folds are as tight as the {length(spacing)} grid bends, and none narrower than about"
            f" {length(2 * spacing)} can form; subdivide_to {length(spacing / 2)} for finer folds."
        )
    return f"{said}: the {length(spacing)} grid holds the folds the fabric makes."


def crossings(obj, world_points):
    """How many pairs of the cloth's faces that share no point cross each other."""
    bm = cloth_bmesh(obj, world_points)
    try:
        tree = mathutils.bvhtree.BVHTree.FromBMesh(bm)
        corners = [{v.index for v in f.verts} for f in bm.faces]
        return sum(1 for a, b in tree.overlap(tree) if a < b and not corners[a] & corners[b])
    finally:
        bm.free()


def collider_reach(colliders, world_points):
    """For each collider: the nearest any cloth point comes to its surface, and how many lie inside it."""
    found = []
    for obj in colliders:
        bm = world_mesh(obj)
        try:
            closed = bool(bm.edges) and all(e.is_manifold for e in bm.edges)
            tree = mathutils.bvhtree.BVHTree.FromBMesh(bm)
        finally:
            bm.free()
        nearest, inside = math.inf, 0
        for p in world_points:
            point = mathutils.Vector(p)
            hit = tree.find_nearest(point)
            if hit[0] is not None:
                nearest = min(nearest, hit[3])
            if closed and is_inside(tree, point):
                inside += 1
        found.append((obj, nearest, inside))
    return found


def soundness_line(obj, start_points, world_points, rest, reach):
    """Stretch against the rest lengths, flying points, points inside colliders and the cloth crossing itself."""
    if not numpy.isfinite(world_points).all():
        return "Unstable: the cloth exploded, its points went past any number Blender holds; give it more steps or a coarser grid."
    edges = numpy.array([tuple(e.vertices) for e in obj.data.edges], dtype=int).reshape(-1, 2)
    now = numpy.linalg.norm(world_points[edges[:, 0]] - world_points[edges[:, 1]], axis=1)
    stretch = float((now / numpy.maximum(rest, 1e-9)).max()) if len(now) else 1.0
    flew = float(numpy.linalg.norm(world_points - start_points, axis=1).max())
    size = float(numpy.linalg.norm(start_points.max(axis=0) - start_points.min(axis=0)))
    if stretch > EXPLODED or flew > 10 * max(size, 1e-6):
        return (
            f"Unstable: the cloth exploded, stretched to {stretch:.3g}× its rest length and a point flew {length(flew)}:"
            " give it a finer grid or slower motion."
        )
    faults = []
    if stretch > STRETCHED:
        faults.append(f"stretched to {stretch:.3g}× its rest length, so it reads as rubber: pin it at more points or use a stiffer fabric")
    for collider, _, inside in reach:
        if inside:
            faults.append(f"{inside} points inside {collider.name}: the collider's edges are sharper than the grid, so subdivide_to a finer spacing")
    crossed = crossings(obj, world_points)
    if crossed:
        faults.append(f"it crosses itself at {crossed} pair{'s' if crossed != 1 else ''} of faces")
    if faults:
        return "Unsound: " + "; ".join(faults) + "."
    into = " no point inside a collider, and" if reach else ""
    return f"Sound: stretched at most {stretch:.3g}× its rest length,{into} it crosses itself nowhere."


def rest_lines(reach):
    return [f"Rests {length(nearest)} off {obj.name} at its nearest." for obj, nearest, _ in reach if math.isfinite(nearest)]


def volume_of(obj, world_points):
    bm = cloth_bmesh(obj, world_points)
    try:
        return abs(bm.calc_volume())
    finally:
        bm.free()


def pressure_line(pressure, before, after):
    return f"Pressure {pressure:g} inflated it from {volume_text(before)} to {volume_text(after)}."


def seams_line(seams, start_points, world_points):
    before = max(float(numpy.linalg.norm(start_points[a] - start_points[b])) for a, b in seams)
    after = max(float(numpy.linalg.norm(world_points[a] - world_points[b])) for a, b in seams)
    shut = " so its seams are shut" if after <= 0.01 * max(before, 1e-9) + 0.001 else ""
    return (
        f"Sewn: {len(seams)} loose edges pull their ends together, the longest from {length(before)} to {length(after)}{shut};"
        " they stay in the mesh as loose edges."
    )
