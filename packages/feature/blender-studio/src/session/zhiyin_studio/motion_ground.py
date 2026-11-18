"""
Feet and wheels against what they stand on, at every frame a motion is checked: the parts named as
feet, paws, hooves, shoes, wheels or tyres, how far each one's lowest point goes into the surface
under it, and when deepest. A floor is a plane with no inside, so a part sunk into it is no overlap
of two volumes: the depth is measured from the surface down to the part's lowest point.
"""

import re

import mathutils

from .tolerances import STANDS_IN
from .wording import length

# What a part is named for it to be taken as a foot or a wheel.
GROUNDED = re.compile(r"foot|feet|paw|hoof|hooves|shoe|boot|toe|wheel|tyre|tire|caster|castor", re.IGNORECASE)
# How many parts are named; the rest are counted.
SAID = 4


def grounded(objects):
    """The parts among `objects` named as feet or wheels."""
    return [obj for obj in objects if GROUNDED.search(obj.name)]


def depth_into(obj, point, height, around, depsgraph):
    """
    How far a part's lowest point lies under the top surface of another mesh beneath it, within
    half the part's height, and that mesh; or nothing when it is under none.
    """
    reach = max(height / 2, 2 * STANDS_IN)
    start = point + mathutils.Vector((0, 0, reach))
    deepest = None
    for other, low, high in around:
        if other == obj or not (low.x <= point.x <= high.x and low.y <= point.y <= high.y and low.z <= start.z and high.z >= point.z):
            continue
        to_own = other.matrix_world.inverted()
        way = to_own.to_3x3() @ mathutils.Vector((0, 0, -1))
        try:
            # An object's ray cast answers whether it hit first, then where.
            hit, where, _, _ = other.evaluated_get(depsgraph).ray_cast(to_own @ start, way.normalized(), distance=(way * reach).length)
        except RuntimeError:
            continue
        if not hit:
            continue
        depth = (other.matrix_world @ where).z - point.z
        if depth > STANDS_IN and (deepest is None or depth > deepest[0]):
            deepest = (depth, other)
    return deepest


class Ground:
    """The feet and wheels among the moving parts, and how deep each goes into what it stands on."""

    def __init__(self, moving):
        self.parts = grounded(moving)
        self.deepest = {}
        self.frames_in = {}

    def see(self, frame, obj, point, height, around, depsgraph):
        if obj not in self.parts or point is None:
            return
        found = depth_into(obj, point, height, around, depsgraph)
        if found is None:
            return
        self.frames_in[obj.name] = self.frames_in.get(obj.name, 0) + 1
        if found[0] > self.deepest.get(obj.name, (0.0,))[0]:
            self.deepest[obj.name] = (found[0], found[1].name, frame)

    def lines(self, when):
        """What the answer says of them: which parts were taken as feet and wheels, and those that went in."""
        if not self.parts:
            return []
        names = [o.name for o in self.parts]
        more = len(names) - SAID
        taken = ", ".join(names[:SAID]) + (f" and {more} more" if more > 0 else "")
        if not self.deepest:
            return [f"Feet and wheels, by their names ({taken}): none goes into what it stands on."]
        ranked = sorted(self.deepest.items(), key=lambda item: -item[1][0])
        said = [
            f"{name} {length(depth)} into {under} at {when(frame)}, in it at {self.frames_in[name]} frame{'s' if self.frames_in[name] != 1 else ''}"
            for name, (depth, under, frame) in ranked[:SAID]
        ]
        return [f"Feet and wheels, by their names ({taken}), going into what they stand on, deepest first: {'; '.join(said)}."]
