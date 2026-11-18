"""
The lines of a drawing of the scene, for the CAD studio's drafting to lay out
and dimension (ADR 0022).

Each view is seen as Blender's Line Art sees it, through an orthographic
camera looking the view's way: the edges in sight, and, for a straight or an
auxiliary view, the edges behind something. A section first cuts copies of
the objects where its plane passes, keeping what lies beyond, and gives the
faces it cut, to be hatched. Everything is drawn from copies of the objects
as they are evaluated, with their modifiers, in a scene of their own, and
all of it is removed after: the scene and its file are as they were.

Lengths are millimetres, in each view's own plane, from the middle of the
objects drawn, as the drafting's views are.
"""

import json
import math

import bmesh
import bpy
import mathutils

from .arguments import need
from .errors import Refused
from .finding import PREVIEW, find_objects, subjects
from .geometry import SHAPE_TYPES

# Where each named view looks from, as the direction it looks in and its up:
# the drafting's own table, so a view here is the view there.
NAMED = {
    "front": ((0, 1, 0), (0, 0, 1)),
    "back": ((0, -1, 0), (0, 0, 1)),
    "top": ((0, 0, -1), (0, 1, 0)),
    "bottom": ((0, 0, 1), (0, -1, 0)),
    "right": ((-1, 0, 0), (0, 0, 1)),
    "left": ((1, 0, 0), (0, 0, 1)),
    "iso": ((-1, 1, -1), (0, 0, 1)),
}
MOST_OBJECTS = 200
MOST_VIEWS = 12
# Flat faces seen squarely face the eye to within this, as the drafting judges them.
SQUARELY = 0.99
TEMPORARY = f"{PREVIEW} drafting"
# How far the camera is turned off a view's axis, in radians.
TURN = 1e-4


def _up_for(look):
    """The drafting's up for a view along `look`: the scene's up, unless it looks straight up or down."""
    return (0, 1, 0) if abs(look.normalized().z) > 0.99 else (0, 0, 1)


def _basis(look, up):
    look = mathutils.Vector(look).normalized()
    right = look.cross(mathutils.Vector(up)).normalized()
    return look, right, right.cross(look).normalized()


def _instances(obj):
    """Whether an object stands for copies of a collection, as one linked or placed many times does."""
    return obj.instance_type == "COLLECTION" and obj.instance_collection is not None


def _drawable(obj):
    return obj.type in SHAPE_TYPES or _instances(obj)


def _chosen(names):
    if names is None:
        found = [o for o in subjects() if _drawable(o)]
        need(found, "The scene has nothing to draw.")
        return found
    need(isinstance(names, list) and names and all(isinstance(n, str) for n in names), "objects lists objects by name.")
    # Each once, however often it is named.
    found = find_objects(names)
    need(len(found) <= MOST_OBJECTS, f"A drawing shows at most {MOST_OBJECTS} objects; {len(found)} were named.")
    for obj in found:
        need(_drawable(obj), f"“{obj.name}” is a {obj.type.lower()}, which has no shape to draw.")
    return found


def _world_mesh(obj, depsgraph):
    """The object as it is evaluated, its modifiers applied, in world space."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=False, depsgraph=depsgraph)
    mesh.transform(obj.matrix_world)
    return mesh


def _shapes(objects, depsgraph):
    """
    The shapes of the objects drawn, in world space, each with the object it
    belongs to: an object's own, and those it places as instances, of a
    collection or made by geometry nodes, which are part of what it shows.
    """
    owners = {obj.name: obj for obj in objects}
    shapes = [(obj, _world_mesh(obj, depsgraph)) for obj in objects if obj.type in SHAPE_TYPES]
    for instance in depsgraph.object_instances:
        if not instance.is_instance or instance.parent is None or instance.object.type not in SHAPE_TYPES:
            continue
        owner = owners.get(instance.parent.original.name)
        if owner is None:
            continue
        place = instance.matrix_world.copy()
        mesh = bpy.data.meshes.new_from_object(instance.object, preserve_all_data_layers=False, depsgraph=depsgraph)
        mesh.transform(place)
        shapes.append((owner, mesh))
    return shapes


def _cut(mesh, through, look):
    """
    The mesh cut where the plane through `through`, square to `look`, passes,
    keeping what lies beyond it, and its cut closed; answers the cut faces'
    outlines, in the world.
    """
    shape = bmesh.new()
    shape.from_mesh(mesh)
    cut = bmesh.ops.bisect_plane(
        shape,
        geom=shape.verts[:] + shape.edges[:] + shape.faces[:],
        plane_co=through,
        plane_no=look,
        clear_inner=True,
    )
    edges = [e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    loops = _loops(edges)
    if edges:
        # All the cut's loops filled together, so a loop inside another is
        # a hole in its face, as a room's walls cut through are a ring: a
        # face over the hole would hide all that stands in it.
        bmesh.ops.triangle_fill(shape, use_beauty=True, use_dissolve=False, edges=edges, normal=-look)
    shape.to_mesh(mesh)
    shape.free()
    return loops


def _loops(edges):
    """Closed runs of the cut edges, as lists of points; open runs are no face."""
    # By the vertices themselves: bmesh does not number those a cut makes.
    around = {}
    for edge in edges:
        a, b = edge.verts
        around.setdefault(a, []).append(b)
        around.setdefault(b, []).append(a)
    seen = set()
    loops = []
    for start in around:
        if start in seen or len(around[start]) != 2:
            continue
        loop = [start]
        seen.add(start)
        previous, current = None, start
        while True:
            nexts = [v for v in around[current] if v != previous]
            if not nexts:
                break
            following = nexts[0]
            if following == start:
                loops.append([vert.co.copy() for vert in loop])
                break
            if following in seen or len(around.get(following, [])) != 2:
                break
            seen.add(following)
            loop.append(following)
            previous, current = current, following
    return loops


def _facing(meshes, look):
    """The middle, by area, of the flat faces a view along `look` sees squarely, in the world; or nothing."""
    towards = -look
    total, middle = 0.0, mathutils.Vector((0, 0, 0))
    for mesh in meshes:
        for polygon in mesh.polygons:
            if polygon.normal.dot(towards) >= SQUARELY and polygon.area > 0:
                total += polygon.area
                middle += polygon.center * polygon.area
    return middle / total if total > 1e-12 else None


def _camera(centre, look, right, up, reach, room):
    """
    An orthographic camera in `room`, a square scene, looking along `look` at
    everything within `reach` of `centre`, turned by a hair. Seen exactly
    along a view's axis, the faces along it are edge on, and which side of
    them Line Art takes them to face is left to rounding: an outline along
    them, as a hole's sides, comes and goes. Turned, each faces one way. The
    points are laid flat along the view's own axes, so the turn moves only
    where a line passes behind another, by less than TURN of how far behind.
    """
    aside = (right + up * 0.6).normalized()
    look = (look + aside * math.tan(TURN)).normalized()
    right = look.cross(up).normalized()
    up = right.cross(look).normalized()
    data = bpy.data.cameras.new(TEMPORARY)
    data.type = "ORTHO"
    data.ortho_scale = 2.4 * reach
    data.clip_start = 0.001
    data.clip_end = 8 * reach + 1
    camera = bpy.data.objects.new(TEMPORARY, data)
    rotation = mathutils.Matrix((right, up, -look)).transposed().to_4x4()
    camera.matrix_world = mathutils.Matrix.Translation(centre - look * (4 * reach + 0.5)) @ rotation
    room.collection.objects.link(camera)
    return camera


def _lines_seen(room, camera, hidden):
    """
    The edges Line Art finds of what `room` holds, seen and, when asked,
    behind. Line Art hides lines behind everything in a scene, so the copies
    are drawn in a scene of their own: the objects they were copied from, or
    any other, would hide them.
    """
    data = bpy.data.grease_pencils.new(TEMPORARY)
    pencil = bpy.data.objects.new(TEMPORARY, data)
    room.collection.objects.link(pencil)
    material = bpy.data.materials.new(TEMPORARY)
    bpy.data.materials.create_gpencil_data(material)
    data.materials.append(material)
    layers = [("visible", 0, 0)] + ([("hidden", 1, 128)] if hidden else [])
    for name, start, end in layers:
        data.layers.new(name)
        lines = pencil.modifiers.new(name, "LINEART")
        lines.source_type = "SCENE"
        lines.target_layer = name
        lines.target_material = material
        lines.use_custom_camera = True
        lines.source_camera = camera
        lines.use_multiple_levels = True
        lines.level_start = start
        lines.level_end = end
        lines.use_intersection = True
        # Every point Line Art finds is kept as it is: a drawing is measured.
        lines.chaining_image_threshold = 0.0
        lines.smooth_tolerance = 0.0
        # Strokes stay on the edges they were found on, not drawn nearer the camera.
        lines.stroke_depth_offset = 0.0
    with bpy.context.temp_override(scene=room, view_layer=room.view_layers[0]):
        depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = pencil.evaluated_get(depsgraph)
    found = []
    for layer in evaluated.data.layers:
        if layer.name not in ("visible", "hidden"):
            continue
        frame = layer.current_frame()
        if frame is None:
            continue
        for stroke in frame.drawing.strokes:
            points = [evaluated.matrix_world @ point.position for point in stroke.points]
            if len(points) >= 2:
                found.append((layer.name, points))
    bpy.data.objects.remove(pencil)
    bpy.data.grease_pencils.remove(data)
    bpy.data.materials.remove(material)
    return found


def _one_view(spec, shapes, centre, reach):
    if "section" in spec:
        look, up = NAMED[spec["looking"]]
        name, hidden = spec["section"], False
    elif "auxiliary" in spec:
        look = mathutils.Vector(spec["direction"])
        need(look.length > 1e-9, f"auxiliary view {spec['auxiliary']} looks in no direction.")
        up = _up_for(look)
        name, hidden = spec["auxiliary"], spec.get("hidden", True) is not False
    else:
        name = spec["view"]
        need(name in NAMED, f"There is no view called {name}; the named views are {', '.join(NAMED)}.")
        look, up = NAMED[name]
        hidden = spec.get("hidden", name != "iso") is not False
    look, right, up = _basis(look, up)
    flat = lambda point: [round((point - centre).dot(right) * 1000, 3), round((point - centre).dot(up) * 1000, 3)]

    room = bpy.data.scenes.new(TEMPORARY)
    room.render.resolution_x = room.render.resolution_y = 1000
    copies = []
    cut = []
    turned = []
    camera = None
    try:
        uncut = set(spec.get("uncut") or [])
        revolved = set(spec.get("revolved") or []) if "section" in spec else set()
        drawn = {obj.name for obj, _ in shapes}
        missing = sorted(revolved - drawn)
        need(not missing, f"section {name} revolves {', '.join(missing)}, which the drawing does not show.")
        # Each shape hatched as a part of its own, an instance's apart from its object's.
        for index, (obj, mesh) in enumerate(shapes):
            if obj.name in revolved:
                # Turned into the plane by the drafting, from its faces: neither cut nor seen here.
                turned += _triangles(mesh)
                continue
            copy_mesh = mesh.copy()
            if "section" in spec and obj.name not in uncut:
                through = mathutils.Vector(spec["through"]) / 1000
                loops = _cut(copy_mesh, through, look)
                cut += [[index, [flat(point) for point in loop]] for loop in loops if len(loop) >= 3]
            copy = bpy.data.objects.new(TEMPORARY, copy_mesh)
            room.collection.objects.link(copy)
            copies.append(copy)
        camera = _camera(centre, look, right, up, reach, room)
        lines = [[layer, [flat(point) for point in points]] for layer, points in _lines_seen(room, camera, hidden)]
        # What a section cuts lies nearest the eye, so its outline is in sight
        # all round. Line Art can lose a piece of it where the faces of two
        # objects cut together, as walls meeting at a corner, lie in one plane.
        lines += [["visible", polygon + polygon[:1]] for _, polygon in cut]
        facing = _facing([c.data for c in copies], look) if "auxiliary" in spec else None
    finally:
        for copy in copies:
            mesh = copy.data
            bpy.data.objects.remove(copy)
            bpy.data.meshes.remove(mesh)
        if camera is not None:
            data = camera.data
            bpy.data.objects.remove(camera)
            bpy.data.cameras.remove(data)
        bpy.data.scenes.remove(room)
    return name, {
        "look": list(look),
        "up": list(up),
        "lines": lines,
        "cut": cut,
        "facing": [round(v * 1000, 3) for v in facing] if facing is not None else None,
        **({"revolved": turned} if turned else {}),
    }


def _triangles(mesh):
    """A mesh's faces as triangles, each nine numbers: its corners in the world, in millimetres."""
    mesh.calc_loop_triangles()
    at = mesh.vertices
    return [
        [round(c * 1000, 3) for index in triangle.vertices for c in at[index].co]
        for triangle in mesh.loop_triangles
    ]


def scene_lines(args, scene_file, device):
    """Writes the lines of each view asked for to `output`, and says how many it drew."""
    output = args.get("output")
    need(isinstance(output, str) and output, "The lines need a file to be written to.")
    specs = args.get("views")
    need(isinstance(specs, list) and 0 < len(specs) <= MOST_VIEWS, f"A drawing has 1 to {MOST_VIEWS} views.")
    objects = _chosen(args.get("objects"))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    shapes = _shapes(objects, depsgraph)
    try:
        corners = [v.co for _, mesh in shapes for v in mesh.vertices]
        need(corners, "The objects to draw have no surfaces.")
        low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
        high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
        centre = (low + high) / 2
        reach = max((high - low).length / 2, 0.001)
        drawn = {}
        for spec in specs:
            if "detail" in spec:
                continue
            name, view = _one_view(spec, shapes, centre, reach)
            if name in drawn:
                raise Refused(f"Two views are called {name}.")
            drawn[name] = view
    finally:
        for _, mesh in shapes:
            bpy.data.meshes.remove(mesh)
    with open(output, "w", encoding="utf-8") as file:
        json.dump(
            {
                "names": [obj.name for obj in objects],
                "centre": [round(v * 1000, 3) for v in centre],
                "views": drawn,
            },
            file,
        )
    return f"Drew the lines of {len(drawn)} {'view' if len(drawn) == 1 else 'views'} of {len(objects)} {'object' if len(objects) == 1 else 'objects'}."
