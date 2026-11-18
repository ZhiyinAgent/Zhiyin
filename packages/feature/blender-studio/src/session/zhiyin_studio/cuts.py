"""
What a boolean did to its part, measured on the part's shape before and
after it: the volume it took away or added, and the cut's size across and
depth along the cutter's own axis. A cut that takes nothing away is refused,
with why where it can be told.
"""

from mathutils.bvhtree import BVHTree

from .errors import Refused
from .soundness import mesh_of
from .wording import length, point_text, size_text, volume_text

# A change smaller than this share of the part's volume is arithmetic, not a cut.
NOTHING = 1e-6
# A hole this close to the cutter's own width across is the cutter's whole width.
WHOLE = 0.02
# Less than a thousandth of a millimetre deep or across is no cut at all.
FLAT = 1e-6


class Shape:
    """An object's evaluated shape in the world: its points, whether it is closed, and its volume when it is."""

    def __init__(self, obj):
        bm = mesh_of(obj)
        try:
            self.closed = bool(bm.edges) and all(e.is_manifold for e in bm.edges)
            self.volume = bm.calc_volume(signed=False) if self.closed else None
            self.points = [v.co.copy() for v in bm.verts]
            self.tree = BVHTree.FromBMesh(bm) if bm.faces else None
        finally:
            bm.free()

    def bounds(self):
        if not self.points:
            return None
        return [min(p[i] for p in self.points) for i in range(3)], [max(p[i] for p in self.points) for i in range(3)]

    def same_as(self, other):
        def key(points):
            return sorted(tuple(round(c, 6) for c in p) for p in points)

        return key(self.points) == key(other.points)


def reach_text(shape):
    low, high = shape.bounds()
    return f"from {point_text(low)} to {point_text(high)}"


def overlap(one, other):
    """Whether two shapes' surfaces cross, or one lies inside the other's box."""
    if one.tree is None or other.tree is None:
        return False
    if one.tree.overlap(other.tree):
        return True
    (low, high), (their_low, their_high) = one.bounds(), other.bounds()
    return all(low[i] <= their_high[i] and their_low[i] <= high[i] for i in range(3))


def nothing_taken(obj, other, before, cutter):
    why = ""
    if not cutter.closed:
        why = (
            f" {other.name} is not closed, and a cutter takes away only what a closed solid encloses:"
            " cut with a closed shape, such as a cutter described in the call."
        )
    elif not overlap(before, cutter):
        why = (
            f" The cutter, {reach_text(cutter)}, does not reach {obj.name}, {reach_text(before)}:"
            " move it so it passes into the part."
        )
    else:
        why = (
            f" The cutter, {reach_text(cutter)}, meets {obj.name}, {reach_text(before)}, without passing into it:"
            " move it so it passes into the part."
        )
    raise Refused(f"The cut takes nothing away from {obj.name}.{why}")


def changed(before, after):
    """The volume a step took away (above 0) or added (below 0), or nothing when it cannot be measured."""
    if before.volume is None or after.volume is None:
        return None
    return before.volume - after.volume


def cut_size(after, before, cutter, other):
    """The cut's size across and its depth along the cutter's own axis, from the part's points on the cutter's surface."""
    reach = max(other.dimensions) or 1.0
    near = max(1e-7, 1e-5 * reach)
    on = []
    for point in after.points if cutter.tree is not None else []:
        found = cutter.tree.find_nearest(point)
        if found[0] is not None and found[3] <= near:
            on.append(point)
    if not on:
        return None
    turn = other.matrix_world.to_3x3()
    axes = [turn.col[i].normalized() for i in range(3)]

    def extent(points, axis):
        along = [p.dot(axis) for p in points]
        return max(along) - min(along)

    across = [extent(on, axes[0]), extent(on, axes[1])]
    depth = extent(on, axes[2])
    # Through when the cut is as deep as the part is thick along the axis.
    thick = extent(before.points, axes[2])
    return across, depth, abs(depth - thick) <= max(near, WHOLE * thick) * 0.5, thick


def cut_text(obj, other, operation, shape, given, before, after, cutter):
    """What a boolean did, measured; a cut that took nothing away is refused."""
    volume = changed(before, after)
    size = cut_size(after, before, cutter, other) if operation == "difference" else None
    if operation == "difference" and (
        before.same_as(after)
        or (volume is not None and volume <= NOTHING * before.volume)
        # An open cutter splits the part's faces where it crosses them and takes nothing.
        or (volume is None and (size is None or min(size[0][0], size[0][1], size[1]) <= FLAT))
    ):
        nothing_taken(obj, other, before, cutter)
    if operation == "intersect" and not after.points:
        raise Refused(
            f"The intersection leaves nothing of {obj.name}: the other shape, {reach_text(cutter)},"
            f" does not reach {obj.name}, {reach_text(before)}."
        )
    # A cutter described in the call is named by its shape.
    named = f"a {shape} " if shape else "a "
    if operation == "union":
        return f"{named}union" + (f", adding {volume_text(-volume)}" if volume is not None and volume < 0 else "")
    if operation == "intersect":
        return f"{named}intersection" + (f", keeping {volume_text(after.volume)}" if after.volume is not None else "")
    away = f", taking away {volume_text(volume)}" if volume is not None else ""
    if size is None:
        return f"{named}cut{away}"
    across, depth, through, thick = size
    round_hole = shape == "cylinder" and given is not None and all(abs(a - given) <= WHOLE * given for a in across)
    what = f"a round hole {length(given)} across" if round_hole else f"{named}cut {size_text(across)} across"
    deep = f", through its {length(thick)}" if through else f" and {length(depth)} deep"
    return what + deep + away
