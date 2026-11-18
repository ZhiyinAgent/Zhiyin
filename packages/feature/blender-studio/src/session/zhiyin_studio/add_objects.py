"""
blender_add_objects: each object described is made, or placed as an instance of a collection or
an object, then placed, smoothed, bevelled, set down, attached and marked as flying as asked, and
its scale as added recorded as its built size.
"""

import bpy

from .arguments import need, number, points, positive_size, rotation, vector
from .as_added import stamp
from .errors import Refused
from .finding import find_object, is_helper, link, unused_name
from .geometry import world_bounds
from .glass import lets_light_through_sheets
from .instancing import instance, instance_text
from .loose import mark_flying
from .making import (
    bevel,
    cube,
    cylinder,
    mesh_from,
    model_file,
    outline,
    picture,
    plane,
    revolved,
    smooth,
    sphere,
    svg_drawing,
    text_object,
    torus,
    tube,
)
from .making_primitives import ICOSPHERE_LEVELS, circle, grid, icosphere, made_of, monkey, quad_sphere
from .placing import attach, placed, tree
from .resting import rest, resting_on
from .scales import BUILT_SCALE
from .soundness import TUBE_ENDS, TUBE_RADIUS
from .wood import lays_grain
from .wording import length, one_of

ROUND_KINDS = ("cylinder", "cone", "sphere", "torus", "revolve", "tube", "icosphere", "quad_sphere", "monkey")
# Where an object's origin goes when its call gives none.
LOCATION = (0, 0, 0)
# A cone's top diameter as a share of its bottom one: least, most and by default.
TOP_RATIO = (0, 1, 0)
# Kinds whose answer always says what they are made of; the rest say it when their counts are given.
COUNTED_KINDS = ("circle", "grid", "icosphere", "quad_sphere", "monkey")
COUNTS = ("segments", "rings", "rows", "subdivisions", "fill")


def fit_group(group, children, size):
    """Scales a group of imported parts uniformly to fit inside a size, which is then its built size."""
    bpy.context.view_layer.update()
    bounds = world_bounds(children)
    if not bounds or size is None:
        return
    extent = bounds[1] - bounds[0]
    factors = [size[i] / extent[i] for i in range(3) if extent[i] > 1e-9]
    if factors:
        group.scale = [min(factors)] * 3
        group[BUILT_SCALE] = [min(factors)] * 3


PLACING = {"name", "kind", "location", "rotation", "rest_on", "rest_across", "align_to_surface", "parent", "smooth", "bevel", "flying"}
def cone(spec):
    """A cylinder narrowed at the top: to a point, unless top_ratio says how far."""
    least, most, default = TOP_RATIO
    top = number(spec.get("top_ratio"), "top_ratio", minimum=least, maximum=most, default=default) / 2
    return cylinder(spec, top)


def solid(shape, named=False):
    """Makes an object of the one mesh a shape draws; a named shape is told the object's name."""

    def make(spec, name, workspace):
        drawn = shape(spec, name) if named else shape(spec)
        return bpy.data.objects.new(name, mesh_from(drawn, name)), None

    return make


def whole_object(maker):
    """Makes an object a function builds whole, mesh or not."""
    return lambda spec, name, workspace: (maker(spec, name), None)


def tube_object(spec, name, workspace):
    """A tube, knowing where its ends are, so a hose or a cable is checked to end on what it joins."""
    obj, _ = solid(tube, named=True)(spec, name, workspace)
    if not spec.get("closed") and spec.get("radius") is not None:
        path = points(spec.get("points"), "points", 3, 2)
        obj.data[TUBE_ENDS] = [list(path[0]), list(path[-1])]
        obj.data[TUBE_RADIUS] = float(spec.get("radius"))
    return obj, None


def end_ways(spec, path):
    """The way a tube leaves each end of its path, as it was drawn."""
    if spec.get("corners", "round") == "sharp" or len(path) < 3:
        return path[1] - path[0], path[-2] - path[-1]
    return -3 * path[0] + 4 * path[1] - path[2], -3 * path[-1] + 4 * path[-2] - path[-3]


def ring_across(obj, middle, way):
    """How wide a tube is across where it ends: its points lying in the plane square to its path there."""
    way = way.normalized()
    corners = [v.co for v in obj.data.vertices]
    reach = max((c - middle).length for c in corners)
    ring = [c for c in corners if abs((c - middle).dot(way)) <= max(1e-7, 1e-5 * reach)]
    return max(((a - b).length for i, a in enumerate(ring) for b in ring[i + 1 :]), default=0.0)


def tube_text(obj, spec):
    """A tube's section, taper and ends, measured on its shape."""
    said = []
    if not spec.get("closed") and (spec.get("taper") is not None or spec.get("section") is not None):
        path = points(spec.get("points"), "points", 3, 2)
        ways = end_ways(spec, path)
        start, end = (ring_across(obj, path[i], ways[k]) for i, k in ((0, 0), (-1, 1)))
        said.append(f"{length(start)} across at its start and {length(end)} at its end" if start > 1e-6 and end > 1e-6 else
                    f"{length(max(start, end))} across at its {'start' if start > end else 'end'}, coming to a point at the other")
    if spec.get("section") is not None:
        said.append(f"its section drawn through {len(spec['section'])} points")
    if spec.get("caps") is False and not spec.get("closed"):
        said.append("open at its ends")
    return "; ".join(said)


def made_text(kind, spec, obj):
    """What the object is made of, as its answer says it."""
    if kind == "tube":
        return tube_text(obj, spec)
    if kind in COUNTED_KINDS or (obj.type == "MESH" and any(spec.get(k) is not None for k in COUNTS)):
        prefix = {
            "sphere": f"{int(spec.get('segments', 64))} segments round, {int(spec.get('rings', max(3, int(spec.get('segments', 64)) // 2)))} rings: ",
            "torus": f"{int(spec.get('segments', 64))} segments round, {int(spec.get('rings', 24))} round its tube: ",
            "cylinder": f"{int(spec.get('segments', 64))} sides: ",
            "cone": f"{int(spec.get('segments', 64))} sides: ",
            "icosphere": f"an icosphere of subdivisions {int(spec.get('subdivisions', ICOSPHERE_LEVELS[2]))}: ",
            "quad_sphere": f"a quad sphere, {int(spec.get('segments', 8))} quads along each edge of its cube: ",
            "monkey": "the monkey: ",
        }.get(kind, "")
        return prefix + made_of(kind, obj)
    return ""


def model(spec, name, workspace):
    """A model file brought in as a group, fitted to a size when one is given."""
    obj, children = model_file(spec.get("path"), name, workspace)
    if spec.get("size") is not None:
        fit_group(obj, children, positive_size(spec.get("size"), "size"))
    return obj, children


# Each kind: what it is built from besides where it goes, and what makes it.
# A maker is given the description, the name and the workspace, and answers
# the object and, for a group, the parts it holds.
KINDS = {
    "cube": (("size",), solid(cube)),
    "box": (("size",), solid(cube)),
    "cylinder": (("size", "segments"), solid(cylinder)),
    "cone": (("size", "segments", "top_ratio"), solid(cone)),
    "sphere": (("size", "segments", "rings"), solid(sphere)),
    "icosphere": (("size", "subdivisions"), solid(icosphere)),
    "quad_sphere": (("size", "segments"), solid(quad_sphere)),
    "plane": (("size",), solid(plane)),
    "grid": (("size", "segments", "rows"), solid(grid)),
    "circle": (("size", "segments", "fill"), solid(circle)),
    "torus": (("diameter", "thickness", "segments", "rings"), solid(torus)),
    "monkey": (("size",), solid(monkey)),
    "revolve": (("profile", "segments", "closed"), solid(revolved)),
    "outline": (("points", "holes", "height"), solid(outline, named=True)),
    "tube": (("points", "radius", "section", "taper", "caps", "corners", "closed"), tube_object),
    "text": (("text", "height", "depth", "font", "wrap_radius"), whole_object(text_object)),
    "image": (("path", "width"), whole_object(picture)),
    "svg": (("path", "width", "depth"), lambda spec, name, workspace: svg_drawing(spec, name)),
    "model": (("path", "size"), model),
    "instance": (("of",), instance),
}
TAKES = {kind: takes for kind, (takes, _) in KINDS.items()}


def check_inputs(spec):
    """Refuses an input the kind does not use, which would otherwise be dropped without a word."""
    kind = spec.get("kind")
    if not isinstance(kind, str) or kind not in TAKES:
        return
    unused = sorted(set(spec) - PLACING - set(TAKES[kind]))
    if not unused:
        return
    others = {key: sorted(k for k, takes in TAKES.items() if key in takes and k != "box") for key in unused}
    whose = "; ".join(f"{key} is for {', '.join(kinds)}" if kinds else f"{key} is not an input" for key, kinds in others.items())
    shape = " (size is [x, y, z]: a cylinder's is [diameter, diameter, height])" if kind in ("cylinder", "cone", "sphere") else ""
    raise Refused(f"A {kind} takes {', '.join(TAKES[kind])}{shape}; {whose}.")


@lets_light_through_sheets
@lays_grain
def add_objects(args, scene_file):
    specs = args.get("objects")
    need(isinstance(specs, list) and specs, "objects must list at least one object.")
    added = []
    tilts = {}
    made = {}
    for spec in specs:
        need(isinstance(spec, dict), "Each object is described by an object with a kind and a name.")
        check_inputs(spec)
        name = unused_name(spec.get("name"))
        kind = spec.get("kind")
        # A box is a cube by its other name, and is not listed twice.
        need(
            isinstance(kind, str) and kind in KINDS,
            f"kind must be one of {one_of(k for k in KINDS if k != 'box')}.",
        )
        need(
            kind != "instance" or (spec.get("smooth") is None and spec.get("bevel") is None),
            f"“{name}” is an instance, which shows its source's shape as it is: smooth or bevel the source instead.",
        )
        obj, group_children = KINDS[kind][1](spec, name, args.get("workspace"))
        if obj.name not in bpy.context.scene.objects:
            link(obj)
        obj.rotation_euler = rotation(spec.get("rotation"))
        obj.location = vector(spec.get("location"), "location", default=LOCATION)
        if group_children is not None and kind != "model":
            # A drawing's origin is where it was placed; its parts are centred
            # on it, moved in the world's terms whatever the group's scale. A
            # model file keeps the coordinates it was made in, round its own
            # origin, so a part designed in CAD is where the design put it.
            bpy.context.view_layer.update()
            bounds = world_bounds(group_children)
            if bounds:
                offset = obj.location - (bounds[0] + bounds[1]) / 2
                for child in obj.children:
                    moved = child.matrix_world.copy()
                    moved.translation += offset
                    child.matrix_world = moved
        # A round shape drawn with flat faces shows each one as a stripe in
        # anything glossy; it is smooth unless asked to be flat.
        # A model file's parts sit under its group, so each is shaded.
        if spec.get("smooth", kind in ROUND_KINDS or spec.get("wrap_radius") is not None):
            for part in tree(obj):
                if not is_helper(part):
                    smooth(part)
        if spec.get("bevel") is not None:
            bevel(obj, spec["bevel"])
        on = resting_on(spec, obj.name)
        if on is not None:
            resting = rest(obj, on, bool(spec.get("align_to_surface")))
            # Its tilt is news; where it rests, its heights already say.
            if spec.get("align_to_surface"):
                tilts[obj] = resting
        if spec.get("parent"):
            parent = find_object(spec["parent"])
            attach(obj, parent)
        # Its scale in the world as added, a group's parts' too, is its built
        # size: scaling is a factor on it, whatever it is attached to later.
        bpy.context.view_layer.update()
        for part in tree(obj):
            if not is_helper(part):
                part[BUILT_SCALE] = list(part.matrix_world.to_scale())
        stamp(obj, kind)
        added.append(obj)
        made[obj] =instance_text(obj) if kind == "instance" else made_text(kind, spec, obj)
        if spec.get("flying") is not None:
            made[obj] = "; ".join(filter(None, [made[obj], mark_flying(obj, spec["flying"])]))
    return "\n".join(
        f"Added {placed(o)}" + (f", {tilts[o]}" if o in tilts else "") + (f"; {made[o]}" if made[o] else "") + "."
        for o in added
    )
