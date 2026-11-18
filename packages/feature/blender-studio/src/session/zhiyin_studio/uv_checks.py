"""
How a shape's faces lie in its picture, for a shape laid out for one: faces
turned over in it, faces stretched one way more than the other, how far the
picture's detail per centimetre varies over the shape, and faces with no
room in it, which show one colour. Measured on the shape with its steps, in
the world, against its active layout. Faces sharing room in the picture each
show the whole of it, as tiles do, and a mirror step turns over the faces it
makes, as it mirrors the picture with the shape: both are as meant, and only
a bake would be harmed by them. A layout by longitude and latitude, as a
sphere's, gathers its picture to a point at each pole by its nature, made
for a picture of a globe; its stretch and its detail are not counted.
"""

import numpy

from .shown_mesh import array, shown_data
from .wording import point_text

# A face is stretched when its picture runs this many times further one way than across.
STRETCHED = 2.0
# A face's picture detail varies past this many times between the shape's least and most detailed twentieths.
SPREAD = 2.0
# The share of the surface a fault must cover to be told, but for faces turned over or with no room.
WORTH = 0.02
# A layout is by longitude and latitude when this share of its corners lie within NEAR of where that puts them.
GLOBE_SHARE, NEAR = 0.98, 0.01


def picture_inputs(material):
    """Whether a material lays a picture by the shape's layout: an image read at no coordinates, or at a UV layout's."""
    if material is None or not material.use_nodes or material.node_tree is None:
        return False
    for node in material.node_tree.nodes:
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        vector = node.inputs.get("Vector")
        if vector is None or not vector.is_linked:
            return True
        waiting = [link.from_node for link in vector.links]
        seen = set()
        while waiting:
            source = waiting.pop()
            if source.name in seen:
                continue
            seen.add(source.name)
            if source.type == "UVMAP":
                return True
            if source.type == "TEX_COORD" and any(link.from_socket.name == "UV" for out in source.outputs for link in out.links):
                return True
            waiting += [link.from_node for each in source.inputs for link in each.links]
    return False


def lays_picture(obj):
    """Whether any of an object's materials lays a picture by its layout."""
    return any(picture_inputs(slot.material) for slot in getattr(obj, "material_slots", []))


def layout_key(obj):
    """What an object's active layout holds, to tell whether a call changed it."""
    if obj.type != "MESH" or obj.data.uv_layers.active is None:
        return None
    layer = obj.data.uv_layers.active
    values = numpy.empty(len(layer.uv) * 2, dtype=numpy.float32)
    layer.uv.foreach_get("vector", values)
    return (layer.name, len(values), hash(values.tobytes()))


def _laid(obj):
    """An object's triangles in the world and in its picture, whether it is mirrored, and whether its layout is a globe's; or None."""
    if obj.type != "MESH" or obj.data.uv_layers.active is None:
        return None
    with shown_data(obj) as mesh:
        layer = mesh.uv_layers.active
        if layer is None:
            return None
        mesh.calc_loop_triangles()
        if not len(mesh.loop_triangles):
            return None
        loops = array(mesh.loop_triangles, "loops", 3, numpy.int64).ravel()
        points = array(mesh.loop_triangles, "vertices", 3, numpy.int64).ravel()
        uv = array(layer.uv, "vector", 2, numpy.float64).ravel()
        co = array(mesh.vertices, "co", 3, numpy.float64).ravel()
    matrix = obj.matrix_world
    world = co.reshape(-1, 3) @ numpy.array(matrix.to_3x3()).T + numpy.array(matrix.translation)
    corners = world[points.reshape(-1, 3)]
    flat = uv.reshape(-1, 2)[loops.reshape(-1, 3)]
    globe = by_latitude(co.reshape(-1, 3)[points], uv.reshape(-1, 2)[loops])
    return corners, flat, matrix.to_3x3().determinant() < 0, globe


def uv_faults(obj):
    """What is wrong with how an object's faces lie in its picture, each in words, or an empty list."""
    laid = _laid(obj)
    if laid is None:
        return []
    mirror_step = any(m.type == "MIRROR" and m.show_viewport for m in obj.modifiers)
    return _faults(*laid, mirror_step=mirror_step)


def unfit_layout(obj):
    """
    Whether an object's layout cannot take a picture: none at all, its whole
    turned over, or more than WORTH of its surface with no room in it, as a
    curve's own layout gives lettering and an outline.
    """
    laid = _laid(obj)
    if laid is None:
        return True
    corners, flat, _, _ = laid
    area, signed, real = _areas(corners, flat, False)
    total = float(area[real].sum())
    if not total:
        return False
    roomless = real & (numpy.abs(signed) <= 1e-12)
    used = real & ~roomless
    return float(area[roomless].sum()) > WORTH * total or (used.any() and not (signed[used] > 0).any())


def layout_per_metre(obj):
    """
    How far an object's layout runs for each metre of its surface in the world, in picture
    widths, over the whole shape; None for a shape with no layout or none of its surface in it.
    """
    laid = _laid(obj)
    if laid is None:
        return None
    corners, flat, _, _ = laid
    area, signed, real = _areas(corners, flat, False)
    world, picture = float(area[real].sum()), float(numpy.abs(signed[real]).sum())
    if world <= 0 or picture <= 0:
        return None
    return (picture / world) ** 0.5


def by_latitude(points, uv):
    """
    Whether a layout is by longitude and latitude around the shape's own
    upright axis: across, the way around it, from any seam and either way;
    up, the height as an angle, either way up. Measured on its corners in its
    own box, so a sphere drawn out of round still counts.
    """
    if len(points) < 8:
        return False
    low, high = points.min(axis=0), points.max(axis=0)
    half = numpy.maximum((high - low) / 2, 1e-12)
    rounded = (points - (low + high) / 2) / half
    reach = numpy.linalg.norm(rounded, axis=1)
    if numpy.abs(reach - 1).max() > 0.05:
        return False
    height = numpy.clip(rounded[:, 2], -1, 1)
    # At a pole the way around is no way: those corners are left out.
    kept = numpy.abs(height) < 0.999
    around = numpy.arctan2(rounded[kept, 1], rounded[kept, 0]) / (2 * numpy.pi)
    up = numpy.arcsin(height) / numpy.pi + 0.5
    near = lambda gaps: float((gaps < NEAR).mean()) >= GLOBE_SHARE  # noqa: E731
    upright = near(numpy.abs(uv[:, 1] - up)) or near(numpy.abs(uv[:, 1] - (1 - up)))
    if not upright or not kept.any():
        return False
    for way in (around, -around):
        offset = numpy.mod(uv[kept, 0] - way, 1)
        middle = numpy.angle(numpy.exp(2j * numpy.pi * offset).mean()) / (2 * numpy.pi)
        gaps = numpy.abs(numpy.mod(offset - middle + 0.5, 1) - 0.5)
        if near(gaps):
            return True
    return False


def _areas(corners, flat, mirrored):
    """Each triangle's area in the world, its signed area in the picture, and whether it has any in the world."""
    normal = numpy.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    area = numpy.linalg.norm(normal, axis=1) / 2
    uv_a, uv_b = flat[:, 1] - flat[:, 0], flat[:, 2] - flat[:, 0]
    signed = (uv_a[:, 0] * uv_b[:, 1] - uv_a[:, 1] * uv_b[:, 0]) / 2
    return area, -signed if mirrored else signed, area > 1e-14


def _faults(corners, flat, mirrored, globe=False, mirror_step=False):
    edge_a, edge_b = corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]
    normal = numpy.cross(edge_a, edge_b)
    area, signed, real = _areas(corners, flat, mirrored)
    uv_a, uv_b = flat[:, 1] - flat[:, 0], flat[:, 2] - flat[:, 0]
    total = float(area[real].sum())
    if not total:
        return []
    said = []
    roomless = real & (numpy.abs(signed) <= 1e-12)
    if roomless.any():
        said.append(
            f"{int(roomless.sum())} of its triangles have no room in its picture, so each shows one colour,"
            f" as at {point_text(corners[roomless][0].mean(axis=0))}"
        )
    used = real & ~roomless
    turned = used & (signed < 0)
    if turned.any() and turned.sum() < used.sum():
        if not mirror_step:
            said.append(
                f"{int(turned.sum())} of its triangles are turned over in its picture, so the picture shows mirrored there,"
                f" as at {point_text(corners[turned][0].mean(axis=0))}"
            )
    elif turned.any():
        said.append("its whole layout is turned over, so the picture shows mirrored on it")
    stretch, detail = _stretch(edge_a, edge_b, normal, uv_a, uv_b, used)
    if globe:
        stretch, detail = numpy.ones(len(stretch)), numpy.ones(len(detail))
    stretched = used & (stretch > STRETCHED)
    share = float(area[stretched].sum()) / total
    if share > WORTH:
        worst = numpy.nonzero(stretched)[0][numpy.argmax(stretch[stretched])]
        said.append(
            f"its picture is stretched on {share:.0%} of its surface, running up to {stretch[worst]:.3g} times further one way"
            f" than across, as at {point_text(corners[worst].mean(axis=0))}"
        )
    low, high = _spread(detail[used], area[used])
    if low > 0 and high / low > SPREAD:
        said.append(f"its picture's detail per centimetre varies {high / low:.3g} times over its surface")
    return said


def _stretch(edge_a, edge_b, normal, uv_a, uv_b, used):
    """Each triangle's stretch, the ratio of the picture's two ways across it, and its detail, picture length per metre."""
    count = len(edge_a)
    stretch, detail = numpy.ones(count), numpy.zeros(count)
    if not used.any():
        return stretch, detail
    a, b, n, ua, ub = edge_a[used], edge_b[used], normal[used], uv_a[used], uv_b[used]
    across = a / numpy.linalg.norm(a, axis=1)[:, None]
    up = numpy.cross(n / numpy.linalg.norm(n, axis=1)[:, None], across)
    # The triangle in its own plane, and the map from there to the picture.
    flat = numpy.stack([numpy.stack([numpy.linalg.norm(a, axis=1), numpy.zeros(len(a))], axis=1), numpy.stack([(b * across).sum(1), (b * up).sum(1)], axis=1)], axis=2)
    picture = numpy.stack([ua, ub], axis=2)
    mapping = picture @ numpy.linalg.inv(flat)
    values = numpy.linalg.svd(mapping, compute_uv=False)
    stretch[used] = values[:, 0] / numpy.maximum(values[:, 1], 1e-30)
    detail[used] = numpy.sqrt(values[:, 0] * values[:, 1])
    return stretch, detail


def _spread(detail, area):
    """The detail of the shape's least and most detailed twentieths, by area."""
    if not len(detail):
        return 0.0, 0.0
    order = numpy.argsort(detail)
    reached = numpy.cumsum(area[order]) / area.sum()
    return float(detail[order][numpy.searchsorted(reached, 0.05)]), float(detail[order][min(len(order) - 1, numpy.searchsorted(reached, 0.95))])
