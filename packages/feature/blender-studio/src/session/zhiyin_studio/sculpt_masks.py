"""
Sculpt masks are vertex groups: a pick's points given a weight, softened over rings of their
neighbours or turned inside out, so that a brush or filter given the group as its mask holds
those points back by their weight.
"""

from .arguments import need, number, whole
from .mesh_edits import taken
from .reports import report


def picked_points(obj, picked):
    """The points a pick holds: its own, or the corners of its faces or edges."""
    if picked.kind == "verts":
        return set(picked.indices)
    held = obj.data.polygons if picked.kind == "faces" else obj.data.edges
    return {i for index in picked.indices for i in held[index].vertices}


def neighbours(obj):
    found = {v.index: set() for v in obj.data.vertices}
    for e in obj.data.edges:
        a, b = e.vertices
        found[a].add(b)
        found[b].add(a)
    return found


def sculpt_mask(picked, name="Mask", *, weight=1, blur=0, invert=False):
    """
    Makes the vertex group `name` from a pick's points at `weight`, replacing a group of that name;
    with `blur`, the rings of neighbours round them take a weight falling off ring by ring; with
    `invert`, every other point takes it instead. Brushes and filters given mask=`name` hold those
    points back by their weight. Says how many points it holds, fully and partly.
    """
    obj = taken(picked, "sculpt_mask", ("faces", "edges", "verts"), lambda kind: "")
    need(isinstance(name, str) and name.strip(), "name must be a word to keep the mask by.")
    full = number(weight, "weight", minimum=0, maximum=1, default=1)
    need(full > 0, "weight must be more than 0.")
    rings = whole(blur, "blur", minimum=0, maximum=100, default=0)
    chosen = picked_points(obj, picked)
    weights = {i: full for i in chosen}
    if rings:
        joined = neighbours(obj)
        edge = set(chosen)
        for ring in range(1, rings + 1):
            nxt = {j for i in edge for j in joined[i]} - set(weights)
            for j in nxt:
                weights[j] = full * (1 - ring / (rings + 1))
            edge = nxt
    if invert:
        weights = {v.index: full - weights.get(v.index, 0.0) for v in obj.data.vertices}
        weights = {i: w for i, w in weights.items() if w > 0}
    old = obj.vertex_groups.get(name)
    if old is not None:
        obj.vertex_groups.remove(old)
    group = obj.vertex_groups.new(name=name)
    for i, w in weights.items():
        group.add([i], w, "REPLACE")
    fully = sum(1 for w in weights.values() if w >= full - 1e-9)
    partly = len(weights) - fully
    count = len(chosen)
    plural = "s" if count != 1 else ""
    said = (
        f"Masked the {fully} point{'s' if fully != 1 else ''} of {obj.name} outside a pick of {count} point{plural}"
        if invert
        else f"Masked {count} point{plural} of {obj.name}"
    )
    said += f" as “{name}”, at weight {full:g}"
    if rings:
        said += f", blurred over {rings} ring{'s' if rings != 1 else ''}: {partly} more point{'s' if partly != 1 else ''} partly"
    it = "it" if (fully if invert else count) == 1 and not partly else "them"
    report(f"{said}; brushes and filters given mask=“{name}” leave {it}.")
    return group
