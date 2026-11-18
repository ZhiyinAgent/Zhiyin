"""
Texel density: how many of a picture's pixels lie on each centimetre of an object's surface, read
from its layout and the picture's size, against how many pixels of the camera's picture one
centimetre of it fills at its nearest point in view. Fewer texture pixels than the shot shows draw
blurred; many more are memory the shot never shows.
"""

import bpy
import numpy

from .finding import scene
from .uv_checks import layout_per_metre
from .wording import length

# A texture is said to be blurred below one of its pixels for each pixel of the picture, and wasted past this many.
WASTED = 2.0
# The most points of a shape looked at to find its nearest in view.
SAMPLED = 4000


def layout_scale(node):
    """How many times a picture repeats across its layout: 1, or a Mapping node's scale on the way from the layout."""
    vector = node.inputs.get("Vector")
    if vector is None or not vector.is_linked:
        return 1.0
    scale, waiting, seen = 1.0, [vector.links[0].from_node], set()
    while waiting:
        source = waiting.pop()
        if source.as_pointer() in seen:
            continue
        seen.add(source.as_pointer())
        if source.type == "UVMAP":
            return scale
        if source.type == "TEX_COORD":
            return scale if any(link.from_socket.name == "UV" for out in source.outputs for link in out.links) else None
        if source.type == "MAPPING":
            given = source.inputs.get("Scale")
            if given is not None and not given.is_linked:
                scale *= (abs(given.default_value[0]) + abs(given.default_value[1])) / 2
        waiting += [link.from_node for each in source.inputs for link in each.links]
    return None


def laid_pictures(obj):
    """The pictures an object's materials lay by its layout, each with how many times it repeats across it."""
    found = []
    for slot in getattr(obj, "material_slots", []):
        material = slot.material
        if material is None or material.node_tree is None:
            continue
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None and node.image.size[0] > 0:
                scale = layout_scale(node)
                if scale:
                    found.append((node.image, scale))
    return found


def pixels_per_metre(camera, points):
    """For each point, how many of the camera's picture's pixels one metre there fills across; 0 where it is not in view."""
    s = scene()
    data = camera.data
    frame = data.view_frame(scene=s)
    left, right, bottom, top = frame[2].x, frame[1].x, frame[1].y, frame[0].y
    depth = -frame[0].z
    across = s.render.resolution_x * s.render.resolution_percentage / 100
    to_camera = numpy.array(camera.matrix_world.normalized().inverted())
    local = numpy.asarray(points, dtype=numpy.float64) @ to_camera[:3, :3].T + to_camera[:3, 3]
    ahead = -local[:, 2]
    with numpy.errstate(divide="ignore", invalid="ignore"):
        scale = numpy.ones_like(ahead) if data.type == "ORTHO" else depth / numpy.where(ahead > 0, ahead, numpy.nan)
        x = (local[:, 0] * scale - left) / (right - left)
        y = (local[:, 1] * scale - bottom) / (top - bottom)
        fills = across * scale / (right - left)
    seen = (x >= 0) & (x <= 1) & (y >= 0) & (y <= 1) & (ahead >= data.clip_start) & (ahead <= data.clip_end)
    return numpy.where(seen, fills, 0.0), ahead


def surface_points(obj):
    """
    Points spread over an object's evaluated surface in the world, about SAMPLED of them, each
    triangle taking a share by its area, so a large face is looked at across it and not only at its corners.
    """
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        co = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float64)
        mesh.vertices.foreach_get("co", co)
        corners = numpy.empty(len(mesh.loop_triangles) * 3, dtype=numpy.int64)
        mesh.loop_triangles.foreach_get("vertices", corners)
    finally:
        evaluated.to_mesh_clear()
    matrix = numpy.array(obj.matrix_world)
    world = co.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
    if not len(corners):
        return world
    a, b, c = (world[corners.reshape(-1, 3)[:, k]] for k in range(3))
    areas = numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1) / 2
    total = float(areas.sum())
    if total <= 0:
        return world
    # A triangle too small for a point of its own is stood for by its corners.
    each = numpy.round(SAMPLED * areas / total).astype(numpy.int64)
    triangle = numpy.repeat(numpy.arange(len(areas)), each)
    starts = numpy.cumsum(each) - each
    k = numpy.arange(len(triangle)) - numpy.repeat(starts, each) + 0.5
    # Evenly spread places in a triangle, the same every time: a low-discrepancy sequence folded into it.
    u, v = (k * 0.754877666) % 1.0, (k * 0.569840291) % 1.0
    folded = u + v > 1
    u[folded], v[folded] = 1 - u[folded], 1 - v[folded]
    points = a[triangle] + (b - a)[triangle] * u[:, None] + (c - a)[triangle] * v[:, None]
    return numpy.concatenate([world[:: max(1, len(world) // SAMPLED)], points])


def texel_text(obj):
    """An object's texture detail per centimetre and what the shot needs of it, or nothing when it lays no picture by its layout."""
    if obj.type != "MESH":
        return None
    pictures = laid_pictures(obj)
    per_metre = layout_per_metre(obj) if pictures else None
    if not per_metre:
        return None
    image, repeats = max(pictures, key=lambda p: p[0].size[0] * p[1])
    density = per_metre * repeats * image.size[0] / 100
    name = bpy.path.basename(image.filepath) or image.name
    said = f"texture {density:.3g} px/cm ({name}, {image.size[0]} px across)"
    camera = scene().camera
    if camera is None:
        return said
    points = surface_points(obj)
    if not len(points):
        return said
    fills, ahead = pixels_per_metre(camera, points)
    nearest = int(numpy.argmax(fills))
    need = float(fills[nearest]) / 100
    if need <= 0:
        return said + ", not in the camera's view"
    said += f"; the shot needs up to {need:.3g} px/cm, at its nearest point in view {length(float(ahead[nearest]))} from the camera"
    if density < need:
        return said + ": blurred there"
    if density > WASTED * need:
        return said + f": {density / need:.3g}× more than the shot shows"
    return said
