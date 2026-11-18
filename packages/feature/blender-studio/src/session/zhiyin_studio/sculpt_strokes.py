"""
A sculpt stroke: points given or a curve's, laid on the surface and stepped along it, mirrored
across the object's own axes when asked; and how far each point of the mesh lies from it, which
part of it is nearest, and the surface's middle and facing under each step.
"""

import bpy
import numpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from .arguments import need, vector
from .errors import Refused
from .finding import find_object
from .tolerances import TOUCH
from .wording import length, point_text

# How far apart the steps along a stroke are, as a share of the brush's radius.
STEP = 0.25
AXES = {"x": 0, "y": 1, "z": 2}
FALLOFFS = {
    "smooth": lambda t: 1 - (3 * t**2 - 2 * t**3),
    "sphere": lambda t: numpy.sqrt(numpy.clip(1 - t**2, 0, 1)),
    "sharp": lambda t: (1 - t) ** 2,
    "linear": lambda t: 1 - t,
    "constant": lambda t: numpy.ones_like(t),
}


def curve_points(curve):
    """A curve object's points in the world, along its one spline, as Blender draws it."""
    need(len(curve.data.splines) == 1, f"The curve {curve.name} has {len(curve.data.splines)} splines; a stroke follows one.")
    evaluated = curve.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        points = [curve.matrix_world @ v.co for v in mesh.vertices]
        order = order_along(mesh)
    finally:
        evaluated.to_mesh_clear()
    return [points[i] for i in order]


def order_along(mesh):
    """The points of a curve's mesh in the order its edges join them."""
    count = len(mesh.vertices)
    links = {i: [] for i in range(count)}
    for e in mesh.edges:
        a, b = e.vertices
        links[a].append(b)
        links[b].append(a)
    ends = [i for i, joined in links.items() if len(joined) == 1]
    start = ends[0] if ends else 0
    order, seen = [start], {start}
    while True:
        nxt = [j for j in links[order[-1]] if j not in seen]
        if not nxt:
            break
        order.append(nxt[0])
        seen.add(nxt[0])
    return order


class Stroke:
    """
    The stroke as given and as laid on the surface: its words, its length, how far its farthest
    given point lay off the surface, and its steps.
    """

    def __init__(self, given, tree, radius, obj):
        self.curve = None
        if isinstance(given, str) or isinstance(given, bpy.types.Object):
            curve = find_object(given, kinds={"CURVE"}) if isinstance(given, str) else given
            need(curve.type == "CURVE", "stroke takes points, [[x, y, z], ...], or a curve object or its name.")
            self.curve = curve.name
            points = curve_points(curve)
        else:
            need(
                isinstance(given, (list, tuple)) and len(given) >= 1,
                "stroke takes points, [[x, y, z], ...], or a curve object or its name.",
            )
            points = [vector(p, "Each point of the stroke") for p in given]
        need(points, "The stroke has no points.")
        self.given = len(points)
        self.length = sum((b - a).length for a, b in zip(points, points[1:]))
        off = 0.0
        for point in points:
            nearest = tree.find_nearest(point)
            gap = (nearest[0] - point).length
            if gap > radius:
                raise Refused(
                    f"The stroke's point {point_text(point)} lies {length(gap)} from {obj.name}'s surface,"
                    f" past the brush's radius of {length(radius)}: give points on the surface, or a curve laid on it."
                )
            off = max(off, gap)
        self.off = off
        self.first = points[0]
        self.steps = laid(stepped(points, radius * STEP), tree)

    def words(self):
        if self.curve:
            said = f"along the curve {self.curve}, {length(self.length)}"
        elif self.given == 1:
            said = f"at {point_text(self.first)}"
        else:
            said = f"along {self.given} points, {length(self.length)}"
        # Laid on the surface: a given point within TOUCH of it is on it already.
        if self.off > TOUCH:
            said += f", laid on the surface (the farthest {length(self.off)} off)"
        return said


def stepped(points, spacing):
    """Points along the path through `points`, no further apart than `spacing`, both ends included."""
    found = [points[0]]
    for a, b in zip(points, points[1:]):
        span = (b - a).length
        count = max(1, int(numpy.ceil(span / spacing))) if span > 0 else 0
        found.extend(a.lerp(b, (i + 1) / count) for i in range(count))
    return found


def laid(points, tree):
    """Each point moved onto the nearest place on the surface."""
    return [tree.find_nearest(p)[0].copy() for p in points]


def mirrors(obj, axes):
    """
    The world's mappings that mirror across the object's own planes for each axis named, with
    the plain one first: one per combination of the axes, as Blender's symmetry repeats a stroke.
    """
    found = [Matrix.Identity(4)]
    matrix = obj.matrix_world
    inverse = matrix.inverted()
    for axis in axes:
        flip = Matrix.Identity(4)
        flip[AXES[axis]][AXES[axis]] = -1
        across = matrix @ flip @ inverse
        found += [across @ m for m in found]
    return found


def mirror_axes(mirror):
    """The axes a stroke repeats across, from "x", "xy", "xyz" and so on."""
    if mirror is None or mirror == "":
        return ""
    need(
        isinstance(mirror, str) and all(c in AXES for c in mirror) and len(set(mirror)) == len(mirror),
        'mirror must name the object\'s own axes to repeat the stroke across: "x", "y", "z", "xy", "xz", "yz" or "xyz".',
    )
    return "".join(c for c in "xyz" if c in mirror)


class Copy:
    """
    One copy of the stroke, plain or mirrored: its steps laid on the surface, the mapping that
    made it, and how far its farthest step lay off the surface before it was laid there.
    """

    def __init__(self, steps, mapping, tree):
        self.mapping = mapping
        self.turn = mapping.to_3x3()
        mapped = [mapping @ s for s in steps]
        on = laid(mapped, tree)
        self.off = max((a - b).length for a, b in zip(mapped, on))
        self.steps = numpy.array([s[:] for s in on], dtype=numpy.float64)


class Reach:
    """
    For points of the mesh: how far each lies from the nearest copy of the stroke, the nearest
    place on it, which copy and which step is nearest.
    """

    def __init__(self, points, copies):
        count = len(points)
        self.distance = numpy.full(count, numpy.inf)
        self.nearest = numpy.zeros((count, 3))
        self.copy = numpy.zeros(count, dtype=numpy.int64)
        self.step = numpy.zeros(count, dtype=numpy.int64)
        for c, copy in enumerate(copies):
            steps = copy.steps
            if len(steps) == 1:
                candidates = [(steps[0], steps[0], 0)]
            else:
                candidates = [(steps[i], steps[i + 1], i) for i in range(len(steps) - 1)]
            for a, b, i in candidates:
                span = b - a
                square = float(span @ span)
                t = numpy.clip(((points - a) @ span) / square, 0, 1) if square > 0 else numpy.zeros(count)
                q = a + t[:, None] * span
                d = numpy.linalg.norm(points - q, axis=1)
                closer = d < self.distance
                self.distance[closer] = d[closer]
                self.nearest[closer] = q[closer]
                self.copy[closer] = c
                self.step[closer] = numpy.where(t[closer] > 0.5, i + 1, i) if len(steps) > 1 else 0


def frames(copies, points, normals, radius, falloff, tree):
    """
    Under each step of each copy: the surface's middle and facing, weighted by the falloff over
    the points within the radius; where no point is within it, the surface's own place and facing.
    """
    found = []
    for copy in copies:
        middles, facings = [], []
        for step in copy.steps:
            gaps = numpy.linalg.norm(points - step, axis=1)
            inside = gaps < radius
            if inside.any():
                weights = falloff(gaps[inside] / radius)
                weights = weights if weights.sum() > 0 else numpy.ones_like(weights)
                middle = (points[inside] * weights[:, None]).sum(axis=0) / weights.sum()
                facing = (normals[inside] * weights[:, None]).sum(axis=0)
            else:
                nearest = tree.find_nearest(Vector(step))
                middle, facing = numpy.array(nearest[0][:]), numpy.array(nearest[1][:])
            size = numpy.linalg.norm(facing)
            middles.append(middle)
            facings.append(facing / size if size > 0 else numpy.array([0.0, 0.0, 1.0]))
        found.append((numpy.array(middles), numpy.array(facings)))
    return found


def surface_tree(bm):
    return BVHTree.FromBMesh(bm)
