"""
A light's power, shape, colour and spread in the words the lighting answer and the scene's
description give them: an area light's shape and size, a sun's width in the sky and how bright
it lights white, and the colour a colour temperature gives.
"""

import math

from .wording import hex_of, length, size_text

# A white matt surface square to a sun of strength 1 is lit to this share of
# white, 1/π: measured in Blender 5.2, in Cycles and in EEVEE.
SUN_ON_WHITE = 1 / math.pi
SHAPE_WORDS = {"SQUARE": "square", "DISK": "round", "RECTANGLE": "rectangle", "ELLIPSE": "ellipse"}


def given_light(data):
    """
    The light a light gives, as linear RGB: its colour times its colour
    temperature's, which Blender keeps as bright as white.
    """
    tint = data.temperature_color if data.use_temperature else (1, 1, 1)
    return [c * t for c, t in zip(data.color, tint)]


def light_colour_text(data):
    """The colour a light gives, its brightest channel full, as #rrggbb."""
    rgb = given_light(data)
    top = max(rgb) or 1
    return hex_of([c / top for c in rgb])


def shape_text(data):
    """An area light's size and shape."""
    if data.shape in ("SQUARE", "DISK"):
        return f"{length(data.size)} across, {SHAPE_WORDS[data.shape]}"
    return f"{size_text([data.size, data.size_y])}, {SHAPE_WORDS[data.shape]}"


def light_facts(data, colour_always=False):
    """
    A light's kind, power with its exposure, colour, temperature and shape,
    as a list of phrases. Its colour is said when it is not white, or always.
    """
    sun = data.type == "SUN"
    facts = [f"{data.type.lower()} light", f"{data.energy:g} {'strength' if sun else 'W'}"]
    if abs(data.exposure) > 1e-6:
        given = data.energy * 2**data.exposure
        facts[-1] += f" at exposure {data.exposure:+g}, as {given:.4g}{' strength' if sun else ' W'}"
    if data.use_temperature:
        facts.append(f"{data.temperature:g} K, giving light of {light_colour_text(data)}")
    elif colour_always or any(abs(c - 1) > 1e-6 for c in data.color):
        facts.append(f"colour {hex_of(data.color)}")
    if data.type == "AREA":
        facts.append(shape_text(data))
    if sun:
        facts.append(f"{math.degrees(data.angle):.3g}° across the sky")
    return facts


def sun_on_white(data):
    """How bright a sun lights a white matt surface square to it, as a share of white."""
    r, g, b = given_light(data)
    return data.energy * 2**data.exposure * SUN_ON_WHITE * (0.2126 * r + 0.7152 * g + 0.0722 * b)
