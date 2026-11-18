"""
Some of a mesh's faces given a material, the rest keeping theirs: the faces facing a direction
within an angle, inside a box in the world, marked by a face attribute or a kept pick, or showing
one of its material slots, those meeting every condition given. The material goes in a slot of
its own on the mesh, and the answer says how many faces took it and their area in the world.
"""

import numpy

from .arguments import need
from .picking import DIRECTIONS, KEPT, conditions
from .wording import area_text

CONDITIONS = ("facing", "inside", "attribute", "slot")


def faces_spec(args):
    """The faces a call names, or None; refused when it names them by nothing, or with a CAD part's surfaces."""
    spec = args.get("faces")
    if spec is None:
        return None
    need(isinstance(spec, dict), "faces picks a mesh's faces by facing, inside, attribute or slot: the material they show now.")
    need(
        any(spec.get(key) is not None for key in CONDITIONS),
        "faces picks a mesh's faces by facing, inside, attribute or slot: give at least one of them.",
    )
    need(args.get("surface") is None, "give the material to a CAD part's surface or to faces picked, not both.")
    return spec


def words_of(spec):
    """The faces a call picks, in a few words, to name their material by."""
    found = []
    facing = spec.get("facing")
    if facing is not None:
        axis = next((name for name, way in DIRECTIONS.items() if isinstance(facing, list) and list(way) == facing), None)
        found.append(str(facing) if isinstance(facing, str) else axis or "sloping")
    if spec.get("inside") is not None:
        found.append("boxed")
    if spec.get("attribute") is not None:
        found.append(str(spec["attribute"]))
    if spec.get("slot") is not None:
        found.append(str(spec['slot']))
    return " ".join(found) + " faces"


def picked_faces(obj, spec):
    """The indices of a mesh's faces that meet every condition given, and the conditions in words; refused when none do."""
    need(obj.type == "MESH", f"faces picks a mesh's faces, and {obj.name} is not a mesh.")
    mesh = obj.data
    tests = conditions(obj, spec.get("facing"), spec.get("within"), None, None, spec.get("inside"), None, None, None)
    marked, words = None, [w for w, _ in tests]
    if spec.get("attribute") is not None:
        marked = attribute_faces(obj, spec["attribute"])
        words.append(f"marked {spec['attribute']}")
    slotted = None
    if spec.get("slot") is not None:
        slotted = slot_indices(obj, spec["slot"])
        words.append(f"showing {spec['slot']}")
    matrix = obj.matrix_world
    turn = matrix.to_3x3().inverted_safe().transposed()
    chosen = []
    for face in mesh.polygons:
        at, normal = matrix @ face.center, (turn @ face.normal).normalized()
        if marked is not None and not marked[face.index]:
            continue
        if slotted is not None and face.material_index not in slotted:
            continue
        if all(test(at, normal, None) for _, test in tests):
            chosen.append(face.index)
    said = " and ".join(words)
    need(chosen, f"None of {obj.name}'s {len(mesh.polygons)} faces is {said}.")
    return chosen, said


def attribute_faces(obj, name):
    """Whether each face is marked by a face attribute of that name, or a pick kept by it."""
    attributes = obj.data.attributes
    found = attributes.get(name) or attributes.get(KEPT + str(name))
    usable = [a.name.removeprefix(KEPT) for a in attributes if a.domain == "FACE" and not a.name.startswith(".")]
    need(
        found is not None and found.domain == "FACE",
        f"{obj.name} has no face attribute or kept pick named “{name}”."
        + (f" Its face attributes: {', '.join(usable)}." if usable else " It has none."),
    )
    kinds = {"BOOLEAN": bool, "FLOAT": numpy.float32, "INT": numpy.int32}
    need(
        found.data_type in kinds,
        f"{obj.name}'s attribute “{name}” holds {found.data_type.lower()} values: faces are marked by a true or false,"
        " or a number that is not 0.",
    )
    values = numpy.zeros(len(found.data), dtype=kinds[found.data_type])
    found.data.foreach_get("value", values)
    return values != 0


def slot_indices(obj, slot):
    """The slots showing the material a call names."""
    slots = obj.material_slots
    need(isinstance(slot, str) and slot, "faces slot names the material the faces show now.")
    named = {i for i, s in enumerate(slots) if s.material is not None and s.material.name == slot}
    shown = [s.material.name for s in slots if s.material is not None]
    need(named, f"{obj.name} shows no material named “{slot}”." + (f" It shows {', '.join(shown)}." if shown else ""))
    return named


def give_faces(material, obj, chosen):
    """Puts the material on the faces chosen, in a slot of its own; the slot it is in."""
    mesh = obj.data
    held = [i for i, s in enumerate(obj.material_slots) if s.material == material]
    if held:
        index = held[0]
    else:
        if not mesh.materials:
            # The faces not chosen keep what they showed: no material.
            mesh.materials.append(None)
        mesh.materials.append(material)
        index = len(mesh.materials) - 1
    indices = numpy.empty(len(mesh.polygons), dtype=numpy.int32)
    mesh.polygons.foreach_get("material_index", indices)
    indices[chosen] = index
    mesh.polygons.foreach_set("material_index", indices)
    mesh.update()
    return index


def area_said(obj, chosen):
    """The faces chosen as the answer says them: how many, their area in the world and their share of the surface."""
    areas = face_areas(obj)
    total, taken = float(areas.sum()), float(areas[chosen].sum())
    share = f", {taken / total:.0%} of its surface" if total > 0 else ""
    count = len(chosen)
    return f"{count} face{'s' if count != 1 else ''} of {obj.name}, {area_text(taken)}{share}"


def face_areas(obj):
    """Each face's area in the world, through the object's place, turn and scale."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    corners = numpy.empty(count * 3, dtype=numpy.int64)
    mesh.loop_triangles.foreach_get("vertices", corners)
    owners = numpy.empty(count, dtype=numpy.int64)
    mesh.loop_triangles.foreach_get("polygon_index", owners)
    co = numpy.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    matrix = numpy.array(obj.matrix_world)
    world = co.reshape(-1, 3) @ matrix[:3, :3].T
    a, b, c = (world[corners.reshape(-1, 3)[:, i]] for i in range(3))
    triangle = numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1) / 2
    areas = numpy.zeros(len(mesh.polygons))
    numpy.add.at(areas, owners, triangle)
    return areas
