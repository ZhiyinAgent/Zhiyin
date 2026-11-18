"""
Drivers that do not run here. Blender runs a driver's Python only when a
file may run its own scripts, which Zhiyin never lets it, so a driver whose
expression needs more than Blender works out itself holds its value at 0.
Blender marks each such driver invalid once it has tried it.
"""

import bpy

# Where drivers are kept: on objects, and on the data they use.
HOLDERS = ("objects", "meshes", "curves", "materials", "node_groups", "shape_keys", "cameras", "lights", "worlds", "scenes")
AXES = {"location", "rotation_euler", "scale", "delta_location", "delta_rotation_euler", "delta_scale"}
# Said as the scene's description says them, at most this many.
SAID = 8

SIMPLE = (
    "Write it as an expression Blender works out itself: numbers, frame and the driver's variables, + - * /,"
    " comparisons, and, or, not, a if b else c, and functions such as sin, cos, tan, sqrt, pow, fmod, floor, min,"
    " max, abs, clamp, lerp, radians and pi; or key the value instead."
)


def driven_text(holder, kind, curve):
    owner = f"{holder.name}'s" if kind == "objects" else f"{kind[:-1].replace('_', ' ')} {holder.name}'s"
    path = curve.data_path
    if path in AXES and 0 <= curve.array_index < 3:
        return f"{owner} {path.replace('_euler', '').replace('_', ' ')} {'xyz'[curve.array_index]}"
    return f"{owner} {path}[{curve.array_index}]" if curve.array_index else f"{owner} {path}"


def unrun_drivers():
    """Each driver that does not run here, as a sentence, with how to write it so it does."""
    tried = []
    for kind in HOLDERS:
        for holder in getattr(bpy.data, kind):
            animation = getattr(holder, "animation_data", None)
            for curve in animation.drivers if animation else []:
                driver = curve.driver
                if driver.type == "SCRIPTED" and not driver.is_simple_expression:
                    tried.append((holder, kind, curve))
    if not tried:
        return []
    # Blender marks a driver it could not run when it next works the scene out.
    bpy.context.view_layer.update()
    said = []
    for holder, kind, curve in tried:
        driver = curve.driver
        if driver.is_valid:
            continue
        try:
            compile(driver.expression, "driver", "eval")
            why = "which needs Python, and this Blender runs no Python in a driver"
        except SyntaxError:
            why = "which is not an expression Blender can read"
        said.append(f"{driven_text(holder, kind, curve)} is driven by {driver.expression}, {why}: it holds the value at 0.")
    if not said:
        return []
    more = len(said) - SAID
    return said[:SAID] + ([f"And {more} more drivers like these."] if more > 0 else []) + [SIMPLE]
