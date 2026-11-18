"""
A subdivision cage as a modeller reads it before smoothing it: its faces by their sides, the points
where other than four edges meet inside it (its poles) by how many, the edges it creases, and how
far its edges run from the shortest to the longest. Each kind is counted with one place it is at.
"""

import bpy

from .shaping_measure import evaluated_mesh
from .soundness import MOST_FACES
from .wording import length, point_text

CREASE = "crease_edge"
# Points of more than this many edges are counted together.
MOST_EDGES = 6


def _counted(count, one, many=None):
    return f"{count:,} {one if count == 1 else many or one + 's'}"


def faces_said(bm):
    quads = sum(1 for f in bm.faces if len(f.verts) == 4)
    triangles = [f for f in bm.faces if len(f.verts) == 3]
    many = [f for f in bm.faces if len(f.verts) > 4]
    said = [_counted(quads, "quad")]
    if triangles:
        said.append(f"{_counted(len(triangles), 'triangle')}, as at {point_text(triangles[0].calc_center_median())}")
    if many:
        largest = max(many, key=lambda f: len(f.verts))
        said.append(
            f"{_counted(len(many), 'face')} of more than four sides, the largest of {len(largest.verts)} at"
            f" {point_text(largest.calc_center_median())}"
        )
    if not triangles and not many:
        said.append("no triangles or faces of more than four sides")
    return ", ".join(said)


def poles_said(bm):
    """The points inside the cage where 3, 5, or 6 or more edges meet, each count with one place."""
    poles = {}
    for v in bm.verts:
        if v.is_boundary or not v.link_faces:
            continue
        edges = len(v.link_edges)
        if edges != 4:
            poles.setdefault(min(edges, MOST_EDGES), []).append(v.co)
    if not poles:
        return "no poles: four edges meet at every point inside it"
    said = []
    for edges in sorted(poles):
        found = poles[edges]
        many = f"{edges} or more" if edges == MOST_EDGES else str(edges)
        said.append(f"{_counted(len(found), 'point')} where {many} edges meet, as at {point_text(found[0])}")
    return "poles: " + ", ".join(said)


def creases_said(bm):
    layer = bm.edges.layers.float.get(CREASE)
    values = [e[layer] for e in bm.edges if e[layer] > 0] if layer is not None else []
    if not values:
        return "no edge creased"
    low, high = min(values), max(values)
    how = f"crease {high:g}" if high - low < 1e-6 else f"creases {low:g} to {high:g}"
    return f"{_counted(len(values), 'edge')} creased ({how}), which it holds"


def lengths_said(bm):
    lengths = [e.calc_length() for e in bm.edges]
    lengths = [value for value in lengths if value > 0]
    if not lengths:
        return None
    short, long = min(lengths), max(lengths)
    if long <= short * 1.01:
        return f"edges all {length(long)} long"
    return f"edges from {length(short)} to {length(long)} long, the longest {long / short:.3g} times the shortest"


def cage_text(obj):
    """The cage of a subdivision about to be added, as its steps leave it, in the world."""
    bpy.context.view_layer.update()
    bm = evaluated_mesh(obj, world=True)
    try:
        if not bm.faces:
            return "its cage has no faces"
        if len(bm.faces) > MOST_FACES:
            return f"its cage's {len(bm.faces):,} faces are more than the {MOST_FACES:,} a cage is read to"
        parts = [faces_said(bm), poles_said(bm), creases_said(bm), lengths_said(bm)]
    finally:
        bm.free()
    return "its cage: " + "; ".join(p for p in parts if p)
