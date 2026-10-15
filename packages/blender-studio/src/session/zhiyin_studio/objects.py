"""Adding objects to the scene and editing them.

Geometry is built at its real size, so an object's scale stays 1 and a bevel or
a wall thickness means what it says. An object's location is where its origin
is, as in Blender: a solid is built centred on its origin, and a shape drawn
through points (a turned profile, an outline, a tube) keeps the coordinates it
was drawn in around its origin. Every answer says where an object's bottom and
top are, and what it goes into, because its location alone does not.
"""

import contextlib
import math
import os

import bmesh
import bpy
import mathutils
import mathutils.bvhtree

from .common import (
    CUTTERS,
    Refused,
    bounds_of,
    collection,
    files_read,
    find_object,
    heights_text,
    into_text,
    is_helper,
    length,
    link,
    need,
    number,
    one_of,
    outside,
    own_size,
    point_text,
    points,
    positive_size,
    reaim,
    rotation,
    sampled,
    size_text,
    subjects,
    turned_text,
    unused_name,
    vector,
    whole,
    world_bounds,
    world_mesh,
)
from .model_reads import named_outside, reading_inside

MODEL_IMPORTERS = {
    ".glb": lambda path: bpy.ops.import_scene.gltf(filepath=path),
    ".gltf": lambda path: bpy.ops.import_scene.gltf(filepath=path),
    ".obj": lambda path: bpy.ops.wm.obj_import(filepath=path),
    ".stl": lambda path: bpy.ops.wm.stl_import(filepath=path, global_scale=0.001),
    ".ply": lambda path: bpy.ops.wm.ply_import(filepath=path),
    ".fbx": lambda path: bpy.ops.import_scene.fbx(filepath=path),
    ".usd": lambda path: bpy.ops.wm.usd_import(filepath=path),
    ".usda": lambda path: bpy.ops.wm.usd_import(filepath=path),
}


# ---- geometry ------------------------------------------------------------------------------


def mesh_from(bm, name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def with_uvs(bm):
    if not bm.loops.layers.uv:
        bm.loops.layers.uv.new()
    return bm


def centred(bm):
    """Moves the geometry so its bounding box is centred on the origin."""
    if not bm.verts:
        return bm
    low = mathutils.Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
    high = mathutils.Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    bmesh.ops.translate(bm, vec=-(low + high) / 2, verts=bm.verts)
    return bm


def fitted(bm, size):
    """Scales centred unit geometry to a size in metres."""
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    return bm


def cube(spec):
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    return fitted(bm, size)


def cylinder(spec, top=0.5):
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=64)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=0.5, radius2=top, depth=1.0, calc_uvs=True)
    return fitted(bm, size)


def sphere(spec):
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=64)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(3, segments // 2), radius=0.5, calc_uvs=True)
    return fitted(bm, size)


def plane(spec):
    size = positive_size(spec.get("size"), "size", (1, 1), length=2)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
    return fitted(bm, (size[0], size[1], 1))


def torus(spec):
    outer = number(spec.get("diameter"), "diameter", minimum=1e-6, default=1.0)
    thickness = number(spec.get("thickness"), "thickness", minimum=1e-6, default=outer / 4)
    need(thickness < outer, "thickness must be less than diameter.")
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=64)
    major, minor = (outer - thickness) / 2, thickness / 2
    bm = bmesh.new()
    ring = [
        bm.verts.new((major + minor * math.cos(a), 0, minor * math.sin(a)))
        for a in (2 * math.pi * i / 24 for i in range(24))
    ]
    edges = [bm.edges.new((ring[i], ring[(i + 1) % 24])) for i in range(24)]
    bmesh.ops.spin(bm, geom=ring + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    return centred(bm)


def revolved(spec):
    """A profile of (radius, height) points turned around the origin's vertical axis, at the heights it gives."""
    profile = points(spec.get("profile"), "profile", 2, 2)
    need(all(p[0] >= 0 for p in profile), "Each profile point's radius must be 0 or more.")
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=64)
    ended = len(profile) > 3 and (profile[0] - profile[-1]).length < 1e-9
    if ended:
        profile = profile[:-1]
    # A profile that stays off the axis is the cross-section of a ring or a
    # band, and its last point joins its first; one touching the axis is
    # closed by the axis itself. Two points enclose nothing.
    ring = len(profile) >= 3 and profile[0][0] > 1e-9 and profile[-1][0] > 1e-9
    closed = spec.get("closed", ring)
    need(isinstance(closed, bool), "closed is true or false.")
    need(not closed or len(profile) >= 3, "A closed profile needs three points or more.")
    bm = bmesh.new()
    verts = [bm.verts.new((p[0], 0, p[1])) for p in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    # Two ends on the axis are joined by the axis: an edge along it turns into nothing.
    on_axis = profile[0][0] <= 1e-9 and profile[-1][0] <= 1e-9
    if (closed or ended) and not on_axis:
        edges.append(bm.edges.new((verts[-1], verts[0])))
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def from_curve(curve, name):
    """A curve's evaluated shape as a mesh, so it can be cut, joined and printed."""
    holder = bpy.data.objects.new(name, curve)
    link(holder)
    evaluated = holder.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated)
    bpy.data.objects.remove(holder)
    bpy.data.curves.remove(curve)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)
    return tidied(bm)


def tidied(bm):
    """A curve's mesh made whole: its pieces joined where they meet, facing out, and flat."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    # A curve's surface faces whichever way it was drawn; outward, as a solid's.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Flat, as every new shape is: smooth shading is added only when wanted.
    for face in bm.faces:
        face.smooth = False
    return bm


def as_mesh(obj):
    """A curve object as a mesh object in its place, with its name, parent, place and materials."""
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    tidied(bm).to_mesh(mesh)
    bm.free()
    shape = bpy.data.objects.new(f"{obj.name} mesh", mesh)
    for owner in obj.users_collection:
        owner.objects.link(shape)
    shape.parent = obj.parent
    shape.matrix_parent_inverse = obj.matrix_parent_inverse.copy()
    shape.matrix_basis = obj.matrix_basis.copy()
    name, curve = obj.name, obj.data
    bpy.data.objects.remove(obj)
    if curve.users == 0:
        bpy.data.curves.remove(curve)
    shape.name = mesh.name = name
    return shape


def outline(spec, name):
    """A flat outline, with holes, rising from the origin's height to its own."""
    outer = points(spec.get("points"), "points", 2, 3)
    holes = spec.get("holes") or []
    need(isinstance(holes, list), "holes must be a list of outlines.")
    height = number(spec.get("height"), "height", minimum=1e-6)
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = height / 2
    for ring in [outer] + [points(h, "Each hole", 2, 3) for h in holes]:
        spline = curve.splines.new("POLY")
        spline.points.add(len(ring) - 1)
        for point, xy in zip(spline.points, ring):
            point.co = (xy[0], xy[1], 0, 1)
        spline.use_cyclic_u = True
    bm = from_curve(curve, name)
    # Extruded both ways from where it was drawn; it stands on that instead.
    bmesh.ops.translate(bm, vec=(0, 0, height / 2), verts=bm.verts)
    return bm


TUBE_CORNERS = ("round", "sharp")
ROUND_KINDS = ("cylinder", "cone", "sphere", "torus", "revolve", "tube")


def tube(spec, name):
    """A round tube through points: a smooth curve through each, or straight runs between them."""
    path = points(spec.get("points"), "points", 3, 2)
    radius = number(spec.get("radius"), "radius", minimum=1e-6)
    corners = spec.get("corners", "round")
    need(corners in TUBE_CORNERS, "A tube's corners are round or sharp.")
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 6
    curve.use_fill_caps = True
    if corners == "sharp":
        spline = curve.splines.new("POLY")
        spline.points.add(len(path) - 1)
        for point, xyz in zip(spline.points, path):
            point.co = (*xyz, 1)
    else:
        curve.resolution_u = 16
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(len(path) - 1)
        for point, xyz in zip(spline.bezier_points, path):
            point.co = xyz
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"
        if not spec.get("closed") and len(path) >= 3:
            # Left to Blender, an end leaves along the line to the next point
            # and the last stretch cuts inside the curve; it leaves along the
            # curve through the first three points instead, and the same at
            # the other end.
            ends = spline.bezier_points
            end_handles(ends[0], path[0], path[1], path[2], "handle_right", "handle_left")
            end_handles(ends[len(path) - 1], path[-1], path[-2], path[-3], "handle_left", "handle_right")
    spline.use_cyclic_u = bool(spec.get("closed"))
    return from_curve(curve, name)


def end_handles(point, end, next_point, after, toward, away):
    """Handles for a curve's end, along the parabola through it and the next two points."""
    direction = -3 * end + 4 * next_point - after
    if direction.length < 1e-12:
        return
    reach = direction.normalized() * (next_point - end).length / 3
    point.handle_left_type = "FREE"
    point.handle_right_type = "FREE"
    setattr(point, toward, end + reach)
    setattr(point, away, end - reach)


CJK_FONTS = ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc", "YuGothM.ttc", "malgun.ttf")


def system_cjk_font():
    """A Windows font with Chinese, Japanese and Korean characters, for text that needs one."""
    folder = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Fonts")
    for name in CJK_FONTS:
        path = os.path.join(folder, name)
        if os.path.exists(path):
            return path
    return None


# The angle between the cuts that let a flat shape bend, in degrees.
BEND_STEP = 3


def bent_round(bm, radius):
    """
    Bends a flat shape round an upright cylinder behind it, as a label lies on
    a jar: its back on the surface, and as long along it as it was flat. The
    shape lies in its own x and y, its thickness along z; the cylinder's axis
    runs along y, `radius` behind the back.
    """
    back = min(v.co.z for v in bm.verts)
    low, high = min(v.co.x for v in bm.verts), max(v.co.x for v in bm.verts)
    need(
        high - low < 2 * math.pi * radius,
        f"The text is {length(high - low)} long, longer than the way round a {length(radius)} radius: "
        "give it fewer words, smaller letters or a larger wrap_radius.",
    )
    # A face bends only where it has corners, so it is cut every few degrees.
    step = radius * math.radians(BEND_STEP)
    cut = (math.floor(low / step) + 1) * step
    while cut < high:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-9, plane_co=(cut, 0, 0), plane_no=(1, 0, 0))
        cut += step
    for vert in bm.verts:
        angle = vert.co.x / radius
        reach = radius + vert.co.z - back
        vert.co.x = reach * math.sin(angle)
        vert.co.z = back - radius + reach * math.cos(angle)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def text_object(spec, name):
    body = spec.get("text")
    need(isinstance(body, str) and body.strip(), "text is required for a text object.")
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = number(spec.get("height"), "height", minimum=1e-6, default=0.1)
    curve.extrude = number(spec.get("depth"), "depth", minimum=0, default=0.01) / 2
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    font = spec.get("font") or (system_cjk_font() if any(ord(c) >= 0x2E80 for c in body) else None)
    if font:
        curve.font = bpy.data.fonts.load(font, check_existing=True)
    # A mesh, so lettering can be bevelled, cut into and joined like any shape.
    bm = from_curve(curve, name)
    wrap = spec.get("wrap_radius")
    if wrap is not None:
        bent_round(bm, number(wrap, "wrap_radius", minimum=1e-6))
    obj = bpy.data.objects.new(name, mesh_from(bm, name))
    obj["zhiyin_text"] = body
    if wrap is not None:
        obj["zhiyin_wrap"] = float(wrap)
    return obj


def picture(spec, name):
    """A picture from the workspace on a plane of its own proportions."""
    path = spec.get("path")
    image = bpy.data.images.load(path, check_existing=True)
    image.filepath = bpy.path.relpath(path) if bpy.data.filepath else path
    width_px, height_px = image.size
    need(width_px > 0 and height_px > 0, f"{os.path.basename(path)} could not be read as a picture.")
    width = number(spec.get("width"), "width", minimum=1e-6, default=1.0)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
    fitted(bm, (width, width * height_px / width_px, 1))
    obj = bpy.data.objects.new(name, mesh_from(bm, name))
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes["Principled BSDF"]
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    material.node_tree.links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    shader.inputs["Roughness"].default_value = 0.6
    obj.data.materials.append(material)
    return obj


def svg_drawing(spec, name):
    """An SVG drawing as extruded shapes, gathered under one empty."""
    path = spec.get("path")
    depth = number(spec.get("depth"), "depth", minimum=0, default=0.005)
    width = number(spec.get("width"), "width", minimum=1e-6, default=0.2)
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=path)
    shapes = [o for o in bpy.data.objects if o not in before and o.type == "CURVE"]
    need(shapes, f"{os.path.basename(path)} holds no shapes Blender can read.")
    group = bpy.data.objects.new(name, None)
    link(group)
    for shape in shapes:
        shape.parent = group
    # Scaled to its width as a whole, so its thickness is set at that scale.
    bpy.context.view_layer.update()
    bounds = world_bounds(shapes)
    extent = bounds[1].x - bounds[0].x if bounds else 0
    need(extent > 1e-9, f"{os.path.basename(path)} has no width to scale.")
    factor = width / extent
    group.scale = [factor] * 3
    for shape in shapes:
        shape.data.extrude = depth / 2 / factor
    # Meshes, so a drawing can be bevelled, cut into and joined like any shape.
    return group, [as_mesh(shape) for shape in shapes]


def reads_outside(path, reaching):
    need(
        not reaching,
        f"{os.path.basename(path)} reads files outside the workspace ({', '.join(reaching[:3])}). "
        "Copy what it needs into the workspace and point the model file at the copies.",
    )


def model_file(path, name, workspace):
    extension = os.path.splitext(path)[1].lower()
    need(extension in MODEL_IMPORTERS, f"Models can be read from {', '.join(sorted(MODEL_IMPORTERS))} files.")
    # A model file names its geometry, pictures and parts by paths of its own,
    # which the workspace check on the model's path does not cover.
    if workspace:
        reads_outside(path, named_outside(path, workspace))
    before = set(bpy.data.objects)
    read_before = files_read()
    with reading_inside(workspace) if workspace else contextlib.nullcontext([]) as refused:
        try:
            MODEL_IMPORTERS[extension](path)
        except RuntimeError:
            # An importer that met a refused file says so in its own words.
            reads_outside(path, refused)
            raise
    reads_outside(path, refused)
    imported = [o for o in bpy.data.objects if o not in before]
    need(imported, f"{os.path.basename(path)} holds nothing Blender could import.")
    reads_outside(path, outside(files_read() - read_before, workspace) if workspace else [])
    group = bpy.data.objects.new(name, None)
    link(group)
    for obj in imported:
        if obj.parent is None:
            obj.parent = group
    return group, imported


# ---- placing --------------------------------------------------------------------------------


def smooth(obj, angle_degrees=30):
    """Smooth shading, keeping edges sharper than the angle crisp."""
    if obj.type != "MESH":
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    limit = math.radians(angle_degrees)
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        edge.smooth = not (edge.is_boundary or (edge.is_manifold and edge.calc_face_angle(0) > limit))
    bm.to_mesh(obj.data)
    bm.free()


def bevel_width(obj, value):
    """A bevel's width, at most half the object's thinnest side: past that the bevel rounds the shape away."""
    width = number(value, "bevel width", minimum=1e-7)
    bpy.context.view_layer.update()
    corners = [mathutils.Vector(c) for c in obj.bound_box]
    sides = [max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(3)]
    thinnest = min((s for s in sides if s > 1e-9), default=None)
    need(
        thinnest is None or width <= thinnest / 2 * (1 + 1e-6),
        f"A {length(width)} bevel is more than half of “{obj.name}”'s thinnest side, {length(thinnest or 0)}: "
        f"the most it can round is {length((thinnest or 0) / 2)}.",
    )
    return width


def bevel(obj, spec):
    need(obj.type == "MESH", f"Only a mesh can be bevelled, and “{obj.name}” is a {obj.type.lower()}.")
    width = bevel_width(obj, spec.get("width"))
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = whole(spec.get("segments"), "bevel segments", maximum=32, default=3)
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(30)
    modifier.harden_normals = False
    return modifier


def fit_group(group, children, size):
    """Scales a group of imported parts uniformly to fit inside a size."""
    bpy.context.view_layer.update()
    bounds = world_bounds(children)
    if not bounds or size is None:
        return
    extent = bounds[1] - bounds[0]
    factors = [size[i] / extent[i] for i in range(3) if extent[i] > 1e-9]
    if factors:
        group.scale = [min(factors)] * 3


def placed(obj, most_into=None):
    """
    Where an object is, as an answer says it: its size, its origin, its bottom
    and top, and what it goes into, or the deepest `most_into` of those.
    """
    bpy.context.view_layer.update()
    size = own_size(obj)
    parts = [f"{obj.name} ({size_text(size) if size is not None else 'no size'}) at {point_text(obj.matrix_world.translation)}"]
    turned = turned_text(obj)
    if turned:
        parts.append(turned)
    if obj.get("zhiyin_wrap"):
        parts.append(f"bent round a {length(obj['zhiyin_wrap'])} radius")
    heights = heights_text(obj)
    if heights:
        parts.append(heights)
    parts += into_text(obj, subjects(), most_into)
    return ", ".join(parts)


PLACING = {"name", "kind", "location", "rotation", "rest_on", "parent", "smooth", "bevel"}
def cone(spec):
    """A cylinder narrowed at the top: to a point, unless top_ratio says how far."""
    top = number(spec.get("top_ratio"), "top_ratio", minimum=0, maximum=1, default=0) / 2
    return cylinder(spec, top)


def solid(shape, named=False):
    """Makes an object of the one mesh a shape draws; a named shape is told the object's name."""

    def make(spec, name, workspace):
        drawn = shape(spec, name) if named else shape(spec)
        return bpy.data.objects.new(name, mesh_from(drawn, name)), None

    return make


def whole_object(maker):
    """Makes an object a function builds whole, mesh or not."""
    return lambda spec, name, workspace: (maker(spec, name), None)


def model(spec, name, workspace):
    """A model file brought in as a group, fitted to a size when one is given."""
    obj, children = model_file(spec.get("path"), name, workspace)
    if spec.get("size") is not None:
        fit_group(obj, children, positive_size(spec.get("size"), "size"))
    return obj, children


# Each kind: what it is built from besides where it goes, and what makes it.
# A maker is given the description, the name and the workspace, and answers
# the object and, for a group, the parts it holds.
KINDS = {
    "cube": (("size",), solid(cube)),
    "box": (("size",), solid(cube)),
    "cylinder": (("size", "segments"), solid(cylinder)),
    "cone": (("size", "segments", "top_ratio"), solid(cone)),
    "sphere": (("size", "segments"), solid(sphere)),
    "plane": (("size",), solid(plane)),
    "torus": (("diameter", "thickness", "segments"), solid(torus)),
    "revolve": (("profile", "segments", "closed"), solid(revolved)),
    "outline": (("points", "holes", "height"), solid(outline, named=True)),
    "tube": (("points", "radius", "corners", "closed"), solid(tube, named=True)),
    "text": (("text", "height", "depth", "font", "wrap_radius"), whole_object(text_object)),
    "image": (("path", "width"), whole_object(picture)),
    "svg": (("path", "width", "depth"), lambda spec, name, workspace: svg_drawing(spec, name)),
    "model": (("path", "size"), model),
}
TAKES = {kind: takes for kind, (takes, _) in KINDS.items()}


def check_inputs(spec):
    """Refuses an input the kind does not use, which would otherwise be dropped without a word."""
    kind = spec.get("kind")
    if not isinstance(kind, str) or kind not in TAKES:
        return
    unused = sorted(set(spec) - PLACING - set(TAKES[kind]))
    if not unused:
        return
    others = {key: sorted(k for k, takes in TAKES.items() if key in takes and k != "box") for key in unused}
    whose = "; ".join(f"{key} is for {', '.join(kinds)}" if kinds else f"{key} is not an input" for key, kinds in others.items())
    shape = " (size is [x, y, z]: a cylinder's is [diameter, diameter, height])" if kind in ("cylinder", "cone", "sphere") else ""
    raise Refused(f"A {kind} takes {', '.join(TAKES[kind])}{shape}; {whose}.")


def add_objects(args, scene_file):
    specs = args.get("objects")
    need(isinstance(specs, list) and specs, "objects must list at least one object.")
    added = []
    for spec in specs:
        need(isinstance(spec, dict), "Each object is described by an object with a kind and a name.")
        check_inputs(spec)
        name = unused_name(spec.get("name"))
        kind = spec.get("kind")
        # A box is a cube by its other name, and is not listed twice.
        need(
            isinstance(kind, str) and kind in KINDS,
            f"kind must be one of {one_of(k for k in KINDS if k != 'box')}.",
        )
        obj, group_children = KINDS[kind][1](spec, name, args.get("workspace"))
        if obj.name not in bpy.context.scene.objects:
            link(obj)
        obj.rotation_euler = rotation(spec.get("rotation"))
        obj.location = vector(spec.get("location"), "location", default=(0, 0, 0))
        if group_children is not None:
            # A group's origin is where it was placed; its parts are centred on
            # it, moved in the world's terms whatever the group's scale.
            bpy.context.view_layer.update()
            bounds = world_bounds(group_children)
            if bounds:
                offset = obj.location - (bounds[0] + bounds[1]) / 2
                for child in obj.children:
                    moved = child.matrix_world.copy()
                    moved.translation += offset
                    child.matrix_world = moved
        # A round shape drawn with flat faces shows each one as a stripe in
        # anything glossy; it is smooth unless asked to be flat.
        if spec.get("smooth", kind in ROUND_KINDS or spec.get("wrap_radius") is not None):
            smooth(obj)
        if spec.get("bevel") is not None:
            bevel(obj, spec["bevel"])
        if spec.get("rest_on") is not None:
            rest(obj, spec["rest_on"])
        if spec.get("parent"):
            parent = find_object(spec["parent"])
            attach(obj, parent)
        added.append(obj)
    return "\n".join(f"Added {placed(o)}." for o in added)


def attach(obj, parent):
    """Attaches an object to another where it is in the world, even if both were placed a moment ago."""
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def raise_by(obj, height):
    """Moves an object up (or down) in the world, whatever it is attached to."""
    moved = obj.matrix_world.copy()
    moved.translation.z += height
    obj.matrix_world = moved
    bpy.context.view_layer.update()


def rest(obj, on):
    """
    Sets an object down on the floor (z = 0), or on another object the way it
    would settle if lowered straight down onto it: on the first surface it
    meets, so a mug lands in a saucer's well, not at the height of its rim.
    """
    need(isinstance(on, str) and on.strip(), "rest_on is “floor” or the name of an object.")
    bpy.context.view_layer.update()
    own = bounds_of(obj)
    need(own is not None, f"“{obj.name}” has no shape to rest.")
    if on == "floor":
        raise_by(obj, -own[0].z)
        return
    support = find_object(on)
    need(support != obj and support not in obj.children_recursive, f"“{obj.name}” cannot rest on itself.")
    below = bounds_of(support)
    need(below is not None, f"“{support.name}” has no shape to rest on.")
    over = all(own[0][i] < below[1][i] and own[1][i] > below[0][i] for i in (0, 1))
    need(over, f"“{obj.name}” is not above “{support.name}”. Give it a location over it first.")
    # Lifted clear of the support, then lowered until the two first touch.
    raise_by(obj, max(0.0, below[1].z - own[0].z) + 0.001)
    falling, ground = world_mesh(obj), world_mesh(support)
    try:
        falling_tree = mathutils.bvhtree.BVHTree.FromBMesh(falling)
        ground_tree = mathutils.bvhtree.BVHTree.FromBMesh(ground)
        gaps = [hit[3] for p in sampled(falling.verts) if (hit := ground_tree.ray_cast(p, DOWN))[0] is not None]
        gaps += [hit[3] for p in sampled(ground.verts) if (hit := falling_tree.ray_cast(p, UP))[0] is not None]
        # Two shapes can first touch between their corners, as crossed logs
        # do: columns over where they overlap find that place.
        lifted = bounds_of(obj)
        low = [max(lifted[0][i], below[0][i]) for i in (0, 1)]
        high = [min(lifted[1][i], below[1][i]) for i in (0, 1)]
        gaps += column_gaps(falling_tree, ground_tree, low, high, lifted[0].z - 1)
    finally:
        falling.free()
        ground.free()
    need(gaps, f"No part of “{support.name}” is below “{obj.name}”. Give it a location over it first.")
    raise_by(obj, -min(gaps))


DOWN, UP = mathutils.Vector((0, 0, -1)), mathutils.Vector((0, 0, 1))


def column_gap(falling_tree, ground_tree, x, y, under):
    """How far the falling shape's lowest point above (x, y) is from the ground below it, or None."""
    bottom = falling_tree.ray_cast(mathutils.Vector((x, y, under)), UP)[0]
    if bottom is None:
        return None
    return ground_tree.ray_cast(bottom, DOWN)[3]


def column_gaps(falling_tree, ground_tree, low, high, under, count=48):
    """
    The gaps in a grid of columns over the area from `low` to `high`, then in
    finer grids round the narrowest, so a meeting between corners is found
    to a fraction of a millimetre. A column never finds a gap narrower than
    the true one, so a shape is never set down into another.
    """
    gaps = []
    for _ in range(4):
        step = [(high[i] - low[i]) / (count - 1) for i in (0, 1)]
        best = None
        for i in range(count):
            for j in range(count):
                x, y = low[0] + i * step[0], low[1] + j * step[1]
                gap = column_gap(falling_tree, ground_tree, x, y, under)
                if gap is not None:
                    gaps.append(gap)
                    if best is None or gap < best[0]:
                        best = (gap, x, y)
        if best is None:
            break
        low = [best[1] - step[0], best[2] - step[1]]
        high = [best[1] + step[0], best[2] + step[1]]
        count = 9
    return gaps


def place_in_world(obj, location=None, turn=None):
    """Sets where an object is, or how it is turned, in the world's terms, whatever it is attached to."""
    bpy.context.view_layer.update()
    here, rotated, scaled = obj.matrix_world.decompose()
    obj.matrix_world = mathutils.Matrix.LocRotScale(
        here if location is None else location,
        rotated if turn is None else turn.to_quaternion(),
        scaled,
    )


@contextlib.contextmanager
def attachments_kept(obj):
    """
    Resizes a part without its attachments: they keep their own size and
    place. A group's parts are what it is, and its cutters cut it, so those
    are resized with it.
    """
    bpy.context.view_layer.update()
    kept = [] if obj.type == "EMPTY" else [(c, c.matrix_world.copy()) for c in obj.children if not is_helper(c)]
    yield
    bpy.context.view_layer.update()
    for child, world in kept:
        child.matrix_world = world


def tree(obj):
    """An object with everything attached to it, its cutters included."""
    return [obj, *obj.children_recursive]


def next_number(name):
    """The first number n for which “name n” is free."""
    number = 2
    while bpy.data.objects.get(f"{name} {number}"):
        number += 1
    return number


def duplicate(obj, spec):
    """
    Copies an object with what is attached to it, each copy moved by the offset
    in the world's terms; a copy's holes are cut by copies of their cutters.
    """
    count = whole(spec.get("count"), "duplicate count", maximum=500, default=1)
    offset = vector(spec.get("offset"), "duplicate offset")
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    made = []
    for i in range(1, count + 1):
        number = next_number(obj.name)
        copies = {}
        for original in tree(obj):
            copy = original.copy()
            if original.data is not None:
                copy.data = original.data.copy()
            copy.name = unused_name(f"{original.name} {number}")
            for target in original.users_collection:
                target.objects.link(copy)
            copies[original] = copy
        for original, copy in copies.items():
            if original.parent in copies:
                copy.parent = copies[original.parent]
            for modifier in copy.modifiers:
                if getattr(modifier, "object", None) in copies:
                    modifier.object = copies[modifier.object]
        root = copies[obj]
        moved = world.copy()
        moved.translation += offset * i
        root.matrix_world = moved
        attached = [c.name for o, c in copies.items() if o is not obj and not is_helper(c)]
        made.append(root.name + (f" (with {', '.join(attached)})" if attached else ""))
    return made


def edit_objects(args, scene_file):
    edits = args.get("edits")
    need(isinstance(edits, list) and edits, "edits must list at least one change.")
    said = []
    for edit in edits:
        need(isinstance(edit, dict), "Each edit is an object naming the object it changes.")
        obj = find_object(edit.get("object"))
        name = obj.name
        if edit.get("delete"):
            # What is attached goes with it, as a group's parts and a part's cutters do.
            parts = [o.name for o in tree(obj)[1:] if not is_helper(o)]
            for part in reversed(tree(obj)):
                bpy.data.objects.remove(part)
            said.append(f"{name}: deleted" + (f", with {', '.join(parts)}" if parts else ""))
            continue
        changes = []
        moved = False
        if edit.get("rename"):
            renamed = unused_name(edit["rename"])
            focused_by = [c for c in bpy.data.cameras if c.get("zhiyin_focus") == obj.name]
            obj.name = renamed
            for camera in focused_by:
                camera["zhiyin_focus"] = obj.name
            changes.append(f"renamed to {obj.name}")
        # Positions and turns are the world's, attached or not.
        if edit.get("location") is not None:
            place_in_world(obj, location=vector(edit["location"], "location"))
            reaim(obj)
            changes.append("moved")
            moved = True
        if edit.get("move_by") is not None:
            bpy.context.view_layer.update()
            place_in_world(obj, location=obj.matrix_world.translation + vector(edit["move_by"], "move_by"))
            reaim(obj)
            changes.append("moved")
            moved = True
        if edit.get("rotation") is not None:
            place_in_world(obj, turn=rotation(edit["rotation"]))
            changes.append("turned")
            moved = True
        if edit.get("size") is not None:
            size = positive_size(edit["size"], "size")
            bpy.context.view_layer.update()
            # Along its own axes, as it was given when added.
            current = own_size(obj) or (0, 0, 0)
            need(all(c > 1e-9 for c in current), f"“{name}” is flat or empty, so it cannot be given a size; scale it instead.")
            with attachments_kept(obj):
                obj.scale = [obj.scale[i] * size[i] / current[i] for i in range(3)]
            changes.append("resized")
            moved = True
        if edit.get("scale") is not None:
            with attachments_kept(obj):
                obj.scale = positive_size(edit["scale"], "scale")
            changes.append("scaled")
            moved = True
        if edit.get("parent"):
            world = obj.matrix_world.copy()
            obj.parent = find_object(edit["parent"])
            obj.matrix_world = world
            changes.append(f"attached to {obj.parent.name}")
        if edit.get("detach"):
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
            changes.append("detached")
        if edit.get("hidden") is not None:
            # With what is attached; cutters stay out of pictures either way.
            for part in tree(obj):
                if is_helper(part):
                    continue
                part.hide_render = bool(edit["hidden"])
                part.hide_viewport = bool(edit["hidden"])
            changes.append("hidden" if edit["hidden"] else "shown")
        if edit.get("rest_on") is not None:
            rest(obj, edit["rest_on"])
            changes.append(f"resting on {edit['rest_on']}")
            moved = True
        if edit.get("duplicate") is not None:
            made = duplicate(obj, edit["duplicate"])
            changes.append(f"copied as {', '.join(made)}")
        need(changes, f"The edit of “{name}” changes nothing.")
        said.append(f"{name}: {', '.join(changes)}" + (f"; now {placed(obj)}" if moved else ""))
    return "\n".join(f"{line}." for line in said)


