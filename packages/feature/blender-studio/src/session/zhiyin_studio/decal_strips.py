"""
Strips run along a line on a surface: its edges sharper than an angle, its seams, the boundary of
a CAD part's group of surfaces, a curve laid onto it, or where a level plane cuts it. The line is
split into runs where three or more of its pieces meet, and each run carries a pattern, evened out
to fit it whole: stitches, dashes, chevrons, a picture or a shape repeated, a plain band or a
groove. Each piece lies on the surface, folded over an edge onto the faces either side, and stands
off it by the offset, or stands up by its height when raised. A groove's continuity is measured:
its closed loops, its open ends and whether each reaches an edge, and how far a drawn curve strays
from the surface and where its laid line jumps.
"""

import bisect
import math

import bmesh
import bpy
import mathutils

from .arguments import need, number
from .decal_materials import LAYOUT
from .errors import Refused
from .finding import find_object
from .mesh_math import to_segment
from .model_shapes import slots_of_surface
from .wording import length, point_text

LINES = ("sharp_angle", "surface_group", "seams", "curve", "height")
# Each pattern's repeat by default, in widths of the strip, and the share of a repeat its piece takes.
PITCHES = {"stitch": 4, "dash": 3, "chevron": 1}
FILLED = {"stitch": 0.7, "dash": 0.6, "chevron": 0.35}
# How far a stitch leans, in degrees from across the strip.
LEAN = 20
PLURALS = {"stitch": "stitches", "dash": "dashes", "chevron": "chevrons"}
# The patterns laid as one band along each run: a plain band, a picture or a library shape repeated, a groove.
BANDS = ("solid", "picture", "groove", "shape")
# Points of a line nearer than this, in metres, are one.
SAME = 1e-6
# A drawn curve is laid on the surface at this many points along each of its pieces.
CURVE_SAMPLES = 16
# Laid on the surface, a stretch of curve that runs this many times its drawn length jumps a gap.
JUMP = 2
# Edges sharper than this, in degrees, are where a groove may end, as at the surface's border.
END_EDGE = 30


class Run:
    """
    One stretch of the line, from end to end or round a loop: its points, and for each piece
    between two, the ways across the surface on either side of it.
    """

    def __init__(self, points, sides, closed, ends):
        self.points, self.sides, self.closed, self.ends = points, sides, closed, ends
        # A drawn curve's run: how far the curve strays off the surface at most and where, and where its laid line jumps.
        self.stray, self.jumps = None, []
        self.marks = [0.0]
        for a, b in zip(points, points[1:]):
            self.marks.append(self.marks[-1] + (b - a).length)
        self.length = self.marks[-1]

    def at(self, s):
        """The point at `s` along the run, and the ways across on its two sides there."""
        if self.closed:
            s %= self.length
        s = min(max(s, 0.0), self.length)
        k = min(max(bisect.bisect_right(self.marks, s) - 1, 0), len(self.points) - 2)
        span = self.marks[k + 1] - self.marks[k]
        share = (s - self.marks[k]) / span if span > 0 else 0.0
        return self.points[k].lerp(self.points[k + 1], share), self.sides[k]


def into_face(face, a, b):
    """The way across a face from its edge a–b, into the face."""
    way = face.normal.cross(b - a).normalized()
    if (face.calc_center_median() - (a + b) / 2).dot(way) < 0:
        way = -way
    return way


def edge_sides(edge, a, b):
    """The ways across the surface from an edge, to its left and to its right as it runs from a to b."""
    faces = list(edge.link_faces)
    if not faces:
        return None
    normal = sum((f.normal for f in faces), mathutils.Vector()).normalized()
    left = normal.cross(b - a).normalized()
    ways = sorted((into_face(f, a, b) for f in faces), key=lambda w: -w.dot(left))
    plus = ways[0]
    minus = ways[-1] if len(ways) > 1 else -plus
    if len(ways) == 1 and plus.dot(left) < 0:
        plus, minus = -minus, -plus
    return plus, minus


def chained(edges):
    """The edges' runs: from each end or meeting of three or more, then each closed loop left."""
    touching = {}
    for e in edges:
        for v in e.verts:
            touching.setdefault(v, []).append(e)
    meetings = {v for v, es in touching.items() if len(es) >= 3}
    used, runs = set(), []

    def walk(start, first):
        verts, path = [start], []
        edge, vert = first, start
        while True:
            used.add(edge)
            path.append(edge)
            vert = edge.other_vert(vert)
            verts.append(vert)
            onward = [e for e in touching[vert] if e not in used]
            if vert is start or len(touching[vert]) != 2 or not onward:
                return verts, path
            edge = onward[0]

    for v, es in touching.items():
        if len(es) != 2:
            for e in es:
                if e not in used:
                    runs.append(walk(v, e))
    for e in edges:
        if e not in used:
            runs.append(walk(e.verts[0], e))
    return runs, meetings


def runs_of(chains, meetings):
    """Each chain of edges as a run, with the meetings its two ends are at."""
    made = []
    for verts, path in chains:
        points = [v.co.copy() for v in verts]
        sides = []
        for (a, b), edge in zip(zip(points, points[1:]), path):
            found = edge_sides(edge, a, b)
            sides.append(found if found is not None else (mathutils.Vector(), mathutils.Vector()))
        closed = verts[0] is verts[-1]
        # A meeting is kept by where it is: the mesh the line was found in may be gone by the time it is measured.
        ends = tuple(tuple(round(c, 7) for c in v.co) if v in meetings else None for v in (verts[0], verts[-1]))
        made.append(Run(points, sides, closed, ends))
    return made


def the_line(surface, along):
    """The line a strip runs along, as runs, the meetings of its runs, and the words for it."""
    need(isinstance(along, dict), "along names the line the strip runs along.")
    given = [key for key in LINES if along.get(key) is not None and along.get(key) is not False]
    need(len(given) == 1, "along takes exactly one of sharp_angle, surface_group, seams, curve and height.")
    key = given[0]
    obj, bm = surface.obj, surface.bm
    if key == "curve":
        return curve_runs(surface, along["curve"])
    if key == "height":
        return height_runs(surface, number(along["height"], "along.height"))
    if key == "sharp_angle":
        angle = number(along["sharp_angle"], "along.sharp_angle", minimum=0, maximum=180)
        folds = {e: math.degrees(e.calc_face_angle(0.0)) for e in bm.edges if len(e.link_faces) == 2}
        edges = [e for e, fold in folds.items() if fold > angle]
        if not edges:
            raise Refused(f"No edge of {obj.name} is sharper than {angle:g}°: its sharpest is {max(folds.values(), default=0):.3g}°.")
        words = f"along its edges sharper than {angle:g}°"
    elif key == "seams":
        need(along["seams"] is True, "along.seams is true to run along the object's seams.")
        edges = [e for e in bm.edges if e.seam]
        if not edges:
            raise Refused(f"{obj.name} has no seams: give it some with blender_unwrap, or run the strip along another line.")
        words = "along its seams"
    else:
        group = along["surface_group"]
        need(isinstance(group, str) and group.strip(), "along.surface_group names a group of a CAD part's surfaces.")
        slots = set(slots_of_surface(obj, group.strip()))
        edges = [e for e in bm.edges if sum(1 for f in e.link_faces if f.material_index in slots) == 1]
        if not edges:
            raise Refused(f"{obj.name}'s “{group.strip()}” surfaces have no boundary: they cover the whole object.")
        words = f"round its “{group.strip()}” surfaces"
    chains, meetings = chained(edges)
    return runs_of(chains, meetings), len(meetings), words


def height_runs(surface, height):
    """Where a level plane at `height` cuts the surface."""
    bm = surface.bm.copy()
    obj = surface.obj
    try:
        everything = list(bm.verts) + list(bm.edges) + list(bm.faces)
        cut = bmesh.ops.bisect_plane(bm, geom=everything, plane_co=(0, 0, height), plane_no=(0, 0, 1))["geom_cut"]
        edges = [
            e for e in cut if isinstance(e, bmesh.types.BMEdge) and all(abs(v.co.z - height) < SAME for v in e.verts)
        ]
        edges += [
            e for e in bm.edges if e not in edges and e.link_faces and all(abs(v.co.z - height) < SAME for v in e.verts)
        ]
        # An edge lying in the plane between two faces that both lie on one side of it bounds nothing there.
        edges = [e for e in edges if len(e.link_faces) != 2 or not all(level_on_one_side(f, height) for f in e.link_faces)]
        if not edges:
            raise Refused(
                f"At a height of {length(height)}, the plane meets no face of {obj.name}, which spans z from "
                f"{length(surface.low.z)} to {length(surface.high.z)}."
            )
        chains, meetings = chained(edges)
        return runs_of(chains, meetings), len(meetings), f"round it at a height of {length(height)}"
    finally:
        bm.free()


def level_on_one_side(face, height):
    return all(abs(v.co.z - height) < SAME for v in face.verts)


def curve_runs(surface, name):
    """A curve object's line, each point laid onto the nearest point of the surface."""
    curve = find_object(name, {"CURVE"})
    evaluated = curve.evaluated_get(bpy.context.evaluated_depsgraph_get())
    bm = bmesh.new()
    try:
        bm.from_mesh(evaluated.to_mesh())
        evaluated.to_mesh_clear()
        bmesh.ops.transform(bm, matrix=curve.matrix_world, verts=list(bm.verts))
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=SAME)
        need(bm.edges, f"“{name}” draws no line.")
        chains, meetings = chained(list(bm.edges))
        made = []
        for verts, _ in chains:
            points = [surface.nearest(v.co)[0] for v in verts]
            sides = []
            for a, b in zip(points, points[1:]):
                normal = surface.nearest((a + b) / 2)[1]
                left = normal.cross(b - a)
                left = left.normalized() if left.length > 0 else left
                sides.append((left, -left))
            run = Run(points, sides, verts[0] is verts[-1], (None, None))
            run.stray, run.jumps = laid_off(surface, [v.co.copy() for v in verts])
            made.append(run)
        return made, len(meetings), f"along the curve “{name}”"
    finally:
        bm.free()


def laid_off(surface, drawn):
    """
    How far a drawn line strays from the surface at most and where, and each stretch of it whose
    laid line runs much longer than it is drawn, where it jumps a gap or wraps round an edge.
    """
    stray, jumps = (0.0, drawn[0]), []
    for a, b in zip(drawn, drawn[1:]):
        before = None
        for k in range(CURVE_SAMPLES + 1):
            point = a.lerp(b, k / CURVE_SAMPLES)
            laid = surface.nearest(point)[0]
            off = (laid - point).length
            if off > stray[0]:
                stray = (off, laid)
            if before is not None:
                drawn_step = (b - a).length / CURVE_SAMPLES
                if (laid - before).length > JUMP * drawn_step + SAME:
                    jumps.append((before, laid))
            before = laid
    return stray, jumps


def end_edges(surface):
    """The surface's border and sharp edges, as pairs of points: where a groove may end."""
    found = []
    for edge in surface.bm.edges:
        faces = edge.link_faces
        if len(faces) != 2 or math.degrees(edge.calc_face_angle(0.0)) > END_EDGE:
            found.append((edge.verts[0].co, edge.verts[1].co))
    return found


def open_ends(runs):
    """The ends of runs that meet no other run: the open ends of the line."""
    ends = []
    for run in runs:
        if run.closed:
            continue
        for point, meeting in ((run.points[0], run.ends[0]), (run.points[-1], run.ends[1])):
            if meeting is None:
                ends.append(point)
    return ends


def continuity_text(surface, runs, width):
    """Whether a groove runs unbroken: its closed loops, where its open ends stop, how far a curve strays and where it jumps."""
    name = surface.obj.name
    loops = sum(1 for r in runs if r.closed)
    ends = open_ends(runs)
    said = []
    if loops and not ends:
        said.append(f"It runs unbroken round {'a closed loop' if loops == 1 else f'{loops} closed loops'}")
    if ends:
        edges = end_edges(surface)
        stopped = [p for p in ends if not any(to_segment(p, a, b) <= width for a, b in edges)]
        reach = len(ends) - len(stopped)
        part = f"{len(ends)} open end{'s' if len(ends) != 1 else ''}"
        if not stopped:
            said.append(f"Its {part} each reach an edge of {name}")
        else:
            where = ", ".join(point_text(p) for p in stopped[:4])
            said.append(
                f"Of its {part}, {reach} reach an edge of {name} and {len(stopped)} stop on its faces, at {where}: "
                "a panel line that stops short of an edge reads as a scratch"
            )
    strays = [r.stray for r in runs if r.stray is not None]
    if strays:
        off, at = max(strays, key=lambda s: s[0])
        if off <= max(width / 2, SAME * 10):
            said.append(f"the curve lies within {length(off)} of the surface all along")
        else:
            said.append(
                f"the curve stands up to {length(off)} off the surface near {point_text(at)}, where the groove follows "
                "the surface's nearest point rather than the curve"
            )
    jumps = [j for r in runs for j in r.jumps]
    if jumps:
        listed = "; ".join(f"{point_text(a)} to {point_text(b)}" for a, b in jumps[:3])
        said.append(
            f"it breaks in {len(jumps)} place{'s' if len(jumps) != 1 else ''}, where the curve laid on the surface jumps "
            f"a gap or an edge: {listed}"
        )
    if not said:
        said.append("every run meets another at both its ends, so it has no open end")
    text = "; ".join(said) + "."
    return "Continuity: " + text[0].lower() + text[1:]


def piece_shapes(pattern, run, width, count):
    """
    Each piece of a run's pattern as a function from (along, across) in 0..1 to (s, t) on the run,
    with how many steps it takes each way, and where it starts and ends along the run's middle.
    """
    pitch = run.length / count
    if pattern in BANDS:
        return [(lambda a, b: (a * run.length, (b - 0.5) * width), 0.0, run.length)]
    fill = FILLED[pattern] * pitch
    shapes = []
    for i in range(count):
        middle = (i + 0.5) * pitch
        if pattern == "dash":
            start = middle - fill / 2
            shapes.append((lambda a, b, s0=start: (s0 + a * fill, (b - 0.5) * width), start, start + fill))
        elif pattern == "stitch":
            start, lean = middle - fill / 2, math.tan(math.radians(LEAN))
            shapes.append(
                (lambda a, b, s0=start: (s0 + a * fill + (b - 0.5) * width * lean, (b - 0.5) * width), start, start + fill)
            )
        else:
            start = middle + width / 4 - fill / 2
            shapes.append(
                (lambda a, b, s0=start: (s0 + a * fill - abs(b - 0.5) * width, (b - 0.5) * width), start, start + fill)
            )
    return shapes


def laid_point(surface, run, s, t):
    """A point of the strip on the surface: across from the run at `s` by `t`, on the face that side."""
    point, (plus, minus) = run.at(s)
    base = point + (plus if t >= 0 else minus) * abs(t)
    found = surface.nearest(base)
    return found[0] if found is not None else base


def strip_mesh(surface, runs, pattern, width, pitch):
    """The strip's pieces as one mesh in world space, its layout running along it; how many there are and how each run's pattern fits."""
    bm = bmesh.new()
    layout = bm.loops.layers.uv.new(LAYOUT)
    step = width / 2
    pieces, fits = 0, []
    for run in runs:
        count = 1 if pattern == "solid" else max(1, round(run.length / pitch))
        shapes = piece_shapes(pattern, run, width, count)
        fits.append((run, count, run.length / count, shapes[0][1], run.length - shapes[-1][2]))
        for shape, start, end in shapes:
            along_steps = max(1, math.ceil((end - start) / step))
            if pattern in BANDS:
                # A band bends at each corner of its run, so it has a row there.
                marks = []
                for mark in sorted([run.length * i / along_steps for i in range(along_steps + 1)] + run.marks):
                    if not marks or mark - marks[-1] > SAME:
                        marks.append(mark)
            else:
                marks = [start + (end - start) * i / along_steps for i in range(along_steps + 1)]
            span = (end - start) or 1.0
            across = 4
            grid = []
            for mark in marks:
                share = (mark - start) / span
                row = []
                for j in range(across + 1):
                    s, t = shape(share, j / across)
                    row.append((bm.verts.new(laid_point(surface, run, s, t)), s, j / across))
                grid.append(row)
            for r in range(len(grid) - 1):
                for j in range(across):
                    corners = (grid[r][j], grid[r + 1][j], grid[r + 1][j + 1], grid[r][j + 1])
                    try:
                        face = bm.faces.new([c[0] for c in corners])
                    except ValueError:
                        continue
                    for loop, (_, s, b) in zip(face.loops, corners):
                        loop[layout].uv = (s / (run.length / count), b)
            pieces += 1
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=SAME * 10)
    bmesh.ops.dissolve_degenerate(bm, dist=SAME * 10, edges=list(bm.edges))
    bm.normal_update()
    turned = []
    for face in bm.faces:
        found = surface.nearest(face.calc_center_median())
        if found is not None and face.normal.dot(found[1]) < 0:
            turned.append(face)
    bmesh.ops.reverse_faces(bm, faces=turned)
    bm.normal_update()
    return bm, pieces, fits


def corner_gaps(fits):
    """The widest gap between pieces across a meeting of runs, each run's end gap summed with another's."""
    at = {}
    for run, _, _, first, last in fits:
        for vert, gap in zip(run.ends, (first, last)):
            if vert is not None:
                at.setdefault(vert, []).append(gap)
    widest = 0.0
    for gaps in at.values():
        if len(gaps) >= 2:
            gaps = sorted(gaps, reverse=True)
            widest = max(widest, gaps[0] + gaps[1])
    return widest
