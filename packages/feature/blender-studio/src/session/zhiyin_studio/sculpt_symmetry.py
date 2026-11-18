"""
A sculpted shape's symmetry: how far each of its points lies from the surface once
mirrored across the object's own plane, as an RMS and the largest; and a symmetrize that keeps the
mesh's points and sets each on one side where its mirror on the other puts it. Points are paired
with their mirror by where they stood before the mesh was first sculpted, so a stroke that moved
them far still pairs them; a point with no mirror there is laid onto the mirrored surface.
"""

import numpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

from .arguments import need
from .picking import mesh_object
from .reports import report
from .sculpt_shape import REST
from .soundness import mesh_of
from .wording import length, point_text

AXES = {"x": 0, "y": 1, "z": 2}
# A point this close to its mirror's place before sculpting is paired with it, in the object's own metres.
PAIRED = 1e-5
# The most points measured; past it they are taken evenly.
MOST_POINTS = 200_000


def across(obj, axis):
    """The world's mapping that mirrors across the object's own plane where `axis` is 0."""
    flip = Matrix.Identity(4)
    flip[AXES[axis]][AXES[axis]] = -1
    return obj.matrix_world @ flip @ obj.matrix_world.inverted()


def measured(obj, axis):
    """The RMS and largest distance of the surface's places from its mirror, where the largest is, and 95% within."""
    bm = mesh_of(obj)
    try:
        need(bm.faces, f"{obj.name} has no faces to measure.")
        tree = BVHTree.FromBMesh(bm)
        places = numpy.array([v.co[:] for v in bm.verts], dtype=numpy.float64)
        if len(places) > MOST_POINTS:
            places = places[:: -(-len(places) // MOST_POINTS)]
    finally:
        bm.free()
    mapping = across(obj, axis)
    gaps = numpy.empty(len(places))
    for i, p in enumerate(places):
        mirrored = mapping @ Vector(p)
        nearest = tree.find_nearest(mirrored)
        gaps[i] = (nearest[0] - mirrored).length
    worst = int(numpy.argmax(gaps))
    return {
        "rms": float(numpy.sqrt((gaps**2).mean())),
        "most": float(gaps[worst]),
        "at": tuple(places[worst]),
        "within_95": float(numpy.percentile(gaps, 95)),
    }


def symmetry_words(found):
    words = f"RMS {length(found['rms'])}, largest {length(found['most'])}"
    if length(found["most"]) != length(0):
        words += f" at {point_text(found['at'])}, 95% within {length(found['within_95'])}"
    return words


def symmetry(obj, axis="x"):
    """
    How far a mesh is from the same on both sides of its own `axis` = 0, as it shows: each of its
    points mirrored and measured to the nearest place on its surface. Says the RMS, the largest
    and the point it is at; returns them in metres.
    """
    obj = mesh_object(obj, "symmetry")
    need(axis in AXES, "axis must be x, y or z.")
    found = measured(obj, axis)
    report(f"Symmetry of {obj.name} across its own {axis} = 0: {symmetry_words(found)}.")
    return found


def sculpt_symmetrize(obj, axis="x", direction="+"):
    """
    Makes a sculpted mesh the same on both sides of its own `axis` = 0, keeping its points: each on
    the side away from `direction` is set where its mirror on the `direction` side puts it, paired
    by where they stood before sculpting; one with no mirror there is laid onto the mirrored
    surface, and points that stood on the plane are set on it. Says the points set each way, the
    most moved, and the symmetry before and after.
    """
    obj = mesh_object(obj, "sculpt_symmetrize")
    need(axis in AXES, "axis must be x, y or z.")
    need(direction in ("+", "-"), "direction must be + or -: the side copied onto the other.")
    i = AXES[axis]
    sign = 1 if direction == "+" else -1
    was = measured(obj, axis)
    mesh = obj.data
    count = len(mesh.vertices)
    need(count, f"{obj.name} has no points.")
    now = numpy.empty(count * 3)
    mesh.vertices.foreach_get("co", now)
    now = now.reshape(-1, 3)
    rest = now.copy()
    if REST in mesh.attributes and mesh.attributes[REST].domain == "POINT":
        mesh.attributes[REST].data.foreach_get("vector", rest.ravel())
    size = max(float(numpy.ptp(rest, axis=0).max()), 1e-9)
    tolerance = max(PAIRED, size * 1e-6)
    side = rest[:, i] * sign
    source = numpy.nonzero(side > tolerance)[0]
    target = numpy.nonzero(side < -tolerance)[0]
    seam = numpy.nonzero(numpy.abs(side) <= tolerance)[0]
    flip = numpy.ones(3)
    flip[i] = -1
    tree = KDTree(len(source))
    for index in source:
        tree.insert(Vector(rest[index] * flip), int(index))
    tree.balance()
    placed = now.copy()
    unpaired = []
    for index in target:
        found = tree.find(Vector(rest[index]))
        if found[1] is not None and found[2] <= tolerance:
            placed[index] = now[found[1]] * flip
        else:
            unpaired.append(int(index))
    if unpaired:
        mirrored = mirrored_half(mesh, now, side > -tolerance, flip)
        for index in unpaired:
            placed[index] = numpy.array(mirrored.find_nearest(Vector(now[index]))[0][:])
    placed[seam, i] = 0.0
    matrix = numpy.array(obj.matrix_world)

    def world(p):
        return p @ matrix[:3, :3].T + matrix[:3, 3]

    moves = numpy.linalg.norm(world(placed) - world(now), axis=1)
    worst = int(numpy.argmax(moves))
    mesh.vertices.foreach_set("co", placed.ravel())
    mesh.update()
    after = measured(obj, axis)
    other = "-" if direction == "+" else "+"
    paired = len(target) - len(unpaired)
    report(
        f"Symmetrized {obj.name}'s shape across its own {axis} = 0, its {direction}{axis} side onto {other}{axis}:"
        f" {paired} point{'s' if paired != 1 else ''} set to their mirror's place, {len(unpaired)} laid onto the mirrored surface,"
        f" {len(seam)} on the seam; the most moved {length(float(moves[worst]))} at {point_text(world(placed[worst]))};"
        f" symmetry RMS {length(was['rms'])} → {length(after['rms'])}, largest {length(was['most'])} → {length(after['most'])}."
    )
    return obj


def mirrored_half(mesh, now, kept, flip):
    """The faces with a point on the side copied from, mirrored, as a tree to find the nearest place on."""
    points = [Vector(p * flip) for p in now]
    faces = [list(f.vertices) for f in mesh.polygons if any(kept[i] for i in f.vertices)]
    return BVHTree.FromPolygons(points, faces)
