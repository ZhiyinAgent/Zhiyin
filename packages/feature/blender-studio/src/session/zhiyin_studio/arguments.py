"""
A command's arguments checked as they are read: numbers, vectors, points and colours, each
refused in words the model can act on when it is not what the tool takes.
"""

import math

import mathutils
import mathutils.bvhtree

from .errors import Refused


def need(condition, message):
    if not condition:
        raise Refused(message)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def number(value, name, *, minimum=None, maximum=None, default=None):
    if value is None:
        need(default is not None, f"{name} is required.")
        return float(default)
    need(is_number(value), f"{name} must be a number.")
    if minimum is not None:
        need(value >= minimum, f"{name} must be at least {minimum}.")
    if maximum is not None:
        need(value <= maximum, f"{name} must be at most {maximum}.")
    return float(value)


def whole(value, name, *, minimum=1, maximum=1000, default=None):
    found = number(value, name, minimum=minimum, maximum=maximum, default=default)
    need(float(found).is_integer(), f"{name} must be a whole number.")
    return int(found)


def vector(value, name, length=3, default=None):
    if value is None:
        need(default is not None, f"{name} is required.")
        return mathutils.Vector(default)
    need(
        isinstance(value, (list, tuple)) and len(value) == length and all(is_number(v) for v in value),
        f"{name} must be a list of {length} numbers.",
    )
    return mathutils.Vector([float(v) for v in value])


def positive_size(value, name, default=None, length=3):
    found = vector(value, name, length, default)
    need(all(c > 0 for c in found), f"Every value of {name} must be greater than 0.")
    return found


def rotation(value, name="rotation", default=(0, 0, 0)):
    """Degrees, as people give them, to Blender's radians."""
    found = vector(value, name, default=default)
    return mathutils.Euler([math.radians(c) for c in found], "XYZ")


def points(value, name, dimensions, minimum):
    need(isinstance(value, (list, tuple)) and len(value) >= minimum, f"{name} must list at least {minimum} points.")
    return [vector(p, f"Each point of {name}", dimensions) for p in value]


def colour(value, name, default=None):
    """A colour written as #rrggbb, in sRGB, as Blender's linear RGBA."""
    if value is None:
        need(default is not None, f"{name} is required.")
        value = default
    text = value.strip().lstrip("#") if isinstance(value, str) else ""
    need(
        len(text) == 6 and all(c in "0123456789abcdefABCDEF" for c in text),
        f"{name} must be a colour written like #c0392b.",
    )

    def linear(byte):
        c = byte / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(linear(int(text[i : i + 2], 16)) for i in (0, 2, 4)) + (1.0,)
