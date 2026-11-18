"""
A geometry nodes simulation zone checked after its bake, frame by frame over the timeline: how
many points its object's geometry has at each frame, and whether every position stays finite. A
state that grows without bound turns to infinity or NaN, and the frame it does is said, with how
far its points had gone the frame before.
"""

import bpy
import numpy

from .finding import scene
from .timeline import seconds_of, seconds_text


def positions(geometry):
    """Every point position of an evaluated geometry, in the object's own space."""
    found = []
    mesh = geometry.mesh
    if mesh is not None and len(mesh.vertices):
        co = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float32)
        mesh.vertices.foreach_get("co", co)
        found.append(co)
    for part in (geometry.pointcloud, geometry.curves, geometry.instances_pointcloud()):
        if part is None:
            continue
        attribute = part.attributes.get("position")
        if attribute is None or not len(attribute.data):
            continue
        co = numpy.empty(len(attribute.data) * 3, dtype=numpy.float32)
        attribute.data.foreach_get("vector", co)
        found.append(co)
    return numpy.concatenate(found).reshape(-1, 3) if found else numpy.zeros((0, 3), dtype=numpy.float32)


class Watched:
    """One object's points over the frames: counts, the frame its state stops being finite, how far it reached."""

    def __init__(self, obj):
        self.obj = obj
        self.counts = []
        self.broke = None
        self.farthest = (0.0, None)

    def see(self, frame, graph):
        at = positions(self.obj.evaluated_get(graph).evaluated_geometry())
        self.counts.append((frame, len(at)))
        if self.broke is not None or not len(at):
            return
        if not numpy.isfinite(at).all():
            self.broke = frame
            return
        far = float(numpy.linalg.norm(at.astype(numpy.float64), axis=1).max())
        if far >= self.farthest[0]:
            self.farthest = (far, frame)

    def counted(self):
        counts = [n for _, n in self.counts]
        if len(set(counts)) == 1:
            return f"{counts[0]:,} points at every frame"
        (first, start), (last, end) = self.counts[0], self.counts[-1]
        return f"{start:,} points at frame {first} to {end:,} at frame {last}, {max(counts):,} at most"

    def text(self):
        far, frame = self.farthest
        reach = f"{far:.3g} m" if far >= 1 else f"{far * 1000:.4g} mm"
        if self.broke is None:
            return f"{self.counted()}, all finite, at most {reach} from {self.obj.name}'s origin"
        before = f", {reach} from {self.obj.name}'s origin at frame {frame} before it" if frame is not None else ""
        return (
            f"{self.counted()}; positions are not finite from frame {self.broke} ({seconds_text(seconds_of(self.broke))}):"
            f" the zone's state blew up{before}"
        )


def zone_checks(objects):
    """Each object's check, by name, stepping once through the timeline for all of them."""
    if not objects:
        return {}
    room = scene()
    watched = {obj.name: Watched(obj) for obj in objects}
    for frame in range(room.frame_start, room.frame_end + 1):
        room.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        for one in watched.values():
            one.see(frame, graph)
    return {name: one.text() for name, one in watched.items()}
