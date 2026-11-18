"""
Remeshing a shape in place: by voxels of a size, merged where flat by an adaptivity, its attributes
carried over when asked; or by QuadriFlow into about so many quads, or quads of about an edge
length, keeping sharp edges and open borders, mirrored across axes, from a seed. A remesh rebuilds
the mesh, so the steps before it are baked in first. The answer gives the faces before and after,
how far the new surface strays from the shape before, in millimetres, and how much a closed shape's
volume changed; a QuadriFlow remesh also its poles. QuadriFlow refuses a shape whose edges join more
than two faces, saying where.
"""

import math

import bmesh
import bpy

from .arguments import need, number, whole
from .errors import Refused
from .mesh_retopo import own_mesh, poles, quadriflow, volume_words
from .picking import spread
from .scales import scene_scale
from .shape_measures import Deviation, snapshot
from .shaping_measure import Measure
from .shown_mesh import shown_bmesh
from .wording import length, one_of

METHODS = ("voxel", "quadriflow")
AXES = ("x", "y", "z")
# The most faces a voxel remesh may make: past it, a call runs out of time and memory.
MOST_FACES = 2_000_000
# How far a voxel remesh merges faces where it is flat: least, most and by default.
ADAPTIVITY = (0, 1, 0)
# The faces a voxel remesh makes on each voxel-sized square of surface, at most about: measured
# on Blender 5.2.2, 1.04 on a cube and 1.50 to 1.54 on a sphere and a torus.
FACES_PER_SQUARE = 1.5
# How a remesh rebuilds unless the call says.
METHOD = "voxel"


def voxel_faces(area, size):
    """About how many faces a voxel remesh by voxels `size` across makes of a surface of `area`."""
    return FACES_PER_SQUARE * area / size**2


def least_voxel(area):
    """The smallest voxel a remesh of a surface of `area` takes without making more than MOST_FACES."""
    return math.sqrt(FACES_PER_SQUARE * area / MOST_FACES)


def voxel_remeshed(obj, size, asked, *, adaptivity=0.0, keep_volume=True, keep_attributes=False):
    """
    Remeshes an object's mesh by voxels `size` across in the world, the argument named `asked`.
    Blender remeshes the mesh in its own space, by voxels the world's size over the object's largest
    scale, so the faces it makes are counted there: a shape squashed by its scale is remeshed as
    finely as the shape before the squash. Refused before anything changes when that is more than
    MOST_FACES, and when Blender makes nothing.
    """
    stretch = max(scene_scale(obj))
    own = size / stretch
    area = sum(face.area for face in obj.data.polygons)
    expected = voxel_faces(area, own)
    if expected > MOST_FACES:
        seen = shown_bmesh(obj, steps=False)
        try:
            surface = sum(face.calc_area() for face in seen.faces)
        finally:
            seen.free()
        raise Refused(
            f"Voxels of {length(size)} would make about {expected:,.0f} faces of “{obj.name}”'s {surface:.4g} m² surface,"
            f" more than {MOST_FACES:,}: give {asked} of at least {length(least_voxel(area) * stretch)}."
        )
    mesh = obj.data
    mesh.remesh_voxel_size = own
    mesh.remesh_voxel_adaptivity = adaptivity
    mesh.use_remesh_preserve_attributes = keep_attributes
    mesh.use_remesh_preserve_volume = keep_volume
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        result = bpy.ops.object.voxel_remesh()
    if "FINISHED" not in result or not obj.data.polygons:
        raise Refused(f"Blender could not remesh “{obj.name}” by voxels of {length(size)}; try another size.")


def baked(obj):
    """Bakes the steps an object has into its mesh, as a remesh works on the mesh itself; how many there were."""
    count = len(obj.modifiers)
    if not count:
        return 0
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated)
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    mesh.name = obj.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return count


def surface_area(obj):
    reach = scene_scale(obj)
    stretch = reach[0] * reach[1] * reach[2]
    return sum(face.area for face in obj.data.polygons) * stretch ** (2 / 3)


def voxel(obj, op):
    size = number(op.get("voxel_size"), "voxel_size", minimum=1e-5)
    least, most, default = ADAPTIVITY
    adaptivity = number(op.get("adaptivity"), "adaptivity", minimum=least, maximum=most, default=default)
    need(op.get("keep_attributes") is None or isinstance(op.get("keep_attributes"), bool), "keep_attributes is true or false.")
    keep = bool(op.get("keep_attributes"))
    voxel_remeshed(obj, size, "a voxel_size", adaptivity=adaptivity, keep_attributes=keep)
    said = f"remeshed by voxels of {length(size)}"
    if adaptivity > 0:
        said += f", merged where flat by {adaptivity:g}"
    if keep:
        said += ", its attributes carried over"
    return said


def tangled_or_refused(obj):
    """Refuses a shape QuadriFlow cannot remesh, as its steps leave it: one whose edges join more than two faces, saying where."""
    bm = own_mesh(obj)
    try:
        tangled = [e for e in bm.edges if len(e.link_faces) > 2]
        if tangled:
            matrix = obj.matrix_world
            raise Refused(
                f"“{obj.name}” is not one clean surface: {len(tangled)} of its edges join more than two faces, at"
                f" {spread([matrix @ v.co for e in tangled for v in e.verts])}. QuadriFlow remeshes only a surface"
                " whose every edge joins one face or two; part its pieces, or remesh it by voxels first."
            )
    finally:
        bm.free()


def poles_text(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        three, five, six = poles(bm)
    finally:
        bm.free()
    return f"poles: {three:,} of 3 edges, {five:,} of 5, {six:,} of 6 or more"


def by_quadriflow(obj, op):
    if op.get("faces") is not None and op.get("edge_length") is not None:
        need(False, "A QuadriFlow remesh aims at faces or at an edge_length, not both.")
    area = surface_area(obj)
    if op.get("edge_length") is not None:
        edge = number(op.get("edge_length"), "edge_length", minimum=1e-5)
        target = max(10, round(area / edge**2))
        aim = f"quads about {length(edge)} across, about {target:,} for its {area:.4g} m²"
    else:
        target = whole(op.get("faces"), "faces", minimum=10, maximum=200000, default=2000)
        aim = f"about {target:,} quads"
    need(target <= 200000, f"Quads of that size would be about {target:,}, more than 200,000: give a longer edge_length.")
    symmetry = op.get("symmetry") or []
    need(isinstance(symmetry, list) and all(a in AXES for a in symmetry), "symmetry lists axes: x, y or z.")
    for axis in AXES:
        setattr(obj.data, f"use_mirror_{axis}", axis in symmetry)
    for key in ("keep_sharp", "keep_boundary"):
        need(op.get(key) is None or isinstance(op.get(key), bool), f"{key} is true or false.")
    seed = whole(op.get("seed"), "seed", minimum=0, maximum=2**31 - 1, default=0)
    if not quadriflow(obj, target, bool(symmetry), bool(op.get("keep_sharp")), keep_boundary=bool(op.get("keep_boundary")), seed=seed):
        raise Refused(f"QuadriFlow could not remesh “{obj.name}” into {aim}; try another number of faces or seed.")
    if not obj.data.polygons:
        raise Refused(f"QuadriFlow left nothing of “{obj.name}”; try another number of faces or seed.")
    quads = sum(1 for p in obj.data.polygons if len(p.vertices) == 4)
    said = f"remeshed by QuadriFlow into {aim}, {math.floor(quads / len(obj.data.polygons) * 100)}% quads, {poles_text(obj)}"
    kept = [w for w, k in (("sharp edges", "keep_sharp"), ("open borders", "keep_boundary")) if op.get(k)]
    if kept:
        said += f", keeping its {' and '.join(kept)}"
    if symmetry:
        said += f", mirrored across {', '.join(symmetry)}"
    if seed:
        said += f", seed {seed}"
    return said


def remesh(obj, op):
    method = op.get("method", METHOD)
    need(method in METHODS, f"A remesh's method is {one_of(METHODS)}.")
    before = Measure(obj)
    if method == "quadriflow":
        tangled_or_refused(obj)
    shape = snapshot(obj)
    try:
        steps = baked(obj)
        said = voxel(obj, op) if method == "voxel" else by_quadriflow(obj, op)
        after = snapshot(obj)
        try:
            strays = Deviation(shape, after)
        finally:
            after.free()
    finally:
        shape.free()
    now = Measure(obj)
    said += f", from {before.faces:,} faces to {now.faces:,}"
    if steps:
        said += f", its {steps} {'step' if steps == 1 else 'steps'} before baked in first"
    said += f"; it strays from the shape before by {strays.words('the shape before', 'the new one')}"
    if before.shape.volume is not None and now.shape.volume is not None:
        said += f"; its {volume_words(before.shape.volume, now.shape.volume)}"
    elif before.shape.volume is not None:
        said += "; it was closed and is open now, so it has no volume"
    return said
