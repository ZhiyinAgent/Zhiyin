"""
Height: relief from a picture or a pattern, at a depth in metres, drawn as bump, which the
light shows and the outline does not, or by moving the surface, or both. The answer sets the
mesh's edges, or the dicing an adaptive subdivision renders it at, against the size of the
height's detail, since moving points shows only detail wider than the edges between them, and
says how far displacing grows the object's box.
"""

import bpy
import numpy

from .arguments import need, number
from .finishes import Graph, metres
from .geometry import evaluated_graph
from .material_pictures import picture, placement
from .wording import length, one_of, size_text

METHODS = {"bump": "BUMP", "displace": "DISPLACEMENT", "both": "BOTH"}
PATTERNS = {"noise": "an uneven noise", "cells": "a pattern of dimpled cells"}


def height_of(values, from_maps):
    """The height asked for, or None; refused when it gives both a picture and a pattern, or neither and no map gives one."""
    spec = values.get("height")
    if spec is None:
        return None
    need(isinstance(spec, dict), "height gives a picture or a pattern, a depth and a method.")
    path, pattern = spec.get("path"), spec.get("pattern")
    need(not (path and pattern), "height is drawn from a picture or from a pattern: give its path or its pattern, not both.")
    need(
        path or pattern or from_maps,
        "height needs a path to a height picture or a pattern, unless maps gives a height map.",
    )
    need(not (path and from_maps), "maps gives a height map already: leave height's path out, or the map out of maps.")
    depth = number(spec.get("depth"), "height depth", minimum=0)
    need(depth > 0, "height depth must be greater than 0: how far in metres its highest point rises.")
    method = spec.get("method", "bump")
    need(method in METHODS, f"height method is {one_of(METHODS)}.")
    return spec


def reset(material):
    """A material with no height is drawn by bump alone, as Blender's own are."""
    material.displacement_method = "BUMP"
    material.max_vertex_displacement = 0


def draw_height(material, spec, targets, from_maps, maps_laid):
    """Draws the height into the material's displacement; the answer's sentence on it."""
    graph = Graph(material)
    depth, method = float(spec["depth"]), spec.get("method", "bump")
    pattern = spec.get("pattern")
    if pattern is not None:
        need(isinstance(pattern, dict), "height pattern gives a kind and a size in metres.")
        kind = pattern.get("kind")
        need(kind in PATTERNS, f"height pattern kind is {one_of(PATTERNS)}.")
        size = number(pattern.get("size"), "height pattern size", minimum=0)
        need(size > 0, "height pattern size must be greater than 0: how wide its features are, in metres.")
        at = metres(graph)
        rise = graph.noise(at, size, detail=3) if kind == "noise" else graph.cells(at, size)
        features = dict.fromkeys((o.name for o in targets), size)
        what = f"{PATTERNS[kind]} {length(size)} across"
    else:
        path = spec.get("path") or from_maps
        laid = maps_laid if spec.get("path") is None and maps_laid is not None else placement(material, spec, targets, "height")
        node = picture(material, path, laid, "height")
        rise = node.outputs["Color"]
        width = node.image.size[0]
        features = {name: (span / width if span and width else None) for name, span in laid.spans.items()}
        what = f"the picture {bpy_name(node)}, whose pixels are its finest detail"
    displace = graph.node("ShaderNodeDisplacement", space="WORLD")
    displace.inputs["Midlevel"].default_value = 0
    displace.inputs["Scale"].default_value = depth
    graph.into(displace.inputs["Height"], rise)
    output = next(n for n in material.node_tree.nodes if n.type == "OUTPUT_MATERIAL")
    graph.links.new(displace.outputs["Displacement"], output.inputs["Displacement"])
    material.displacement_method = METHODS[method]
    material.max_vertex_displacement = depth if method != "bump" else 0
    lines = [f"Its height is {what}, rising up to {length(depth)}"]
    if method == "bump":
        lines[0] += ", drawn as bump: the light shows it, the outline does not."
        return " ".join(lines)
    lines[0] += f", drawn by moving the surface{' with bump for what is finer' if method == 'both' else ''}."
    for obj in targets:
        lines.append(detail_text(obj, features.get(obj.name)))
        grown = grown_text(obj, depth)
        if grown:
            lines.append(grown)
    return " ".join(lines)


def bpy_name(node):
    return bpy.path.basename(node.image.filepath) or node.image.name


def adaptive(obj):
    """The adaptive subdivision step an object is diced by at render, or None."""
    return next(
        (m for m in obj.modifiers if m.type == "SUBSURF" and m.show_render and getattr(m, "use_adaptive_subdivision", False)),
        None,
    )


def detail_text(obj, feature):
    """How finely an object's surface can move against the detail's size."""
    step = adaptive(obj)
    if step is not None:
        if step.adaptive_space == "OBJECT":
            edge = step.adaptive_object_edge_length
            return _against(obj.name, f"is diced at render to edges of {length(edge)}", edge, feature)
        return (
            f"{obj.name} is diced at render to about {step.adaptive_pixel_size:g} px in the picture, so detail that"
            " shows smaller than that there stays bump."
        )
    edge = median_edge(obj)
    if edge is None:
        return f"{obj.name} has no edges to move."
    return _against(obj.name, f"has edges of about {length(edge)}", edge, feature)


def _against(name, has, edge, feature):
    if feature is None:
        return f"{name} {has}; the detail's size on it could not be measured."
    if edge <= feature / 2:
        return f"{name} {has}, at most half the detail's {length(feature)}, so the detail shows in its outline."
    if edge <= feature:
        return (
            f"{name} {has}, {edge / feature:.3g} times the detail's {length(feature)}, so moving its points blurs the"
            f" finest of the detail: subdivide it to edges of {length(feature / 2)} or less to show it all."
        )
    return (
        f"{name} {has}, {edge / feature:.3g} times the detail's {length(feature)}, so moving its points shows little"
        f" of the detail: subdivide it to edges of {length(feature / 2)} or less, or draw the height as bump."
    )


def _world_mesh(obj):
    evaluated = obj.evaluated_get(evaluated_graph())
    mesh = evaluated.to_mesh()
    try:
        count = len(mesh.vertices)
        co = numpy.empty(count * 3)
        mesh.vertices.foreach_get("co", co)
        normals = numpy.empty(count * 3)
        mesh.vertices.foreach_get("normal", normals)
        edges = numpy.empty(len(mesh.edges) * 2, dtype=numpy.int64)
        mesh.edges.foreach_get("vertices", edges)
    finally:
        evaluated.to_mesh_clear()
    matrix = numpy.array(obj.matrix_world)
    world = co.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
    turn = numpy.linalg.inv(matrix[:3, :3]).T
    facing = normals.reshape(-1, 3) @ turn.T
    lengths = numpy.linalg.norm(facing, axis=1)
    facing = facing / numpy.maximum(lengths, 1e-12)[:, None]
    return world, facing, edges.reshape(-1, 2)


def median_edge(obj):
    """The median length of an object's edges in the world, as it is evaluated; None with none."""
    if obj.type != "MESH":
        return None
    world, _, edges = _world_mesh(obj)
    if not len(edges):
        return None
    return float(numpy.median(numpy.linalg.norm(world[edges[:, 0]] - world[edges[:, 1]], axis=1)))


def grown_text(obj, depth):
    """How far the object's box grows with its points moved out by the whole depth along their normals."""
    if obj.type != "MESH":
        return ""
    world, facing, _ = _world_mesh(obj)
    if not len(world):
        return ""
    moved = numpy.concatenate([world, world + facing * depth])
    before = world.max(axis=0) - world.min(axis=0)
    after = moved.max(axis=0) - moved.min(axis=0)
    return f"Displaced, {obj.name}'s box grows to at most {size_text(after)}, from {size_text(before)}."
