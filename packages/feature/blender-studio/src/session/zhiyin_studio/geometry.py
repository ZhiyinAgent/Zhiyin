"""
Where shapes are in the world: their boxes, corners, outlines and meshes, an object's own with
its parts' and the copies it places as instances. Within held_still, each object's parts, box
and copies are worked out once.
"""

import contextlib
import functools

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .finding import is_helper
from .mesh_math import evenly
from .wording import length

SHAPE_TYPES = {"MESH", "CURVE", "FONT", "SURFACE", "META"}
# The most copies of one object measured: past them, a scatter of grass would
# take minutes to measure. The answer says how many were.
MOST_MEASURED = 1000


def steady(measure):
    """Runs a measure with the scene held still, as one already is or for the measure alone."""

    @functools.wraps(measure)
    def held(*args, **kwargs):
        if still is not None:
            return measure(*args, **kwargs)
        with held_still():
            return measure(*args, **kwargs)

    return held


def may_place_copies(obj):
    """Whether an object can place instances: of a collection, on its points or faces, by geometry nodes or particles."""
    if obj.instance_type == "COLLECTION":
        return obj.instance_collection is not None
    return obj.instance_type in ("VERTS", "FACES") or any(
        m.type in ("NODES", "PARTICLE_SYSTEM") for m in getattr(obj, "modifiers", [])
    )


class Copies:
    """
    The copies objects place as instances, read in one pass over what Blender
    evaluated: for each object that places them, each copy with the name of
    the object it copies, or None for a shape its own geometry nodes make, its
    mesh in its own space, which copies of one shape share, and where it is.
    """

    def __init__(self):
        self.placed, self.meshes, self.hulls = {}, [], {}
        if not any(may_place_copies(o) for o in bpy.context.scene.objects):
            return
        depsgraph = bpy.context.evaluated_depsgraph_get()
        shared = {}
        try:
            for instance in depsgraph.object_instances:
                if not instance.is_instance or instance.parent is None or instance.object.type not in SHAPE_TYPES:
                    continue
                copied, placer = instance.object, instance.parent.original
                key = (copied.data or copied).as_pointer()
                if key not in shared:
                    mesh = bpy.data.meshes.new_from_object(copied, preserve_all_data_layers=False, depsgraph=depsgraph)
                    self.meshes.append(mesh)
                    shared[key] = mesh
                source = copied.original.name if copied.original != placer else None
                self.placed.setdefault(placer.as_pointer(), []).append((source, shared[key], instance.matrix_world.copy()))
        except Exception:
            self.free()
            raise

    def hull(self, mesh):
        """The corners of a copy's mesh that bound it, in its own space, as an array."""
        key = mesh.as_pointer()
        if key not in self.hulls:
            shape = bmesh.new()
            try:
                shape.from_mesh(mesh)
                points = hull_points(shape)
            finally:
                shape.free()
            self.hulls[key] = numpy.array([tuple(p) for p in points], dtype=numpy.float64).reshape(-1, 3)
        return self.hulls[key]

    def free(self):
        for mesh in self.meshes:
            bpy.data.meshes.remove(mesh)
        self.meshes = []


@steady
def copies_of(obj):
    """The copies an object places as instances, each as (the name of what it copies or None, mesh, where it is)."""
    return still.copies().placed.get(obj.as_pointer(), [])


def measured_copies(obj):
    """The copies of an object that are measured: the first MOST_MEASURED."""
    return copies_of(obj)[:MOST_MEASURED]


def has_shape(obj):
    """Whether an object shows a shape: its own, or copies it places."""
    return obj.type in SHAPE_TYPES or bool(copies_of(obj))


def own_points(obj):
    """The points of an object's own evaluated shape, without its copies, in world space, as an array."""
    if obj.type not in SHAPE_TYPES:
        return numpy.empty((0, 3))
    evaluated = obj.evaluated_get(evaluated_graph())
    mesh = evaluated.to_mesh()
    try:
        points = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float64)
        mesh.vertices.foreach_get("co", points)
    finally:
        evaluated.to_mesh_clear()
    matrix = obj.matrix_world
    return points.reshape(-1, 3) @ numpy.array(matrix.to_3x3()).T + numpy.array(matrix.translation)


@steady
def copy_points(obj):
    """The corners bounding each measured copy an object places, in world space, as one array."""
    copies = still.copies()
    found = [copies.hull(mesh) @ numpy.array(place.to_3x3()).T + numpy.array(place.translation) for _, mesh, place in measured_copies(obj)]
    return numpy.concatenate(found) if found else numpy.empty((0, 3))


def copies_named(obj):
    """
    An object as what it goes into is told, with the copies it places: by
    what they copy and by the object that places them.
    """
    copies = copies_of(obj)
    if not copies:
        return obj.name
    sources = list(dict.fromkeys(source for source, _, _ in copies))
    what = " and ".join(source or "the shapes its geometry nodes make" for source in sources)
    return f"{obj.name}'s instances of {what}" if not len(own_points(obj)) else f"{obj.name} and its instances of {what}"


def copies_text(obj):
    """How many copies an object places, of what, and their faces; nothing when it places none."""
    copies = copies_of(obj)
    if not copies:
        return None
    groups = {}
    for source, mesh, _ in copies:
        groups.setdefault(source, []).append(len(mesh.polygons))
    said = []
    for source, faces in groups.items():
        what = f"of {source}" if source else "its geometry nodes make"
        each = f"{faces[0]:,} faces each" if len(set(faces)) == 1 else f"{sum(faces):,} faces in all"
        said.append(f"{len(faces):,} {what}, {each}" if len(groups) > 1 else f"{what}, {each}")
    count = f"{len(copies):,} instance{'s' if len(copies) != 1 else ''}"
    text = f"places {count} {said[0]}" if len(groups) == 1 else f"places {count}: {'; '.join(said)}"
    if len(copies) > MOST_MEASURED:
        text += f"; the first {MOST_MEASURED:,} are measured"
    return text


def own_box(obj):
    """
    The corners of the box round an object's shape in its own space. Blender
    gives a subdivided shape the box of its cage, which a subdivided shape
    lies well inside, so that one is measured from its shape.
    """
    if any(m.type in ("SUBSURF", "MULTIRES") and m.show_viewport for m in getattr(obj, "modifiers", [])):
        evaluated = obj.evaluated_get(evaluated_graph())
        mesh = evaluated.to_mesh()
        try:
            if mesh.vertices:
                points = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float64)
                mesh.vertices.foreach_get("co", points)
                points = points.reshape(-1, 3)
                low, high = points.min(axis=0), points.max(axis=0)
                return [mathutils.Vector((x, y, z)) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]
        finally:
            evaluated.to_mesh_clear()
    return [mathutils.Vector(c) for c in obj.bound_box]


def own_dimensions(obj):
    """An object's size along its own axes as the scene has it: its own box, scaled."""
    corners = own_box(obj)
    scale = obj.matrix_world.to_scale()
    return mathutils.Vector([(max(c[i] for c in corners) - min(c[i] for c in corners)) * abs(scale[i]) for i in range(3)])


def square_to_world(matrix):
    """Whether an object's own axes lie along the world's, so its box's corners bound it in the world too."""
    turn = matrix.to_3x3()
    return all(sum(1 for value in row if abs(value) > 1e-9) <= 1 for row in turn)


@steady
def shape_corners(obj):
    """
    Points in world space whose box is the box round an object's shape there:
    its own box's corners when its axes lie along the world's, and otherwise
    its shape's points, since a turned box's corners reach past a turned round
    shape, as a gear's do whatever it is turned by. The copies it places are
    bounded by theirs, and its own shape then by its points, as its box keeps
    the shape it has before its geometry nodes.
    """
    matrix = obj.matrix_world
    if copies_of(obj):
        points = numpy.concatenate([own_points(obj), copy_points(obj)])
        return [mathutils.Vector(points.min(axis=0)), mathutils.Vector(points.max(axis=0))] if len(points) else []
    if square_to_world(matrix):
        return [matrix @ c for c in own_box(obj)]
    evaluated = obj.evaluated_get(evaluated_graph())
    mesh = evaluated.to_mesh()
    try:
        if not mesh.vertices:
            return [matrix @ mathutils.Vector(c) for c in obj.bound_box]
        points = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float64)
        mesh.vertices.foreach_get("co", points)
        points = points.reshape(-1, 3) @ numpy.array(matrix.to_3x3()).T + numpy.array(matrix.translation)
        low, high = points.min(axis=0), points.max(axis=0)
        return [mathutils.Vector(low), mathutils.Vector(high)]
    finally:
        evaluated.to_mesh_clear()


@steady
def world_corners(objects):
    """Points bounding each visible shape, the copies objects place included, in world space."""
    corners = []
    for obj in objects:
        if not has_shape(obj) or is_helper(obj) or obj.hide_render:
            continue
        corners.extend(shape_corners(obj))
    return corners


def world_bounds(objects):
    corners = world_corners(objects)
    if not corners:
        return None
    low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
    high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
    return low, high


class Still:
    """
    A scene read while nothing in it changes: each object's parts, box and
    measure, worked out once. Blender walks every object to find one's parts,
    so a scene of hundreds read part by part takes minutes.
    """

    def __init__(self, lasting=None):
        self.children = {}
        for o in bpy.data.objects:
            if o.parent is not None:
                self.children.setdefault(o.parent.as_pointer(), []).append(o)
        self.parts, self.held, self.boxes, self.measured = {}, {}, {}, {}
        # Whether each two measured go into each other, and how deep.
        self.pairs = {}
        # Measures kept from one moment to the next, for objects that stay as they are.
        self.lasting = lasting
        self.placed = None
        self.graph = None

    def copies(self):
        """The copies objects place as instances, read once."""
        if self.placed is None:
            self.placed = Copies()
        return self.placed

    def parts_of(self, obj):
        key = obj.as_pointer()
        if key not in self.parts:
            found, waiting = [], list(self.children.get(key, []))
            while waiting:
                part = waiting.pop()
                found.append(part)
                waiting += self.children.get(part.as_pointer(), [])
            self.parts[key] = found
            self.held[key] = {p.as_pointer() for p in found}
        return self.parts[key]

    def holds(self, obj, other):
        self.parts_of(obj)
        return other.as_pointer() in self.held[obj.as_pointer()]


still = None


class Lasting:
    """
    The measures of objects that do not move or change from one moment to the
    next, as a frame sheet steps through its frames: worked out once, at the
    first moment, and kept.
    """

    def __init__(self, unchanging):
        self.unchanging = set(unchanging)
        self.measured = {}


@contextlib.contextmanager
def held_still(lasting=None):
    """
    Reads the scene within as it is now, each object's parts and box worked
    out once; with `lasting`, the measures of objects that stay as they are
    kept from an earlier moment.
    """
    global still
    if still is not None:
        yield
        return
    bpy.context.view_layer.update()
    still = Still(lasting)
    try:
        yield
    finally:
        if still.placed is not None:
            still.placed.free()
        still = None


@contextlib.contextmanager
def shown_as_evaluated():
    """
    Pictures drawn within take each shown mesh's shape with its steps from
    the scene as Blender already evaluated it, not evaluated anew. A picture
    is drawn from a scene evaluated for it alone, so a shape whose steps take
    a minute to evaluate, as a dense shape subdivided with many faces meeting
    at a point does, would take that minute at every picture: each such
    object is hidden from pictures while a copy of it carries its evaluated
    shape, with no steps, in its place.
    Objects that place copies as instances keep their own steps. Everything
    is put back after, and the evaluated scene is left as it was.
    """
    graph = bpy.context.evaluated_depsgraph_get()
    stand_ins = []
    try:
        for obj in list(bpy.context.scene.objects):
            if (
                obj.type != "MESH"
                or obj.hide_render
                or not obj.visible_get()
                or not any(m.show_render for m in getattr(obj, "modifiers", []))
                or may_place_copies(obj)
            ):
                continue
            shape = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
            copy = obj.copy()
            copy.data = shape
            copy.modifiers.clear()
            for holder in obj.users_collection:
                holder.objects.link(copy)
            obj.hide_render = True
            stand_ins.append((obj, copy, shape))
        yield
    finally:
        for obj, copy, shape in stand_ins:
            obj.hide_render = False
            bpy.data.objects.remove(copy)
            bpy.data.meshes.remove(shape)


def evaluated_graph():
    """
    The scene as Blender evaluated it. While the scene is held still it is
    read once: each mesh made to measure with marks the scene changed, and
    asking again would evaluate every object anew.
    """
    if still is None:
        return bpy.context.evaluated_depsgraph_get()
    if still.graph is None:
        still.graph = bpy.context.evaluated_depsgraph_get()
    return still.graph


def parts_below(obj):
    """Every part an object holds, and the parts they hold."""
    return still.parts_of(obj) if still is not None else obj.children_recursive


def holds(obj, other):
    """Whether `other` is one of an object's parts, or a part of one."""
    return still.holds(obj, other) if still is not None else other in obj.children_recursive


@steady
def shapes_of(obj):
    """
    An object's own shape and those of the parts it holds, such as an
    imported model's, with each one that places copies as instances.
    """
    return [o for o in [obj, *parts_below(obj)] if has_shape(o) and not is_helper(o)]


@steady
def bounds_of(obj):
    """The box round an object and its parts, in world space, whether or not it is rendered."""
    if still is not None and obj.as_pointer() in still.boxes:
        return still.boxes[obj.as_pointer()]
    corners = [c for o in shapes_of(obj) for c in shape_corners(o)]
    box = None
    if corners:
        low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
        high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
        box = low, high
    if still is not None:
        still.boxes[obj.as_pointer()] = box
    return box


def flat_axis(mesh):
    """The axis a mesh is flat along, if it is a flat sheet."""
    if not mesh.vertices:
        return None
    extent = [max(v.co[i] for v in mesh.vertices) - min(v.co[i] for v in mesh.vertices) for i in range(3)]
    flat = [i for i in range(3) if extent[i] <= 1e-6 * max(extent)]
    return flat[0] if len(flat) == 1 else None


@steady
def own_size(obj):
    """
    An object's size along its own axes, before it is turned, as adding and
    resizing give it: its shape's, or for a group its parts' together, with
    the copies each places as instances.
    """
    if obj.type in SHAPE_TYPES and not copies_of(obj):
        return own_dimensions(obj)
    parts = shapes_of(obj)
    if not parts:
        return None
    to_own = obj.matrix_world.inverted()
    corners = [to_own @ part.matrix_world @ c for part in parts if not copies_of(part) for c in own_box(part)]
    placing = [part for part in parts if copies_of(part)]
    if placing:
        points = numpy.concatenate([numpy.concatenate([own_points(p), copy_points(p)]) for p in placing])
        corners += [to_own @ mathutils.Vector(p) for p in points]
    if not corners:
        return None
    scale = obj.matrix_world.decompose()[2]
    return mathutils.Vector(
        [(max(c[i] for c in corners) - min(c[i] for c in corners)) * abs(scale[i]) for i in range(3)]
    )


def middle_of(obj):
    """The middle of an object's box: what aiming or focusing at it means."""
    bounds = bounds_of(obj)
    return (bounds[0] + bounds[1]) / 2 if bounds else obj.matrix_world.translation.copy()


@steady
def own_bounds(obj):
    """The box round an object's own shape, without its parts, in world space; None for one with no shape of its own."""
    if not has_shape(obj) or is_helper(obj):
        return None
    corners = shape_corners(obj)
    if not corners:
        return None
    low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
    high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
    return low, high


def heights_text(obj):
    """
    Where an object's bottom and top are, which its location alone does not
    say: its own shape's, as its size is its own, then, where what is
    attached to it reaches past them, its heights with those parts. A group
    with no shape of its own is as high as its parts.
    """
    group = bounds_of(obj)
    if not group:
        return None
    own = own_bounds(obj) or group
    bottom, top = length(own[0].z), length(own[1].z)
    said = f"from {bottom} to {top} high"
    low, high = length(group[0].z), length(group[1].z)
    if (low, high) == (bottom, top):
        return said
    reach = f"from {low} to {high}" if low != bottom and high != top else f"to {high}" if high != top else f"from {low}"
    return f"{said} (with what is attached, {reach})"


def welded(bm, verts):
    """
    Joins the corners of an open part that lie at the same place: model files
    often store a closed shape with each face's corners its own, which reads
    as open. Only for measuring; a part already closed is left as it is, so
    shapes that merely touch stay apart.
    """
    edges = {e for v in verts for e in v.link_edges}
    if edges and not all(e.is_manifold for e in edges):
        bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-6)


def add_mesh(bm, mesh, matrix):
    """
    Adds a mesh to another, placed by `matrix`. It is joined and placed in a
    mesh of its own first: corners a join removes free places that the next
    part's corners take, so a corner added to the shared mesh cannot be told
    by where it lies in it.
    """
    own = bmesh.new()
    joined = None
    try:
        own.from_mesh(mesh)
        bmesh.ops.transform(own, matrix=matrix, verts=list(own.verts))
        welded(own, list(own.verts))
        joined = bpy.data.meshes.new("Zhiyin measured part")
        own.to_mesh(joined)
        bm.from_mesh(joined)
    finally:
        own.free()
        if joined is not None:
            bpy.data.meshes.remove(joined)


@steady
def add_part(bm, part, depsgraph):
    """Adds one part's evaluated shape to a mesh, in world space, with the copies it places as instances."""
    if part.type in SHAPE_TYPES:
        evaluated = part.evaluated_get(depsgraph)
        try:
            add_mesh(bm, evaluated.to_mesh(), part.matrix_world)
        finally:
            evaluated.to_mesh_clear()
    for _, mesh, place in measured_copies(part):
        add_mesh(bm, mesh, place)


@steady
def shapes_mesh(objects):
    """The evaluated shapes of `objects`, with the copies each places, as one mesh in world space."""
    depsgraph = evaluated_graph()
    bm = bmesh.new()
    for part in objects:
        add_part(bm, part, depsgraph)
    return bm


@steady
def world_mesh(obj):
    """An object's evaluated shape, with its parts', as one mesh in world space."""
    return shapes_mesh(shapes_of(obj))


def hull_points(bm):
    """
    The corners of a mesh's convex hull, which hold every point of the mesh
    between them: what fits them fits the whole shape. A flat mesh has no
    hull, so all its points are given.
    """
    points = []
    if len(bm.verts) > 4:
        try:
            hull = bmesh.ops.convex_hull(bm, input=list(bm.verts))
            points = [v.co.copy() for v in hull["geom"] if isinstance(v, bmesh.types.BMVert)]
        except RuntimeError:
            points = []
    return points or [v.co.copy() for v in bm.verts]


@steady
def outline_points(obj):
    """The corners of an object's shape, with its parts', in world space."""
    shape = world_mesh(obj)
    try:
        return hull_points(shape)
    finally:
        shape.free()


def sampled(verts, limit=6000):
    """Up to `limit` of a mesh's points, spread evenly, so measuring stays quick on a dense mesh."""
    return [v.co.copy() for v in evenly(list(verts), limit)]
