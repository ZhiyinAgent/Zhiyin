"""
Soft and moulded finishes: textured plastic, rubber, leather, paper, cardboard and skin, each drawn
in metres on the object.
"""

from .finishes import mottle, scattering

# Skin scatters red light about 4 mm under its surface, green and blue less far.
SKIN_RADIUS, SKIN_SCALE = (1.0, 0.36, 0.18), 0.004


def textured_plastic(graph, at, base, roughness, drawing):
    # A moulded stipple: small domes, smoother on their tops.
    dome = graph.math("SUBTRACT", 1, graph.math("POWER", graph.cells(at, 0.00035), 2), clamp=True)
    colour = graph.tones(graph.noise(at, 0.03, 2), base, 0.96, 1.04)
    rough = graph.math("MULTIPLY_ADD", dome, -0.12, roughness + 0.06, clamp=True)
    return {"colour": colour, "roughness": rough, "height": graph.math("MULTIPLY", dome, 0.00003)}


def rubber(graph, at, base, roughness, drawing):
    colour = graph.tones(graph.noise(at, 0.012, 3), base, 0.92, 1.08)
    height = graph.math("MULTIPLY", graph.noise(at, 0.00025, 2), 0.000012)
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.01, 0.06), "height": height}


def leather(graph, at, base, roughness, drawing):
    # Pebbles of grain a millimetre or so across, and creases where it was bent, darker in their folds.
    pebble = graph.step(graph.cell_edges(at, 0.0012), 0.0, 0.12)
    crease = graph.math("SUBTRACT", 1, graph.step(graph.math("ABSOLUTE", graph.math("SUBTRACT", graph.noise(at, 0.01, 2), 0.5)), 0.0, 0.02))
    shade = graph.math("MULTIPLY_ADD", pebble, 0.3, graph.math("MULTIPLY", graph.noise(at, 0.02, 3), 0.7))
    colour = graph.mix(graph.math("MULTIPLY", crease, 0.5), graph.tones(shade, base, 0.82, 1.08, warm=0.97), (base[0] * 0.55, base[1] * 0.5, base[2] * 0.45, 1))
    rough = graph.math("MULTIPLY_ADD", pebble, -0.1, graph.math("MULTIPLY_ADD", crease, 0.1, roughness + 0.05), clamp=True)
    height = graph.math("MULTIPLY_ADD", pebble, 0.00003, graph.math("MULTIPLY", crease, -0.00005))
    return {
        "colour": colour,
        "roughness": rough,
        "height": height,
        "inputs": {"Sheen Weight": 0.3, "Sheen Roughness": 0.4},
    }


def paper(graph, at, base, roughness, drawing):
    fibres = graph.noise(at, 0.0003, 3, 0.6)
    colour = graph.tones(graph.math("MULTIPLY_ADD", fibres, 0.5, graph.math("MULTIPLY", graph.noise(at, 0.004, 2), 0.5)), base, 0.97, 1.02)
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.003, 0.04), "height": graph.math("MULTIPLY", fibres, 0.000004)}


def cardboard(graph, at, base, roughness, drawing):
    fibres = graph.noise(at, 0.0005, 4, 0.6)
    specks = graph.math("SUBTRACT", 1, graph.step(graph.cells(at, 0.0025), 0.0, 0.08))
    colour = graph.tones(graph.math("MULTIPLY_ADD", fibres, 0.6, graph.math("MULTIPLY", graph.noise(at, 0.01, 2), 0.4)), base, 0.88, 1.06, warm=0.97)
    colour = graph.mix(graph.math("MULTIPLY", specks, 0.7), colour, (base[0] * 0.35, base[1] * 0.3, base[2] * 0.25, 1))
    return {"colour": colour, "roughness": mottle(graph, at, roughness, 0.004, 0.04), "height": graph.math("MULTIPLY", fibres, 0.00001)}


def skin(graph, at, base, roughness, drawing):
    # Pores a fraction of a millimetre across and fine lines between them, the tone mottled.
    pores = graph.math("SUBTRACT", 1, graph.step(graph.cells(at, 0.0006), 0.0, 0.18))
    lines = graph.math("SUBTRACT", 1, graph.step(graph.math("ABSOLUTE", graph.math("SUBTRACT", graph.noise(at, 0.004, 2), 0.5)), 0.0, 0.015))
    colour = graph.tones(graph.noise(at, 0.01, 3), base, 0.94, 1.04, warm=0.96)
    rough = graph.math("MULTIPLY_ADD", pores, 0.1, mottle(graph, at, roughness, 0.008, 0.05), clamp=True)
    height = graph.math("MULTIPLY_ADD", pores, -0.00002, graph.math("MULTIPLY_ADD", lines, -0.00002, graph.math("MULTIPLY", graph.noise(at, 0.0002, 2), 0.000005)))
    inputs, said = scattering(drawing, SKIN_RADIUS, SKIN_SCALE)
    return {"colour": colour, "roughness": rough, "height": height, "inputs": inputs, "said": [said]}


DRAWN = {
    "textured-plastic": textured_plastic,
    "rubber": rubber,
    "leather": leather,
    "paper": paper,
    "cardboard": cardboard,
    "skin": skin,
}
