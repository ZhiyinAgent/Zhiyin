"""
The shape that wear and dirt follow, read two ways: as shader nodes, which draw a mark, and at
points sampled on the mesh, where rays cast in metres stand in for the shader's ambient
occlusion, which estimate where it lands without rendering. A mark's coverage is written once
against either kit, so both follow the same formula, but not the same noise: the shader draws
its patterns with its own Noise and Voronoi nodes, and the sampled points read Blender's Python
noise and number each cell from where its middle lies. The measure is statistical: over a whole
surface it comes close to the share the picture shows, and the marks fall in other places, so a
share on one small part can be off.

How closed in the shape is round a point is Blender's ambient occlusion: Cycles looks at the
whole scene, EEVEE only at what the camera sees, so an edge at the picture's border wears less in
EEVEE. Runs, the way water carries rust and dirt down from an edge, follow gravity as the object
stood when it was given the material: each mesh is told how far each of its points lies below
the highest point water can run from, along its surface, and which way down was, so streaks turn
with the object afterwards, as real ones do.
"""

import heapq
import math
import zlib

import mathutils
import mathutils.noise as noise_of

from .finishes import Graph

# Where a mesh keeps, for each point, 1 plus how far below the edge above it the point lies, in
# metres along the surface; 0 where it was never measured. And which way down was, on the object.
RUNS, DOWN = "zhiyin_runs", "zhiyin_down"


class Shaped(Graph):
    """A material's nodes, with the shape round each point as a mark reads it."""

    def __init__(self, material):
        super().__init__(material)
        self.made = {}

    def once(self, key, make):
        if key not in self.made:
            self.made[key] = make()
        return self.made[key]

    def closed(self, reach, inside):
        """How closed in the shape is round each point, 0 where nothing is near: from outside, or from within for edges."""

        def make():
            occlusion = self.node("ShaderNodeAmbientOcclusion", inside=inside)
            occlusion.inputs["Distance"].default_value = reach
            return self.math("SUBTRACT", 1, occlusion.outputs["AO"])

        return self.once(("closed", reach, inside), make)

    def up(self):
        """How far the surface faces up in the scene, -1 to 1."""
        return self.once("up", lambda: self.parts(self.node("ShaderNodeNewGeometry").outputs["Normal"])[2])

    def runs(self):
        """Whether the point's mesh was measured for runs, and how far below the edge above it the point lies."""

        def make():
            told = self.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name=RUNS).outputs["Fac"]
            return self.math("GREATER_THAN", told, 0.5), self.math("SUBTRACT", told, 1)

        return self.once("runs", make)

    def down(self):
        return self.once(
            "down", lambda: self.node("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name=DOWN).outputs["Vector"]
        )


def _fbm(point, detail, roughness):
    """Blender's normalised fractal noise around 0.5, as its Noise Texture gives it."""
    whole = int(detail)
    total, amplitude, sum_of, frequency = 0.0, 1.0, 0.0, 1.0
    for _ in range(whole + 1):
        total += amplitude * noise_of.noise(point * frequency, noise_basis="PERLIN_NEW")
        sum_of += amplitude
        amplitude *= roughness
        frequency *= 2
    part = detail - whole
    if part > 0:
        # A fraction of the next octave, as the shader blends it in.
        finer = total + amplitude * noise_of.noise(point * frequency, noise_basis="PERLIN_NEW")
        return 0.5 + 0.5 * ((1 - part) * total / sum_of + part * finer / (sum_of + amplitude))
    return 0.5 + 0.5 * total / sum_of


OPERATIONS = {
    "ADD": lambda a, b=0, c=0: a + b,
    "SUBTRACT": lambda a, b=0, c=0: a - b,
    "MULTIPLY": lambda a, b=0, c=0: a * b,
    "DIVIDE": lambda a, b=0, c=0: a / b if b else 0.0,
    "MULTIPLY_ADD": lambda a, b=0, c=0: a * b + c,
    "POWER": lambda a, b=0, c=0: a**b if a >= 0 or float(b).is_integer() else 0.0,
    "SQRT": lambda a, b=0, c=0: math.sqrt(a) if a > 0 else 0.0,
    "ABSOLUTE": lambda a, b=0, c=0: abs(a),
    "MAXIMUM": lambda a, b=0, c=0: max(a, b),
    "MINIMUM": lambda a, b=0, c=0: min(a, b),
    "GREATER_THAN": lambda a, b=0, c=0: 1.0 if a > b else 0.0,
    "LESS_THAN": lambda a, b=0, c=0: 1.0 if a < b else 0.0,
    "SINE": lambda a, b=0, c=0: math.sin(a),
    "COSINE": lambda a, b=0, c=0: math.cos(a),
    "FLOOR": lambda a, b=0, c=0: math.floor(a),
    "FRACT": lambda a, b=0, c=0: a - math.floor(a),
}


class Point:
    """What a sampled point holds: where it is, which way it faces, and the rays cast from it."""

    def __init__(self, at, normal, inside, outside, runs, down):
        # Metres in the object's own frame; the world normal; how far each ray from within and
        # from outside went before it met a surface (inf when it met none); the runs told.
        self.at, self.normal, self.inside, self.outside, self.told, self.down = at, normal, inside, outside, runs, down


class Sampled:
    """The kit a mark's coverage is written against, on one sampled point, in plain numbers."""

    def __init__(self, point):
        self.point = point

    def math(self, operation, *values, clamp=False):
        found = float(OPERATIONS[operation](*values))
        return min(1.0, max(0.0, found)) if clamp else found

    def vector(self, operation, *values):
        a = mathutils.Vector(values[0])
        if operation == "SCALE":
            return a * values[1]
        if operation == "LENGTH":
            return a.length
        b = mathutils.Vector(values[1])
        if operation == "DOT_PRODUCT":
            return a.dot(b)
        if operation == "ADD":
            return a + b
        if operation == "SUBTRACT":
            return a - b
        if operation == "MULTIPLY":
            return mathutils.Vector([x * y for x, y in zip(a, b)])
        raise ValueError(operation)

    def step(self, value, low, high):
        if high <= low:
            return 1.0 if value >= high else 0.0
        t = min(1.0, max(0.0, (value - low) / (high - low)))
        return t * t * (3 - 2 * t)

    def mix(self, factor, a, b, kind="FLOAT"):
        factor = min(1.0, max(0.0, factor))
        return a + (b - a) * factor

    def noise(self, at, size, detail=2.0, roughness=0.5, distortion=0.0):
        return _fbm(mathutils.Vector(at) / size, detail, roughness)

    def cell(self, at, size, feature="F1"):
        distances, points = noise_of.voronoi(mathutils.Vector(at) / size, distance_metric="DISTANCE")
        # Each cell's own number, from where its middle lies.
        middle = points[0]
        key = f"{middle.x:.4f},{middle.y:.4f},{middle.z:.4f}".encode()
        return distances[0], (zlib.crc32(key) & 0xFFFFFF) / 0xFFFFFF

    def cells(self, at, size):
        return self.cell(at, size)[0]

    def closed(self, reach, inside):
        rays = self.point.inside if inside else self.point.outside
        return sum(1 for far in rays if far < reach) / len(rays)

    def up(self):
        return self.point.normal.z

    def runs(self):
        told = self.point.told
        return (1.0 if told > 0.5 else 0.0), told - 1

    def down(self):
        return self.point.down


def steep(k):
    """1 on a wall, where water runs down, fading to 0 on faces that look up or down."""
    return k.math("SUBTRACT", 1, k.step(k.math("ABSOLUTE", k.up()), 0.6, 0.85))


def run_from_edges(k, reach):
    """1 on a wall just below the edge water runs from, fading to 0 `reach` metres further down."""
    laid, below = k.runs()
    fading = k.math("SUBTRACT", 1, k.math("DIVIDE", below, reach), clamp=True)
    return k.math("MULTIPLY", k.math("MULTIPLY", laid, fading), steep(k))


def streaked(k, at, across, along):
    """The point stretched along the way down: noise read here shows streaks `across` wide and `along` long."""
    down = k.down()
    depth = k.vector("DOT_PRODUCT", at, down)
    flat = k.vector("SUBTRACT", at, k.vector("SCALE", down, depth))
    return k.vector("ADD", k.vector("SCALE", flat, 1 / across), k.vector("SCALE", down, k.math("DIVIDE", depth, along)))


def down_on(obj):
    """Which way down the scene is, as a unit step in the object's own frame in metres."""
    turned = obj.matrix_world.to_3x3()
    local = turned.inverted_safe() @ mathutils.Vector((0, 0, -1))
    # The object's frame in metres runs through its scale: a step along an axis is that long.
    metres = mathutils.Vector([local[i] * turned.col[i].length for i in range(3)])
    return metres.normalized() if metres.length > 0 else mathutils.Vector((0, 0, -1))


def lay_runs(obj):
    """
    Tells a mesh how far below the edge above it each of its points lies, along its surface, as it
    stands now: from each point that nothing of the mesh rises above, downward or level along its
    edges. Answers the most any point lies below.
    """
    mesh = obj.data
    world = obj.matrix_world
    places = [world @ v.co for v in mesh.vertices]
    near = [[] for _ in places]
    for edge in mesh.edges:
        a, b = edge.vertices
        near[a].append(b)
        near[b].append(a)
    level = 1e-6
    below = [math.inf] * len(places)
    queue = []
    for i, place in enumerate(places):
        if not any(places[j].z > place.z + level for j in near[i]):
            below[i] = 0.0
            queue.append((0.0, i))
    heapq.heapify(queue)
    while queue:
        far, i = heapq.heappop(queue)
        if far > below[i]:
            continue
        for j in near[i]:
            if places[j].z > places[i].z + level:
                continue
            onward = far + (places[j] - places[i]).length
            if onward < below[j]:
                below[j] = onward
                heapq.heappush(queue, (onward, j))
    told = mesh.attributes.get(RUNS)
    if told is not None and (told.domain != "POINT" or told.data_type != "FLOAT"):
        mesh.attributes.remove(told)
        told = None
    if told is None:
        told = mesh.attributes.new(RUNS, "FLOAT", "POINT")
    told.data.foreach_set("value", [1 + (far if math.isfinite(far) else 0.0) for far in below])
    obj[DOWN] = list(down_on(obj))
    mesh.update()
    return max((far for far in below if math.isfinite(far)), default=0.0)
