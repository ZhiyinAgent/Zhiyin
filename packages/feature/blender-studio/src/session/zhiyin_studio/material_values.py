"""
The values a material holds, so a call naming one that exists changes only
the values it gives: those it was last set with, kept on the material, over
which its shader's own values are read where nothing drives them, as a
script may have changed them since.
"""

import json
import math
import os

from .arguments import colour
from .finishes import PLAIN
from .wording import hex_of

# The blackbody that colours a glow by its colour temperature.
KELVIN = "Zhiyin glow kelvin"

# Where a material keeps the values it was last set with, as JSON.
GIVEN = "zhiyin_material"

# Each value read back from the shader where nothing drives it, by its input.
INPUTS = {
    "metallic": "Metallic",
    "roughness": "Roughness",
    "specular": "Specular IOR Level",
    "transmission": "Transmission Weight",
    "ior": "IOR",
    "alpha": "Alpha",
    "coat": "Coat Weight",
    "coat_roughness": "Coat Roughness",
    "coat_ior": "Coat IOR",
    "diffuse_roughness": "Diffuse Roughness",
}
# Each colour read back from the shader where nothing drives it, by its input.
COLOURS = {"color": "Base Color", "coat_tint": "Coat Tint", "specular_tint": "Specular Tint"}
DISTRIBUTIONS = {"MULTI_GGX": "multiscatter-ggx", "GGX": "ggx"}
# Each draws a surface of its own, so a material takes one of them.
SURFACES = ("wood", "finish", "texture", "maps")
# Drawn only on an opaque surface, never with glass.
OPAQUE = ("finish", "wear", "grime", "rust")
# What a finish gives of its own unless the call gives it.
FINISH_GIVES = ("color", "metallic", "roughness", "coat")
# The finishes that let light through.
FINISHES_SEEN_THROUGH = ("frosted-glass",)

# Each value as the answer names it, in the order it says them, and what it is when never given.
LABELS = {
    "finish": "finish",
    "wood": "wood grain",
    "texture": "picture",
    "maps": "maps",
    "color": "colour",
    "metallic": "metallic",
    "roughness": "roughness",
    "specular": "specular",
    "specular_tint": "specular tint",
    "diffuse_roughness": "diffuse roughness",
    "distribution": "distribution",
    "coat": "coat",
    "coat_roughness": "coat roughness",
    "coat_ior": "coat ior",
    "coat_tint": "coat tint",
    "subsurface": "subsurface",
    "transmission": "transmission",
    "ior": "ior",
    "tint": "tint",
    "alpha": "opacity",
    "emission": "glow",
    "wear": "wear",
    "grime": "grime",
    "rust": "rust",
    "scratches": "scratches",
    "drips": "drip streaks",
    "dust": "dust",
    "fingerprints": "fingerprints",
    "brushing": "brushing",
    "normal_map": "surface detail",
    "height": "height",
}
DEFAULTS = {
    "color": PLAIN.colour,
    "metallic": PLAIN.metallic,
    "roughness": PLAIN.roughness,
    "coat": PLAIN.coat,
    "specular": 0.5,
    "coat_roughness": 0.03,
    "coat_ior": 1.5,
    "coat_tint": "#ffffff",
    "specular_tint": "#ffffff",
    "diffuse_roughness": 0,
    "distribution": "multiscatter-ggx",
    "transmission": 0,
    "ior": 1.5,
    "alpha": 1,
    "wood": 0,
    "wear": 0,
    "grime": 0,
    "rust": 0,
    "scratches": 0,
    "drips": 0,
    "dust": 0,
    "fingerprints": 0,
}


def shader_of(material):
    if not material.use_nodes or material.node_tree is None:
        return None
    return next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def kept_values(material):
    """The values a material holds now, as a call gives them."""
    try:
        values = json.loads(material.get(GIVEN, "{}"))
    except (TypeError, ValueError):
        values = {}
    shader = shader_of(material)
    if shader is None:
        return values
    inputs = shader.inputs
    for key, name in INPUTS.items():
        if not inputs[name].is_linked:
            values[key] = round(float(inputs[name].default_value), 6)
    for key, name in COLOURS.items():
        if not inputs[name].is_linked:
            values[key] = hex_of(inputs[name].default_value)
    values["distribution"] = DISTRIBUTIONS.get(shader.distribution, "multiscatter-ggx")
    strength = inputs["Emission Strength"]
    if not strength.is_linked:
        if strength.default_value > 0:
            glow = {"strength": round(float(strength.default_value), 6)}
            if not inputs["Emission Color"].is_linked:
                glow["color"] = hex_of(inputs["Emission Color"].default_value)
            body = material.node_tree.nodes.get(KELVIN)
            if body is not None:
                tinted = inputs["Emission Color"].links[0].from_node if inputs["Emission Color"].is_linked else None
                own = next((s for s in tinted.inputs if s.identifier == "A_Color"), None) if tinted is not None else None
                if own is not None:
                    glow["color"] = hex_of(own.default_value)
                glow["kelvin"] = round(float(body.inputs["Temperature"].default_value), 6)
            if material.cycles.emission_sampling == "NONE":
                glow["lights_scene"] = False
            values["emission"] = glow
        else:
            values.pop("emission", None)
    return values


def is_own(material):
    """Whether a material was made by other means than this tool, with shader nodes of its own it would lose rebuilt."""
    if GIVEN in material:
        return False
    nodes = material.node_tree.nodes if material.use_nodes and material.node_tree else []
    return shader_of(material) is None or any(n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL") for n in nodes)


def patched(kept, given):
    """The values kept with those given over them, a value given replacing a kept one it cannot stand with."""
    values = dict(kept)
    for key, value in given.items():
        if key in SURFACES:
            for other in SURFACES:
                values.pop(other, None)
        if key in OPAQUE and value:
            values.pop("transmission", None)
        if key == "transmission" and value:
            for other in OPAQUE:
                # A finish that lets light through, as frosted glass does, stands with it.
                if not (other == "finish" and values.get("finish") in FINISHES_SEEN_THROUGH):
                    values.pop(other, None)
        if key == "transmission" and not value:
            # A tint colours only what passes through.
            values.pop("tint", None)
        if key == "finish":
            # A finish brings its own colour, metal, roughness and coat; a brushing is the old finish's.
            for other in (*FINISH_GIVES, "brushing"):
                values.pop(other, None)
    values.update(given)
    return values


def said(key, value, values):
    if value is None:
        if key in FINISH_GIVES and values.get("finish"):
            return f"{values['finish']}'s own"
        return "none"
    if key in ("texture", "normal_map"):
        if not isinstance(value, dict):
            return str(value)
        named = os.path.basename(str(value.get("path", "")))
        return f"{named}, read as DirectX" if value.get("convention") == "directx" else named
    if isinstance(value, dict) and key in DESCRIBED:
        return DESCRIBED[key](value)
    if key == "emission" and isinstance(value, dict):
        glow = said("color", value.get("color", "#ffffff"), values) if value.get("color") or not values.get("texture") else "its picture"
        kelvin = f" at {value['kelvin']:g} K" if value.get("kelvin") else ""
        unsampled = ", not sampled as a light" if value.get("lights_scene") is False else ""
        return f"{glow}{kelvin} at {value.get('strength', 1):g}{unsampled}"
    if key in COLOURS and isinstance(value, str):
        try:
            return hex_of(colour(value, "color"))
        except Exception:
            return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:g}"
    return str(value)


def _maps(value):
    named = [os.path.basename(str(value[k])) for k in sorted(value) if k in MAP_KINDS and value[k]]
    if value.get("folder"):
        named.insert(0, f"the set in {value['folder']}")
    return ", ".join(named) or "none"


def _height(value):
    source = os.path.basename(str(value["path"])) if value.get("path") else (value.get("pattern") or {}).get("kind", "its maps'")
    depth = value.get("depth")
    return f"{source} {depth * 1000:g} mm by {value.get('method', 'bump')}" if isinstance(depth, (int, float)) else str(source)


def _tint(value):
    depth = value.get("depth")
    return f"{value.get('color')} at {depth * 1000:g} mm" if isinstance(depth, (int, float)) else str(value.get("color"))


def _brushing(value):
    pattern, axis = value.get("pattern", "linear"), value.get("axis")
    if not axis:
        return pattern
    return f"{pattern} {'along' if pattern == 'linear' else 'round' if pattern == 'circular' else 'out from'} {axis}"


def _subsurface(value):
    reach = value.get("radius_mm")
    words = [value.get("preset") or "own"]
    if reach:
        words.append("reaching " + ", ".join(f"{r:g}" for r in reach) + " mm")
    if value.get("scale") is not None:
        words.append(f"scale {value['scale']:g}")
    return " ".join(words)


MAP_KINDS = ("color", "roughness", "metallic", "normal", "height", "ao", "opacity", "orm")
# How the values given as several parts are said, each in a few words.
DESCRIBED = {"maps": _maps, "height": _height, "tint": _tint, "subsurface": _subsurface, "brushing": _brushing}


def changes(kept, values):
    """What changed between the values kept and those set now, each from what it was to what it is."""
    found = []
    for key, label in LABELS.items():
        before = kept.get(key, DEFAULTS.get(key) if not (key in FINISH_GIVES and kept.get("finish")) else None)
        after = values.get(key, DEFAULTS.get(key) if not (key in FINISH_GIVES and values.get("finish")) else None)
        was, now = said(key, before, kept), said(key, after, values)
        if isinstance(before, float) and isinstance(after, (int, float)) and math.isclose(before, after, abs_tol=1e-6):
            continue
        if was != now:
            found.append(f"{label} {was} to {now}")
    return found
