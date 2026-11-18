"""
Whole-mesh sculpt filters: smooth moves each point toward its neighbours, relax evens out the
points along the surface and lays them back on it, sharpen pushes each point further from its
neighbours' mean across the surface, inflate swells along each point's normal, and noise raises
and lowers the surface by a pattern of a size in metres. A mask holds points back; an open edge's
points stay where they are under smooth, relax and sharpen. Each says what it moved, the volume
change and any new self-crossings.
"""

import mathutils.noise
import numpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .arguments import need, number, whole
from .errors import Refused
from .picking import Picked, mesh_object
from .sculpt_brushes import across, along
from .sculpt_shape import Sculpted, finish
from .wording import length, one_of

KINDS = ("smooth", "relax", "sharpen", "inflate", "noise")
BY_STRENGTH = ("smooth", "relax", "sharpen")
BY_DEPTH = ("inflate", "noise")
ROUNDED = ("smooth", "relax", "sharpen")


def refuse_unused(kind, strength, depth, size, seed, rounds):
    def refuse(option, kinds):
        raise Refused(f"{kind} takes no {option}: {option} is for {one_of(kinds).replace(' or ', ' and ')}.")

    if strength is not None and kind not in BY_STRENGTH:
        refuse("strength", BY_STRENGTH)
    if depth is not None and kind not in BY_DEPTH:
        refuse("depth", BY_DEPTH)
    if size is not None and kind != "noise":
        refuse("size", ("noise",))
    if seed is not None and kind != "noise":
        refuse("seed", ("noise",))
    if rounds is not None and kind not in ROUNDED:
        refuse("rounds", ROUNDED)


def filtered(shape, kind, strength, depth, size, seed, rounds):
    """Each point's new place in the world."""
    points, normals, free = shape.befores(), shape.normals(), shape.held()
    if kind == "inflate":
        return points + depth * free[:, None] * normals
    if kind == "noise":
        offset = Vector((seed * 17.31, seed * 31.77, seed * 7.13))
        heights = numpy.array([mathutils.noise.noise(Vector(p) / size + offset) for p in points])
        return points + depth * (free * heights)[:, None] * normals
    rim = shape.open_points()
    found = points.copy()
    surface = BVHTree.FromBMesh(shape.bm) if kind == "relax" else None
    for _ in range(rounds):
        mean = shape.neighbour_mean(found)
        if kind == "smooth":
            step = mean - found
        elif kind == "relax":
            step = across(mean - found, normals)
        else:
            step = -along(mean - found, normals)[:, None] * normals
        step = strength * free[:, None] * step
        step[rim] = 0
        found = found + step
        if surface is not None:
            found = numpy.array([surface.find_nearest(Vector(p))[0][:] for p in found])
            found[rim] = points[rim]
    return found


def sculpt_filter(obj, kind, *, strength=None, depth=None, size=None, rounds=None, seed=None, mask=None):
    """
    Filters every point of a mesh: smooth, relax and sharpen a share `strength` of the way each
    round, `rounds` times; inflate by `depth` metres along each point's normal; noise up to `depth`
    metres by a pattern whose features are `size` metres across, varied by `seed`. A vertex group
    `mask` holds points back by its weight. Says the points moved, the most, the volume change and
    any new self-crossings; returns a pick of the points it moved.
    """
    obj = mesh_object(obj, "sculpt_filter")
    need(kind in KINDS, f"kind must be {one_of(KINDS)}.")
    refuse_unused(kind, strength, depth, size, seed, rounds)
    said = []
    if kind in BY_STRENGTH:
        strength = number(strength, "strength", minimum=0, maximum=1, default=0.5)
        need(strength > 0, "strength must be more than 0.")
        rounds = whole(rounds, "rounds", minimum=1, maximum=100, default=1)
        said.append(f"strength {strength:g}")
        if rounds > 1:
            said.append(f"{rounds} rounds")
    else:
        need(depth is not None, f"{kind} needs depth: how far it moves the surface, in metres, outward when positive.")
        depth = number(depth, "depth")
        need(depth != 0, "depth must be a number of metres other than 0.")
        said.append(f"depth {length(depth)}")
    if kind == "noise":
        need(size is not None, "noise needs size: how wide its features are, in metres.")
        size = number(size, "size", minimum=0)
        need(size > 0, "size must be more than 0 metres.")
        seed = whole(seed, "seed", minimum=0, maximum=1_000_000, default=0)
        said.append(f"size {length(size)}")
        if seed:
            said.append(f"seed {seed}")
    shape = Sculpted(obj, mask)
    try:
        shape.place(filtered(shape, kind, strength, depth, size, seed, rounds))
        extra = []
        if mask is not None:
            held = int(shape.masked().sum())
            extra.append(f"the mask “{mask}” held back {held} point{'s' if held != 1 else ''}")
        outcome = finish(shape, f"Filtered {obj.name} with {kind}, {', '.join(said)}", extra)
    finally:
        shape.free()
    return Picked(obj, "verts", [int(i) for i in outcome.moved])
