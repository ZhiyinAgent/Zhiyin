"""
A spec's requirement measured over the animation rather than at one moment: no two of the parts
named go into each other, deeper than a limit, at any frame measured. Each frame is measured as a
motion report measures it, on the parts' surfaces, and the answer says the deepest overlap,
between what and when. A cloth among the parts also fails where its edges go through a closed
other, as a bake's own check finds, though none of its points is inside it. It steps the timeline, so it is measured with the scene free to move, and
the scene is set back at its own moment after. It stops when the spec's time is up. A part moved
by a simulation is measured only from its bake: stepped from its start, an unbaked one would hold
up every change.
"""

import math
import time

import bpy
import numpy

from .geometry import Lasting, held_still
from .motion_checks import overlap_text
from .moving import standing, unchanging
from .overlaps import goes_into
from .sim_bake import WORLD, simulations
from .sim_cloth_through import NAMED, Passage, Sheet, Surface
from .spec_shapes import Unchecked
from .timeline import back_to, frame_of, now, seconds_of, seconds_text

# The kinds measured over the animation.
MOTION_KINDS = {"separate_in_motion"}


def frames_asked(asked):
    """The frames a requirement measures: every frame, or every so many, from its start to its end, the timeline's by default."""
    start = float(asked.get("start", 0))
    end = float(asked["end"]) if asked.get("end") is not None else seconds_of(bpy.context.scene.frame_end)
    if end < start:
        raise Unchecked(f"it ends at {seconds_text(end)}, before it starts at {seconds_text(start)}")
    every = int(asked.get("every", 1))
    first, last = math.ceil(frame_of(start) - 1e-6), math.floor(frame_of(end) + 1e-6)
    return list(range(first, last + 1, every)) or [round(frame_of(start))], every


def is_cloth(obj):
    return obj.type == "MESH" and any(m.type == "CLOTH" for m in obj.modifiers)


def cloth_points(obj, depsgraph):
    """A cloth's evaluated points in the world, as an array of rows."""
    mesh = obj.evaluated_get(depsgraph).data
    found = numpy.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", found)
    matrix = numpy.array(obj.matrix_world)
    return found.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]


class Crossings:
    """
    Each cloth among the parts against the closed others, frame by frame: where its edges go
    through one of them, which a cloth stepping right past a thin part does with none of its
    points ever inside it.
    """

    def __init__(self, objects):
        self.cloths = [(o, Sheet(o)) for o in objects if is_cloth(o)]
        self.others = {o.name: [p for p in objects if p != o and p.type == "MESH" and not is_cloth(p)] for o, _ in self.cloths}
        self.surfaces = {}
        self.found = {}
        # Each cloth's points at the frame measured before, for the open parts its points cross on the way.
        self.before = {}

    def see(self, frame):
        if not self.cloths:
            return
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for cloth, sheet in self.cloths:
            points = cloth_points(cloth, depsgraph)
            if not numpy.isfinite(points).all():
                self.before.pop(cloth.name, None)
                continue
            surfaces = []
            for other in self.others[cloth.name]:
                known = self.surfaces.get(other.name)
                surface = known.current(depsgraph) if known is not None else Surface(other, depsgraph)
                self.surfaces[other.name] = surface
                surfaces.append(surface)
            before, self.before[cloth.name] = self.before.get(cloth.name), points
            for surface, edges in sheet.through(points, surfaces, before):
                passage = self.found.setdefault((cloth, surface.obj.name), Passage())
                passage.frames[frame] = len(edges)
                passage.paths = passage.paths or any(i == j for i, j in edges)
                passage.points.update(k for edge in edges for k in edge)

    def text(self):
        """Each cloth and part it goes through, the most of its points first; empty when none."""
        ranked = sorted(self.found.items(), key=lambda item: -len(item[1].points))
        said = [f"{cloth.name} goes through {name} {passage.words(len(cloth.data.vertices))}" for (cloth, name), passage in ranked[:NAMED]]
        if len(ranked) > NAMED:
            said.append(f"and through {len(ranked) - NAMED} more, fewer of its points each: {', '.join(name for (_, name), _ in ranked[NAMED:])}")
        return "; ".join(said)


def overlaps_over(objects, frames, deadline):
    """
    Each two of the objects that go into each other, by pair and frame; where a cloth among them
    goes through another; and the frames measured before the deadline.
    """
    overlaps, taken = {}, []
    crossings = Crossings(objects)
    # Each frame is set straight: every simulation moving these parts is read from its bake, and
    # one moving none of them is not stepped for them.
    scene = bpy.context.scene
    # What stands the same at the ends and between, and nothing changes, is measured once, not at each frame.
    seen = {}
    for frame in (frames[0], frames[len(frames) // 2], frames[-1]):
        scene.frame_set(frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in objects:
            seen.setdefault(obj.name, []).append(standing(obj, depsgraph))
    lasting = Lasting(o.as_pointer() for o in objects if unchanging(o, seen))
    for frame in frames:
        if time.monotonic() > deadline:
            break
        taken.append(frame)
        scene.frame_set(frame)
        with held_still(lasting):
            for obj in objects:
                for other, depth in goes_into(obj, objects):
                    pair = overlaps.setdefault(tuple(sorted((obj.name, other.name))), {})
                    pair[frame] = max(pair.get(frame, 0.0), depth or 0.0)
        crossings.see(frame)
    return overlaps, crossings.text(), taken


def moves(sim, owners):
    """Whether a simulation moves any of these objects: its own, or the rigid-body world for an active rigid body."""
    if sim.label == WORLD:
        return any(o.rigid_body is not None and o.rigid_body.type == "ACTIVE" for o in owners)
    owner = getattr(sim, "obj", None)
    if owner is not None:
        return owner in owners
    return any(sim.label.endswith(f" on {o.name}") for o in owners)


def unbaked_for(objects, first, last):
    """
    Why the simulations moving these parts cannot be read over the frames asked: each not baked, or
    baked over frames that do not reach them. Stepped from its start instead, such a simulation would
    hold up every change the spec is measured after.
    """
    owners = set()
    for obj in objects:
        while obj is not None:
            owners.add(obj)
            obj = obj.parent
    said = []
    for sim in simulations():
        if not moves(sim, owners):
            continue
        span = sim.baked_range() if sim.baked() else None
        if not sim.baked():
            said.append(f"{sim.label} is not baked")
        elif span is not None and (span[0] > first or span[1] < last):
            said.append(f"{sim.label} is baked over frames {span[0]} to {span[1]}, short of frames {first} to {last}")
    return said


def separate_in_motion(run, asked):
    objects = [obj for obj, _ in run.shapes_named(asked["parts"], "parts")]
    if len(objects) < 2:
        raise Unchecked("it names one part, and an overlap is between two")
    frames, every = frames_asked(asked)
    waiting = unbaked_for(objects, frames[0], frames[-1])
    if waiting:
        raise Unchecked(
            f"{'; '.join(waiting)}, and stepping a simulation from its start after every change would hold each change up:"
            " bake it with blender_simulate first"
        )
    kept = now()
    try:
        overlaps, through, taken = overlaps_over(objects, frames, run.deadline)
    finally:
        back_to(kept)
    if not taken:
        raise Unchecked(f"the spec's measures took their {run.seconds()} before its first frame")
    span = f"{len(taken)} frames from {seconds_text(seconds_of(taken[0]))} to {seconds_text(seconds_of(taken[-1]))}"
    span += f", every {every} frames" if every > 1 else ""
    cut = len(taken) < len(frames)
    if cut:
        span += f", short of {seconds_text(seconds_of(frames[-1]))} when the spec's {run.seconds()} ran out"
    limit = asked.get("max")
    if through:
        # A cloth through a part fails however shallow its points go into it.
        deep = f"; {overlap_text(overlaps, {}, 3, taken)}" if overlaps else ""
        return {"margin": None, "holds": False, "measured": f"{through}{deep}, measured at {span}"}
    if not overlaps:
        if cut:
            raise Unchecked(f"no two of them go into each other at the {span}; measure every few frames with every, or fewer parts")
        return {"margin": None, "measured": f"no two of them go into each other at any of the {span.replace(' frames', ' frames measured,', 1)}"}
    deepest = max(depth for pair in overlaps.values() for depth in pair.values()) * 1000
    said = f"{overlap_text(overlaps, {}, 3, taken)}, measured at {span}"
    if limit is None:
        return {"margin": -deepest if deepest else None, "holds": False, "unit": "mm", "measured": said}
    if cut and deepest <= limit:
        raise Unchecked(f"nothing goes deeper than {limit:g} mm at the {span}; measure every few frames with every, or fewer parts")
    return {"margin": limit - deepest, "unit": "mm", "measured": f"{said}, where at most {limit:g} mm deep is asked"}
