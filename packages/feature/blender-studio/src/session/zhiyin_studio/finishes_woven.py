"""
Woven finishes: a steel braid, carbon fibre, cloth and knit. Each is woven on the three planes of
the object's own frame and blended by which way the surface faces, so a hose or a seat shows it
along any axis, in metres on the object.
"""

import math

# A braid: strands this wide, each of this many wires, and how deep its weave is.
BRAID_PITCH, BRAID_WIRES, BRAID_DEPTH = 0.0016, 5, 0.00025
# Carbon fibre's tows, as wide as a 3K twill's; cloth's threads; a knit's stitches, wide and tall.
TOW, THREAD = 0.0025, 0.0005
STITCH_WIDE, STITCH_TALL = 0.003, 0.0024
# The object's three planes: the two axes each lies along, and the axis it faces.
PLANES = (((1, 2), 0), ((0, 2), 1), ((0, 1), 2))


def planes(graph, at):
    """
    The point on each of the object's three planes, with the share of it that shows where the
    surface faces that way, and the plane's own two axes: [(across, along, share, axes)].
    """
    coordinates = graph.parts(at)
    facing = graph.parts(graph.node("ShaderNodeTexCoord").outputs["Normal"])
    weights = [graph.math("POWER", graph.math("ABSOLUTE", axis), 8) for axis in facing]
    total = graph.math("ADD", graph.math("ADD", *weights[:2]), weights[2])
    found = []
    for (u, v), faces in PLANES:
        share = graph.math("DIVIDE", weights[faces], total)
        found.append((coordinates[u], coordinates[v], share, (u, v)))
    return found


def blended(graph, values, shares):
    total = 0
    for value, share in zip(values, shares):
        total = graph.math("MULTIPLY_ADD", value, share, total)
    return total


def weave(graph, across, along):
    """
    A plain-woven braid on a plane: strands of wires crossing at right
    angles, diagonally to the plane's axes, each over one and under the next.
    Answers its height, 0 in the gaps to 1 on a strand at its highest.
    """
    root = 1 / (math.sqrt(2) * BRAID_PITCH)
    s = graph.math("MULTIPLY", graph.math("ADD", across, along), root)
    t = graph.math("MULTIPLY", graph.math("SUBTRACT", across, along), root)
    strands = []
    for run, side, over in ((s, t, 1), (t, s, -1)):
        lane = graph.math("FRACT", side)
        # Round across the strand, ridged by its wires.
        ridge = graph.math("SINE", graph.math("MULTIPLY", lane, math.pi))
        wires = graph.math("ABSOLUTE", graph.math("SINE", graph.math("MULTIPLY", lane, math.pi * BRAID_WIRES)))
        ridged = graph.math("MULTIPLY", ridge, graph.math("MULTIPLY_ADD", graph.math("SQRT", wires), 0.25, 0.75))
        # Up where it crosses over, down where it passes under.
        crossing = graph.math("COSINE", graph.math("MULTIPLY", graph.math("ADD", graph.math("SUBTRACT", run, 0.5), graph.math("FLOOR", side)), math.pi))
        lift = graph.math("MULTIPLY_ADD", crossing, 0.25 * over, 0.75)
        strands.append(graph.math("MULTIPLY", ridged, lift))
    return graph.math("MAXIMUM", *strands)


def braided(graph, at, base, roughness, drawing):
    found = planes(graph, at)
    woven = blended(graph, [weave(graph, across, along) for across, along, _, _ in found], [share for *_, share, _ in found])
    # The gaps between strands are dark and dull.
    shown = graph.step(woven, 0.05, 0.45)
    colour = graph.mix(shown, (base[0] * 0.25, base[1] * 0.25, base[2] * 0.25, 1), base)
    rough = graph.math("MULTIPLY_ADD", shown, -0.25, roughness + 0.2, clamp=True)
    return {"colour": colour, "roughness": rough, "height": graph.math("MULTIPLY", woven, BRAID_DEPTH)}


def interlaced(graph, across, along, width, repeat):
    """
    Two sets of tows or threads `width` wide crossing at right angles, each over `repeat / 2` and
    under as many, shifted by one each row: a twill for 4, a plain weave for 2. Answers how high
    the one on top is, 0 between them to 1 along its middle, and whether it runs along `across`.
    """
    u, v = graph.math("DIVIDE", across, width), graph.math("DIVIDE", along, width)
    row = graph.math("ADD", graph.math("FLOOR", u), graph.math("FLOOR", v))
    first = graph.math("LESS_THAN", graph.math("FLOORED_MODULO", row, repeat), repeat / 2)
    # One running along u is round across v, and the other way about.
    over_u = graph.math("SINE", graph.math("MULTIPLY", graph.math("FRACT", v), math.pi))
    over_v = graph.math("SINE", graph.math("MULTIPLY", graph.math("FRACT", u), math.pi))
    return graph.mix(first, over_v, over_u, "FLOAT"), first


def carbon_fibre(graph, at, base, roughness, drawing):
    heights, firsts, grooves, shares = [], [], [], []
    for across, along, share, (u, v) in planes(graph, at):
        height, first = interlaced(graph, across, along, TOW, 4)
        heights.append(height)
        firsts.append(first)
        shares.append(share)
        # Fibres run along the tow on top.
        grooves.append(graph.mix(first, tuple(1.0 if i == v else 0.0 for i in range(3)), tuple(1.0 if i == u else 0.0 for i in range(3)), "VECTOR"))
    height = blended(graph, heights, shares)
    first = blended(graph, firsts, shares)
    groove = graph.vector("ADD", graph.vector("ADD", graph.vector("SCALE", grooves[0], shares[0]), graph.vector("SCALE", grooves[1], shares[1])), graph.vector("SCALE", grooves[2], shares[2]))
    # Each tow reflects drawn out across its fibres, in Cycles; the two ways differ a little in tone everywhere.
    normal = graph.node("ShaderNodeNewGeometry").outputs["Normal"]
    across = graph.vector("CROSS_PRODUCT", normal, graph.own(groove))
    fibres = graph.noise(at, 0.0002, 2)
    colour = graph.mix(graph.step(height, 0.05, 0.35), (base[0] * 0.4, base[1] * 0.4, base[2] * 0.4, 1), graph.tones(first, base, 0.8, 1.25))
    rough = graph.math("MULTIPLY_ADD", graph.math("SUBTRACT", fibres, 0.5), 0.1, graph.math("MULTIPLY_ADD", first, 0.08, roughness), clamp=True)
    return {
        "colour": colour,
        "roughness": rough,
        "height": graph.math("MULTIPLY", height, 0.00006),
        "inputs": {"Tangent": graph.vector("NORMALIZE", across), "Anisotropic": 0.7},
        "said": ["Cycles draws each tow's highlight out across its fibres, EEVEE the weave alone"],
    }


def fabric(graph, at, base, roughness, drawing):
    heights, threads, shares = [], [], []
    for across, along, share, _ in planes(graph, at):
        height, first = interlaced(graph, across, along, THREAD, 2)
        heights.append(height)
        # Each thread a little lighter or darker than the next, along its length.
        own = graph.noise(graph.join(graph.math("FLOOR", graph.math("DIVIDE", across, THREAD)), graph.math("FLOOR", graph.math("DIVIDE", along, THREAD)), first), 3.0, 1)
        threads.append(own)
        shares.append(share)
    height = blended(graph, heights, shares)
    tone = blended(graph, threads, shares)
    fuzz = graph.noise(at, 0.0001, 2)
    colour = graph.mix(graph.step(height, 0.0, 0.3), (base[0] * 0.55, base[1] * 0.55, base[2] * 0.55, 1), graph.tones(tone, base, 0.9, 1.06))
    # The sheen of fibres catching light at a glance, in a lighter shade of their own colour.
    sheen = (min(1, base[0] * 1.6), min(1, base[1] * 1.6), min(1, base[2] * 1.6), 1)
    return {
        "colour": colour,
        "roughness": graph.math("MULTIPLY_ADD", fuzz, 0.1, roughness - 0.05, clamp=True),
        "height": graph.math("MULTIPLY_ADD", fuzz, 0.000008, graph.math("MULTIPLY", height, 0.00008)),
        "inputs": {"Sheen Weight": 0.5, "Sheen Roughness": 0.5, "Sheen Tint": sheen},
    }


def stitches(graph, across, along):
    """Knitted stitches on a plane: columns of V-shaped loops, each leg round across it. Answers its height, 0 to 1."""
    column = graph.math("DIVIDE", across, STITCH_WIDE)
    side = graph.math("ABSOLUTE", graph.math("SUBTRACT", graph.math("FRACT", column), 0.5))
    # Each leg leans out from the column's middle, so the loops stack as Vs.
    course = graph.math("FRACT", graph.math("MULTIPLY_ADD", side, 0.9, graph.math("DIVIDE", along, STITCH_TALL)))
    leg = graph.math("COSINE", graph.math("MULTIPLY", graph.math("SUBTRACT", graph.math("MULTIPLY", side, 2), 0.5), math.pi))
    loop = graph.math("POWER", graph.math("SINE", graph.math("MULTIPLY", course, math.pi)), 0.6)
    return graph.math("MULTIPLY", graph.math("MAXIMUM", leg, 0), graph.math("MULTIPLY_ADD", loop, 0.5, 0.5))


def knit(graph, at, base, roughness, drawing):
    found = planes(graph, at)
    height = blended(graph, [stitches(graph, across, along) for across, along, _, _ in found], [share for *_, share, _ in found])
    fuzz = graph.noise(at, 0.0003, 3, 0.6)
    colour = graph.mix(graph.step(height, 0.0, 0.35), (base[0] * 0.5, base[1] * 0.5, base[2] * 0.5, 1), graph.tones(fuzz, base, 0.92, 1.06))
    sheen = (min(1, base[0] * 1.6), min(1, base[1] * 1.6), min(1, base[2] * 1.6), 1)
    return {
        "colour": colour,
        "roughness": graph.math("MULTIPLY_ADD", fuzz, 0.08, roughness - 0.04, clamp=True),
        "height": graph.math("MULTIPLY_ADD", fuzz, 0.00003, graph.math("MULTIPLY", height, 0.0004)),
        "inputs": {"Sheen Weight": 0.5, "Sheen Roughness": 0.35, "Sheen Tint": sheen},
    }


DRAWN = {
    "braided-steel": braided,
    "carbon-fibre": carbon_fibre,
    "fabric": fabric,
    "knit": knit,
}
