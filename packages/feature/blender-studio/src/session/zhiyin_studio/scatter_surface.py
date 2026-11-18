"""
The surface a scatter stands copies on: its faces in the world with their materials, slopes and
vertex-group weights, points spread over them evenly by area, and the rules that keep or remove
each point, each counted, with the area they leave.
"""

import math
import random

import numpy
from mathutils import Vector

from .arguments import is_number, need
from .errors import Refused
from .finding import find_objects
from .measure_shapes import Mesh, Shape
from .shown_mesh import array, shown_data
from .wording import length, listed

# The rules in the order each point is put to them.
RULES = ("material", "vertex_group", "slope", "height", "away_from", "near")
# Points the area a rule of points leaves is measured from.
AREA_POINTS = 4000


class Surface:
    """An object's evaluated faces in the world, as triangles with what the rules ask of each."""

    def __init__(self, obj, group=None):
        need(obj.type == "MESH", f"“{obj.name}” is not a mesh to scatter onto.")
        self.name = obj.name
        with shown_data(obj) as mesh:
            mesh.calc_loop_triangles()
            need(len(mesh.loop_triangles), f"“{obj.name}” has no faces to scatter onto.")
            corners = array(mesh.loop_triangles, "vertices", 3, numpy.int64).ravel()
            faces = array(mesh.loop_triangles, "polygon_index", 1, numpy.int64).ravel()
            points = array(mesh.vertices, "co", 3, float).ravel()
            materials = array(mesh.polygons, "material_index", 1, numpy.int64).ravel()
            self.weights = None
            if group is not None:
                index = obj.vertex_groups[group].index
                self.weights = numpy.zeros(len(mesh.vertices))
                for vert in mesh.vertices:
                    for held in vert.groups:
                        if held.group == index:
                            self.weights[vert.index] = held.weight
        matrix = obj.matrix_world
        turn, shift = numpy.array(matrix.to_3x3()), numpy.array(matrix.translation)
        world = points.reshape(-1, 3) @ turn.T + shift
        self.corners = corners.reshape(-1, 3)
        self.a, self.b, self.c = (world[self.corners[:, i]] for i in range(3))
        cross = numpy.cross(self.b - self.a, self.c - self.a)
        if numpy.linalg.det(turn) < 0:
            cross = -cross
        size = numpy.linalg.norm(cross, axis=1)
        self.area = size / 2
        self.normals = cross / numpy.where(size > 0, size, 1)[:, None]
        self.slopes = numpy.degrees(numpy.arccos(numpy.clip(self.normals[:, 2], -1, 1)))
        slots = [slot.material.name if slot.material else None for slot in obj.material_slots]
        self.material_names = [slot for slot in slots if slot]
        self.materials = [slots[m] if 0 <= m < len(slots) else None for m in materials[faces]]
        self.total = float(self.area.sum())
        need(self.total > 0, f"“{obj.name}” has no area to scatter onto.")
        self.low = float(min(self.a[:, 2].min(), self.b[:, 2].min(), self.c[:, 2].min()))
        self.high = float(max(self.a[:, 2].max(), self.b[:, 2].max(), self.c[:, 2].max()))

    def spread(self, rng, count, among=None):
        """`count` points at random, evenly by area over the triangles (or those `among`): each triangle, point and corner weights."""
        area = self.area if among is None else numpy.where(among, self.area, 0)
        cumulative = numpy.cumsum(area)
        picks = numpy.searchsorted(cumulative, numpy.array([rng.random() for _ in range(count)]) * cumulative[-1], side="right")
        picks = numpy.minimum(picks, len(area) - 1)
        root = numpy.sqrt(numpy.array([rng.random() for _ in range(count)]))
        second = numpy.array([rng.random() for _ in range(count)])
        weights = numpy.stack([1 - root, root * (1 - second), root * second], axis=1)
        points = (
            self.a[picks] * weights[:, :1] + self.b[picks] * weights[:, 1:2] + self.c[picks] * weights[:, 2:]
        )
        return picks, points, weights


class Distances:
    """How far a point is from some objects' surfaces: 0 inside one."""

    def __init__(self, names, what):
        self.objects = find_objects(names)
        self.shapes = []
        for obj in self.objects:
            mesh = Mesh.of_object(obj)
            need(not mesh.empty, f"“{obj.name}” in {what} has no shape to measure from.")
            self.shapes.append(Shape(mesh, label=obj.name))
        self.words = listed([obj.name for obj in self.objects])
        # The nearest and farthest any point measured lay, for a rule that removed every one.
        self.seen = [math.inf, 0.0]

    def of(self, point):
        at = Vector(point)
        nearest = math.inf
        for shape in self.shapes:
            if any(shell.holds(at) for shell in shape.shells):
                nearest = 0.0
                break
            found = shape.surface.find_nearest(at)
            if found[0] is not None:
                nearest = min(nearest, found[3])
        self.seen = [min(self.seen[0], nearest), max(self.seen[1], nearest)]
        return nearest


def _range(value, name, low, high, unit):
    need(
        isinstance(value, list) and len(value) == 2 and all(is_number(v) for v in value) and value[0] <= value[1],
        f"{name} is [least, most]{unit}, the least first.",
    )
    if low is not None:
        need(value[0] >= low and value[1] <= high, f"{name} runs from {low} to {high}{unit}.")
    return float(value[0]), float(value[1])


def _distance_rule(value, name):
    need(isinstance(value, dict), f"{name} is {{objects, distance}}.")
    distance = value.get("distance")
    need(is_number(distance) and distance >= 0, f"{name} distance is in metres, from 0.")
    names = value.get("objects")
    need(isinstance(names, list) and names, f"{name} objects lists the objects to measure from.")
    return Distances(names, name), float(distance)


class Rules:
    """The where rules a scatter is given, each point put to them in turn."""

    def __init__(self, where, obj):
        where = where or {}
        need(isinstance(where, dict), "where is {material, vertex_group, slope, height, away_from, near}.")
        unknown = [key for key in where if key not in RULES]
        if unknown:
            raise Refused(f"where takes {listed(RULES)}, not {listed(unknown)}.")
        self.given = [rule for rule in RULES if where.get(rule) is not None]
        self.material = where.get("material")
        if self.material is not None:
            names = [slot.material.name for slot in obj.material_slots if slot.material]
            if self.material not in names:
                has = f"its materials are {listed(names)}" if names else "it has no materials"
                raise Refused(f"{obj.name} has no material named “{self.material}”; {has}.")
        self.group = where.get("vertex_group")
        if self.group is not None:
            groups = [group.name for group in obj.vertex_groups]
            if self.group not in groups:
                has = f"its vertex groups are {listed(groups)}" if groups else "it has no vertex groups"
                raise Refused(f"{obj.name} has no vertex group named “{self.group}”; {has}.")
        self.slope = _range(where["slope"], "slope", 0, 180, "°") if "slope" in self.given else None
        self.height = _range(where["height"], "height", None, None, " m") if "height" in self.given else None
        self.away = _distance_rule(where["away_from"], "away_from") if "away_from" in self.given else None
        self.near = _distance_rule(where["near"], "near") if "near" in self.given else None

    def face_kept(self, surface):
        """Which triangles the rules of faces keep: material and slope."""
        kept = numpy.ones(len(surface.area), dtype=bool)
        if self.material is not None:
            kept &= numpy.array([name == self.material for name in surface.materials])
        if self.slope is not None:
            kept &= (surface.slopes >= self.slope[0] - 1e-9) & (surface.slopes <= self.slope[1] + 1e-9)
        return kept

    def weight(self, surface, triangle, corners):
        return float(numpy.dot(surface.weights[surface.corners[triangle]], corners))

    def removed_by(self, surface, triangle, point, corners, rng):
        """The first rule that removes a point, or None when every rule keeps it."""
        if self.material is not None and surface.materials[triangle] != self.material:
            return "material"
        if self.group is not None and rng.random() >= self.weight(surface, triangle, corners):
            return "vertex_group"
        if self.slope is not None and not (self.slope[0] - 1e-9 <= surface.slopes[triangle] <= self.slope[1] + 1e-9):
            return "slope"
        if self.height is not None and not (self.height[0] <= point[2] <= self.height[1]):
            return "height"
        if self.away is not None and self.away[0].of(point) < self.away[1]:
            return "away_from"
        if self.near is not None and self.near[0].of(point) > self.near[1]:
            return "near"
        return None

    def area_left(self, surface):
        """The area the rules leave, and whether it is measured from points rather than whole faces."""
        kept = self.face_kept(surface)
        area = float(surface.area[kept].sum())
        if area <= 0 or (self.group is None and self.height is None and self.away is None and self.near is None):
            return area, False
        rng = random.Random(1)
        triangles, points, corners = surface.spread(rng, AREA_POINTS, kept)
        share = 0.0
        for triangle, point, weights in zip(triangles, points, corners):
            if self.height is not None and not (self.height[0] <= point[2] <= self.height[1]):
                continue
            if self.away is not None and self.away[0].of(point) < self.away[1]:
                continue
            if self.near is not None and self.near[0].of(point) > self.near[1]:
                continue
            share += self.weight(surface, triangle, weights) if self.group is not None else 1.0
        return area * share / AREA_POINTS, True

    def what_it_has(self, rule, surface):
        """What the surface offers a rule that removed every point, so the model can loosen it."""
        name = surface.name
        if rule == "material":
            return f"{name}'s materials are {listed(sorted(set(n for n in surface.materials if n)))}"
        if rule == "slope":
            shown = surface.slopes[surface.area > 0]
            return f"{name}'s faces slope from {shown.min():.3g}° to {shown.max():.3g}°"
        if rule == "height":
            return f"{name} runs from {length(surface.low)} to {length(surface.high)} high"
        if rule == "vertex_group":
            return f"the group's weights on {name} run from {surface.weights.min():.3g} to {surface.weights.max():.3g}"
        if rule == "away_from":
            return f"no point of {name} tried lies farther than {length(self.away[0].seen[1])} from {self.away[0].words}"
        return f"no point of {name} tried lies nearer than {length(self.near[0].seen[0])} to {self.near[0].words}"
