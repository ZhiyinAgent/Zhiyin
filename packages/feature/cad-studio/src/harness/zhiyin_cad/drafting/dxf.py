"""
A drawing as DXF, in millimetres: the whole sheet, each kind of line on its
own layer with its own line type, or one view of the part alone at full
size: through a straight or auxiliary view, its cutting profile, as a laser
or a router cuts it; of a section or a detail, its visible edges. Lines,
arcs and circles stay lines, arcs and circles.
"""

import ezdxf

from .sheet import LAYERS

LINE_TYPES = {
    "hidden": ("ZHIYIN_HIDDEN", "Hidden __ __ __", [4.0, 3.0, -1.0]),
    "centre": ("ZHIYIN_CENTRE", "Centre ____ . ____ .", [11.0, 8.0, -1.0, 1.0, -1.0]),
    "cutting": ("ZHIYIN_CENTRE", "Centre ____ . ____ .", [11.0, 8.0, -1.0, 1.0, -1.0]),
}
# DXF line weights are hundredths of a millimetre, from a fixed list.
WEIGHTS = [13, 18, 25, 35, 50, 70]


def _document():
    document = ezdxf.new("R2010")
    document.header["$INSUNITS"] = 4
    document.header["$MEASUREMENT"] = 1
    for name, description, pattern in {v[0]: v for v in LINE_TYPES.values()}.values():
        document.linetypes.add(name, pattern=pattern, description=description)
    for layer, style in LAYERS.items():
        weight = min(WEIGHTS, key=lambda w: abs(w - style["width"] * 100))
        attributes = {"color": 7, "lineweight": weight}
        if layer in LINE_TYPES:
            attributes["linetype"] = LINE_TYPES[layer][0]
        document.layers.add(layer.upper(), **attributes)
    return document


def sheet_dxf(sheet, path):
    document = _document()
    space = document.modelspace()
    for layer, points, closed in sheet.lines:
        space.add_lwpolyline(points, close=closed, dxfattribs={"layer": layer.upper()})
    for layer, cx, cy, radius, start, end in sheet.arcs:
        if (end - start) % 360 == 0:
            space.add_circle((cx, cy), radius, dxfattribs={"layer": layer.upper()})
        else:
            space.add_arc((cx, cy), radius, start, end, dxfattribs={"layer": layer.upper()})
    for layer, points in sheet.fills:
        corners = list(points) + [points[-1]] * (4 - len(points))
        # A SOLID's third and fourth corners go the other way round.
        space.add_solid([corners[0], corners[1], corners[3], corners[2]], dxfattribs={"layer": layer.upper()})
    document.saveas(path)


def view_dxf(view, path):
    """One view at full size, its visible edges only: a profile's are what cutting needs."""
    document = _document()
    space = document.modelspace()
    for layer, points in view.lines:
        if layer == "visible":
            space.add_lwpolyline(points, dxfattribs={"layer": "VISIBLE"})
    for layer, cx, cy, radius, start, end in view.arcs:
        if layer != "visible":
            continue
        if (end - start) % 360 == 0:
            space.add_circle((cx, cy), radius, dxfattribs={"layer": "VISIBLE"})
        else:
            space.add_arc((cx, cy), radius, start, end, dxfattribs={"layer": "VISIBLE"})
    document.saveas(path)
