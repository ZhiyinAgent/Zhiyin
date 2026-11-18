"""
A tint for what light passes through: a colour seen through a given depth of the material, as
coloured glass, juice or a gem show, deeper where it is thicker. It is drawn by absorption in
the material's volume, at the density that lets exactly that colour through that depth: light
through Blender's volume absorption keeps exp(-(1 - colour) × density × distance) of itself in
each channel, as measured in Cycles. The answer gives the colour seen through each object's
thickest part, measured on its shape.
"""

import math

from . import material_thickness
from .arguments import colour, need, number
from .wording import hex_of, length

# The least share of light a channel lets through its depth, so a black tint stays a number.
DARKEST = 1e-4


def tint_of(values, transmission):
    """The tint asked for, as a linear colour and a depth in metres, or None; refused on an opaque material."""
    spec = values.get("tint")
    if spec is None:
        return None
    need(isinstance(spec, dict), "tint gives a color and the depth in metres it is seen at.")
    need(
        transmission > 0,
        "tint colours the light that passes through a material: give transmission with it, 1 for glass and liquids.",
    )
    seen = colour(spec.get("color"), "tint color")
    depth = number(spec.get("depth"), "tint depth", minimum=0)
    need(depth > 0, "tint depth must be greater than 0: the thickness in metres the colour is seen through.")
    return seen[:3], depth


def check_closed(targets, tint):
    """Refuses a tint on an object with no inside for light to cross; the thickness of each object."""
    if tint is None:
        return {}
    measured = {obj.name: material_thickness.Thickness(obj) for obj in targets}
    open_ = [name for name, found in measured.items() if not found.closed or found.thickest is None]
    need(
        not open_,
        f"{', '.join(open_)} is not closed, so it has no inside for light to cross and a tint shows nothing:"
        " give a closed shape, or a colour for a thin sheet's glass.",
    )
    return measured


def draw_tint(material, tint, measured, base):
    """
    Fills the material's volume with the absorption that gives the tint; what the answer says
    of it. The base colour filters what passes once more, as Cycles draws it.
    """
    seen, depth = tint
    # Each channel's absorption per metre, from the share of it the tint lets through its depth.
    per_metre = [-math.log(max(c, DARKEST)) / depth for c in seen]
    density = max(per_metre)
    if density <= 0:
        return "Its tint of white absorbs nothing, so light passes through untinted."
    tree = material.node_tree
    absorb = tree.nodes.new("ShaderNodeVolumeAbsorption")
    absorb.inputs["Color"].default_value = (*[1 - k / density for k in per_metre], 1)
    absorb.inputs["Density"].default_value = density
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    tree.links.new(absorb.outputs["Volume"], output.inputs["Volume"])
    through = []
    for name, found in measured.items():
        thick = found.thickest
        shown = [b * math.exp(-k * thick) for b, k in zip(base, per_metre)]
        through.append(f"{hex_of(shown)} through {name}'s thickest part, {length(thick)}")
    filtered = f", and its colour {hex_of(base)} filters it too" if hex_of(base) != "#ffffff" else ""
    return (
        f"Its tint is {hex_of(seen)} seen through {length(depth)}{filtered}: {'; '.join(through)}."
        " EEVEE does not show the tint through glass, so it shows there untinted: render in Cycles to see it."
    )
