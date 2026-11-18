"""
Which objects a light lights and which cast its shadows, the rays that see an object, and cards
that shape light without being seen: a glowing card seen only in reflections, a white card that
only bounces light and a black flag that only blocks it.

Cycles and EEVEE both keep light and shadow linking. Of the rays, EEVEE keeps the camera's and
the shadows': a surface it hides from the camera it neither shows in reflections nor lets light
anything, which Cycles does.
"""

import bpy
import mathutils

from .aiming import look_at
from .arguments import colour, need, number, vector
from .errors import Refused
from .finding import find_object, find_objects, subjects
from .geometry import middle_of, world_bounds
from .lighting_measure import SAMPLES, Measures, change, means, no_camera, shown
from .wording import hex_of, listed, one_of, point_text, size_text

# Each ray an object can be seen by: the tool's name for it, the property, and its words.
RAYS = (
    ("camera", "visible_camera", "the camera"),
    ("bounced", "visible_diffuse", "bounced light"),
    ("reflections", "visible_glossy", "reflections"),
    ("refraction", "visible_transmission", "refraction"),
    ("shadows", "visible_shadow", "shadows"),
    ("fog", "visible_volume_scatter", "fog"),
)
# Said once with any answer that sets rays.
EEVEE_RAYS = (
    "EEVEE keeps only the camera and shadows of these: something it hides from the camera it neither shows in"
    " reflections nor lets light anything, which Cycles does."
)
# What sees each kind of card, by the tool's names for the rays.
CARD_RAYS = {
    "reflection": {"reflections", "refraction"},
    "bounce": {"bounced", "reflections", "refraction"},
    "flag": {"bounced", "reflections", "refraction", "shadows"},
}
CARD_WORDS = {
    "reflection": "a glowing card seen only in reflections and through glass",
    "bounce": "a white card that only bounces light",
    "flag": "a black card that only blocks light",
}
CARD_COLOURS = {"reflection": "#ffffff", "bounce": "#ffffff", "flag": "#000000"}
# Of a card's own glow: 1 shows its colour as given.
CARD_STRENGTH = 4
# A new card's width and height in metres by default.
CARD_SIZE = (1, 1)
# How many names are said of the objects a link leaves out.
NAMED = 6


def with_parts(names, field):
    """The objects a list names, with their parts, each once; refused when it is not a list of names."""
    need(isinstance(names, list) and all(isinstance(n, str) for n in names), f"{field} is a list of object names.")
    found = {}
    for obj in find_objects(names):
        for part in (obj, *obj.children_recursive):
            found.setdefault(part.name, part)
    return list(found.values())


def linked_states(group):
    """A link collection's objects, each with whether it is let in or kept out."""
    if group is None:
        return {}
    return {item_object.name: item.light_linking.link_state for item_object, item in zip(group.objects, group.collection_objects)}


def set_links(light, kind, only, excepted):
    """
    Sets which objects a light lights ("lights") or lets cast its shadows
    ("shadows"): those let in alone, when any are, and never those kept out.
    A side not given keeps what it had; an empty list clears it.
    """
    owner = light.light_linking
    attribute = "receiver_collection" if kind == "lights" else "blocker_collection"
    states = linked_states(getattr(owner, attribute))
    if only is not None:
        states = {name: state for name, state in states.items() if state != "INCLUDE"}
        states.update({o.name: "INCLUDE" for o in only})
    if excepted is not None:
        states = {name: state for name, state in states.items() if state != "EXCLUDE"}
        both = [o.name for o in excepted if states.get(o.name) == "INCLUDE"]
        if both:
            raise Refused(f"{listed(both, NAMED)} cannot be both in {kind}_only and in {kind}_except of {light.name}.")
        states.update({o.name: "EXCLUDE" for o in excepted})
    group = getattr(owner, attribute)
    if not states:
        setattr(owner, attribute, None)
        if group is not None and group.users == 0:
            bpy.data.collections.remove(group)
        return
    if group is None:
        group = bpy.data.collections.new(f"Zhiyin {light.name} {kind}")
        setattr(owner, attribute, group)
    for obj in list(group.objects):
        group.objects.unlink(obj)
    for name in states:
        group.objects.link(bpy.data.objects[name])
    for item_object, item in zip(group.objects, group.collection_objects):
        item.light_linking.link_state = states[item_object.name]


def links_text(light):
    """Which objects a light lights and lets cast its shadows, or nothing when it lights and shades everything."""
    shown = [o for o in subjects() if o.type in ("MESH", "CURVE", "FONT", "SURFACE", "META", "CURVES", "VOLUME", "POINTCLOUD")]
    said = []
    for kind, attribute in (("lights", "receiver_collection"), ("shadows", "blocker_collection")):
        states = linked_states(getattr(light.light_linking, attribute))
        if not states:
            continue
        let_in = [n for n, s in states.items() if s == "INCLUDE"]
        kept_out = [n for n, s in states.items() if s == "EXCLUDE"]
        left = [o.name for o in shown if (let_in and o.name not in let_in) or o.name in kept_out]
        if kind == "lights":
            said.append(
                (f"lights only {listed(let_in, NAMED)}" if let_in else "lights everything")
                + (f" but {listed(kept_out, NAMED)}" if kept_out else "")
                + (f": {listed(left, NAMED)} {'gets' if len(left) == 1 else 'get'} none of its light" if left else "")
            )
        else:
            said.append(
                (f"only {listed(let_in, NAMED)} {'casts' if len(let_in) == 1 else 'cast'} its shadows" if let_in else "everything casts its shadows")
                + (f", never {listed(kept_out, NAMED)}" if kept_out else "")
            )
    return "; ".join(said)


def light_links(light, spec):
    """Light and shadow linking, from a light's spec; what it says of them, or nothing when none is given."""
    fields = ("lights_only", "lights_except", "shadows_only", "shadows_except")
    if not any(spec.get(f) is not None for f in fields):
        return ""
    picked = {f: with_parts(spec[f], f) if spec.get(f) is not None else None for f in fields}
    set_links(light, "lights", picked["lights_only"], picked["lights_except"])
    set_links(light, "shadows", picked["shadows_only"], picked["shadows_except"])
    return links_text(light) or "lights everything, and everything casts its shadows"


def seen_text(obj):
    """Which rays see an object, as Cycles draws it."""
    seen = [words for _, prop, words in RAYS if getattr(obj, prop)]
    unseen = [words for _, prop, words in RAYS if not getattr(obj, prop)]
    if not unseen:
        return "seen by every ray"
    if not seen:
        return "seen by no ray"
    return f"seen by {listed(seen, NAMED)} only; not by {listed(unseen, NAMED)}"


def set_seen(spec):
    """The rays that see objects, as a spec gives them; the lines that say it."""
    need(isinstance(spec, dict) and spec.get("objects") is not None, "Each of seen_by names its objects.")
    rays = {key: spec[key] for key, _, _ in RAYS if spec.get(key) is not None}
    need(rays, "Each of seen_by sets camera, bounced, reflections, refraction, shadows or fog to true or false.")
    need(all(isinstance(v, bool) for v in rays.values()), "Each ray of seen_by is true or false.")
    lines = []
    for obj in with_parts(spec["objects"], "seen_by objects"):
        for key, prop, _ in RAYS:
            if key in rays:
                setattr(obj, prop, rays[key])
        lines.append(f"{obj.name}: {seen_text(obj)}")
    return lines


def card_mesh(name, width, height):
    """A flat card, its face toward its own -z, the way aiming turns an object's front."""
    mesh = bpy.data.meshes.new(name)
    w, h = width / 2, height / 2
    mesh.from_pydata([(-w, -h, 0), (-w, h, 0), (w, h, 0), (w, -h, 0)], [], [(0, 1, 2, 3)])
    return mesh


def card_material(obj, kind, rgba, strength):
    material = bpy.data.materials.new(obj.name)
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Roughness"].default_value = 1
    if kind == "reflection":
        shader.inputs["Base Color"].default_value = (0, 0, 0, 1)
        shader.inputs["Emission Color"].default_value = rgba
        shader.inputs["Emission Strength"].default_value = strength
    else:
        shader.inputs["Specular IOR Level"].default_value = 0
    obj.data.materials.clear()
    obj.data.materials.append(material)


def card(spec, group):
    """A card made or, named again, changed in what is given; the line that says it."""
    need(isinstance(spec, dict) and isinstance(spec.get("name"), str) and spec["name"].strip(), "Each card has a name.")
    name = spec["name"]
    existing = bpy.data.objects.get(name)
    made = existing is None
    need(made or existing.get("zhiyin_card"), f"“{name}” is an object of the scene, not a card: name the card otherwise.")
    kind = spec.get("kind") or (existing.get("zhiyin_card") if existing else None)
    need(kind in CARD_RAYS, "A card's kind is reflection, bounce or flag.")
    width, height = vector(spec.get("size"), "card size", 2, default=(existing.dimensions[:2] if existing else CARD_SIZE))
    need(width > 0 and height > 0, "A card's size is two lengths greater than 0.")
    if made:
        need(spec.get("location") is not None, f"The new card {name} needs a location.")
        obj = bpy.data.objects.new(name, card_mesh(name, width, height))
        group.objects.link(obj)
    else:
        obj = existing
        if spec.get("size") is not None:
            old = obj.data
            obj.data = card_mesh(name, width, height)
            obj.data.materials.extend(list(old.materials))
            if old.users == 0:
                bpy.data.meshes.remove(old)
    obj["zhiyin_card"] = kind
    if spec.get("location") is not None:
        obj.location = vector(spec["location"], "card location")
    need(spec.get("look_at") is None or spec.get("look_at_object") is None, "Turn a card to a point with look_at or to an object with look_at_object, not both.")
    if spec.get("look_at_object") is not None:
        aim = middle_of(find_object(spec["look_at_object"]))
    elif spec.get("look_at") is not None:
        aim = vector(spec["look_at"], "card look_at")
    elif made:
        bounds = world_bounds(subjects())
        aim = (bounds[0] + bounds[1]) / 2 if bounds else mathutils.Vector((0, 0, 0))
    else:
        aim = None
    if aim is not None:
        obj["zhiyin_aim"] = list(aim)
    if obj.get("zhiyin_aim") is not None:
        look_at(obj, mathutils.Vector(obj["zhiyin_aim"]))
    if made or spec.get("kind") is not None or spec.get("color") is not None or spec.get("strength") is not None:
        rgba = colour(spec.get("color"), "card color", default=CARD_COLOURS[kind])
        strength = number(spec.get("strength"), "card strength", minimum=0, maximum=1000, default=CARD_STRENGTH)
        card_material(obj, kind, rgba, strength)
    rays = spec.get("seen_by")
    need(rays is None or isinstance(rays, dict), f"A card's seen_by sets {one_of([key for key, _, _ in RAYS])} to true or false.")
    need(
        set(rays or {}) <= {key for key, _, _ in RAYS} and all(isinstance(v, bool) for v in (rays or {}).values()),
        f"A card's seen_by sets {one_of([key for key, _, _ in RAYS])}, each to true or false.",
    )
    # A card takes its kind's rays when made or given a kind, and keeps the rays it was given after.
    if made or spec.get("kind") is not None:
        for key, prop, _ in RAYS:
            setattr(obj, prop, key in CARD_RAYS[kind])
    for key, prop, _ in RAYS:
        if (rays or {}).get(key) is not None:
            setattr(obj, prop, rays[key])
    bpy.context.view_layer.update()
    shader = obj.data.materials[0].node_tree.nodes["Principled BSDF"]
    if kind == "reflection":
        look = f"{hex_of(shader.inputs['Emission Color'].default_value)} glowing at {shader.inputs['Emission Strength'].default_value:g}"
    else:
        look = hex_of(shader.inputs["Base Color"].default_value)
    return obj, (
        f"card {obj.name} ({CARD_WORDS[kind]}, {size_text(obj.dimensions[:2])}, {look}) at {point_text(obj.matrix_world.translation)},"
        f" facing {point_text(obj['zhiyin_aim'])}: {seen_text(obj)}"
    )


def shaping(args, group):
    """Cards and the rays that see objects, as the call gives them; the lines that say them, and the cards."""
    said = []
    cards = args.get("cards")
    need(cards is None or isinstance(cards, list), "cards is a list.")
    made = [card(spec, group) for spec in cards or []]
    said += [line for _, line in made]
    seen = args.get("seen_by")
    need(seen is None or isinstance(seen, list), "seen_by is a list.")
    for spec in seen or []:
        said += set_seen(spec)
    return said, [obj for obj, _ in made]


# A card is said to change an object's light by this share or more; less is
# within what two pictures at few samples differ by.
CHANGED = 0.03


def cards_seen(cards):
    """
    What each card shows in: the objects the camera sees that a small Cycles
    picture shows brighter or darker with the card than without it.
    """
    why = no_camera()
    if why:
        return f"What the cards show in is not measured. {why}"
    said = []
    with Measures() as measures:
        objects = shown()
        owner = measures.owners(objects)
        lit, _ = measures.picture()
        if lit is None:
            return ""
        after = means(lit, owner, objects)
        for obj in cards[:NAMED]:
            if measures.too_slow():
                said.append(f"{obj.name} not measured: a picture took {measures.slowest:.0f} s, more than the time left for another")
                continue
            obj.hide_render = True
            try:
                unlit, _ = measures.picture()
            finally:
                obj.hide_render = False
            before = means(unlit, owner, objects)
            moved = sorted(((n, change(after[n], before[n])) for n in after if n in before), key=lambda c: -abs(c[1]))
            up = [f"{n} ({c:+.0%})" for n, c in moved if c >= CHANGED]
            down = [f"{n} ({c:+.0%})" for n, c in moved if c <= -CHANGED]
            if not (up or down):
                said.append(f"{obj.name} changes nothing the camera sees by {CHANGED:.0%} or more")
                continue
            words = []
            if up:
                words.append(f"{'is seen in' if obj.get('zhiyin_card') == 'reflection' else 'brightens'} {listed(up, NAMED)}")
            if down:
                words.append(f"darkens {listed(down, NAMED)}")
            said.append(f"{obj.name} {' and '.join(words)}")
        size = measures.size
    return f"Each card against a {size} Cycles picture without it, at {SAMPLES} samples: {'; '.join(said)}."

