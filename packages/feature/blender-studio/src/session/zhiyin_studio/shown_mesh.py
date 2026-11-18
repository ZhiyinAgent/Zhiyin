"""
An object's own mesh as the scene shows it, read one way by every measure: evaluated with its steps,
or as stored without them, in the world or in its own space, as a bmesh, as arrays or as triangles
with their tree; a bmesh's separate pieces, by the edges or corners their faces share; and the
questions asked of a surface: whether a point is inside it, and its closed shells. An object with
its parts and the copies it places is read by geometry's world_mesh; arithmetic on the arrays is
mesh_math's.
"""

import contextlib

import bmesh
import mathutils
import numpy
from mathutils.bvhtree import BVHTree

from .geometry import evaluated_graph, shapes_mesh
from .mesh_math import closed

# Three ways out of a shape, none along an axis or a diagonal: a ray that runs
# along a face or through an edge miscounts, and the other two outvote it.
WAYS_OUT = [mathutils.Vector(v).normalized() for v in ((0.8, 0.36, 0.48), (-0.31, 0.88, 0.36), (0.27, -0.42, 0.87))]


def shown_bmesh(obj, steps=True, world=True, depsgraph=None):
    """
    An object's mesh as a bmesh to free: evaluated with its steps by `depsgraph`, the scene as
    evaluated when none is given, or as stored without them; placed in the world, or in its own space.
    """
    bm = bmesh.new()
    if steps:
        evaluated = obj.evaluated_get(depsgraph or evaluated_graph())
        try:
            bm.from_mesh(evaluated.to_mesh())
        finally:
            evaluated.to_mesh_clear()
    else:
        bm.from_mesh(obj.data)
    if world:
        bm.transform(obj.matrix_world)
    return bm


@contextlib.contextmanager
def shown_data(obj, depsgraph=None):
    """An object's evaluated mesh, in its own space, to read while it lasts; let go of after."""
    evaluated = obj.evaluated_get(depsgraph or evaluated_graph())
    mesh = evaluated.to_mesh()
    try:
        yield mesh
    finally:
        evaluated.to_mesh_clear()


def array(items, name, width, kind):
    """One value of every item, such as each vertex's co, as rows of `width`."""
    values = numpy.empty(len(items) * width, dtype=kind)
    items.foreach_get(name, values)
    return values.reshape(-1, width)


def triangle_arrays(bm):
    """A bmesh's corners and triangles as arrays, its faces cut into triangles."""
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.verts.index_update()
    corners = numpy.array([v.co[:] for v in bm.verts], dtype=float).reshape(-1, 3)
    triangles = numpy.array([[v.index for v in f.verts] for f in bm.faces], dtype=numpy.int64).reshape(-1, 3)
    return corners, triangles


def triangles_of(objects):
    """The evaluated shapes of `objects`, with the copies each places, in the world, as corners and triangles."""
    bm = shapes_mesh(objects)
    try:
        return triangle_arrays(bm)
    finally:
        bm.free()


class Triangles:
    """A surface in the world as triangles: its corners, its triangles, its box and tree, and whether it is closed."""

    def __init__(self, corners, triangles):
        self.corners, self.triangles = corners, triangles
        self.low, self.high = corners.min(axis=0), corners.max(axis=0)
        self.tree = BVHTree.FromPolygons(corners.tolist(), triangles.tolist())
        self.closed = closed(triangles)

    def near(self, other, reach):
        """Whether its box comes within `reach` of another's."""
        return bool((self.low - reach <= other.high).all() and (other.low - reach <= self.high).all())

    def holds(self, point, margin=0.0):
        """Whether a point is inside it, a closed surface; within `margin` of its box first."""
        inside_box = all(self.low[i] - margin <= point[i] <= self.high[i] + margin for i in range(3))
        return inside_box and is_inside(self.tree, mathutils.Vector(point))

    def gap(self, point):
        """How far a point is from its surface."""
        found = self.tree.find_nearest(mathutils.Vector(point))
        return found[3] if found[0] is not None else float("inf")


def joined_faces(bm, by_corners=False, starting=None, apart=()):
    """
    The faces of each separate piece of a bmesh, one piece at a time: faces joined by the edges they
    share, or with `by_corners` by the corners they share; never across an edge in `apart`.
    `starting` is called before each piece.
    """
    seen = set()
    for start in bm.faces:
        if start in seen:
            continue
        if starting is not None:
            starting()
        seen.add(start)
        group, waiting = [], [start]
        while waiting:
            face = waiting.pop()
            group.append(face)
            for joint in face.verts if by_corners else face.edges:
                if joint in apart:
                    continue
                for other in joint.link_faces:
                    if other not in seen:
                        seen.add(other)
                        waiting.append(other)
        yield group


def on_surface(tree, face):
    """
    A face's middle laid onto the surface a tree holds. A face that bends is drawn as triangles its
    middle lies off, so a ray started at the middle can meet the face itself.
    """
    middle = face.calc_center_median()
    found = tree.find_nearest(middle)[0]
    return middle if found is None else found


def crossings(tree, point, way):
    """How many times a ray from a point along `way` crosses the surface a tree holds."""
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
    """
    Whether a point is inside a closed shape: rays from it cross the surface an odd number of times,
    two of three agreeing. Counting crossings holds whichever way the faces point and in a hollow
    or a notch, where the face nearest a point can face away from it on either side.
    """
    votes = [crossings(tree, point, way) % 2 for way in WAYS_OUT[:2]]
    if votes[0] != votes[1]:
        votes.append(crossings(tree, point, WAYS_OUT[2]) % 2)
    return sum(votes) >= 2


class Shell:
    """One closed shell of a mesh: its surface and the box round it."""

    def __init__(self, corners, polygons):
        self.tree = BVHTree.FromPolygons(corners, polygons)
        self.low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
        self.high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])

    def holds(self, point):
        return all(self.low[i] <= point[i] <= self.high[i] for i in range(3)) and is_inside(self.tree, point)


def shells(bm):
    """
    Each closed shell of a mesh on its own, joined by shared edges. Shells
    that touch face to face, as a stack of parts does, are each counted on
    their own: a ray through a face two of them share meets it once, which
    counted across the whole mesh would turn outside into inside. A shell
    with an open edge holds nothing.
    """
    found = []
    for group in joined_faces(bm):
        if not all(edge.is_manifold for face in group for edge in face.edges):
            continue
        places = {}
        corners = []
        for face in group:
            for vert in face.verts:
                if vert not in places:
                    places[vert] = len(corners)
                    corners.append(vert.co.copy())
        found.append(Shell(corners, [[places[v] for v in face.verts] for face in group]))
    return found


def held_by(found, point):
    """Whether a point is inside any of these shells."""
    return any(shell.holds(point) for shell in found)


# Times the nearest points found on two surfaces are moved, each to the nearest on the other,
# closing on the nearest the two surfaces come; and how many of the nearest found are closed on.
CLOSING = 30
CLOSED_ON = 4


def nearest_between(one, other, enough=None):
    """
    Where two surfaces come nearest, in metres: (the distance, the point on one, the point on the
    other), or None. Each is given as its points to measure from, an array, its box's low and high
    corners and its tree. Points of each are measured to the other's surface, nearest its box first;
    no point farther from the box than the nearest found comes nearer. The nearest found are closed
    on, each moved to the nearest point of the other surface in turn, so two faces that meet away
    from any corner, as crossed boards do, are measured where they meet. Measuring stops once two
    points come within `enough`.
    """
    best, found_at = None, []
    for first, second, swapped in ((one, other, False), (other, one, True)):
        points, (low, high, tree) = first[0], second[1:]
        off_box = numpy.linalg.norm(numpy.maximum(numpy.maximum(low - points, points - high), 0), axis=1)
        for k in numpy.argsort(off_box, kind="stable"):
            if best is not None and off_box[k] >= best[0]:
                break
            start = mathutils.Vector(points[k])
            location, _, _, distance = tree.find_nearest(start)
            if location is None or (best is not None and distance >= best[0]):
                continue
            best = (distance, location, start) if swapped else (distance, start, location)
            found_at.append(best)
            if enough is not None and distance <= enough:
                return best
    if best is None:
        return None
    for distance, on_one, on_other in found_at[-CLOSED_ON:]:
        for _ in range(CLOSING):
            moved = one[3].find_nearest(on_other)[0]
            if moved is None:
                break
            location, _, _, apart = other[3].find_nearest(moved)
            if location is None or apart >= distance - 1e-9:
                break
            distance, on_one, on_other = apart, moved, location
        if distance < best[0]:
            best = (distance, on_one, on_other)
    return best
