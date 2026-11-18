"""
The library a script reaches as `zhiyin`, beside `bpy`: functions that act on the scene and then
say what they did, measured, in one line each. The script's answer lists those lines after what it
printed, so a script that prints nothing still says what its calls took and changed.
"""

import types

from . import (
    mesh_curves,
    mesh_edits,
    mesh_imprint,
    mesh_loops,
    mesh_nodes,
    mesh_panels,
    mesh_removal,
    mesh_retopo,
    picking,
    sculpting,
    shading,
    shape_measures,
    stylised,
    surface_quality,
)

# The modules whose functions scripts reach, each listing its own.
MODULES = (
    picking,
    mesh_loops,
    mesh_edits,
    mesh_removal,
    mesh_imprint,
    mesh_curves,
    mesh_nodes,
    mesh_panels,
    mesh_retopo,
    shading,
    shape_measures,
    surface_quality,
    stylised,
    sculpting,
)

# Every function a script may call, by the name it is called by.
FUNCTIONS = {function.__name__: function for module in MODULES for function in module.FUNCTIONS}


def namespace():
    """The `zhiyin` a script sees: its functions, and nothing of how they are kept."""
    module = types.ModuleType("zhiyin", "Zhiyin's 3D library: each call acts, then says what it did.")
    for name, function in FUNCTIONS.items():
        setattr(module, name, function)
    return module
