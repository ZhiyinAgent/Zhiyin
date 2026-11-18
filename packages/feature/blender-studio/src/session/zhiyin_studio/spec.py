"""
A scene measured against its spec after a command: each requirement of a fixed kind, measured
here on the meshes, never by code the model writes, answering whether it holds, what was
measured and the margin, how far inside the limit or, below zero, past it. A part field that
names several objects measures each, the worst deciding. The verdicts are written to the file
Zhiyin names; the first time every size holds, a small picture of the block-out is drawn beside
them. Measuring never changes the scene and never fails the command.
"""

import json
import time

import mathutils
import numpy

from . import budget
from .errors import Refused, keep_error
from .finding import is_helper, pattern_of, scene, scene_objects
from .geometry import evaluated_graph, has_shape, held_still, shapes_of
from .overlaps import goes_into
from .preview import preview
from .spec_motion import MOTION_KINDS, separate_in_motion
from .spec_overhang import overhang
from .spec_shapes import (
    MOST_PIECES,
    Groups,
    Shape,
    Unchecked,
    box_gaps,
    drawn,
    gap,
    held,
    in_frame,
    inside_of,
    nearest_apart,
    pieces,
    resting_gap,
)
from .wording import enumerated
from .wording import listed as in_words

# How near a size given as one number must be, in mm.
EXACT = 0.5
# How near, in mm, a part's bottom is to what is under it when it rests on it.
REST = 1.0
# A margin the answer says as 0 holds: sizes are said to a hundredth of a millimetre, and a faceted
# round wall measures a few thousandths under its radii.
SAID = 0.005
# How long the spec's measures may take together, in seconds, or half of what is left of the
# command's time when that is less.
SPEC_TIME = 30
# The kinds that are sizes: once all of them hold, the block-out is shown.
SIZES = {"size", "fits"}
# The block-out picture's size.
BLOCKOUT = {"width": 480, "height": 320}
# How many of the other objects a pattern names are given in brief beside the worst.
BRIEFLY = 6


def mm(value):
    return f"{round(float(value), 2):g}"


def margin_of(measured, asked):
    """How far a measure lies inside a range, a number within EXACT or [least, most]."""
    if isinstance(asked, list):
        return min(measured - asked[0], asked[1] - measured)
    return EXACT - abs(measured - asked)


def whose(name):
    """A name as the owner of what follows: Walls' surface, Top's bottom."""
    return f"{name}'" if name.endswith("s") else f"{name}'s"


def range_words(asked, unit=" mm"):
    return f"{mm(asked[0])} to {mm(asked[1])}{unit}" if isinstance(asked, list) else f"{mm(asked)}{unit}"


class Run:
    """One spec's measuring: each part's shape worked out once."""

    def __init__(self, started):
        self.shapes = {}
        self.limit = budget.share(SPEC_TIME)
        self.deadline = started + self.limit

    def seconds(self):
        """The spec's time, as its answer says it."""
        return f"{self.limit:.0f} s" if self.limit >= 1 else f"{self.limit:.1f} s"

    def out_of_time(self):
        return f"the spec's measures took their {self.seconds()}; check fewer or smaller parts"

    def check(self):
        """Stops a measure that would run past the spec's time."""
        if time.monotonic() > self.deadline:
            raise Unchecked(self.out_of_time())

    def objects(self, name, what):
        """The objects a field names, by name or pattern; unchecked when it names none."""
        shown = [o for o in scene_objects() if not is_helper(o)]
        try:
            pattern = pattern_of(name)
        except Refused as problem:
            raise Unchecked(str(problem)) from None
        found = [o for o in shown if pattern.fullmatch(o.name)] if pattern else [o for o in shown if o.name == name]
        if not found:
            names = ", ".join(o.name for o in shown[:12]) or "nothing"
            raise Unchecked(
                f"{name} {'matches no object' if pattern else 'is no object in the scene'}; the scene has {names}"
            )
        return found

    def shape(self, obj):
        key = obj.as_pointer()
        if key not in self.shapes:
            if not has_shape(obj) and len(shapes_of(obj)) == 0:
                raise Unchecked(f"{obj.name} is {'an' if obj.type.lower()[0] in 'aeiou' else 'a'} {obj.type.lower()}, with no shape")
            self.shapes[key] = Shape(obj)
        shape = self.shapes[key]
        if shape.empty:
            raise Unchecked(f"{obj.name} has no shape to measure")
        return shape

    def shapes_named(self, names, what):
        names = names if isinstance(names, list) else [names]
        found = {}
        for name in names:
            for obj in self.objects(name, what):
                found.setdefault(obj.name, obj)
        shapes = []
        for obj in found.values():
            self.check()
            shapes.append((obj, self.shape(obj)))
        return shapes

    def free(self):
        for shape in self.shapes.values():
            shape.free()


def _size(run, asked):
    worst = None
    for obj, shape in run.shapes_named(asked["part"], "part"):
        size = shape.high() - shape.low()
        margins = []
        for limit, sign in ((asked.get("max"), 1), (asked.get("min"), -1)):
            for axis, bound in enumerate(limit or []):
                if bound is not None:
                    margins.append((sign * (bound - size[axis]), axis, f"{'at most' if sign > 0 else 'at least'} {mm(bound)} mm"))
        for axis, bound in enumerate(asked.get("range") or []):
            if bound is not None:
                margins.append((margin_of(size[axis], bound), axis, range_words(bound)))
        margin = min(margins)
        if worst is None or margin[0] < worst[0][0]:
            worst = (margin, obj.name, size)
    (margin, axis, limit), name, size = worst
    return {
        "margin": margin,
        "unit": "mm",
        "measured": f"{name} is {' × '.join(mm(v) for v in size)} mm, {mm(size[axis])} along {'xyz'[axis]} where {limit} is asked",
    }


def _fits(run, asked):
    chosen = run.shapes_named(asked["parts"], "parts") if asked.get("parts") else _every(run)
    low = numpy.min([s.low() for _, s in chosen], axis=0)
    high = numpy.max([s.high() for _, s in chosen], axis=0)
    size = high - low
    box = numpy.array(asked["box"], dtype=float)
    turned = asked.get("turned", True)
    held, room = (numpy.sort(size), numpy.sort(box)) if turned else (size, box)
    what = "the parts are" if len(chosen) > 1 else f"{chosen[0][0].name} is"
    return {
        "margin": float((room - held).min()),
        "unit": "mm",
        "measured": f"{what} {' × '.join(mm(v) for v in size)} mm, for a box of {' × '.join(mm(v) for v in box)} mm{', turned to fit' if turned else ''}",
    }


def _every(run):
    found = []
    for obj in scene_objects():
        if is_helper(obj) or obj.hide_render or obj.type not in {"MESH", "CURVE", "FONT", "SURFACE", "META"}:
            continue
        run.check()
        try:
            found.append((obj, run.shape(obj)))
        except Unchecked:
            continue
    if not found:
        raise Unchecked("the scene has no shape")
    return found


def _clearance(run, asked):
    if any(asked.get(field) is not None for field in ("bed", "height", "up")):
        raise Unchecked("a clearance near a print bed is measured in the CAD studio")
    first = run.shapes_named(asked["between"][0], "between")
    second = run.shapes_named(asked["between"][1], "between")
    # Pairs in order of how far apart their boxes are: none farther apart than the nearest gap
    # found can come nearer, so the rest are never measured.
    apart = box_gaps([s for _, s in first], [s for _, s in second])
    for i, (a, _) in enumerate(first):
        for j, (b, _) in enumerate(second):
            if a == b:
                apart[i, j] = numpy.inf
    nearest, seen, ran_out = None, set(), False
    for k in numpy.argsort(apart, axis=None, kind="stable"):
        i, j = divmod(int(k), len(second))
        if not numpy.isfinite(apart[i, j]) or (nearest is not None and apart[i, j] >= nearest[0]):
            break
        (a, one), (b, other) = first[i], second[j]
        pair = tuple(sorted((a.name, b.name)))
        if pair in seen:
            continue
        try:
            run.check()
        except Unchecked:
            ran_out = True
            break
        seen.add(pair)
        found = gap(one, other)
        if found is not None and (nearest is None or found < nearest[0]):
            nearest = (found, a.name, b.name)
    if ran_out and not seen:
        raise Unchecked(run.out_of_time())
    if ran_out and (nearest is None or nearest[0] >= asked["min"]):
        raise Unchecked(
            f"the spec's measures took their {run.seconds()} with {len(seen):,} pairs of parts measured, none nearer than asked; check fewer parts"
        )
    if nearest is None:
        raise Unchecked("it names no two different parts")
    found, a, b = nearest
    said = f"{a} comes {mm(found)} mm from {b}" if found > 0 else f"{a} touches or goes into {b}"
    if ran_out:
        said += f", the nearest of {len(seen):,} pairs measured before the spec's {run.seconds()} ran out"
    said += f", where at least {mm(asked['min'])} mm is asked"
    return {"margin": found - asked["min"], "unit": "mm", "measured": said}


def _separate(run, asked):
    chosen = run.shapes_named(asked["parts"], "parts") if asked.get("parts") else _every(run)
    objects = [obj for obj, _ in chosen]
    clashing, seen = [], set()
    for obj in objects:
        run.check()
        for other, depth in goes_into(obj, objects):
            pair = tuple(sorted((obj.name, other.name)))
            if pair not in seen:
                seen.add(pair)
                clashing.append((obj.name, other.name, depth))
    if not clashing:
        return {"margin": None, "measured": "no two of them go into each other"}
    said = "; ".join(
        f"{a} goes {mm(depth * 1000)} mm into {b}" if depth else f"{a} goes into {b}" for a, b, depth in clashing[:5]
    )
    more = len(clashing) - 5
    return {"margin": None, "holds": False, "measured": said + (f"; and {more} more" if more > 0 else "")}


def _sections(run, obj, shape, what):
    found = shape.sections(run.check)
    if found is None or not len(found[what]):
        raise Unchecked(f"no {'width' if what == 'wide' else 'thickness'} of {obj.name} could be measured")
    return found


def _worst_first(result):
    """A measure's place among others, the worst first: one failing with no margin, then the least margin."""
    if result.get("margin") is None:
        return (0, 0.0) if result.get("holds") is False else (1, numpy.inf)
    return (1, result["margin"])


def _each(run, name, measure):
    """
    Each object a part field names measured on its own, the worst deciding whether it holds: one
    object's answer as it is, several's with the others' measures in brief, so the one that fails
    is named. `measure` answers for one object, with its measure in a few words as `brief`.
    """
    found = []
    for obj, shape in run.shapes_named(name, "part"):
        run.check()
        found.append((obj, measure(obj, shape)))
    found.sort(key=lambda one: _worst_first(one[1]))
    worst = {key: value for key, value in found[0][1].items() if key != "brief"}
    if len(found) == 1:
        return worst
    others = [f"{obj.name} {result['brief']}" for obj, result in found[1:]]
    listed = enumerated(others, BRIEFLY) if len(others) > BRIEFLY else in_words(others)
    worst["measured"] += f" (the worst of the {len(found)} objects {name} names; the others: {listed})"
    return worst


def _wall(run, asked):
    worst = None
    for obj, shape in run.shapes_named(asked["part"], "part"):
        found = shape.sections(run.check)
        if found is None:
            continue
        k = int(numpy.argmin(found["thin"]))
        thinnest, at = float(found["thin"][k]), found["where"][k]
        if worst is None or thinnest - asked["min"] < worst["margin"]:
            worst = {
                "margin": thinnest - asked["min"],
                "unit": "mm",
                "measured": f"{whose(obj.name)} thinnest wall is {mm(thinnest)} mm, at ({', '.join(mm(v) for v in at)}) mm, measured at {len(found['thin'])} points over it, where at least {mm(asked['min'])} mm is asked",
            }
    if worst is None:
        raise Unchecked("no wall of it could be measured")
    return worst


def _thickness(run, asked):
    def measure(obj, shape):
        found = _sections(run, obj, shape, "thin")
        typical = float(numpy.median(found["thin"]))
        low, high = numpy.percentile(found["thin"], [5, 95])
        return {
            "margin": margin_of(typical, asked["range"]),
            "unit": "mm",
            "measured": f"{obj.name} is {mm(typical)} mm thick, from {mm(low)} to {mm(high)} over most of it, where {range_words(asked['range'])} is asked",
            "brief": f"{mm(typical)} mm",
        }

    return _each(run, asked["part"], measure)


def _width(run, asked):
    def measure(obj, shape):
        typical = float(numpy.median(_sections(run, obj, shape, "wide")["wide"]))
        return {
            "margin": margin_of(typical, asked["range"]),
            "unit": "mm",
            "measured": f"{obj.name} is {mm(typical)} mm wide, where {range_words(asked['range'])} is asked",
            "brief": f"{mm(typical)} mm",
        }

    return _each(run, asked["part"], measure)


def _reach(run, asked):
    def measure(obj, shape):
        others = [s for o, s in run.shapes_named(asked["from"], "from") if o != obj]
        if not others:
            raise Unchecked(f"from names only {obj.name} itself")
        farthest = 0.0
        for point in shape.sampled(20000):
            # Each point is measured against every other part, so the time is checked at each.
            run.check()
            near = min(
                (found[3] for other in others if (found := other.tree.find_nearest(mathutils.Vector(point)))[0] is not None),
                default=None,
            )
            if near is not None:
                farthest = max(farthest, near * 1000)
        return {
            "margin": margin_of(farthest, asked["range"]),
            "unit": "mm",
            "measured": f"{obj.name} reaches {mm(farthest)} mm out from {asked['from']}, where {range_words(asked['range'])} is asked",
            "brief": f"{mm(farthest)} mm",
        }

    return _each(run, asked["part"], measure)


def _rests_on(run, asked):
    def measure(obj, shape):
        if asked.get("on") is None:
            lift, under = shape.low()[2], "the ground"
        else:
            others = [s for o, s in run.shapes_named(asked["on"], "on") if o != obj and s.tree is not None]
            if not others:
                raise Unchecked(f"on names only {obj.name} itself")
            under = asked["on"]
            low, high = shape.low(), shape.high()
            # Only what lies under the part, or round it, can hold it up.
            gaps = [
                found
                for other in others
                if other.low()[0] <= high[0] and other.high()[0] >= low[0]
                and other.low()[1] <= high[1] and other.high()[1] >= low[1]
                and (found := resting_gap(shape, other, run.check)) is not None
            ]
            if not gaps:
                return {"margin": None, "holds": False, "measured": f"{obj.name} is not over {under}", "brief": "not over it"}
            lift = min(gaps)
        if abs(lift) < 0.01:
            said, brief = f"{whose(obj.name)} bottom is on {under}", "on it"
        elif lift > 0:
            said, brief = f"{whose(obj.name)} bottom is {mm(lift)} mm above {under}", f"{mm(lift)} mm above"
        else:
            said, brief = f"{whose(obj.name)} bottom is {mm(-lift)} mm into {under}", f"{mm(-lift)} mm into it"
        if abs(lift) > REST:
            said += f", where it is to rest on it within {mm(REST)} mm"
        return {"margin": REST - abs(lift), "unit": "mm", "measured": said, "brief": brief}

    return _each(run, asked["part"], measure)


def _level(run, asked):
    below = asked["check"] == "below"
    sides = asked.get("sides") or (["top", "bottom"] if below else ["bottom", "top"])
    height = lambda s, side: s.high()[2] if side == "top" else s.low()[2]
    others = run.shapes_named(asked["other"], "other")

    def measure(obj, shape):
        found = []
        for other_obj, other in others:
            if other_obj == obj:
                continue
            mine, theirs = height(shape, sides[0]), height(other, sides[1])
            apart = theirs - mine if below else mine - theirs
            way = asked["check"] if apart >= 0 else ("above" if below else "below")
            found.append(
                {
                    "margin": margin_of(apart, asked["by"]),
                    "unit": "mm",
                    "measured": f"{whose(obj.name)} {sides[0]} is {mm(abs(apart))} mm {way} {whose(other_obj.name)} {sides[1]}, where {range_words(asked['by'])} {asked['check']} is asked",
                    "brief": f"{mm(abs(apart))} mm {way}" + (f" {other_obj.name}" if len(others) > 1 else ""),
                }
            )
        if not found:
            raise Unchecked(f"other names only {obj.name} itself")
        return min(found, key=_worst_first)

    return _each(run, asked["part"], measure)


def _joined(run, asked):
    chosen = run.shapes_named(asked["parts"], "parts")
    found = []
    for obj, shape in chosen:
        split = pieces(shape, run.check)
        if split is None:
            raise Unchecked(f"{obj.name} is more than {MOST_PIECES:,} pieces")
        found += split
    groups = Groups(len(found))
    held(groups, found, run.check)
    members = {}
    for i, piece in enumerate(found):
        members.setdefault(groups.root(i), []).append(piece)
    names = " and ".join(obj.name for obj, _ in chosen) if len(chosen) <= 3 else f"the {len(chosen)} parts"
    one = len(chosen) == 1
    if len(members) == 1:
        return {"margin": None, "measured": f"{names} {'holds' if one else 'hold'} together as one piece"}

    def group_words(group):
        counted = {}
        for piece in group:
            counted[piece.name] = counted.get(piece.name, 0) + 1
        return ", ".join(f"{name} ({count} pieces)" if count > 1 else name for name, count in counted.items())

    listed = [group_words(group) for group in members.values()]
    more = len(listed) - 5
    said = "; ".join(listed[:5]) + (f"; and {more} more" if more > 0 else "")
    nearest = nearest_apart(groups, found, run.check)
    # How far past touching the two nearest are is the margin the answer says.
    return {
        "margin": -nearest if nearest is not None else None,
        "holds": False,
        "unit": "mm",
        "measured": f"{names} {'is' if one else 'are'} in {len(members):,} pieces that do not touch: {said}",
    }


def _inside(run, asked):
    outers = run.shapes_named(asked["of"], "of")
    held_in = {obj.name for obj, _ in outers}
    worst = None
    for obj, shape in run.shapes_named(asked["part"], "part"):
        if obj.name in held_in:
            continue
        out, at = inside_of([s for _, s in outers], shape, run.check)
        if worst is None or out > worst[0]:
            worst = (out, at, obj.name)
    if worst is None:
        raise Unchecked("part names only the parts it is to be inside")
    out, at, name = worst
    one = len(outers) == 1
    if len(outers) <= 3:
        outer = " and ".join(obj.name for obj, _ in outers)
    else:
        outer = asked["of"] if isinstance(asked["of"], str) else ", ".join(asked["of"])
    if at is not None and out > 0:
        where = ", ".join(mm(v * 1000) for v in at)
        owner = whose(outer) if one else "their"
        said = f"{name} is partly outside {outer}: its farthest point out, at ({where}) mm, is {mm(out)} mm from {owner} surface"
    else:
        said = f"{name} is inside {outer}, {mm(-out)} mm within {'it' if one else 'them'} at the nearest"
    return {"margin": -out, "unit": "mm", "measured": said}


def _count(run, asked):
    name = asked["part"]
    try:
        pattern = pattern_of(name)
    except Refused as problem:
        raise Unchecked(str(problem)) from None
    matches = (lambda n: bool(pattern.fullmatch(n))) if pattern else (lambda n: n == name)

    objects = instances = 0
    for instance in evaluated_graph().object_instances:
        original = instance.object.original
        if is_helper(original) or not matches(original.name):
            continue
        if instance.is_instance:
            instances += 1
        elif not original.hide_render:
            objects += 1
    found = objects + instances
    wanted = asked["range"]
    holds = wanted[0] <= found <= wanted[1] if isinstance(wanted, list) else found == wanted
    asked_words = f"{wanted[0]} to {wanted[1]}" if isinstance(wanted, list) else str(wanted)
    made = f", {instances} of them instances" if instances else ""
    return {
        "margin": None,
        "holds": holds,
        "measured": f"{found} {'object' if found == 1 else 'objects'} drawn {('match' if found != 1 else 'matches') if pattern else ('are' if found != 1 else 'is') + ' named'} {name}{made}, where {asked_words} {'is' if asked_words == '1' else 'are'} asked",
    }


def _faces(run, asked):
    objects = [obj for obj, _ in run.shapes_named(asked["parts"], "parts")] if asked.get("parts") else None
    faces, placed, by_instance = drawn(objects)
    drawing = f"{', '.join(asked['parts'])} draw" if objects else "the scene draws"
    copies = f", {by_instance:,} of them in {placed:,} instances" if placed else ""
    return {
        "margin": asked["max"] - faces,
        "unit": "faces",
        "measured": f"{drawing} {faces:,} faces{copies}, where at most {asked['max']:,} are asked",
    }


def _in_view(run, asked):
    if asked.get("camera"):
        found = [o for o in run.objects(asked["camera"], "camera") if o.type == "CAMERA"]
        if not found:
            raise Unchecked(f"{asked['camera']} is not a camera")
        camera = found[0]
    else:
        camera = scene().camera
        if camera is None:
            raise Unchecked("the scene has no camera; set one with blender_set_camera")
    worst = None
    for obj, shape in run.shapes_named(asked["parts"], "parts"):
        run.check()
        place = in_frame(shape, camera)
        if place is None:
            return {"margin": None, "holds": False, "measured": f"{obj.name} is partly behind {camera.name}"}
        if worst is None or place[0] < worst[0]:
            worst = (place[0], place[1], obj.name)
    share, edge, name = worst
    percent = share * 100
    said = (
        f"{name} is in {whose(camera.name)} frame, {mm(percent)}% of the frame from its {edge} edge at the nearest"
        if share >= 0
        else f"{name} reaches {mm(-percent)}% of the frame past its {edge} edge"
    )
    return {"margin": percent, "unit": "% of the frame", "measured": said}


KINDS = {
    "size": _size,
    "fits": _fits,
    "clearance": _clearance,
    "separate": _separate,
    "separate_in_motion": separate_in_motion,
    "wall": _wall,
    "overhang": overhang,
    "thickness": _thickness,
    "width": _width,
    "reach": _reach,
    "rests_on": _rests_on,
    "below": _level,
    "above": _level,
    "joined": _joined,
    "inside": _inside,
    "count": _count,
    "faces": _faces,
    "in_view": _in_view,
}


def verdict(run, asked):
    """One requirement measured: whether it holds, what was measured and the margin, or why it was not."""
    if time.monotonic() > run.deadline:
        return {"id": asked["id"], "holds": None, "why": run.out_of_time()}
    try:
        measure = KINDS.get(asked.get("check"))
        if measure is None:
            raise Unchecked(f"no requirement is of the kind {asked.get('check')}")
        result = measure(run, asked)
    except Unchecked as why:
        return {"id": asked["id"], "holds": None, "why": str(why)}
    except Exception as problem:  # noqa: BLE001 - Blender's own errors, said for this requirement
        return {
            "id": asked["id"],
            "holds": None,
            "why": f"it could not be measured: {str(problem).strip() or type(problem).__name__}",
        }
    margin = result.get("margin")
    holds = bool(result.get("holds", True if margin is None else margin >= -SAID))
    return {
        "id": asked["id"],
        "holds": holds,
        "measured": result["measured"],
        **({"margin": round(float(margin), 4), "unit": result["unit"]} if margin is not None else {}),
    }


def checked(requirements):
    """
    Each requirement measured on the scene: whether it holds, what was measured and the margin.
    Those of one moment are measured as the scene is now, held still; those over the animation
    after them, stepping the timeline.
    """
    found = {}
    run = Run(time.monotonic())
    try:
        with held_still():
            for index, asked in enumerate(requirements):
                if asked.get("check") not in MOTION_KINDS:
                    found[index] = verdict(run, asked)
        for index, asked in enumerate(requirements):
            if asked.get("check") in MOTION_KINDS:
                found[index] = verdict(run, asked)
    finally:
        run.free()
    return [found[index] for index in range(len(requirements))]


def measure(sent, device):
    """
    Measures the scene against the spec Zhiyin sent and writes the verdicts where it says; the
    first time every size holds, with the block-out picture it asked for. Whatever fails is
    written as the reason, so the command it follows still stands.
    """
    out = sent.get("out") if isinstance(sent, dict) else None
    if not isinstance(out, str):
        return
    try:
        requirements = [r for r in sent.get("requirements") or [] if isinstance(r, dict) and isinstance(r.get("id"), str)]
        found = checked(requirements)
        written = {"checked": found}
        sizes = [one for one, asked in zip(found, requirements) if asked.get("check") in SIZES]
        blockout = sent.get("blockout")
        if isinstance(blockout, str) and sizes and all(one["holds"] is True for one in sizes):
            try:
                preview(dict(BLOCKOUT), blockout, device)
            except Exception as error:
                keep_error("The block-out picture could not be drawn", error)
    except Exception as error:
        keep_error("The spec could not be measured", error)
        written = {"error": f"{type(error).__name__}: {error}"}
    try:
        with open(out, "w", encoding="utf-8") as file:
            json.dump(written, file)
    except OSError as error:
        keep_error("The spec's verdicts could not be written", error)


