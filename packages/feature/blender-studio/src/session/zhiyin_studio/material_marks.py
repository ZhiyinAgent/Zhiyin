"""
What a material carries that the session reads back: the wood, finish, wear, grime and other marks
it was given, and whether it lets light through.
"""


# A material with the wood finish holds its amount in a node of this name.
WOOD = "Zhiyin wood"


def wood_of(material):
    """How much grain a material was given as wood, or 0."""
    if material is None or not material.use_nodes or material.node_tree is None:
        return 0
    node = material.node_tree.nodes.get(WOOD)
    return node.outputs[0].default_value if node is not None else 0


# A material with a finish holds its name in the label of a node of this
# name, how it was drawn in the label of another, and its amounts of wear,
# grime and each other mark in nodes of these.
FINISH, FINISH_DRAWN = "Zhiyin finish", "Zhiyin finish drawn"
WEAR, GRIME = "Zhiyin wear", "Zhiyin grime"
RUST, DUST, SCRATCHES, DRIPS, FINGERPRINTS = (
    "Zhiyin rust",
    "Zhiyin dust",
    "Zhiyin scratches",
    "Zhiyin drips",
    "Zhiyin fingerprints",
)
# Each other mark as the scene's description names it.
OTHER_MARKS = {RUST: "rust", SCRATCHES: "scratches", DRIPS: "drip streaks", DUST: "dust", FINGERPRINTS: "fingerprints"}


def finish_of(material):
    """The finish a material was given, or nothing, and its amounts of wear and grime, or 0."""
    if material is None or not material.use_nodes or material.node_tree is None:
        return None, 0, 0
    nodes = material.node_tree.nodes
    named = nodes.get(FINISH)
    wear, grime = (nodes.get(name) for name in (WEAR, GRIME))
    return (
        named.label if named is not None else None,
        wear.outputs[0].default_value if wear is not None else 0,
        grime.outputs[0].default_value if grime is not None else 0,
    )


def marks_said(material):
    """
    What a material carries beyond its finish, wear and grime, as the scene's description says it:
    how its finish was drawn, such as which way metal is brushed, and each other mark by its amount.
    """
    if material is None or not material.use_nodes or material.node_tree is None:
        return []
    nodes = material.node_tree.nodes
    drawn = nodes.get(FINISH_DRAWN)
    said = [drawn.label] if drawn is not None else []
    for name, label in OTHER_MARKS.items():
        node = nodes.get(name)
        if node is not None:
            said.append(f"{label} {node.outputs[0].default_value:.3g}")
    return said


def lets_light_through(obj):
    """Whether an object lets light through it, as glass or a liquid does."""
    for slot in getattr(obj, "material_slots", []):
        material = slot.material
        nodes = material.node_tree.nodes if material and material.use_nodes and material.node_tree else []
        surface = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if surface is not None and surface.inputs["Transmission Weight"].default_value > 0:
            return True
    return False
