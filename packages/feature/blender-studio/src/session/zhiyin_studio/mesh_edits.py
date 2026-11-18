"""
Changing a mesh's shape where a pick says: extrude, inset, bevel, bridge, fill, loop cut, merge and
symmetrize. Each works in the world's metres, then measures what it made and says so in one line:
the faces, edges and points before and after, the sizes made against those asked, and any open,
loose, flat or crossing faces it left. A pick an edit has used is spent, since what it held has
moved; each edit hands back a pick of what it made.
"""

import bmesh
import mathutils
import mathutils.geometry
import numpy
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

from .arguments import is_number, need, number, vector, whole
from .errors import Refused
from .look_counts import islands, turned_round
from .mesh_math import to_segment
from .picking import SINGULAR, Picked, elements, keep, mesh_object, spend, spread, unspent
from .reports import report
from .wording import length, listed, point_text

PLURAL = {"faces": "faces", "edges": "edges", "verts": "points"}
# A grid fill spans the hole's edges over this many faces across, unless the call says.
SPAN_PART = 4
AXES = {"x": 0, "y": 1, "z": 2}
HEADINGS = (
    ("+x", (1, 0, 0)),
    ("-x", (-1, 0, 0)),
    ("+y", (0, 1, 0)),
    ("-y", (0, -1, 0)),
    ("+z", (0, 0, 1)),
    ("-z", (0, 0, -1)),
)
# What a tally says beyond the counts, when an edit changed it.
SHAPE_FLAWS = (
    ("open", "open edges"),
    ("loose", "loose edges"),
    ("crowded", "edges shared by more than two faces"),
    ("flat", "faces with no area"),
    ("crossing", "pairs of crossing faces"),
)


def said(count, kind):
    """A count of faces, edges or points, in the singular for one."""
    return f"{count} {PLURAL[kind] if count != 1 else SINGULAR[kind]}"


def heading(direction):
    """A direction as +x, -z and so on when it is one, or else as three numbers."""
    direction = direction.normalized()
    for name, axis in HEADINGS:
        if direction.dot(axis) > 1 - 1e-9:
            return name
    return "[" + ", ".join(f"{(c if abs(c) > 1e-6 else 0.0) + 0.0:.3g}" for c in direction) + "]"


def distances(values):
    """One distance, or the least to the most of several."""
    low, high = min(values), max(values)
    return length(low) if high - low < 1e-6 else f"{length(low)} to {length(high)}"


def taken(picked, what, kinds, wrong):
    """The mesh object a pick was made on, refused when the pick is spent, of the wrong kind or out of date."""
    need(isinstance(picked, Picked), f"{what} takes a pick made by zhiyin.pick or zhiyin.picked.")
    try:
        unspent(picked)
        obj = mesh_object(picked.object, what)
    except ReferenceError:
        raise Refused("The object this pick was made on is gone.") from None
    if picked.kind not in kinds:
        raise Refused(wrong(picked.kind))
    held = {"faces": obj.data.polygons, "edges": obj.data.edges, "verts": obj.data.vertices}[picked.kind]
    need(
        all(i < len(held) for i in picked.indices),
        f"This pick holds {picked.kind} {obj.name} no longer has: the mesh changed since. Pick again.",
    )
    return obj


def world_shape(obj):
    """The object's mesh as a bmesh in world coordinates, with faces facing out as they do in the world."""
    matrix = obj.matrix_world.copy()
    turn = matrix.to_3x3().determinant()
    need(abs(turn) > 1e-12, f"{obj.name} is scaled to nothing in some direction; give it a size first.")
    shape = bmesh.new()
    shape.from_mesh(obj.data)
    shape.transform(matrix)
    if turn < 0:
        bmesh.ops.reverse_faces(shape, faces=list(shape.faces))
    shape.normal_update()
    return shape, matrix


def write(obj, shape, matrix, kind, made):
    """Puts the world bmesh back into the object's own space and mesh, with `made` selected; their indices."""
    if matrix.to_3x3().determinant() < 0:
        bmesh.ops.reverse_faces(shape, faces=list(shape.faces))
    shape.transform(matrix.inverted())
    shape.verts.index_update()
    shape.edges.index_update()
    shape.faces.index_update()
    chosen = sorted({element.index for element in made if element.is_valid})
    keep(obj, shape, kind, chosen, None)
    return chosen


def crossing_pairs(shape):
    """
    How many pairs of faces pass through one another, not counting faces that touch at a point,
    whether they share it or each has a point in the same place.
    """
    if not shape.faces:
        return 0
    shape.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(shape)
    faces = shape.faces

    def places(face):
        return {tuple(round(c, 6) for c in v.co) for v in face.verts}

    return sum(1 for a, b in tree.overlap(tree) if a < b and not places(faces[a]) & places(faces[b]))


def tally(shape):
    """What a mesh holds: faces, edges and points, and its open, loose, crowded, flat and crossing ones."""
    shape.verts.index_update()
    shape.edges.index_update()
    shape.faces.index_update()
    found = {"faces": len(shape.faces), "edges": len(shape.edges), "verts": len(shape.verts)}
    sides = [len(edge.link_faces) for edge in shape.edges]
    found["open"] = sides.count(1)
    found["loose"] = sides.count(0)
    found["crowded"] = sum(1 for n in sides if n > 2)
    found["flat"] = sum(1 for face in shape.faces if face.calc_area() <= 1e-12)
    found["crossing"] = crossing_pairs(shape)
    return found


def changes(before, after):
    """Counts before and after, and each flaw whose count an edit changed."""
    counts = ", ".join(f"{before[k]} → {said(after[k], k)}" for k in ("faces", "edges", "verts"))
    flaws = [f"{label} {before[k]} → {after[k]}" for k, label in SHAPE_FLAWS if before[k] != after[k]]
    return counts + ("; " + ", ".join(flaws) if flaws else "")


def kind_named(kind):
    return PLURAL[kind]


def faces_from(shape, count):
    """
    The faces past the first `count`: those an operator added, since bmesh operators that only add
    keep the faces there were first, in their order, even where they end those faces' Python
    references.
    """
    shape.faces.ensure_lookup_table()
    return [shape.faces[i] for i in range(count, len(shape.faces))]


def extrude(picked, by, *, along="normal"):
    """
    Extrudes what a pick took and moves the new copy: faces by metres along their normals (or
    against them, for less than 0), along their average normal, or each face on its own; edges
    by metres along the normals of the faces beside them, as Alt-S does, or onward past those
    faces, carrying the surface on; or faces, edges and points by a direction given as [x, y, z]
    in metres. Says how far and which way the new copy moved and where it lies, and hands back a
    pick of it.
    """
    obj = taken(
        picked,
        "extrude",
        ("faces", "edges", "verts"),
        lambda kind: "extrude takes faces, edges or points.",
    )
    kind = picked.kind
    need(along in ("normal", "average", "each", "onward"), "along must be normal, average, each or onward.")
    if is_number(by):
        need(by != 0, "by must not be 0: say how far to extrude, in metres.")
        if kind == "verts":
            raise Refused(
                "Extruding points takes a direction as three numbers, such as by=[0, 0, 0.1]:"
                " points have no normal of their own to follow."
            )
        offset = None
    else:
        offset = vector(by, "by")
        need(offset.length > 1e-9, "by must not be [0, 0, 0].")
    need(along != "each" or kind == "faces", f"along='each' extrudes faces each on its own; the pick holds {kind_named(kind)}.")
    need(
        along != "onward" or (kind == "edges" and offset is None),
        "along='onward' extrudes edges by a distance past the faces beside them.",
    )
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        items = elements(shape, kind)
        chosen = [items[i] for i in picked.indices]
        moves = {}
        if kind == "faces" and along == "each":
            made = bmesh.ops.extrude_discrete_faces(shape, faces=chosen)["faces"]
            for face in made:
                face.normal_update()
                for v in face.verts:
                    moves[v] = offset if offset is not None else face.normal * by
            moved = [v for face in made for v in face.verts]
        elif kind == "faces":
            geom = chosen + list({e for f in chosen for e in f.edges}) + list({v for f in chosen for v in f.verts})
            out = bmesh.ops.extrude_face_region(shape, geom=geom)["geom"]
            made = [g for g in out if isinstance(g, bmesh.types.BMFace)]
            moved = [g for g in out if isinstance(g, bmesh.types.BMVert)]
            for face in made:
                face.normal_update()
            region = set(made)
            if offset is not None:
                moves = {v: offset for v in moved}
            elif along == "average" or len(made) == 1:
                average = sum((f.normal * f.calc_area() for f in made), mathutils.Vector())
                need(average.length > 1e-12, "The faces picked face every way at once: they have no average normal.")
                moves = {v: average.normalized() * by for v in moved}
            else:
                for v in moved:
                    normals = [f.normal for f in v.link_faces if f in region]
                    facing = sum(normals, mathutils.Vector())
                    facing = facing.normalized() if facing.length > 1e-12 else normals[0]
                    stretch = sum(1 / max(facing.dot(n), 0.1) for n in normals) / len(normals)
                    moves[v] = facing * by * stretch
        elif kind == "edges":
            if offset is None:
                ways = edge_ways(chosen, by, along)
            out = bmesh.ops.extrude_edge_only(shape, edges=chosen)["geom"]
            moved = [g for g in out if isinstance(g, bmesh.types.BMVert)]
            fresh = set(moved)
            made = [g for g in out if isinstance(g, bmesh.types.BMEdge) and all(v in fresh for v in g.verts)]
            if offset is not None:
                moves = {v: offset for v in moved}
            else:
                # Each new point goes the way its original's would, which the edge joining them names.
                moves = {}
                for v in moved:
                    source = next(e.other_vert(v) for e in v.link_edges if e.other_vert(v) not in fresh)
                    moves[v] = ways.get(source, mathutils.Vector())
        else:
            moved = bmesh.ops.extrude_vert_indiv(shape, verts=chosen)["verts"]
            made = list(moved)
            moves = {v: offset for v in moved}
        moved = list(dict.fromkeys(moved))
        for v in moved:
            v.co += moves[v]
        shape.normal_update()
        travel = [moves[v].length for v in moved]
        average_move = sum((moves[v] for v in moved), mathutils.Vector())
        corners = [v.co.copy() for v in moved]
        after = tally(shape)
        made_kind = kind
        chosen_after = write(obj, shape, matrix, made_kind, made)
    finally:
        shape.free()
    if offset is not None:
        how = f"towards {heading(offset)}"
    elif kind == "edges":
        travel = [abs(by)]
        if along == "onward":
            how = "onward past the faces beside them" if by > 0 else "back over the faces beside them"
        elif along == "average":
            how = f"{'along' if by > 0 else 'against'} the average normal of the faces beside them, {heading(average_move)}"
        else:
            how = f"{'along' if by > 0 else 'against'} the normals of the faces beside them"
    elif along == "each":
        how = "each along its own normal" if by > 0 else "each against its own normal"
    elif along == "average" or len(chosen_after) == 1:
        way = "along" if by > 0 else "against"
        whose = "its normal" if len(chosen_after) == 1 else "their average normal"
        how = f"{way} {whose}, {heading(average_move)}"
    else:
        how = "along their normals" if by > 0 else "against their normals"
    new = said(len(chosen_after), made_kind).split(" ", 1)[1]
    report(
        f"Extruded {said(len(picked), kind)} of {obj.name} {distances(travel)} {how}: {changes(before, after)};"
        f" the new {new} {'lies' if len(chosen_after) == 1 else 'lie'} at {spread(corners)}."
    )
    spend(picked, "extrude")
    return Picked(obj, made_kind, chosen_after)


def edge_ways(edges, by, along):
    """
    Where extruding edges by a distance moves each of their points: along the normals of the
    faces beside the edges, kept as far from those faces' planes all round as asked, as Alt-S
    keeps an even thickness; along those faces' average normal; or onward past the faces, the
    way the surface runs on beyond the edges. Refused for edges with no face beside them.
    """
    bare = sum(1 for e in edges if not e.link_faces)
    if bare:
        raise Refused(
            f"Extruding edges by a distance follows the faces beside them, and {bare} of the edges picked border"
            " none: give a direction as three numbers, such as by=[0, 0, 0.1]."
        )
    if along == "onward":
        onward_ways = onward(edges)
        return {v: way * by for v, way in onward_ways.items()}
    beside = {}
    for e in edges:
        for v in e.verts:
            beside.setdefault(v, set()).update(e.link_faces)
    if along == "average":
        faces = set().union(*beside.values())
        average = sum((f.normal * f.calc_area() for f in faces), mathutils.Vector())
        need(average.length > 1e-12, "The faces beside the edges face every way at once: they have no average normal.")
        return {v: average.normalized() * by for v in beside}
    ways = {}
    for v, faces in beside.items():
        normals = [f.normal for f in faces]
        facing = sum(normals, mathutils.Vector())
        facing = facing.normalized() if facing.length > 1e-12 else normals[0]
        stretch = sum(1 / max(facing.dot(n), 0.1) for n in normals) / len(normals)
        ways[v] = facing * by * stretch
    return ways


def run_inset(shape, faces, thickness, depth, individual, outset):
    """Insets faces of a bmesh; the ring faces it made."""
    if individual:
        return bmesh.ops.inset_individual(
            shape, faces=faces, thickness=thickness, depth=depth, use_even_offset=True
        )["faces"]
    return bmesh.ops.inset_region(
        shape, faces=faces, thickness=thickness, depth=depth, use_even_offset=True, use_outset=outset
    )["faces"]


def ring_widths(ring, inset_faces, outset):
    """
    Each ring face's width across, from its edge on the inset face to the edge opposite: in the
    plane of the inset face, so a depth does not count, or in the ring face's own plane for an
    outset, whose ring runs down the faces around. None when a ring face is turned inside out, its
    inner edge running the same way as its outer one, or gone.
    """
    widths = []
    for face in ring:
        inner = next((loop for loop in face.loops if any(f in inset_faces for f in loop.edge.link_faces)), None)
        if inner is None or len(face.loops) != 4:
            continue
        outer = inner.link_loop_next.link_loop_next
        along_inner = inner.link_loop_next.vert.co - inner.vert.co
        along_outer = outer.link_loop_next.vert.co - outer.vert.co
        if along_inner.length < 1e-9 or along_outer.length < 1e-9 or along_inner.dot(along_outer) >= 0:
            return None
        normal = face.normal if outset else next(f for f in inner.edge.link_faces if f in inset_faces).normal
        a, b, c, d = (
            loop.vert.co - normal * loop.vert.co.dot(normal)
            for loop in (inner, inner.link_loop_next, outer, outer.link_loop_next)
        )
        area = mathutils.geometry.area_tri(a, b, c) + mathutils.geometry.area_tri(a, c, d)
        sides = (b - a).length + (d - c).length
        widths.append(2 * area / sides if sides > 1e-12 else 0.0)
    return widths


def inset_widths(shape, indices, thickness, depth, individual, outset):
    """The ring widths an inset of the faces at `indices` makes in a copy of the bmesh, or None when it turns over."""
    trial = shape.copy()
    try:
        trial.faces.ensure_lookup_table()
        faces = [trial.faces[i] for i in indices]
        ring = run_inset(trial, faces, thickness, depth, individual, outset)
        trial.normal_update()
        return ring_widths(ring, set(faces), outset)
    finally:
        trial.free()


def inset(picked, thickness, *, depth=0, individual=False, outset=False):
    """
    Insets the picked faces by `thickness` metres, keeping each ring as wide all round, and raises
    the inner faces by `depth` (sinks them, for less than 0). Faces inset together share one ring;
    `individual` gives each its own. `outset` grows the ring outwards instead. Says the ring's
    narrowest width, and refuses a thickness that turns the ring inside out, saying how much fits.
    Hands back a pick of the inner faces.
    """
    obj = taken(
        picked,
        "inset",
        ("faces",),
        lambda kind: f"inset takes faces, and the pick holds {kind_named(kind)}: pick the faces to inset.",
    )
    wide = number(thickness, "thickness", minimum=0)
    need(wide > 0, "thickness must be more than 0.")
    deep = number(depth, "depth", default=0)
    need(isinstance(individual, bool) and isinstance(outset, bool), "individual and outset are True or False.")
    need(not (individual and outset), "Faces inset one by one cannot be outset; outset them together.")
    count = len(picked)
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        indices = list(picked.indices)
        if inset_widths(shape, indices, wide, deep, individual, outset) is None:
            low, high = 0.0, wide
            for _ in range(24):
                middle = (low + high) / 2
                if inset_widths(shape, indices, middle, deep, individual, outset) is None:
                    high = middle
                else:
                    low = middle
            verb = "Outsetting" if outset else "Insetting"
            raise Refused(
                f"{verb} {said(count, 'faces')} of {obj.name} by {length(wide)} turns {'its' if count == 1 else 'their'}"
                " ring inside out. "
                + (
                    f"At most about {length(low)} keeps every face."
                    if low > 1e-6
                    else "No inset of these faces keeps every face."
                )
            )
        shape.faces.ensure_lookup_table()
        faces = [shape.faces[i] for i in indices]
        ring = run_inset(shape, faces, wide, deep, individual, outset)
        shape.normal_update()
        widths = ring_widths(ring, set(faces), outset) or [wide]
        after = tally(shape)
        inner = write(obj, shape, matrix, "faces", faces)
    finally:
        shape.free()
    narrowest = min(widths)
    width = (
        f"{length(wide)} wide"
        if abs(narrowest - wide) <= 1e-6 + 1e-4 * wide
        else f"{length(narrowest)} wide at its narrowest, asked {length(wide)}"
    )
    raised = f", {length(abs(deep))} {'raised' if deep > 0 else 'sunk'}" if deep else ""
    report(
        f"{'Outset' if outset else 'Inset'} {said(count, 'faces')} of {obj.name}"
        f" {'each ' if individual and count > 1 else ''}by {length(wide)}{raised}: {changes(before, after)};"
        f" the ring is {width}."
    )
    spend(picked, "inset")
    return Picked(obj, "faces", inner)


def nearest_to_segments(point, segments):
    """How far a point is from the nearest of some segments, each two points."""
    return min((to_segment(point, a, b) for a, b in segments), default=None)


def bevel(picked, width, *, segments=1, profile=0.5, clamp=True, affect=None):
    """
    Bevels the picked edges, or points with affect="verts", by `width` metres from each, in
    `segments` rows shaped by `profile` (0.5 round, towards 1 square, towards 0 hollow). With
    `clamp`, the width shrinks where faces would overlap, and the line says by how much. Hands back
    a pick of the faces made.
    """
    wrong = (
        lambda kind: f"bevel takes edges or points, and the pick holds {kind_named(kind)}:"
        " pick kind='edges' for the edges to round."
    )
    obj = taken(picked, "bevel", ("edges", "verts"), wrong)
    need(affect in (None, "edges", "verts"), "affect must be edges or verts.")
    affect = affect or picked.kind
    need(
        not (affect == "edges" and picked.kind == "verts"),
        "affect='edges' bevels edges, and the pick holds points: pick kind='edges'.",
    )
    wide = number(width, "width", minimum=0)
    need(wide > 0, "width must be more than 0.")
    rows = whole(segments, "segments", minimum=1, maximum=100, default=1)
    shape_of = number(profile, "profile", minimum=0, maximum=1, default=0.5)
    need(isinstance(clamp, bool), "clamp is True or False.")
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        items = elements(shape, picked.kind)
        chosen = [items[i] for i in picked.indices]
        if affect == "verts" and picked.kind == "edges":
            chosen = list({v for e in chosen for v in e.verts})
        if affect == "edges":
            originals = [(e.verts[0].co.copy(), e.verts[1].co.copy()) for e in chosen]
        else:
            originals = [(v.co.copy(), v.co.copy()) for v in chosen]
        why_not = bevel_without_corner(chosen, affect)
        out = bmesh.ops.bevel(
            shape,
            geom=chosen,
            offset=wide,
            offset_type="OFFSET",
            segments=rows,
            profile=shape_of,
            affect="EDGES" if affect == "edges" else "VERTICES",
            clamp_overlap=clamp,
        )
        made = out["faces"]
        need(made, f"The bevel of {said(len(originals), affect)} of {obj.name} made nothing: {why_not}")
        region = set(made)
        rims = {v for f in made for v in f.verts if any(g not in region for g in v.link_faces)}
        widths = [nearest_to_segments(v.co, originals) for v in rims] or [wide]
        shape.normal_update()
        after = tally(shape)
        chosen_after = write(obj, shape, matrix, "faces", made)
    finally:
        shape.free()
    narrow, broad = min(widths), max(widths)
    if narrow < wide * (1 - 1e-4) - 1e-7:
        why = "clamped so faces do not overlap" if clamp else "narrower where the mesh left no room"
        made_width = length(narrow) if broad - narrow < 1e-6 else f"{length(narrow)} to {length(broad)}"
        sized = f", asked {length(wide)}, made {made_width} ({why})"
    else:
        sized = f" {length(wide)}"
    report(
        f"Bevelled {said(len(originals), affect)} of {obj.name}{sized}, {rows} segment{'s' if rows != 1 else ''}:"
        f" {changes(before, after)}; {said(len(chosen_after), 'faces')} added."
    )
    spend(picked, "bevel")
    return Picked(obj, "faces", chosen_after)


def bevel_without_corner(chosen, affect):
    """Why a bevel of these elements would make nothing."""
    if affect == "edges" and all(len(e.link_faces) < 2 for e in chosen):
        return "edges with fewer than two faces have no corner to round."
    return "nothing there has a corner to round."


def edge_runs(edges):
    """
    Edges grouped into runs joined end to end, in the mesh's order: each run's edges, whether it
    closes, and whether it branches.
    """
    edges = sorted(edges, key=lambda e: e.index)
    left = set(edges)
    runs = []
    for first in edges:
        if first not in left:
            continue
        left.discard(first)
        run = {first}
        reach = list(first.verts)
        while reach:
            v = reach.pop()
            for e in v.link_edges:
                if e in left:
                    left.discard(e)
                    run.add(e)
                    reach.extend(e.verts)
        degree = {}
        for e in run:
            for v in e.verts:
                degree[v] = degree.get(v, 0) + 1
        branches = any(n > 2 for n in degree.values())
        closed = not branches and all(n == 2 for n in degree.values())
        runs.append((sorted(run, key=lambda e: e.index), closed, branches))
    return runs


def in_order(run):
    """A closed run's edges and points in walking order."""
    order, points = [run[0]], [run[0].verts[0]]
    at = run[0].verts[1]
    left = set(run[1:])
    while left:
        step = next(e for e in at.link_edges if e in left)
        left.discard(step)
        order.append(step)
        points.append(at)
        at = step.other_vert(at)
    return order, points


def listed_counts(counts):
    return listed(str(c) for c in counts)


def rails_of(shape, edge_indices, made_edges):
    """The edges a bridge made between its two loops, by their ends: one on each loop."""
    items = elements(shape, "edges")
    one, other = ({v for i in run for v in items[i].verts} for run in edge_indices)
    return [
        e
        for e in made_edges
        if e.is_valid and (e.verts[0] in one and e.verts[1] in other or e.verts[1] in one and e.verts[0] in other)
    ]


def bridged_rails(shape, runs, turn):
    """The lengths of the edges between the loops a bridge turned by `turn` makes, tried on a copy of the bmesh."""
    trial = shape.copy()
    try:
        items = elements(trial, "edges")
        out = bmesh.ops.bridge_loops(trial, edges=[items[i] for run in runs for i in run], twist_offset=turn)
        return [e.calc_length() for e in rails_of(trial, runs, out["edges"])]
    finally:
        trial.free()


# A bridge is twisted when its edges between the loops are this much longer, in all, than another turn makes them.
TWISTED = 0.02


def turned_by(one, other, rails):
    """
    How many edges round two closed loops a bridge's pairing of their points is turned from the
    pairing that makes the edges between them shortest in all, or 0.
    """
    ring = in_order(one)[1]
    round_other = in_order(other)[1]
    count = len(ring)
    partner = {}
    for e in rails:
        a, b = e.verts
        partner[a], partner[b] = b, a
    if any(v not in partner for v in ring):
        return 0
    at = {v: i for i, v in enumerate(round_other)}
    start = at[partner[ring[0]]]
    way = 1 if at[partner[ring[1]]] == (start + 1) % count else -1

    def total(shift):
        return sum((ring[i].co - round_other[(shift + way * i) % count].co).length for i in range(count))

    best = min(range(count), key=total)
    if total(start) <= total(best) * (1 + TWISTED) + 1e-9:
        return 0
    apart = (start - best) % count
    return min(apart, count - apart)


def untwisted(unbridged, runs, turn, lengths, steps):
    """
    The twist that undoes a bridge turned `steps` edges round, and its edges' lengths then: of
    the twists within a step of as far either way, the nearest 0 of those that make them shortest.
    """
    around = sorted((t for t in range(turn - steps - 1, turn + steps + 2) if t != turn), key=lambda t: (abs(t), t))
    tried = [(bridged_rails(unbridged, runs, t), t) for t in around]
    tried = [(found, t) for found, t in tried if len(found) == len(lengths)]
    if not tried:
        return None
    least = min(sum(found) for found, _ in tried)
    found, better = next((found, t) for found, t in tried if sum(found) <= least * (1 + 1e-6))
    return (steps, better, found) if sum(found) < sum(lengths) else None


def onward(run):
    """
    For each point of a loop, the way its surface runs on past the loop, away from the faces the
    loop already borders; nothing for a point with none.
    """
    ways = {}
    for edge in run:
        for face in edge.link_faces:
            middle = face.calc_center_median()
            along = (edge.verts[1].co - edge.verts[0].co).normalized()
            for v in edge.verts:
                away = v.co - middle
                away -= along * away.dot(along)
                if away.length > 1e-12:
                    ways[v] = ways.get(v, mathutils.Vector((0, 0, 0))) + away.normalized()
    return {v: w.normalized() for v, w in ways.items() if w.length > 1e-12}


def rail_points(shape, first, rails, rows):
    """
    Each edge between a bridge's loops as the points its cuts made along it, walked from its
    start: each the new point nearest where the cut put it, so a rail lying along another's line
    takes none of that one's points.
    """
    shape.verts.index_update()
    shape.verts.ensure_lookup_table()
    found = []
    for start, _, a, b, _, _ in rails:
        on_rail, at = [], shape.verts[start]
        for k in range(1, rows + 1):
            expected = a + (b - a) * (k / (rows + 1))
            ahead = [n for n in (e.other_vert(at) for e in at.link_edges) if n.index >= first and n not in on_rail]
            if not ahead:
                break
            at = min(ahead, key=lambda n: (n.co - expected).length)
            on_rail.append(at)
        found.append(on_rail)
    return found


def bowed(rails, points, bow, rows):
    """
    Moves the points a bridge's cuts made along each edge between its loops onto a curve that
    leaves each loop the way its surface runs on, `bow` times the edge's length strong; the
    furthest a point moved.
    """
    furthest = 0.0
    for (_, _, a, b, out_a, out_b), on_rail in zip(rails, points):
        line = b - a
        span = line.length
        if span < 1e-12:
            continue
        leave = out_a if out_a is not None else line / span
        arrive = -out_b if out_b is not None else line / span
        strength = bow * span
        for k, v in enumerate(on_rail, 1):
            s = k / (rows + 1)
            curved = (
                a * (2 * s**3 - 3 * s**2 + 1)
                + leave * strength * (s**3 - 2 * s**2 + s)
                + b * (3 * s**2 - 2 * s**3)
                + arrive * strength * (s**3 - s**2)
            )
            furthest = max(furthest, (curved - v.co).length)
            v.co = curved
    return furthest


def band_clashes(edges, band):
    """
    How many of the loops' edges a band runs along the same way as the face already beside it
    does: where it does, the surface turns inside out.
    """
    band = set(band)
    clashes = 0
    for edge in edges:
        starts = [(face in band, next(lp for lp in face.loops if lp.edge == edge).vert) for face in edge.link_faces]
        mine = [v for inside, v in starts if inside]
        theirs = [v for inside, v in starts if not inside]
        if mine and theirs and mine[0] == theirs[0]:
            clashes += 1
    return clashes


def facing_band(shape, runs, turn):
    """
    Joins two closed loops, each bordering faces on one side, with a band wound as those faces
    are, so the surface goes on facing one way across it: the band runs along each loop against
    the face beside it. Each point is paired with the other loop's so the edges between them are
    shortest in all, turned by `turn` edges. Answers those edges, the first loop's end first.
    """
    items = elements(shape, "edges")
    rings = []
    for run, with_faces in zip(runs, (True, False)):
        edges, points = in_order([items[i] for i in run])
        start = next(lp for lp in edges[0].link_faces[0].loops if lp.edge == edges[0]).vert
        if (start == points[0]) != with_faces:
            points = [points[0], *points[:0:-1]]
        rings.append(points)
    one, other = rings
    count = len(one)

    def total(shift):
        return sum((one[i].co - other[(i + shift) % count].co).length for i in range(count))

    shift = min(range(count), key=total) + turn
    rails = []
    for i in range(count):
        edge = shape.edges.get((one[i], one[(i + 1) % count]))
        beside = edge.link_faces[0]
        face = shape.faces.new((one[(i + 1) % count], one[i], other[(i + shift) % count], other[(i + shift + 1) % count]))
        face.material_index, face.smooth = beside.material_index, beside.smooth
    for i in range(count):
        rails.append(shape.edges.get((one[i], other[(i + shift) % count])))
    return rails


def section(points):
    """
    How large a ring of points across a band is, in the plane it lies nearest: its narrowest
    width, taken square to an edge of its outline, and its width the other way.
    """
    at = numpy.array([tuple(p) for p in points])
    centred = at - at.mean(axis=0)
    # The plane's normal is the way the points spread least.
    axes = numpy.linalg.eigh(centred.T @ centred)[1]
    flat = centred @ axes[:, 1:]
    outline = mathutils.geometry.convex_hull_2d([tuple(p) for p in flat])
    best = None
    for i, j in zip(outline, outline[1:] + outline[:1]):
        edge = flat[j] - flat[i]
        size = numpy.linalg.norm(edge)
        if size < 1e-12:
            continue
        across = flat @ (numpy.array([-edge[1], edge[0]]) / size)
        along = flat @ (edge / size)
        narrow = float(across.max() - across.min())
        if best is None or narrow < best[1]:
            best = (float(along.max() - along.min()), narrow)
    return best or (0.0, 0.0)


def sections(rings):
    """Each ring's size across the band: its width along it and its narrowest width."""
    return [section(ring) for ring in rings]


def shaped(shape, first_loop, rails, cut, ways, rows, bow):
    """
    Cuts `rows` rows across a bridge's band, through the edges `cut`, and bows them by `bow`
    the way each loop's surface runs on. Answers the furthest a point moved and each row's
    section across the band, from the first loop to the second.
    """
    first_side = {v for e in first_loop for v in e.verts}
    shape.verts.index_update()
    ends = []
    for e in rails:
        a, b = (e.verts[0], e.verts[1]) if e.verts[0] in first_side else (e.verts[1], e.verts[0])
        ends.append((a.index, b.index, a.co.copy(), b.co.copy(), ways.get(a), ways.get(b)))
    points = [[] for _ in ends]
    furthest = 0.0
    if rows:
        first = len(shape.verts)
        bmesh.ops.subdivide_edges(shape, edges=cut, cuts=rows, use_grid_fill=False)
        points = rail_points(shape, first, ends, rows)
        if bow:
            furthest = bowed(ends, points, bow, rows)
    shape.verts.ensure_lookup_table()
    chains = [
        [shape.verts[start].co.copy(), *(v.co.copy() for v in on_rail), shape.verts[end].co.copy()]
        for (start, end, *_), on_rail in zip(ends, points)
    ]
    count = min(len(chain) for chain in chains)
    rings = [[chain[k] for chain in chains] for k in range(count)]
    return furthest, sections(rings)


def section_text(found):
    """A band's section where it leaves its loops and at its narrowest between them."""

    def across(widths):
        return f"{length(widths[0])} by {length(widths[1])}"

    start, end = found[0], found[-1]
    alike = all(abs(a - b) <= 0.02 * max(a, b, 1e-9) for a, b in zip(start, end))
    text = f"its section is {across(start)} where it leaves the loops" if alike else (
        f"its section is {across(start)} where it leaves the first loop and {across(end)} where it meets the second"
    )
    inner = found[1:-1]
    if inner:
        narrowest = min(inner, key=lambda w: w[1])
        ends = min(start[1], end[1])
        text += (
            f" and {across(narrowest)} at its narrowest"
            if narrowest[1] < ends * 0.98
            else ", and is no narrower between them"
        )
    return text


def bridge(picked, *, cuts=0, twist=0, smoothness=0):
    """
    Joins two picked edge loops with a band of faces, both closed or both open and of the same
    number of edges, with `cuts` rows of edges between them bowed out by `smoothness`, turned
    round by `twist` edges. Says how long the edges between the loops run and, for closed loops
    turned out of line, the twist that brings them back. Refuses any other pick, saying the loops
    it holds. Hands back a pick of the faces made.
    """
    obj = taken(
        picked,
        "bridge",
        ("edges", "faces"),
        lambda kind: f"bridge takes edges or faces, and the pick holds {kind_named(kind)}: pick kind='edges' for the two"
        " loops to join, or the faces whose rims it joins.",
    )
    rows = whole(cuts, "cuts", minimum=0, maximum=100, default=0)
    turn = whole(twist, "twist", minimum=-1000, maximum=1000, default=0)
    bow = number(smoothness, "smoothness", minimum=0, maximum=10, default=0)
    need(not bow or rows, "smoothness bows the rows of edges between the loops: give cuts as well.")
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        if picked.kind == "faces":
            # As Blender's own bridge does with faces: they go, and their rims are the loops.
            items = elements(shape, "faces")
            region = [items[i] for i in picked.indices]
            rims = {e for f in region for e in f.edges}
            bmesh.ops.delete(shape, geom=region, context="FACES")
            chosen = [e for e in rims if e.is_valid]
            need(chosen, "The faces picked border nothing else: removing them leaves no rims to join.")
            shape.verts.index_update()
            shape.edges.index_update()
            shape.faces.index_update()
        else:
            items = elements(shape, "edges")
            chosen = [items[i] for i in picked.indices]
        runs = edge_runs(chosen)
        need(
            not any(branches for _, _, branches in runs),
            "The picked edges branch at a point; bridging takes two plain loops of edges.",
        )
        if len(runs) != 2:
            raise Refused(
                f"Bridging takes two edge loops; the pick holds {len(runs)} loop{'s' if len(runs) != 1 else ''}"
                f" of {listed_counts([len(r) for r, _, _ in runs])} edges."
            )
        (one, one_closed, _), (other, other_closed, _) = runs
        if one_closed != other_closed:
            closed_one, open_one = (one, other) if one_closed else (other, one)
            raise Refused(
                "Bridging takes two closed loops or two open ones; the pick holds a closed loop of"
                f" {len(closed_one)} edges and an open one of {len(open_one)}."
            )
        if len(one) != len(other):
            raise Refused(
                "Bridging takes two loops of the same number of edges; the pick holds loops of"
                f" {len(one)} and {len(other)} edges."
            )
        old = len(shape.faces)
        runs = [[e.index for e in one], [e.index for e in other]]
        ways = {**onward(one), **onward(other)}
        shape.verts.index_update()
        ways_at = {v.index: way for v, way in ways.items()}
        # Loops that each border faces on one side: the band can keep the surface facing one way.
        faced = one_closed and all(len(e.link_faces) == 1 for e in one + other)
        unbridged = shape.copy() if one_closed else None
        trial = None
        try:
            out = bmesh.ops.bridge_loops(shape, edges=chosen, twist_offset=turn)
            need(out["faces"], f"Bridging the two loops of {obj.name} made no faces.")
            rails = rails_of(shape, runs, out["edges"])
            lengths = [e.calc_length() for e in rails]
            steps = turned_by(one, other, rails) if unbridged is not None and lengths else 0
            twisted = untwisted(unbridged, runs, turn, lengths, steps) if steps else None
            if faced and band_clashes(one + other, out["faces"]):
                # Blender pairs loops that face the same way, as two patches on one side do,
                # so the band turns the surface inside out; the band wound as the faces
                # beside it are is kept when it crosses fewer faces once cut and bowed.
                trial, unbridged = unbridged, None
                trial_rails = facing_band(trial, runs, turn)
            bowed_by, widths = shaped(shape, one, rails, out["edges"], ways, rows, bow)
            if trial is not None:
                trial_items = elements(trial, "edges")
                trial.verts.index_update()
                trial_ways = {v: ways_at[v.index] for v in trial.verts if v.index in ways_at}
                trial_lengths = [e.calc_length() for e in trial_rails]
                trial_bowed, trial_widths = shaped(
                    trial, [trial_items[i] for i in runs[0]], trial_rails, trial_rails, trial_ways, rows, bow
                )
                if crossing_pairs(trial) < crossing_pairs(shape):
                    shape.free()
                    shape, trial = trial, None
                    lengths, bowed_by, widths, twisted = trial_lengths, trial_bowed, trial_widths, None
        finally:
            if unbridged is not None:
                unbridged.free()
            if trial is not None:
                trial.free()
        made = faces_from(shape, old)
        shape.normal_update()
        after = tally(shape)
        chosen_after = write(obj, shape, matrix, "faces", made)
    finally:
        shape.free()
    across = f"; the edges between the loops run {distances(lengths)}" if lengths else ""
    if twisted:
        steps, better, shorter = twisted
        across += (
            f", twisted {steps} edge{'s' if steps != 1 else ''} round: twist={better} makes them {distances(shorter)}"
        )
    if one_closed and widths:
        across += f"; {section_text(widths)}"
    report(
        f"Bridged two {'closed' if one_closed else 'open'} loops of {len(one)} edges on {obj.name}"
        + (f", the rims of the {said(len(picked), 'faces')} picked, which it removed," if picked.kind == "faces" else "")
        + f" with {said(len(chosen_after), 'faces')}"
        + (f", {rows} cut{'s' if rows != 1 else ''} between" if rows else "")
        + (
            (f", bowed by {bow:g}, up to {length(bowed_by)} out of line" if bowed_by > 1e-6 else f", bowed by {bow:g}, which moved nothing: neither loop borders faces that lead off the line between them")
            if bow
            else ""
        )
        + (f", twisted by {turn}" if turn else "")
        + f": {changes(before, after)}{across}."
    )
    spend(picked, "bridge")
    return Picked(obj, "faces", chosen_after)


def sharpest_first(order, points):
    """A loop's edges starting at its sharpest corner, so a grid's sides fall along the hole's own."""
    def bend(i):
        v = points[i]
        before = points[i - 1].co - v.co
        after = points[(i + 1) % len(points)].co - v.co
        return before.angle(after, 3.2) if before.length > 1e-12 and after.length > 1e-12 else 3.2

    start = min(range(len(points)), key=bend)
    return order[start:] + order[:start]


def grid_fill(shape, run, span):
    """Fills one hole of an even number of edges with a grid of quads `span` faces across; the grid's faces across and along."""
    half = len(run) // 2
    across = max(1, len(run) // SPAN_PART) if span is None else whole(span, "span", minimum=1, maximum=half - 1)
    need(across <= half - 1, f"span must be at most {half - 1} for a hole of {len(run)} edges.")
    order = sharpest_first(*in_order(run))
    bmesh.ops.grid_fill(shape, edges=order[:across] + order[half : half + across])
    return across, half - across


def fan_fill(shape, run):
    """Fills one hole with triangles round a point at its middle."""
    made = bmesh.ops.contextual_create(shape, geom=run)["faces"]
    need(made, "The hole's edges made no face to fan.")
    bmesh.ops.poke(shape, faces=made)


def takes_grid(run):
    return len(run) % 2 == 0 and len(run) >= 4


def poles_text(faces):
    """The poles among the faces' points, where other than four edges meet inside the surface, by how many meet."""
    points = {v for f in faces if f.is_valid for v in f.verts}
    counts = {}
    for v in points:
        if all(len(e.link_faces) == 2 for e in v.link_edges) and len(v.link_edges) != 4:
            counts[len(v.link_edges)] = counts.get(len(v.link_edges), 0) + 1
    if not counts:
        return ""
    said = [
        f"{n} pole{'s' if n != 1 else ''} where {meet} edges meet"
        for meet, n in sorted(counts.items(), key=lambda pair: -pair[1])
    ]
    return "; " + " and ".join(said)


def fill(picked_or_obj, *, method=None, span=None):
    """
    Fills holes, closed loops of open or loose edges: of the whole mesh when given an object, or of
    the picked edges. "grid" fills each hole with a grid of quads `span` faces across; left out,
    a grid too, with one face where a hole's edges are too few or odd in number, saying so;
    "holes" puts a face in each; "face" makes one face of each loop; "fan" fills each with
    triangles round a point at its middle. Says the holes found and filled, the faces made, any
    n-gons among them and the poles it left. Hands back a pick of the faces made.
    """
    asked = method is not None
    method = method if asked else "grid"
    need(method in ("holes", "grid", "face", "fan"), "method must be grid, holes, face or fan.")
    if isinstance(picked_or_obj, Picked):
        obj = taken(
            picked_or_obj,
            "fill",
            ("edges",),
            lambda kind: f"fill takes edges or a whole object, and the pick holds {kind_named(kind)}:"
            " pick kind='edges' round the hole.",
        )
        picked = picked_or_obj
    else:
        obj = mesh_object(picked_or_obj, "fill")
        picked = None
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        items = elements(shape, "edges")
        edges = [items[i] for i in picked.indices] if picked else list(shape.edges)
        open_edges = [e for e in edges if len(e.link_faces) < 2]
        if not open_edges:
            raise Refused(
                f"{obj.name} has no hole to fill: every edge has two faces."
                if picked is None
                else "None of the picked edges is open: every one has two faces."
            )
        holes = [run for run, closed, _ in edge_runs(open_edges) if closed]
        need(
            holes,
            f"The open edges {'picked' if picked else 'of ' + obj.name} make no closed loop:"
            " a hole is a loop of edges with a face on one side or none.",
        )
        faces_on = {e: len(e.link_faces) for run in holes for e in run}
        old = len(shape.faces)
        grids, single = [], []
        if method == "holes":
            bmesh.ops.holes_fill(shape, edges=[e for run in holes for e in run], sides=0)
        elif method == "face":
            for run in holes:
                bmesh.ops.contextual_create(shape, geom=run)
        elif method == "fan":
            for run in holes:
                fan_fill(shape, run)
        else:
            odd = [len(run) for run in holes if not takes_grid(run)]
            if asked and odd:
                raise Refused(
                    f"A grid fill takes holes of an even number of edges, four or more;"
                    f" {'this one has' if len(holes) == 1 else 'holes here have'} {listed_counts(odd)}."
                    " Fill with method='face' or 'fan', or leave method out to fill those with one face."
                )
            for run in holes:
                if takes_grid(run):
                    grids.append(grid_fill(shape, run, span))
                else:
                    single.append(len(run))
                    bmesh.ops.contextual_create(shape, geom=run)
        made = faces_from(shape, old)
        need(made, f"The {method} fill of {obj.name} made no faces.")
        filled = sum(1 for run in holes if all(len(e.link_faces) > faces_on[e] for e in run))
        ngons = [len(f.verts) for f in made if len(f.verts) > 4]
        shape.normal_update()
        poles = poles_text(made)
        after = tally(shape)
        chosen_after = write(obj, shape, matrix, "faces", made)
    finally:
        shape.free()
    found = len(holes)
    holes_text = f"{found} hole{'s' if found != 1 else ''}" if filled == found else f"{filled} of {found} holes"
    faces_text = said(len(chosen_after), "faces")
    if method == "fan":
        faces_text = f"{'a fan' if found == 1 else 'fans'} of {len(chosen_after)} triangles round {'a point at its middle' if found == 1 else 'a point at each middle'}"
    elif len(grids) == 1 and not single and grids[0] != (1, 1):
        faces_text = f"a {grids[0][0]} × {grids[0][1]} grid of {faces_text}"
    elif len(grids) > 1:
        faces_text += f", in grids of {listed_counts(f'{a} × {b}' for a, b in grids)}"
    if single and found == 1:
        faces_text += f", as a grid takes an even number of edges, four or more, and it has {single[0]}"
    elif single:
        faces_text += (
            f", one face in {'the hole' if len(single) == 1 else 'each hole'} of {listed_counts(single)} edges,"
            " as a grid takes an even number, four or more"
        )
    ngon_text = ""
    if ngons:
        sides = f"{max(ngons)} sides" if len(ngons) == 1 else f"up to {max(ngons)} sides"
        ngon_text = f"; made {len(ngons)} n-gon{'s' if len(ngons) != 1 else ''} of {sides}"
    report(f"Filled {holes_text} of {obj.name} with {faces_text}: {changes(before, after)}{ngon_text}{poles}.")
    spend(picked, "fill")
    return Picked(obj, "faces", chosen_after)


def ring_of(edge):
    """
    The ring an edge belongs to, through four-sided faces: each edge with the point on the ring's
    first side, so every cut runs the same way. The first side is where the edge points least
    towards +x, +y or +z, whichever it points along most.
    """
    a, b = edge.verts
    along = b.co - a.co
    main = max(range(3), key=lambda i: abs(along[i]))
    start = a if along[main] >= 0 else b
    ring = [(edge, start)]
    seen = {edge}
    for face in list(edge.link_faces)[:2]:
        e, s, f = edge, start, face
        while len(f.verts) == 4:
            loop = next(l for l in f.loops if l.edge == e)
            opposite = loop.link_loop_next.link_loop_next
            o = opposite.edge
            if o in seen:
                break
            o_start = opposite.link_loop_next.vert if loop.vert == s else opposite.vert
            seen.add(o)
            ring.append((o, o_start))
            others = [g for g in o.link_faces if g != f]
            if len(others) != 1:
                break
            e, s, f = o, o_start, others[0]
    return ring


def loop_cut(picked, *, cuts=1, slide=0):
    """
    Cuts `cuts` loops across the ring of each picked edge, through its four-sided faces, evenly
    spaced; `slide` (between -1 and 1) moves them along the ring by that share of the gap between
    two cuts, towards the end its line names. Says the loops added and where they lie, and hands
    back a pick of their edges.
    """
    obj = taken(
        picked,
        "loop_cut",
        ("edges",),
        lambda kind: f"loop_cut takes edges, and the pick holds {kind_named(kind)}:"
        " pick kind='edges' for an edge the loop crosses.",
    )
    rows = whole(cuts, "cuts", minimum=1, maximum=100, default=1)
    shift = number(slide, "slide", default=0)
    need(-1 < shift < 1, "slide must be between -1 and 1, not at either end.")
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        items = elements(shape, "edges")
        chosen = [items[i] for i in picked.indices]
        need(
            any(len(f.verts) == 4 for e in chosen for f in e.link_faces),
            "No picked edge has a four-sided face beside it to cut across.",
        )
        rings, taken_edges = [], set()
        for edge in chosen:
            if edge not in taken_edges:
                ring = ring_of(edge)
                taken_edges.update(e for e, _ in ring)
                rings.append(ring)
        sign = 1 if shift >= 0 else -1
        headings = {heading((ring[0][0].other_vert(ring[0][1]).co - ring[0][1].co) * sign) for ring in rings}
        shape.verts.index_update()
        # Subdividing leaves the bmesh's own elements in their order but ends their Python
        # references, so each ring edge's ends are kept by index and place.
        ends = [(s.index, s.co.copy(), e.other_vert(s).co.copy()) for ring in rings for e, s in ring]
        out = bmesh.ops.subdivide_edges(
            shape, edges=[e for ring in rings for e, _ in ring], cuts=rows, use_grid_fill=False
        )
        fresh = {g for g in out["geom_split"] if isinstance(g, bmesh.types.BMVert)}
        made = [g for g in out["geom_inner"] if isinstance(g, bmesh.types.BMEdge)]
        shape.verts.ensure_lookup_table()
        for start, s_at, end_at in ends:
            line = end_at - s_at
            at = shape.verts[start]
            seen = {at}
            for k in range(1, rows + 1):
                at = next(
                    (
                        n
                        for n in (e.other_vert(at) for e in at.link_edges)
                        if n in fresh and n not in seen and (n.co - s_at).cross(line).length <= 1e-7 * line.length**2
                    ),
                    None,
                )
                if at is None:
                    break
                seen.add(at)
                at.co = s_at + line * ((k + shift) / (rows + 1))
        corners = [v.co.copy() for v in fresh]
        shape.normal_update()
        after = tally(shape)
        chosen_after = write(obj, shape, matrix, "edges", made)
    finally:
        shape.free()
    loops = rows * len(rings)
    slid = ""
    if shift:
        towards = next(iter(headings)) if len(headings) == 1 else "a different end in each ring"
        slid = f", slid {abs(shift) * 100:g}% of a gap towards {towards}"
    report(
        f"Cut {loops} loop{'s' if loops != 1 else ''} across {len(ends)} edges of {obj.name}{slid}:"
        f" {changes(before, after)}; the new loop{'s lie' if loops != 1 else ' lies'} at {spread(corners)}."
    )
    spend(picked, "loop_cut")
    return Picked(obj, "edges", chosen_after)


def merge(picked_or_obj, *, distance=0.0001, to="distance"):
    """
    Merges points: those closer than `distance` metres (to="distance"), or all the picked ones
    into one at their centre (to="center") or at a point in the world ([x, y, z]); of the whole
    mesh when given an object. Says how many points went, or that none were that close and how
    far apart the closest two are. Returns how many points it removed.
    """
    if isinstance(picked_or_obj, Picked):
        obj = taken(picked_or_obj, "merge", ("faces", "edges", "verts"), lambda kind: "")
        picked = picked_or_obj
    else:
        obj = mesh_object(picked_or_obj, "merge")
        picked = None
    if isinstance(to, str):
        need(to in ("distance", "center"), "to must be distance, center, or a point [x, y, z].")
        target = None
    else:
        target = vector(to, "to")
    near = number(distance, "distance", minimum=0, default=0.0001)
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        if picked:
            items = elements(shape, picked.kind)
            chosen = list(
                dict.fromkeys(
                    v for i in picked.indices for v in ([items[i]] if picked.kind == "verts" else items[i].verts)
                )
            )
        else:
            chosen = list(shape.verts)
        whose = f"the picked points of {obj.name}" if picked else f"points of {obj.name}"
        if to == "distance":
            bmesh.ops.remove_doubles(shape, verts=chosen, dist=near)
            removed = before["verts"] - len(shape.verts)
            if not removed:
                report(f"Merged no {whose}: none are closer than {length(near)}; {closest(chosen)}.")
                return 0
            line = f"Merged {whose} closer than {length(near)}: {removed} removed"
        else:
            need(len(chosen) > 1, "Merging into one takes two points or more; the pick holds one.")
            if target is None:
                target = sum((v.co for v in chosen), mathutils.Vector()) / len(chosen)
            bmesh.ops.pointmerge(shape, verts=chosen, merge_co=target)
            removed = before["verts"] - len(shape.verts)
            line = f"Merged {said(len(chosen), 'verts')} of {obj.name} into one at {point_text(target)}"
        shape.normal_update()
        after = tally(shape)
        write(obj, shape, matrix, "verts", [])
    finally:
        shape.free()
    report(f"{line}: {changes(before, after)}." if to != "distance" else f"{line}; {changes(before, after)}.")
    spend(picked, "merge")
    return removed


def closest(verts):
    """How far apart the two closest of some points are."""
    if len(verts) < 2:
        return "there is only one point"
    tree = KDTree(len(verts))
    for i, v in enumerate(verts):
        tree.insert(v.co, i)
    tree.balance()
    gap = min(tree.find_n(v.co, 2)[1][2] for v in verts)
    return f"the closest two are {length(gap)} apart"


def symmetrize(obj, *, axis="x", direction="+"):
    """
    Makes a mesh the same on both sides of its own x, y or z = 0: the half on the `direction`
    side is copied, mirrored, onto the other, replacing it, and the seam's points are joined. Says
    the counts before and after and whether the seam was left open.
    """
    obj = mesh_object(obj, "symmetrize")
    need(axis in AXES, "axis must be x, y or z.")
    need(direction in ("+", "-"), "direction must be + or -: the side copied onto the other.")
    i = AXES[axis]
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        places = [v.co[i] for v in shape.verts]
        need(places, f"{obj.name} has no points to copy.")
        if not any((p > 1e-6) if direction == "+" else (p < -1e-6) for p in places):
            raise Refused(
                f"{obj.name} has nothing on the {direction}{axis} side of its own {axis} = 0 to copy:"
                f" its points lie at {axis} {length(min(places))} to {length(max(places))}."
            )
        before = tally(shape)
        bmesh.ops.symmetrize(
            shape,
            input=list(shape.verts) + list(shape.edges) + list(shape.faces),
            direction=axis.upper() if direction == "+" else "-" + axis.upper(),
            dist=0.0001,
        )
        shape.normal_update()
        after = tally(shape)
        seam = sum(1 for e in shape.edges if len(e.link_faces) == 1 and all(abs(v.co[i]) < 1e-5 for v in e.verts))
        shape.to_mesh(obj.data)
        obj.data.update()
    finally:
        shape.free()
    other = "-" if direction == "+" else "+"
    report(
        f"Symmetrized {obj.name} across its own {axis} = 0, copying its {direction}{axis} half onto {other}{axis}:"
        f" {changes(before, after)}; the seam has {'no open edges' if not seam else said(seam, 'edges') + ' open'}."
    )
    return obj


def fix_normals(obj):
    """
    Turns a mesh's faces the way they should face: out of each closed piece (a hollow's inner
    walls into its hollow), and with the rest of each open piece. Says how many it turned and the
    largest of them, or that every face already faced its way, and hands back a pick of the faces
    it turned.
    """
    obj = mesh_object(obj, "fix_normals")
    need(obj.data.polygons, f"{obj.name} has no faces to turn.")
    shape, matrix = world_shape(obj)
    try:
        pieces = islands(shape)
        inward, against, _ = turned_round(shape, pieces)
        turned = inward + against
        closed = sum(1 for _, sealed in pieces if sealed)
        if turned:
            largest = max(turned, key=lambda f: f.calc_area())
            where = point_text(largest.calc_center_median())
            bmesh.ops.reverse_faces(shape, faces=turned)
            shape.normal_update()
        left_in, left_against, _ = turned_round(shape, islands(shape))
        chosen = write(obj, shape, matrix, "faces", turned)
    finally:
        shape.free()
    pieces_text = f"{len(pieces)} piece{'s' if len(pieces) != 1 else ''}, {closed} closed"
    if not turned:
        report(
            f"Turned no faces of {obj.name}: each of its {len(obj.data.polygons)} faces already faces out of its"
            f" closed piece or with the rest of its open one ({pieces_text})."
        )
        return Picked(obj, "faces", [])
    ways = []
    if inward:
        ways.append(f"{said(len(inward), 'faces')} that pointed into {'its' if closed == 1 else 'their'} closed piece")
    if against:
        ways.append(f"{said(len(against), 'faces')} that faced against the rest of {'its' if len(against) == 1 else 'their'} open piece")
    left = len(left_in) + len(left_against)
    report(
        f"Turned {said(len(turned), 'faces')} of {obj.name} ({pieces_text}): {' and '.join(ways)}, the largest at {where};"
        + (" now every face faces its way." if not left else f" {said(left, 'faces')} still {'faces' if left == 1 else 'face'} the wrong way.")
    )
    return Picked(obj, "faces", chosen)


FUNCTIONS = (extrude, inset, bevel, bridge, fill, loop_cut, merge, symmetrize, fix_normals)
