"""
Finishes: real surfaces drawn in a material at their real size, with nothing
to unwrap and no picture to keep. This holds what each finish is when a call
gives none of its values, and the kit every finish is drawn with; the
finishes themselves are drawn by the finishes_* modules.

Everything is drawn in metres on the object itself: in its own frame, so the
pattern moves and turns with it, and through its scale, so grain of a
fraction of a millimetre is that size on an engine block and on a bracket
alike. Each object is offset by its own random number, so two copies of a
part never show the same grain.
"""

from typing import NamedTuple

import bpy

from .material_marks import FINISH
from .wording import length


class Finish(NamedTuple):
    """What a finish is when the call gives none of these: its colour, metal, roughness, clear coat and transmission."""

    colour: str
    metallic: float
    roughness: float
    coat: float
    # Whether its worn edges show polished metal ("metal"), the bare steel
    # under paint ("paint"), or the same surface rubbed smoother ("plain").
    wears_as: str
    shows: str
    transmission: float = 0.0


FINISHES = {
    "cast-aluminium": Finish("#b4b6b9", 1, 0.55, 0, "metal", "a sand-cast skin of fine grain"),
    "cast-iron": Finish("#55565a", 1, 0.7, 0, "metal", "a coarse cast grain with pits"),
    "machined-metal": Finish("#c6c8cb", 1, 0.28, 0, "metal", "a smooth machined face"),
    "brushed-metal": Finish("#c3c5c8", 1, 0.3, 0, "metal", "fine brushed lines"),
    "painted-metal": Finish("#7a7d82", 0, 0.4, 1, "paint", "paint under a clear coat, with a slight orange peel"),
    "plated-steel": Finish("#d4d6d9", 1, 0.12, 0, "metal", "bright plating"),
    "heat-tinted-steel": Finish("#8f8d8a", 1, 0.32, 0, "metal", "straw, bronze and blue heat tints"),
    "anodised-aluminium": Finish(
        "#b6babe", 1, 0.38, 0, "metal", "a satin anodised skin over fine bead blasting, dyed in its colour"
    ),
    "galvanised-steel": Finish("#b8bcbf", 1, 0.36, 0, "metal", "zinc spangle in crystals about 8 mm across"),
    "car-paint": Finish(
        "#1f3a5f", 0, 0.4, 1, "paint", "metallic flakes 0.15 mm across in a coloured base, under a clear coat"
    ),
    "carbon-fibre": Finish(
        "#141518", 0, 0.32, 1, "plain", "a 2 × 2 twill of 2.5 mm tows under clear resin"
    ),
    "textured-plastic": Finish("#1e1e20", 0, 0.6, 0, "plain", "a moulded stipple"),
    "rubber": Finish("#161616", 0, 0.65, 0, "plain", "soft, nearly matt rubber"),
    "braided-steel": Finish("#b9bbbe", 1, 0.3, 0, "metal", "a woven wire braid"),
    "leather": Finish("#5a3a26", 0, 0.5, 0, "plain", "a pebbled grain with creases, and a soft sheen"),
    "fabric": Finish("#5f6b7a", 0, 0.85, 0, "plain", "a plain weave of 0.5 mm threads, with a sheen"),
    "knit": Finish("#7d7f86", 0, 0.9, 0, "plain", "rows of knitted stitches 3 mm wide, soft and fuzzy"),
    "ceramic-glaze": Finish("#efece4", 0, 0.4, 1, "plain", "a glossy glaze over the body, pooling unevenly"),
    "concrete": Finish("#8f8c86", 0, 0.9, 0, "plain", "cast concrete with pores and pale and dark patches"),
    "stone": Finish("#8a847b", 0, 0.5, 0, "plain", "a speckled granite of mineral grains a few millimetres across"),
    "marble": Finish("#ebe8e2", 0, 0.12, 0, "plain", "polished marble with grey veins"),
    "frosted-glass": Finish("#f2f5f6", 0, 0.4, 0, "plain", "etched glass that lets light through, blurred", 1.0),
    "paper": Finish("#f2f0ea", 0, 0.85, 0, "plain", "fine fibres, matt"),
    "cardboard": Finish("#b08a5c", 0, 0.88, 0, "plain", "kraft board with dark fibres and specks"),
    "skin": Finish("#c68e6e", 0, 0.45, 0, "plain", "pores and fine lines, light scattering under it"),
}
# What a material with no finish is when the call gives nothing: Blender's own defaults.
PLAIN = Finish("#cccccc", 0, 0.5, 0, "", "")


class Drawing(NamedTuple):
    """What a finish is drawn for: the values the call gave, and the objects it is drawn on."""

    values: dict
    targets: list


class Graph:
    """Builds a material's nodes: each input is a number, a vector or a socket, and each answer a socket."""

    def __init__(self, material):
        self.nodes, self.links = material.node_tree.nodes, material.node_tree.links

    def node(self, kind, **settings):
        made = self.nodes.new(kind)
        for name, value in settings.items():
            setattr(made, name, value)
        return made

    def into(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.links.new(value, socket)
        else:
            socket.default_value = value

    def math(self, operation, *values, clamp=False):
        made = self.node("ShaderNodeMath", operation=operation, use_clamp=clamp)
        for at, value in enumerate(values):
            self.into(made.inputs[at], value)
        return made.outputs[0]

    def vector(self, operation, *values):
        made = self.node("ShaderNodeVectorMath", operation=operation)
        if operation == "SCALE":
            self.into(made.inputs[0], values[0])
            self.into(made.inputs["Scale"], values[1])
        else:
            for at, value in enumerate(values):
                self.into(made.inputs[at], value)
        return made.outputs["Value" if operation in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else "Vector"]

    def parts(self, vector):
        made = self.node("ShaderNodeSeparateXYZ")
        self.into(made.inputs[0], vector)
        return made.outputs["X"], made.outputs["Y"], made.outputs["Z"]

    def join(self, x, y, z):
        made = self.node("ShaderNodeCombineXYZ")
        for socket, value in zip(made.inputs, (x, y, z)):
            self.into(socket, value)
        return made.outputs[0]

    def mix(self, factor, a, b, kind="RGBA"):
        """a where factor is 0, b where it is 1: colours, or numbers with kind FLOAT."""
        made = self.node("ShaderNodeMix", data_type=kind, clamp_factor=True)
        sockets = {socket.identifier: socket for socket in made.inputs}
        suffix = {"RGBA": "Color", "FLOAT": "Float", "VECTOR": "Vector"}[kind]
        self.into(sockets["Factor_Float"], factor)
        self.into(sockets[f"A_{suffix}"], a)
        self.into(sockets[f"B_{suffix}"], b)
        return next(socket for socket in made.outputs if socket.type == {"RGBA": "RGBA", "FLOAT": "VALUE"}.get(kind, "VECTOR"))

    def step(self, value, low, high):
        """0 below low, 1 above high, smoothly between."""
        made = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self.into(made.inputs["Value"], value)
        self.into(made.inputs["From Min"], low)
        self.into(made.inputs["From Max"], high)
        return made.outputs["Result"]

    def noise(self, at, size, detail=2.0, roughness=0.5, distortion=0.0):
        """Noise around 0.5 whose features are about `size` metres across."""
        made = self.node("ShaderNodeTexNoise", noise_dimensions="3D")
        self.into(made.inputs["Vector"], at)
        made.inputs["Scale"].default_value = 1 / size
        made.inputs["Detail"].default_value = detail
        made.inputs["Roughness"].default_value = roughness
        made.inputs["Distortion"].default_value = distortion
        return made.outputs["Fac"]

    def cells(self, at, size):
        """How far each point is from the middle of its cell, cells about `size` metres across: 0 to about 1."""
        made = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="F1")
        self.into(made.inputs["Vector"], at)
        made.inputs["Scale"].default_value = 1 / size
        return made.outputs["Distance"]

    def cell(self, at, size, feature="F1"):
        """A cell about `size` metres across: how far the point is from its middle (or edge), and its own random number."""
        made = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature=feature)
        self.into(made.inputs["Vector"], at)
        made.inputs["Scale"].default_value = 1 / size
        return made.outputs["Distance"], self.parts(made.outputs["Color"])[0]

    def cell_edges(self, at, size):
        """How far each point is from the edge of its cell, in cells about `size` metres across: 0 on the edge."""
        made = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="DISTANCE_TO_EDGE")
        self.into(made.inputs["Vector"], at)
        made.inputs["Scale"].default_value = 1 / size
        return made.outputs["Distance"]

    def tones(self, factor, base, dark, light, warm=1.0):
        """The base colour from `dark` times it to `light` times it, the dark end a little warmer by `warm`."""
        low = (base[0] * dark, base[1] * dark * warm, base[2] * dark * warm**2, 1)
        high = (min(1, base[0] * light), min(1, base[1] * light), min(1, base[2] * light), 1)
        return self.mix(factor, low, high)

    def own(self, axis):
        """A direction in the object's own frame, as it lies in the scene."""
        turned = self.node("ShaderNodeVectorTransform", vector_type="VECTOR", convert_from="OBJECT", convert_to="WORLD")
        self.into(turned.inputs["Vector"], axis)
        return turned.outputs["Vector"]


def source(graph, socket):
    """What a shader input is now: the socket that feeds it, unlinked from it, or its own value."""
    if socket.is_linked:
        link = socket.links[0]
        feeding = link.from_socket
        graph.links.remove(link)
        return feeding
    value = socket.default_value
    return tuple(value) if hasattr(value, "__len__") else value


def metres(graph):
    """The point being drawn in metres, in the object's own frame, offset by the object's own random number."""
    own = graph.node("ShaderNodeTexCoord").outputs["Object"]
    reach = []
    for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
        # A step along one of the object's own axes, as long as it is in the scene.
        reach.append(graph.vector("LENGTH", graph.own(axis)))
    placed = graph.vector("MULTIPLY", own, graph.join(*reach))
    random = graph.node("ShaderNodeObjectInfo").outputs["Random"]
    # Up to a metre: far enough that no two objects share their grain, near
    # enough that a fine grain keeps its detail in the renderer's numbers.
    return graph.vector("ADD", placed, graph.vector("SCALE", (0.37, 0.59, 0.83), random))


def mark(graph, name, value, label=""):
    marker = graph.node("ShaderNodeValue", name=name, label=label or name)
    marker.outputs[0].default_value = value


def mottle(graph, at, roughness, size, spread):
    """A roughness that wanders by `spread` either side of the one given, over patches about `size` across."""
    return graph.math("MULTIPLY_ADD", graph.noise(at, size, 3), 2 * spread, roughness - spread, clamp=True)


# What a Principled BSDF is, for the inputs only a finish sets, until a finish sets them.
UNSET = {
    "Anisotropic": 0.0,
    "Anisotropic Rotation": 0.0,
    "Sheen Weight": 0.0,
    "Sheen Roughness": 0.5,
    "Sheen Tint": (1.0, 1.0, 1.0, 1.0),
}
SUBSURFACE_UNSET = {"Subsurface Weight": 0.0, "Subsurface Radius": (1.0, 0.2, 0.1), "Subsurface Scale": 0.05}


def unset(shader, values):
    """
    Undoes what a finish set before on a shader set again, which keeps its inputs: anisotropy and
    sheen, and the scattering when the call gives none of its own.
    """
    inputs = shader.inputs
    for key, value in UNSET.items():
        inputs[key].default_value = value
    if values.get("subsurface") is None:
        for key, value in SUBSURFACE_UNSET.items():
            inputs[key].default_value = value


def finish(material, shader, name, base, roughness, draw, drawing):
    """
    Draws a finish into the material in the colour given, around the roughness
    given, and answers what the answer says of it beyond what it shows.
    """
    inputs = shader.inputs
    graph = Graph(material)
    mark(graph, FINISH, 1, name)
    at = metres(graph)
    drawn = draw(graph, at, base, roughness, drawing)
    graph.into(inputs["Base Color"], drawn["colour"])
    graph.into(inputs["Roughness"], drawn["roughness"])
    for key, value in drawn.get("inputs", {}).items():
        if key.startswith("Subsurface") and drawing.values.get("subsurface") is not None:
            # Scattering the call gives is its own.
            continue
        graph.into(inputs[key], value)
    # What is drawn keeps the values given, which the scene's description reads.
    inputs["Base Color"].default_value = base
    inputs["Roughness"].default_value = roughness
    bump = graph.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1
    bump.inputs["Distance"].default_value = 1
    graph.into(bump.inputs["Height"], drawn["height"])
    # A normal map already given lies under the finish's own relief.
    if inputs["Normal"].is_linked:
        graph.into(bump.inputs["Normal"], source(graph, inputs["Normal"]))
    relief = bump.outputs["Normal"]
    # The coat lies smooth over what tilts under it, as flakes do under a car's lacquer.
    tilted = drawn.get("tilt")
    under = graph.vector("NORMALIZE", graph.vector("ADD", relief, tilted)) if tilted is not None else relief
    graph.links.new(under, inputs["Normal"])
    graph.links.new(relief, inputs["Coat Normal"])
    return drawn.get("said", [])


def scattering(drawing, radius, scale):
    """
    Light scattering under a finish, as far as `radius` times `scale` metres in each of red, green
    and blue: the inputs that draw it, and what the answer says of it against the thinnest side of
    the objects it is drawn on, which it shows through when it reaches across half of it.
    """
    deepest = max(radius) * scale
    thinnest = min(drawing.targets, key=lambda obj: min(obj.dimensions))
    side = min(thinnest.dimensions)
    said = (
        f"light scattering up to {length(deepest)} under its surface in Cycles, which EEVEE only approximates; "
        f"{thinnest.name}'s thinnest side is {length(side)}"
    )
    if side < 2 * deepest:
        said += ", so the light shows through it"
    inputs = {"Subsurface Weight": 1.0, "Subsurface Radius": radius, "Subsurface Scale": scale}
    return inputs, said
