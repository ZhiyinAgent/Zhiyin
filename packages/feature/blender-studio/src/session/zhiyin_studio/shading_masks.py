"""
Masks by the shape, in metres: 0 to 1 over a material's surface, where its
edges, recesses, up-facing faces, thin parts, points or loose parts are, or
how it turns from the view. Each says which engines show it and, measured on
the faces that wear the material, where it lands: edge lengths in metres,
areas, thickness by rays cast through the shape, and occlusion by rays cast
from it into the scene, as Cycles casts them.
"""

import math

import mathutils
import mathutils.bvhtree

from .arguments import need, number
from .describe import shapes_in_scene
from .finishes import Graph
from .mesh_math import joined_points
from .reports import report
from .shading_common import material_of, on_each, owned, share_text
from .shading_graph import CYCLES_ONLY
from .shown_mesh import on_surface
from .wording import area_text, length, one_of

# Each mask's options and what they are when not given.
OPTIONS = {
    "edges": {"reach": 0.002},
    "cavity": {"reach": 0.02},
    "occlusion": {"reach": 0.1},
    "up": {"within": 45},
    "thickness": {"below": 0.005},
    "pointiness": {"spread": 0.05},
    "layer_weight": {"blend": 0.5},
    "fresnel": {"ior": 1.5},
    "island_random": {},
}
# How closed in the shape is, by Blender's ambient occlusion, along an edge
# rounded about as wide as the reach, from inside, and deep in a corner from
# outside, as the finishes' wear and grime find them: a mask is 1 from there.
EDGE, RECESS = 0.2, 0.35
# An edge sharper than this between its faces is an edge the masks count.
SHARP = math.radians(30)
# How many faces a measure casts rays from, and how many rays occlusion casts from each.
FACES = 2000
RAYS = 16
# How far a mask that turns with the faces fades, in degrees either side.
FADE = 5
OCCLUDED_ENGINES = "Cycles, and EEVEE only where the camera sees"
BOTH = "Cycles and EEVEE"
VIEW = " It follows the view, so it is not measured on the shape."


def options_of(kind, given):
    need(kind in OPTIONS, f"A mask is one of {one_of(OPTIONS)}.")
    takes = OPTIONS[kind]
    for name in given:
        if name not in takes:
            need(False, f"A mask of {kind} takes {one_of(takes) if takes else 'no options'}; {name} is not one of its options.")
    return {name: given.get(name, default) for name, default in takes.items()}


def sampled(worn):
    """Faces to measure from, at most FACES of them spread over the mesh, each standing for its area."""
    faces = worn.faces
    step = max(1, len(faces) // FACES)
    return faces[::step]


def hemisphere(normal):
    """RAYS directions spread over the side a face looks to, as many toward each part of it as light falling on it."""
    normal = mathutils.Vector(normal).normalized()
    side = normal.orthogonal().normalized()
    other = normal.cross(side)
    golden = math.pi * (3 - math.sqrt(5))
    found = []
    for i in range(RAYS):
        u = (i + 0.5) / RAYS
        r, phi = math.sqrt(u), i * golden
        found.append(side * (r * math.cos(phi)) + other * (r * math.sin(phi)) + normal * math.sqrt(1 - u))
    return found


def edge_length(worn, convex):
    """How long the edges between faces wearing the material are, sharper than SHARP, convex or concave."""
    worn_faces = set(worn.faces)
    total = 0.0
    for edge in worn.mesh.edges:
        if len(edge.link_faces) != 2 or not all(f in worn_faces for f in edge.link_faces):
            continue
        angle = edge.calc_face_angle_signed(0.0)
        if (angle > SHARP) if convex else (angle < -SHARP):
            total += edge.calc_length()
    return total


def along_edges(worn, reach, convex):
    total = edge_length(worn, convex)
    kind = "convex" if convex else "concave"
    if total <= 0:
        return f"no {kind} edges, so nothing" if convex else "no concave edges, so only where other objects come near"
    share = min(1.0, 2 * reach * total / worn.area) if worn.area else 0
    return f"{length(total)} of {kind} edges, about {share_text(share)} of its {area_text(worn.area)}"


def facing_up(worn, within):
    least = math.cos(math.radians(within))
    area = sum(f.calc_area() for f in worn.faces if f.normal.z >= least - 1e-9)
    if area <= 0:
        return f"no face turned within {within:g}° of up"
    return f"{area_text(area)}, {share_text(area / worn.area)} of its {area_text(worn.area)}"


def through(worn, below):
    """How thick the shape is under each face, by a ray cast from it straight into the shape to its other side."""
    tree = mathutils.bvhtree.BVHTree.FromBMesh(worn.mesh)
    thinnest, thin, total = None, 0.0, 0.0
    for face in sampled(worn):
        inward = -face.normal
        hit = tree.ray_cast(on_surface(tree, face) + inward * 1e-6, inward)
        if hit[0] is None:
            continue
        across = hit[3] + 1e-6
        area = face.calc_area()
        total += area
        thinnest = across if thinnest is None else min(thinnest, across)
        if across < below:
            thin += area
    if thinnest is None:
        return "open, with no other side to measure through"
    share = thin / total if total else 0
    rest = f"{share_text(share)} of its surface thinner than {length(below)}" if thin else f"none of it thinner than {length(below)}"
    return f"{length(thinnest)} at its thinnest, {rest}"


def closed_in(worn, reach):
    """How closed in each face is by the scene within the reach: the share of rays from it that meet a shape."""
    tree, _ = shapes_in_scene()
    if tree is None:
        return "nothing closes it in"
    weighted, over_half, total = 0.0, 0.0, 0.0
    for face in sampled(worn):
        # On the surface the rays meet, which may split a bent face along its other diagonal.
        start = on_surface(tree, face) + face.normal * 1e-5
        hits = sum(1 for way in hemisphere(face.normal) if tree.ray_cast(start, way, reach)[0] is not None)
        area = face.calc_area()
        total += area
        weighted += area * hits / RAYS
        if hits / RAYS > 0.5:
            over_half += area
    if not weighted:
        return f"nothing closes it in within {length(reach)}"
    return f"{weighted / total:.2g} on average, more than half closed in over {share_text(over_half / total)} of its surface"


def points_apart(worn):
    edges = list(worn.mesh.edges)
    apart = sum(e.calc_length() for e in edges) / len(edges) if edges else 0
    return f"{len(worn.mesh.verts)} points, {length(apart)} apart on average, so it changes only from point to point"


def loose_parts(worn):
    """How many loose parts the shape has: groups of faces joined to nothing else."""
    bm = worn.mesh
    bm.verts.index_update()
    parts = len(joined_points(len(bm.verts), [(e.verts[0].index, e.verts[1].index) for e in bm.edges]))
    return f"{parts} loose part" + ("s" if parts != 1 else ", so one value")


def occlusion(graph, reach, inside):
    node = graph.node("ShaderNodeAmbientOcclusion", inside=inside)
    node.inputs["Distance"].default_value = reach
    return graph.math("SUBTRACT", 1, node.outputs["AO"], clamp=True)


def mask(material, kind, **options):
    """A mask by the shape, 0 to 1, as a socket to mix, remap or feed; one line of where it lands."""
    material = material_of(material, "zhiyin.mask")
    given = options_of(kind, options)
    graph = Graph(material)
    name = material.name
    if kind in ("edges", "cavity", "occlusion"):
        reach = number(given["reach"], "reach", minimum=1e-5, maximum=10)
        closed = occlusion(graph, reach, inside=kind == "edges")
        if kind == "edges":
            made = owned(graph.math("DIVIDE", closed, EDGE, clamp=True), f"Edges {length(reach)}")
            words = f"1 within about {length(reach)} of convex edges, by occlusion from inside the shape; {OCCLUDED_ENGINES}."
            measured = on_each(material, lambda worn: along_edges(worn, reach, convex=True))
        elif kind == "cavity":
            made = owned(graph.math("DIVIDE", closed, RECESS, clamp=True), f"Cavity {length(reach)}")
            words = (
                f"1 where the shape closes in within about {length(reach)}, by occlusion from outside, other objects included;"
                f" {OCCLUDED_ENGINES}."
            )
            measured = on_each(material, lambda worn: along_edges(worn, reach, convex=False))
        else:
            made = owned(closed, f"Occlusion {length(reach)}")
            words = f"1 where the shape is closed in within {length(reach)}, by occlusion from outside, other objects included; {OCCLUDED_ENGINES}."
            measured = on_each(material, lambda worn: closed_in(worn, reach))
    elif kind == "up":
        within = number(given["within"], "within", minimum=0, maximum=180)
        facing = graph.parts(graph.node("ShaderNodeNewGeometry").outputs["Normal"])[2]
        low = math.cos(math.radians(min(180, within + FADE)))
        high = math.cos(math.radians(max(0, within - FADE)))
        made = owned(graph.step(facing, low, max(high, low + 1e-4)), f"Up within {within:g}°")
        words = f"1 on faces turned within {within:g}° of up, +z in the world, fading over {2 * FADE}°; {BOTH}."
        measured = on_each(material, lambda worn: facing_up(worn, within))
    elif kind == "thickness":
        below = number(given["below"], "below", minimum=1e-5, maximum=10)
        eevee = "which does not see through the shape, so it stays near 0"
        made = owned(occlusion(graph, below, inside=True), f"Thinner than {length(below)}", eevee)
        words = f"rising to 1 where the shape is thinner than {length(below)}, by occlusion from inside it; Cycles only: EEVEE does not see through the shape, so it stays near 0."
        measured = on_each(material, lambda worn: through(worn, below))
    elif kind == "pointiness":
        spread = number(given["spread"], "spread", minimum=1e-3, maximum=0.5)
        point = graph.node("ShaderNodeNewGeometry").outputs["Pointiness"]
        made = owned(graph.step(point, 0.5, 0.5 + spread), "Pointiness")
        words = "1 on convex points, 0 on flat and hollow ones, from the mesh's own points; Cycles only: EEVEE gives every point 0.5, so it stays 0."
        measured = on_each(material, points_apart)
    elif kind == "layer_weight":
        blend = number(given["blend"], "blend", minimum=0, maximum=1)
        node = graph.node("ShaderNodeLayerWeight")
        node.inputs["Blend"].default_value = blend
        made = owned(node.outputs["Facing"], f"Layer weight {blend:g}")
        words = f"0 where a surface faces the camera to 1 where it turns side-on, at blend {blend:g}; {BOTH}.{VIEW}"
        measured = ""
    elif kind == "fresnel":
        ior = number(given["ior"], "ior", minimum=1, maximum=4)
        node = graph.node("ShaderNodeFresnel")
        node.inputs["IOR"].default_value = ior
        made = owned(node.outputs["Fac"], f"Fresnel {ior:g}")
        facing = ((ior - 1) / (ior + 1)) ** 2
        words = f"the light a surface of ior {ior:g} reflects, {share_text(facing)} facing the camera to 100% side-on; {BOTH}.{VIEW}"
        measured = ""
    else:
        made = owned(graph.node("ShaderNodeNewGeometry").outputs["Random Per Island"], "Island random")
        words = (
            "one random value from 0 to 1 for each loose part of a mesh; Cycles only: EEVEE gives"
            f" {CYCLES_ONLY[('NEW_GEOMETRY', 'Random Per Island')].removeprefix('which gives ')}."
        )
        measured = on_each(material, loose_parts)
    report(f"Mask {kind} of {name}: {words}{measured}")
    return made
