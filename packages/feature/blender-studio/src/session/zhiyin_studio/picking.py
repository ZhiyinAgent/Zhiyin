"""
Picking a mesh's faces, edges or points by what they are, not by index: which way they face, where
they are in the world, what side of a plane, what material, grown by rings of neighbours. Every pick
says how many it took, their area and where they lie, and a pick that takes nothing is refused with
what each condition alone would have taken. A pick given a name is kept on the mesh, so a later
script can take it up again with zhiyin.picked.
"""

import math

import bmesh
import bpy
import mathutils

from .arguments import is_number, need, number, vector, whole
from .errors import Refused
from .finding import find_object
from .reports import report
from .wording import area_text, length

KINDS = {"faces": "FACE", "edges": "EDGE", "verts": "POINT"}
SINGULAR = {"faces": "face", "edges": "edge", "verts": "point"}
DIRECTIONS = {
    "+x": (1, 0, 0),
    "-x": (-1, 0, 0),
    "+y": (0, 1, 0),
    "-y": (0, -1, 0),
    "+z": (0, 0, 1),
    "-z": (0, 0, -1),
    "up": (0, 0, 1),
    "down": (0, 0, -1),
}
KEPT = "zhiyin_pick_"


def mesh_object(obj, what):
    """A mesh object, given as itself or by its name."""
    if isinstance(obj, str):
        obj = find_object(obj, kinds={"MESH"})
    need(isinstance(obj, bpy.types.Object) and obj.type == "MESH", f"{what} takes a mesh object or its name.")
    # A script that just placed it has not had its place worked out yet.
    bpy.context.view_layer.update()
    return obj


def direction(value, name):
    """A direction as +x, -z, up, down, or three numbers, made a unit vector."""
    if isinstance(value, str):
        need(value in DIRECTIONS, f"{name} must be one of {', '.join(DIRECTIONS)}, or three numbers.")
        return mathutils.Vector(DIRECTIONS[value])
    found = vector(value, name)
    need(found.length > 0, f"{name} must not be [0, 0, 0].")
    return found.normalized()


class Picked:
    """What a pick took: the object, the kind of element and their indices, in the mesh's order."""

    def __init__(self, obj, kind, indices, name=None):
        self.object = obj
        self.kind = kind
        self.indices = sorted(indices)
        self.name = name
        # The edit that changed the mesh under this pick, after which its indices name other elements.
        self.spent_by = None

    def __len__(self):
        return len(self.indices)

    def __iter__(self):
        return iter(self.indices)

    def __repr__(self):
        kept = f" “{self.name}”" if self.name else ""
        return f"<{len(self.indices)} {self.kind} of {self.object.name}{kept}>"


def unspent(picked):
    """Refuses a pick an edit has used: what it held has moved or is gone."""
    if picked.spent_by:
        raise Refused(
            f"This pick of {picked.object.name} was spent by {picked.spent_by}, which changed the mesh:"
            f" use what {picked.spent_by} returned, or pick again."
        )


def spend(picked, what):
    """Marks a pick as used by an edit that changed the mesh under it."""
    if isinstance(picked, Picked):
        picked.spent_by = what


def elements(shape, kind):
    shape.faces.ensure_lookup_table()
    shape.edges.ensure_lookup_table()
    shape.verts.ensure_lookup_table()
    return {"faces": shape.faces, "edges": shape.edges, "verts": shape.verts}[kind]


def place_of(element, kind, matrix, turn):
    """Where an element is in the world, and which way it faces."""
    if kind == "faces":
        return matrix @ element.calc_center_median(), (turn @ element.normal).normalized()
    if kind == "edges":
        middle = (element.verts[0].co + element.verts[1].co) / 2
        normals = [face.normal for face in element.link_faces]
        facing = sum(normals, mathutils.Vector()) if normals else mathutils.Vector()
        return matrix @ middle, (turn @ facing).normalized() if facing.length else facing
    return matrix @ element.co, (turn @ element.normal).normalized()


def conditions(obj, facing, within, above, below, inside, near, side_of, material):
    """Each condition as words and a test of one element's place, facing and material."""
    tests = []
    if facing is not None:
        towards = direction(facing, "facing")
        limit = math.radians(number(within, "within", minimum=0, maximum=180, default=15))
        said = facing if isinstance(facing, str) else "[" + ", ".join(f"{v:g}" for v in facing) + "]"
        tests.append(
            (
                f"facing {said} within {math.degrees(limit):g}°",
                lambda at, normal, element: normal.length > 0 and normal.angle(towards) <= limit + 1e-9,
            )
        )
    if above is not None:
        floor = number(above, "above")
        tests.append((f"above z {length(floor)}", lambda at, normal, element: at.z > floor - 1e-9))
    if below is not None:
        ceiling = number(below, "below")
        tests.append((f"below z {length(ceiling)}", lambda at, normal, element: at.z < ceiling + 1e-9))
    if inside is not None:
        need(
            isinstance(inside, (list, tuple)) and len(inside) == 2,
            "inside must be two corners: [[x, y, z], [x, y, z]].",
        )
        one, other = vector(inside[0], "inside's first corner"), vector(inside[1], "inside's second corner")
        low = mathutils.Vector([min(a, b) for a, b in zip(one, other)])
        high = mathutils.Vector([max(a, b) for a, b in zip(one, other)])
        tests.append(
            (
                "inside the box given",
                lambda at, normal, element: all(low[i] - 1e-9 <= at[i] <= high[i] + 1e-9 for i in range(3)),
            )
        )
    if near is not None:
        need(
            isinstance(near, (list, tuple)) and len(near) == 2 and is_number(near[1]),
            "near must be a point and a distance: [[x, y, z], metres].",
        )
        centre, reach = vector(near[0], "near's point"), number(near[1], "near's distance", minimum=0)
        tests.append(
            (
                f"within {length(reach)} of the point given",
                lambda at, normal, element: (at - centre).length <= reach + 1e-9,
            )
        )
    if side_of is not None:
        need(
            isinstance(side_of, (list, tuple)) and len(side_of) == 2,
            "side_of must be a point on the plane and the side it faces: [[x, y, z], [x, y, z]].",
        )
        on, out = vector(side_of[0], "side_of's point"), direction(side_of[1], "side_of's side")
        tests.append(
            (
                "on the side of the plane given",
                lambda at, normal, element: (at - on).dot(out) > 1e-9,
            )
        )
    if material is not None:
        need(isinstance(material, str) and material, "material must be a material's name.")
        slots = [i for i, slot in enumerate(obj.material_slots) if slot.material and slot.material.name == material]
        need(
            slots,
            f"{obj.name} has no material named “{material}”."
            + (
                " Its materials: " + ", ".join(s.material.name for s in obj.material_slots if s.material) + "."
                if any(s.material for s in obj.material_slots)
                else " It has none."
            ),
        )
        tests.append(
            (
                f"with {material}",
                lambda at, normal, element: element_material(element) in slots,
            )
        )
    return tests


def element_material(element):
    if isinstance(element, bmesh.types.BMFace):
        return element.material_index
    faces = element.link_faces
    return faces[0].material_index if faces else -1


def grown(shape, kind, chosen, rings):
    """The pick and `rings` rings of its neighbours, sharing an edge for faces and a point otherwise."""
    items = elements(shape, kind)
    taken = set(chosen)
    for _ in range(rings):
        more = set()
        for index in taken:
            element = items[index]
            if kind == "faces":
                more.update(f.index for e in element.edges for f in e.link_faces)
            elif kind == "edges":
                more.update(e.index for v in element.verts for e in v.link_edges)
            else:
                more.update(e.other_vert(element).index for e in element.link_edges)
        taken |= more
    return taken


def spread(places):
    """Where the places lie: x, y and z from lowest to highest."""
    lows = [min(p[i] for p in places) for i in range(3)]
    highs = [max(p[i] for p in places) for i in range(3)]
    return ", ".join(
        f"{axis} {length(low)}" if abs(high - low) < 1e-6 else f"{axis} {length(low)} to {length(high)}"
        for axis, low, high in zip("xyz", lows, highs)
    )


def keep(obj, shape, kind, chosen, name):
    """Selects what was picked, and keeps it under `name` when given one."""
    items = elements(shape, kind)
    for collection in (shape.verts, shape.edges, shape.faces):
        for item in collection:
            item.select = False
    for index in chosen:
        items[index].select = True
    shape.select_flush(True)
    shape.to_mesh(obj.data)
    obj.data.update()
    if name:
        key = KEPT + name
        attributes = obj.data.attributes
        if key in attributes:
            attributes.remove(attributes[key])
        attribute = attributes.new(key, "BOOLEAN", KINDS[kind])
        flags = [False] * len(attribute.data)
        for index in chosen:
            flags[index] = True
        attribute.data.foreach_set("value", flags)



def pick(
    obj,
    kind="faces",
    *,
    facing=None,
    within=15,
    above=None,
    below=None,
    inside=None,
    near=None,
    side_of=None,
    material=None,
    grow=0,
    name=None,
):
    """
    The mesh's faces, edges or verts that meet every condition given, in world space: facing a
    direction within an angle, above or below a height, inside a box, near a point, on one side
    of a plane, with a material; then grown by `grow` rings of neighbours. Selects them, keeps
    them as `name` when given one, and says how many it took and where they lie.
    """
    obj = mesh_object(obj, "pick")
    need(kind in KINDS, f"kind must be one of {', '.join(KINDS)}.")
    need(name is None or (isinstance(name, str) and name.strip()), "name must be a word to keep the pick by.")
    rings = whole(grow, "grow", minimum=0, maximum=100, default=0)
    tests = conditions(obj, facing, within, above, below, inside, near, side_of, material)
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        matrix = obj.matrix_world
        turn = matrix.to_3x3().inverted_safe().transposed()
        items = elements(shape, kind)
        places = [place_of(item, kind, matrix, turn) for item in items]
        chosen = [
            item.index
            for item, (at, normal) in zip(items, places)
            if all(test(at, normal, item) for _, test in tests)
        ]
        said = " and ".join(words for words, _ in tests) or "every one"
        if not chosen:
            raise Refused(nothing_matches(obj, kind, items, places, tests, said))
        if rings:
            chosen = sorted(grown(shape, kind, chosen, rings))
        area = sum(items[i].calc_area() for i in chosen) if kind == "faces" else None
        # What was taken spans its corners, not its centres.
        corners = [
            matrix @ v.co for i in chosen for v in ([items[i]] if kind == "verts" else items[i].verts)
        ]
        keep(obj, shape, kind, chosen, name)
    finally:
        shape.free()
    measured = [f"{area_text(area * scale_of(obj))}"] if area is not None else []
    measured.append(spread(corners))
    plural = kind if len(chosen) != 1 else SINGULAR[kind]
    report(
        f"Picked {len(chosen)} {plural} of {obj.name}, {said}"
        + (f", grown by {rings} ring{'s' if rings != 1 else ''}" if rings else "")
        + f": {'; '.join(measured)}"
        + (f"; kept as “{name}”." if name else ".")
    )
    return Picked(obj, kind, chosen, name)


def scale_of(obj):
    """How much the object's own areas grow in the world."""
    scale = obj.matrix_world.to_scale()
    return abs(scale.x * scale.y * scale.z) ** (2 / 3)


def nothing_matches(obj, kind, items, places, tests, said):
    """Why a pick took nothing: what each condition alone takes, and where the elements lie."""
    lines = [f"Nothing of {obj.name}'s {len(items)} {kind} is {said}."]
    if len(tests) > 1:
        alone = [
            f"{words}: {sum(1 for item, (at, normal) in zip(items, places) if test(at, normal, item))}"
            for words, test in tests
        ]
        lines.append("Each condition alone takes " + "; ".join(alone) + ".")
    if places:
        lines.append(f"The centres of its {kind} lie at {spread([at for at, _ in places])}.")
    return " ".join(lines)



def picked(obj, name):
    """A pick kept by name, as it was kept, selected again; refused when no pick has that name."""
    obj = mesh_object(obj, "picked")
    need(isinstance(name, str) and name.strip(), "Name the pick to take up.")
    attribute = obj.data.attributes.get(KEPT + name)
    if attribute is None:
        kept = sorted(a.name[len(KEPT) :] for a in obj.data.attributes if a.name.startswith(KEPT))
        raise Refused(
            f"{obj.name} keeps no pick named “{name}”."
            + (f" It keeps: {', '.join(kept)}." if kept else " It keeps none.")
        )
    kind = next(k for k, domain in KINDS.items() if domain == attribute.domain)
    flags = [False] * len(attribute.data)
    attribute.data.foreach_get("value", flags)
    chosen = [i for i, flag in enumerate(flags) if flag]
    shape = bmesh.new()
    try:
        shape.from_mesh(obj.data)
        keep(obj, shape, kind, chosen, None)
    finally:
        shape.free()
    report(f"Took up “{name}” on {obj.name}: {len(chosen)} {kind if len(chosen) != 1 else SINGULAR[kind]}.")
    return Picked(obj, kind, chosen, name)


FUNCTIONS = (pick, picked)
