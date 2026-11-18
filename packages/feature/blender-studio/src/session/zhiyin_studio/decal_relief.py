"""
Normal decals: relief drawn by shading alone, the surface's shape untouched. A normal decal is
projected onto the surface as a picture decal is and draws one of Zhiyin's own shapes, or a
picture's brightness, as its height; a normal strip runs a groove, a bead or a shape repeated along
a line. Each wears a copy of the surface's material bent by the height on top of the relief the
surface already has, and darkened in its recesses, so it matches everywhere else. Its answer says
that the outline stays the surface's, and a groove's whether it runs unbroken and where the camera
sees it reach the object's outline, which only a real cut can notch.
"""

import numpy

from .arguments import need, number, vector
from .decal_cards import projected, stretch_text
from .decal_materials import MADE_FOR, relief_material
from .decal_objects import OFFSET, Decal, overlap_text, placed, shares_text
from .decal_shapes import SHAPES, groove_relief, picture_relief, relief_words, shape_relief
from .decal_surface import fighting_text, gap_words, landing, picture_axes, way_text
from .finding import scene
from .texel_density import pixels_per_metre
from .wording import area_text, length, listed, point_text, size_text

# Seen this near edge-on, a point of a groove lies on the object's outline.
OUTLINE = 0.1
# Default pitch of a shape repeated along a strip, in its own lengths.
SHAPE_PITCH = 3


def relief_value(args):
    given = args.get("relief")
    return None if given is None else number(given, "relief", minimum=-0.1, maximum=0.1)


def relief_on(surface, args, name):
    """A normal decal projected onto the surface: one of the library's shapes, or a picture's brightness, as relief."""
    target = surface.obj
    decal = Decal(name, target)
    shape, path = args.get("shape"), args.get("picture")
    need(
        (shape is None) != (path is None),
        "Give exactly one of shape and picture: a normal decal draws one of Zhiyin's shapes, or a picture's brightness as its height.",
    )
    width = number(args.get("size"), "size", minimum=1e-5)
    if shape is not None:
        need(shape in SHAPES, f"shape is one of {listed(SHAPES)}.")
        relief = shape_relief(shape, args.get("count"), width, relief_value(args), name)
    else:
        need(args.get("count") is None, "count is for a vent, a grille or a hinge shape, not a picture.")
        relief = picture_relief(path, relief_value(args))
    height = width / relief.aspect
    at = vector(args.get("at"), "at")
    direction = vector(args["direction"], "direction") if args.get("direction") is not None else None
    need(direction is None or direction.length > 0, "direction must not be (0, 0, 0).")
    rotation = number(args.get("rotation"), "rotation", default=0)
    offset = number(args.get("offset"), "offset", minimum=0, maximum=0.1, default=OFFSET)
    hit, normal, toward = landing(surface, at, direction)
    axes = picture_axes(toward, rotation)
    laid = projected(surface, hit, axes, width, height)
    made = placed(surface, laid, name, hit, axes, (width, height), offset)
    unders = []
    for base in made.bases:
        own = f"{name} on {base.name}" if base is not None else f"{name} material"
        material, under = relief_material(base, own, relief, decal)
        made.obj.data.materials.append(material)
        if under is not None:
            unders.append(under)
    lines = [
        f"Decal “{name}” on {target.name}: {relief.said}, {size_text((width, height))}, projected along "
        f"{way_text(-toward)} onto the surface at {point_text(hit)}, which faces {way_text(normal)} there.",
        f"On the surface it spans {size_text((made.across, made.up))} along its middle lines and covers "
        f"{area_text(made.area)}; {stretch_text(made.worst, made.where)}.",
        shares_text(laid, target),
        relief_text(relief, target, made.bases, made.obj, unders),
        "It is drawn by shading alone: the outline stays the surface's, so seen edge-on or in a close-up it stands out "
        "of nothing; a part that must show in the outline is modelled.",
        overlap_text(made.under),
        f"It stands {gap_words(made.least, made.most)} off the surface and moves with {target.name}. "
        + fighting_text(made.least if made.least > 0 else made.lifted, hit),
    ]
    return lines


def relief_text(relief, target, bases, obj, unders):
    """What a normal decal changes: the surface's relief in copies of its materials, over the relief it had."""
    named = [b for b in bases if b is not None]
    owns = [m.name for m in obj.data.materials]
    stands = relief_words(relief)
    if not named:
        said = (
            f"It changes only the relief of {target.name}'s surface, {stands}, in a material of its own, "
            f"“{owns[0]}”; {target.name} has no material, so its copy starts from Blender's plain grey."
        )
    elif len(bases) == 1:
        base = bases[0].name
        said = (
            f"It changes only the relief of {target.name}'s material “{base}”, {stands}, in a copy of its own, "
            f"“{owns[0]}”, which keeps {base}'s other values."
        )
    else:
        said = (
            f"It changes only the relief of {target.name}'s materials {listed(f'“{b.name}”' for b in named)}, "
            f"{stands}, in copies of their own, {listed(f'“{o}”' for o in owns)}, which keep their other values."
        )
    if unders:
        said += f" The surface's own relief ({listed(sorted({u.bl_label for u in unders}))}) still shows under it."
    return said


def strip_relief(args, name, width):
    """A normal strip's height map: a groove or bead across it, or a library shape repeated along it, and its pitch."""
    pattern = args["pattern"]
    for key in ("picture", "color", "roughness", "metal", "coat", "raised"):
        need(
            args.get(key) is None,
            f"{key} is not for a {pattern} strip, which changes only the surface's relief: its colour and finish stay the surface's.",
        )
    given = relief_value(args)
    if pattern == "groove":
        need(args.get("shape") is None and args.get("count") is None, "shape and count are for a shape strip, not a groove.")
        need(args.get("pitch") is None, "A groove has no pitch: it runs whole.")
        return groove_relief(given if given is not None else -width / 2, name), None, None
    shape = args.get("shape")
    need(shape in SHAPES, f"A shape strip repeats a shape: give shape, one of {listed(SHAPES)}.")
    own = width * SHAPES[shape][0]
    if args.get("pitch") is not None:
        pitch = number(args["pitch"], "pitch", minimum=1e-5)
        need(pitch >= own - 1e-9, f"pitch must be at least the {shape}'s own length, {length(own)}, for one to fit each repeat.")
        asked = f"asked {length(pitch)}"
    else:
        pitch = own * SHAPE_PITCH
        asked = f"by default {SHAPE_PITCH} of its lengths"
    relief = shape_relief(shape, args.get("count"), width, given, name, room=pitch / own)
    return relief, pitch, asked


def relief_strip_materials(surface, obj, relief, decal):
    """Gives a normal strip copies of the materials under each of its faces, bent by its relief."""
    target = surface.obj
    used = sorted({f.material_index for f in obj.data.polygons})
    for poly in obj.data.polygons:
        poly.material_index = used.index(poly.material_index)
    slots = target.material_slots
    bases = [slots[i].material if i < len(slots) else None for i in used]
    unders = []
    for base in bases:
        own = f"{decal.name} on {base.name}" if base is not None else f"{decal.name} material"
        material, under = relief_material(base, own, relief, decal, repeat=True)
        material[MADE_FOR] = decal.name
        obj.data.materials.append(material)
        if under is not None:
            unders.append(under)
    return bases, unders



def view_text(runs, width, target):
    """How wide a groove is in the camera's picture, and where it reaches the object's outline as the camera sees it."""
    camera = scene().camera
    if camera is None:
        return "The scene has no camera to judge where it shows by."
    points = [p for r in runs for p in r.points]
    fills, _ = pixels_per_metre(camera, numpy.array([tuple(p) for p in points]))
    if not fills.max() > 0:
        return "The camera does not see it."
    widest = float(fills.max()) * width
    eye = camera.matrix_world.translation
    outline = []
    for run in runs:
        for k, (a, b) in enumerate(zip(run.points, run.points[1:])):
            middle = (a + b) / 2
            found = target_surface_normal(run, k)
            if found is None:
                continue
            view = (middle - eye).normalized()
            if abs(found.dot(view)) < OUTLINE:
                outline.append(middle)
    said = f"In the camera's picture it is up to {widest:.2g} px wide"
    if not outline:
        return said + ", and it reaches the outline nowhere the camera sees."
    return (
        said + f", and it reaches {target.name}'s outline as the camera sees it near {point_text(outline[0])}: a real gap "
        "would notch the outline there, which shading cannot; cut it with blender_shape_objects boolean if it must show."
    )


def target_surface_normal(run, k):
    """The surface's normal under a piece of a run: across its two sides."""
    plus, minus = run.sides[k]
    if plus.length == 0 or minus.length == 0:
        return None
    way = run.points[k + 1] - run.points[k]
    if way.length == 0:
        return None
    normal = way.cross(plus)
    return normal.normalized() if normal.length > 0 else None

