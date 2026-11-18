"""
What draws a surface on a material, between its plain values: a finish at its real size, and the
wear, grime and other marks over it, with where each lands on each object. Checked before the
material changes, drawn after its other values, and said in the material's answer.
"""

from . import finishes, finishes_metal, finishes_mineral, finishes_soft, finishes_woven
from .arguments import need, number
from .finishes import FINISHES, PLAIN, Drawing
from .finishes_landing import where_marks_land
from .finishes_marks import MARKS, draw_marks
from .finishes_shape import lay_runs
from .material_inputs import AMOUNT
from .wording import length, one_of

DRAWN = {**finishes_metal.DRAWN, **finishes_woven.DRAWN, **finishes_soft.DRAWN, **finishes_mineral.DRAWN}

# What the answer says each mark does, before where it lands.
DOES = {
    "wear": "on its edges and corners",
    "grime": "in its recesses and corners",
    "rust": "on its edges and in its corners, pitted, and running down from its edges",
    "drips": "running down from its edges",
    "dust": "on its up-facing faces, less under what overhangs them",
    "fingerprints": "on its open faces",
}
NAMED = {"drips": "drip streaks"}


def finish_of(values):
    """The finish asked for and what it brings when the call gives none of its own values."""
    look = values.get("finish")
    need(look is None or look in FINISHES, f"finish is one of {one_of(FINISHES)}.")
    # A finish has its own colour, metal and roughness, which the call's own replace.
    return look, FINISHES.get(look, PLAIN)


def check_drawn(values, look, grain):
    """Refuses surfaces drawn over one another: wood, a finish and a picture each draw the whole surface."""
    need(
        not (grain and values.get("texture") is not None),
        "wood draws its own grain in the colour given: give the wood or the texture, not both.",
    )
    need(not (grain and look), "wood is a finish of its own: give the wood or another finish, not both.")
    need(
        not (look and values.get("texture") is not None),
        "a finish draws its own surface in the colour given: give the finish or the texture, not both.",
    )
    need(
        values.get("brushing") is None or look == "brushed-metal",
        "brushing says how brushed-metal is brushed: give it with finish brushed-metal.",
    )


def amounts(values):
    """Each mark given, with its amount from 0 to 1, in the order they are drawn."""
    return [
        (mark, amount)
        for mark in MARKS
        if (amount := number(values.get(mark.key), mark.key, minimum=AMOUNT[0], maximum=AMOUNT[1], default=0))
    ]


def check_transmission(values, look, transmission):
    """
    Refuses an opaque finish on glass and liquids, and the marks drawn only on opaque surfaces:
    frosted glass is the finish glass takes, and dust, scratches, drips and fingerprints go on it.
    """
    own = FINISHES.get(look, PLAIN)
    clear = transmission if values.get("transmission") is not None else own.transmission
    opaque = [mark.key for mark, _ in amounts(values) if not mark.clear]
    need(
        not (transmission and look and not own.transmission) and not (clear and opaque),
        "finishes, wear and grime are drawn on opaque surfaces, as rust is: frosted-glass is the finish glass takes, "
        "and glass and liquids take dust, scratches, drips and fingerprints.",
    )


def finish_said(values, look, own):
    """What the answer says of the finish, among the material's values."""
    if not look:
        return []
    said = [f"{look} finish: {own.shows}"]
    if own.transmission and values.get("transmission") is None:
        said.append(f"transmission {own.transmission:g}, ior {number(values.get('ior'), 'ior', minimum=1, maximum=4, default=1.5):g}")
    return said


def handling_axis(targets):
    """The object's own axis it is handled along, its longest side, and what the answer says of it."""
    obj = targets[0]
    size = list(obj.dimensions)
    longest = max(range(3), key=lambda i: size[i])
    return tuple(1.0 if i == longest else 0.0 for i in range(3)), f"along its own {'xyz'[longest]} axis ({obj.name}'s longest side, {length(size[longest])})"


def draw(material, shader, values, look, own, base, targets):
    """Draws the finish, then the marks over it; what the answer says of them and where each lands."""
    said = []
    inputs = shader.inputs
    finishes.unset(shader, values)
    if look:
        if own.transmission:
            if values.get("transmission") is None:
                inputs["Transmission Weight"].default_value = own.transmission
            if hasattr(material, "use_raytrace_refraction"):
                material.use_raytrace_refraction = True
        said += finishes.finish(material, shader, look, base, inputs["Roughness"].default_value, DRAWN[look], Drawing(values, targets))
    given = amounts(values)
    if not given:
        return said
    axis, along = handling_axis(targets)
    how = {
        "wears_as": own.wears_as or ("metal" if inputs["Metallic"].default_value >= 0.5 else "plain"),
        "glass": inputs["Transmission Weight"].default_value > 0,
        "axis": axis,
    }
    if any(mark.runs for mark, _ in given):
        for obj in targets:
            if obj.type == "MESH":
                lay_runs(obj)
    draw_marks(material, shader, given, how)
    landing = where_marks_land(given, how, targets)
    for mark, amount in given:
        does = along if mark.key == "scratches" else DOES[mark.key]
        places = landing.get(mark.key) or []
        covering = f", covering {' and '.join(places)}" if places else ""
        said.append(f"{NAMED.get(mark.key, mark.key)} {amount:g} {does}{covering}")
    return said

