"""
What a surface gathers in use, each an amount from 0 to 1 drawn over whatever colour and roughness
the material already has: what handling and weather take away (wear, scratches, rust) and what
settles on it (grime, drips, dust, fingerprints). Each is where the shape puts it, by a coverage
written once against the kit of finishes_shape, so the shader that draws it and the sampling that
estimates where it lands follow one formula; their noise differs, so the estimate is statistical.
"""

import math
from typing import NamedTuple

from .arguments import colour
from .finishes import mark, metres, source
from .finishes_shape import Shaped, run_from_edges, streaked
from .material_marks import DRIPS, DUST, FINGERPRINTS, GRIME, RUST, SCRATCHES, WEAR

# How far round a point the shape is looked at, in metres: an edge wears
# over a band about this wide, rust takes a wider one, grime gathers this
# far into a corner, and dust settles where nothing stands this near above.
WEAR_REACH = 0.002
RUST_REACH = 0.004
GRIME_REACH = 0.02
DUST_REACH = 0.1
# How closed in the shape is, by Blender's ambient occlusion, along an edge
# rounded about as wide as the reach, from inside, and deep in a corner from
# outside: measured by rendering in Blender 5.2, in Cycles and in EEVEE.
EDGE, RECESS = 0.2, 0.35
# Grime is oily dust, dark and brown; paint wears through to bare steel; rust runs from dark
# brown in its pits to orange; dust is pale grey.
GRIME_COLOUR, BARE_STEEL = "#2a251e", "#9c9ea1"
RUST_DARK, RUST_LIGHT = "#4a2512", "#a4521f"
DUST_COLOUR = "#b5afa3"


def rgba(hex_colour):
    return (*colour(hex_colour, "colour")[:3], 1)


class Mark(NamedTuple):
    """A mark: the value naming it, the node that keeps its amount, where it lands, and how it is drawn."""

    key: str
    node: str
    cover: object
    paint: object
    # Whether glass and liquids take it: what only changes how rough or how clear a surface is.
    clear: bool
    # Whether it runs down from edges, so the mesh is told how it stands.
    runs: bool


def edge_of(k, reach=WEAR_REACH):
    """1 along an edge rounded about as wide as the reach, more on a sharp one."""
    return k.math("SQRT", k.math("DIVIDE", k.closed(reach, True), EDGE))


def recess_of(k):
    """1 deep in a corner or where parts meet."""
    return k.math("DIVIDE", k.closed(GRIME_REACH, False), RECESS)


def wear_cover(k, at, amount, how):
    # Rubbed through in chips along an edge, and further in with more wear.
    chips = k.math("MULTIPLY_ADD", k.noise(at, 0.0015, 3, 0.6), 0.7, k.math("MULTIPLY", k.noise(at, 0.01, 2), 0.6))
    return k.step(k.math("MULTIPLY", edge_of(k), chips), 0.9 - 0.75 * amount, 1.05 - 0.75 * amount)


def wear_paint(g, at, layers, amount, worn, how):
    if how["wears_as"] == "paint":
        layers["colour"] = g.mix(worn, layers["colour"], rgba(BARE_STEEL))
        layers["metal"] = g.mix(worn, layers["metal"], 1.0, "FLOAT")
        layers["rough"] = g.mix(worn, layers["rough"], 0.3, "FLOAT")
        layers["coat"] = g.mix(worn, layers["coat"], 0.0, "FLOAT")
        return
    brighter = g.node("ShaderNodeMix", data_type="RGBA", blend_type="SCREEN", clamp_factor=True)
    sockets = {socket.identifier: socket for socket in brighter.inputs}
    sockets["Factor_Float"].default_value = 0.35 if how["wears_as"] == "metal" else 0.2
    g.into(sockets["A_Color"], layers["colour"])
    sockets["B_Color"].default_value = (1, 1, 1, 1)
    polished = next(socket for socket in brighter.outputs if socket.type == "RGBA")
    layers["colour"] = g.mix(worn, layers["colour"], polished)
    layers["rough"] = g.mix(worn, layers["rough"], g.math("MULTIPLY", layers["rough"], 0.7), "FLOAT")


def scratch_cover(k, at, amount, how):
    # Fine lines stretched along the way the object is handled, in patches, out of its recesses.
    axis = how["axis"]
    along = k.vector("DOT_PRODUCT", at, axis)
    flat = k.vector("SUBTRACT", at, k.vector("SCALE", axis, along))
    lined = k.vector("ADD", k.vector("SCALE", flat, 1 / 0.0004), k.vector("SCALE", axis, k.math("DIVIDE", along, 0.06)))
    line = k.math("SUBTRACT", 1, k.step(k.math("ABSOLUTE", k.math("SUBTRACT", k.noise(lined, 1.0, 1), 0.5)), 0.0, 0.03))
    handled = k.step(k.noise(at, 0.03, 2), 0.62 - 0.3 * amount, 0.68 - 0.3 * amount)
    sheltered = k.step(recess_of(k), 0.3, 0.6)
    return k.math("MULTIPLY", k.math("MULTIPLY", line, handled), k.math("SUBTRACT", 1, sheltered))


def scratch_paint(g, at, layers, amount, lines, how):
    # A scratch scatters light: rougher, and paler on paint, brighter on metal.
    layers["rough"] = g.mix(lines, layers["rough"], g.math("ADD", layers["rough"], 0.25, clamp=True), "FLOAT")
    paler = (0.55, 0.55, 0.55, 1) if how["wears_as"] == "paint" else (0.8, 0.8, 0.8, 1)
    layers["colour"] = g.mix(g.math("MULTIPLY", lines, 0.35), layers["colour"], paler)
    layers["height"].append(g.math("MULTIPLY", lines, -0.000004))


def rust_cover(k, at, amount, how):
    # Rust starts where water stands and paint breaks, on edges and in corners, runs down from
    # the edges as water carries it, and breaks out in spots on open faces with more.
    patches = k.noise(at, 0.015, 4, 0.6)
    streak = k.noise(streaked(k, at, 0.003, 0.08), 1.0, 2)
    run = k.math("MULTIPLY", run_from_edges(k, 0.02 + 0.1 * amount), k.math("MULTIPLY_ADD", streak, 2.2, -0.35))
    start = k.math("MAXIMUM", k.math("MULTIPLY", edge_of(k, RUST_REACH), 0.9), k.math("MULTIPLY", recess_of(k), 0.8))
    spots = k.math("MULTIPLY", k.step(k.noise(at, 0.006, 3), 0.7 - 0.12 * amount, 0.72 - 0.12 * amount), amount)
    gathered = k.math("MULTIPLY_ADD", k.math("MAXIMUM", start, run), k.math("ADD", patches, 0.5), spots)
    return k.step(gathered, 1.0 - 0.75 * amount, 1.12 - 0.75 * amount)


def rust_paint(g, at, layers, amount, rusted, how):
    tone = g.noise(at, 0.004, 3)
    pits = g.math("SUBTRACT", 1, g.step(g.cells(at, 0.0012), 0.0, 0.3))
    layers["colour"] = g.mix(rusted, layers["colour"], g.mix(g.math("MULTIPLY_ADD", pits, -0.5, tone), rgba(RUST_DARK), rgba(RUST_LIGHT)))
    layers["rough"] = g.mix(rusted, layers["rough"], 0.85, "FLOAT")
    layers["metal"] = g.mix(rusted, layers["metal"], 0.0, "FLOAT")
    layers["coat"] = g.mix(rusted, layers["coat"], 0.0, "FLOAT")
    # Flaking up a little, pitted into the steel.
    layers["height"].append(g.math("MULTIPLY", rusted, g.math("MULTIPLY_ADD", tone, 0.00008, g.math("MULTIPLY", pits, -0.00012))))


def grime_cover(k, at, amount, how):
    # Gathered in recesses and corners, reaching further out of them with more, in patches and specks.
    patches = k.noise(at, 0.012, 4, 0.6)
    specks = k.math("SUBTRACT", k.noise(at, 0.002, 2), 0.5)
    gathered = k.math("MULTIPLY_ADD", specks, 0.4, k.math("MULTIPLY", recess_of(k), k.math("ADD", patches, 0.5)))
    dirty = k.step(gathered, 1.05 - 0.75 * amount, 1.3 - 0.75 * amount)
    # A thin film in patches over open faces, with much grime.
    film = k.math("MULTIPLY", k.step(patches, 0.6, 0.8), 0.15 * amount)
    return k.math("MAXIMUM", dirty, film)


def grime_paint(g, at, layers, amount, dirty, how):
    covered = g.math("MULTIPLY", dirty, 0.6 + 0.35 * amount)
    layers["colour"] = g.mix(covered, layers["colour"], rgba(GRIME_COLOUR))
    # Oily in places, dusty in others.
    oily = g.step(g.noise(at, 0.02, 2), 0.45, 0.6)
    layers["rough"] = g.mix(covered, layers["rough"], g.mix(oily, 0.75, 0.32, "FLOAT"), "FLOAT")
    layers["metal"] = g.mix(covered, layers["metal"], 0.0, "FLOAT")


def drip_cover(k, at, amount, how):
    # Dirty water run down a wall from the edge above, in streaks, further down with more.
    streak = k.noise(streaked(k, at, 0.0025, 0.12), 1.0, 2)
    run = k.math("MULTIPLY", run_from_edges(k, 0.03 + 0.15 * amount), k.math("MULTIPLY_ADD", streak, 2.4, -0.5))
    return k.step(run, 0.55 - 0.3 * amount, 0.65 - 0.3 * amount)


def drip_paint(g, at, layers, amount, streaks, how):
    stain = g.math("MULTIPLY", streaks, 0.35 + 0.4 * amount)
    darker = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY", clamp_factor=True)
    sockets = {socket.identifier: socket for socket in darker.inputs}
    sockets["Factor_Float"].default_value = 1.0
    g.into(sockets["A_Color"], layers["colour"])
    sockets["B_Color"].default_value = (0.62, 0.58, 0.52, 1)
    layers["colour"] = g.mix(stain, layers["colour"], next(s for s in darker.outputs if s.type == "RGBA"))
    layers["rough"] = g.mix(stain, layers["rough"], g.math("ADD", layers["rough"], 0.15, clamp=True), "FLOAT")


def dust_cover(k, at, amount, how):
    # Settled on faces that look up, less where something overhangs them, in patches with little.
    upward = k.step(k.up(), 0.3, 0.8)
    sky = k.math("SUBTRACT", 1, k.closed(DUST_REACH, False))
    patches = k.math("MULTIPLY_ADD", k.math("SUBTRACT", k.noise(at, 0.0008, 2), 0.5), 0.6, k.noise(at, 0.01, 3, 0.6))
    gathered = k.math("MULTIPLY", k.math("MULTIPLY", upward, k.math("MULTIPLY_ADD", sky, 0.7, 0.3)), k.math("ADD", patches, 0.4))
    return k.step(gathered, 0.9 - 0.5 * amount, 1.0 - 0.5 * amount)


def dust_paint(g, at, layers, amount, dusty, how):
    film = g.math("MULTIPLY", dusty, 0.25 + 0.6 * amount)
    layers["colour"] = g.mix(film, layers["colour"], rgba(DUST_COLOUR))
    layers["rough"] = g.mix(film, layers["rough"], 0.95, "FLOAT")
    layers["metal"] = g.mix(film, layers["metal"], 0.0, "FLOAT")
    layers["coat"] = g.mix(film, layers["coat"], 0.0, "FLOAT")
    if "through" in layers:
        layers["through"] = g.mix(film, layers["through"], 0.0, "FLOAT")


# A fingerprint: up to this far from its middle, its ridges this far apart, one in some cells this wide.
# The cells fill space, so a surface cuts each print where it passes: smaller prints, and fewer.
PRINT_RADIUS, PRINT_RIDGES, PRINT_CELLS = 0.008, 0.0005, 0.03


def print_cover(k, at, amount, how):
    # Prints where a hand holds it: on open faces, not in recesses.
    middle, own = k.cell(at, PRINT_CELLS)
    present = k.math("SUBTRACT", 1, k.step(own, 0.8 * amount, 0.8 * amount + 0.01))
    within = k.math("SUBTRACT", 1, k.step(k.math("MULTIPLY", middle, PRINT_CELLS), PRINT_RADIUS * 0.85, PRINT_RADIUS))
    smudged = k.step(k.noise(at, 0.004, 2), 0.38, 0.46)
    sheltered = k.step(recess_of(k), 0.3, 0.6)
    found = k.math("MULTIPLY", k.math("MULTIPLY", present, within), k.math("MULTIPLY", smudged, k.math("SUBTRACT", 1, sheltered)))
    return found


def print_paint(g, at, layers, amount, printed, how):
    middle = g.cells(at, PRINT_CELLS)
    ridges = g.math("MULTIPLY_ADD", g.math("SINE", g.math("MULTIPLY", middle, PRINT_CELLS * 2 * math.pi / PRINT_RIDGES)), 0.5, 0.5)
    oil = g.math("MULTIPLY", printed, g.math("MULTIPLY_ADD", ridges, 0.5, 0.5))
    # Skin oil dulls a gloss and gives a matt surface a slight shine.
    layers["rough"] = g.mix(g.math("MULTIPLY", oil, 0.8), layers["rough"], 0.42, "FLOAT")


# In the order they are drawn, each over the last.
MARKS = (
    Mark("wear", WEAR, wear_cover, wear_paint, False, False),
    Mark("scratches", SCRATCHES, scratch_cover, scratch_paint, True, False),
    Mark("rust", RUST, rust_cover, rust_paint, False, True),
    Mark("grime", GRIME, grime_cover, grime_paint, False, False),
    Mark("drips", DRIPS, drip_cover, drip_paint, True, True),
    Mark("dust", DUST, dust_cover, dust_paint, True, False),
    Mark("fingerprints", FINGERPRINTS, print_cover, print_paint, True, False),
)


def draw_marks(material, shader, given, how):
    """Draws each mark given, by its amount, over the material as it is."""
    graph = Shaped(material)
    inputs = shader.inputs
    at = metres(graph)
    names = {"colour": "Base Color", "rough": "Roughness", "metal": "Metallic", "coat": "Coat Weight"}
    if how["glass"]:
        names["through"] = "Transmission Weight"
    kept = {name: (tuple(inputs[name].default_value) if name == "Base Color" else inputs[name].default_value) for name in names.values()}
    layers = {key: source(graph, inputs[name]) for key, name in names.items()}
    layers["height"] = []
    for each, amount in given:
        mark(graph, each.node, amount)
        each.paint(graph, at, layers, amount, each.cover(graph, at, amount, how), how)
    for key, name in names.items():
        graph.into(inputs[name], layers[key])
    if layers["height"]:
        height = layers["height"][0]
        for more in layers["height"][1:]:
            height = graph.math("ADD", height, more)
        bump = graph.node("ShaderNodeBump")
        bump.inputs["Distance"].default_value = 1
        graph.into(bump.inputs["Height"], height)
        if inputs["Normal"].is_linked:
            graph.into(bump.inputs["Normal"], source(graph, inputs["Normal"]))
        graph.links.new(bump.outputs["Normal"], inputs["Normal"])
    # The values given stay where the scene's description reads them.
    for name, value in kept.items():
        inputs[name].default_value = value

