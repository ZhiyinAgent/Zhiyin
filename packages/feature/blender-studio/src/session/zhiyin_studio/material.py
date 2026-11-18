"""
blender_set_material: a material made or changed and given to objects, to a CAD part's groups
of surfaces, or to the faces of a mesh picked by where they face, where they are or what marks
them.
"""

import json

import bpy

from . import material_faces
from .arguments import colour, need, number
from .describe import material_facts
from .finding import find_objects
from .finishes_shape import lay_runs
from .glass import lets_light_through_sheets
from .material_build import build
from .material_marks import DRIPS, RUST
from .material_pictures import refuse_unlaid
from .material_values import COLOURS, GIVEN, INPUTS, changes, is_own, kept_values, patched, shader_of
from .model_shapes import slots_of_surface, surface_names
from .stylised import BANDS, SHADOW, shaded_toon
from .uv_checks import picture_inputs
from .wood import lays_grain
from .wording import listed

# What a material made by other means takes in place, keeping its own nodes.
IN_PLACE = {*INPUTS, *COLOURS}
# Inputs that bend light, from 1 to 4; every other number in place is 0 to 1.
BENDING = ("ior", "coat_ior")
# What toon takes.
TOON_TAKES = ("bands", "shadow", "shadow_color", "rim", "faceted")


@lets_light_through_sheets
@lays_grain
def set_material(args, scene_file):
    """The material as the call gives it, then, with toon, shaded in flat bands of light."""
    spec = args.get("toon")
    if spec is None:
        return given_material(args, scene_file)
    need(isinstance(spec, dict), "toon gives bands, shadow or shadow_color, rim and faceted.")
    unknown = set(spec) - set(TOON_TAKES)
    need(not unknown, f"toon has no {', '.join(sorted(unknown))}: it takes bands, shadow, shadow_color, rim and faceted.")
    named = (args.get("material") or {}).get("name")
    whole_objects = args.get("surface") is None and material_faces.faces_spec(args) is None
    need(named or whole_objects, "A toon on some faces or surfaces needs the material named: give material name.")
    answer = given_material(args, scene_file)
    found = bpy.data.materials.get(named) if named else find_objects(args["objects"])[0].active_material
    need(found is not None, "The material the toon is for was not made.")
    _, said = shaded_toon(found, spec.get("bands", BANDS), shadow=spec.get("shadow", SHADOW), shadow_color=spec.get("shadow_color"), rim=spec.get("rim"), faceted=spec.get("faceted", False))
    return f"{answer} {said[0].upper()}{said[1:]}; render it with EEVEE, which makes it the picture to hand over."


def given_material(args, scene_file):
    names = args.get("objects")
    need(isinstance(names, list) and names, "objects must name at least one object.")
    targets = find_objects(names, {"MESH", "CURVE", "FONT", "SURFACE", "META"})
    surface = args.get("surface")
    slots = None
    if surface is not None:
        need(
            isinstance(surface, str) and surface.strip(),
            "surface names a group of a CAD part's surfaces, such as “machined”, or “rest” for its other faces.",
        )
        # Every object's slots are found before anything changes, so a refusal leaves the scene as it was.
        slots = {obj.name: slots_of_surface(obj, surface.strip()) for obj in targets}
    faces = material_faces.faces_spec(args)
    picked = None
    if faces is not None:
        picked = {obj.name: material_faces.picked_faces(obj, faces) for obj in targets}
    if picked is not None:
        on = " and ".join(f"{material_faces.area_said(o, picked[o.name][0])}, {picked[o.name][1]}" for o in targets)
    elif slots is not None:
        on = f"the {surface.strip()} surfaces of {', '.join(o.name for o in targets)}"
    else:
        on = ", ".join(o.name for o in targets)
    spec = args.get("material")
    need(isinstance(spec, dict), "material describes the material: its colour, roughness and so on.")
    # Unnamed, a group of surfaces or faces picked gets a material of its own: the
    # object's own material also draws its other faces, which would change with it.
    if faces is not None:
        unnamed = f"{targets[0].name} {material_faces.words_of(faces)} material"
    elif slots is not None:
        unnamed = f"{targets[0].name} {surface.strip()} material"
    else:
        unnamed = f"{targets[0].name} material"
    name = spec.get("name") or unnamed
    existing = bpy.data.materials.get(name)
    if existing is not None and set(spec) == {"name"}:
        # Named with nothing else: the material as it is, on more objects.
        if picture_inputs(existing):
            refuse_unlaid(targets)
        assign(existing, targets, slots, picked)
        # Rust and drip streaks run down each shape as it stands, so a shape that takes them on is measured for them.
        if existing.use_nodes and any(existing.node_tree.nodes.get(mark) for mark in (RUST, DRIPS)):
            for obj in targets:
                if obj.type == "MESH":
                    lay_runs(obj)
        return f"Material {material_facts(existing)} on {on}, unchanged."
    given = {key: value for key, value in spec.items() if key != "name"}
    # One that exists keeps every value the call does not give.
    kept = kept_values(existing) if existing is not None else {}
    if existing is not None and is_own(existing) and set(given) <= IN_PLACE:
        return patch_own(existing, kept, given, targets, slots, picked, on)
    values = patched(kept, given) if existing is not None else given
    rebuilt_own = existing is not None and is_own(existing)
    material = existing or bpy.data.materials.new(name)
    said, told = build(material, values, targets, bpy.context.scene.render.engine)
    shown = assign(material, targets, slots, picked)
    material[GIVEN] = json.dumps(values)
    answer = f"Material {material.name} ({', '.join(said)}) on {on}."
    for sentence in told:
        answer += " " + sentence
    if existing is not None:
        answer += " " + changed_text(material.name, kept, values)
        if rebuilt_own:
            answer += " Its own shader nodes are replaced by these values."
    return answer + (also_shown(material, targets, shown) if existing is not None else "")


def also_shown(material, targets, slots):
    others = shown_elsewhere(material, targets, slots)
    if not others:
        return ""
    joined = listed(others)
    return f" {material.name} also shows on {joined}, which {'changes' if len(others) == 1 else 'change'} with it."


def changed_text(name, kept, values):
    found = changes(kept, values)
    return f"{name} changed: {'; '.join(found)}." if found else f"{name} already had these values."


def patch_own(material, kept, given, targets, slots, picked, on):
    """
    A material made by other means, such as one a model file brought, given
    only values its shader takes as they are: those are set, and its own
    nodes stay, pictures included.
    """
    inputs = shader_of(material).inputs
    for key, value in given.items():
        socket = inputs[COLOURS[key]] if key in COLOURS else inputs[INPUTS[key]]
        for link in list(socket.links):
            material.node_tree.links.remove(link)
        low, high = (1, 4) if key in BENDING else (0, 1)
        socket.default_value = colour(value, key) if key in COLOURS else number(value, key, minimum=low, maximum=high)
    shown = assign(material, targets, slots, picked)
    return (
        f"Material {material_facts(material)} on {on}. {changed_text(material.name, kept, patched(kept, given))}"
        " Its own shader nodes stay." + also_shown(material, targets, shown)
    )


def shown_elsewhere(material, targets, slots):
    """
    Where else a material shows than on what a call gave it to: each other
    object, or the groups of surfaces of a part that has them.
    """
    given = {obj.name: (None if slots is None else set(slots[obj.name])) for obj in targets}
    found = []
    for obj in bpy.data.objects:
        showing = [i for i, slot in enumerate(getattr(obj, "material_slots", [])) if slot.material == material]
        if obj.name in given and given[obj.name] is None:
            # Given the material whole: nothing of it shows anything else.
            continue
        mine = given.get(obj.name) or set()
        rest = [i for i in showing if i not in mine]
        if not rest:
            continue
        names = surface_names(obj.data) if obj.type == "MESH" else []
        if names and (obj.name in given or len(rest) < len(obj.material_slots)):
            groups = sorted({names[i] for i in rest if i < len(names)})
            found.append(f"{obj.name}'s {' and '.join(groups)} surfaces")
        else:
            found.append(obj.name)
    return found


def assign(material, targets, slots=None, picked=None):
    """
    Puts the material on each object whole, with slots on the slots of each object named there,
    or with faces picked on those faces alone; the slots it went on, or None for whole objects.
    """
    if picked is not None:
        return {obj.name: [material_faces.give_faces(material, obj, picked[obj.name][0])] for obj in targets}
    for obj in targets:
        if slots is not None:
            for index in slots[obj.name]:
                obj.material_slots[index].material = material
        elif obj.data.materials:
            obj.data.materials[0] = material
            for slot in obj.material_slots:
                slot.material = material
        else:
            obj.data.materials.append(material)
    return slots
