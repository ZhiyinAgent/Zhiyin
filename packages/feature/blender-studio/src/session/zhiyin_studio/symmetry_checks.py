"""
Whether a part is the same on both sides of its own x, y or z = 0 as it shows, and what a change did
to a part that was: a part whose every point has a mirror on the other side before a call, and not
after it, is said with how far its surface strays from its mirror, as an RMS and the largest, and
where. What each shape was is kept by the shape itself, so a part is measured once until it
changes, and the measures before a call stop at a time they are given; a part past that time, or
past the points measured, has no symmetry before to compare.
"""

import time

import mathutils
import numpy
from mathutils.bvhtree import BVHTree

from . import budget
from .geometry import evaluated_graph
from .sculpt_symmetry import across
from .soundness import mesh_of
from .wording import length, point_text

AXES = "xyz"
# The most points a part has to be measured for its symmetry.
MOST_POINTS = 200_000
# A point has a mirror when one lies within this share of the part's size of where it is mirrored to.
SAME_SHARE = 1e-5
# A part is the same on both sides when this share of its points have a mirror.
MIRRORED = 0.995
# How long the measures before a call may take, in seconds, for the parts not yet measured.
BEFORE_SECONDS = 1.0
# How many places on a part's surface are measured to its mirror after a change.
SAMPLES = 4000
# A part is no longer symmetric when its surface strays from its mirror by more than this share of its size, and this far.
STRAY_SHARE, STRAY_LEAST = 0.005, 1e-4
# The most shapes whose symmetry is kept.
KEPT = 20_000

known = {}


def own_points(obj):
    """A mesh's points as it shows, in its own space, or None when it has none or too many to measure."""
    data = obj.evaluated_get(evaluated_graph()).data
    count = len(data.vertices)
    if not count or count > MOST_POINTS:
        return None
    points = numpy.empty(count * 3, dtype=numpy.float64)
    data.vertices.foreach_get("co", points)
    return points.reshape(-1, 3)


def mirrored_axes(points):
    """The axes of its own across which a set of points is the same on both sides."""
    reach = float(numpy.ptp(points, axis=0).max()) if len(points) else 0.0
    if reach <= 0:
        return ""
    step = reach * SAME_SHARE
    grid = numpy.round(points / step).astype(numpy.int64)
    rows = numpy.ascontiguousarray(grid).view(numpy.dtype((numpy.void, grid.dtype.itemsize * 3))).ravel()
    found = ""
    for index, axis in enumerate(AXES):
        flipped = grid.copy()
        flipped[:, index] = -flipped[:, index]
        mirrors = numpy.ascontiguousarray(flipped).view(rows.dtype).ravel()
        if numpy.isin(mirrors, rows).mean() >= MIRRORED:
            found += axis
    return found


def _key(points):
    return (len(points), hash(points.tobytes()))


def axes_of(obj):
    """The axes a mesh is the same on both sides of, measured or as kept; None past the points measured."""
    points = own_points(obj)
    if points is None:
        return None
    key = _key(points)
    if key not in known:
        if len(known) >= KEPT:
            known.clear()
        known[key] = mirrored_axes(points)
    return known[key]


def symmetric_before(objects):
    """Each mesh's axes of symmetry before a call, by its name; those not measured in the time given are left out."""
    deadline = time.time() + budget.share(BEFORE_SECONDS)
    found = {}
    for obj in objects:
        if obj.type != "MESH":
            continue
        points = own_points(obj)
        if points is None:
            continue
        key = _key(points)
        if key not in known:
            if time.time() > deadline:
                continue
            if len(known) >= KEPT:
                known.clear()
            known[key] = mirrored_axes(points)
        if known[key]:
            found[obj.name] = known[key]
    return found


def strayed(obj, axis):
    """How far a mesh's surface strays from its mirror across its own axis = 0: RMS, largest and where, in the world."""
    bm = mesh_of(obj)
    try:
        if not bm.faces:
            return None
        tree = BVHTree.FromBMesh(bm)
        bm.verts.ensure_lookup_table()
        places = [bm.verts[i].co.copy() for i in range(0, len(bm.verts), max(1, len(bm.verts) // SAMPLES))]
    finally:
        bm.free()
    mapping = across(obj, axis)
    gaps = []
    for place in places:
        mirrored = mapping @ place
        nearest = tree.find_nearest(mirrored)[0]
        gaps.append((nearest - mirrored).length if nearest is not None else 0.0)
    gaps = numpy.array(gaps)
    worst = int(numpy.argmax(gaps))
    return float(numpy.sqrt((gaps**2).mean())), float(gaps[worst]), places[worst]


def symmetry_lost(obj, before):
    """What a change did to a part that was the same on both sides of `before`, its own axes, in words: nothing when it still is."""
    if not before or obj.type != "MESH":
        return ""
    now = axes_of(obj)
    if now is None:
        return ""
    lost = [axis for axis in before if axis not in now]
    if not lost:
        return ""
    corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    size = max((max(c[i] for c in corners) - min(c[i] for c in corners)) for i in range(3))
    said = {}
    for axis in lost:
        found = strayed(obj, axis)
        if found is None:
            continue
        rms, most, where = found
        if most <= max(STRAY_SHARE * size, STRAY_LEAST):
            continue
        said[axis] = f"across {axis} its surface strays from its mirror by RMS {length(rms)}, up to {length(most)} at {point_text(where)}"
    if not said:
        return ""
    planes = " and ".join(f"{axis} = 0" for axis in said)
    return f"{obj.name} was the same on both sides of its own {planes} and no longer is: {'; '.join(said.values())}"
