"""
Where a material's pictures are read on a shape: by the shape's layout or by a projection,
repeated a number of times or at a real size in metres, and how large each of a picture's
pixels then lies on each object. Each kind of picture is read as its kind needs: colours in
sRGB and data as numbers, relief between its pixels smoothly, so a bump shows no steps.
"""

import statistics
from typing import NamedTuple

import bpy

from .arguments import need, number, vector
from .finishes import Graph, metres
from .uv_checks import layout_per_metre, unfit_layout
from .wording import length, one_of

PROJECTIONS = {"uv": None, "box": "BOX", "cylinder": "TUBE", "sphere": "SPHERE", "front": "FLAT"}
# Pictures whose values are data, not colour: read as numbers, never through sRGB.
DATA = {"roughness", "metallic", "normal", "height", "ao", "opacity", "orm"}
# How each kind is read between its pixels; any other is read linearly.
BETWEEN = {"height": "Cubic"}


def refuse_unlaid(targets):
    """Refuses a picture laid by layout on meshes whose layout cannot take one: a ring's none, lettering's and an outline's broken."""
    unlaid = [o.name for o in targets if o.type == "MESH" and unfit_layout(o)]
    need(
        not unlaid,
        f"{', '.join(unlaid)} has no layout that fits a uv picture, which would show stretched, mirrored or as one colour; "
        "use cylinder, box, sphere or front.",
    )


class Laid(NamedTuple):
    """Where pictures are read: the socket giving each point's place in them, the projection, and the metres one repeat spans on each object."""

    vector: object
    projection: str
    spans: dict


def placement(material, spec, targets, name):
    """
    The place on each point of the shape that a picture is read at, from a call's projection,
    repeat and real size. A size lays one repeat over that many metres of each object.
    """
    projection = spec.get("projection", "uv")
    need(projection in PROJECTIONS, f"{name} projection is {one_of(PROJECTIONS)}.")
    size = spec.get("size")
    if size is not None:
        size = number(size, f"{name} size", minimum=0)
        need(size > 0, f"{name} size must be greater than 0: the metres one repeat of the picture covers.")
        need(spec.get("repeat") is None, f"{name} gives a size in metres or a repeat count, not both.")
        need(
            projection not in ("cylinder", "sphere"),
            f"a {projection} projection wraps a picture round the object a whole number of times: give {name} a repeat, "
            "or a size with uv, box or front.",
        )
    repeat = vector(spec.get("repeat"), f"{name} repeat", 2, default=(1, 1))
    if projection == "uv":
        refuse_unlaid(targets)
    graph = Graph(material)
    coordinates = lambda: graph.node("ShaderNodeTexCoord")
    if size is not None and projection == "uv":
        # The layout's own scale on these objects, so one repeat covers `size` metres of them.
        found = {o.name: layout_per_metre(o) for o in targets if o.type == "MESH"}
        typical = statistics.median([v for v in found.values() if v] or [1.0])
        repeat = (1 / (typical * size),) * 2
        spans = {n: (size * typical / v if v else None) for n, v in found.items()}
        place = coordinates().outputs["UV"]
    elif size is not None:
        at = graph.vector("SCALE", metres(graph), 1 / size)
        place = graph.join(*[graph.parts(at)[i] for i in ((0, 2, 1) if projection == "front" else (0, 1, 2))])
        spans = {o.name: size for o in targets}
        repeat = (1, 1)
    elif projection == "uv":
        place = coordinates().outputs["UV"]
        spans = {o.name: _uv_span(o, repeat[0]) for o in targets}
    elif projection == "front":
        # Seen from the front: across is x and up is z, not the y a flat
        # projection reads, which would show it from above.
        x, _, z = graph.parts(coordinates().outputs["Generated"])
        place = graph.join(x, z, 0)
        spans = {o.name: o.dimensions.x / repeat[0] for o in targets}
    else:
        place = coordinates().outputs["Generated"]
        spans = {o.name: max(o.dimensions) / repeat[0] for o in targets}
    mapping = graph.node("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (repeat[0], repeat[1], 1)
    graph.links.new(place, mapping.inputs["Vector"])
    return Laid(mapping.outputs["Vector"], projection, spans)


def _uv_span(obj, repeat):
    found = layout_per_metre(obj) if obj.type == "MESH" else None
    return 1 / (found * repeat) if found else None


def alpha_kept_apart(image):
    """
    Reads a picture's colour whole where it is partly transparent. With straight alpha, Blender 5.2
    darkens an 8-bit picture's colour by its alpha in Cycles and EEVEE alike, which shows as a dark
    fringe or a darker colour wherever the colour is used beside the alpha or without it; packed as
    channels, colour and alpha are each read as the file holds them. A float picture, which keeps
    its colour multiplied by its alpha, is left as it is.
    """
    if not image.is_float and image.alpha_mode == "STRAIGHT":
        image.alpha_mode = "CHANNEL_PACKED"


def picture(material, path, laid, kind="color"):
    """A picture node reading the file where `laid` places it, read as its kind needs."""
    image = bpy.data.images.load(path, check_existing=True)
    if bpy.data.filepath:
        image.filepath = bpy.path.relpath(path)
    alpha_kept_apart(image)
    if kind in DATA:
        image.colorspace_settings.name = "Non-Color"
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = BETWEEN.get(kind, "Linear")
    node.extension = "REPEAT"
    if laid.projection == "front":
        node.projection = "FLAT"
    elif laid.projection != "uv":
        node.projection = PROJECTIONS[laid.projection]
        if laid.projection == "box":
            node.projection_blend = 0.2
    material.node_tree.links.new(laid.vector, node.inputs["Vector"])
    return node


def pixels_text(image, laid):
    """A picture's size in pixels and how large one of its pixels lies on each object."""
    width, height = image.size[0], image.size[1]
    on = []
    for name, span in laid.spans.items():
        if span and width:
            on.append(f"{length(span / width)} a pixel on {name}")
        else:
            on.append(f"no measure on {name}")
    return f"{width} × {height} px, {', '.join(on)}"
