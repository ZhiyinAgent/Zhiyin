"""
Mineral finishes: ceramic glaze, concrete, stone, marble and frosted glass, each drawn in metres on
the object.
"""

from .finishes import mottle, scattering

# Marble scatters light a few millimetres into it, nearly alike in every colour.
MARBLE_RADIUS, MARBLE_SCALE = (1.0, 0.92, 0.85), 0.003


def ceramic_glaze(graph, at, base, roughness, drawing):
    # The glaze pooled thicker here and thinner there, a gentle waviness in it and a pinhole now and then.
    pooled = graph.noise(at, 0.02, 3)
    pinhole = graph.math(
        "MULTIPLY",
        graph.math("SUBTRACT", 1, graph.step(graph.cells(at, 0.003), 0.0, 0.05)),
        graph.step(graph.noise(at, 0.02, 1), 0.62, 0.66),
    )
    colour = graph.mix(graph.math("MULTIPLY", pinhole, 0.5), graph.tones(pooled, base, 0.96, 1.02, warm=0.99), (base[0] * 0.6, base[1] * 0.58, base[2] * 0.55, 1))
    height = graph.math("MULTIPLY_ADD", graph.noise(at, 0.006, 2), 0.000006, graph.math("MULTIPLY", pinhole, -0.00002))
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.02, 0.05), "height": height}


def concrete(graph, at, base, roughness, drawing):
    # Pores where air was trapped, sand and small stones in it, and broad pale and dark patches.
    pores = graph.math(
        "MULTIPLY",
        graph.math("SUBTRACT", 1, graph.step(graph.cells(at, 0.0025), 0.0, 0.12)),
        graph.step(graph.noise(at, 0.01, 2), 0.55, 0.6),
    )
    aggregate = graph.noise(at, 0.004, 4, 0.6)
    patches = graph.noise(at, 0.12, 2)
    colour = graph.tones(graph.math("MULTIPLY_ADD", patches, 0.6, graph.math("MULTIPLY", aggregate, 0.4)), base, 0.85, 1.12)
    colour = graph.mix(graph.math("MULTIPLY", pores, 0.6), colour, (base[0] * 0.45, base[1] * 0.45, base[2] * 0.45, 1))
    height = graph.math("MULTIPLY_ADD", aggregate, 0.0001, graph.math("MULTIPLY", pores, -0.0004))
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.01, 0.05), "height": height}


def stone(graph, at, base, roughness, drawing):
    # Grains of three minerals a few millimetres across: dark, the stone's own and pale, a little pink.
    gap, own = graph.cell(at, 0.003)
    dark = (base[0] * 0.3, base[1] * 0.3, base[2] * 0.32, 1)
    pale = (min(1, base[0] * 1.45), min(1, base[1] * 1.35), min(1, base[2] * 1.3), 1)
    colour = graph.mix(graph.step(own, 0.3, 0.32), dark, graph.tones(graph.noise(at, 0.002, 2), base, 0.92, 1.05))
    colour = graph.mix(graph.step(own, 0.78, 0.8), colour, pale)
    rough = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", own, 0.5), 0.15, roughness, clamp=True)
    return {"colour": colour, "roughness": rough, "height": graph.math("MULTIPLY", gap, 0.00001)}


def marble(graph, at, base, roughness, drawing):
    # Broad veins wandering through it, finer ones between them, over a cloudy ground.
    veins = []
    for size, width, distortion in ((0.15, 0.02, 0.8), (0.04, 0.01, 0.5)):
        wander = graph.noise(at, size, 4, 0.6, distortion)
        veins.append(graph.math("SUBTRACT", 1, graph.step(graph.math("ABSOLUTE", graph.math("SUBTRACT", wander, 0.5)), 0.0, width)))
    vein_colour = (base[0] * 0.42, base[1] * 0.44, base[2] * 0.48, 1)
    colour = graph.tones(graph.noise(at, 0.05, 3), base, 0.96, 1.02)
    colour = graph.mix(veins[0], colour, vein_colour)
    colour = graph.mix(graph.math("MULTIPLY", veins[1], 0.5), colour, vein_colour)
    rough = graph.math("MULTIPLY_ADD", veins[0], 0.05, roughness, clamp=True)
    inputs, said = scattering(drawing, MARBLE_RADIUS, MARBLE_SCALE)
    inputs["Subsurface Weight"] = 0.4
    return {"colour": colour, "roughness": rough, "height": graph.math("MULTIPLY", veins[0], -0.000003), "inputs": inputs, "said": [said]}


def frosted_glass(graph, at, base, roughness, drawing):
    # Etched: the surface broken into tiny pits that scatter what passes through.
    etch = graph.noise(at, 0.00004, 2)
    rough = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", etch, 0.5), 0.1, roughness, clamp=True)
    return {"colour": base, "roughness": rough, "height": graph.math("MULTIPLY", etch, 0.0000008)}


DRAWN = {
    "ceramic-glaze": ceramic_glaze,
    "concrete": concrete,
    "stone": stone,
    "marble": marble,
    "frosted-glass": frosted_glass,
}
