"""
The wood finish: grain drawn in the wood's own colour, in rings round a line along the object,
laid on each wooden object by its own size and the way its grain runs.
"""

import functools

import bpy

from .finding import scene
from .material_marks import WOOD, wood_of

# Wood is a finish, as metal is: the colour is the wood's own and the grain is
# drawn in it, with nothing to unwrap and no picture to keep. It is drawn as a
# tree grows it, in rings round a line that runs the length of the object, a
# little to one side of it: the faces of a board show streaks along it, a few
# centimetres wide at any size, and its ends show arcs. An end wider than a
# board is sawn is no sawn end: the top of a cupboard is a panel, and shows
# streaks along its own longer side. Each wooden object carries which way its
# grain runs, which way it runs on an end, and its own size (GRAIN, GRAIN_END,
# GRAIN_SIZE), which the material reads; so one material serves a table's top
# and its legs, and no two boards show the same streaks.
GRAIN, GRAIN_END, GRAIN_SIZE = "zhiyin_grain", "zhiyin_grain_end", "zhiyin_grain_size"
# The widest a board is sawn, in metres.
BOARD = 0.25
# Streaks to the metre: along the grain, and across it.
GRAIN_ALONG, GRAIN_ACROSS = 0.9, 26.0
# Where the tree's middle ran, in metres from the object's own.
HEART = (0.45, 0.38, -0.33)
# At full strength: how far the dark streaks go below the wood's colour and
# the light ones above it, and how far one board's tone is from the next's.
GRAIN_DARK, GRAIN_LIGHT, BOARD_TONE = 0.3, 0.08, 0.24


def wood(material, shader, base, amount):
    nodes, links = material.node_tree.nodes, material.node_tree.links

    def node(kind, **settings):
        made = nodes.new(kind)
        for name, value in settings.items():
            setattr(made, name, value)
        return made

    def sums(operation, *values):
        made = node("ShaderNodeMath", operation=operation)
        for at, value in enumerate(values):
            if isinstance(value, (int, float)):
                made.inputs[at].default_value = value
            else:
                links.new(value, made.inputs[at])
        return made.outputs[0]

    marker = node("ShaderNodeValue", name=WOOD, label=WOOD)
    marker.outputs[0].default_value = amount

    def vectors(operation, first, second=None):
        made = node("ShaderNodeVectorMath", operation=operation)
        for at, value in enumerate((first, second)):
            if value is None:
                continue
            if isinstance(value, tuple):
                made.inputs[at].default_value = value
            else:
                links.new(value, made.inputs[at])
        return made

    def read(name):
        return node("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name=name).outputs["Vector"]

    # Which way the grain runs where the point being drawn is: along the
    # object, or on a face that looks along it, the way the object's ends run.
    own_frame = node("ShaderNodeTexCoord")
    facing = sums("ABSOLUTE", vectors("DOT_PRODUCT", own_frame.outputs["Normal"], read(GRAIN)).outputs["Value"])
    turned = node("ShaderNodeMix", data_type="VECTOR")
    ends = {socket.identifier: socket for socket in turned.inputs}
    links.new(sums("GREATER_THAN", facing, 0.7), ends["Factor_Float"])
    links.new(read(GRAIN), ends["A_Vector"])
    links.new(read(GRAIN_END), ends["B_Vector"])
    lie = next(socket for socket in turned.outputs if socket.type == "VECTOR")
    # The point, in metres in the object's own frame; how far along the grain
    # it is, and how far from the tree's middle across it.
    metres = vectors("MULTIPLY", own_frame.outputs["Object"], read(GRAIN_SIZE)).outputs["Vector"]
    along = vectors("DOT_PRODUCT", metres, lie).outputs["Value"]
    beside = vectors("SUBTRACT", (1.0, 1.0, 1.0), lie).outputs["Vector"]
    across = vectors("MULTIPLY", metres, beside).outputs["Vector"]
    heart = vectors("MULTIPLY", HEART, beside).outputs["Vector"]
    ring = vectors("LENGTH", vectors("SUBTRACT", across, heart).outputs["Vector"]).outputs["Value"]
    place = node("ShaderNodeCombineXYZ")
    links.new(sums("MULTIPLY", along, GRAIN_ALONG), place.inputs["X"])
    links.new(sums("MULTIPLY", ring, GRAIN_ACROSS), place.inputs["Y"])
    # One side of the middle is not the mirror of the other.
    links.new(vectors("DOT_PRODUCT", across, (0.8, 0.8, 0.8)).outputs["Value"], place.inputs["Z"])
    board = node("ShaderNodeObjectInfo").outputs["Random"]
    own = sums("MULTIPLY", board, 53.0)

    def streaks(scale, detail, distortion):
        made = node("ShaderNodeTexNoise", noise_dimensions="4D")
        made.inputs["Scale"].default_value = scale
        made.inputs["Detail"].default_value = detail
        made.inputs["Roughness"].default_value = 0.55
        made.inputs["Distortion"].default_value = distortion
        links.new(place.outputs["Vector"], made.inputs["Vector"])
        links.new(own, made.inputs["W"])
        return made.outputs[0]

    # Broad bands of darker and lighter wood, with fine lines of pores in them.
    figure = sums("MULTIPLY_ADD", streaks(1.0, 2.0, 0.6), 0.72, sums("MULTIPLY", streaks(6.0, 1.0, 0.15), 0.28))
    shaped = node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    links.new(figure, shaped.inputs["Value"])
    shaped.inputs["From Min"].default_value = 0.36
    shaped.inputs["From Max"].default_value = 0.64
    dark, light = 1 - GRAIN_DARK * amount, 1 + GRAIN_LIGHT * amount
    mix = node("ShaderNodeMix", data_type="RGBA")
    sockets = {socket.identifier: socket for socket in mix.inputs}
    links.new(shaped.outputs["Result"], sockets["Factor_Float"])
    sockets["A_Color"].default_value = (base[0] * light, base[1] * light, base[2] * light, 1)
    # The dark of wood is warmer than its light.
    sockets["B_Color"].default_value = (base[0] * dark, base[1] * dark * 0.95, base[2] * dark * 0.88, 1)
    toned = node("ShaderNodeHueSaturation")
    links.new(next(socket for socket in mix.outputs if socket.type == "RGBA"), toned.inputs["Color"])
    spread = BOARD_TONE * amount
    links.new(sums("MULTIPLY_ADD", board, spread, 1 - spread / 2), toned.inputs["Value"])
    links.new(toned.outputs["Color"], shader.inputs["Base Color"])


def lay_grain():
    """Tells each wooden object which way its grain runs, its longest side, on its ends too, and its real size."""
    bpy.context.view_layer.update()
    for obj in scene().objects:
        wooden = obj.type in ("MESH", "CURVE", "FONT", "SURFACE", "META") and any(
            wood_of(slot.material) for slot in obj.material_slots
        )
        if not wooden:
            for name in (GRAIN, GRAIN_END, GRAIN_SIZE):
                if name in obj:
                    del obj[name]
            continue
        size, scale = obj.dimensions, obj.matrix_world.to_scale()
        long, second, short = sorted(range(3), key=lambda axis: -size[axis])
        # An end both of whose sides are wider than a board is a panel.
        end = second if size[short] > BOARD else long
        told = {
            GRAIN: [1.0 if axis == long else 0.0 for axis in range(3)],
            GRAIN_END: [1.0 if axis == end else 0.0 for axis in range(3)],
            GRAIN_SIZE: [abs(scale[axis]) for axis in range(3)],
        }
        for name, value in told.items():
            if name not in obj or any(abs(old - new) > 1e-6 for old, new in zip(obj[name], value)):
                obj[name] = value
                obj.update_tag()


def lays_grain(tool):
    """
    A tool that can give an object a material, change a material or change an
    object's size lays the grain of every wooden object after it.
    """

    @functools.wraps(tool)
    def laid(*args):
        said = tool(*args)
        lay_grain()
        return said

    return laid
