"""
Imprinting: an outline, a text or a curve pressed onto a mesh's surface along a direction, cut
into its faces, and raised or sunk when asked; the new faces come back as a pick.

The cut is Blender's own intersect, run as a knife: walls standing on the outline, reaching from
outside the mesh down to just past the surface they meet first, are cut into the mesh, then taken
away, leaving their trace in its faces. A Blender without a window cannot project a knife through
a view, and this needs none.
"""

import bmesh
import bpy
import mathutils
from mathutils.bvhtree import BVHTree

from .arguments import need, number, vector
from .errors import Refused
from .finding import find_object
from .making import from_curve, system_cjk_font
from .mesh_edits import changes, edge_runs, extrude, heading, in_order, said, tally, world_shape, write
from .picking import Picked, mesh_object, spread
from .picking import direction as direction_given
from .reports import report
from .wording import area_text, length, point_text

TAG = "zhiyin_imprint"
# The two world axes an outline's [a, b] points lie along, across a direction along one axis.
ACROSS = {0: (1, 2), 1: (0, 2), 2: (0, 1)}
# Points along an outline are tried on the surface at most this share of the mesh's size apart.
SAMPLE_SHARE = 1 / 64


def frame(way):
    """Two directions across `way`, the second as near the world's up as can be, for lettering to read the right way round."""
    up = mathutils.Vector((0, 0, 1)) if abs(way.z) < 0.9 else mathutils.Vector((0, 1, 0))
    up = (up - way * up.dot(way)).normalized()
    return way.cross(up).normalized(), up


def outline_loop(points, way):
    """An outline's points in the world: [x, y, z] as given, or [a, b] along the two world axes across an axis direction."""
    need(isinstance(points, (list, tuple)) and len(points) >= 3, "outline must list at least 3 points.")
    flat = all(isinstance(p, (list, tuple)) and len(p) == 2 for p in points)
    if not flat:
        return [vector(p, "Each point of outline") for p in points]
    axis = next((i for i in range(3) if abs(abs(way[i]) - 1) < 1e-9), None)
    need(
        axis is not None,
        "An outline of [a, b] points is pressed along an axis, such as -z; along another direction give [x, y, z] points.",
    )
    first, second = ACROSS[axis]
    loop = []
    for p in points:
        flat_point = vector(p, "Each point of outline", 2)
        place = mathutils.Vector((0, 0, 0))
        place[first], place[second] = flat_point
        loop.append(place)
    return loop


def contours_of(shape):
    """A flat shape's outlines: each closed run of its open edges, as its points in order."""
    loops = []
    for run, closed, _ in edge_runs([e for e in shape.edges if len(e.link_faces) < 2]):
        if closed:
            loops.append([v.co.copy() for v in in_order(run)[1]])
    return loops


def text_loops(body, height, at, way):
    """A text's letters as outlines, `height` high, centred on `at`, reading the right way when looked at along `way`."""
    need(isinstance(body, str) and body.strip(), "text must have letters in it.")
    curve = bpy.data.curves.new("Imprint text", "FONT")
    curve.body = body
    curve.size = height
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    font = system_cjk_font() if any(ord(c) >= 0x2E80 for c in body) else None
    if font:
        curve.font = bpy.data.fonts.load(font, check_existing=True)
    shape = from_curve(curve, "Imprint text")
    try:
        loops = contours_of(shape)
    finally:
        shape.free()
    need(loops, f"The text “{body}” has no letters with outlines to imprint.")
    across, up = frame(way)
    return [[at + across * p.x + up * p.y for p in loop] for loop in loops]


def curve_loops(name):
    """A curve object's closed outlines in the world, as drawn; an open one is refused."""
    obj = find_object(name, {"CURVE"}) if isinstance(name, str) else name
    need(isinstance(obj, bpy.types.Object) and obj.type == "CURVE", "curve takes a curve object or its name.")
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    shape = bmesh.new()
    try:
        shape.from_mesh(mesh)
        shape.transform(obj.matrix_world)
        if shape.faces:
            loops = contours_of(shape)
        else:
            runs = edge_runs(list(shape.edges))
            need(all(closed for _, closed, _ in runs), f"{obj.name} is open: an imprint follows a closed curve.")
            loops = [[v.co.copy() for v in in_order(run)[1]] for run, _, _ in runs]
    finally:
        shape.free()
        evaluated.to_mesh_clear()
    need(loops, f"{obj.name} draws no closed outline to imprint.")
    return loops


def flattened(loops, way):
    """The outlines laid in the plane through the world's origin across `way`."""
    return [[p - way * p.dot(way) for p in loop] for loop in loops]


def inside(point, loops, across, up):
    """Whether a point lies inside the outlines, seen along the way they are pressed: inside an odd number of them."""
    x, y = point.dot(across), point.dot(up)
    crossed = False
    for loop in loops:
        flat = [(p.dot(across), p.dot(up)) for p in loop]
        for (x1, y1), (x2, y2) in zip(flat, flat[1:] + flat[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                crossed = not crossed
    return crossed


def within_face(face):
    """
    A point inside a face, not on its edge: the middle of the first triangle it is drawn as. A
    face the knife has cut lies wholly inside an outline or wholly outside it, so this point says
    which, where its middle might lie on the other side.
    """
    corners = [v.co for v in face.verts]
    first = mathutils.geometry.tessellate_polygon([corners])[0]
    return sum((corners[i] for i in first), mathutils.Vector()) / 3


def samples(loops, step):
    """Points along the outlines no more than `step` apart."""
    found = []
    for loop in loops:
        for a, b in zip(loop, loop[1:] + loop[:1]):
            pieces = max(1, int((b - a).length / step) + 1)
            found += [a + (b - a) * (i / pieces) for i in range(pieces)]
    return found


def reach(target, loops, way):
    """
    Where the walls of the knife start and end along `way`: from outside the mesh to past the
    surface the outline meets first, short of the one behind it. Refused where the outline
    passes off the mesh.
    """
    shape, _ = world_shape(target)
    try:
        need(shape.faces, f"{target.name} has no faces to imprint onto.")
        tree = BVHTree.FromBMesh(shape)
        depths = [v.co.dot(way) for v in shape.verts]
    finally:
        shape.free()
    size = max(depths) - min(depths)
    lows = [min(p[i] for p in (q for loop in loops for q in loop)) for i in range(3)]
    highs = [max(p[i] for p in (q for loop in loops for q in loop)) for i in range(3)]
    span = max(size, max(h - lo for h, lo in zip(highs, lows)), 1e-6)
    start = min(depths) - 0.05 * span - 1e-4
    tried = samples(loops, max(span * SAMPLE_SHARE, 1e-6))
    first, behind, missed = [], [], []
    for point in tried:
        origin = point + way * start
        hit = tree.ray_cast(origin, way)
        if hit[0] is None:
            missed.append(point)
            continue
        first.append(hit[0].dot(way))
        onward = tree.ray_cast(hit[0] + way * (1e-6 * span), way)
        if onward[0] is not None:
            behind.append(onward[0].dot(way) - hit[0].dot(way))
    if missed:
        raise Refused(
            f"The outline passes off {target.name} along {heading(way)}: {len(missed)} of {len(tried)} points tried"
            f" along it meet nothing, as at {point_text(missed[0] + way * (min(depths)))}. Move it or shrink it to lie on the surface."
        )
    nearest, furthest = min(first), max(first)
    room = min(behind) if behind else span
    end = furthest + min(room / 2, 0.05 * span)
    if behind and end >= nearest + min(behind):
        raise Refused(
            f"The surface under the outline lies {length(furthest - nearest)} deep along {heading(way)}, deeper than"
            f" {target.name} is thick there, {length(min(behind))}: the knife would cut the far side too."
            " Imprint a smaller outline, or one on a flatter part."
        )
    return start, end


def walls(loops, way, start, end):
    """The knife's walls: for each outline a band of quads, from `start` to `end` along `way`."""
    return [([p + way * start for p in loop], [p + way * end for p in loop]) for loop in loops]


def cut_in(target, bands):
    """Cuts the walls into the mesh with Blender's intersect, as a knife, then takes them away."""
    mesh = target.data
    shape = bmesh.new()
    try:
        shape.from_mesh(mesh)
        loose_before = {tuple(round(c, 7) for c in v.co) for v in shape.verts if not v.link_faces}
        for element in (*shape.verts, *shape.edges, *shape.faces):
            element.select = False
        tag = shape.faces.layers.int.new(TAG)
        inverse = target.matrix_world.inverted()
        for low, high in bands:
            bottom = [shape.verts.new(inverse @ p) for p in low]
            top = [shape.verts.new(inverse @ p) for p in high]
            for i in range(len(bottom)):
                j = (i + 1) % len(bottom)
                face = shape.faces.new((bottom[i], bottom[j], top[j], top[i]))
                face[tag] = 1
                face.select = True
        shape.select_flush(True)
        shape.to_mesh(mesh)
    finally:
        shape.free()
    intersected(target)
    shape = bmesh.new()
    try:
        shape.from_mesh(mesh)
        tag = shape.faces.layers.int.get(TAG)
        bmesh.ops.delete(shape, geom=[f for f in shape.faces if f[tag]], context="FACES")
        stray = [v for v in shape.verts if not v.link_faces and tuple(round(c, 7) for c in v.co) not in loose_before]
        bmesh.ops.delete(shape, geom=stray, context="VERTS")
        shape.faces.layers.int.remove(tag)
        shape.to_mesh(mesh)
    finally:
        shape.free()
    mesh.update()


def intersected(target):
    """Runs Blender's intersect on the target in edit mode, the selected walls cutting the rest, and puts things back as they were."""
    layer = bpy.context.view_layer
    active, selected = layer.objects.active, [o for o in layer.objects if o.select_get()]
    hidden, hidden_viewport = target.hide_get(), target.hide_viewport
    target.hide_set(False)
    target.hide_viewport = False
    for obj in selected:
        obj.select_set(False)
    target.select_set(True)
    layer.objects.active = target
    try:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=[target], selected_editable_objects=[target]):
            bpy.ops.object.mode_set(mode="EDIT")
            try:
                bpy.ops.mesh.intersect(mode="SELECT_UNSELECT", separate_mode="CUT", solver="EXACT")
            finally:
                bpy.ops.object.mode_set(mode="OBJECT")
    finally:
        target.select_set(False)
        for obj in selected:
            obj.select_set(True)
        layer.objects.active = active
        target.hide_set(hidden)
        target.hide_viewport = hidden_viewport


def imprint(target, outline=None, *, text=None, curve=None, direction="-z", depth=0, at=None, height=0.1):
    """
    Presses an outline, a text or a closed curve onto `target` along `direction` and cuts it into
    the surface it meets first, as a knife projected through a view would; `depth` then raises the
    faces inside it (sinks them, for less than 0). Says what it cut, the faces inside and their
    area, and hands back a pick of them, raised or sunk when asked.
    """
    obj = mesh_object(target, "imprint")
    given = [name for name, value in (("outline", outline), ("text", text), ("curve", curve)) if value is not None]
    need(len(given) == 1, "imprint takes one of outline, text and curve.")
    way = direction_given(direction, "direction")
    deep = number(depth, "depth", default=0)
    if outline is not None:
        loops = [outline_loop(outline, way)]
        what = f"an outline of {len(outline)} points"
    elif text is not None:
        tall = number(height, "height", minimum=1e-6)
        if at is None:
            shape, _ = world_shape(obj)
            try:
                corners = [v.co for v in shape.verts]
                middle = sum(corners, mathutils.Vector()) / max(len(corners), 1)
            finally:
                shape.free()
        else:
            middle = vector(at, "at")
        loops = text_loops(text, tall, middle, way)
        what = f"the text “{text}”, {length(tall)} high"
    else:
        loops = curve_loops(curve)
        what = f"the curve {curve if isinstance(curve, str) else curve.name}"
    loops = flattened(loops, way)
    start, end = reach(obj, loops, way)
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        ngons_before = sum(1 for f in shape.faces if len(f.verts) > 4)
    finally:
        shape.free()
    cut_in(obj, walls(loops, way, start, end))
    across, up = frame(way)
    shape, matrix = world_shape(obj)
    try:
        after = tally(shape)
        within = [
            f
            for f in shape.faces
            if f.normal.dot(way) < 0
            and start <= f.calc_center_median().dot(way) <= end
            and inside(within_face(f), loops, across, up)
        ]
        need(within, f"The imprint cut {obj.name}'s faces but left none inside the outline: it may be too small for the faces under it.")
        area = sum(f.calc_area() for f in within)
        corners = [v.co.copy() for f in within for v in f.verts]
        ngons = sum(1 for f in shape.faces if len(f.verts) > 4) - ngons_before
        chosen = write(obj, shape, matrix, "faces", within)
    finally:
        shape.free()
    report(
        f"Imprinted {what} onto {obj.name} along {heading(way)}: {changes(before, after)};"
        f" {said(len(chosen), 'faces')} inside it, {area_text(area)}, at {spread(corners)}"
        + (f"; the cut left {ngons} more face{'s' if ngons != 1 else ''} of more than four sides" if ngons > 0 else "")
        + (f"; {'raised' if deep > 0 else 'sunk'} {length(abs(deep))}, as the next line says." if deep else ".")
    )
    picked = Picked(obj, "faces", chosen)
    return extrude(picked, deep) if deep else picked


FUNCTIONS = (imprint,)
