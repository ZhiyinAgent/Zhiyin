"""
The surface a decal goes on: an object's own evaluated shape in world space, with a tree that
finds the point a ray meets or the nearest point, where the decal lands and which way its picture
runs there, how a decal is lifted off it, and whether a renderer can tell the two apart at the
camera's distance.
"""

import math

import bmesh
import bpy
import mathutils
from mathutils.bvhtree import BVHTree

from .errors import Refused
from .shown_mesh import shown_bmesh
from .wording import clean, in_millimetres, length, point_text

# Measured on Blender 5.2: EEVEE drew a surface through another one 3 µm above it at 4 m, 10 µm at
# 16 m and 30 µm at 64 m, whatever the camera's clip start, and kept them apart from 2.5 µm per
# metre of distance; Cycles mixed them only at 1 µm and less at 64 m. Each limit holds twice over.
EEVEE_PER_METRE = 3e-6
CYCLES_PER_METRE = 1e-7
# A normal is said to the thousandth.
WAY = 3


def way_text(vector):
    """A direction as people read it: (0, -1, 0)."""
    return "(" + ", ".join(f"{(0.0 if abs(c) < 5e-4 else c):.{WAY}g}" for c in vector) + ")"


class Surface:
    """An object's own evaluated shape, without the parts it holds, as one mesh in world space."""

    def __init__(self, obj):
        self.obj = obj
        self.bm = shown_bmesh(obj, depsgraph=bpy.context.evaluated_depsgraph_get())
        if obj.matrix_world.determinant() < 0:
            bmesh.ops.reverse_faces(self.bm, faces=list(self.bm.faces))
        self.bm.normal_update()
        for table in (self.bm.verts, self.bm.edges, self.bm.faces):
            table.ensure_lookup_table()
        if not self.bm.faces:
            self.bm.free()
            raise Refused(f"“{obj.name}” has no faces for a decal to lie on.")
        self.tree = BVHTree.FromBMesh(self.bm)
        points = [v.co for v in self.bm.verts]
        self.low = mathutils.Vector([min(p[i] for p in points) for i in range(3)])
        self.high = mathutils.Vector([max(p[i] for p in points) for i in range(3)])
        self.reach = max((self.high - self.low).length, 1e-3) * 2

    def free(self):
        self.bm.free()

    def spans(self):
        """From its lowest corner to its highest, both in the same unit."""
        if in_millimetres(max(max(abs(c) for c in self.low), max(abs(c) for c in self.high))):
            return f"{point_text(self.low)} to {point_text(self.high)}"
        said = [", ".join(f"{clean(c):.4g}" for c in p) for p in (self.low, self.high)]
        return f"({said[0]} m) to ({said[1]} m)"

    def nearest(self, point, within=None):
        """The nearest point of the surface, its face's normal and the face; nothing past `within`."""
        location, normal, index, _ = (
            self.tree.find_nearest(point) if within is None else self.tree.find_nearest(point, within)
        )
        if location is None:
            return None
        return location, normal, self.bm.faces[index]

    def first_hit(self, origin, way, distance):
        """Where a ray first meets the surface, its face's normal and the face; nothing when it meets none."""
        location, normal, index, _ = self.tree.ray_cast(origin, way, distance)
        if location is None:
            return None
        return location, normal, self.bm.faces[index]


def landing(surface, at, direction):
    """
    Where the decal lands, the surface's normal there and the way it is cast from, toward the
    viewer: along `direction` through `at` onto the first surface met, or at the nearest point.
    """
    name = surface.obj.name
    if direction is None:
        found = surface.nearest(at)
        location, normal, _ = found
        return location, normal, normal.copy()
    way = direction.normalized()
    found = surface.first_hit(at - way * surface.reach, way, surface.reach * 2)
    if found is None:
        raise Refused(
            f"Cast along {way_text(way)} through {point_text(at)}, the decal meets no surface of {name}, "
            f"which spans {surface.spans()}."
        )
    location, normal, _ = found
    # A sheet met from behind takes the decal on the side it was cast onto.
    if normal.dot(way) > 0:
        normal = -normal
    return location, normal, -way


def picture_axes(toward, rotation):
    """
    The decal's right and up on the surface, seen from where it is cast: up is the world's up as it
    shows there, +y on a face looking up or down, turned counter-clockwise by `rotation` degrees.
    """
    z = toward.normalized()
    up = mathutils.Vector((0, 0, 1)) if abs(z.z) < 0.999 else mathutils.Vector((0, 1, 0))
    up = (up - z * up.dot(z)).normalized()
    right = up.cross(z)
    turn = math.radians(rotation)
    return (
        (right * math.cos(turn) + up * math.sin(turn)).normalized(),
        (up * math.cos(turn) - right * math.sin(turn)).normalized(),
        z,
    )


def lift(bm, distance):
    """
    Moves each corner of a decal lying on the surface off it by `distance`, along its normal and
    farther where faces meet at an angle, so every face of the decal stands that far off.
    """
    bm.normal_update()
    moves = []
    for v in bm.verts:
        normal = v.normal
        if normal.length < 1e-9 or not v.link_faces:
            moves.append(None)
            continue
        least = min(max(normal.dot(f.normal), 1e-6) for f in v.link_faces)
        moves.append(normal * (distance / max(least, 1 / 3)))
    for v, move in zip(bm.verts, moves):
        if move is not None:
            v.co += move


def standoff(surface, points):
    """
    The least and most height of points above the face of the surface nearest each, below it when
    negative, and where the least is. Over a fold, a point stands that far off each face.
    """
    least, most, where = math.inf, -math.inf, None
    for p in points:
        found = surface.nearest(p)
        if found is None:
            continue
        location, normal, _ = found
        # A mesh keeps places to about a seven-millionth of their distance from the origin.
        far = max(abs(c) for c in p)
        gap = round((p - location).dot(normal), 7 if far < 1 else 6 if far < 10 else 5 if far < 100 else 4)
        if gap < least:
            least, where = gap, p.copy()
        most = max(most, gap)
    return least, most, where


def range_text(least, most):
    """From one length to another: 0.1 to 13.4 mm."""
    one, other = length(least), length(most)
    if one.endswith(" mm") and other.endswith(" mm"):
        return f"{one[:-3]} to {other}"
    return f"{one} to {other}"


def gap_words(least, most):
    """A gap as said: one length when its ends agree to the shown digits, else a range."""
    return length(least) if length(least) == length(most) else range_text(least, most)


def fighting_text(least, near_point):
    """
    Whether EEVEE and Cycles tell a decal from the surface it stands `least` off, at the distance of
    the scene's camera from it.
    """
    camera = bpy.context.scene.camera
    if camera is None:
        return (
            "The scene has no camera to judge z-fighting by: EEVEE parts surfaces "
            f"{length(EEVEE_PER_METRE)} apart for each metre the camera stands off, Cycles {length(CYCLES_PER_METRE)}."
        )
    distance = (camera.matrix_world.translation - near_point).length
    eevee, cycles = EEVEE_PER_METRE * distance, CYCLES_PER_METRE * distance
    at = f"At the camera's {length(distance)}, EEVEE parts surfaces {two(eevee)} apart"
    if least >= eevee:
        return f"{at} and Cycles {two(cycles)}: neither mixes them up."
    if least >= cycles:
        return (
            f"{at}: the surface may show through it in patches (z-fighting) there; give an offset of at least "
            f"{two(eevee)}, or render with Cycles, which parts them from {two(cycles)}."
        )
    return (
        f"{at} and Cycles {two(cycles)}: both may show the surface through it in patches (z-fighting); "
        f"give an offset of at least {two(eevee)}."
    )


def two(metres):
    """A small length to two figures, in millimetres, written out in full: 0.000058 mm."""
    millimetres = float(f"{metres * 1000:.2g}")
    places = max(0, 1 - math.floor(math.log10(millimetres))) if millimetres > 0 else 0
    written = f"{millimetres:.{places}f}"
    return (written.rstrip("0").rstrip(".") if "." in written else written) + " mm"
