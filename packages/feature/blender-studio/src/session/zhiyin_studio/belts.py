"""
A belt or a chain that runs round its pulleys or sprockets, as the real one
does: its mesh is laid out straight along the path round them and bent back
onto that path by a curve, so moving it along the curve carries every link,
tooth and rib round the loop. Its run is keyed at a speed, or follows a
pulley's turn, as a belt driven by that pulley does.
"""

import math

import bmesh
import bpy
import mathutils
import numpy
from bpy_extras import anim_utils

from .arguments import is_number, need, number, vector
from .errors import Refused
from .finding import find_object
from .follow import AXES, follow_one
from .keys import curves_of
from .timeline import LONGEST, START, frame_of, moment

# Degrees between the points of the path round each pulley.
ARC_STEP = 2.0
# How far, in metres, the belt laid onto its path may stray from where it was.
LAID_OFF = 1e-4
# Vertices projected onto the path at once, to keep the arrays small.
BATCH = 2000
# What marks a belt as laid onto its path, with the length of that path.
LAID = "zhiyin_belt_length"


def _frame(centres, axis):
    """Axes of the pulleys' plane: x from the first centre to the second, z along their axis, origin at the first."""
    z = axis.normalized()
    across = centres[1] - centres[0]
    x = across - z * across.dot(z)
    need(x.length > 1e-9, "Two pulleys share a centre.")
    x.normalize()
    y = z.cross(x)
    frame = mathutils.Matrix.Identity(4)
    for row in range(3):
        frame[row][0], frame[row][1], frame[row][2], frame[row][3] = x[row], y[row], z[row], centres[0][row]
    return frame


def loop(centres, radii):
    """
    The closed path round pulleys in their plane, anticlockwise, as points
    on it, from where it meets the first pulley; with whether the pulleys
    were given the other way round. A negative radius is an idler the path
    passes outside, on the belt's back.
    """
    count = len(centres)
    area = sum(centres[i][0] * centres[(i + 1) % count][1] - centres[(i + 1) % count][0] * centres[i][1] for i in range(count))
    order = list(range(count)) if area >= 0 else list(reversed(range(count)))
    pts = [centres[i] for i in order]
    signed = [radii[i] for i in order]
    leave, arrive = [None] * count, [None] * count
    for k in range(count):
        (x1, y1), (x2, y2) = pts[k], pts[(k + 1) % count]
        r1, r2 = signed[k], signed[(k + 1) % count]
        dx, dy = x2 - x1, y2 - y1
        span = math.hypot(dx, dy)
        need(span > 1e-9, "Two pulleys share a centre.")
        cos = (r1 - r2) / span
        need(abs(cos) <= 1, "Two pulleys lie so close that the belt cannot run between them.")
        ex, ey = dx / span, dy / span
        for sine in (math.sqrt(1 - cos * cos), -math.sqrt(1 - cos * cos)):
            nx, ny = cos * ex - sine * ey, cos * ey + sine * ex
            p1, p2 = (x1 + r1 * nx, y1 + r1 * ny), (x2 + r2 * nx, y2 + r2 * ny)
            if -ny * (p2[0] - p1[0]) + nx * (p2[1] - p1[1]) > 0:
                leave[k], arrive[(k + 1) % count] = p1, p2
    points = []
    for k in range(count):
        cx, cy = pts[k]
        r = signed[k]
        a0 = math.atan2(arrive[k][1] - cy, arrive[k][0] - cx)
        a1 = math.atan2(leave[k][1] - cy, leave[k][0] - cx)
        sweep = (a1 - a0) % (2 * math.pi) if r > 0 else -((a0 - a1) % (2 * math.pi))
        steps = max(1, math.ceil(math.degrees(abs(sweep)) / ARC_STEP))
        for i in range(steps):
            angle = a0 + sweep * i / steps
            points.append((cx + abs(r) * math.cos(angle), cy + abs(r) * math.sin(angle)))
        points.append(leave[k])
    return points, area < 0


def _unrolled(flat, points):
    """
    Each point of the plane as its distance along the closed path, from its
    start, and its distance from the path, to the path's left: what a curve
    bends back into place.
    """
    a = numpy.array(points)
    b = numpy.roll(a, -1, axis=0)
    seg = b - a
    lengths = numpy.hypot(seg[:, 0], seg[:, 1])
    starts = numpy.concatenate([[0.0], numpy.cumsum(lengths)[:-1]])
    along, off = numpy.empty(len(flat)), numpy.empty(len(flat))
    for begin in range(0, len(flat), BATCH):
        p = flat[begin : begin + BATCH, None, :]
        share = numpy.clip(((p - a) * seg).sum(axis=2) / numpy.maximum(lengths, 1e-12) ** 2, 0.0, 1.0)
        nearest = a + share[:, :, None] * seg
        gap = numpy.hypot(*(p - nearest).transpose(2, 0, 1))
        best = gap.argmin(axis=1)
        rows = numpy.arange(len(best))
        along[begin : begin + BATCH] = starts[best] + share[rows, best] * lengths[best]
        towards = (p[:, 0, :] - nearest[rows, best]) / numpy.maximum(lengths[best], 1e-12)[:, None]
        # The side of the path it lies on: to its left is positive.
        side = numpy.sign(seg[best, 0] * towards[:, 1] - seg[best, 1] * towards[:, 0])
        off[begin : begin + BATCH] = side * gap[rows, best]
    return along, off, float(lengths.sum())


def _world_mesh(obj):
    """The object's mesh as it looks now, in the world, as a bmesh of its own data."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bmesh.new()
    mesh.from_object(obj, depsgraph)
    mesh.transform(obj.matrix_world)
    return mesh


def _seam_cut(mesh, length):
    """Faces across the path's start, whose corners on its near side are given copies a whole length on, so none spans the loop."""
    copies = {}
    for face in [f for f in mesh.faces if max(v.co.x for v in f.verts) - min(v.co.x for v in f.verts) > length / 2]:
        corners = []
        for vert in face.verts:
            if vert.co.x < length / 2:
                if vert not in copies:
                    copies[vert] = mesh.verts.new((vert.co.x + length, vert.co.y, vert.co.z))
                corners.append(copies[vert])
            else:
                corners.append(vert)
        made = mesh.faces.new(corners)
        made.material_index, made.smooth = face.material_index, face.smooth
        mesh.faces.remove(face)


def lay(obj, centres, radii, axis):
    """
    Lays the belt onto the path round the pulleys, keeping where it is, and
    answers the path's length, whether the pulleys were given clockwise, and
    which way along x of its own, as the curve bends it, it runs round them
    anticlockwise. A belt that cannot be laid so that it stays where it was is left as it was.
    """
    frame = _frame(centres, axis)
    to_plane = frame.inverted()
    flat_centres = [(to_plane @ c) for c in centres]
    need(all(abs(c.z) <= 1e-4 for c in flat_centres), "The pulleys' centres are not in one plane square to the axis.")
    points, turned = loop([(c.x, c.y) for c in flat_centres], radii)
    mesh = _world_mesh(obj)
    mesh.transform(to_plane)
    mesh.verts.ensure_lookup_table()
    before = [v.co.copy() for v in mesh.verts]
    along, off, length = _unrolled(numpy.array([(v.co.x, v.co.y) for v in mesh.verts]), points)
    kept = (obj.data.copy(), obj.parent, obj.matrix_world.copy(), [m.name for m in obj.modifiers if m.type == "CURVE"])
    path = _path_object(obj, points, frame)
    start, way, side = _how_bent(path, points, length)
    for vert, s, d in zip(mesh.verts, along, off):
        vert.co = ((way * (s - start)) % length, side * d, vert.co.z)
    _seam_cut(mesh, length)
    for modifier in [m for m in obj.modifiers if m.type == "CURVE"]:
        obj.modifiers.remove(modifier)
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()
    obj.parent = path
    obj.matrix_parent_inverse = mathutils.Matrix.Identity(4)
    obj.matrix_basis = mathutils.Matrix.Identity(4)
    bent = obj.modifiers.new("Runs round its pulleys", "CURVE")
    bent.object = path
    bent.deform_axis = "POS_X"
    bpy.context.view_layer.update()
    laid = _world_mesh(obj)
    laid.transform(to_plane)
    laid.verts.ensure_lookup_table()
    off_by = max((laid.verts[i].co - before[i]).length for i in range(len(before)))
    laid.free()
    data, parent, placed, _ = kept
    if off_by <= LAID_OFF:
        bpy.data.meshes.remove(data)
        obj[LAID] = length
        return length, turned, way
    obj.modifiers.remove(bent)
    laid_data, obj.data = obj.data, data
    bpy.data.meshes.remove(laid_data)
    obj.parent = parent
    obj.matrix_world = placed
    bpy.data.objects.remove(path)
    raise Refused(
        f"{obj.name} could not be laid onto the path round its pulleys: laid on it, it strays {off_by * 1000:.2g} mm from where it was. "
        "Check the pulleys' centres and radii; it is left as it was."
    )


def _how_bent(path, points, length):
    """
    Where the curve bends a point at the start of its x, a millimetre along
    and a millimetre across: where on the path it starts, which way along
    the path its x runs, and to which side its y is.
    """
    mesh = bpy.data.meshes.new("zhiyin probe")
    mesh.from_pydata([(0, 0, 0), (1e-3, 0, 0), (0, 1e-3, 0)], [], [])
    probe = bpy.data.objects.new("zhiyin probe", mesh)
    bpy.context.scene.collection.objects.link(probe)
    probe.parent = path
    bend = probe.modifiers.new("bend", "CURVE")
    bend.object = path
    bend.deform_axis = "POS_X"
    bpy.context.view_layer.update()
    evaluated = probe.evaluated_get(bpy.context.evaluated_depsgraph_get())
    landed = numpy.array([(v.co.x, v.co.y) for v in evaluated.data.vertices])
    bpy.data.objects.remove(probe)
    bpy.data.meshes.remove(mesh)
    along, off, _ = _unrolled(landed, points)
    ahead = (along[1] - along[0] + length / 2) % length - length / 2
    return float(along[0]), 1.0 if ahead > 0 else -1.0, 1.0 if off[2] > off[0] else -1.0


def _path_object(obj, points, frame):
    """The curve the belt is bent along: closed, flat in the pulleys' plane."""
    name = f"{obj.name} path"
    old = bpy.data.objects.get(name)
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, (x, y) in zip(spline.points, points):
        point.co = (x, y, 0.0, 1.0)
    spline.use_cyclic_u = True
    if old is not None and old.type == "CURVE":
        old.data = curve
        path = old
    else:
        path = bpy.data.objects.new(name, curve)
        for collection in obj.users_collection:
            collection.objects.link(path)
    path.parent = None
    path.matrix_world = frame
    path.hide_render = True
    return path


def _unkeyed_run(obj):
    """Removes the keys of a belt's run."""
    data = obj.animation_data
    if data is None or data.action is None or data.action_slot is None:
        return
    bag = anim_utils.action_get_channelbag_for_slot(data.action, data.action_slot)
    for curve in [c for c in bag.fcurves if c.data_path == "location" and c.array_index == 0] if bag is not None else []:
        bag.fcurves.remove(curve)


def run_one(spec, said_by_object, timeline_seconds):
    """Lays one belt onto its path and keys or ties its run; answers the time its keys reach."""
    need(isinstance(spec, dict), "Each of belts names an object and its pulleys.")
    obj = find_object(spec.get("object"), ["MESH"])
    pulleys = spec.get("pulleys")
    need(isinstance(pulleys, list) and len(pulleys) >= 2, f"{obj.name}'s pulleys are two or more, each its centre and radius.")
    centres, radii = [], []
    for index, pulley in enumerate(pulleys, start=1):
        need(isinstance(pulley, dict), f"Pulley {index} of {obj.name} is its at and radius.")
        centres.append(vector(pulley.get("at"), f"pulley {index}'s at"))
        radius = number(pulley.get("radius"), f"pulley {index}'s radius")
        need(radius != 0, f"Pulley {index}'s radius is not 0.")
        radii.append(radius)
    if spec.get("axis") is not None:
        axis = vector(spec["axis"], "axis")
        need(axis.length > 1e-9, "axis is a direction, not 0.")
    else:
        need(len(centres) >= 3, f"Give {obj.name}'s axis: two pulleys alone do not say which way they turn.")
        axis = (centres[1] - centres[0]).cross(centres[2] - centres[0])
        need(axis.length > 1e-12, f"{obj.name}'s pulleys lie in a line: give its axis.")
    speed, follows = spec.get("speed"), spec.get("follows")
    need((speed is None) != (follows is None), f"Give {obj.name} a speed, or a pulley it follows, not both.")
    # A run given again replaces the one before, keyed or followed, and the
    # belt is laid again from where it rests, not where it has run to.
    obj.driver_remove("location", 0)
    _unkeyed_run(obj)
    if obj.get(LAID) is not None:
        obj.location.x = 0.0
        bpy.context.view_layer.update()
    length, turned, anticlockwise = lay(obj, centres, radii, axis)
    # Its run, along the path, is its place along x on the path's axes;
    # the pulleys' listed order is the way a positive run goes.
    way = (-1.0 if turned else 1.0) * anticlockwise
    said = said_by_object.setdefault(obj.name, [])
    said.append(f"laid onto its path round {len(centres)} pulleys, {length * 1000:.0f} mm long, as {obj.name} path")
    if follows is not None:
        need(isinstance(follows, dict), "follows names a pulley, the axis it turns about and its radius.")
        pulley = find_object(follows.get("object"))
        turn_axis = follows.get("axis")
        need(turn_axis in AXES, "follows' axis is x, y or z: the pulley's own axis it turns about.")
        radius = number(follows.get("radius"), "follows' radius")
        own_axis = pulley.matrix_world.to_3x3() @ mathutils.Vector([1.0 if a == turn_axis else 0.0 for a in AXES])
        # A pulley inside the loop turned anticlockwise about the loop's axis runs the belt that way.
        sense = 1.0 if own_axis.dot(axis.normalized()) >= 0 else -1.0
        # A negative radius, an idler on the belt's back, turns the other way.
        ratio = sense * radius * math.pi / 180 * anticlockwise
        follow_one(
            {"object": obj.name, "value": "place", "axis": "x", "from": {"object": pulley.name, "value": "turn", "axis": turn_axis}, "ratio": ratio},
            {},
        )
        said.append(f"its run follows {pulley.name}'s turn about its {turn_axis} axis, {abs(radius) * 1000:g} mm out")
        return 0.0
    need(is_number(speed), "speed is a number, in metres a second.")
    start = moment(spec.get("from"), "from", default=START)
    end = moment(spec.get("to"), "to", default=min(max(timeline_seconds, start + 1), LONGEST))
    need(end > start, "to comes after from.")
    obj.location.x = 0.0
    obj.keyframe_insert("location", index=0, frame=frame_of(start))
    obj.location.x = way * float(speed) * (end - start)
    obj.keyframe_insert("location", index=0, frame=frame_of(end))
    for curve in [c for c in curves_of(obj) if c.data_path == "location" and c.array_index == 0]:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
        curve.extrapolation = "LINEAR"
    said.append(f"runs at {float(speed):g} m/s from {start:g} s, the way its pulleys are listed, and on past {end:g} s")
    return end
