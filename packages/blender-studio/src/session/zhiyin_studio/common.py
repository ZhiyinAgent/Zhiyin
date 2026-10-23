"""What every part of the session shares: refusals, units, colours, names."""

import contextlib
import math
import os
import sys
import traceback

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

CUTTERS = "Cutters"
LIGHTING = "Lighting"
PREVIEW = "Zhiyin preview"
# Kept on what fills a plan's cut: the name of the shape it was cut from.
CUT_OF = "zhiyin_cut_of"


class Refused(Exception):
    """A request that cannot be done as asked. Its message is for the model."""


# A material with the wood finish holds its amount in a node of this name.
WOOD = "Zhiyin wood"


def wood_of(material):
    """How much grain a material was given as wood, or 0."""
    if material is None or not material.use_nodes or material.node_tree is None:
        return 0
    node = material.node_tree.nodes.get(WOOD)
    return node.outputs[0].default_value if node is not None else 0


def keep_error(what, error):
    """Writes an error the work carries on past to the session's own log, where it can be found afterwards."""
    print(f"{what}:", file=sys.stderr)
    traceback.print_exception(error, file=sys.stderr)
    sys.stderr.flush()


def one_of(names):
    """Names as a choice between them: a, b or c."""
    names = list(names)
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} or {names[-1]}"


def need(condition, message):
    if not condition:
        raise Refused(message)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def number(value, name, *, minimum=None, maximum=None, default=None):
    if value is None:
        need(default is not None, f"{name} is required.")
        return float(default)
    need(is_number(value), f"{name} must be a number.")
    if minimum is not None:
        need(value >= minimum, f"{name} must be at least {minimum}.")
    if maximum is not None:
        need(value <= maximum, f"{name} must be at most {maximum}.")
    return float(value)


def whole(value, name, *, minimum=1, maximum=1000, default=None):
    found = number(value, name, minimum=minimum, maximum=maximum, default=default)
    need(float(found).is_integer(), f"{name} must be a whole number.")
    return int(found)


def vector(value, name, length=3, default=None):
    if value is None:
        need(default is not None, f"{name} is required.")
        return mathutils.Vector(default)
    need(
        isinstance(value, (list, tuple)) and len(value) == length and all(is_number(v) for v in value),
        f"{name} must be a list of {length} numbers.",
    )
    return mathutils.Vector([float(v) for v in value])


def positive_size(value, name, default=None, length=3):
    found = vector(value, name, length, default)
    need(all(c > 0 for c in found), f"Every value of {name} must be greater than 0.")
    return found


def rotation(value, name="rotation", default=(0, 0, 0)):
    """Degrees, as people give them, to Blender's radians."""
    found = vector(value, name, default=default)
    return mathutils.Euler([math.radians(c) for c in found], "XYZ")


def points(value, name, dimensions, minimum):
    need(isinstance(value, (list, tuple)) and len(value) >= minimum, f"{name} must list at least {minimum} points.")
    return [vector(p, f"Each point of {name}", dimensions) for p in value]


def colour(value, name, default=None):
    """A colour written as #rrggbb, in sRGB, as Blender's linear RGBA."""
    if value is None:
        need(default is not None, f"{name} is required.")
        value = default
    text = value.strip().lstrip("#") if isinstance(value, str) else ""
    need(
        len(text) == 6 and all(c in "0123456789abcdefABCDEF" for c in text),
        f"{name} must be a colour written like #c0392b.",
    )

    def linear(byte):
        c = byte / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(linear(int(text[i : i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


def hex_of(rgba):
    def srgb(c):
        c = max(0.0, min(1.0, c))
        return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

    return "#" + "".join(f"{round(srgb(c) * 255):02x}" for c in rgba[:3])


def clean(value):
    """Less than a thousandth of a millimetre is arithmetic, not a size or a position."""
    value = float(value)
    return 0.0 if abs(value) < 1e-6 else value


def length(metres):
    metres = clean(metres)
    return f"{metres * 1000:.4g} mm" if abs(metres) < 1 else f"{metres:.4g} m"


def area_text(square_metres):
    """An area in the unit that keeps it a plain number: mm², cm², then m²."""
    if square_metres < 1e-4:
        return f"{square_metres * 1e6:.4g} mm²"
    if square_metres < 1:
        return f"{square_metres * 1e4:.4g} cm²"
    return f"{square_metres:.4g} m²"


def volume_text(cubic_metres):
    """A volume in the unit that keeps it a plain number: cm³, litres, then m³."""
    if cubic_metres < 1e-3:
        return f"{cubic_metres * 1e6:.4g} cm³"
    if cubic_metres < 1:
        return f"{cubic_metres * 1e3:.4g} L"
    return f"{cubic_metres:.4g} m³"


def size_text(values):
    values = [clean(v) for v in values]
    if max(abs(v) for v in values) < 1:
        return " × ".join(f"{v * 1000:.4g}" for v in values) + " mm"
    return " × ".join(f"{v:.4g}" for v in values) + " m"


def point_text(values):
    values = [clean(v) for v in values]
    if max(abs(v) for v in values) < 1:
        return "(" + ", ".join(f"{v * 1000:.4g}" for v in values) + " mm)"
    return "(" + ", ".join(f"{v:.4g}" for v in values) + " m)"


def scene():
    return bpy.context.scene


# The kinds of data Blender reads from a file on disk rather than from the scene.
FILE_DATA = ("images", "libraries", "fonts", "sounds", "movieclips", "volumes", "cache_files")


def files_read():
    """
    Every file on disk the scene reads or has read, by its full path: a file
    packed into the scene was read to pack it.
    """
    paths = set()
    for kind in FILE_DATA:
        for block in getattr(bpy.data, kind):
            path = getattr(block, "filepath", "")
            if not path or path == "<builtin>":
                continue
            paths.add(os.path.realpath(bpy.path.abspath(path, library=block.library)))
    return paths


def outside(paths, folder):
    """
    The paths that are not inside a folder. Each is compared where it really
    is, with its names as the folders store them, so a folder named like this
    one but for case, which a folder that tells case apart can hold, is outside.
    """
    root = os.path.realpath(folder)
    below = root if root.endswith(os.sep) else root + os.sep

    def within(path):
        real = os.path.realpath(path)
        return real == root or real.startswith(below)

    return sorted(path for path in paths if not within(path))


# How the scene's light becomes the picture's colours: the tools' names for
# Blender's view transforms.
TONES = {"agx": "AgX", "neutral": "Khronos PBR Neutral", "standard": "Standard"}


def set_tone(name):
    need(name in TONES, f"tone is one of {', '.join(TONES)}.")
    settings = scene().view_settings
    settings.view_transform = TONES[name]
    settings.look = "None"


def tone_text():
    """The picture's tone and, when it is not 0, its exposure."""
    settings = scene().view_settings
    named = next((k for k, v in TONES.items() if v == settings.view_transform), settings.view_transform)
    said = f"{named} tone"
    if abs(settings.exposure) > 1e-6:
        said += f", exposure {settings.exposure:+g}"
    return said


def in_collection(obj, name):
    return any(c.name == name for c in obj.users_collection)


def is_helper(obj):
    """Objects that serve the scene rather than appear in it."""
    return in_collection(obj, CUTTERS) or obj.name.startswith(PREVIEW)


def is_backdrop(obj):
    """The product lighting's backdrop, which its preset marks, whatever it is named."""
    return bool(obj.get("zhiyin_preset")) and obj.type == "MESH"


def scene_objects():
    return [o for o in scene().objects if not o.name.startswith(PREVIEW)]


def find_object(name, kinds=None):
    need(isinstance(name, str) and name.strip(), "Name an object.")
    found = bpy.data.objects.get(name)
    if found is None or found.name not in scene().objects:
        names = [o.name for o in scene_objects() if not is_helper(o)][:40]
        listed = f" The scene has: {', '.join(names)}." if names else " The scene is empty."
        raise Refused(f"There is no object named “{name}”.{listed}")
    if kinds:
        need(found.type in kinds, f"“{name}” is a {found.type.lower()}, and this needs a {' or '.join(k.lower() for k in kinds)}.")
    return found


def unused_name(name):
    need(isinstance(name, str) and name.strip(), "Each object needs a name.")
    need(bpy.data.objects.get(name) is None, f"An object named “{name}” already exists. Choose another name, or edit it.")
    return name


def collection(name, hide_render=False):
    found = bpy.data.collections.get(name)
    if found is None:
        found = bpy.data.collections.new(name)
        scene().collection.children.link(found)
    found.hide_render = hide_render
    return found


def link(obj, into=None):
    (into or scene().collection).objects.link(obj)
    return obj


SHAPE_TYPES = {"MESH", "CURVE", "FONT", "SURFACE", "META"}


def world_corners(objects):
    """The corners of each visible shape's box, in world space."""
    corners = []
    for obj in objects:
        if obj.type not in SHAPE_TYPES or is_helper(obj) or obj.hide_render:
            continue
        corners.extend(obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box)
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

    def __init__(self):
        self.children = {}
        for o in bpy.data.objects:
            if o.parent is not None:
                self.children.setdefault(o.parent.as_pointer(), []).append(o)
        self.parts, self.held, self.boxes, self.measured = {}, {}, {}, {}

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


@contextlib.contextmanager
def held_still():
    """Reads the scene within as it is now, each object's parts and box worked out once."""
    global still
    if still is not None:
        yield
        return
    bpy.context.view_layer.update()
    still = Still()
    try:
        yield
    finally:
        still = None


def parts_below(obj):
    """Every part an object holds, and the parts they hold."""
    return still.parts_of(obj) if still is not None else obj.children_recursive


def holds(obj, other):
    """Whether `other` is one of an object's parts, or a part of one."""
    return still.holds(obj, other) if still is not None else other in obj.children_recursive


def shapes_of(obj):
    """An object's own shape and those of the parts it holds, such as an imported model's."""
    return [o for o in [obj, *parts_below(obj)] if o.type in SHAPE_TYPES and not is_helper(o)]


def bounds_of(obj):
    """The box round an object and its parts, in world space, whether or not it is rendered."""
    if still is not None and obj.as_pointer() in still.boxes:
        return still.boxes[obj.as_pointer()]
    corners = [o.matrix_world @ mathutils.Vector(c) for o in shapes_of(obj) for c in o.bound_box]
    box = None
    if corners:
        low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
        high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
        box = low, high
    if still is not None:
        still.boxes[obj.as_pointer()] = box
    return box


def own_size(obj):
    """
    An object's size along its own axes, before it is turned, as adding and
    resizing give it: its shape's, or for a group its parts' together.
    """
    if obj.type in SHAPE_TYPES:
        return mathutils.Vector(obj.dimensions)
    parts = shapes_of(obj)
    if not parts:
        return None
    to_own = obj.matrix_world.inverted()
    corners = [to_own @ part.matrix_world @ mathutils.Vector(c) for part in parts for c in part.bound_box]
    scale = obj.matrix_world.decompose()[2]
    return mathutils.Vector(
        [(max(c[i] for c in corners) - min(c[i] for c in corners)) * abs(scale[i]) for i in range(3)]
    )


def turned_text(obj):
    """How an object is turned in the world, or nothing when it is not."""
    # To a hundredth of a degree: what is left beyond is arithmetic, not a turn.
    turned = [round(math.degrees(a), 2) + 0.0 for a in obj.matrix_world.decompose()[1].to_euler()]
    return "turned (" + ", ".join(f"{a:g}°" for a in turned) + ")" if any(turned) else None


def middle_of(obj):
    """The middle of an object's box: what aiming or focusing at it means."""
    bounds = bounds_of(obj)
    return (bounds[0] + bounds[1]) / 2 if bounds else obj.matrix_world.translation.copy()


def heights_text(obj):
    """Where an object's bottom and top are, which its location alone does not say."""
    bounds = bounds_of(obj)
    if not bounds:
        return None
    return f"from {length(bounds[0].z)} to {length(bounds[1].z)} high"


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


def add_part(bm, part, depsgraph):
    """Adds one part's evaluated shape to a mesh, in world space."""
    evaluated = part.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        before = len(bm.verts)
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        added = [bm.verts[i] for i in range(before, len(bm.verts))]
        bmesh.ops.transform(bm, matrix=part.matrix_world, verts=added)
        welded(bm, added)
    finally:
        evaluated.to_mesh_clear()


def world_mesh(obj):
    """An object's evaluated shape, with its parts', as one mesh in world space."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for part in shapes_of(obj):
        add_part(bm, part, depsgraph)
    return bm


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


def outline_points(obj):
    """The corners of an object's shape, with its parts', in world space."""
    shape = world_mesh(obj)
    try:
        return hull_points(shape)
    finally:
        shape.free()


def sampled(verts, limit=6000):
    """Up to `limit` of a mesh's points, spread evenly, so measuring stays quick on a dense mesh."""
    step = max(1, len(verts) // limit)
    return [v.co.copy() for v in list(verts)[::step]]


DEEP_ENOUGH = 0.0005
# How much of a thin sheet's thickness its points are moved in by.
THIN_SHARE = 0.25
# Three ways out of a shape, none along an axis or a diagonal: a ray that runs
# along a face or through an edge miscounts, and the other two outvote it.
WAYS_OUT = [mathutils.Vector(v).normalized() for v in ((0.8, 0.36, 0.48), (-0.31, 0.88, 0.36), (0.27, -0.42, 0.87))]


def crossings(tree, point, way):
    count = 0
    start = point
    for _ in range(64):
        hit, _, _, _ = tree.ray_cast(start, way)
        if hit is None:
            break
        count += 1
        # Past the surface by more than the precision a tree keeps at that
        # distance from the origin, or the ray meets the same face again.
        start = hit + way * (1e-6 + 1e-6 * hit.length)
    return count


def is_inside(tree, point):
    """Whether a point is inside a closed shape: rays from it cross the surface an odd number of times, two of three agreeing."""
    votes = [crossings(tree, point, way) % 2 for way in WAYS_OUT[:2]]
    if votes[0] != votes[1]:
        votes.append(crossings(tree, point, WAYS_OUT[2]) % 2)
    return sum(votes) >= 2


class Measured:
    """
    A shape as overlaps are measured: its surface, whether it is closed, and
    points over it, from its corners and the middles of its faces, moved half
    a millimetre in, so a shape resting on or against another is not in it.
    A sheet thinner than that, such as a label or lettering, is moved in by
    part of its thickness instead: by more, its points come out the far side.
    Each part is moved in by its own measure, so lettering attached to a jar
    is still a thin sheet.
    """

    def __init__(self, obj):
        self.box = bounds_of(obj)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        corners, moved, polygons = [], [], []
        self.closed, self.area, self.points, self.faces = True, 0.0, [], []
        for part in shapes_of(obj):
            shape = bmesh.new()
            try:
                add_part(shape, part, depsgraph)
                closed = bool(shape.edges) and all(e.is_manifold for e in shape.edges)
                self.closed = self.closed and closed
                area = sum(face.calc_area() for face in shape.faces)
                self.area += area
                inset = DEEP_ENOUGH
                if closed and area > 0:
                    # A sheet is as thick as twice its volume over its area.
                    inset = min(DEEP_ENOUGH, THIN_SHARE * 2 * abs(shape.calc_volume()) / area)
                shape.normal_update()
                shape.verts.index_update()
                step = max(1, len(shape.faces) // 6000)
                # Each face by its middle, the way it faces, and the area it stands for.
                self.faces += [(f.calc_center_median(), f.normal.copy(), f.calc_area() * step) for f in list(shape.faces)[::step]]
                polygons += [[len(corners) + v.index for v in face.verts] for face in shape.faces]
                corners += [v.co.copy() for v in shape.verts]
                for vert in shape.verts:
                    vert.co -= vert.normal * inset
                moved += [v.co.copy() for v in shape.verts]
                # Each point with how far it was moved in.
                self.points += [(p, inset) for p in sampled(shape.verts) + [f.calc_center_median() for f in list(shape.faces)[::step]]]
            finally:
                shape.free()
        self.closed = self.closed and bool(polygons)
        self.surface = mathutils.bvhtree.BVHTree.FromPolygons(corners, polygons)
        self.inner = mathutils.bvhtree.BVHTree.FromPolygons(moved, polygons)

    def depth_of(self, points):
        """
        How deep the deepest of another shape's `points` is inside this closed
        one, counted from where the point was before it was moved in; 0 when
        none is inside.
        """
        deepest = 0.0
        if not self.closed:
            return deepest
        low, high = self.box
        for point, moved_in in points:
            if not all(low[i] <= point[i] <= high[i] for i in range(3)):
                continue
            location, _, _, distance = self.surface.find_nearest(point)
            if location is not None and distance + moved_in > deepest and is_inside(self.surface, point):
                deepest = distance + moved_in
        return deepest


def goes_into(obj, others):
    """
    Which of `others` an object goes into, and how deep when either has a
    point inside the other, closed one: as deep from either side.
    """
    with held_still():
        own = bounds_of(obj)
        if not own:
            return []
        near = [
            other
            for other in others
            # Its own parts, and a group it is a part of, are the same thing.
            if other != obj and not holds(obj, other) and not holds(other, obj)
            and (theirs := bounds_of(other))
            and all(own[1][i] >= theirs[0][i] and own[0][i] <= theirs[1][i] for i in range(3))
        ]
        if not near:
            return []
        return measured_into(obj, near)


def measured(obj):
    """An object's Measured, kept while the scene is held still."""
    if still is None:
        return Measured(obj)
    key = obj.as_pointer()
    if key not in still.measured:
        still.measured[key] = Measured(obj)
    return still.measured[key]


def measured_into(obj, near):
    """Which of the shapes near an object it goes into, and how deep."""
    mine = measured(obj)
    found = []
    for other in near:
        theirs = measured(other)
        depths = [deep for deep in (theirs.depth_of(mine.points), mine.depth_of(theirs.points)) if deep > 0]
        if depths or mine.inner.overlap(theirs.surface):
            found.append((other, max(depths) if depths else None))
    return found


def into_text(obj, others, most=None):
    """
    What an object goes into, each with how deep. With `most`, the deepest
    that many and a count of the rest: a part joined from many, as a script
    makes them, goes into a dozen neighbours and names none of them usefully.
    """
    found = goes_into(obj, others)
    rest = 0
    if most is not None and len(found) > most:
        found = sorted(found, key=lambda pair: pair[1] or 0, reverse=True)
        rest = len(found) - most
        found = found[:most]
    said = [f"goes {length(depth)} into {other.name}" if depth else f"goes into {other.name}" for other, depth in found]
    return said + ([f"goes into {rest} more"] if rest else [])


def subjects():
    """What a picture is of: shapes, without the lights' backdrop or helpers."""
    return [o for o in scene_objects() if not is_helper(o) and not o.hide_render and not in_collection(o, LIGHTING)]


def lets_light_through(obj):
    """Whether an object lets light through it, as glass or a liquid does."""
    for slot in getattr(obj, "material_slots", []):
        material = slot.material
        nodes = material.node_tree.nodes if material and material.use_nodes and material.node_tree else []
        surface = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if surface is not None and surface.inputs["Transmission Weight"].default_value > 0:
            return True
    return False


# Surfaces nearer than this are in the same place to a renderer.
SAME_PLACE = 1e-6
# The share of the smaller shape's surface that has to be there for a picture to show it.
SHARED_ENOUGH = 0.01


def shared_surface(mine, theirs):
    """How much of one shape's surface lies in the very place of another's, facing the same way or against it."""
    shared = 0.0
    for middle, facing, area in mine.faces:
        location, normal, _, distance = theirs.surface.find_nearest(middle, SAME_PLACE * 100)
        if location is not None and distance < SAME_PLACE and abs(normal.dot(facing)) > 0.999:
            shared += area
    return shared


def in_the_same_place():
    """
    Pairs of see-through shapes with surfaces in the very same place, each as
    a sentence. A renderer cannot tell which of the two a ray meets first
    there, and draws wedges of one and of the other. Where one of the two is
    solid it hides the place, and nothing shows.
    """
    bpy.context.view_layer.update()
    clear = [(obj, bounds_of(obj)) for obj in subjects() if lets_light_through(obj)]
    measured = {}
    said = []
    for index, (one, own) in enumerate(clear):
        for other, theirs in clear[index + 1 :]:
            # A part and what it is attached to are measured as one shape.
            if one in other.children_recursive or other in one.children_recursive or not (own and theirs):
                continue
            if not all(own[1][i] >= theirs[0][i] - SAME_PLACE and own[0][i] <= theirs[1][i] + SAME_PLACE for i in range(3)):
                continue
            for obj in (one, other):
                if obj.name not in measured:
                    measured[obj.name] = Measured(obj)
            first, second = measured[one.name], measured[other.name]
            # A face counts whole when its middle is there, so the side with
            # the finer faces, which counts less, is the nearer measure.
            counted = [area for area in (shared_surface(first, second), shared_surface(second, first)) if area > 0]
            shared = min(counted, default=0.0)
            if shared > SHARED_ENOUGH * min(first.area, second.area):
                said.append(
                    f"{one.name} and {other.name} are both see-through and have {area_text(shared)} of their surfaces in the same place, "
                    "where a picture shows wedges of one and of the other: let one reach a fraction of a millimetre into the other."
                )
    return said


# How far from straight up or down a direction may lean and still count as it,
# as the sine of the angle.
VERTICAL = 1e-3


def vertical(way):
    way = mathutils.Vector(way).normalized()
    return math.hypot(way.x, way.y) < VERTICAL


def upright(way, ahead=(0, 1, 0)):
    """
    The turn of a camera or a light that looks back along `way` with the
    world's up up its picture. Looking straight down or up there is no such
    up, and the level direction `ahead` is up the picture instead: +y, as a
    plan reads, unless another is given.
    """
    back = mathutils.Vector(way).normalized()
    right = mathutils.Vector((0, 0, 1)).cross(back)
    if right.length < VERTICAL:
        right = mathutils.Vector(ahead).cross(back)
    right.normalize()
    return mathutils.Matrix((right, back.cross(right), back)).transposed().to_quaternion()


def look_at(obj, target):
    direction = mathutils.Vector(target) - obj.location
    if direction.length < 1e-9:
        return
    obj.rotation_euler = upright(-direction).to_euler()


def reaim(obj):
    """A light stays aimed at the point it was aimed at, wherever it is moved."""
    if obj.type == "LIGHT" and obj.get("zhiyin_aim") is not None:
        look_at(obj, mathutils.Vector(obj["zhiyin_aim"]))


def refocus(camera):
    """Keeps a camera focused on the middle of the object it was focused on, wherever either has moved."""
    data = camera.data
    name = data.get("zhiyin_focus")
    if not name:
        return
    target = bpy.data.objects.get(name)
    if target is None:
        del data["zhiyin_focus"]
        return
    bpy.context.view_layer.update()
    forward = camera.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))
    data.dof.focus_distance = max(0.001, (middle_of(target) - camera.matrix_world.translation).dot(forward))


def lens_shift(data):
    """A camera's lens shift in words, or nothing when its lens is not shifted."""
    if abs(data.shift_x) < 1e-6 and abs(data.shift_y) < 1e-6:
        return ""
    return f"lens shifted {round(data.shift_x, 4):g} across and {round(data.shift_y, 4):g} up"


def place_to_fit(camera, direction, corners, aspect, margin, ahead=(0, 1, 0)):
    """
    Puts the camera along a direction, as close as it can be with every corner
    in the picture, and moves it across so the corners are centred: as much
    space on each side of them. An orthographic camera is widened to fit them
    instead of moved closer. Straight down, `ahead` is up the picture. A
    shifted lens looks to one side of where the camera points, by its shift
    times the picture's longer side; the corners are centred in what it sees.
    """
    points = numpy.array([tuple(c) for c in corners], dtype=float)
    low = mathutils.Vector(points.min(axis=0))
    high = mathutils.Vector(points.max(axis=0))
    centre = (low + high) / 2
    reach = (high - low).length
    data = camera.data
    fill = 1 - margin
    way = mathutils.Vector(direction).normalized()
    turn = upright(way, ahead)
    right = turn @ mathutils.Vector((1, 0, 0))
    up = turn @ mathutils.Vector((0, 1, 0))
    offsets = points - numpy.array(centre)
    # How far toward the camera, to its right and up each corner is.
    toward = offsets @ numpy.array(way)
    across = offsets @ numpy.array(right)
    upward = offsets @ numpy.array(up)
    if data.type == "ORTHO":
        wide, tall = float(numpy.ptp(across)), float(numpy.ptp(upward))
        # The orthographic scale is the picture's longer side.
        longest = max(wide, tall * aspect) if aspect >= 1 else max(tall, wide / aspect)
        data.ortho_scale = max(longest / fill, 1e-3)
        distance = float(toward.max()) + max(reach, 0.1)
        sideways = (across.max() + across.min()) / 2 - data.shift_x * data.ortho_scale
        lift = (upward.max() + upward.min()) / 2 - data.shift_y * data.ortho_scale
    else:
        half = data.sensor_width / (2 * data.lens)
        tan_h, tan_v = (half, half / aspect) if aspect >= 1 else (half * aspect, half)
        tan_h, tan_v = tan_h * fill, tan_v * fill
        # Where the middle of the picture is, as a slope from where the camera points.
        mid_h, mid_v = data.shift_x * 2 * half, data.shift_y * 2 * half
        # Seen from a camera moved `a` to the right and `d` along the way, a
        # corner is in the picture while |(its across - a) / (d - its toward)
        # - mid| ≤ tan. The nearest d leaving room for some a, each way:
        reach_h = ((across + (tan_h + mid_h) * toward).max() - (across - (tan_h - mid_h) * toward).min()) / (2 * tan_h)
        reach_v = ((upward + (tan_v + mid_v) * toward).max() - (upward - (tan_v - mid_v) * toward).min()) / (2 * tan_v)
        distance = max(float(reach_h), float(reach_v), float(toward.max()) + 1e-3, 1e-3)
        depth = distance - toward
        sideways, lift = shift_to_centre(across, depth, mid_h), shift_to_centre(upward, depth, mid_v)
    camera.location = centre + right * float(sideways) + up * float(lift) + way * distance
    camera.rotation_euler = turn.to_euler()
    data.clip_start = max(distance / 1000, 0.0001)
    data.clip_end = distance + reach * 4 + 10
    return centre


def shift_to_centre(offsets, depth, mid=0.0):
    """
    How far to move a camera across so that, seen in perspective, the corner
    furthest one way is as far from the middle of the picture as the corner
    furthest the other way. `mid` is where that middle is, as a slope from
    where the camera points: nothing unless its lens is shifted.
    """
    span = float(offsets.max() - offsets.min()) + abs(mid) * float(depth.max())
    low, high = float(offsets.min()) - span, float(offsets.max()) + span
    for _ in range(60):
        middle = (low + high) / 2
        seen = (offsets - middle) / depth - mid
        if seen.max() + seen.min() > 0:
            low = middle
        else:
            high = middle
    return (low + high) / 2
