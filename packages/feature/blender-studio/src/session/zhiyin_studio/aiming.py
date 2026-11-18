"""
Cameras and lights pointed: turned upright toward a point, kept on what they were aimed or
focused at, and placed to fit a set of corners in the picture.
"""

import functools
import math

import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .geometry import middle_of

# How far from straight up or down a direction may lean and still count as it,
# as the sine of the angle.
VERTICAL = 1e-3


def vertical(way):
    way = mathutils.Vector(way).normalized()
    return math.hypot(way.x, way.y) < VERTICAL


def upright(way, ahead=(0, 1, 0)):
    """
    The turn of a camera or a light that looks back along `way` with the
    world's up up its picture. Looking straight down or up there is no such
    up, and the level direction `ahead` is up the picture instead: +y, as a
    plan reads, unless another is given.
    """
    back = mathutils.Vector(way).normalized()
    right = mathutils.Vector((0, 0, 1)).cross(back)
    if right.length < VERTICAL:
        right = mathutils.Vector(ahead).cross(back)
    right.normalize()
    return mathutils.Matrix((right, back.cross(right), back)).transposed().to_quaternion()


def look_at(obj, target):
    direction = mathutils.Vector(target) - obj.location
    if direction.length < 1e-9:
        return
    obj.rotation_euler = upright(-direction).to_euler()


def reaim(obj):
    """A light stays aimed at the point it was aimed at, wherever it is moved."""
    if obj.type == "LIGHT" and obj.get("zhiyin_aim") is not None:
        look_at(obj, mathutils.Vector(obj["zhiyin_aim"]))


def refocus(camera):
    """Keeps a camera focused on the middle of the object it was focused on, wherever either has moved."""
    data = camera.data
    name = data.get("zhiyin_focus")
    if not name:
        return
    target = bpy.data.objects.get(name)
    if target is None:
        del data["zhiyin_focus"]
        return
    bpy.context.view_layer.update()
    forward = camera.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))
    data.dof.focus_distance = max(0.001, (middle_of(target) - camera.matrix_world.translation).dot(forward))


def refocus_scene():
    """Keeps the scene camera on what it is focused on."""
    camera = bpy.context.scene.camera
    if camera is not None:
        refocus(camera)


def keeps_focus(tool):
    """
    A tool that can move a camera or what it is focused on, or change that
    object's shape, refocuses the scene camera after it.
    """

    @functools.wraps(tool)
    def refocused(*args):
        said = tool(*args)
        refocus_scene()
        return said

    return refocused


def lens_shift(data):
    """A camera's lens shift in words, or nothing when its lens is not shifted."""
    if abs(data.shift_x) < 1e-6 and abs(data.shift_y) < 1e-6:
        return ""
    return f"lens shifted {round(data.shift_x, 4):g} across and {round(data.shift_y, 4):g} up"


def place_to_fit(camera, direction, corners, aspect, margin, ahead=(0, 1, 0)):
    """
    Puts the camera along a direction, as close as it can be with every corner
    in the picture, and moves it across so the corners are centred: as much
    space on each side of them. An orthographic camera is widened to fit them
    instead of moved closer. Straight down, `ahead` is up the picture. A
    shifted lens looks to one side of where the camera points, by its shift
    times the picture's longer side; the corners are centred in what it sees.
    """
    points = numpy.array([tuple(c) for c in corners], dtype=float)
    low = mathutils.Vector(points.min(axis=0))
    high = mathutils.Vector(points.max(axis=0))
    centre = (low + high) / 2
    reach = (high - low).length
    data = camera.data
    fill = 1 - margin
    way = mathutils.Vector(direction).normalized()
    turn = upright(way, ahead)
    right = turn @ mathutils.Vector((1, 0, 0))
    up = turn @ mathutils.Vector((0, 1, 0))
    offsets = points - numpy.array(centre)
    # How far toward the camera, to its right and up each corner is.
    toward = offsets @ numpy.array(way)
    across = offsets @ numpy.array(right)
    upward = offsets @ numpy.array(up)
    if data.type == "ORTHO":
        wide, tall = float(numpy.ptp(across)), float(numpy.ptp(upward))
        # The orthographic scale is the picture's longer side.
        longest = max(wide, tall * aspect) if aspect >= 1 else max(tall, wide / aspect)
        data.ortho_scale = max(longest / fill, 1e-3)
        distance = float(toward.max()) + max(reach, 0.1)
        sideways = (across.max() + across.min()) / 2 - data.shift_x * data.ortho_scale
        lift = (upward.max() + upward.min()) / 2 - data.shift_y * data.ortho_scale
    else:
        half = data.sensor_width / (2 * data.lens)
        tan_h, tan_v = (half, half / aspect) if aspect >= 1 else (half * aspect, half)
        tan_h, tan_v = tan_h * fill, tan_v * fill
        # Where the middle of the picture is, as a slope from where the camera points.
        mid_h, mid_v = data.shift_x * 2 * half, data.shift_y * 2 * half
        # Seen from a camera moved `a` to the right and `d` along the way, a
        # corner is in the picture while |(its across - a) / (d - its toward)
        # - mid| ≤ tan. The nearest d leaving room for some a, each way:
        reach_h = ((across + (tan_h + mid_h) * toward).max() - (across - (tan_h - mid_h) * toward).min()) / (2 * tan_h)
        reach_v = ((upward + (tan_v + mid_v) * toward).max() - (upward - (tan_v - mid_v) * toward).min()) / (2 * tan_v)
        distance = max(float(reach_h), float(reach_v), float(toward.max()) + 1e-3, 1e-3)
        depth = distance - toward
        sideways, lift = shift_to_centre(across, depth, mid_h), shift_to_centre(upward, depth, mid_v)
    camera.location = centre + right * float(sideways) + up * float(lift) + way * distance
    camera.rotation_euler = turn.to_euler()
    data.clip_start = max(distance / 1000, 0.0001)
    data.clip_end = distance + reach * 4 + 10
    return centre


def shift_to_centre(offsets, depth, mid=0.0):
    """
    How far to move a camera across so that, seen in perspective, the corner
    furthest one way is as far from the middle of the picture as the corner
    furthest the other way. `mid` is where that middle is, as a slope from
    where the camera points: nothing unless its lens is shifted.
    """
    span = float(offsets.max() - offsets.min()) + abs(mid) * float(depth.max())
    low, high = float(offsets.min()) - span, float(offsets.max()) + span
    for _ in range(60):
        middle = (low + high) / 2
        seen = (offsets - middle) / depth - mid
        if seen.max() + seen.min() > 0:
            low = middle
        else:
            high = middle
    return (low + high) / 2
