"""
Loops, marks and shaping on a mesh, taken by meaning rather than by index: the edge loop or ring
through an edge near a point or picked, a mesh's open boundary, a face region's outline and the
faces inside a loop; crease, bevel weight, sharpness and seams set on edges; and points made round,
evenly spaced, flat, or moved with a falloff. Each call measures what it did and says so in one
line, and refuses what it cannot do as asked, saying why.
"""

import heapq
import math

import bmesh
import mathutils
import mathutils.kdtree
import numpy

from .arguments import need, number, vector
from .errors import Refused
from .mesh_math import joined_points, to_segment
from .picking import SINGULAR, Picked, direction, keep, mesh_object, scale_of, spread, unspent
from .reports import report
from .shown_mesh import joined_faces
from .wording import area_text, length, one_of, point_text

# How many loops one line describes; the rest are counted.
LISTED = 6
NO_LOOP = (
    "A loop carries on through a point where four edges meet, each between two faces,"
    " or along an open rim through a point where three edges meet."
)
FALLOFFS = {
    "smooth": lambda t: 3 * t * t - 2 * t * t * t,
    "linear": lambda t: t,
    "sharp": lambda t: t * t,
    "constant": lambda t: 1.0,
}
# What mark sets, in the order its line says them: the argument, Blender's edge attribute, its
# type, and the words for a value.
MARKS = (
    ("crease", "crease_edge", "FLOAT", lambda v: f"crease {v:g}"),
    ("bevel_weight", "bevel_weight_edge", "FLOAT", lambda v: f"bevel weight {v:g}"),
    ("sharp", "sharp_edge", "BOOLEAN", lambda v: "sharp" if v else "sharp cleared"),
    ("seam", "uv_seam", "BOOLEAN", lambda v: "seam" if v else "seam cleared"),
)


def counted(count, word):
    return f"{count} {word if count == 1 else word + 's'}"


def picked_words(picked):
    """A pick as a line names it: the 4 edges picked."""
    return f"the {counted(len(picked), SINGULAR[picked.kind])} picked"


def taken(picked, what, kinds=("faces", "edges", "verts"), hint=""):
    """A pick's object, refused when it is no pick, holds the wrong kind, or no longer fits its mesh."""
    need(
        isinstance(picked, Picked),
        f"{what} takes a pick: what zhiyin.pick, zhiyin.loop or another zhiyin call returned.",
    )
    try:
        obj = mesh_object(picked.object, what)
    except ReferenceError:
        raise Refused(f"The pick {what} was given belongs to an object that is gone. Pick again.") from None
    unspent(picked)
    need(picked.kind in kinds, f"{what} takes a pick of {one_of(kinds)}; this one holds {picked.kind}.{hint}")
    count = len({"faces": obj.data.polygons, "edges": obj.data.edges, "verts": obj.data.vertices}[picked.kind])
    need(
        len(picked) and all(0 <= i < count for i in picked.indices),
        f"{picked!r} no longer fits {obj.name}: the mesh has changed since it was picked. Pick again.",
    )
    return obj


def points_of(obj, picked):
    """The mesh points of what was picked."""
    if picked.kind == "verts":
        return list(picked.indices)
    items = obj.data.edges if picked.kind == "edges" else obj.data.polygons
    return sorted({v for i in picked.indices for v in items[i].vertices})


def direction_text(normal, canonical=False):
    """A direction as three numbers; made to point its largest way positive when its sign is arbitrary."""
    if canonical and normal[max(range(3), key=lambda i: abs(normal[i]))] < 0:
        normal = -normal
    return "[" + ", ".join(f"{round(c, 3) + 0.0:g}" for c in normal) + "]"


def lengths_text(values):
    """Lengths as one, when they agree, or as their range."""
    low, high = min(values), max(values)
    return f"each {length(low)}" if high - low < 1e-6 else f"{length(low)} to {length(high)}"


class Chain:
    """Connected edges: their indices, their points in order along them, and whether they close or branch."""

    def __init__(self, edges, points, closed, branching):
        self.edges = edges
        self.points = points
        self.closed = closed
        self.branching = branching

    def state(self):
        return "branching" if self.branching else "closed" if self.closed else "open"


def chains(pairs):
    """Edges, given as (edge, one end, other end), parted into the chains they connect into."""
    ends, joins = {}, []
    for edge, a, b in pairs:
        ends.setdefault(a, []).append((edge, b))
        ends.setdefault(b, []).append((edge, a))
        joins.append((a, b))
    corners = sorted(ends)
    place = {corner: i for i, corner in enumerate(corners)}
    found = []
    for indices in joined_points(len(corners), [(place[a], place[b]) for a, b in joins]):
        group = [corners[i] for i in indices]
        if any(len(ends[v]) > 2 for v in group):
            edges = sorted({e for v in group for e, _ in ends[v]})
            found.append(Chain(edges, sorted(group), False, True))
            continue
        loose = sorted(v for v in group if len(ends[v]) == 1)
        first = loose[0] if loose else min(group)
        points, edges, at = [first], [], first
        while True:
            step = next(((e, w) for e, w in ends[at] if e not in edges), None)
            if step is None:
                break
            edges.append(step[0])
            at = step[1]
            if at == first:
                break
            points.append(at)
        found.append(Chain(edges, points, not loose, False))
    return found


def edge_lengths(obj, shape):
    matrix = obj.matrix_world
    return {e.index: (matrix @ e.verts[0].co - matrix @ e.verts[1].co).length for e in shape.edges}


def chain_text(chain, lengths):
    return f"{counted(len(chain.edges), 'edge')}, {chain.state()}, {length(sum(lengths[e] for e in chain.edges))} long"


def chains_text(descriptions, total, noun):
    """One description as itself; several as their count and each one, the first few listed."""
    if len(descriptions) == 1:
        return descriptions[0]
    shown = descriptions[:LISTED]
    more = [f"and {len(descriptions) - LISTED} more"] if len(descriptions) > LISTED else []
    return f"{total} edges in {len(descriptions)} {noun} ({'; '.join(shown + more)})"


def corners_of(obj, shape, edges):
    shape.edges.ensure_lookup_table()
    matrix = obj.matrix_world
    return [matrix @ v.co for i in edges for v in shape.edges[i].verts]


def kept_text(name):
    return f"; kept as “{name}”." if name else "."


def checked_name(name):
    need(name is None or (isinstance(name, str) and name.strip()), "name must be a word to keep the pick by.")


def start_edges(obj, shape, near, through, what):
    """The edges a loop or ring starts from, and the words for them."""
    need(
        near is not None or through is not None,
        f"{what} needs near=[x, y, z], a point the {what} passes by, or through=, a pick of edges it goes through.",
    )
    need(near is None or through is None, f"{what} takes near or through, not both.")
    shape.edges.ensure_lookup_table()
    if through is not None:
        other = taken(through, what, ("edges",), " Pick edges with zhiyin.pick(obj, 'edges', …).")
        need(other.name == obj.name, f"through is a pick of {other.name}, not of {obj.name}.")
        subject = f"The edge picked of {obj.name}" if len(through) == 1 else None
        return [shape.edges[i] for i in through.indices], picked_words(through), subject
    point = vector(near, "near")
    need(len(shape.edges), f"{obj.name} has no edges.")
    matrix = obj.matrix_world
    gap, nearest = min(
        ((to_segment(point, matrix @ e.verts[0].co, matrix @ e.verts[1].co), e.index) for e in shape.edges),
    )
    said = f"the edge nearest {point_text(point)}"
    passes = f", which passes {length(gap)} from it" if gap > 1e-4 else ""
    return [shape.edges[nearest]], said + passes, f"The edge nearest {point_text(point)} of {obj.name}"


def refused_start(obj, starts, subject, why_one, alone):
    """Why no loop or ring came of the edges a call started from: one edge's reason, or that none of several led to one."""
    return f"{subject} {why_one}" if subject else f"None of the {len(starts)} edges picked of {obj.name} {alone}"


def loop_onward(edge, vert):
    """The edge a loop goes on to past `vert`, or None where it ends there."""
    around = vert.link_edges
    if len(edge.link_faces) == 1:
        if len(around) != 3:
            return None
        onward = [e for e in around if e.index != edge.index and len(e.link_faces) == 1]
        return onward[0] if len(onward) == 1 else None
    if len(edge.link_faces) != 2 or len(around) != 4 or any(len(e.link_faces) != 2 for e in around):
        return None
    beside = {f.index for f in edge.link_faces}
    onward = [e for e in around if e.index != edge.index and not beside & {f.index for f in e.link_faces}]
    return onward[0] if len(onward) == 1 else None


def loop_from(start):
    """The edges of the loop through `start`, walked both ways from it."""
    taken_edges = {start.index}
    for vert in start.verts:
        edge = start
        while True:
            onward = loop_onward(edge, vert)
            if onward is None or onward.index in taken_edges:
                break
            taken_edges.add(onward.index)
            vert, edge = onward.other_vert(vert), onward
    return taken_edges


def loop(obj, *, near=None, through=None, name=None):
    """
    The edge loop through the edge nearest a point, or through each edge picked: walked across quads
    through every point where four edges meet, or along an open rim. Selects it, keeps it as `name`
    when given one, and says its edges, whether it closes, its length and where it lies.
    """
    obj = mesh_object(obj, "loop")
    checked_name(name)
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        starts, source, subject = start_edges(obj, shape, near, through, "loop")
        lengths = edge_lengths(obj, shape)
        loops, covered = [], set()
        for start in starts:
            if start.index in covered:
                continue
            found = loop_from(start)
            if len(found) > 1:
                loops.append(found)
                covered |= found
        if not loops:
            ends = " and ".join(str(n) for n in sorted((len(v.link_edges) for v in starts[0].verts), reverse=True))
            raise Refused(
                refused_start(
                    obj,
                    starts,
                    subject,
                    f"leads into no loop: {ends} edges meet at its ends. {NO_LOOP}",
                    f"leads into a loop. {NO_LOOP}",
                )
            )
        shape.edges.ensure_lookup_table()
        described = []
        for found in loops:
            pairs = [(i, shape.edges[i].verts[0].index, shape.edges[i].verts[1].index) for i in found]
            described.append(chain_text(chains(pairs)[0], lengths))
        chosen = sorted(covered)
        corners = corners_of(obj, shape, chosen)
        keep(obj, shape, "edges", chosen, name)
    finally:
        shape.free()
    heading = "the edge loop" if len(loops) == 1 else f"{len(loops)} edge loops"
    report(
        f"Took {heading} of {obj.name} through {source}: {chains_text(described, len(chosen), 'loops')}; "
        f"{spread(corners)}{kept_text(name)}"
    )
    return Picked(obj, "edges", chosen, name)


def ring_across(edge, face):
    """The edge across a quad from `edge`, or None when the face is not a quad."""
    if len(face.verts) != 4:
        return None
    ends = {v.index for v in edge.verts}
    opposite = [e for e in face.edges if not ends & {v.index for v in e.verts}]
    return opposite[0] if len(opposite) == 1 else None


def ring_from(start):
    """The edges of the ring across `start`, whether it closes, and the faces it crosses."""
    edges, faces, closed = {start.index}, set(), False
    if len(start.link_faces) > 2:
        return edges, closed, faces
    for first in start.link_faces:
        edge, face = start, first
        while True:
            opposite = ring_across(edge, face)
            if opposite is None:
                break
            faces.add(face.index)
            if opposite.index == start.index:
                closed = True
                break
            if opposite.index in edges:
                break
            edges.add(opposite.index)
            onward = [f for f in opposite.link_faces if f.index != face.index]
            if len(opposite.link_faces) != 2 or not onward:
                break
            edge, face = opposite, onward[0]
        if closed:
            break
    return edges, closed, faces


def ring(obj, *, near=None, through=None, name=None):
    """
    The edge ring across the edge nearest a point, or across each edge picked: each edge's opposite
    in the quads beside it, on until a face is not a quad or the mesh ends. Selects it, keeps it as
    `name` when given one, and says its edges, whether it closes, the faces it crosses, the edges'
    lengths and where it lies.
    """
    obj = mesh_object(obj, "ring")
    checked_name(name)
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        starts, source, subject = start_edges(obj, shape, near, through, "ring")
        lengths = edge_lengths(obj, shape)
        rings, covered = [], set()
        for start in starts:
            if start.index in covered:
                continue
            edges, closed, faces = ring_from(start)
            if len(edges) > 1:
                rings.append((edges, closed, faces))
                covered |= edges
        if not rings:
            beside = [len(f.verts) for f in starts[0].link_faces]
            why = (
                "it lies beside no face"
                if not beside
                else f"it lies between {len(beside)} faces, and a ring crosses an edge between two"
                if len(beside) > 2
                else f"the face beside it has {beside[0]}"
                if len(beside) == 1
                else f"the faces beside it have {beside[0]} and {beside[1]}"
            )
            raise Refused(
                refused_start(
                    obj,
                    starts,
                    subject,
                    f"is in no ring: a ring crosses faces of four sides, and {why}.",
                    "is in a ring: a ring crosses faces of four sides.",
                )
            )
        described = [
            f"{counted(len(edges), 'edge')}, {'closed' if closed else 'open'}, crossing "
            f"{counted(len(faces), 'face')}, {lengths_text([lengths[e] for e in edges])} long"
            for edges, closed, faces in rings
        ]
        chosen = sorted(covered)
        corners = corners_of(obj, shape, chosen)
        keep(obj, shape, "edges", chosen, name)
    finally:
        shape.free()
    heading = "the edge ring" if len(rings) == 1 else f"{len(rings)} edge rings"
    report(
        f"Took {heading} of {obj.name} across {source}: {chains_text(described, len(chosen), 'rings')}; "
        f"{spread(corners)}{kept_text(name)}"
    )
    return Picked(obj, "edges", chosen, name)


def boundary(obj, *, name=None):
    """
    The mesh's open boundary: its edges that belong to one face only, as the loops they make round
    holes and rims; given a pick, only the loops that touch it. Selects them, keeps them as `name`
    when given one, and says each loop's edges and length and where they lie.
    """
    within = None
    if isinstance(obj, Picked):
        within = obj
        obj = taken(within, "boundary")
    obj = mesh_object(obj, "boundary")
    checked_name(name)
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        rims = [e for e in shape.edges if len(e.link_faces) == 1]
        if not rims:
            total = len(shape.edges)
            many = sum(1 for e in shape.edges if len(e.link_faces) > 2)
            loose = sum(1 for e in shape.edges if not e.link_faces)
            if not many and not loose:
                raise Refused(f"{obj.name} has no open boundary: each of its {total} edges joins two faces.")
            raise Refused(
                f"{obj.name} has no open boundary: none of its {total} edges belongs to one face only"
                + (f"; {many} join three faces or more" if many else "")
                + (f"; {loose} belong to no face" if loose else "")
                + "."
            )
        found = chains([(e.index, e.verts[0].index, e.verts[1].index) for e in rims])
        source = ""
        if within is not None:
            touched = set(points_of(obj, within))
            every = len(found)
            found = [c for c in found if touched & set(c.points)]
            if not found:
                raise Refused(
                    f"None of {obj.name}'s {counted(every, 'open boundary loop')} touches {picked_words(within)}."
                )
            source = f" by {picked_words(within)}"
        lengths = edge_lengths(obj, shape)
        chosen = sorted(e for c in found for e in c.edges)
        corners = corners_of(obj, shape, chosen)
        keep(obj, shape, "edges", chosen, name)
    finally:
        shape.free()
    described = [chain_text(c, lengths) for c in found]
    report(
        f"Found the open boundary of {obj.name}{source}: {chains_text(described, len(chosen), 'loops')}; "
        f"{spread(corners)}{kept_text(name)}"
    )
    return Picked(obj, "edges", chosen, name)


def region_to_loop(picked, *, name=None):
    """
    The outline of a face region: the edges between a face picked and one not picked, or at the
    mesh's open edge. Selects it, keeps it as `name` when given one, and says its edges, the loops
    they make, their length and where they lie.
    """
    obj = taken(picked, "region_to_loop", ("faces",))
    checked_name(name)
    region = set(picked.indices)
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        outline = [e for e in shape.edges if sum(1 for f in e.link_faces if f.index in region) == 1]
        if not outline:
            raise Refused(
                f"The {counted(len(picked), 'face')} picked of {obj.name} have no outline:"
                " together they close on themselves."
            )
        found = chains([(e.index, e.verts[0].index, e.verts[1].index) for e in outline])
        lengths = edge_lengths(obj, shape)
        chosen = sorted(e.index for e in outline)
        corners = corners_of(obj, shape, chosen)
        keep(obj, shape, "edges", chosen, name)
    finally:
        shape.free()
    described = [chain_text(c, lengths) for c in found]
    report(
        f"Outlined {counted(len(picked), 'face')} of {obj.name}: {chains_text(described, len(chosen), 'loops')}; "
        f"{spread(corners)}{kept_text(name)}"
    )
    return Picked(obj, "edges", chosen, name)


def face_parts(shape, cut):
    """The mesh's faces parted into the pieces that reach each other without crossing an edge of `cut`."""
    shape.faces.ensure_lookup_table()
    apart = {edge for edge in shape.edges if edge.index in cut}
    parts = [[face.index for face in group] for group in joined_faces(shape, apart=apart)]
    part_of = {index: number for number, part in enumerate(parts) for index in part}
    return parts, part_of


def loop_to_region(picked, *, name=None):
    """
    The faces inside a loop of edges: of the pieces the edges part a mesh into, all but the largest
    by area, which is the smaller side for one loop. Selects them, keeps them as `name` when given
    one, and says their count and area beside the other side's, and where they lie.
    """
    obj = taken(picked, "loop_to_region", ("edges",), " region_to_loop turns faces into their outline.")
    checked_name(name)
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        parts, part_of = face_parts(shape, set(picked.indices))
        whole, whole_of = face_parts(shape, set())
        shape.faces.ensure_lookup_table()
        shape.edges.ensure_lookup_table()
        scale = scale_of(obj)
        area = [sum(shape.faces[i].calc_area() for i in part) * scale for part in parts]
        touched = {part_of[f.index] for i in picked.indices for f in shape.edges[i].link_faces}
        inside, outside, equal = [], [], False
        for piece in {whole_of[parts[p][0]] for p in touched}:
            sides = sorted((p for p in range(len(parts)) if whole_of[parts[p][0]] == piece), key=lambda p: -area[p])
            if len(sides) < 2:
                continue
            outside.append(sides[0])
            inside.extend(sides[1:])
            equal = equal or abs(area[sides[0]] - area[sides[1]]) <= 1e-6 * max(area[sides[0]], 1e-12)
        if not inside:
            them = "it" if len(picked) == 1 else "them"
            does = "does" if len(picked) == 1 else "do"
            raise Refused(
                f"{picked_words(picked)[0].upper()}{picked_words(picked)[1:]} {does} not part {obj.name}'s faces:"
                f" they all still reach each other around {them}."
            )
        chosen = sorted(i for p in inside for i in parts[p])
        rest = sum(len(parts[p]) for p in outside)
        corners = [obj.matrix_world @ v.co for i in chosen for v in shape.faces[i].verts]
        keep(obj, shape, "faces", chosen, name)
    finally:
        shape.free()
    which = (
        "one of two equal sides"
        if equal and len(inside) == 1
        else "the smaller side"
        if len(inside) == 1
        else f"the {len(inside)} smaller sides"
    )
    report(
        f"Took the faces inside {picked_words(picked)} of {obj.name}: {counted(len(chosen), 'face')}, "
        f"{area_text(sum(area[p] for p in inside))}, {which}; the other side holds {counted(rest, 'face')}, "
        f"{area_text(sum(area[p] for p in outside))}; {spread(corners)}{kept_text(name)}"
    )
    return Picked(obj, "faces", chosen, name)


def mark(picked, *, crease=None, bevel_weight=None, sharp=None, seam=None):
    """
    Sets crease, bevel weight, sharpness or seam on the edges picked, as Blender's own edge
    attributes keep them, and says for each how many edges it changed and how many of the mesh's
    edges now carry it.
    """
    obj = taken(picked, "mark", ("edges",), " region_to_loop gives a face region's outline as edges.")
    given = {"crease": crease, "bevel_weight": bevel_weight, "sharp": sharp, "seam": seam}
    need(any(v is not None for v in given.values()), "mark needs something to set: crease, bevel_weight, sharp or seam.")
    values = {}
    for argument in ("crease", "bevel_weight"):
        if given[argument] is not None:
            values[argument] = number(given[argument], argument, minimum=0, maximum=1)
    for argument in ("sharp", "seam"):
        if given[argument] is not None:
            need(isinstance(given[argument], bool), f"{argument} must be True or False.")
            values[argument] = given[argument]
    mesh = obj.data
    total = len(mesh.edges)
    said, changed_any = [], False
    for argument, key, kind, words in MARKS:
        if argument not in values:
            continue
        value = values[argument]
        attribute = mesh.attributes.get(key)
        if attribute is None:
            attribute = mesh.attributes.new(key, kind, "EDGE")
        need(
            attribute.domain == "EDGE" and attribute.data_type == kind,
            f"{obj.name} has an attribute named {key} that is not Blender's {argument} on edges.",
        )
        current = [False if kind == "BOOLEAN" else 0.0] * total
        attribute.data.foreach_get("value", current)
        changed = sum(1 for i in picked.indices if abs(float(current[i]) - float(value)) > 1e-6)
        for i in picked.indices:
            current[i] = value
        attribute.data.foreach_set("value", current)
        carried = sum(1 for v in current if v)
        changed_any = changed_any or changed > 0
        said.append(f"{words(value)}, {changed or 'none'} changed, now on {carried} of its {total} edges")
    mesh.update()
    report(
        f"Marked {counted(len(picked), 'edge')} of {obj.name}: {'; '.join(said)}."
        + ("" if changed_any else " Nothing changed: they were already so.")
    )
    return picked


def one_chain(obj, picked, what):
    """The one chain the edges picked make, refused when they make several or branch."""
    edges = obj.data.edges
    found = chains([(i, edges[i].vertices[0], edges[i].vertices[1]) for i in picked.indices])
    need(
        len(found) == 1,
        f"{what} takes one chain of edges; {picked_words(picked)} make {len(found)} separate chains."
        f" Give each its own call: zhiyin.loop takes one loop.",
    )
    need(
        not found[0].branching,
        f"{what} takes one chain of edges; {picked_words(picked)} branch, with more than two meeting at a point.",
    )
    return found[0]


def world_points(obj, indices):
    matrix = obj.matrix_world
    return [matrix @ obj.data.vertices[i].co for i in indices]


def put(obj, indices, places):
    """Moves the mesh's points to places in the world."""
    inverse = obj.matrix_world.inverted_safe()
    vertices = obj.data.vertices
    for i, place in zip(indices, places):
        vertices[i].co = inverse @ place
    obj.data.update()


def furthest(before, after):
    return max((a - b).length for a, b in zip(before, after))


def chain_kind(chain):
    return "a closed loop" if chain.closed else "an open chain"


def best_plane(places):
    """The plane nearest the places, as its centre, its normal and its spread's two ways across; None on a line."""
    centre = sum(places, mathutils.Vector()) / len(places)
    offsets = numpy.array([list(p - centre) for p in places])
    values, axes = numpy.linalg.eigh(offsets.T @ offsets)
    if values[1] <= 1e-12 * max(values[2], 1e-12):
        return None
    turn = [mathutils.Vector(axes[:, i].tolist()) for i in range(3)]
    return centre, turn[0], turn[2], turn[1]


def circle_through(places):
    """The circle nearest the places: its centre, normal, radius and in-plane axes; None on a line."""
    plane = best_plane(places)
    if plane is None:
        return None
    centre, normal, u, v = plane
    xs = [(p - centre).dot(u) for p in places]
    ys = [(p - centre).dot(v) for p in places]
    system = numpy.array([[x, y, 1.0] for x, y in zip(xs, ys)])
    target = numpy.array([-(x * x + y * y) for x, y in zip(xs, ys)])
    (d, e, _), *_ = numpy.linalg.lstsq(system, target, rcond=None)
    cx, cy = -d / 2, -e / 2
    middle = centre + u * cx + v * cy
    radius = sum(math.hypot(x - cx, y - cy) for x, y in zip(xs, ys)) / len(places)
    return middle, normal, radius, u, v


def off_round(places):
    """How far the places lie, at most, from the circle nearest them."""
    circle = circle_through(places)
    if circle is None:
        return math.inf
    middle, normal, radius, _, _ = circle
    worst = 0.0
    for p in places:
        offset = p - middle
        height = offset.dot(normal)
        across = (offset - normal * height).length
        worst = max(worst, math.hypot(across - radius, height))
    return worst


def circularize(picked, *, radius=None):
    """
    Makes a chain of edges round, as LoopTools' circle does: a closed loop's points spaced evenly on
    the circle nearest them, or an open chain's points moved onto it; at `radius` when given one.
    Says the circle, how far off round the points lay before and after, and how far they moved.
    """
    obj = taken(picked, "circularize", ("edges",), " zhiyin.loop or region_to_loop gives a loop of edges.")
    asked = None if radius is None else number(radius, "radius", minimum=0)
    need(asked is None or asked > 0, "radius must be greater than 0.")
    chain = one_chain(obj, picked, "circularize")
    count = len(chain.points)
    joins = "joins" if len(picked) == 1 else "join"
    need(count >= 3, f"A circle needs at least three points; {picked_words(picked)} {joins} {count}.")
    before = world_points(obj, chain.points)
    circle = circle_through(before)
    need(circle is not None, f"The {count} points picked lie on one line; no circle passes through them.")
    middle, normal, fitted, u, v = circle
    size = asked or fitted
    angles = [math.atan2((p - middle).dot(v), (p - middle).dot(u)) for p in before]
    if chain.closed:
        flat = [((p - middle).dot(u), (p - middle).dot(v)) for p in before]
        turning = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(flat, flat[1:] + flat[:1]))
        way = 1 if turning >= 0 else -1
        steps = [way * 2 * math.pi * i / count for i in range(count)]
        start = math.atan2(
            sum(math.sin(a - s) for a, s in zip(angles, steps)), sum(math.cos(a - s) for a, s in zip(angles, steps))
        )
        angles = [start + s for s in steps]
    after = [middle + (u * math.cos(a) + v * math.sin(a)) * size for a in angles]
    put(obj, chain.points, after)
    moved = furthest(before, after)
    report(
        f"Circularized {chain_kind(chain)} of {count} points on {obj.name}: radius {length(size)}"
        + (f" as asked (it fits {length(fitted)})" if asked else "")
        + f", centre {point_text(middle)}, facing {direction_text(normal, canonical=True)}; off round by up to "
        f"{length(off_round(before))} before, {length(off_round(after))} after; "
        + (f"points moved up to {length(moved)}." if moved > 1e-6 else "nothing moved: it was already round.")
    )
    return picked


def along(path, distance):
    """The place `distance` along a path of points."""
    for n in range(len(path) - 1):
        a, b = path[n], path[n + 1]
        step = (b - a).length
        if distance <= step or n == len(path) - 2:
            return a.lerp(b, min(1.0, distance / step) if step else 0.0)
        distance -= step
    return path[-1].copy()


def segments(places, closed):
    path = places + places[:1] if closed else places
    return [(b - a).length for a, b in zip(path, path[1:])]


def off_even(lengths):
    middle = sum(lengths) / len(lengths)
    return max(abs(s - middle) for s in lengths)


def space_evenly(picked):
    """
    Spaces a chain's points evenly along the path they make, as LoopTools' space does: an open
    chain keeps its ends, a closed loop its first point. Says how far off even its segments were
    before and after, and how far the points moved.
    """
    obj = taken(picked, "space_evenly", ("edges",), " zhiyin.loop gives a chain of edges.")
    chain = one_chain(obj, picked, "space_evenly")
    count = len(chain.points)
    joins = "joins" if len(picked) == 1 else "join"
    need(
        count >= 3,
        f"Spacing evenly needs a point between two others; {picked_words(picked)} {joins} only its 2 ends.",
    )
    before = world_points(obj, chain.points)
    path = before + before[:1] if chain.closed else before
    was = segments(before, chain.closed)
    total = sum(was)
    need(total > 0, f"The {count} points picked all lie at one place.")
    step = total / len(was)
    after = [along(path, i * step) for i in range(count)]
    if not chain.closed:
        after[-1] = before[-1].copy()
    put(obj, chain.points, after)
    now = segments(after, chain.closed)
    moved = furthest(before, after)
    report(
        f"Spaced {chain_kind(chain)} of {count} points on {obj.name} along its {length(total)}: segments off even by"
        f" up to {length(off_even(was))} before ({lengths_text(was).removeprefix('each ')}),"
        f" {length(off_even(now))} after ({lengths_text(now)}); "
        + (f"points moved up to {length(moved)}." if moved > 1e-6 else "nothing moved: they were already even.")
    )
    return picked


def flatten(picked, *, plane="best"):
    """
    Moves the points picked onto a plane: the one nearest them, or one given as a point and the way
    it faces. Says the plane, how far off it the points lay before and after, and how far they moved.
    """
    obj = taken(picked, "flatten")
    indices = points_of(obj, picked)
    count = len(indices)
    before = world_points(obj, indices)
    if isinstance(plane, str) and plane == "best":
        need(
            count > 3,
            f"{'Three points' if count == 3 else 'Fewer than three points'} always lie on a plane: flattening the"
            f" {counted(count, 'point')} picked onto their best-fit plane would move nothing."
            " Give plane=[point, normal] to flatten them onto another.",
        )
        fitted = best_plane(before)
        need(
            fitted is not None,
            f"The {count} points picked lie on one line, which every plane through it holds."
            " Give plane=[point, normal] to flatten them onto one.",
        )
        on, normal = fitted[0], fitted[1]
        said = f"their best-fit plane through {point_text(on)}, facing {direction_text(normal, canonical=True)}"
    else:
        need(
            isinstance(plane, (list, tuple)) and len(plane) == 2,
            'plane must be "best" or a point on it and the way it faces: [[x, y, z], [x, y, z]].',
        )
        on, normal = vector(plane[0], "plane's point"), direction(plane[1], "plane's normal")
        said = f"the plane through {point_text(on)}, facing {direction_text(normal)}"
    after = [p - normal * (p - on).dot(normal) for p in before]
    put(obj, indices, after)
    off_before = max(abs((p - on).dot(normal)) for p in before)
    off_after = max(abs((p - on).dot(normal)) for p in world_points(obj, indices))
    moved = furthest(before, after)
    report(
        f"Flattened {counted(count, 'point')} of {obj.name} onto {said}: off it by up to {length(off_before)} before,"
        f" {length(off_after)} after; "
        + (f"points moved up to {length(moved)}." if moved > 1e-6 else "nothing moved: they were already on it.")
    )
    return picked


def scale(picked, by, *, about=None):
    """
    Scales the points picked along the world's x, y and z about a point, as Blender's S does about
    the median point: by one factor, or by one for each axis, 0 pressing them flat across it. Says
    where they lay before and lie after.
    """
    obj = taken(picked, "scale")
    if isinstance(by, (int, float)) and not isinstance(by, bool):
        factors = [number(by, "by")] * 3
    else:
        need(
            isinstance(by, (list, tuple)) and len(by) == 3,
            "by is one factor, or one for each of x, y and z, such as [1, 0.5, 1].",
        )
        factors = [number(f, "by's factors") for f in by]
    need(any(abs(f - 1) > 1e-9 for f in factors), "by 1 on every axis moves nothing.")
    indices = points_of(obj, picked)
    before = world_points(obj, indices)
    centre = (
        vector(about, "about") if about is not None else sum(before, mathutils.Vector()) / len(before)
    )
    after = [centre + mathutils.Vector([(p - centre)[i] * factors[i] for i in range(3)]) for p in before]
    put(obj, indices, after)
    said = f"{factors[0]:g}" if len(set(factors)) == 1 else ", ".join(f"{f:g}" for f in factors)
    report(
        f"Scaled {counted(len(indices), 'point')} of {obj.name} by {said} about {point_text(centre)}:"
        f" they lay at {spread(before)}; now at {spread(world_points(obj, indices))}."
    )
    return picked


AXIS_NAMES = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}


def rotate(picked, degrees, *, axis, about=None):
    """
    Turns the points picked by `degrees` about an axis of the world, or one given as three numbers,
    through their middle or a point given, as Blender's R does, counter-clockwise looking down the
    axis. Says where they lay before and lie after.
    """
    obj = taken(picked, "rotate")
    angle = number(degrees, "degrees")
    need(abs(angle) > 1e-9, "A turn of 0° moves nothing.")
    if isinstance(axis, str):
        need(axis in AXIS_NAMES, 'axis is "x", "y" or "z", or [x, y, z].')
        way, axis_said = mathutils.Vector(AXIS_NAMES[axis]), axis
    else:
        way = vector(axis, "axis")
        need(way.length > 1e-12, "axis [0, 0, 0] points nowhere.")
        axis_said = "[" + ", ".join(f"{c:g}" for c in axis) + "]"
    indices = points_of(obj, picked)
    before = world_points(obj, indices)
    centre = vector(about, "about") if about is not None else sum(before, mathutils.Vector()) / len(before)
    turn = mathutils.Matrix.Rotation(math.radians(angle), 3, way.normalized())
    put(obj, indices, [centre + turn @ (p - centre) for p in before])
    report(
        f"Turned {counted(len(indices), 'point')} of {obj.name} by {angle:g}° about {axis_said} through"
        f" {point_text(centre)}: they lay at {spread(before)}; now at {spread(world_points(obj, indices))}."
    )
    return picked


def distances_along(obj, sources, reach):
    """How far each point lies from the nearest source along the mesh's edges, for those nearer than `reach`."""
    matrix = obj.matrix_world
    places = [matrix @ v.co for v in obj.data.vertices]
    links = {}
    for edge in obj.data.edges:
        a, b = edge.vertices
        gap = (places[a] - places[b]).length
        links.setdefault(a, []).append((b, gap))
        links.setdefault(b, []).append((a, gap))
    found = {i: 0.0 for i in sources}
    queue = [(0.0, i) for i in sources]
    while queue:
        gone, at = heapq.heappop(queue)
        if gone > found.get(at, math.inf):
            continue
        for other, gap in links.get(at, ()):
            further = gone + gap
            if further < reach and further < found.get(other, math.inf):
                found[other] = further
                heapq.heappush(queue, (further, other))
    return found


def distances_near(obj, sources, reach):
    """How far each point lies from the nearest source in a straight line, for those nearer than `reach`."""
    matrix = obj.matrix_world
    tree = mathutils.kdtree.KDTree(len(sources))
    for n, i in enumerate(sources):
        tree.insert(matrix @ obj.data.vertices[i].co, n)
    tree.balance()
    found = {}
    for vertex in obj.data.vertices:
        gap = tree.find(matrix @ vertex.co)[2]
        if gap < reach:
            found[vertex.index] = gap
    return found


def move(picked, by, *, falloff=0, shape="smooth", connected=False):
    """
    Moves the points picked by `by` in the world, and, as proportional editing does, the points
    within `falloff` metres of them by a share that falls with their distance in the shape given,
    measured in a straight line or, when connected, along the mesh. Says how many moved fully and
    partly, and the largest and smallest of the partial moves.
    """
    obj = taken(picked, "move")
    shift = vector(by, "by")
    need(shift.length > 0, "by [0, 0, 0] moves nothing.")
    reach = number(falloff, "falloff", minimum=0, default=0)
    need(shape in FALLOFFS, f"shape must be {one_of(FALLOFFS)}.")
    need(isinstance(connected, bool), "connected must be True or False.")
    core = points_of(obj, picked)
    shares = {i: 1.0 for i in core}
    if reach > 0:
        found = (distances_along if connected else distances_near)(obj, core, reach)
        for i, gap in found.items():
            if i not in shares:
                share = FALLOFFS[shape](1 - gap / reach)
                if share > 1e-9:
                    shares[i] = share
    local = obj.matrix_world.inverted_safe().to_3x3() @ shift
    vertices = obj.data.vertices
    for i, share in shares.items():
        vertices[i].co = vertices[i].co + local * share
    obj.data.update()
    now = spread(world_points(obj, core))
    picked_points = set(core)
    partly = sorted(share * shift.length for i, share in shares.items() if i not in picked_points)
    head = f"Moved {counted(len(shares), 'point')} of {obj.name}"
    where = f"within {length(reach)}" + (" along the mesh" if connected else "")
    if not partly:
        report(
            f"{head} by {point_text(shift)}, now at {now}" + (f"; none other lies {where}." if reach > 0 else ".")
        )
    else:
        report(
            f"{head}: the {len(core)} picked fully by {point_text(shift)}, now at {now}; {len(partly)} more {where}"
            f" partly ({shape}), by "
            + (f"{length(partly[0])} each." if partly[-1] - partly[0] < 1e-6 else f"{length(partly[0])} to {length(partly[-1])}.")
        )
    return picked


FUNCTIONS = (
    loop,
    ring,
    boundary,
    region_to_loop,
    loop_to_region,
    mark,
    circularize,
    space_evenly,
    flatten,
    move,
    scale,
    rotate,
)
