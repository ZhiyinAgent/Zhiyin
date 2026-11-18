"""
What holds each object up, by the surfaces that touch it: what it rests on, what it hangs from,
what it stands against and what it is set into, the floor included; or, touching nothing, how far
above what is under it it stands, the farthest first. An object attached to another is held by
that, and is not said. One marked as flying, moved by keys, held by a constraint or given to a
simulation is said as touching nothing for that reason.
"""

import mathutils
import numpy

from .loose import FLYING, MOST_CORNERS, _reach, touches
from .overlaps import goes_into
from .tolerances import HELD
from .wording import in_brief, length, stems_text

# A surface pushes an object up where it faces up by this much, and down where it faces down by as much.
UPRIGHT = 0.5
# Past this many held objects, those held alike are said together.
GROUPED_PAST = 12


class Standing:
    """An object as it stands: the words for it, and how far above what is under it when it touches nothing."""

    def __init__(self, name, words, gap=None):
        self.name, self.words, self.gap = name, words, gap


def why_aloft(obj):
    """Why an object touching nothing is meant to: marked flying, keys, a constraint or a simulation; nothing when it is not."""
    if obj.get(FLYING):
        return "flying"
    if obj.rigid_body is not None:
        return "given to a rigid body simulation"
    if any(getattr(c, "target", None) is not None and not c.mute for c in obj.constraints):
        return "held by a constraint"
    motion = obj.animation_data
    if motion is not None and (motion.action is not None or bool(motion.drivers)):
        return "moved by keys"
    return ""


def inward(point, middle):
    """A point moved two HELD toward a middle: a step into the shape it lies on."""
    point = mathutils.Vector(point)
    way = middle - point
    return point + way.normalized() * 2 * HELD if way.length > 2 * HELD else point


def pushes(obj_pieces, middle, shape):
    """
    How the other shape pushes the object where they touch: for each contact point, the up
    share of the push, from the other's surface turned toward the object's middle, or the
    object's own surface turned away from it.
    """
    ups = []
    low, high = shape.low, shape.high
    their_middle = mathutils.Vector((low + high) / 2)
    for piece in obj_pieces:
        reach = _reach(piece, shape)
        near = piece.corners[((piece.corners >= low - reach) & (piece.corners <= high + reach)).all(axis=1)]
        for point in near[:: max(1, len(near) // MOST_CORNERS)].tolist():
            if shape.tree.find_nearest(point, reach)[0] is None:
                continue
            # Read a step into the object, so a touch on an edge of either
            # takes the face it pushes through, not the one beside it.
            hit = shape.tree.find_nearest(inward(point, middle), 4 * reach)
            if hit[0] is None:
                continue
            way = mathutils.Vector(hit[1])
            if way.dot(middle - hit[0]) < 0:
                way = -way
            ups.append(way.z)
        theirs = shape.corners[((shape.corners >= piece.low - reach) & (shape.corners <= piece.high + reach)).all(axis=1)]
        for point in theirs[:: max(1, len(theirs) // MOST_CORNERS)].tolist():
            if piece.tree.find_nearest(point, reach)[0] is None:
                continue
            hit = piece.tree.find_nearest(inward(point, their_middle), 4 * reach)
            if hit[0] is None:
                continue
            out = mathutils.Vector(hit[1])
            if out.dot(hit[0] - middle) < 0:
                out = -out
            ups.append(-out.z)
    return ups


def own_of(obj):
    return {o.as_pointer() for o in [obj, *obj.children_recursive]}


def contacts(obj, checker, pieces):
    """The shapes touching an object, by how they push it: under it, on its top, beside it, or set in it."""
    box = obj_box(pieces)
    middle = mathutils.Vector((box[0] + box[1]) / 2)
    under, above, beside, inside = [], [], [], []
    for other in checker.near(obj, own_of(obj)):
        shape = checker._shape(other)
        if shape is None or not any(touches(piece, shape) for piece in pieces):
            continue
        # One going into the other is set in it, measured on their shapes a hair inside.
        if goes_into(obj, [other]):
            inside.append(other)
            continue
        ups = pushes(pieces, middle, shape)
        if not ups:
            inside.append(other)
        elif max(ups) >= UPRIGHT:
            under.append(other)
        elif min(ups) <= -UPRIGHT:
            above.append(other)
        else:
            beside.append(other)
    return under, above, beside, inside


def held_besides(other, obj, checker):
    """
    Whether something besides an object holds another up: the other is attached, meant to stay
    aloft, on the floor, or rests on or is set into a shape that is not the object.
    """
    if other.parent is not None or why_aloft(other):
        return True
    pieces = checker.pieces(other)
    if not pieces:
        return True
    if any(checker._on_floor(piece) for piece in pieces):
        return True
    under, _, _, inside = contacts(other, checker, pieces)
    return any(o != obj for o in under + inside)


def standing(obj, checker):
    """
    How an object stands, as a Standing, or None when it is attached to another, has no shape,
    or the checker's time is past. Of two touching shapes, the one held up by something else
    carries the other: a lamp hangs from a ceiling the walls hold, and plates lying on a sheet
    that nothing holds rest on it while the sheet hangs from nothing.
    """
    if obj.parent is not None or not checker.in_time(obj):
        return None
    pieces = checker.pieces(obj)
    if not pieces:
        return None
    box = obj_box(pieces)
    own = own_of(obj)
    under, above, beside, inside = contacts(obj, checker, pieces)
    on_floor = any(checker._on_floor(piece) for piece in pieces)
    # With more than one thing under it, one that nothing else holds hangs from it rather than holding it.
    if len(under) + len(inside) + on_floor > 1:
        hanging = [o for o in under if not held_besides(o, obj, checker)]
        if len(hanging) < len(under) + len(inside) + on_floor:
            under = [o for o in under if o not in hanging]
    # What lies on its top holds it up only when something else holds that up.
    holding = [o for o in above if held_besides(o, obj, checker)] if not under else []
    carried = sorted(o.name for o in above if o not in holding)
    under, holding, beside, inside = ([o.name for o in group] for group in (under, holding, beside, inside))
    # Set into what it stands in, it rests on nothing besides; the floor is the ground under it only when that is all.
    if on_floor and not under and not inside:
        under.append("the floor")
    said = []
    if under:
        said.append(f"rests on {in_brief(under)}")
    if holding and not under:
        said.append(f"hangs from {in_brief(holding)}")
    if beside:
        said.append(f"against {in_brief(beside)}" if said else f"stands against {in_brief(beside)}, nothing under it")
    if inside:
        said.append(f"set into {in_brief(inside)}")
    if said:
        return Standing(obj.name, ", ".join(said))
    floor = checker.floor()
    found = checker.below(pieces, own, (mathutils.Vector(box[0]), mathutils.Vector(box[1])), floor_level=True)
    if found is not None:
        gap, words = found[0], f"{length(found[0])} above {found[1].name}"
    else:
        gap = float(box[0][2]) - floor
        words = f"{length(gap)} above the floor"
    why = why_aloft(obj)
    if carried:
        words = f"has {in_brief(carried)} on it but nothing under it, {words}"
    elif found is None:
        words += ", nothing under it"
    return Standing(obj.name, f"is {why}, {words}" if why else words if carried else f"touches nothing, {words}", gap)


def obj_box(pieces):
    lows = numpy.array([p.low for p in pieces])
    highs = numpy.array([p.high for p in pieces])
    return lows.min(axis=0), highs.max(axis=0)


def standing_text(standings, heading):
    """
    How the objects stand, in one line: those touching nothing first, the farthest from what is
    under them first and past GROUPED_PAST of them the rest counted, then what holds the others;
    past GROUPED_PAST of those, the ones held alike together.
    """
    standings = [s for s in standings if s is not None]
    if not standings:
        return ""
    aloft = sorted((s for s in standings if s.gap is not None), key=lambda s: -s.gap)
    held = [s for s in standings if s.gap is None]
    said = [f"{s.name} {s.words}" for s in aloft[:GROUPED_PAST]]
    if len(aloft) > GROUPED_PAST:
        rest = aloft[GROUPED_PAST:]
        said.append(
            f"{len(rest)} more touching nothing ({stems_text([s.name for s in rest])}),"
            f" {length(rest[-1].gap)} to {length(rest[0].gap)} above what is under them"
        )
    if len(held) > GROUPED_PAST:
        alike = {}
        for s in held:
            alike.setdefault(s.words, []).append(s.name)
        for words, names in alike.items():
            said.append(f"{names[0]} {words}" if len(names) == 1 else f"{len(names)} objects ({stems_text(names)}) each {words}")
    else:
        said += [f"{s.name} {s.words}" for s in held]
    return f"{heading}: {'; '.join(said)}."
