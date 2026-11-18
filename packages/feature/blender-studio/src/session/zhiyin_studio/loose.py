"""
Which separate pieces of an object nothing holds: a blade left standing where
its hub was cut away, a bolt put beside its hole. A piece is held when it
rests on, lies against, goes into or holds another piece of the same object,
or the shape of another object in the picture, or comes within HELD of it,
as a pin turning in its bore or a piston sliding in its cylinder does, or
stands on the floor. And which objects float whole: none of their pieces
held by anything but one another.
"""

import time

import mathutils
import numpy

from .arguments import need
from .geometry import bounds_of, has_shape, parts_below, shapes_of
from .mesh_math import pieces
from .shown_mesh import Triangles, is_inside, triangles_of
from .tolerances import HELD
from .wording import length

# The share of a shape's distance from the origin the precision of its points
# loses, added to HELD.
FAR_SHARE = 1e-6
# The most corners of one piece measured against another: beyond, the
# crossing of their surfaces still shows a touch.
MOST_CORNERS = 20000
DOWN = mathutils.Vector((0, 0, -1))
# Kept on an object meant to stay in the air, as a bird or a drone: it is never said to float.
FLYING = "zhiyin_flying"


def pieces_of(obj):
    """An object's separate pieces, its parts' with them: each a set of triangles joined by their corners."""
    return [Triangles(own_corners, own_triangles) for own_corners, own_triangles in pieces(*triangles_of(shapes_of(obj)))]


def _own_shape(obj):
    """An object's own shape, without its parts', or None when it has none."""
    corners, triangles = triangles_of([obj])
    return Triangles(corners, triangles) if len(triangles) else None


def _reach(a, b):
    far = max(numpy.abs(a.low).max(), numpy.abs(a.high).max(), numpy.abs(b.low).max(), numpy.abs(b.high).max())
    return HELD + FAR_SHARE * far


def _corners_on(a, b, reach):
    """Whether a corner of `a` lies within `reach` of `b`'s surface."""
    inside = ((a.corners >= b.low - reach) & (a.corners <= b.high + reach)).all(axis=1)
    near = a.corners[inside]
    step = max(1, len(near) // MOST_CORNERS)
    return any(b.tree.find_nearest(point, reach)[0] is not None for point in near[::step].tolist())


def touches(a, b):
    """Whether one surface holds the other: a corner of one within HELD of the other, their faces crossing, or one inside the other."""
    reach = _reach(a, b)
    if not a.near(b, reach):
        return False
    return (
        _corners_on(a, b, reach)
        or _corners_on(b, a, reach)
        or bool(a.tree.overlap(b.tree))
        or (b.closed and is_inside(b.tree, mathutils.Vector(a.corners[0])))
        or (a.closed and is_inside(a.tree, mathutils.Vector(b.corners[0])))
    )


def mark_flying(obj, flying):
    """Marks an object as meant to stay in the air, as a bird or a drone, or no longer; what the answer says of it."""
    need(isinstance(flying, bool), "flying is true or false.")
    if flying:
        obj[FLYING] = True
    elif FLYING in obj:
        del obj[FLYING]
    return "marked as flying, so never said to float" if flying else "no longer marked as flying"


def meant_to_hang(obj):
    """
    Whether an object hangs from something by design: attached to another,
    held by a constraint that follows another, moved by keys or drivers,
    left to a simulation that drops it, or marked as flying.
    """
    if obj.parent is not None or obj.rigid_body is not None or obj.get(FLYING):
        return True
    if any(getattr(c, "target", None) is not None and not c.mute for c in obj.constraints):
        return True
    motion = obj.animation_data
    return motion is not None and (motion.action is not None or bool(motion.drivers))


class Checker:
    """
    Finds each object's pieces that nothing holds, and objects that float
    whole, for at most `seconds` over a whole description: the objects left
    when time runs out are said unchecked rather than taken as held.

    The floor holds what stands on it: z = 0 when the scene's shapes reach
    it, and otherwise the bottom of the lowest of them, so an object alone
    stands on the floor wherever it is.
    """

    def __init__(self, others, seconds):
        self.others = others
        self.deadline = time.time() + seconds
        self.shapes = {}
        self.split = {}
        # How each object a description tells stands, gathered for the line of what touches nothing.
        self.standings = []
        self.unchecked = []
        self.level = None

    def pieces(self, obj):
        """An object's separate pieces, worked out once."""
        key = obj.as_pointer()
        if key not in self.split:
            self.split[key] = pieces_of(obj)
        return self.split[key]

    def _shape(self, obj):
        key = obj.as_pointer()
        if key not in self.shapes:
            self.shapes[key] = _own_shape(obj) if has_shape(obj) else None
        return self.shapes[key]

    def floor(self):
        """The height the floor is at."""
        if self.level is None:
            boxes = [box for other in self.others if (box := bounds_of(other))]
            low = min((box[0].z for box in boxes), default=0.0)
            high = max((box[1].z for box in boxes), default=0.0)
            self.level = 0.0 if low <= HELD and high >= -HELD else low
        return self.level

    def in_time(self, obj):
        """Whether time is left to check an object; one past it is named unchecked."""
        if time.time() > self.deadline:
            if obj.name not in self.unchecked:
                self.unchecked.append(obj.name)
            return False
        return True

    def near(self, obj, own):
        """The others whose boxes come within HELD of an object's, but for its own parts in `own`."""
        box = bounds_of(obj)
        if box is None:
            return []
        return [
            other
            for other in self.others
            if other.as_pointer() not in own
            and (theirs := bounds_of(other))
            and all(box[1][i] + HELD >= theirs[0][i] and box[0][i] - HELD <= theirs[1][i] for i in range(3))
        ]

    def _on_floor(self, piece):
        return piece.low[2] <= self.floor() + HELD + FAR_SHARE * float(numpy.abs(piece.low).max())

    def below(self, pieces, own, box, floor_level=False):
        """
        The nearest shape straight under an object's pieces, above the floor,
        or with `floor_level` at it too, and how far below their lowest point
        over it: (gap, object), or None. The gap is sought down from the
        pieces' corners and up from the other's, so a sheet wider than a table
        finds the table under its middle.
        """
        found = None
        for other in self.others:
            theirs = bounds_of(other) if other.as_pointer() not in own else None
            if not theirs or theirs[0].z >= box[0].z or not all(
                box[1][i] >= theirs[0][i] and box[0][i] <= theirs[1][i] for i in (0, 1)
            ):
                continue
            shape = self._shape(other)
            if shape is None:
                continue
            for piece in pieces:
                step = max(1, len(piece.corners) // MOST_CORNERS)
                for point in piece.corners[::step].tolist():
                    hit = shape.tree.ray_cast(mathutils.Vector(point), DOWN)
                    if hit[0] is not None and (floor_level or hit[0].z > self.floor() + HELD) and (found is None or hit[3] < found[0]):
                        found = (hit[3], other)
                step = max(1, len(shape.corners) // MOST_CORNERS)
                for point in shape.corners[::step].tolist():
                    if not (floor_level or point[2] > self.floor() + HELD):
                        continue
                    hit = piece.tree.ray_cast(mathutils.Vector(point), -DOWN)
                    if hit[0] is not None and (found is None or hit[3] < found[0]):
                        found = (hit[3], other)
        return found

    def loose_text(self, obj):
        """
        How many of an object's pieces nothing holds, when two or more are its
        and any is; and when none of them touches another object or the floor,
        that the object floats, unless it is meant to hang.
        """
        if time.time() > self.deadline:
            self.unchecked.append(obj.name)
            return None
        pieces = self.pieces(obj)
        if not pieces:
            return None
        hangs = meant_to_hang(obj)
        if len(pieces) < 2 and hangs:
            return None
        box = bounds_of(obj)
        own = {o.as_pointer() for o in [obj, *parts_below(obj)]}
        around = self.near(obj, own)

        def held_outside(piece):
            return self._on_floor(piece) or any(
                (shape := self._shape(other)) is not None and touches(piece, shape) for other in around
            )

        touched = [False] * len(pieces)
        outside = False
        for i, piece in enumerate(pieces):
            if touched[i]:
                continue
            if time.time() > self.deadline:
                self.unchecked.append(obj.name)
                return None
            for j in range(len(pieces)):
                if j != i and touches(piece, pieces[j]):
                    touched[i] = touched[j] = True
                    break
            else:
                touched[i] = held_outside(piece)
                outside = outside or touched[i]
        said = []
        loose = touched.count(False)
        # Pieces that hold one another may still float together.
        floats = not hangs and not outside and not any(held_outside(p) for p, held in zip(pieces, touched) if held)
        # Every piece of a floating object held by nothing is what its floating says.
        if loose and len(pieces) > 1 and not (floats and loose == len(pieces)):
            said.append(f"{loose} of its {len(pieces)} pieces {'is' if loose == 1 else 'are'} held by nothing")
        if floats:
            floor = self.floor()
            under = self.below(pieces, own, box)
            above = (
                f"{length(under[0])} above {under[1].name}"
                if under is not None
                else f"{length(box[0].z - floor)} above the floor" + (f" at {length(floor)}" if floor else "")
            )
            touching = "it touches" if len(pieces) == 1 else f"its {len(pieces)} pieces touch"
            said.append(
                f"held by nothing: {touching} no other shape and its bottom is {above}; "
                "unless it is meant to float, rest it on what holds it or attach it to what it hangs from"
            )
        return "; ".join(said) or None
