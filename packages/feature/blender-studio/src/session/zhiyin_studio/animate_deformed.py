"""
Meshes that bones bend, measured as a motion check measures parts: their surfaces, not their
origins, which stay where they are while an armature deforms them. A deformed surface whose points
jump in one frame pops; one whose lowest points rest on something and travel over it slides, as a
foot skates on a floor; and its fastest point is its speed.
"""

import numpy

from .keys import curves_of
from .timeline import fps, seconds_of, seconds_text
from .wording import length

# The most points of a deformed surface followed from frame to frame.
MOST_POINTS = 5000


def deformers(obj):
    """The armatures that bend a mesh: by an Armature step, or as the armature it is attached to deforms it."""
    if obj.type != "MESH":
        return []
    found = [m.object for m in obj.modifiers if m.type == "ARMATURE" and m.object is not None and m.show_viewport]
    if obj.parent is not None and obj.parent.type == "ARMATURE" and obj.parent_type == "ARMATURE":
        found.append(obj.parent)
    return list(dict.fromkeys(found))


def posed(armature):
    """Whether anything moves an armature's bones: keys, drivers or constraints on them, or the armature itself moving."""
    data = armature.animation_data
    if curves_of(armature) or (data is not None and data.drivers):
        return True
    return any(bone.constraints for bone in armature.pose.bones)


def bent(obj):
    """Whether bones that move bend a mesh."""
    return any(posed(armature) for armature in deformers(obj))


def taken(count):
    """Which of a surface's points are followed: every one, or evenly spread up to the most followed."""
    return numpy.arange(0, count, max(1, -(-count // MOST_POINTS)))


def surface(obj, depsgraph):
    """A deformed mesh's followed points in the world now, as an array."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        flat = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float64)
        mesh.vertices.foreach_get("co", flat)
    finally:
        evaluated.to_mesh_clear()
    points = flat.reshape(-1, 3)[taken(len(flat) // 3)]
    matrix = numpy.array(obj.matrix_world)
    return (points @ matrix[:3, :3].T + matrix[:3, 3]).astype(numpy.float32)


def mark(obj, depsgraph):
    """A deformed shape's mark for telling frames apart: its followed points' middle and spread, to a tenth of a millimetre."""
    points = surface(obj, depsgraph)
    if not len(points):
        return ()
    return tuple(round(float(v), 4) for v in (*points.mean(axis=0), *points.min(axis=0), *points.max(axis=0)))


def steps_of(points):
    """Each followed point's step from each frame taken to the next, as rows by frame."""
    stack = numpy.stack(points)
    return numpy.linalg.norm(stack[1:] - stack[:-1], axis=2)


def surface_pops(frames, surfaces, pop, least):
    """Deformed surfaces whose points jump in one frame, far further than in the frames either side."""
    said = []
    for name, points in surfaces.items():
        if len(points) < 4 or any(len(p) != len(points[0]) for p in points):
            continue
        steps = steps_of(points)
        for i in range(1, len(steps) - 1):
            around = numpy.maximum(steps[i - 1], steps[i + 1])
            jumping = (steps[i] > least) & (steps[i] > pop * around)
            if jumping.any():
                j = int(numpy.argmax(numpy.where(jumping, steps[i], 0)))
                said.append(
                    f"{name}'s surface jumps {length(float(steps[i][j]))} between {seconds_text(seconds_of(frames[i]))}"
                    f" and {seconds_text(seconds_of(frames[i + 1]))}, its point moving {length(float(around[j]))} in the frames either side"
                )
                break
    return said


def surface_speeds(frames, surfaces, step):
    """Each deformed surface's fastest point: (metres a second, the frame index it is fastest at, name)."""
    found = []
    for name, points in surfaces.items():
        if len(points) < 2 or any(len(p) != len(points[0]) for p in points):
            continue
        fastest = steps_of(points).max(axis=1) * fps() / step
        i = int(numpy.argmax(fastest))
        if fastest[i] > 1e-6:
            found.append((float(fastest[i]), i, f"{name}'s surface"))
    return found


def surface_slides(obj, frames, points, under, resting, sliding):
    """
    A deformed surface whose lowest points rest on something and travel
    across it while they rest, as a foot skates on a floor: how far, on what,
    when, and the bone that bends those points most.
    """
    if len(points) < 2 or any(len(p) != len(points[0]) for p in points):
        return None
    travel, when, on, touching = 0.0, [], None, None
    for i in range(1, len(points)):
        if under[i] is None or under[i - 1] is None or under[i][0] != under[i - 1][0]:
            continue
        before, now = points[i - 1], points[i]
        low_before = before[:, 2] <= before[:, 2].min() + resting
        low_now = now[:, 2] <= now[:, 2].min() + resting
        contact = low_before & low_now
        if not contact.any():
            continue
        on, carrying = under[i]
        carried_from = under[i - 1][1]
        # What it rests on may move too: its points' travel is counted against what carries them.
        moved = numpy.array(carrying @ carried_from.inverted())
        start = before[contact].astype(numpy.float64)
        carried = start @ moved[:3, :3].T + moved[:3, 3]
        shift = (now[contact] - carried)[:, :2].mean(axis=0)
        travel += float(numpy.linalg.norm(shift))
        when.append(frames[i])
        if touching is None:
            touching = numpy.nonzero(contact)[0]
    if travel <= sliding:
        return None
    text = (
        f"{obj.name}'s surface slides {length(travel)} along {on.name} between {seconds_text(seconds_of(when[0]))}"
        f" and {seconds_text(seconds_of(when[-1]))} where its lowest points rest on it"
    )
    bone = heaviest_bone(obj, touching)
    return text + (f", bent there most by the bone {bone}" if bone else "")


def heaviest_bone(obj, followed):
    """The bone whose group weighs most on the points followed, by their indices among those taken."""
    indices = taken(len(obj.data.vertices))[followed]
    bones = {b.name for armature in deformers(obj) for b in armature.data.bones}
    weights = {}
    for index in indices[:500]:
        for group in obj.data.vertices[int(index)].groups:
            name = obj.vertex_groups[group.group].name
            if name in bones:
                weights[name] = weights.get(name, 0.0) + group.weight
    return max(weights, key=weights.get) if weights else None
