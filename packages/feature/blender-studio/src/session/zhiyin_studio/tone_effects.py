"""
The steps of a picture's post: Blender's own compositor nodes (glare, lens distortion, sharpen,
colour balance, the painterly Kuwahara filter) and its compositor groups bundled as assets (vignette,
film grain and the rest), each made as a node with its own inputs set by the names Blender gives
them and read back; and any bundled group appended by its name.

Measured in Blender 5.2: the bundled groups append from the essentials file with no window and no
startup file; a node's inputs its other choices leave unused are marked inactive; a value past a
bundled group input's range is taken as given, so it is said, and one past a node input's own
range is held at its end, so that is said.
"""

import os

import bpy

from .arguments import is_number, need
from .errors import Refused
from .lighting_links import NAMED
from .wording import listed

# The tools' names for the bundled groups with a picture in and out.
EFFECTS = {
    "vignette": "Vignette",
    "film_grain": "Film Grain",
    "sensor_noise": "Sensor Noise",
    "chromatic_aberration": "Chromatic Aberration",
    "sepia": "Sepia",
    "split_toning": "Split Toning",
    "unsharp_mask": "Unsharp Mask",
    "tune_image": "Tune Image",
}
# The tools' names for Blender's own nodes, each with the choices it is made with.
NODES = {
    "bloom": ("CompositorNodeGlare", {"Type": "Bloom"}),
    "glow": ("CompositorNodeGlare", {"Type": "Fog Glow"}),
    "streaks": ("CompositorNodeGlare", {"Type": "Streaks"}),
    "ghosts": ("CompositorNodeGlare", {"Type": "Ghosts"}),
    "star": ("CompositorNodeGlare", {"Type": "Simple Star"}),
    "sun_beams": ("CompositorNodeGlare", {"Type": "Sun Beams"}),
    "lens_distortion": ("CompositorNodeLensdist", {"Distortion": 0.03}),
    "sharpen": ("CompositorNodeFilter", {"Type": "Diamond Sharpen"}),
    "color_balance": ("CompositorNodeColorBalance", {}),
    "painterly": ("CompositorNodeKuwahara", {}),
}
STEP_TITLES = {"sharpen": "Sharpen", "painterly": "Kuwahara"}
STEPS = (*NODES, *EFFECTS)
# The steps that make highlights glow, whose threshold is measured from the picture's light.
GLARES = ("bloom", "glow", "streaks", "ghosts", "star", "sun_beams")
# Each group's picture, in and out.
PICTURE_IN = {"Film Grain": "Input"}
PICTURE_OUT = {"Film Grain": "Result", "Unsharp Mask": "Result"}
ESSENTIALS = ("assets", "nodes", "compositing_nodes_essentials.blend")


def essentials():
    path = os.path.join(bpy.utils.system_resource("DATAFILES"), *ESSENTIALS)
    need(os.path.isfile(path), "This Blender has no compositor groups of its own.")
    return path


def bundled_names():
    """The names of every compositor group Blender bundles."""
    with bpy.data.libraries.load(essentials(), assets_only=True) as (source, _):
        return sorted(source.node_groups)


def bundled(name):
    """Blender's own compositor group by name, kept in the scene."""
    found = bpy.data.node_groups.get(name)
    if found is not None and found.bl_idname == "CompositorNodeTree":
        return found
    with bpy.data.libraries.load(essentials(), assets_only=True) as (source, target):
        need(name in source.node_groups, f"Blender bundles no compositor group named {name}: it has {', '.join(sorted(source.node_groups))}.")
        target.node_groups = [name]
    group = target.node_groups[0]
    group.use_fake_user = True
    return group


def title(node):
    """A step's name, as its node's label gives it after its place in the post."""
    return node.label.partition(". ")[2] or node.label


def picture_in(node):
    return PICTURE_IN.get(node.node_tree.name, "Image") if node.type == "GROUP" else "Image"


def picture_out(node):
    return PICTURE_OUT.get(node.node_tree.name, "Image") if node.type == "GROUP" else "Image"


def ranges(group):
    """Each of a group's inputs by name, with its range when it has one."""
    found = {}
    for item in group.interface.items_tree:
        if item.item_type == "SOCKET" and item.in_out == "INPUT":
            found[item.name] = (getattr(item, "min_value", None), getattr(item, "max_value", None))
    return found


def value_text(socket):
    value = socket.default_value
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "on" if value else "off"
    if isinstance(value, int):
        return str(value)
    if is_number(value):
        return f"{value:.4g}"
    return "(" + ", ".join(f"{v:.4g}" for v in value) + ")"


def settable(node, active=True):
    """
    A node's inputs that can be set, each by its name, or by Blender's
    identifier for it where two share a name, as colour balance's number and
    colour for its lift; only those its choices use unless `active` is False.
    """
    picture = picture_in(node)
    sockets = [s for s in node.inputs if s.name != picture and hasattr(s, "default_value") and s.type != "OBJECT"]
    names = [s.name for s in sockets]
    named = {(s.name if names.count(s.name) == 1 else s.identifier): s for s in sockets}
    return {name: s for name, s in named.items() if not getattr(s, "is_inactive", False)} if active else named


def set_input(node, name, value, limits):
    """Sets one input of a step by its name and says it as Blender holds it, and a value past its range."""
    sockets = settable(node)
    socket = sockets.get(name)
    if socket is None and name in settable(node, active=False):
        choices = [f"{n} {value_text(s)}" for n, s in sockets.items() if s.type == "MENU"]
        raise Refused(
            f"{title(node)}'s {name} is unused with its choices as they are ({', '.join(choices)}): give the choice that uses it"
            f" in the same call. Its inputs in use now: {listed(sockets, NAMED)}."
        )
    if socket is None:
        raise Refused(f"{title(node)} has no input {name}: it has {listed(settable(node, active=False), NAMED)}.")
    if socket.type == "MENU":
        need(isinstance(value, str), f"{title(node)}'s {name} is one of its choices, by name.")
        try:
            socket.default_value = value
        except TypeError as error:
            choices = str(error).rpartition("not found in ")[2].strip("()")
            raise Refused(f"{title(node)}'s {name} has no choice “{value}”: it is one of {choices}.") from None
    elif socket.type == "BOOLEAN":
        need(isinstance(value, bool), f"{title(node)}'s {name} is true or false.")
        socket.default_value = value
    elif socket.type in ("RGBA", "VECTOR"):
        size = len(socket.default_value)
        need(
            isinstance(value, list) and len(value) == size and all(is_number(v) for v in value),
            f"{title(node)}'s {name} is a list of {size} numbers.",
        )
        socket.default_value = value
    else:
        need(is_number(value), f"{title(node)}'s {name} is a number.")
        socket.default_value = value
    said = f"{name} {value_text(socket)}"
    if not is_number(value):
        return said
    if node.type == "GROUP":
        low, high = limits.get(name, (None, None))
        if low is not None and high is not None and not (low <= value <= high):
            said += f", past its range of {low:g} to {high:g}, which Blender takes as given"
    elif abs(socket.default_value - value) > 1e-6 * max(1, abs(value)):
        prop = socket.bl_rna.properties["default_value"]
        said += f", held there by its range of {prop.hard_min:g} to {prop.hard_max:g}"
    return said


def step_node(tree, spec, index, threshold=None):
    """
    One step, as its node; the values it says of itself. A glare's threshold
    is set from `threshold`, the one measured, unless its inputs give one.
    """
    need(isinstance(spec, dict) and spec.get("step") in STEPS, f"Each post step is one of {', '.join(STEPS)}.")
    step = spec["step"]
    if step in NODES:
        kind, choices = NODES[step]
        node = tree.nodes.new(kind)
        for name, value in choices.items():
            node.inputs[name].default_value = value
        named = choices["Type"] if kind == "CompositorNodeGlare" else STEP_TITLES.get(step, node.bl_label)
        limits = {}
    else:
        group = bundled(EFFECTS[step])
        node = tree.nodes.new("CompositorNodeGroup")
        node.node_tree = group
        named = group.name
        limits = ranges(group)
    node.name = node.label = f"{index + 1}. {named}"
    inputs = dict(spec.get("inputs") or {})
    need(isinstance(spec.get("inputs") or {}, dict), f"{title(node)}'s inputs are named values, such as {{\"Factor\": 0.5}}.")
    if step in GLARES:
        need("Threshold" not in inputs or spec.get("threshold") is None, f"{title(node)}'s threshold is given once: as threshold or in its inputs.")
        if spec.get("threshold") is not None:
            inputs["Threshold"] = spec["threshold"]
        elif threshold is not None and "Threshold" not in inputs:
            node.inputs["Threshold"].default_value = threshold
    else:
        need(spec.get("threshold") is None, f"threshold is a glare's: {', '.join(GLARES)}.")
    # Choices first: they decide which of the other inputs the node uses.
    menus = [name for name in inputs if getattr(settable(node).get(name), "type", None) == "MENU"]
    said = [set_input(node, name, inputs[name], limits) for name in [*menus, *(n for n in inputs if n not in menus)]]
    rest = [f"{name} {value_text(s)}" for name, s in settable(node).items() if name not in inputs and not s.is_linked]
    return node, said + rest
