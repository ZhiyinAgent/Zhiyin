"""
blender_scatter: copies of objects set over a surface by count or density, at points spread
evenly by area and kept where the rules allow, each standing on its point by the middle of its
box's base, upright or tilted to the surface, raised or sunk along its up, its item drawn by the
items' weights, turned and scaled at random by a seed, its footprint clear of every other's. Made
as linked objects or as instances geometry nodes place. Says what was placed against asked, what
each rule and the footprints removed, the least gap between footprints, the slopes the copies
stand on, the faces they draw against those held, what each copy goes into, and how many objects
and instances the scene has.
"""

import math
import random

import bpy
import mathutils
import mathutils.kdtree

from .aiming import keeps_focus
from .arguments import is_number, need, number, whole
from .errors import Refused
from .finding import find_object, find_objects, scene_objects
from .geometry import held_still
from .glass import lets_light_through_sheets
from .measure_shapes import Shape
from .scatter_checks import KeptClear, into_text
from .scatter_copies import TAG, Item, items_words, key_of, made_as_instances, made_as_objects, remove_earlier
from .scatter_surface import Rules, Surface
from .wood import lays_grain
from .wording import area_text, length, listed, point_text

# The most copies, as objects and as instances.
MOST = {"objects": 1000, "instances": 10000}
# Points tried for each copy asked, at least and at most in all.
TRIES_EACH, FEWEST_TRIES, MOST_TRIES = 100, 2000, 200_000
UP = mathutils.Vector((0, 0, 1))
# By default: the least clear gap between footprints, the seed, the most each copy is turned in
# degrees, and the factors it is scaled between; an item the weights do not name weighs this.
SPACING = 0
SEED = 0
TURN = 360
SCALE = (1, 1)
WEIGHT = 1
# How many of its nearest neighbours each footprint is measured to for the least gap.
NEAREST = 8


class Jitter:
    """Each copy's item, turn and scale, at random from the seed."""

    def __init__(self, value, count, weights=None, sink=None):
        value = value or {}
        self.weights = weights
        self.sink = sink
        need(isinstance(value, dict), "jitter is {seed, turn, scale}.")
        seed = value.get("seed", SEED)
        need(is_number(seed) and float(seed).is_integer(), "jitter seed must be a whole number.")
        self.random = random.Random(int(seed))
        self.turn = number(value.get("turn"), "jitter turn", minimum=0, maximum=360, default=TURN)
        scale = value.get("scale", list(SCALE))
        need(
            isinstance(scale, list) and len(scale) == 2 and all(is_number(v) and v > 0 for v in scale) and scale[0] <= scale[1],
            "jitter scale is [least, most], factors greater than 0, the least first.",
        )
        self.scale = (float(scale[0]), float(scale[1]))
        self.count = count

    def draw(self):
        which = self.random.choices(range(self.count), self.weights)[0] if self.weights else self.random.randrange(self.count)
        return (
            which,
            math.radians(self.random.random() * self.turn),
            self.random.uniform(*self.scale),
        )

    def sunk(self):
        """How far one copy is sunk into the surface, at random between the sink's two, or 0 with none."""
        return self.random.uniform(*self.sink) if self.sink else 0.0


def item_weights(value, objects):
    """How likely each item is to be drawn, by its name: 1 for an item not named; None when none are given."""
    if value is None:
        return None
    need(isinstance(value, dict) and value, "weights gives items' names, each with how likely it is to be drawn.")
    names = {o.name for o in objects}
    for name, weight in value.items():
        need(name in names, f"weights names “{name}”, which is not among the items: {listed(sorted(names))}.")
        need(is_number(weight) and weight >= 0, f"The weight of “{name}” must be a number of at least 0.")
    weights = [float(value.get(o.name, WEIGHT)) for o in objects]
    need(sum(weights) > 0, "weights leave every item at 0, so none could be drawn.")
    return weights


def sink_of(value):
    """The least and most a copy is sunk into the surface, in metres, or None."""
    if value is None:
        return None
    need(
        isinstance(value, list) and len(value) == 2 and all(is_number(v) and v >= 0 for v in value) and value[0] <= value[1],
        "sink is [least, most] in metres, each at least 0, the least first.",
    )
    return float(value[0]), float(value[1])


class Footprints:
    """The copies' footprints placed so far, found by where they stand: level circles, or in space when tilted."""

    def __init__(self, largest, spacing, level):
        self.size = max(2 * largest + spacing, 1e-6)
        self.spacing = spacing
        self.level = level
        self.cells = {}

    def _key(self, point):
        cell = [math.floor(point[i] / self.size) for i in range(2 if self.level else 3)]
        return tuple(cell)

    def _apart(self, one, other):
        return (one - other).to_2d().length if self.level else (one - other).length

    def neighbours(self, point):
        key = self._key(point)
        around = [(-1, 0, 1)] * len(key)
        for step in _product(around):
            yield from self.cells.get(tuple(k + s for k, s in zip(key, step)), [])

    def clear(self, point, radius):
        return all(self._apart(point, other) - radius - theirs >= self.spacing - 1e-9 for other, theirs in self.neighbours(point))

    def add(self, point, radius):
        self.cells.setdefault(self._key(point), []).append((point, radius))

    def least_gap(self):
        """The least clear gap between two footprints, from each to its nearest few by where they stand; None for one."""
        placed = [found for held in self.cells.values() for found in held]
        if len(placed) < 2:
            return None
        tree = mathutils.kdtree.KDTree(len(placed))
        for index, (point, _) in enumerate(placed):
            tree.insert(point.to_2d().to_3d() if self.level else point, index)
        tree.balance()
        least = math.inf
        for point, radius in placed:
            for _, index, _ in tree.find_n(point.to_2d().to_3d() if self.level else point, min(len(placed), NEAREST + 1)):
                other, theirs = placed[index]
                if other is not point:
                    least = min(least, self._apart(point, other) - radius - theirs)
        return least


def _product(ranges):
    found = [()]
    for one in ranges:
        found = [f + (v,) for f in found for v in one]
    return found


def turn_at(align, normal, angle):
    """How a copy is turned: about its up, then tilted to the face it stands on when asked."""
    about = mathutils.Quaternion(UP, angle)
    if align == "up" or normal.length < 0.5:
        return about
    return UP.rotation_difference(normal) @ about


def asked_count(args, rules, surface, as_):
    """How many copies are asked, and what an answer says of a density."""
    count, density = args.get("count"), args.get("density")
    need((count is None) != (density is None), "Give exactly one of count and density.")
    if count is not None:
        asked = whole(count, "count", maximum=MOST["instances"])
        said = ""
    else:
        density = number(density, "density", minimum=0)
        need(density > 0, "density must be greater than 0.")
        area, estimated = rules.area_left(surface)
        asked = round(density * area)
        said = f", {density:g} per m² over the {'about ' if estimated else ''}{area_text(area)} of {surface.name} the rules leave,"
        need(asked >= 1, f"{density:g} per m² over the {area_text(area)} of {surface.name} the rules leave asks for no copy.")
    most = MOST[as_]
    if asked > most:
        if as_ == "objects":
            raise Refused(f"As objects, a scatter makes at most {most:,} copies; for more, scatter them as instances.")
        raise Refused(f"A scatter places at most {most:,} instances; this asks for {asked:,}.")
    return asked, said


def nothing_placed(surface, rules, removed, tried, collisions, kept_out):
    """Why nothing could be placed, with what the surface has for each rule that removed points."""
    gone = [(rule, count) for rule, count in removed.items() if count]
    if len(gone) == 1 and gone[0][1] == tried:
        rule = gone[0][0]
        return (
            f"Nothing was scattered on {surface.name}: of the {tried:,} points tried, {rule} removed every one; "
            f"{rules.what_it_has(rule, surface)}."
        )
    said = [f"{count:,} by {rule}" for rule, count in gone]
    said += [f"{collisions:,} by collisions between footprints"] if collisions else []
    said += [f"{kept_out:,} by keep_clear"] if kept_out else []
    facts = [rules.what_it_has(rule, surface) for rule, _ in gone]
    return (
        f"Nothing was scattered on {surface.name}: of the {tried:,} points tried, {listed(said) if said else 'none'} were removed"
        + (f"; {'; '.join(facts)}" if facts else "")
        + "."
    )


@keeps_focus
@lets_light_through_sheets
@lays_grain
def scatter_objects(args, scene_file):
    names = args.get("items")
    need(isinstance(names, list) and names, "items lists the objects copies are made of.")
    as_ = args.get("as", "objects")
    need(as_ in MOST, "as is objects or instances.")
    align = args.get("align", "up")
    need(align in ("up", "surface"), "align is up or surface.")
    spacing = number(args.get("spacing"), "spacing", minimum=0, default=SPACING)
    onto = find_object(args.get("onto"))
    objects = find_objects(names)
    need(onto not in objects, f"“{onto.name}” is both scattered and scattered onto.")
    clear = find_objects(args["keep_clear"]) if args.get("keep_clear") else []
    where = args.get("where") or {}
    words = items_words([o.name for o in objects])
    name = f"Scatter of {words} on {onto.name}"
    key = key_of(onto, objects)
    replaced = remove_earlier(key, words, onto)
    with held_still():
        group = where.get("vertex_group") if isinstance(where, dict) else None
        rules = Rules(where, onto)
        surface = Surface(onto, group)
        items = [Item(obj, as_ == "instances") for obj in objects]
        kept_clear = KeptClear(clear)
    asked, density_said = asked_count(args, rules, surface, as_)
    jitter = Jitter(args.get("jitter"), len(items), item_weights(args.get("weights"), objects), sink_of(args.get("sink")))
    offset = number(args.get("offset"), "offset", default=0)
    largest = max(item.half_diagonal for item in items) * jitter.scale[1]
    footprints = Footprints(largest, spacing, align == "up")
    removed = {rule: 0 for rule in rules.given}
    collisions = kept_out = tried = 0
    most_tries = min(MOST_TRIES, max(FEWEST_TRIES, TRIES_EACH * asked))
    placements = []
    slopes = []
    while len(placements) < asked and tried < most_tries:
        batch = min(most_tries - tried, max(1000, 4 * (asked - len(placements))))
        triangles, points, corners = surface.spread(jitter.random, batch)
        for triangle, point, weights in zip(triangles, points, corners):
            tried += 1
            why = rules.removed_by(surface, triangle, point, weights, jitter.random)
            if why:
                removed[why] += 1
                continue
            which, angle, factor = jitter.draw()
            item = items[which]
            at = mathutils.Vector(point)
            radius = item.half_diagonal * factor
            if not footprints.clear(at, radius):
                collisions += 1
                continue
            turn = turn_at(align, mathutils.Vector(surface.normals[triangle]), angle)
            # Raised by the offset and sunk by the sink along its own up.
            lift = offset - jitter.sunk()
            matrix = item.matrix(at + turn @ UP * lift, turn, factor)
            if kept_clear.shapes and kept_clear.blocks(item, matrix, at, item.reach * factor):
                kept_out += 1
                continue
            footprints.add(at, radius)
            placements.append((item, matrix))
            slopes.append(float(surface.slopes[triangle]))
            if len(placements) == asked:
                break
    if not placements:
        raise Refused(nothing_placed(surface, rules, removed, tried, collisions, kept_out))
    if as_ == "objects":
        group, made = made_as_objects(key, name, placements)
        how = f"as linked copies in the collection {group.name}"
    else:
        made = made_as_instances(key, name, items, placements)
        how = f"as instances placed by {made.name}"
    shares = ", ".join(f"{sum(1 for item, _ in placements if item is one):,} of {one.obj.name}" for one in items)
    over = density_said or f" over {onto.name}"
    lines = ([replaced] if replaced else []) + [f"Scattered {len(placements):,} of {asked:,} asked{over} {how}: {shares}."]
    if len(placements) < asked:
        lines.append(f"No more fit after the {tried:,} points tried: ask for fewer, a smaller spacing or looser rules.")
    said = [f"{count:,} by {rule}" for rule, count in removed.items()] + [f"{collisions:,} by collisions between footprints"]
    if clear:
        said.append(f"{kept_out:,} by keep_clear")
    lines.append(f"Tried {tried:,} points: removed {listed(said)}.")
    least = footprints.least_gap()
    lines.append(
        f"Least gap between footprints: {length(least)}, a footprint being the circle round each copy's own box seen from its up, at its scale."
        if least is not None
        else "One copy, so no gap between footprints."
    )
    lines.append(standing_text(slopes, offset, jitter.sink, args.get("jitter")))
    lines.append(faces_text(placements, items, as_))
    bpy.context.view_layer.update()
    with held_still():
        lines.append(copies_text(made, key, as_, items))
        lines.append(scene_count())
    return "\n".join(lines)


def standing_text(slopes, offset, sink, jitter):
    """The slopes the copies stand on, and how far each is raised off the surface or sunk into it."""
    low, high = min(slopes), max(slopes)
    said = f"The copies stand on faces sloping {low:.3g}° to {high:.3g}°" if high - low >= 0.05 else f"The copies stand on faces sloping {low:.3g}°"
    seed = (jitter or {}).get("seed", 0)
    if offset:
        said += f"; each {'raised' if offset > 0 else 'lowered'} {length(abs(offset))} along its up"
    if sink:
        said += (
            f"; each sunk {length(sink[0])} to {length(sink[1])} into the surface along its up, at random by seed {seed}"
            if sink[1] > sink[0]
            else f"; each sunk {length(sink[0])} into the surface along its up"
        )
    return said + "."


def faces_text(placements, items, as_):
    """The faces the copies draw, and the faces held in memory: the items' meshes, which every copy shares."""
    drawn = sum(len(item.mesh.polygons) for item, _ in placements)
    used = {id(item): item for item, _ in placements}.values()
    held = sum(len(item.mesh.polygons) for item in used)
    how = "linked copies" if as_ == "objects" else "instances"
    return f"Faces: {drawn:,} drawn by the copies, {held:,} held in memory in the {len(used)} item mesh{'es' if len(used) != 1 else ''} the {how} share."


def copies_text(made, key, as_, items):
    """What the copies go into, measured as they now are in the scene."""
    if as_ == "objects":
        copies = [(root.name, Shape(item.mesh, root.matrix_world.copy())) for root, item in made]
        return into_text(copies, lambda obj: obj.get(TAG) == key)
    by_name = {item.obj.name: item for item in items}
    graph = bpy.context.evaluated_depsgraph_get()
    copies = []
    for instance in graph.object_instances:
        if instance.is_instance and instance.parent is not None and instance.parent.original == made:
            item = by_name.get(instance.object.original.name)
            if item is not None:
                shape = Shape(item.mesh, instance.matrix_world.copy())
                copies.append((f"an instance of {item.obj.name} at {point_text(shape.middle)}", shape))
    return into_text(copies, lambda obj: obj.get(TAG) == key, evaluated=len(copies))


def scene_count():
    """How many objects and instances the scene now has."""
    objects = len(scene_objects())
    graph = bpy.context.evaluated_depsgraph_get()
    instances = sum(1 for one in graph.object_instances if one.is_instance)
    return f"The scene now has {objects:,} object{'s' if objects != 1 else ''} and {instances:,} instance{'s' if instances != 1 else ''}."
