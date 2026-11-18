"""
Metal finishes and the coatings on metal, each drawn in metres on the object: cast skins, machined,
brushed, plated, heat-tinted, anodised and galvanised metal, paint and car paint.
"""

from .arguments import colour, need
from .finishes import mark, mottle
from .material_marks import FINISH_DRAWN
from .wording import length, one_of

# Heat tints, as steel shows them from the least heated to the most.
# Each is where it lies on the heat drawn over the surface, which is mostly
# near its middle: below the first, the steel keeps its own colour.
TEMPER = (
    (0.47, None),
    (0.51, "#c9a862"),
    (0.545, "#a8743e"),
    (0.575, "#6e4a78"),
    (0.61, "#34529a"),
    (0.66, "#7d8ea6"),
    (0.75, "#5a5856"),
)
# Brushed lines: this far apart across, this long along, and this deep.
BRUSH_ACROSS, BRUSH_ALONG, BRUSH_DEPTH = 0.0001, 0.03, 0.0000015
# Lines out from an axis: this many to a radian.
BRUSH_RAYS = 600
BRUSHINGS = ("linear", "circular", "radial")
AXES = {"x": 0, "y": 1, "z": 2}
# Car paint's flakes: this wide, and the share of them that catch the light.
FLAKE = 0.00015
# Where metal is drawn as brushed across its lines, in Cycles alone.
ANISOTROPY = 0.85
HIGHLIGHTS = "Cycles draws its highlights out across the lines, EEVEE the lines alone"


def cast(graph, at, base, roughness, grain, depth, tone, pits):
    """A cast skin: the grain of the sand it was cast in, patches lighter and darker, and rougher in its hollows."""
    sand = graph.noise(at, grain, 5, 0.65)
    fine = graph.cells(at, grain * 0.7)
    height = graph.math("MULTIPLY_ADD", sand, depth, graph.math("MULTIPLY", fine, depth * 0.3))
    patches = graph.noise(at, 0.08, 3)
    shade = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", sand, 0.5), 0.25, patches)
    colour = graph.tones(shade, base, 1 - tone, 1 + tone, warm=0.97)
    rough = mottle(graph, at, roughness, 0.015, 0.1)
    if pits:
        # Here and there a pit, deeper and darker than the grain round it.
        pit = graph.math("SUBTRACT", 1, graph.step(graph.cells(at, grain * 6), 0.0, 0.18))
        hole = graph.math("MULTIPLY", pit, graph.step(graph.noise(at, grain * 10, 1), 0.55, 0.65))
        height = graph.math("MULTIPLY_ADD", hole, -depth * 3, height)
        colour = graph.mix(graph.math("MULTIPLY", hole, 0.6), colour, (base[0] * 0.4, base[1] * 0.38, base[2] * 0.36, 1))
        rough = graph.math("MULTIPLY_ADD", hole, 0.2, rough, clamp=True)
    rough = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", sand, 0.5), 0.12, rough, clamp=True)
    return {"colour": colour, "roughness": rough, "height": height}


def cast_aluminium(graph, at, base, roughness, drawing):
    return cast(graph, at, base, roughness, grain=0.0004, depth=0.00005, tone=0.035, pits=False)


def cast_iron(graph, at, base, roughness, drawing):
    return cast(graph, at, base, roughness, grain=0.0008, depth=0.00014, tone=0.06, pits=True)


def machined(graph, at, base, roughness, drawing):
    colour = graph.tones(graph.noise(at, 0.02, 2), base, 0.97, 1.03)
    height = graph.math("MULTIPLY", graph.noise(at, 0.00008, 2), 0.000002)
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.006, 0.03), "height": height}


def paint(graph, at, base, roughness, drawing):
    colour = graph.tones(graph.noise(at, 0.05, 2), base, 0.985, 1.015)
    # Orange peel: the paint dried in shallow waves a few millimetres across.
    peel = graph.noise(at, 0.003, 1, 0.4)
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.02, 0.03), "height": graph.math("MULTIPLY", peel, 0.000012)}


def plated(graph, at, base, roughness, drawing):
    colour = graph.tones(graph.noise(at, 0.01, 3), base, 0.96, 1.03)
    height = graph.math("MULTIPLY", graph.noise(at, 0.0001, 2), 0.000003)
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.006, 0.03), "height": height}


def heat_tinted(graph, at, base, roughness, drawing):
    # Heat spreads smoothly, so its tints lie in bands one beside the next.
    heat = graph.node("ShaderNodeValToRGB")
    graph.into(heat.inputs["Fac"], graph.noise(at, 0.1, 1, 0.5, 0.5))
    stops = heat.color_ramp.elements
    while len(stops) > 1:
        stops.remove(stops[-1])
    stops[0].position = 0
    stops[0].color = base
    for where, tint in TEMPER:
        stops.new(where).color = base if tint is None else colour(tint, "tint")
    height = graph.math("MULTIPLY", graph.noise(at, 0.0003, 2), 0.00001)
    return {"colour": heat.outputs["Color"], "roughness": mottle(graph, at, roughness, 0.01, 0.06), "height": height}


def brushing_of(drawing):
    """
    How metal is brushed: linear, along an axis of its own; circular, in rings round one; or
    radial, in lines out from one. Without an axis, linear runs along the first object's longest
    side, and the others turn round the axis its section is as wide about both ways, or else its
    thinnest side. Answers the pattern, the axis's index, and why that axis, or nothing when given.
    """
    given = drawing.values.get("brushing") or {}
    need(isinstance(given, dict), "brushing gives a pattern (linear, circular or radial) and an axis (x, y or z).")
    pattern = given.get("pattern", "linear")
    need(pattern in BRUSHINGS, f"brushing pattern is {one_of(BRUSHINGS)}.")
    axis = given.get("axis")
    need(axis is None or axis in AXES, "brushing axis is x, y or z, an axis of the object's own.")
    if axis is not None:
        return pattern, AXES[axis], ""
    obj = drawing.targets[0]
    size = list(obj.dimensions)
    if pattern == "linear":
        longest = max(range(3), key=lambda i: size[i])
        return pattern, longest, f"{obj.name}'s longest side, {length(size[longest])}"
    # A cube turns about its own z axis: equal sides go to the last axis.
    for i in sorted(range(3), key=lambda i: (size[i], -i)):
        a, b = (size[j] for j in range(3) if j != i)
        if max(a, b) > 0 and abs(a - b) <= 0.02 * max(a, b):
            return pattern, i, f"{obj.name}'s turning axis: it is {length(a)} across both ways round it"
    thinnest = min(range(3), key=lambda i: (size[i], -i))
    return pattern, thinnest, f"{obj.name}'s thinnest side, {length(size[thinnest])}"


def brushed(graph, at, base, roughness, drawing):
    pattern, index, why = brushing_of(drawing)
    axis = tuple(1.0 if i == index else 0.0 for i in range(3))
    along = graph.vector("DOT_PRODUCT", at, axis)
    flat = graph.vector("SUBTRACT", at, graph.vector("SCALE", axis, along))
    if pattern == "linear":
        lined = graph.vector("ADD", graph.vector("SCALE", flat, 1 / BRUSH_ACROSS), graph.vector("SCALE", axis, graph.math("DIVIDE", along, BRUSH_ALONG)))
        groove = graph.own(axis)
    else:
        # Measured from the axis through the object's own middle, not the random offset.
        middle = graph.node("ShaderNodeTexCoord").outputs["Object"]
        out = graph.vector("SUBTRACT", middle, graph.vector("SCALE", axis, graph.vector("DOT_PRODUCT", middle, axis)))
        radius = graph.vector("LENGTH", out)
        if pattern == "circular":
            # Rings: the lines change fast going out, slowly going round.
            lined = graph.vector("ADD", graph.vector("SCALE", axis, graph.math("DIVIDE", radius, BRUSH_ACROSS)), graph.vector("SCALE", flat, 1 / BRUSH_ALONG))
            groove = graph.own(graph.vector("CROSS_PRODUCT", axis, out))
        else:
            # Lines out from the axis: the lines change fast going round, slowly going out.
            facing = graph.vector("NORMALIZE", out)
            lined = graph.vector("ADD", graph.vector("SCALE", facing, BRUSH_RAYS), graph.vector("SCALE", axis, graph.math("DIVIDE", radius, BRUSH_ALONG)))
            groove = graph.own(out)
    lines = graph.noise(lined, 1.0, 2, 0.6)
    # Wider streaks where the abrasive bit harder, and the fine lines in them, lighter and darker.
    streaks = graph.noise(graph.vector("SCALE", lined, 0.25), 1.0, 2)
    colour = graph.tones(graph.math("MULTIPLY_ADD", streaks, 0.85, graph.math("MULTIPLY", lines, 0.15)), base, 0.9, 1.05)
    rough = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", lines, 0.5), 0.14, roughness, clamp=True)
    # Brushed metal reflects drawn out across its lines: the tangent lies across them in the surface.
    normal = graph.node("ShaderNodeNewGeometry").outputs["Normal"]
    across = graph.vector("CROSS_PRODUCT", normal, groove)
    lying = graph.step(graph.vector("LENGTH", across), 0.05, 0.2)
    words = {
        "linear": "brushed along its own {} axis",
        "circular": "brushed in circles round its own {} axis",
        "radial": "brushed in lines out from its own {} axis",
    }[pattern].format("xyz"[index])
    mark(graph, FINISH_DRAWN, 1, words)
    return {
        "colour": colour,
        "roughness": rough,
        "height": graph.math("MULTIPLY", lines, BRUSH_DEPTH),
        "inputs": {"Tangent": graph.vector("NORMALIZE", across), "Anisotropic": graph.math("MULTIPLY", lying, ANISOTROPY)},
        "said": [f"{words}{f' ({why})' if why else ''}; {HIGHLIGHTS}"],
    }


def anodised(graph, at, base, roughness, drawing):
    # Bead blasting under the anodising: a satin of tiny dents, the dye a little uneven.
    blast = graph.noise(at, 0.00006, 2)
    colour = graph.tones(graph.noise(at, 0.03, 2), base, 0.98, 1.02)
    rough = graph.math("MULTIPLY_ADD", blast, 0.16, roughness - 0.08, clamp=True)
    return {"colour": colour, "roughness": rough, "height": graph.math("MULTIPLY", blast, 0.000004)}


def galvanised(graph, at, base, roughness, drawing):
    # Zinc crystals, each catching the light its own way, with fine feathers in them and dark seams between.
    _, own = graph.cell(at, 0.008)
    seam = graph.math("SUBTRACT", 1, graph.step(graph.cell_edges(at, 0.008), 0.0, 0.03))
    feathers = graph.noise(at, 0.0012, 3, 0.6)
    shade = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", feathers, 0.5), 0.4, own)
    colour = graph.mix(graph.math("MULTIPLY", seam, 0.5), graph.tones(shade, base, 0.86, 1.1), (base[0] * 0.6, base[1] * 0.6, base[2] * 0.6, 1))
    rough = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", own, 0.5), 0.24, roughness, clamp=True)
    height = graph.math("MULTIPLY_ADD", seam, -0.000006, graph.math("MULTIPLY", feathers, 0.000003))
    return {"colour": colour, "roughness": rough, "height": height}


def car_paint(graph, at, base, roughness, drawing):
    # Metallic flakes in the coloured base, each tilted its own way, under a smooth clear coat.
    flakes = graph.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="F1")
    graph.into(flakes.inputs["Vector"], at)
    flakes.inputs["Scale"].default_value = 1 / FLAKE
    own = graph.parts(flakes.outputs["Color"])[0]
    bright = graph.step(own, 0.5, 0.56)
    shine = (min(1, base[0] * 1.8 + 0.12), min(1, base[1] * 1.8 + 0.12), min(1, base[2] * 1.8 + 0.12), 1)
    colour = graph.mix(graph.math("MULTIPLY", bright, 0.7), graph.tones(graph.noise(at, 0.05, 2), base, 0.98, 1.02), shine)
    tilt = graph.vector("SCALE", graph.vector("SUBTRACT", flakes.outputs["Color"], (0.5, 0.5, 0.5)), graph.math("MULTIPLY", bright, 0.6))
    peel = graph.noise(at, 0.004, 1, 0.4)
    return {
        "colour": colour,
        "roughness": graph.mix(bright, roughness, 0.25, "FLOAT"),
        "height": graph.math("MULTIPLY", peel, 0.00001),
        "tilt": tilt,
        "inputs": {"Metallic": graph.mix(bright, 0.0, 1.0, "FLOAT")},
    }


DRAWN = {
    "cast-aluminium": cast_aluminium,
    "cast-iron": cast_iron,
    "machined-metal": machined,
    "brushed-metal": brushed,
    "painted-metal": paint,
    "plated-steel": plated,
    "heat-tinted-steel": heat_tinted,
    "anodised-aluminium": anodised,
    "galvanised-steel": galvanised,
    "car-paint": car_paint,
}
