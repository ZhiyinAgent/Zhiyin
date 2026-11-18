"""
A picture or text decal's shape, measured as it lies. A projected decal is the surface itself under
its rectangle, copied and cut to it, seen from where it is cast, with the picture laid on it along
that way. A mesh decal is a card of its own, a grid at the landing point facing the surface's
normal, bent onto the surface along it or left flat. Each says how much of it the surface takes,
how much is off an edge or on the back side, its size on the surface and its worst stretch.
"""

import math

import bmesh
import mathutils

from .decal_materials import LAYOUT
from .errors import Refused
from .wording import point_text

# The grid a projected decal's coverage is sampled on, along its longer side, and a card's cells.
SAMPLED = 64
CELLS = 32
# A face turned this little toward where a decal is cast from takes none of it.
EDGE_ON = 0.01
# A face this much behind the surface first met is hidden by it.
HIDDEN = 1e-5


def grid(width, height, most):
    """How many steps a grid takes across and up a rectangle: `most` along its longer side, even, at least two."""
    if width >= height:
        return most, max(2, 2 * round(most * height / width / 2))
    return max(2, 2 * round(most * width / height / 2)), most


class Laid:
    """
    A decal as it lies on the surface, in world space: its faces with their picture layout, the
    points that stand for equal shares of its rectangle with whether each is on the surface, off
    an edge or on the back side, and the way it faces.
    """

    def __init__(self, bm, samples, facing):
        self.bm, self.samples, self.facing = bm, samples, facing

    def share(self, where):
        return sum(1 for _, at in self.samples if at == where) / max(len(self.samples), 1)

    def on_surface(self):
        return [p for p, at in self.samples if at == "on"]


def rectangle_point(spot, axes, s, t):
    right, up, _ = axes
    return spot + right * s + up * t


def projected(surface, spot, axes, width, height):
    """The surface under the decal's rectangle as it is cast along -z, copied and cut to it."""
    right, up, toward = axes
    depth = max(width, height)
    bm = surface.bm.copy()

    def placed(p):
        d = p - spot
        return d.dot(right), d.dot(up), d.dot(toward)

    far = []
    for face in bm.faces:
        at = [placed(v.co) for v in face.verts]
        if (
            all(s > width / 2 for s, _, _ in at)
            or all(s < -width / 2 for s, _, _ in at)
            or all(t > height / 2 for _, t, _ in at)
            or all(t < -height / 2 for _, t, _ in at)
            or all(abs(d) > depth for _, _, d in at)
        ):
            far.append(face)
    bmesh.ops.delete(bm, geom=far, context="FACES")
    for way, half in ((right, width / 2), (-right, width / 2), (up, height / 2), (-up, height / 2)):
        everything = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=everything, plane_co=spot + way * half, plane_no=way, clear_outer=True)
    bm.normal_update()
    unseen = []
    for face in bm.faces:
        middle = face.calc_center_median()
        if face.normal.dot(toward) <= EDGE_ON or abs((middle - spot).dot(toward)) > depth:
            unseen.append(face)
            continue
        first = surface.first_hit(middle + toward * surface.reach, -toward, surface.reach * 2)
        if first is not None and (first[0] - middle).dot(toward) > HIDDEN:
            unseen.append(face)
    bmesh.ops.delete(bm, geom=unseen, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if not bm.faces:
        bm.free()
        raise Refused(
            f"Cast as asked, the decal's rectangle lies on no face of {surface.obj.name} turned toward it: "
            "give at a point on its surface, or a direction that meets it."
        )
    layout = bm.loops.layers.uv.new(LAYOUT)
    for face in bm.faces:
        for loop in face.loops:
            s, t, _ = placed(loop.vert.co)
            loop[layout].uv = (s / width + 0.5, t / height + 0.5)
    samples = []
    across, up_count = grid(width, height, SAMPLED)
    for i in range(across):
        for j in range(up_count):
            s, t = width * ((i + 0.5) / across - 0.5), height * ((j + 0.5) / up_count - 0.5)
            start = rectangle_point(spot, axes, s, t) + toward * surface.reach
            first = surface.first_hit(start, -toward, surface.reach * 2)
            if first is None or abs((first[0] - spot).dot(toward)) > depth:
                samples.append((None, "off"))
            elif first[1].dot(toward) <= EDGE_ON:
                samples.append((first[0], "back"))
            else:
                samples.append((first[0], "on"))
    return Laid(bm, samples, toward)


def card(surface, spot, axes, width, height, conform):
    """A grid card of its own at the landing point, bent onto the surface along its normal or flat."""
    right, up, facing = axes
    depth = max(width, height)
    across, up_count = grid(width, height, CELLS)
    bm = bmesh.new()
    layout = bm.loops.layers.uv.new(LAYOUT)
    rows = []
    for j in range(up_count + 1):
        row = []
        for i in range(across + 1):
            s, t = width * (i / across - 0.5), height * (j / up_count - 0.5)
            point = rectangle_point(spot, axes, s, t)
            if conform:
                first = surface.first_hit(point + facing * depth, -facing, depth * 2)
                if first is not None:
                    point = first[0]
            row.append(bm.verts.new(point))
        rows.append(row)
    for j in range(up_count):
        for i in range(across):
            face = bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
            for loop, (a, b) in zip(face.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[layout].uv = (a / across, b / up_count)
    bm.normal_update()
    samples = []
    for face in bm.faces:
        middle = face.calc_center_median()
        first = surface.first_hit(middle + facing * depth, -facing, depth * 2)
        if first is None:
            samples.append((None, "off"))
        elif first[1].dot(facing) <= EDGE_ON:
            samples.append((first[0], "back"))
        else:
            samples.append((first[0], "on"))
    carried(surface, bm)
    return Laid(bm, samples, facing)


def carried(surface, bm):
    """Gives a card the material and layouts of the faces under it, so the surface's own material reads it as it reads them."""
    layers = [(name, layer) for name, layer in surface.bm.loops.layers.uv.items() if name != LAYOUT]
    own = {name: bm.loops.layers.uv.new(name) for name, _ in layers}
    for face in bm.faces:
        found = surface.nearest(face.calc_center_median())
        face.material_index = found[2].material_index
        for loop in face.loops:
            under = surface.nearest(loop.vert.co)[2]
            weights = mathutils.interpolate.poly_3d_calc([v.co for v in under.verts], loop.vert.co)
            for name, layer in layers:
                uv = mathutils.Vector((0.0, 0.0))
                for weight, other in zip(weights, under.loops):
                    uv += other[layer].uv * weight
                loop[own[name]].uv = uv


def middle_lines(bm, spot, axes):
    """How long the decal's two middle lines run on the surface: across it, then up it."""
    right, up, _ = axes
    lengths = []
    for way in (up, right):
        copy = bm.copy()
        try:
            everything = list(copy.verts) + list(copy.edges) + list(copy.faces)
            # Just beside the middle, so the cut never runs along an edge already there.
            beside = spot + way * 1e-7
            cut = bmesh.ops.bisect_plane(copy, geom=everything, plane_co=beside, plane_no=way)["geom_cut"]
            lengths.append(sum(e.calc_length() for e in cut if isinstance(e, bmesh.types.BMEdge)))
        finally:
            copy.free()
    return lengths


def worst_stretch(bm, width, height):
    """
    How much more of the surface one length of the picture covers than it should, at worst, and
    where: 1 where the picture lies at its own proportions.
    """
    layout = bm.loops.layers.uv[LAYOUT]
    worst, where = 1.0, None
    for face in bm.faces:
        loops = list(face.loops)
        for i in range(1, len(loops) - 1):
            a, b, c = loops[0], loops[i], loops[i + 1]
            one, two = b.vert.co - a.vert.co, c.vert.co - a.vert.co
            normal = one.cross(two)
            if normal.length < 1e-10:
                continue
            x = one.normalized()
            y = normal.normalized().cross(x)
            laid = mathutils.Matrix(((one.dot(x), two.dot(x)), (one.dot(y), two.dot(y))))
            uv1, uv2 = b[layout].uv - a[layout].uv, c[layout].uv - a[layout].uv
            drawn = mathutils.Matrix(((uv1.x * width, uv2.x * width), (uv1.y * height, uv2.y * height)))
            if abs(drawn.determinant()) < 1e-14:
                continue
            j = laid @ drawn.inverted()
            p = j[0][0] ** 2 + j[1][0] ** 2
            r = j[0][1] ** 2 + j[1][1] ** 2
            q = j[0][0] * j[0][1] + j[1][0] * j[1][1]
            middle, spread = (p + r) / 2, math.sqrt(((p - r) / 2) ** 2 + q * q)
            most, least = math.sqrt(middle + spread), math.sqrt(max(middle - spread, 1e-18))
            stretch = max(most, 1 / least)
            if stretch > worst + 1e-6:
                worst, where = stretch, (a.vert.co + b.vert.co + c.vert.co) / 3
    return worst, where


def stretch_text(worst, where):
    if worst < 1.005:
        return "worst stretch 1× (none)"
    return f"worst stretch {worst:.3g}×, at {point_text(where)}"
