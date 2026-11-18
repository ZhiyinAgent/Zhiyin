"""
What goes into what across a whole description, within a time: each object measured against the
others once, those left when the time runs out named unchecked rather than taken as clear. Where
many objects go into one, as rocks scattered into a log, they are said together by what they go
into, with the deepest; and what an object places as instances is said by how many of its
instances go into each object, measured instance by instance.
"""

import time

from .geometry import copies_named, copies_of, measured_copies
from .measure_shapes import Mesh, Shape, boxes_meet, into
from .overlaps import goes_into
from .wording import length, stems_text

# From this many objects going into one, they are said together.
GROUPED_FROM = 5


class Overlapping:
    """What each object goes into, measured within `seconds`, and the words a description gives it."""

    def __init__(self, seconds):
        self.deadline = time.time() + seconds
        self.found = {}
        self.unchecked = []
        self.copies = {}
        self.grouped = set()

    def measure(self, objects, others):
        """Measures each object against the others while time is left; then finds the objects many go into."""
        for obj in objects:
            if time.time() > self.deadline:
                self.unchecked.append(obj.name)
                continue
            self.found[obj.name] = goes_into(obj, others)
            # One instance goes in as the object does; of many, how many do.
            if len(copies_of(obj)) > 1 and self.found[obj.name]:
                self.copies[obj.name] = self.instances_into(obj, self.found[obj.name])
        into_each = {}
        for name, pairs in self.found.items():
            for other, depth in pairs:
                into_each.setdefault(other.name, []).append((name, depth))
        self.groups = {target: went for target, went in into_each.items() if len(went) >= GROUPED_FROM}
        for target, went in self.groups.items():
            for name, _ in went:
                self.grouped |= {(name, target), (target, name)}

    def instances_into(self, obj, pairs):
        """How many of an object's measured instances go into each object it goes into, and the deepest: {name: (count, depth)}."""
        counted = {}
        shapes = {}
        for other, _ in pairs:
            theirs = Shape(Mesh.of_object(other), label=other.name)
            count, deepest = 0, 0.0
            for _, mesh, place in measured_copies(obj):
                if time.time() > self.deadline:
                    break
                key = mesh.as_pointer()
                if key not in shapes:
                    shapes[key] = Mesh.of_data(mesh)
                copy = Shape(shapes[key], place)
                found = into(copy, theirs) if boxes_meet(copy, theirs) else None
                if found is not None:
                    count += 1
                    deepest = max(deepest, found[0])
            counted[other.name] = (count, deepest)
        return counted

    def words(self, obj):
        """What an object goes into, as its line in a description says it, but for what is said by groups."""
        said = []
        for other, depth in self.found.get(obj.name, []):
            if (obj.name, other.name) in self.grouped:
                continue
            counted = self.copies.get(obj.name, {}).get(other.name)
            if counted is not None and counted[0]:
                count, deepest = counted
                many = f"{count:,} of its instances go" if count != 1 else "1 of its instances goes"
                said.append(f"{many} into {other.name}" + (f", the deepest {length(deepest)}" if deepest else ""))
            elif depth:
                said.append(f"goes {length(depth)} into {copies_named(other)}")
            else:
                said.append(f"goes into {copies_named(other)}")
        return said

    def group_lines(self):
        """A line for each object many go into: how many, their names, and the deepest."""
        lines = []
        for target, went in sorted(self.groups.items(), key=lambda g: -len(g[1])):
            deepest = max(went, key=lambda w: w[1] or 0)
            depth = f", the deepest {deepest[0]} by {length(deepest[1])}" if deepest[1] else ""
            lines.append(f"- {len(went)} objects go into {target}: {stems_text(name for name, _ in went)}{depth}.")
        return (["Going into one object, measured on their shapes:"] + lines) if lines else []
