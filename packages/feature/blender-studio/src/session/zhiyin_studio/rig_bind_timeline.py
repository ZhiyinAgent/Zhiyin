"""
Reaching chains checked at every frame of the timeline: where a chain's tip falls short of its
target, where its bend turns to the other side from where it bends at rest or jumps between
frames, where its bones stretch past their length, and where a chain along a curve leaves it.
"""

import math

import bpy
import numpy

from .finding import scene
from .motion_checks import MOST_SCANNED, span_text, spans
from .timeline import back_to, go_to, now, seconds_of, seconds_text
from .wording import length, listed

# A tip this far from its target, or this share of its chain's length, reaches it.
REACHED, REACHED_SHARE = 0.001, 0.002
# A bone this much longer than at rest stretches.
STRETCHED = 1.001
# A bend this far from its side at rest is on the other side; a bend turning this far between frames jumps.
FLIPPED = math.radians(90)
# The most runs of frames said for one finding.
RUNS_SAID = 3


def runs_text(frames, marked):
    runs = spans(frames, marked)
    said = " and ".join(span_text(run) for run in runs[:RUNS_SAID])
    return said + (f", and {len(runs) - RUNS_SAID} more times" if len(runs) > RUNS_SAID else "")


def at(frame):
    return f"at {seconds_text(seconds_of(frame))}"


class Stretches:
    """Each bone's length against its length at rest, frame by frame."""

    def __init__(self, chain):
        self.chain = chain
        self.ratios = []

    def measure(self):
        self.ratios.append([(b.tail - b.head).length / max(b.bone.length, 1e-12) for b in self.chain])

    def said(self, frames):
        marked = [max(r) > STRETCHED for r in self.ratios]
        if not any(marked):
            return "no bone stretches"
        names = [b.name for k, b in enumerate(self.chain) if any(r[k] > STRETCHED for r in self.ratios)]
        worst = max(range(len(frames)), key=lambda i: max(self.ratios[i]))
        verb = "stretch past their length" if len(names) > 1 else "stretches past its length"
        return f"{listed(names)} {verb} {runs_text(frames, marked)}, up to {max(self.ratios[worst]):.4g}× {at(frames[worst])}"


class Chain:
    """An IK chain, followed for its tip against its target, its bend and its stretch."""

    def __init__(self, arm, chain, target, total, joint, rest_side):
        self.arm, self.chain, self.target, self.total = arm, chain, target, total
        self.joint, self.rest_side = joint, rest_side
        self.gaps, self.sides = [], []
        self.stretches = Stretches(chain)

    def measure(self):
        world = self.arm.matrix_world
        points = [world @ b.head for b in self.chain] + [world @ self.chain[-1].tail]
        goal = self.target.matrix_world.translation
        self.gaps.append(((points[-1] - goal).length, (goal - points[0]).length))
        self.stretches.measure()
        if self.joint is None:
            return
        parent = self.chain[0].parent
        space = (world @ parent.matrix).inverted() if parent else world.inverted()
        local = [space @ p for p in points]
        axis = local[-1] - local[0]
        side = local[self.joint] - local[0] - axis * ((local[self.joint] - local[0]).dot(axis) / max(axis.length_squared, 1e-12))
        self.sides.append(side.normalized() if side.length > 1e-4 * self.total else None)

    def said(self, frames):
        found = []
        near = max(REACHED, REACHED_SHARE * self.total)
        short = [gap > near for gap, _ in self.gaps]
        if any(short):
            worst = max(range(len(frames)), key=lambda i: self.gaps[i][0])
            gap, away = self.gaps[worst]
            found.append(
                f"the tip falls short {runs_text(frames, short)}, by up to {length(gap)} {at(frames[worst])}, where"
                f" {self.target.name} is {length(away)} from the chain's root against its {length(self.total)} length"
            )
        else:
            found.append("the tip reaches its target throughout")
        if self.joint is not None:
            found += self.bend_said(frames)
        found.append(self.stretches.said(frames))
        return found

    def bend_said(self, frames):
        found = []
        if self.rest_side is not None:
            away = [math.degrees(s.angle(self.rest_side)) if s is not None else 0.0 for s in self.sides]
            other = [a > math.degrees(FLIPPED) for a in away]
            if any(other):
                worst = max(range(len(frames)), key=lambda i: away[i])
                found.append(
                    f"the bend turns to the other side from where it bends at rest {runs_text(frames, other)},"
                    f" up to {away[worst]:.3g}° {at(frames[worst])}"
                )
        jumps = [
            math.degrees(a.angle(b)) if a is not None and b is not None else 0.0
            for a, b in zip(self.sides, self.sides[1:])
        ]
        if any(j > math.degrees(FLIPPED) for j in jumps):
            worst = max(range(len(jumps)), key=lambda i: jumps[i])
            count = sum(j > math.degrees(FLIPPED) for j in jumps)
            found.append(
                f"its bend jumps {jumps[worst]:.3g}° between frames {at(frames[worst + 1])}"
                + (f", and {count - 1} more times" if count > 1 else "")
            )
        if not found:
            found.append("the bend keeps its side")
        return found


class Spline:
    """A chain along a curve, followed for how far its joints lie off the curve and its stretch."""

    def __init__(self, arm, chain, curve, total):
        self.arm, self.chain, self.curve, self.total = arm, chain, curve, total
        self.offs = []
        self.stretching = False
        self.stretches = Stretches(chain)

    def polyline(self):
        """The curve as Blender evaluates it, as points in the world in order."""
        evaluated = self.curve.evaluated_get(bpy.context.evaluated_depsgraph_get())
        shape = evaluated.to_mesh()
        try:
            points = [self.curve.matrix_world @ v.co for v in shape.vertices]
            edges = [tuple(e.vertices) for e in shape.edges]
        finally:
            evaluated.to_mesh_clear()
        return points, edges

    def curve_length(self):
        points, edges = self.polyline()
        return sum((points[a] - points[b]).length for a, b in edges)

    def measure(self):
        points, edges = self.polyline()
        world = self.arm.matrix_world
        joints = [world @ b.head for b in self.chain] + [world @ self.chain[-1].tail]
        starts = numpy.array([points[a] for a, _ in edges]) if edges else numpy.zeros((0, 3))
        ends = numpy.array([points[b] for _, b in edges]) if edges else numpy.zeros((0, 3))
        worst = 0.0
        for joint in joints:
            if not edges:
                break
            p = numpy.array(joint)
            way = ends - starts
            along = numpy.clip(((p - starts) * way).sum(axis=1) / numpy.maximum((way * way).sum(axis=1), 1e-12), 0, 1)
            worst = max(worst, float(numpy.linalg.norm(starts + way * along[:, None] - p, axis=1).min()))
        self.offs.append(worst)
        self.stretches.measure()

    def said(self, frames):
        near = max(REACHED, REACHED_SHARE * self.total)
        off = [o > near for o in self.offs]
        if any(off):
            worst = max(range(len(frames)), key=lambda i: self.offs[i])
            found = [f"the chain lies off its curve {runs_text(frames, off)}, by up to {length(self.offs[worst])} {at(frames[worst])}"]
        else:
            found = ["the chain lies on its curve throughout"]
        if not self.stretching:
            found.append(self.stretches.said(frames))
        return found


def timeline_check(followed):
    """Steps through the timeline once for every chain followed; a line for each, in order."""
    s = scene()
    every = list(range(s.frame_start, s.frame_end + 1))
    step = max(1, math.ceil(len(every) / MOST_SCANNED))
    frames = every[::step]
    kept = now()
    try:
        for frame in frames:
            go_to(seconds_of(frame))
            bpy.context.view_layer.update()
            for each in followed:
                each.measure()
    finally:
        back_to(kept)
    head = f"Over the timeline, from {seconds_text(seconds_of(frames[0]))} to {seconds_text(seconds_of(frames[-1]))}"
    head += " at every frame" if step == 1 else f" every {step} frames"
    named = len(followed) > 1
    return [
        f"{head}{f', {each.chain[-1].name}' if named else ''}: " + "; ".join(each.said(frames)) + "." for each in followed
    ]

