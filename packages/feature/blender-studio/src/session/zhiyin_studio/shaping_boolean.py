"""
Cutting, joining and intersecting: a boolean step with an object, a collection of objects or a
cutter described in the call, by the solver asked or one chosen for the shapes, saying which and
why. A cutter described in the call is a box, cylinder, sphere, rounded box, slot, prism on an
outline or lettering. A cut that takes nothing away is refused with why: the shapes do not reach
each other, or they only touch where their faces lie in one plane. A result with sliver faces, or
with open edges the part did not have, says so.
"""

import bpy
import numpy

from .arguments import need, number, positive_size, rotation, vector
from .cuts import NOTHING, Shape, changed, cut_text, reach_text
from .cutter_shapes import outline_prism, rounded_box, slot, text_prism
from .errors import Refused
from .finding import CUTTERS, collection, find_object
from .making import cube, cylinder, mesh_from, sphere
from .mesh_checks import Mesh, doubled, without_area
from .placing import attach
from .scales import scene_scale
from .shaping_measure import evaluated_mesh
from .wording import one_of, point_text, volume_text

CUTTER_SHAPES = {
    "box": cube,
    "cube": cube,
    "cylinder": cylinder,
    "sphere": sphere,
    "rounded_box": rounded_box,
    "slot": slot,
    "outline": outline_prism,
    "text": text_prism,
}
# How a cutter's shape is said in an answer.
CUTTER_WORDS = {"rounded_box": "rounded box", "outline": "prism"}

# Points of a boolean's result nearer than this are joined, in metres: a micrometre.
JOINED = 1e-6
# A face of a boolean's result smaller than this is a sliver, in square metres: a hundredth of a square millimetre.
SLIVER = 1e-8

CUTTER_TAKES = {
    "cylinder": ("diameter", "depth", "size"),
    "box": ("size",),
    "cube": ("size",),
    "sphere": ("diameter", "size"),
    "rounded_box": ("size", "radius"),
    "slot": ("size",),
    "outline": ("points", "depth"),
    "text": ("text", "height", "depth"),
}
# The cutters whose size comes from what they are drawn as, not a size given.
DRAWN = ("outline", "text")
# The shapes a cutter is offered as; cube is taken as another word for box.
OFFERED_SHAPES = sorted(set(CUTTER_SHAPES) - {"cube"})
# What every cutter takes besides its own.
CUTTER_PLACING = ("shape", "location", "rotation", "segments")

BOOLEAN_OPERATIONS = ("difference", "union", "intersect")
SOLVERS = {"float": "FLOAT", "exact": "EXACT", "manifold": "MANIFOLD"}
# A face of one shape lying in a face of the other is nearer it than this share of their size.
TOUCHING = 1e-6
# What a boolean does unless the call says.
OPERATION = "difference"


def cutter(spec, target):
    need(isinstance(spec, dict), "A cutter is described by its shape, size and location.")
    shape = spec.get("shape", "cylinder")
    need(shape in CUTTER_SHAPES, f"A cutter's shape is {one_of(OFFERED_SHAPES)}.")
    unused = sorted(set(spec) - set(CUTTER_PLACING) - set(CUTTER_TAKES[shape]))
    need(not unused, f"A {shape} cutter takes {', '.join(CUTTER_TAKES[shape])}, not {', '.join(unused)}.")
    size = spec.get("size")
    if size is None and shape == "cylinder":
        diameter = number(spec.get("diameter"), "cutter diameter", minimum=1e-7)
        depth = number(spec.get("depth"), "cutter depth", minimum=1e-7)
        size = [diameter, diameter, depth]
    elif size is None and shape == "sphere" and spec.get("diameter") is not None:
        diameter = number(spec.get("diameter"), "cutter diameter", minimum=1e-7)
        size = [diameter] * 3
    if shape in DRAWN:
        built = CUTTER_SHAPES[shape](spec)
        size = [max(v.co[i] for v in built.verts) - min(v.co[i] for v in built.verts) for i in range(3)]
    else:
        # Never a default: a cutter of the wrong size takes the wrong part away.
        need(size is not None, f"A {shape} cutter needs its size, [x, y, z] in metres.")
        size = list(positive_size(size, "cutter size"))
        built = CUTTER_SHAPES[shape]({**spec, "size": size})
    index = 1
    while bpy.data.objects.get(f"{target.name} cutter {index}"):
        index += 1
    name = f"{target.name} cutter {index}"
    obj = bpy.data.objects.new(name, mesh_from(built, name))
    collection(CUTTERS, hide_render=True).objects.link(obj)
    obj.location = vector(spec.get("location"), "cutter location")
    obj.rotation_euler = rotation(spec.get("rotation"))
    obj.display_type = "WIRE"
    obj.hide_render = True
    # Attached where it is, so the hole moves, turns and is copied with its object.
    attach(obj, target)
    return obj, size


def unclean(obj):
    """What keeps a shape from the manifold solver, as its steps leave it, or nothing when it is closed and clean."""
    bm = evaluated_mesh(obj)
    try:
        open_edges = sum(1 for e in bm.edges if e.is_boundary)
        shared = sum(1 for e in bm.edges if len(e.link_faces) > 2)
        loose = sum(1 for e in bm.edges if not e.link_faces)
    finally:
        bm.free()
    faults = []
    if open_edges:
        faults.append(f"{open_edges} open {'edge' if open_edges == 1 else 'edges'}")
    if shared:
        faults.append(f"{shared} {'edge' if shared == 1 else 'edges'} joining more than two faces")
    if loose:
        faults.append(f"{loose} loose {'edge' if loose == 1 else 'edges'}")
    return f"{obj.name} has {' and '.join(faults)}" if faults else None


def chosen_solver(spec, shapes):
    """The solver a step uses and, when it was chosen for the shapes, the words saying why."""
    asked = spec.get("solver")
    tolerant = bool(spec.get("self_intersection")) or bool(spec.get("hole_tolerant"))
    if asked is None:
        return "EXACT", None
    need(asked in (*SOLVERS, "auto"), f"A boolean's solver is {one_of([*SOLVERS, 'auto'])}.")
    if asked != "auto":
        need(
            not tolerant or asked == "exact",
            "self_intersection and hole_tolerant are the exact solver's: give solver exact or auto.",
        )
        if asked == "manifold":
            faults = [f for f in (unclean(o) for o in shapes) if f]
            need(
                not faults,
                f"The manifold solver takes only closed shapes whose every edge joins two faces, and {'; '.join(faults)}:"
                " give solver exact, which takes any shape, or auto.",
            )
        return SOLVERS[asked], None
    if tolerant:
        return "EXACT", "by the exact solver, as only it takes shapes that cross themselves or have holes"
    faults = [f for f in (unclean(o) for o in shapes) if f]
    if faults:
        return "EXACT", f"by the exact solver, as {'; '.join(faults)}, which the manifold solver cannot take"
    return "MANIFOLD", "by the manifold solver, as every shape is closed with each edge joining two faces, so it cuts exactly and fastest"


def touching_faces(part, other):
    """How many faces of one shape lie in the other's faces, facing against them: where two shapes only touch."""
    if part.tree is None or other.tree is None:
        return 0
    low, high = part.bounds()
    reach = max(high[i] - low[i] for i in range(3))
    found = 0
    for tree, points in ((other.tree, part.points), (part.tree, other.points)):
        gaps = [tree.find_nearest(p)[3] for p in points]
        near = sum(1 for gap in gaps if gap is not None and gap <= TOUCHING * reach)
        found = max(found, near)
    return found


def operands(obj, spec):
    """The objects a step combines with: one in the scene, a collection's or a cutter made for the call."""
    given = [key for key in ("cutter", "with", "collection") if spec.get(key) is not None]
    need(len(given) == 1, "A boolean combines with exactly one of with, collection and cutter.")
    if spec.get("cutter") is not None:
        other, size = cutter(spec["cutter"], obj)
        shape = spec["cutter"].get("shape", "cylinder")
        return [other], CUTTER_WORDS.get(shape, shape), size[0] if shape == "cylinder" else None, None
    if spec.get("with") is not None:
        other = find_object(spec.get("with"), {"MESH"})
        need(other != obj, "An object cannot be combined with itself.")
        return [other], None, None, None
    name = spec.get("collection")
    held = bpy.data.collections.get(name) if isinstance(name, str) else None
    need(
        held is not None,
        f"There is no collection named “{name}”. The scene has: {', '.join(c.name for c in bpy.data.collections if c.name != CUTTERS) or 'none'}.",
    )
    meshes = [o for o in held.all_objects if o.type == "MESH" and o != obj]
    need(meshes, f"The collection “{name}” holds no mesh to combine with.")
    return meshes, None, None, held


def float_check(obj, modifier, operation):
    """What the float solver got wrong, measured against the exact solver's result, or nothing."""
    made = Shape(obj)
    modifier.solver = "EXACT"
    bpy.context.view_layer.update()
    exact = Shape(obj)
    modifier.solver = "FLOAT"
    bpy.context.view_layer.update()
    if made.volume is None and exact.volume is not None:
        return (
            "; the float solver's result is not closed where the exact one's is, as it goes wrong where faces"
            " lie in one plane or meet edge to edge: give solver exact"
        )
    if made.volume is None or exact.volume is None:
        return ""
    apart = abs(made.volume - exact.volume)
    if apart <= NOTHING * max(exact.volume, 1e-12):
        return ""
    return (
        f"; the float solver's result differs from the exact one's by {volume_text(apart)}, as it does where faces"
        " lie in one plane or meet edge to edge: give solver exact"
    )


def hide_operand(obj, other, spec):
    """Hidden, an object it cuts with is the part's cutter as one described here is."""
    if spec.get("keep_visible"):
        return ""
    # Kept out of pictures and exports, and, unless it is attached to
    # something already, attached so the hole goes where the part goes.
    other.hide_render = True
    other.display_type = "WIRE"
    for holder in list(other.users_collection):
        holder.objects.unlink(other)
    collection(CUTTERS, hide_render=True).objects.link(other)
    if other.parent is None:
        attach(other, obj)
        return f", now its cutter, attached to {obj.name}"
    return f", now a cutter, attached to {other.parent.name}"


def open_count(mesh):
    return int(numpy.count_nonzero(mesh.face_counts == 1))


def torn_text(obj, open_before):
    """What a boolean's result has that a clean cut leaves none of: sliver faces, and open edges it did not have."""
    mesh = Mesh(obj)
    said = ""
    slivers = numpy.flatnonzero(mesh.areas < SLIVER)
    if len(slivers):
        said += (
            f"; it left {len(slivers)} sliver face{'s' if len(slivers) != 1 else ''} under 0.01 mm², as at"
            f" {point_text(mesh.centres[slivers[0]])}, where its faces and the cutter's nearly meet: move the cutter clear of them or into them"
        )
    opened = numpy.flatnonzero(mesh.face_counts == 1)
    if len(opened) > open_before:
        where = mesh.points[mesh.edges[opened[0]]].mean(axis=0)
        said += f"; its result has {len(opened)} open edges, {open_before} before, as at {point_text(where)}"
    return said


def boolean(obj, spec):
    operation = spec.get("operation", OPERATION)
    need(operation in BOOLEAN_OPERATIONS, f"A boolean's operation is {one_of(BOOLEAN_OPERATIONS)}.")
    open_before = open_count(Mesh(obj))
    before = Shape(obj)
    others, shape, given, held = operands(obj, spec)
    bpy.context.view_layer.update()
    solver, why = chosen_solver(spec, [obj, *others])
    shaped_by = [Shape(o) for o in others]
    modifier = obj.modifiers.new(f"Boolean {held.name if held else others[0].name}", "BOOLEAN")
    modifier.operation = operation.upper()
    if held is not None:
        modifier.operand_type = "COLLECTION"
        modifier.collection = held
    else:
        modifier.object = others[0]
    modifier.solver = solver
    if solver == "EXACT":
        modifier.use_self = bool(spec.get("self_intersection"))
        modifier.use_hole_tolerant = bool(spec.get("hole_tolerant"))
    # Shapes that share faces leave points a hair apart where they meet, with
    # faces of no area between them and faces doubled on one another; joining
    # points that near cleans them away and keeps the shape.
    bpy.context.view_layer.update()
    result = Mesh(obj)
    if doubled(result)[0] or without_area(result)[0]:
        weld = obj.modifiers.new(f"Weld {modifier.name[len('Boolean '):]}", "WELD")
        weld.merge_threshold = JOINED / max(scene_scale(obj))
    after = Shape(obj)
    taken = changed(before, after)
    if operation == "difference" and (before.same_as(after) or (taken is not None and taken <= NOTHING * before.volume)):
        touching = [(o, touching_faces(before, s)) for o, s in zip(others, shaped_by) if s.closed]
        touching = [(o, n) for o, n in touching if n]
        if touching:
            other, count = touching[0]
            raise Refused(
                f"The cut takes nothing away from {obj.name}: {other.name}, {reach_text(shaped_by[others.index(other)])},"
                f" only touches it, {count} of their points lying in each other's faces where their faces meet in one plane,"
                f" so nothing of {obj.name}, {reach_text(before)}, is inside it. Move it so it passes into the part."
            )
        if held is not None:
            raise Refused(
                f"The cut takes nothing away from {obj.name}, {reach_text(before)}: none of {held.name}'s"
                f" {len(others)} objects passes into it. Move them so they pass into the part."
            )
    if held is not None:
        what = f"{operation} with the {len(others)} objects of {held.name}"
        if taken is not None and operation == "difference":
            what += f", taking away {volume_text(taken)}"
        elif taken is not None and operation == "union" and taken < 0:
            what += f", adding {volume_text(-taken)}"
        elif operation == "intersect" and after.volume is not None:
            what += f", keeping {volume_text(after.volume)}"
    else:
        other = others[0]
        what = "" if shape else f"{operation} with {other.name}: "
        # Measured on the part as it now is: never the cutter's own size.
        what += cut_text(obj, other, operation, shape, given, before, after, shaped_by[0])
    if why:
        what += f", {why}"
    elif spec.get("solver") is not None:
        what += f", by the {spec['solver']} solver"
    if solver == "FLOAT":
        what += float_check(obj, modifier, operation)
    if solver == "EXACT" and spec.get("self_intersection"):
        what += ", its own crossings resolved"
    if solver == "EXACT" and spec.get("hole_tolerant"):
        what += ", holes in its shapes tolerated"
    what += torn_text(obj, open_before)
    if shape is None and held is None:
        what += hide_operand(obj, others[0], spec)
    elif held is not None and not spec.get("keep_visible"):
        for other in others:
            other.hide_render = True
            other.display_type = "WIRE"
        what += f", {held.name} hidden from pictures"
    return what
