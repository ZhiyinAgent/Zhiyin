"""
How smooth a surface reads: reflection lines drawn on it from a few views, and where the
curvature jumps between neighbouring faces.

The lines are a striped light the surface reflects, bands across one axis of the world, drawn by
a material in place of every surface's own; a look draws them from its four views. A surface that
flows smoothly bends its bands smoothly, and a kink or a jump in its curvature kinks or breaks
them. The jump is measured on the surface as it shows, its steps applied: of the edges it shades
smooth across, how far their two faces turn from each other, the most and where, beside what most
of its edges turn.
"""

import math

import bpy
import numpy

from .arguments import need
from .finding import PREVIEW
from .geometry import evaluated_graph
from .mesh_checks import Mesh, edge_faces, loop_faces_of
from .picking import mesh_object
from .reports import report
from .soundness import MOST_FACES
from .wording import point_text

AXES = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}
# How many light and dark bands the striped light has, from one side round to the other.
BANDS = 9
LIGHT, DARK = (0.95, 0.95, 0.95, 1), (0.04, 0.04, 0.05, 1)
# How many places the largest turns are said at, and how far apart, as a share of the shape's size.
PLACES, APART = 3, 0.1


def stripe_material(axis):
    """A material that glows in light and dark bands by where its reflections point across `axis` of the world."""
    material = bpy.data.materials.new(PREVIEW)
    material.use_nodes = True
    tree = material.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    coordinates = tree.nodes.new("ShaderNodeTexCoord")
    across = tree.nodes.new("ShaderNodeVectorMath")
    across.operation = "DOT_PRODUCT"
    across.inputs[1].default_value = AXES[axis]
    tree.links.new(coordinates.outputs["Reflection"], across.inputs[0])
    spread = tree.nodes.new("ShaderNodeMath")
    spread.operation = "MULTIPLY"
    spread.inputs[1].default_value = BANDS * math.pi
    tree.links.new(across.outputs["Value"], spread.inputs[0])
    wave = tree.nodes.new("ShaderNodeMath")
    wave.operation = "SINE"
    tree.links.new(spread.outputs["Value"], wave.inputs[0])
    band = tree.nodes.new("ShaderNodeMath")
    band.operation = "GREATER_THAN"
    band.inputs[1].default_value = 0
    tree.links.new(wave.outputs["Value"], band.inputs[0])
    colour = tree.nodes.new("ShaderNodeMix")
    colour.data_type = "RGBA"
    colour.inputs["A"].default_value = DARK
    colour.inputs["B"].default_value = LIGHT
    tree.links.new(band.outputs["Value"], colour.inputs["Factor"])
    glow = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(colour.outputs["Result"], glow.inputs["Color"])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(glow.outputs["Emission"], output.inputs["Surface"])
    return material


def bends(obj):
    """
    How far neighbouring faces of the surface turn from each other across the edges it is shaded
    smooth across, in degrees: the most, the places most, and what 95% of them turn within.
    None when it shades smooth across no edge, or has more faces than are measured.
    """
    mesh = Mesh(obj)
    if not len(mesh.sides) or len(mesh.sides) > MOST_FACES:
        return None
    shared, a, b = edge_faces(mesh, loop_faces_of(mesh))
    smooth = ~mesh.sharp_edges[shared] & ~mesh.flat_faces[a] & ~mesh.flat_faces[b] & (a != b)
    shared, a, b = shared[smooth], a[smooth], b[smooth]
    if not len(shared):
        return None
    one, other = mesh.facing[a], mesh.facing[b]
    lengths = numpy.linalg.norm(one, axis=1) * numpy.linalg.norm(other, axis=1)
    cosines = numpy.einsum("ij,ij->i", one, other) / numpy.where(lengths > 0, lengths, 1)
    turns = numpy.where(lengths > 0, numpy.degrees(numpy.arccos(numpy.clip(cosines, -1, 1))), 0.0)
    middles = mesh.points[mesh.edges[shared]].mean(axis=1)
    places = []
    for index in numpy.argsort(-turns):
        if len(places) == PLACES or turns[index] <= 0:
            break
        if all(numpy.linalg.norm(middles[index] - middles[k]) > APART * mesh.size for k in places):
            places.append(int(index))
    return {
        "most": float(turns.max()),
        "at": [tuple(middles[k]) for k in places],
        "within_95": float(numpy.percentile(turns, 95)),
        "edges": len(shared),
    }


def bends_words(found):
    """A shape's bends between neighbouring faces in words."""
    if found is None:
        return "it shades smooth across no edge, so no curvature is measured"
    at = ", ".join(point_text(p) for p in found["at"])
    return (
        f"across the {found['edges']:,} edges it shades smooth across, neighbouring faces turn up to {found['most']:.1f}°"
        f" from each other, most at {at}; 95% of them turn {found['within_95']:.1f}° or less"
    )


def reflection_lines(obj, direction="z"):
    """
    Where a surface's curvature jumps, as its reflection lines show: across the edges it shades
    smooth across, how far neighbouring faces turn from each other, the most and the places most,
    beside what 95% of them turn. Says it, with the look that draws the lines in bands across
    `direction`, and returns the measures, in degrees and the world's metres.
    """
    obj = mesh_object(obj, "reflection_lines")
    need(direction in AXES, "direction is x, y or z: the axis of the world the light's bands lie across.")
    bpy.context.view_layer.update()
    found = bends(obj)
    if found is None and len(obj.evaluated_get(evaluated_graph()).data.polygons) > MOST_FACES:
        report(f"Reflection lines on {obj.name}: its faces are more than the {MOST_FACES:,} measured.")
        return None
    report(
        f"Reflection lines on {obj.name}: {bends_words(found)}. blender_look with shading reflections and stripes"
        f" {direction} draws its reflections of a light banded across {direction} from four sides, where a kink"
        " or break in the bands marks a jump."
    )
    return found


FUNCTIONS = (reflection_lines,)
