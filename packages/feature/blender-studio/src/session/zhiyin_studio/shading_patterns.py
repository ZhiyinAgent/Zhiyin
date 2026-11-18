"""
Patterns at their real size: noise, cells, stripes, a woven cloth, cracks and
flakes, each drawn in metres on the object itself, through its scale, so a
3 mm grain is 3 mm on a small part and on a large one. Each is a socket from
0 to 1 and says, read back from its nodes, how large it is and how many of
it fit across each object that wears the material.
"""

import math

from .arguments import need, number
from .reports import report
from .shading_common import count_text, graph_of, material_of, owned, wearers
from .wording import length, one_of

# Each pattern's options and what they are when not given; a width given as None is worked out from the size.
OPTIONS = {
    "noise": {"detail": 2, "roughness": 0.5, "distortion": 0},
    "cells": {"randomness": 1},
    "stripes": {"axis": "x", "width": None},
    "weave": {},
    "cracks": {"width": None, "distortion": 0.25},
    "flakes": {},
}
AXES = {"x": 0, "y": 1, "z": 2}


def options_of(kind, given):
    need(kind in OPTIONS, f"A pattern is one of {one_of(OPTIONS)}.")
    takes = OPTIONS[kind]
    for name in given:
        need(name in takes, f"A pattern of {kind} takes {one_of(takes) if takes else 'no options'}; {name} is not one of its options.")
    return {name: given.get(name, default) for name, default in takes.items()}


def noise(graph, at, size, given):
    made = graph.noise(
        at,
        size,
        number(given["detail"], "detail", minimum=0, maximum=15),
        number(given["roughness"], "roughness", minimum=0, maximum=1),
        number(given["distortion"], "distortion", minimum=0, maximum=10),
    )
    scale = made.node.inputs["Scale"].default_value
    words = f"features about {length(1 / scale)} across, drawn in metres on each object (Noise Texture at scale {scale:.4g})"
    return owned(made, f"Noise {length(size)}"), words


def cells(graph, at, size, given):
    made = graph.cells(at, size)
    made.node.inputs["Randomness"].default_value = number(given["randomness"], "randomness", minimum=0, maximum=1)
    across = 1 / made.node.inputs["Scale"].default_value
    return owned(made, f"Cells {length(size)}"), f"cells about {length(across)} across, 0 at the middle of each and rising toward its edge"


def stripes(graph, at, size, given):
    axis = given["axis"]
    need(axis in AXES, "axis is x, y or z, the object's own.")
    width = number(given["width"], "width", minimum=0, maximum=size, default=size / 2)
    need(0 < width < size, f"A stripe's width is between 0 and the {length(size)} between stripes.")
    along = graph.parts(at)[AXES[axis]]
    # Each stripe's middle where the repeat is halfway; how far a point is from it, in metres.
    off = graph.math("MULTIPLY", graph.math("ABSOLUTE", graph.math("SUBTRACT", graph.math("FRACT", graph.math("DIVIDE", along, size)), 0.5)), size)
    soft = min(width, size - width) * 0.1
    inside = graph.math("SUBTRACT", 1, graph.step(off, width / 2 - soft, width / 2 + soft), clamp=True)
    words = f"stripes {length(width)} wide, {length(size)} apart, repeating along the object's own {axis}"
    return owned(inside, f"Stripes {length(size)} along {axis}"), words


def woven(graph, across, along, pitch):
    """
    Plain weave on a plane: threads `pitch` apart one way and the other, each
    over one crossing and under the next. 0 in the gaps to 1 on a thread at
    its highest.
    """
    threads = []
    for run, side, over in ((across, along, 1), (along, across, -1)):
        lane = graph.math("FRACT", graph.math("DIVIDE", side, pitch))
        # Round across the thread.
        round_ = graph.math("SINE", graph.math("MULTIPLY", lane, math.pi))
        # Up where it crosses over, down where it passes under.
        steps = graph.math("ADD", graph.math("DIVIDE", run, pitch), graph.math("FLOOR", graph.math("DIVIDE", side, pitch)))
        lift = graph.math("MULTIPLY_ADD", graph.math("COSINE", graph.math("MULTIPLY", steps, math.pi)), 0.25 * over, 0.75)
        threads.append(graph.math("MULTIPLY", round_, lift))
    return graph.math("MAXIMUM", *threads, clamp=True)


def weave(graph, at, size, given):
    # Woven on the three planes of the object's own frame and blended by which way each face looks.
    x, y, z = graph.parts(at)
    facing = graph.parts(graph.node("ShaderNodeTexCoord").outputs["Normal"])
    weights = [graph.math("POWER", graph.math("ABSOLUTE", axis), 8) for axis in facing]
    total = graph.math("ADD", graph.math("ADD", *weights[:2]), weights[2])
    cloth = 0
    for weight, (across, along) in zip(weights, ((y, z), (x, z), (x, y))):
        cloth = graph.math("MULTIPLY_ADD", woven(graph, across, along, size), graph.math("DIVIDE", weight, total), cloth)
    words = f"threads {length(size)} apart, each over one and under the next, on whichever of the object's own planes a face lies nearest"
    return owned(cloth, f"Weave {length(size)}"), words


def cracks(graph, at, size, given):
    width = number(given["width"], "width", minimum=0, maximum=size / 2, default=size / 50)
    need(width > 0, "A crack's width is more than 0.")
    distortion = number(given["distortion"], "distortion", minimum=0, maximum=1)
    # The cells' edges wander, as cracks do, by a share of a cell.
    wander = graph.node("ShaderNodeTexNoise", noise_dimensions="3D")
    graph.into(wander.inputs["Vector"], at)
    wander.inputs["Scale"].default_value = 2 / size
    shifted = graph.vector("ADD", at, graph.vector("SCALE", graph.vector("SUBTRACT", wander.outputs["Color"], (0.5, 0.5, 0.5)), size * distortion))
    edge = graph.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="DISTANCE_TO_EDGE")
    graph.into(edge.inputs["Vector"], shifted)
    edge.inputs["Scale"].default_value = 1 / size
    apart = graph.math("MULTIPLY", edge.outputs["Distance"], size)
    crack = graph.math("SUBTRACT", 1, graph.step(apart, width * 0.4, width * 0.6), clamp=True)
    across = 1 / edge.inputs["Scale"].default_value
    return owned(crack, f"Cracks {length(size)}"), f"cracks {length(width)} wide round cells about {length(across)} across"


def flakes(graph, at, size, given):
    cells_ = graph.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="F1")
    graph.into(cells_.inputs["Vector"], at)
    cells_.inputs["Scale"].default_value = 1 / size
    channel = graph.node("ShaderNodeSeparateColor")
    graph.into(channel.inputs[0], cells_.outputs["Color"])
    across = 1 / cells_.inputs["Scale"].default_value
    return owned(channel.outputs[0], f"Flakes {length(size)}"), f"flakes about {length(across)} across, each its own random value from 0 to 1"


DRAWN = {"noise": noise, "cells": cells, "stripes": stripes, "weave": weave, "cracks": cracks, "flakes": flakes}


def across_each(material, size):
    found = wearers(material)
    if not found:
        return " It is on no object yet."
    said = []
    for obj in found[:6]:
        longest = max(obj.dimensions)
        if longest < size:
            said.append(f"{obj.name}: one is wider than its {length(longest)}, so it shows part of one")
        else:
            said.append(f"{obj.name}: about {count_text(longest / size)} across its {length(longest)}")
    return " On " + "; on ".join(said) + "."


def pattern(material, kind, size, **options):
    """A pattern sized in metres, 0 to 1, as a socket to mix, remap or feed; one line of its size on each object."""
    material = material_of(material, "zhiyin.pattern")
    given = options_of(kind, options)
    size = number(size, "size", minimum=1e-6, maximum=100)
    graph, at = graph_of(material)
    made, words = DRAWN[kind](graph, at, size, given)
    report(f"Pattern {kind} for {material.name}: {words}; Cycles and EEVEE.{across_each(material, size)}")
    return made
