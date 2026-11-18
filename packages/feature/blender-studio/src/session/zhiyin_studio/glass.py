"""
Sheets of glass, which focus nothing: each is taken out of the way of the rays that carry light
to a surface, so a glazed room is lit as through an open hole.
"""

import functools

import bpy

from .finding import is_helper, scene

# A flat sheet of glass focuses nothing: what is behind a window pane is lit
# as through the open hole. Cycles stops direct light at any glass, which
# leaves a glazed room a third as bright and without its patch of sun, so a
# sheet is taken out of the way of the rays that carry light to a surface.
# Glass that is not a sheet bends light, and keeps the shadow Cycles gives it.
SHEET = "zhiyin_sheet"
SHEET_THIN = 0.05
SHEET_CLEAR = 0.9


def is_glass(material):
    if material is None or not material.use_nodes:
        return False
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    if shader is not None:
        through = shader.inputs["Transmission Weight"]
        return not through.is_linked and through.default_value >= SHEET_CLEAR
    return any(node.type == "BSDF_GLASS" for node in nodes)


def is_sheet_of_glass(obj):
    """Glass all through, flat, and far thinner than it is wide."""
    materials = [slot.material for slot in obj.material_slots]
    if obj.type != "MESH" or is_helper(obj) or not materials or not all(is_glass(m) for m in materials):
        return False
    thin, narrow, _ = sorted(obj.dimensions)
    return narrow > 0 and thin <= SHEET_THIN * narrow


def light_through_sheets():
    """Sets each sheet of glass to let light through, and says which ones are new."""
    bpy.context.view_layer.update()
    found = []
    for obj in scene().objects:
        sheet = is_sheet_of_glass(obj)
        if sheet == bool(obj.get(SHEET)):
            continue
        obj.visible_shadow = obj.visible_diffuse = not sheet
        if sheet:
            obj[SHEET] = True
            found.append(obj.name)
        else:
            del obj[SHEET]
    if not found:
        return ""
    one = len(found) == 1
    return (
        f"{' and '.join(found) if len(found) < 3 else ', '.join(found)} {'is a thin sheet' if one else 'are thin sheets'} of glass: "
        f"light goes through {'it' if one else 'them'} as through real glass, and {'it casts' if one else 'they cast'} no shadow."
    )


def lets_light_through_sheets(tool):
    """
    A tool that can give an object a material, change a material or change an
    object's size sets each sheet of glass after it, whatever it made or
    changed, and its answer says which sheets are new.
    """

    @functools.wraps(tool)
    def set_sheets(*args):
        said = tool(*args)
        sheets = light_through_sheets()
        return f"{said}\n{sheets}" if sheets else said

    return set_sheets
