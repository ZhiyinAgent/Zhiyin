"""
Which objects are still as blender_add_objects made them. Adding stamps each primitive with its
kind, a print of its mesh and the steps it gave it; describing compares. Moving, turning,
resizing and bevelling keep a shape as added, since a resized or rounded box is still a box; an
edit to its mesh, any other step added or taken away, shape keys or a join do not.
"""

import numpy

AS_ADDED = "zhiyin_as_added"

# The kinds adding makes as a mesh of its own, whose shape a model may go on to work: not a
# picture's card, lettering, a drawing, a model file or an instance.
STAMPED = (
    "cube",
    "box",
    "cylinder",
    "cone",
    "sphere",
    "icosphere",
    "quad_sphere",
    "plane",
    "grid",
    "circle",
    "torus",
    "monkey",
    "revolve",
    "outline",
    "tube",
)

# How far a print may stray and the mesh still be the same: well above what resizing a mesh's
# points in single precision moves them by, well below any edit a picture would show.
STRAY = 1e-5

# The most objects the line names.
NAMED = 40


def mesh_print(mesh):
    """
    A mesh's counts and the spread of its points, measured within its own box,
    so moving or resizing it along its own axes leaves the print as it was.
    """
    counts = [len(mesh.vertices), len(mesh.edges), len(mesh.polygons), len(mesh.loops)]
    if not mesh.vertices:
        return counts, []
    flat = numpy.empty(len(mesh.vertices) * 3, dtype=numpy.float32)
    mesh.vertices.foreach_get("co", flat)
    points = flat.reshape(-1, 3).astype(numpy.float64)
    low, high = points.min(axis=0), points.max(axis=0)
    reach = high - low
    reach[reach <= 1e-12] = 1.0
    unit = (points - low) / reach
    spread = list(unit.mean(axis=0))
    spread += [float((unit[:, i] * unit[:, j]).mean()) for i in range(3) for j in range(i, 3)]
    spread += list((unit**3).mean(axis=0))
    return counts, [float(v) for v in spread]


def steps_of(obj):
    return [m.type for m in obj.modifiers]


def stamp(obj, kind):
    """Records a primitive as adding made it."""
    if obj.type != "MESH" or kind not in STAMPED:
        return
    counts, spread = mesh_print(obj.data)
    obj[AS_ADDED] = {"kind": kind, "counts": counts, "spread": spread, "steps": steps_of(obj)}


def still_as_added(obj):
    """The kind an object was added as and its steps, while it is still as made; otherwise nothing."""
    made = obj.get(AS_ADDED)
    if made is None or obj.type != "MESH" or obj.data.shape_keys is not None:
        return None
    steps = steps_of(obj)
    # A bevel rounds a block-out shape's edges and keeps it one, whichever tool added it.
    if [s for s in steps if s != "BEVEL"] != [str(s) for s in made.get("steps", []) if str(s) != "BEVEL"]:
        return None
    counts, spread = mesh_print(obj.data)
    if counts != [int(c) for c in made.get("counts", [])]:
        return None
    kept = [float(v) for v in made.get("spread", [])]
    if len(kept) != len(spread) or any(abs(a - b) > STRAY for a, b in zip(kept, spread)):
        return None
    return str(made.get("kind")), steps


def as_added_text(objects):
    """
    The line naming the meshes still as adding made them, of the meshes
    described, or nothing when none is.
    """
    meshes = [o for o in objects if o.type == "MESH"]
    still = []
    for obj in meshes:
        found = still_as_added(obj)
        if found is not None:
            kind, steps = found
            still.append(f"{obj.name} ({', '.join([kind] + [s.lower().replace('_', ' ') for s in steps])})")
    if not still:
        return None
    named = ", ".join(still[:NAMED]) + (f" and {len(still) - NAMED} more" if len(still) > NAMED else "")
    return (
        f"Still as blender_add_objects made them ({len(still)} of {len(meshes)} meshes), their mesh unedited and no "
        f"step but a bevel added since; moving, turning and resizing keep a shape as added: {named}."
    )
