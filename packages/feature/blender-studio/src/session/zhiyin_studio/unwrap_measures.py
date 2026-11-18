"""
How an object's layout lies in its texture, measured on the shape with its steps, in the world:
its islands, how much the layout stretches angles and areas, the texel density over the surface,
faces turned over, islands lying on one another, how much of the tile the islands fill and which
reach outside it. Islands stacked on a twin, as a mirror step or a repeat step lays them, are
named as such rather than as overlaps. Texels are counted on a raster of the tile, at most
MEASURED texels across.
"""

import bmesh
import numpy
from bpy_extras.bmesh_utils import bmesh_linked_uv_islands

from .shown_mesh import array, shown_data

# The most texels across the tile the layout is measured on.
MEASURED = 1024
# Triangles handed to the raster at once, by the texels their boxes hold.
RASTER_CHUNK = 4_000_000
# A twin covers this share of the other's texels, and they differ in texels by less than this.
TWIN_SHARE, TWIN_SIZE = 0.9, 0.1
# The share of the surface the least and most texel densities leave out at each end.
DENSITY_TAIL = 0.01
# How far past the tile, in tile widths, an island may reach and still be in it.
TILE_EDGE = 1e-4


def raster(corners, size):
    """
    The texels of a size × size tile whose centres lie in each triangle: arrays of texel
    indices (row × size + column) and of the triangle each lies in. Corners are (N, 3, 2)
    in tile widths; what lies outside the tile is left out, and a triangle with no area
    covers nothing.
    """
    tri = numpy.asarray(corners, dtype=numpy.float64) * size
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    area = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    low, high = tri.min(axis=1), tri.max(axis=1)
    x0 = numpy.clip(numpy.ceil(low[:, 0] - 0.5), 0, size).astype(numpy.int64)
    y0 = numpy.clip(numpy.ceil(low[:, 1] - 0.5), 0, size).astype(numpy.int64)
    x1 = numpy.clip(numpy.floor(high[:, 0] - 0.5), -1, size - 1).astype(numpy.int64)
    y1 = numpy.clip(numpy.floor(high[:, 1] - 0.5), -1, size - 1).astype(numpy.int64)
    width, height = numpy.maximum(x1 - x0 + 1, 0), numpy.maximum(y1 - y0 + 1, 0)
    counts = numpy.where(numpy.abs(area) > 1e-12, width * height, 0)
    texels, owners = [], []
    order = numpy.nonzero(counts)[0]
    start = 0
    while start < len(order):
        total, end = 0, start
        while end < len(order) and (total == 0 or total + counts[order[end]] <= RASTER_CHUNK):
            total += counts[order[end]]
            end += 1
        chunk = order[start:end]
        start = end
        each = counts[chunk]
        which = numpy.repeat(chunk, each)
        offsets = numpy.arange(int(each.sum())) - numpy.repeat(numpy.cumsum(each) - each, each)
        w = width[which]
        px = x0[which] + offsets % w
        py = y0[which] + offsets // w
        cx, cy = px + 0.5, py + 0.5
        sign = numpy.sign(area[which])
        inside = numpy.ones(len(which), dtype=bool)
        for one, two in ((a, b), (b, c), (c, a)):
            p, q = one[which], two[which]
            edge = (q[:, 0] - p[:, 0]) * (cy - p[:, 1]) - (q[:, 1] - p[:, 1]) * (cx - p[:, 0])
            inside &= edge * sign >= -1e-9
        texels.append(py[inside] * size + px[inside])
        owners.append(which[inside])
    if not texels:
        return numpy.zeros(0, dtype=numpy.int64), numpy.zeros(0, dtype=numpy.int64)
    return numpy.concatenate(texels), numpy.concatenate(owners)


class Laid:
    """An object's evaluated triangles in the world and in its layout, with the island and face of each."""

    def __init__(self, obj, layer_name=None):
        with shown_data(obj) as mesh:
            layer = mesh.uv_layers.get(layer_name) if layer_name else mesh.uv_layers.active
            self.empty = layer is None or not mesh.polygons
            if self.empty:
                return
            mesh.calc_loop_triangles()
            loops = array(mesh.loop_triangles, "loops", 3, numpy.int64).ravel()
            points = array(mesh.loop_triangles, "vertices", 3, numpy.int64).ravel()
            self.faces = array(mesh.loop_triangles, "polygon_index", 1, numpy.int64).ravel()
            uv = array(layer.uv, "vector", 2, numpy.float64).ravel()
            co = array(mesh.vertices, "co", 3, numpy.float64).ravel()
            shape = bmesh.new()
            try:
                shape.from_mesh(mesh)
                island_of = numpy.zeros(len(mesh.polygons), dtype=numpy.int64)
                found = bmesh_linked_uv_islands(shape, shape.loops.layers.uv[layer.name])
                for number, faces in enumerate(found):
                    for face in faces:
                        island_of[face.index] = number
                self.island_count = len(found)
            finally:
                shape.free()
        matrix = obj.matrix_world
        world = co.reshape(-1, 3) @ numpy.array(matrix.to_3x3()).T + numpy.array(matrix.translation)
        self.corners = world[points.reshape(-1, 3)]
        self.flat = uv.reshape(-1, 2)[loops.reshape(-1, 3)]
        mirrored = matrix.to_3x3().determinant() < 0
        edge_a = self.corners[:, 1] - self.corners[:, 0]
        edge_b = self.corners[:, 2] - self.corners[:, 0]
        self.area = numpy.linalg.norm(numpy.cross(edge_a, edge_b), axis=1) / 2
        uv_a, uv_b = self.flat[:, 1] - self.flat[:, 0], self.flat[:, 2] - self.flat[:, 0]
        signed = (uv_a[:, 0] * uv_b[:, 1] - uv_a[:, 1] * uv_b[:, 0]) / 2
        self.signed = -signed if mirrored else signed
        self.real = self.area > 1e-14
        # A mirror step joins each island to its mirrored twin where they meet on the mirror
        # plane: the faces turned over are told apart from the rest as an island of their own.
        keys = island_of[self.faces] * 2 + (self.signed < 0)
        _, self.islands = numpy.unique(keys, return_inverse=True)
        self.islands = self.islands.reshape(-1)
        self.island_count = int(self.islands.max()) + 1 if len(self.islands) else 0


def _angles(points):
    """Each corner's angle in degrees, for triangles given as (N, 3, d)."""
    found = []
    for i in range(3):
        one = points[:, (i + 1) % 3] - points[:, i]
        two = points[:, (i + 2) % 3] - points[:, i]
        cos = (one * two).sum(axis=1) / numpy.maximum(numpy.linalg.norm(one, axis=1) * numpy.linalg.norm(two, axis=1), 1e-30)
        found.append(numpy.degrees(numpy.arccos(numpy.clip(cos, -1, 1))))
    return numpy.stack(found, axis=1)


def _weighted(values, weights, share):
    """The value below which `share` of the weight lies."""
    order = numpy.argsort(values)
    reached = numpy.cumsum(weights[order]) / weights.sum()
    return float(values[order][min(len(order) - 1, numpy.searchsorted(reached, share))])


def stretch(laid):
    """Angle stretch in degrees and area stretch as a share, each (mean by area, most), over the triangles with area."""
    real = laid.real & (numpy.abs(laid.signed) > 1e-14)
    if not real.any():
        return None
    area = laid.area[real]
    uv_area = numpy.abs(laid.signed[real])
    turned = numpy.abs(_angles(laid.corners[real]) - _angles(laid.flat[real]))
    angle_mean = float((turned.mean(axis=1) * area).sum() / area.sum())
    ratio = (uv_area / uv_area.sum()) / (area / area.sum())
    area_stretch = 1 - numpy.minimum(ratio, 1 / ratio)
    return (angle_mean, float(turned.max())), (float((area_stretch * area).sum() / area.sum()), float(area_stretch.max()))


def density(laid, resolution):
    """Texels per centimetre over the surface at `resolution`: the least, the median and the most, each end leaving out DENSITY_TAIL."""
    real = laid.real & (numpy.abs(laid.signed) > 1e-14)
    if not real.any():
        return None
    per_cm = numpy.sqrt(numpy.abs(laid.signed[real]) * resolution**2 / (laid.area[real] * 1e4))
    area = laid.area[real]
    return _weighted(per_cm, area, DENSITY_TAIL), _weighted(per_cm, area, 0.5), _weighted(per_cm, area, 1 - DENSITY_TAIL)


class Covered:
    """Which islands cover each texel of the tile, at `size` texels across."""

    def __init__(self, laid, size):
        self.size = size
        texels, owners = raster(laid.flat, size)
        self.texels, self.triangles = texels, owners
        islands = laid.islands[owners]
        pairs = numpy.unique(texels * (laid.island_count + 1) + islands)
        self.pair_texels = pairs // (laid.island_count + 1)
        self.pair_islands = pairs % (laid.island_count + 1)
        self.per_island = numpy.bincount(self.pair_islands, minlength=laid.island_count)
        self.filled = len(numpy.unique(self.pair_texels))


def overlaps(laid, covered):
    """
    Islands lying on others: (island pairs stacked as twins, each with whether it is mirrored,
    texels where islands overlap otherwise, a triangle in one of them).
    """
    texels, islands = covered.pair_texels, covered.pair_islands
    if not len(texels):
        return [], 0, None
    each, shared = numpy.unique(texels, return_counts=True)
    many = each[shared > 1]
    if not len(many):
        return [], 0, None
    crowded = numpy.isin(texels, many)
    by_texel = {}
    for texel, island in zip(texels[crowded].tolist(), islands[crowded].tolist()):
        by_texel.setdefault(texel, []).append(island)
    meeting = {}
    for texel, found in by_texel.items():
        for i, one in enumerate(found):
            for two in found[i + 1 :]:
                meeting[(one, two)] = meeting.get((one, two), 0) + 1
    orientation = numpy.bincount(laid.islands, weights=laid.signed, minlength=laid.island_count)
    twins, twinned = [], set()
    for (one, two), count in meeting.items():
        a, b = covered.per_island[one], covered.per_island[two]
        if count >= TWIN_SHARE * min(a, b) and abs(a - b) <= TWIN_SIZE * max(a, b):
            twins.append((one, two, (orientation[one] > 0) != (orientation[two] > 0)))
            twinned.update((one, two))
    loose = [texel for texel, found in by_texel.items() if any(i not in twinned for i in found)]
    where = None
    if loose:
        texel = loose[0]
        hits = covered.triangles[covered.texels == texel]
        where = int(hits[0]) if len(hits) else None
    return twins, len(loose), where


def flipped(laid, mirrored_islands):
    """
    The faces turned over in the layout, but for those of islands a mirror step stacks on their
    twins: (how many, a triangle of one, whether the whole layout is turned over).
    """
    used = laid.real & (numpy.abs(laid.signed) > 1e-14)
    turned = used & (laid.signed < 0)
    if turned.any() and turned.sum() == used.sum():
        return len(numpy.unique(laid.faces[turned])), int(numpy.nonzero(turned)[0][0]), True
    counted = turned & ~numpy.isin(laid.islands, list(mirrored_islands))
    if not counted.any():
        return 0, None, False
    return len(numpy.unique(laid.faces[counted])), int(numpy.nonzero(counted)[0][0]), False


def outside_tile(laid):
    """How many islands reach outside the tile."""
    low = numpy.full((laid.island_count, 2), numpy.inf)
    high = numpy.full((laid.island_count, 2), -numpy.inf)
    points = laid.flat.reshape(-1, 2)
    owners = numpy.repeat(laid.islands, 3)
    numpy.minimum.at(low, owners, points)
    numpy.maximum.at(high, owners, points)
    out = (low < -TILE_EDGE).any(axis=1) | (high > 1 + TILE_EDGE).any(axis=1)
    return int(out[numpy.isfinite(low).all(axis=1)].sum())
