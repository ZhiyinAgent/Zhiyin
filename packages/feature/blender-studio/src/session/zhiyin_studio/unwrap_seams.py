"""
Where a layout is cut: seams marked on edges sharper than an angle and on the boundaries between
materials or a CAD part's groups of surfaces, and the cuts each closed part needs to lie flat. A
part lies flat when it is a disc, one piece with one boundary: a closed part, as a ball, is cut
along a path across it, and a part with several boundaries, as a tube's side, is cut from one
boundary to the next. With the camera's sight, each cut runs where the camera sees least. Also
the seams a layout has, as the edges where its pieces part, with their length and how much of
it the camera sees.
"""

import heapq
import math

import bmesh
import mathutils
import numpy

from .arguments import need
from .describe import in_view, shapes_in_scene
from .errors import Refused
from .finding import scene
from .model_shapes import REST, surface_names

# The cost of a seen edge for a cut, against one the camera does not see, by length.
SEEN_COST = 50
# The most cuts made to lay one mesh's parts flat.
MOST_CUTS = 64
# How near, in metres, a camera's ray must end to an edge's middle for the edge to show, at the least.
NEAR_HIT = 0.001
# And at the most, as a share of the shape's size.
NEAR_SHARE = 0.01


class Sight:
    """What the scene's camera sees: whether points of an object, facing a way, show in its picture."""

    def __init__(self, camera):
        self.camera = camera
        self.everything, self.owners = shapes_in_scene()

    def seen(self, obj, points, normals):
        """For each world point with its world normal, whether the camera sees it on `obj`."""
        if not len(points):
            return numpy.zeros(0, dtype=bool)
        eye = self.camera.matrix_world.translation
        inside = in_view(self.camera, points)
        size = max(obj.dimensions) if max(obj.dimensions) > 0 else 1.0
        near = max(NEAR_HIT, NEAR_SHARE * size)
        found = numpy.zeros(len(points), dtype=bool)
        for i, (point, normal) in enumerate(zip(points, normals)):
            if not inside[i]:
                continue
            point = mathutils.Vector(point)
            way = point - eye
            if normal is not None and mathutils.Vector(normal).dot(way) >= 0:
                continue
            if self.everything is None:
                found[i] = True
                continue
            hit, _normal, face, _distance = self.everything.ray_cast(eye, way.normalized(), way.length + near)
            found[i] = face is None or (self.owners[face] == obj and (hit - point).length <= near)
        return found


def mark_seams(bm, obj, seams):
    """
    Marks the seams asked for on a mesh in place of those it had: edges sharper than `angle`
    degrees, and the boundaries between materials or between a CAD part's groups of surfaces.
    Returns the words for what was marked.
    """
    angle = seams.get("angle")
    by = seams.get("by")
    said = []
    if by == "surface_group":
        names = surface_names(obj.data)
        if not names:
            raise Refused(
                f"“{obj.name}” has no groups of surfaces: only a part from the CAD studio has them. Use by material, or angle."
            )
        group_of = [names[min(f.material_index, len(names) - 1)] for f in bm.faces]
    for edge in bm.edges:
        edge.seam = False
        if len(edge.link_faces) != 2:
            continue
        one, two = edge.link_faces
        if angle is not None and math.degrees(edge.calc_face_angle(0.0)) > angle:
            edge.seam = True
        elif by == "material" and one.material_index != two.material_index:
            edge.seam = True
        elif by == "surface_group" and group_of[one.index] != group_of[two.index]:
            edge.seam = True
    if angle is not None:
        said.append(f"edges sharper than {angle:g}°")
    if by == "material":
        said.append("boundaries between its materials")
    if by == "surface_group":
        groups = sorted(set(group_of) - {REST}) + ([REST] if REST in group_of else [])
        said.append(f"boundaries between its groups of surfaces ({', '.join(groups)})")
    return said


def _find(parent, item):
    while parent[item] != item:
        parent[item] = parent[parent[item]]
        item = parent[item]
    return item


def _join(parent, one, two):
    one, two = _find(parent, one), _find(parent, two)
    if one != two:
        parent[two] = one


def _interior(edge):
    return not edge.seam and len(edge.link_faces) == 2


def parts(bm):
    """The mesh's faces in the pieces its seams and open edges cut it into, each a list of faces."""
    parent = list(range(len(bm.faces)))
    for edge in bm.edges:
        if _interior(edge):
            one, two = edge.link_faces
            _join(parent, one.index, two.index)
    found = {}
    for face in bm.faces:
        found.setdefault(_find(parent, face.index), []).append(face)
    return list(found.values())


def _corner_at(loop, vert):
    return loop if loop.vert == vert else loop.link_loop_next


def shape_of(faces):
    """
    A piece's Euler characteristic and boundaries, as the faces lie once cut along their seams:
    (characteristic, boundaries as lists of their points). A disc has 1 and one boundary.
    """
    inside = {f.index for f in faces}
    loops = [loop for f in faces for loop in f.loops]
    number = {loop.index: i for i, loop in enumerate(loops)}
    parent = list(range(len(loops)))
    edges = {}
    for loop in loops:
        edges.setdefault(loop.edge.index, (loop.edge, []))[1].append(loop)
    count = 0
    open_loops = []
    for edge, own in edges.values():
        if _interior(edge) and len(own) == 2:
            count += 1
            for vert in edge.verts:
                _join(parent, number[_corner_at(own[0], vert).index], number[_corner_at(own[1], vert).index])
        else:
            count += len(own)
            open_loops += own
    corners = {_find(parent, i) for i in range(len(loops))}
    characteristic = len(corners) - count + len(inside)
    # Each open side runs on to the open side leaving the corner where it ends.
    leaving = {_find(parent, number[loop.index]): loop for loop in open_loops}
    rims = list(range(len(open_loops)))
    place = {loop.index: i for i, loop in enumerate(open_loops)}
    for loop in open_loops:
        after = leaving.get(_find(parent, number[loop.link_loop_next.index]))
        if after is not None:
            _join(rims, place[loop.index], place[after.index])
    boundaries = {}
    for loop in open_loops:
        boundaries.setdefault(_find(rims, place[loop.index]), set()).update((loop.vert, loop.link_loop_next.vert))
    return characteristic, list(boundaries.values())


def _path(starts, ends, faces, cost):
    """The cheapest way along a piece's uncut edges from any of `starts` to any of `ends`, as its edges."""
    inside = {f.index for f in faces}
    best = {v: 0.0 for v in starts}
    came = {}
    waiting = [(0.0, v.index, v) for v in starts]
    heapq.heapify(waiting)
    while waiting:
        spent, _, vert = heapq.heappop(waiting)
        if spent > best.get(vert, math.inf):
            continue
        if vert in ends and vert not in starts:
            route = []
            while vert in came:
                edge = came[vert]
                route.append(edge)
                vert = edge.other_vert(vert)
            return route
        for edge in vert.link_edges:
            if not _interior(edge) or not all(f.index in inside for f in edge.link_faces):
                continue
            other = edge.other_vert(vert)
            total = spent + cost(edge)
            if total < best.get(other, math.inf):
                best[other] = total
                came[other] = edge
                heapq.heappush(waiting, (total, other.index, other))
    return []


def _farthest(start, faces):
    """The point of a piece farthest from `start` along its edges."""
    inside = {f.index for f in faces}
    best = {start: 0.0}
    waiting = [(0.0, start.index, start)]
    while waiting:
        spent, _, vert = heapq.heappop(waiting)
        if spent > best[vert]:
            continue
        for edge in vert.link_edges:
            if not all(f.index in inside for f in edge.link_faces):
                continue
            other = edge.other_vert(vert)
            total = spent + edge.calc_length()
            if total < best.get(other, math.inf):
                best[other] = total
                heapq.heappush(waiting, (total, other.index, other))
    return max(best, key=best.get)


def edge_costs(bm, obj, sight):
    """What cutting each edge costs: its length, many times over where the camera sees it."""
    matrix = obj.matrix_world
    turn = matrix.to_3x3().inverted_safe().transposed()
    lengths = [((matrix @ e.verts[0].co) - (matrix @ e.verts[1].co)).length for e in bm.edges]
    if sight is None:
        return lengths
    points = [matrix @ ((e.verts[0].co + e.verts[1].co) / 2) for e in bm.edges]
    normals = [_facing(e, turn, matrix, sight) for e in bm.edges]
    seen = sight.seen(obj, points, normals)
    return [length * (1 + SEEN_COST * bool(shown)) for length, shown in zip(lengths, seen)]


def _facing(edge, turn, matrix, sight):
    """The normal of the edge's face that turns most toward the camera, in the world."""
    eye = sight.camera.matrix_world.translation
    middle = matrix @ ((edge.verts[0].co + edge.verts[1].co) / 2)
    best = None
    for face in edge.link_faces:
        normal = (turn @ face.normal).normalized()
        if best is None or normal.dot(middle - eye) < best.dot(middle - eye):
            best = normal
    return best


def cut_flat(bm, obj, sight):
    """
    Cuts each piece of the mesh that is not a disc until it is one, along the cheapest edges:
    returns (how many cuts, their length in metres, pieces that still are not discs).
    """
    bm.edges.index_update()
    costs = edge_costs(bm, obj, sight)
    matrix = obj.matrix_world

    def cost(edge):
        return costs[edge.index]

    made, length = 0, 0.0
    unsolved = 0
    for _ in range(MOST_CUTS):
        changed = False
        unsolved = 0
        for faces in parts(bm):
            characteristic, boundaries = shape_of(faces)
            if characteristic == 1 and len(boundaries) == 1:
                continue
            route = []
            if not boundaries:
                verts = {v for f in faces for v in f.verts}
                start = min(verts, key=lambda v: (min(cost(e) / max(e.calc_length(), 1e-12) for e in v.link_edges), (matrix @ v.co).z))
                route = _path({start}, {_farthest(start, faces)}, faces, cost)
            elif len(boundaries) > 1:
                route = _path(boundaries[0], set().union(*boundaries[1:]), faces, cost)
            if not route:
                unsolved += 1
                continue
            for edge in route:
                edge.seam = True
                length += ((matrix @ edge.verts[0].co) - (matrix @ edge.verts[1].co)).length
            made += 1
            changed = True
        if not changed:
            break
    return made, length, unsolved


def layout_seams(bm, layer):
    """The edges where a layout's pieces part: those of two faces whose corners lie apart in the layout."""
    found = []
    for edge in bm.edges:
        if len(edge.link_faces) != 2:
            continue
        ends = []
        for loop in edge.link_loops:
            ends.append({loop.vert.index: loop[layer].uv.copy(), loop.link_loop_next.vert.index: loop.link_loop_next[layer].uv.copy()})
        one, two = ends
        if any((one[v] - two[v]).length > 1e-6 for v in one):
            found.append(edge)
    return found


def seams_seen(obj, edges, sight):
    """Seams' length in metres, and the share of it the camera sees; None for the share without a camera."""
    matrix = obj.matrix_world
    lengths = numpy.array([((matrix @ e.verts[0].co) - (matrix @ e.verts[1].co)).length for e in edges])
    total = float(lengths.sum())
    if sight is None or not edges:
        return total, None
    turn = matrix.to_3x3().inverted_safe().transposed()
    points = [matrix @ ((e.verts[0].co + e.verts[1].co) / 2) for e in edges]
    normals = [_facing(e, turn, matrix, sight) for e in edges]
    seen = sight.seen(obj, points, normals)
    return total, (float(lengths[seen].sum()) / total if total else 0.0)


def camera_sight(hide):
    """The camera's sight for placing cuts and telling seams seen, or None; refused when hiding is asked with no camera."""
    camera = scene().camera
    if hide is True:
        need(camera is not None, "seams.hide puts cuts where the camera sees least, and the scene has no camera: set one, or leave hide out.")
    return Sight(camera) if camera is not None else None


def seams_bmesh(obj):
    """A bmesh of an object's own mesh, with its lookup tables made."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    return bm
