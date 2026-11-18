"""
The shapes adding makes, each built at its real size, so an object's scale stays 1 and a bevel
or a wall thickness means what it says: solids centred on their origin, shapes drawn through
points in the coordinates they were drawn in, lettering, pictures, drawings and model files.
"""

import contextlib
import math
import os

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .arguments import need, number, points, positive_size, vector, whole
from .cad_motion import mark_model
from .disk_files import files_read, outside
from .finding import link
from .geometry import world_bounds
from .layouts import lay_faces, lay_round
from .model_reads import named_outside, reading_inside
from .model_shapes import made_whole
from .scales import BUILT_SCALE, scene_scale
from .wording import length

# The sides round a round shape by default, and a torus's round its tube.
SEGMENTS = 64
TORUS_RINGS = 24

MODEL_IMPORTERS = {
    ".glb": lambda path: bpy.ops.import_scene.gltf(filepath=path),
    ".gltf": lambda path: bpy.ops.import_scene.gltf(filepath=path),
    ".obj": lambda path: bpy.ops.wm.obj_import(filepath=path),
    ".stl": lambda path: bpy.ops.wm.stl_import(filepath=path, global_scale=0.001),
    ".ply": lambda path: bpy.ops.wm.ply_import(filepath=path),
    ".fbx": lambda path: bpy.ops.import_scene.fbx(filepath=path),
    **{extension: lambda path: bpy.ops.wm.usd_import(filepath=path) for extension in (".usd", ".usda", ".usdc", ".usdz")},
}




def mesh_from(bm, name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def with_uvs(bm):
    """A layout layer for the shape's picture, named UVMap as Blender names its own; left unnamed, Blender 5.2 calls it Float2."""
    if not bm.loops.layers.uv:
        bm.loops.layers.uv.new("UVMap")
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
    bmesh.ops.create_cube(bm, size=1.0)
    lay_faces(fitted(bm, size))
    return bm


def cylinder(spec, top=0.5):
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=SEGMENTS)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=0.5, radius2=top, depth=1.0)
    lay_round(fitted(bm, size))
    return bm


def sphere(spec):
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=SEGMENTS)
    rings = whole(spec.get("rings"), "rings", minimum=3, maximum=512, default=max(3, segments // 2))
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=0.5, calc_uvs=True)
    return fitted(bm, size)


def plane(spec):
    size = positive_size(spec.get("size"), "size", (1, 1), length=2)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    lay_faces(fitted(bm, (size[0], size[1], 1)))
    return bm


def torus(spec):
    outer = number(spec.get("diameter"), "diameter", minimum=1e-6, default=1.0)
    thickness = number(spec.get("thickness"), "thickness", minimum=1e-6, default=outer / 4)
    need(thickness < outer, "thickness must be less than diameter.")
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=SEGMENTS)
    rings = whole(spec.get("rings"), "rings", minimum=3, maximum=512, default=TORUS_RINGS)
    major, minor = (outer - thickness) / 2, thickness / 2
    bm = bmesh.new()
    ring = [
        bm.verts.new((major + minor * math.cos(a), 0, minor * math.sin(a)))
        for a in (2 * math.pi * i / rings for i in range(rings))
    ]
    edges = [bm.edges.new((ring[i], ring[(i + 1) % rings])) for i in range(rings)]
    bmesh.ops.spin(bm, geom=ring + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    # The spin turns the ring's faces into the tube; outward, as a solid's.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return centred(bm)


def revolved(spec):
    """A profile of (radius, height) points turned around the origin's vertical axis, at the heights it gives."""
    profile = points(spec.get("profile"), "profile", 2, 2)
    need(all(p[0] >= 0 for p in profile), "Each profile point's radius must be 0 or more.")
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=SEGMENTS)
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


def section_shape(spec, name):
    """A tube's cross-section drawn through [x, y] points, as a closed flat curve of its own, or nothing for a round one."""
    if spec.get("section") is None:
        return None
    corners = points(spec.get("section"), "section", 2, 3)
    curve = bpy.data.curves.new(f"{name} section", "CURVE")
    curve.dimensions = "2D"
    spline = curve.splines.new("POLY")
    spline.points.add(len(corners) - 1)
    for point, xy in zip(spline.points, corners):
        point.co = (xy[0], xy[1], 0, 1)
    spline.use_cyclic_u = True
    return link(bpy.data.objects.new(f"{name} section", curve))


def tapered(spline_points, path, taper):
    """Each point's share of the tube's width, from its start's to its end's, by how far along the path it is."""
    start, end = (vector(taper, "taper", length=2) if taper is not None else (1.0, 1.0))
    need(start >= 0 and end >= 0 and max(start, end) > 0, "taper is the tube's width at its start and end as shares of its radius, 0 or more.")
    along = [0.0]
    for a, b in zip(path, path[1:]):
        along.append(along[-1] + (b - a).length)
    for point, reach in zip(spline_points, along):
        point.radius = start + (end - start) * (reach / along[-1] if along[-1] > 0 else 0)


def tube(spec, name):
    """A tube through points, round or of a drawn section: a smooth curve through each, or straight runs between them."""
    path = points(spec.get("points"), "points", 3, 2)
    corners = spec.get("corners", "round")
    need(corners in TUBE_CORNERS, "A tube's corners are round or sharp.")
    need(isinstance(spec.get("caps", True), bool), "caps is true or false.")
    section = section_shape(spec, name)
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    if section is None:
        curve.bevel_depth = number(spec.get("radius"), "radius", minimum=1e-6)
        curve.bevel_resolution = 6
    else:
        need(spec.get("radius") is None, "A tube takes a radius or a section, not both: a section gives its size.")
        curve.bevel_mode = "OBJECT"
        curve.bevel_object = section
    curve.use_fill_caps = spec.get("caps", True)
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
    tapered(spline.points if corners == "sharp" else spline.bezier_points, path, spec.get("taper"))
    try:
        return from_curve(curve, name)
    finally:
        if section is not None:
            held = section.data
            bpy.data.objects.remove(section)
            bpy.data.curves.remove(held)


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
    # Its built size is the width it was given.
    group[BUILT_SCALE] = [factor] * 3
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


def up_axis_wrapper(obj):
    """
    Whether an object is the quarter turn about x that a modeller working with
    z up wraps its whole model in to write glTF, whose y is up: an empty at
    the top holding parts, turned that way alone and never animated.
    """
    if obj.type != "EMPTY" or obj.parent is not None or not obj.children or obj.animation_data is not None:
        return False
    place, turn, size = obj.matrix_basis.decompose()
    if place.length > 1e-9 or any(abs(s - 1) > 1e-6 for s in size):
        return False
    return any(turn.rotation_difference(mathutils.Quaternion((1, 0, 0), a)).angle < 1e-6 for a in (math.pi / 2, -math.pi / 2))


def turned_shape(mesh, change):
    """
    A mesh's points moved by `change`, its shading normals turned with them
    exactly: Blender works a file's own normals out again as it moves the
    points, and turns a few of them on thin faces the wrong way.
    """
    kept = None
    if mesh.has_custom_normals:
        flat = numpy.empty(len(mesh.loops) * 3, dtype=numpy.float32)
        mesh.corner_normals.foreach_get("vector", flat)
        normal_change = numpy.array(change.to_3x3().inverted().transposed(), dtype=numpy.float64)
        kept = flat.reshape(-1, 3) @ normal_change.T
        kept /= numpy.maximum(numpy.linalg.norm(kept, axis=1, keepdims=True), 1e-12)
    mesh.transform(change)
    if kept is not None:
        mesh.normals_split_custom_set(kept.tolist())


def unwrapped(imported):
    """
    A glTF model's objects with the up-axis turn its modeller wrapped them in
    built into their shapes: each part then stands unturned in the world, its
    origin where it was modelled, so a key of its turn starts from where it
    was made. The wrapper goes. A model holding anything but meshes and
    empties, or anything animated, is left as it came.
    """
    for wrapper in [o for o in imported if up_axis_wrapper(o)]:
        held = wrapper.children_recursive
        if any(o.type not in ("MESH", "EMPTY") or o.animation_data is not None for o in held):
            continue
        bpy.context.view_layer.update()
        turn = wrapper.matrix_world.copy()
        was = {o: o.matrix_world.copy() for o in held}
        # Each part placed where it was, without the wrapper's turn.
        now = {o: turn.inverted() @ w for o, w in was.items()}
        for o in now:
            now[o].translation = was[o].translation
        changes = {}
        for o in held:
            if o.type != "MESH":
                continue
            change = now[o].inverted() @ was[o]
            # A quarter turn is exact: a cosine of 1e-17 left in moves points by
            # rounding, which tips the normals of nearly flat corners.
            for row in change:
                for i, value in enumerate(row):
                    if abs(value - round(value)) < 1e-9:
                        row[i] = round(value)
            same = changes.get(o.data.name)
            # A mesh two parts share is turned once, unless they need it turned differently.
            if same is not None and not all(abs(a - b) < 1e-9 for r, s in zip(same, change) for a, b in zip(r, s)):
                o.data = o.data.copy()
            elif same is not None:
                continue
            turned_shape(o.data, change)
            changes[o.data.name] = change
        for o in held:
            parent = o.parent
            o.parent = None if parent is wrapper else parent
            o.matrix_parent_inverse = mathutils.Matrix.Identity(4)
            o.matrix_basis = now[o] if o.parent is None else now[o.parent].inverted() @ now[o]
        imported = [o for o in imported if o is not wrapper]
        bpy.data.objects.remove(wrapper)
    return imported


def model_file(path, name, workspace):
    extension = os.path.splitext(path)[1].lower()
    need(extension in MODEL_IMPORTERS, f"Models can be read from {', '.join(sorted(MODEL_IMPORTERS))} files.")
    # A model file names its geometry, pictures and parts by paths of its own,
    # which the workspace check on the model's path does not cover.
    if workspace:
        reads_outside(path, named_outside(path, workspace))
    before = set(bpy.data.objects)
    pictures_before = set(bpy.data.images)
    read_before = files_read()
    with reading_inside(workspace) if workspace else contextlib.nullcontext([]) as refused:
        try:
            MODEL_IMPORTERS[extension](path)
        except RuntimeError:
            # An importer that met a refused file says so in its own words.
            reads_outside(path, refused)
            raise
    reads_outside(path, refused)
    # A USD package's pictures are packed into the scene from Blender's own
    # temporary folder; each is named as coming from the package.
    temporary = os.path.realpath(bpy.app.tempdir)
    for picture in set(bpy.data.images) - pictures_before:
        unpacked = os.path.realpath(bpy.path.abspath(picture.filepath))
        if picture.packed_file and not outside([unpacked], temporary):
            named = f"{path}[{os.path.basename(unpacked)}]"
            picture.filepath_raw = bpy.path.relpath(named) if bpy.data.filepath else named
    imported = [o for o in bpy.data.objects if o not in before]
    need(imported, f"{os.path.basename(path)} holds nothing Blender could import.")
    reads_outside(path, outside(files_read() - read_before, workspace) if workspace else [])
    if extension in (".glb", ".gltf"):
        imported = unwrapped(imported)
    # Turned by angles about x, y and z, as every other object is, so a turn a
    # script sets takes. One the file animates keeps the turns its keys use.
    for obj in imported:
        if obj.rotation_mode != "XYZ" and obj.animation_data is None:
            obj.rotation_mode = "XYZ"
    made_whole(imported)
    group = bpy.data.objects.new(name, None)
    link(group)
    for obj in imported:
        if obj.parent is None:
            obj.parent = group
    mark_model(group, imported)
    return group, imported




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
    """
    A bevel's width in the object's own lengths, given as the scene has it:
    at most half the object's thinnest side, past which the bevel rounds the
    shape away. On a part the scene stretches unevenly it is the narrowest it is.
    """
    width = number(value, "bevel width", minimum=1e-7)
    bpy.context.view_layer.update()
    reach = scene_scale(obj)
    own = width / min(reach)
    corners = [mathutils.Vector(c) for c in obj.bound_box]
    sides = [max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(3)]
    thinnest = min((i for i in range(3) if sides[i] > 1e-9), key=lambda i: sides[i], default=None)
    need(
        thinnest is None or own <= sides[thinnest] / 2 * (1 + 1e-6),
        f"A {length(width)} bevel is more than half of “{obj.name}”'s thinnest side, "
        f"{length(sides[thinnest] * reach[thinnest]) if thinnest is not None else 0}: "
        f"the most it can round is {length(sides[thinnest] / 2 * min(reach)) if thinnest is not None else 0}.",
    )
    return own


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
