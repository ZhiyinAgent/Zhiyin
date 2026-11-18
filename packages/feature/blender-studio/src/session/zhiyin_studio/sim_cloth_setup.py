"""
A mesh made cloth for blender_simulate: a fabric from Blender's own presets, subdivided to a grid
spacing, pinned by a vertex group, an edge or points, inflated, sewn, and the objects it meets
given collision after every step of theirs, as thick as a tenth of the cloth's spacing.
"""

import math

import bmesh
import bpy

from .arguments import need, number, points, whole
from .errors import Refused
from .finding import find_object, find_objects, is_helper
from .sim_cloth_release import release, unrelease
from .wording import length, one_of

# Blender's own cloth presets, as its Cloth panel sets them: the vertex mass in kg, stiffness and damping.
FABRICS = {
    "cotton": dict(quality=5, mass=0.3, tension=15, compression=15, shear=15, bending=0.5, damping=5),
    "silk": dict(quality=5, mass=0.15, tension=5, compression=5, shear=5, bending=0.05, damping=0),
    "denim": dict(quality=12, mass=1, tension=40, compression=40, shear=40, bending=10, damping=25),
    "leather": dict(quality=15, mass=0.4, tension=80, compression=80, shear=80, bending=150, damping=25),
    "rubber": dict(quality=7, mass=3, tension=15, compression=15, shear=15, bending=25, damping=25),
}
EDGES = ("top", "bottom", "+x", "-x", "+y", "-y", "border")
# The spacing the presets are tuned at; a finer grid takes more steps a frame to keep from stretching.
TUNED_SPACING = 0.05
MOST_STEPS = 80
# Steps a frame a call may give: a bake's time grows in step with them.
MOST_GIVEN_STEPS = 1000
# The collision distance kept on each side, as a share of the spacing: a tenth rests the cloth close
# without its points slipping through a collider between them.
COLLISION_SHARE = 0.1
MOST_VERTICES = 25000
PINNED = "Pinned"


def edge_lengths(obj):
    """Each edge's length in the world, in the order of the mesh's edges."""
    world = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return [(world[e.vertices[0]] - world[e.vertices[1]]).length for e in obj.data.edges]


def spacing_of(obj):
    """How far apart the cloth's points are: the mean length of its edges in the world."""
    found = edge_lengths(obj)
    return sum(found) / len(found) if found else 0.0


def subdivide(obj, target):
    """Cuts every edge so the longest is at most target long; the line says what it became."""
    before = len(obj.data.vertices)
    longest = max(edge_lengths(obj))
    cuts = math.ceil(longest / target - 1e-6) - 1
    if cuts <= 0:
        return f"already {length(longest)} apart at most, finer than subdivide_to {length(target)}"
    faces = len(obj.data.polygons)
    estimate = before + faces * (cuts * cuts + 2 * cuts) + len(obj.data.edges) * cuts
    need(
        estimate <= MOST_VERTICES,
        f"subdivide_to {length(target)} would give “{obj.name}” about {estimate} points, past the {MOST_VERTICES} a cloth"
        " simulates in reasonable time: give a larger spacing.",
    )
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
        bm.to_mesh(obj.data)
    finally:
        bm.free()
    obj.data.update()
    return f"subdivided from {before} points"


def cloth_object(args):
    obj = find_object(args.get("object"))
    need(obj.type == "MESH" and not is_helper(obj), f"“{obj.name}” is not a mesh, and only a mesh can be cloth.")
    need(obj.data.polygons, f"“{obj.name}” has no faces to be cloth.")
    need(
        not any(m.type == "FLUID" for m in obj.modifiers),
        f"“{obj.name}” is part of a liquid simulation; cloth needs a mesh of its own.",
    )
    return obj


def open_edges(obj):
    """How many of the mesh's edges lack the two faces a closed shape gives each."""
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return sum(1 for e in bm.edges if not e.is_manifold)
    finally:
        bm.free()


def loose_edges(obj):
    """The edges with no face: the seams sewing pulls shut, as their points' indices."""
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return [(e.verts[0].index, e.verts[1].index) for e in bm.edges if not e.link_faces]
    finally:
        bm.free()


def boundary_points(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return sorted({v.index for e in bm.edges if e.is_boundary for v in e.verts})
    finally:
        bm.free()


def pinned_points(obj, pinned, spacing):
    """The points held still and how the answer names them; a vertex group named is kept as it is."""
    given = [k for k in ("group", "edge", "points") if pinned.get(k) is not None]
    need(len(given) == 1, "pinned takes one of group, edge or points.")
    if pinned.get("group") is not None:
        group = obj.vertex_groups.get(pinned["group"])
        if group is None:
            names = [g.name for g in obj.vertex_groups]
            listed = f" It has: {', '.join(names)}." if names else " It has none."
            raise Refused(f"“{obj.name}” has no vertex group “{pinned['group']}”.{listed}")
        held = [v.index for v in obj.data.vertices if any(g.group == group.index and g.weight > 0 for g in v.groups)]
        need(held, f"Vertex group “{group.name}” of “{obj.name}” holds no points.")
        return group.name, held, f"the {len(held)} points of its vertex group “{group.name}”"
    world = [obj.matrix_world @ v.co for v in obj.data.vertices]
    if pinned.get("edge") is not None:
        edge = pinned["edge"]
        need(edge in EDGES, f"pinned.edge is one of {one_of(EDGES)}.")
        border = boundary_points(obj)
        need(border, f"“{obj.name}” is closed and has no edge to pin: pin a vertex group or points.")
        if edge == "border":
            held, said = border, "all round its border"
        else:
            axis = {"top": 2, "bottom": 2, "+x": 0, "-x": 0, "+y": 1, "-y": 1}[edge]
            sign = -1 if edge in ("bottom", "-x", "-y") else 1
            far = max(sign * world[i][axis] for i in border)
            held = [i for i in border if sign * world[i][axis] >= far - spacing / 2]
            said = f"along its {edge} edge"
        return None, held, f"{len(held)} points {said}"
    wanted = points(pinned["points"], "pinned.points", 3, 1)
    held = []
    for point in wanted:
        nearest = min(range(len(world)), key=lambda i: (world[i] - point).length)
        if nearest not in held:
            held.append(nearest)
    farthest = max(min((world[i] - p).length for i in held) for p in wanted)
    return None, held, f"{len(held)} points nearest the {len(wanted)} given, the farthest {length(farthest)} from its point"


def pin(obj, pinned, spacing):
    group_name, held, said = pinned_points(obj, pinned, spacing)
    if group_name is None:
        old = obj.vertex_groups.get(PINNED)
        if old is not None:
            obj.vertex_groups.remove(old)
        group = obj.vertex_groups.new(name=PINNED)
        group.add(held, 1.0, "REPLACE")
        group_name = group.name
        said += f", held in vertex group “{group.name}”"
    return group_name, held, f"Pinned: {said}."


def steps_for(fabric, spacing):
    """Steps a frame: the preset's, and more as the grid grows finer than the presets are tuned at."""
    scale = max(1.0, (TUNED_SPACING / spacing) ** 2) if spacing > 0 else 1.0
    return min(MOST_STEPS, round(FABRICS[fabric]["quality"] * scale))


def set_fabric(settings, fabric, steps):
    values = FABRICS[fabric]
    settings.quality = steps
    settings.mass = values["mass"]
    settings.tension_stiffness = values["tension"]
    settings.compression_stiffness = values["compression"]
    settings.shear_stiffness = values["shear"]
    settings.bending_stiffness = values["bending"]
    settings.tension_damping = values["damping"]
    settings.compression_damping = values["damping"]
    settings.shear_damping = values["damping"]
    settings.air_damping = 1


DEFORMING = {"ARMATURE", "HOOK", "LATTICE", "MESH_DEFORM", "SURFACE_DEFORM", "CORRECTIVE_SMOOTH", "LAPLACIANDEFORM"}


def cloth_modifier(obj):
    """The object's cloth step, made after the steps that deform it and before those that add to it."""
    found = next((m for m in obj.modifiers if m.type == "CLOTH"), None)
    if found is None:
        found = obj.modifiers.new("Cloth", "CLOTH")
    after = [i for i, m in enumerate(obj.modifiers) if m.type in DEFORMING and m != found]
    place = (max(after) + 1) if after else 0
    current = list(obj.modifiers).index(found)
    if current != place:
        obj.modifiers.move(current, place if place < current else place - 1)
    return found


def colliders(names, cloth, distance):
    """Each object the cloth meets gets collision as its last step, so it meets the shape as shown."""
    found = find_objects(names)
    made, said = [], []
    for obj in found:
        need(obj != cloth, f"“{obj.name}” is the cloth itself; self-collision keeps it from crossing itself.")
        need(obj.type == "MESH", f"“{obj.name}” is not a mesh, and cloth meets only meshes.")
        need(
            not any(m.type == "CLOTH" for m in obj.modifiers),
            f"“{obj.name}” is cloth itself; cloths meet each other only when simulated as one mesh.",
        )
        modifier = next((m for m in obj.modifiers if m.type == "COLLISION"), None)
        if modifier is None:
            modifier = obj.modifiers.new("Collision", "COLLISION")
            made.append(obj)
        index = list(obj.modifiers).index(modifier)
        if index != len(obj.modifiers) - 1:
            obj.modifiers.move(index, len(obj.modifiers) - 1)
        obj.collision.thickness_outer = distance
        steps = len(obj.modifiers) - 1
        said.append(f"{obj.name} (after its {steps} other step{'s' if steps != 1 else ''})" if steps else obj.name)
    line = (
        f"Collides with {', '.join(said)}: each {length(distance)} thick on the outside, and the cloth keeps"
        f" {length(distance)} from them, a tenth of its spacing each."
    )
    return found, made, line


def set_up(args):
    """The cloth made from args["cloth"]: what it is, and the lines saying how it was set."""
    given = args["cloth"]
    need(isinstance(given, dict), "cloth describes the mesh to make cloth.")
    obj = cloth_object(given)
    fabric = given.get("fabric", "cotton")
    need(fabric in FABRICS, f"fabric is one of {one_of(FABRICS)}.")
    made_from = None
    if given.get("subdivide_to") is not None:
        target = number(given["subdivide_to"], "subdivide_to", minimum=0.001)
        made_from = subdivide(obj, target)
    spacing = spacing_of(obj)
    need(spacing > 0, f"“{obj.name}” has no edges to make a cloth of.")
    pressure = None
    if given.get("pressure") is not None:
        pressure = number(given["pressure"], "pressure", minimum=-10000, maximum=10000)
        holes = open_edges(obj)
        need(not holes, f"pressure inflates a closed shape, and “{obj.name}” is open at {holes} edges.")
    seams = []
    if given.get("sew") is True:
        seams = loose_edges(obj)
        need(
            seams,
            f"sew pulls the mesh's loose edges shut, and “{obj.name}” has none: add edges with no face between the points to join.",
        )
    # A cloth given again without a fabric keeps the one it has, as a script may have set it.
    existed = any(m.type == "CLOTH" for m in obj.modifiers)
    kept = given.get("fabric") is None and existed
    modifier = cloth_modifier(obj)
    settings = modifier.settings
    steps = settings.quality if kept else steps_for(fabric, spacing)
    if given.get("steps") is not None:
        steps = whole(given["steps"], "steps", minimum=1, maximum=MOST_GIVEN_STEPS)
    if kept:
        settings.quality = steps
    else:
        set_fabric(settings, fabric, steps)
    distance = max(0.001, COLLISION_SHARE * spacing)
    collision = modifier.collision_settings
    collision.use_collision = True
    collision.distance_min = distance
    # A cloth given again without self_collision keeps what it has, as a script may have set it.
    meets_itself = given.get("self_collision")
    need(meets_itself is None or isinstance(meets_itself, bool), "self_collision is true or false.")
    kept_self = meets_itself is None and existed
    if not kept_self:
        collision.use_self_collision = meets_itself is not False
    collision.self_distance_min = distance
    if collision.use_self_collision:
        self_said = "self-collision on"
    elif kept_self:
        self_said = "self-collision off as it was set (self_collision true turns it on)"
    else:
        self_said = "self-collision off"
    lines = []
    points_said = f"{len(obj.data.vertices)} points {length(spacing)} apart"
    if made_from:
        points_said += f", {made_from}"
    if kept:
        made_as = (
            f"cloth kept as it was set (mass {settings.mass:g} kg, tension {settings.tension_stiffness:g},"
            f" compression {settings.compression_stiffness:g}, shear {settings.shear_stiffness:g}, bending {settings.bending_stiffness:g}),"
            f" {points_said}; give fabric to start again from one of Blender's presets"
        )
    else:
        made_as = f"{fabric} cloth (Blender's preset), {points_said}"
    lines.append(
        f"{obj.name}: {made_as}; {self_said}, {settings.quality} steps a frame{' as given' if given.get('steps') is not None else ''}."
    )
    held = []
    settings.vertex_group_mass = ""
    unrelease(obj)
    if given.get("pinned") is not None:
        pinned = given["pinned"]
        need(isinstance(pinned, dict), "pinned takes one of group, edge or points.")
        group, held, line = pin(obj, pinned, spacing)
        settings.vertex_group_mass = group
        if pinned.get("release") is not None:
            need(
                given.get("drape") is not True,
                "pinned.release lets the pins go as the cloth moves over the scene's frames; a drape holds them until it rests.",
            )
            line = f"{line[:-1]}; {release(obj, modifier, group, pinned['release'])}."
        lines.append(line)
    settings.use_pressure = pressure is not None
    if pressure is not None:
        settings.uniform_pressure_force = pressure
    settings.use_sewing_springs = bool(seams)
    found, made, line = colliders(given.get("colliders") or [], obj, distance) if given.get("colliders") else ([], [], None)
    if line:
        lines.append(line)
    bpy.context.view_layer.update()
    return {
        "object": obj,
        "modifier": modifier,
        "spacing": spacing,
        "colliders": found,
        "made_colliders": made,
        "pressure": pressure,
        "seams": seams,
        "held": held,
        "lines": lines,
    }
