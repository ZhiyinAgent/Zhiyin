"""
Taking away what a pick took, as Blender's Delete and Dissolve do. Deleting faces, edges or points
removes them with what only they held and leaves holes, which it names by their edges; dissolving
removes them and joins the faces round them into larger ones, which it names by their sides. Each
says the faces, edges and points before and after, and hands back a pick of what it left.
"""

from collections import Counter

import bmesh

from .mesh_edits import changes, edge_runs, listed_counts, said, taken, tally, world_shape, write
from .picking import Picked, elements, spend
from .reports import report


def rims(shape):
    """Each loop of open edges, by the places of its points, with its edges."""
    found = {}
    for run, _, _ in edge_runs([e for e in shape.edges if e.is_boundary]):
        places = frozenset(tuple(round(c, 7) for c in v.co) for e in run for v in e.verts)
        found[places] = run
    return found


def holes_text(before, after):
    """The holes that are new, by how many edges each has."""
    opened = [len(run) for places, run in after.items() if places not in before]
    if not opened:
        return "it leaves no new hole"
    holes = "1 hole" if len(opened) == 1 else f"{len(opened)} holes"
    return f"it leaves {holes}, of {listed_counts(sorted(opened))} edges"


def sides(shape):
    """How many faces of each number of sides past four the mesh has."""
    return Counter(len(f.verts) for f in shape.faces if len(f.verts) > 4)


def ngons_text(before, after):
    """The faces of more than four sides there are more of, by their sides."""
    made = sorted((after - before).elements())
    if not made:
        return "it leaves no new n-gon"
    ngons = "1 n-gon" if len(made) == 1 else f"{len(made)} n-gons"
    return f"it leaves {ngons}, of {listed_counts(made)} sides"


def delete(picked):
    """
    Deletes the faces, edges or points picked, as Blender's Delete does: faces with the edges and
    points only they used, edges with the faces on them, points with every edge and face that
    meets them. Says the counts before and after and the holes it opened, and hands back a pick of
    the open edges round those holes.
    """
    obj = taken(picked, "delete", ("faces", "edges", "verts"), lambda kind: "delete takes faces, edges or points.")
    kind = picked.kind
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        rims_before = rims(shape)
        items = elements(shape, kind)
        chosen = [items[i] for i in picked.indices]
        ends = {v for e in chosen for v in e.verts} if kind == "edges" else set()
        bmesh.ops.delete(shape, geom=chosen, context={"faces": "FACES", "edges": "EDGES", "verts": "VERTS"}[kind])
        # Blender's Delete Edges leaves no point with nothing joined to it.
        loose = [v for v in ends if v.is_valid and not v.link_edges]
        if loose:
            bmesh.ops.delete(shape, geom=loose, context="VERTS")
        rims_after = rims(shape)
        opened = [e for places, run in rims_after.items() if places not in rims_before for e in run]
        after = tally(shape)
        text = holes_text(rims_before, rims_after)
        chosen_after = write(obj, shape, matrix, "edges", opened)
    finally:
        shape.free()
    report(f"Deleted {said(len(picked), kind)} of {obj.name}: {changes(before, after)}; {text}.")
    spend(picked, "delete")
    return Picked(obj, "edges", chosen_after)


def dissolve(picked):
    """
    Dissolves the faces, edges or points picked, as Blender's Dissolve does: faces into one face
    each region, edges and points by joining the faces on either side of them. Points left between
    only two edges go too. Says the counts before and after and the n-gons it made, and hands back
    a pick of the faces it joined.
    """
    obj = taken(picked, "dissolve", ("faces", "edges", "verts"), lambda kind: "dissolve takes faces, edges or points.")
    kind = picked.kind
    shape, matrix = world_shape(obj)
    try:
        before = tally(shape)
        sides_before = sides(shape)
        items = elements(shape, kind)
        chosen = [items[i] for i in picked.indices]
        if kind == "faces":
            made = bmesh.ops.dissolve_faces(shape, faces=chosen, use_verts=True)["region"]
        elif kind == "edges":
            made = bmesh.ops.dissolve_edges(shape, edges=chosen, use_verts=True, use_face_split=False)["region"]
        else:
            around = {e.other_vert(v) for v in chosen for e in v.link_edges} - set(chosen)
            bmesh.ops.dissolve_verts(shape, verts=chosen, use_face_split=False, use_boundary_tear=False)
            touching = Counter(f for v in around if v.is_valid for f in v.link_faces)
            made = [f for f, count in touching.items() if count > 1]
        text = ngons_text(sides_before, sides(shape))
        after = tally(shape)
        chosen_after = write(obj, shape, matrix, "faces", [f for f in made if f.is_valid])
    finally:
        shape.free()
    report(f"Dissolved {said(len(picked), kind)} of {obj.name}: {changes(before, after)}; {text}.")
    spend(picked, "dissolve")
    return Picked(obj, "faces", chosen_after)


FUNCTIONS = (delete, dissolve)
