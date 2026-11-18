"""
What goes into what, by objects, as measuring takes two shapes, each with its parts and the
copies it places; and see-through shapes whose surfaces lie in the very same place.
"""

import bpy
import mathutils

from . import geometry
from .finding import subjects
from .geometry import bounds_of, copies_named, held_still, holds
from .material_marks import lets_light_through
from .measure_shapes import Mesh, Shape, into
from .wording import area_text, length


def shape_of(obj):
    """An object's shape with its parts' and the copies each places, in the world, as measuring takes it."""
    return Shape(Mesh.of_object(obj), label=obj.name)


def goes_into(obj, others):
    """
    Which of `others` an object goes into, and how deep, or None where their
    surfaces cross and no depth is measured: as deep from either side.
    """
    with held_still():
        own = bounds_of(obj)
        if not own:
            return []
        near = [
            other
            for other in others
            # Its own parts, and a group it is a part of, are the same thing.
            if other != obj and not holds(obj, other) and not holds(other, obj)
            and (theirs := bounds_of(other))
            and all(own[1][i] >= theirs[0][i] and own[0][i] <= theirs[1][i] for i in range(3))
        ]
        if not near:
            return []
        return measured_into(obj, near)


def measured(obj):
    """An object's shape as shape_of gives it, kept while the scene is held still."""
    # Read where held_still sets it, as it is now.
    still = geometry.still
    if still is None:
        return shape_of(obj)
    key = obj.as_pointer()
    if key not in still.measured:
        lasting = still.lasting
        if lasting is not None and key in lasting.unchanging:
            if key not in lasting.measured:
                lasting.measured[key] = shape_of(obj)
            still.measured[key] = lasting.measured[key]
        else:
            still.measured[key] = shape_of(obj)
    return still.measured[key]


def measured_into(obj, near):
    """Which of the shapes near an object it goes into, and how deep."""
    mine = measured(obj)
    still = geometry.still
    found = []
    for other in near:
        # As deep from either side: each two measured once while the scene is held still.
        pair = tuple(sorted((obj.as_pointer(), other.as_pointer())))
        known = still.pairs.get(pair) if still is not None else None
        if known is None:
            went = into(mine, measured(other))
            known = (went is not None, went[0] or None if went is not None else None)
            if still is not None:
                still.pairs[pair] = known
        if known[0]:
            found.append((other, known[1]))
    return found


def into_text(obj, others, most=None):
    """
    What an object goes into, each with how deep. With `most`, the deepest
    that many and a count of the rest: a part joined from many, as a script
    makes them, goes into a dozen neighbours and names none of them usefully.
    """
    with held_still():
        found = goes_into(obj, others)
        rest = 0
        if most is not None and len(found) > most:
            found = sorted(found, key=lambda pair: pair[1] or 0, reverse=True)
            rest = len(found) - most
            found = found[:most]
        # What an object places as instances is told by what they copy.
        said = [
            f"goes {length(depth)} into {copies_named(other)}" if depth else f"goes into {copies_named(other)}"
            for other, depth in found
        ]
    return said + ([f"goes into {rest} more"] if rest else [])


# Surfaces nearer than this are in the same place to a renderer.
SAME_PLACE = 1e-6
# The share of the smaller shape's surface that has to be there for a picture to show it.
SHARED_ENOUGH = 0.01


def shared_surface(mine, theirs):
    """How much of one shape's surface lies in the very place of another's, facing the same way or against it."""
    shared = 0.0
    for middle, facing, area in zip(*mine.face_samples()):
        location, normal, _, distance = theirs.surface.find_nearest(mathutils.Vector(middle), SAME_PLACE * 100)
        if location is not None and distance < SAME_PLACE and abs(normal.dot(mathutils.Vector(facing))) > 0.999:
            shared += float(area)
    return shared


def in_the_same_place():
    """
    Pairs of see-through shapes with surfaces in the very same place, each as
    a sentence. A renderer cannot tell which of the two a ray meets first
    there, and draws wedges of one and of the other. Where one of the two is
    solid it hides the place, and nothing shows.
    """
    bpy.context.view_layer.update()
    clear = [(obj, bounds_of(obj)) for obj in subjects() if lets_light_through(obj)]
    shapes = {}
    said = []
    for index, (one, own) in enumerate(clear):
        for other, theirs in clear[index + 1 :]:
            # A part and what it is attached to are measured as one shape.
            if one in other.children_recursive or other in one.children_recursive or not (own and theirs):
                continue
            if not all(own[1][i] >= theirs[0][i] - SAME_PLACE and own[0][i] <= theirs[1][i] + SAME_PLACE for i in range(3)):
                continue
            for obj in (one, other):
                if obj.name not in shapes:
                    shapes[obj.name] = shape_of(obj)
            first, second = shapes[one.name], shapes[other.name]
            # A face counts whole when its middle is there, so the side with
            # the finer faces, which counts less, is the nearer measure.
            counted = [area for area in (shared_surface(first, second), shared_surface(second, first)) if area > 0]
            shared = min(counted, default=0.0)
            if shared > SHARED_ENOUGH * min(first.area, second.area):
                said.append(
                    f"{one.name} and {other.name} are both see-through and have {area_text(shared)} of their surfaces in the same place, "
                    "where a picture shows wedges of one and of the other: let one reach a fraction of a millimetre into the other."
                )
    return said
