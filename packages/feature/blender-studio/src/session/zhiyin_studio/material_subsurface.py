"""
Subsurface scattering: light going into a material and out again elsewhere, as through skin,
wax, marble and milk, set by how far it reaches in red, green and blue. Named starting points
give a material's colour and reach; the answer gives the reach against the object's thinnest
part, since a reach wider than the part lets light through it, which turns it to jelly, and says
what EEVEE draws differently from Cycles.
"""

from typing import NamedTuple

from . import material_thickness
from .arguments import need, number, vector
from .wording import length, one_of

METHODS = {"burley": "BURLEY", "random-walk": "RANDOM_WALK", "random-walk-skin": "RANDOM_WALK_SKIN"}
METHOD_WORDS = {"burley": "Christensen-Burley", "random-walk": "random walk", "random-walk-skin": "random walk (skin)"}


class Start(NamedTuple):
    """A named starting point: its colour, its reach in mm in red, green and blue, how it is drawn, its ior, and where it comes from."""

    colour: str
    radius_mm: tuple
    method: str
    ior: float
    source: str


# Jensen, Marschner, Levoy and Hanrahan, "A Practical Model for Subsurface Light Transport"
# (SIGGRAPH 2001), figure 5: each colour is the measured diffuse reflectance, and each reach the
# diffuse mean free path 1 / sqrt(3 σa (σa + σs')) from the measured σa and σs'.
MEASURED = "as Jensen et al. (2001) measured it"
ESTIMATED = "a starting point to judge by eye"
STARTS = {
    "skin": Start("#b18165", (3.67, 1.37, 0.68), "random-walk-skin", 1.3, MEASURED),
    "marble": Start("#ebe6e1", (8.51, 5.57, 3.95), "random-walk", 1.5, MEASURED),
    "milk": Start("#f5f1e2", (10.9, 6.58, 2.51), "random-walk", 1.3, MEASURED),
    "fruit": Start("#edecc0", (6.96, 6.4, 1.9), "random-walk", 1.3, f"an apple's, {MEASURED}"),
    "wax": Start("#e9dcc3", (8.0, 6.0, 4.0), "random-walk", 1.4, ESTIMATED),
    "jade": Start("#4f8f62", (1.5, 4.0, 1.5), "random-walk", 1.4, ESTIMATED),
    "egg": Start("#f0e6d6", (2.5, 2.0, 1.5), "random-walk", 1.4, ESTIMATED),
}
# Blender's own, when nothing is given: 1, 0.2 and 0.1 of 5 mm.
PLAIN = Start("", (5.0, 1.0, 0.5), "random-walk", 1.4, "")


def preset_of(values):
    """The starting point a call names, or None; refused when it names none of them."""
    spec = values.get("subsurface")
    if spec is None:
        return None
    need(isinstance(spec, dict), "subsurface gives a preset or a weight, and how far light reaches.")
    name = spec.get("preset")
    need(name is None or name in STARTS, f"subsurface preset is one of {one_of(STARTS)}.")
    return STARTS.get(name)


def set_subsurface(shader, values):
    """Sets the subsurface inputs, none when the call gives none; what the answer says in the material's values."""
    inputs = shader.inputs
    spec = values.get("subsurface")
    inputs["Subsurface Weight"].default_value = 0
    shader.subsurface_method = "RANDOM_WALK"
    if spec is None:
        return [], None
    start = preset_of(values) or PLAIN
    weight = number(spec.get("weight"), "subsurface weight", minimum=0, maximum=1, default=1)
    radius = vector(spec.get("radius_mm"), "subsurface radius_mm", 3, default=start.radius_mm)
    need(all(r > 0 for r in radius), "Every value of subsurface radius_mm must be greater than 0.")
    scale = number(spec.get("scale"), "subsurface scale", minimum=0, default=1)
    need(scale > 0, "subsurface scale must be greater than 0.")
    method = spec.get("method", start.method)
    need(method in METHODS, f"subsurface method is one of {one_of(METHODS)}.")
    anisotropy = number(spec.get("anisotropy"), "subsurface anisotropy", minimum=-1, maximum=1, default=0)
    inputs["Subsurface Weight"].default_value = weight
    # The reach is the radius times the scale, in metres: the radius is kept in millimetres as
    # given and the scale is that many millimetres, as Blender shows them.
    inputs["Subsurface Radius"].default_value = tuple(radius)
    inputs["Subsurface Scale"].default_value = scale / 1000
    inputs["Subsurface Anisotropy"].default_value = anisotropy
    shader.subsurface_method = METHODS[method]
    if method == "random-walk-skin":
        # Its own ior is an input only this method has.
        inputs["Subsurface IOR"].default_value = start.ior
    reach = [r * scale / 1000 for r in radius]
    name = spec.get("preset")
    said = [f"subsurface {name} ({start.source})" if name else "subsurface", f"subsurface weight {weight:g}"]
    return said, Reach(reach, scale, method, anisotropy)


class Reach(NamedTuple):
    """How far light reaches in red, green and blue, in metres, the scale given, how it is drawn and its anisotropy."""

    metres: list
    scale: float
    method: str
    anisotropy: float


def reach_text(reach, targets, engine):
    """The reach against each object's thinnest part, and what EEVEE draws differently."""
    far = max(reach.metres)
    lines = [
        "Its light reaches " + ", ".join(length(r) for r in reach.metres) + " in red, green and blue"
        f", drawn by {METHOD_WORDS[reach.method]} in Cycles."
    ]
    for obj in targets:
        thin = material_thickness.Thickness(obj).thinnest
        if thin is None:
            lines.append(f"{obj.name}'s thinnest part could not be measured: it has no inside to go into.")
        elif far > thin:
            lines.append(
                f"That is wider than {obj.name}'s thinnest part, {length(thin)} across, so light passes through it there"
                f" and it looks like jelly: a scale of {reach.scale * thin / 2 / far:.3g} or less keeps it under half of that."
            )
        else:
            lines.append(f"{obj.name}'s thinnest part is {length(thin)} across, {thin / far:.3g} times the reach, so it stays solid.")
    unseen = ["the random walk"] if reach.method != "burley" else []
    if abs(reach.anisotropy) > 1e-6:
        unseen.append("the anisotropy")
    if reach.method == "random-walk-skin":
        unseen.append("the skin's ior")
    lines.append(
        "EEVEE draws subsurface light by its own approximation"
        + (f", without {one_of(unseen).replace(' or ', ' and ')}" if unseen else "")
        + ", so it looks different there from Cycles"
        + (": this scene renders in EEVEE." if engine == "BLENDER_EEVEE" else ".")
    )
    return " ".join(lines)


def own_colour(values):
    """The colour of the starting point a call names, which it takes unless it gives its own; or None."""
    start = preset_of(values)
    return start.colour if start is not None else None
