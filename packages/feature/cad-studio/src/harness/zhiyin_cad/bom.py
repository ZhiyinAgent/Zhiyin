"""
A parts list of the parts shown, as a bill of materials is: one row for
each different part, with how many there are. Parts are the same part when
one is the other moved and turned, found on their exact shapes: the same
volume, surface and moments of inertia, and every corner and edge of one on
the other's once turned into its place. A part and its mirror image are two
parts. A part that is one of bd_warehouse's standard parts is bought, by
its class and size; the rest are made. Material is as the call gives it,
and a part's mass is its volume times the material's density where the
material table knows it. The parts list says what it could not tell.
"""

import csv
import math
import re

import build123d as bd
import numpy

from . import bom_record, patterns
from .words import listed as _listed
from .words import mm

# How close two measures of the same part are, as a share of the measure: its copies differ only in the float's last digits.
SAME = 1e-5
# How far a corner of a part may lie from the other's, as a share of its size, and at least in mm.
CORNER = 1e-5
CORNER_MM = 1e-4
# Moments this close, as a share, are equal, and leave the turn about them open.
EQUAL_MOMENTS = 1e-6
# The kinds of export that hold parts, which a row names as its files.
PART_FILES = ("step", "stl", "3mf", "glb")
# Words in a part's name that say a standard part, which a part not built from bd_warehouse is not.
STANDARD_WORDS = re.compile(r"\b(screw|bolt|nut|washer|bearing|circlip|o-ring)s?\b", re.IGNORECASE)
COLUMNS = ("Item", "Quantity", "Part", "Made or bought", "Description", "Material", "Mass each (g)", "Size (mm)", "Files")


class _Shape:
    """A part's measures for finding its copies: volume, surface, moments and points, about its centre of mass."""

    def __init__(self, shape):
        self.volume = float(shape.volume)
        self.area = float(shape.area)
        self.centre = numpy.array(tuple(shape.center(bd.CenterOf.MASS)))
        moments, axes = numpy.linalg.eigh(numpy.array(shape.matrix_of_inertia, dtype=float))
        self.moments, self.axes = moments, axes
        points = [tuple(v) for v in shape.vertices()] + [tuple(e.position_at(0.5)) for e in shape.edges()]
        self.points = numpy.array(points, dtype=float).reshape(-1, 3) - self.centre
        self.size = max(float(shape.bounding_box().diagonal), 1e-9)
        self.solids = len(shape.solids())

    def alike(self, other):
        """Whether the measures that no move or turn changes agree."""
        near = lambda a, b: abs(a - b) <= SAME * max(abs(a), abs(b), 1e-9)
        return (
            self.solids == other.solids
            and len(self.points) == len(other.points)
            and near(self.volume, other.volume)
            and near(self.area, other.area)
            and all(near(a, b) for a, b in zip(self.moments, other.moments))
        )


def _turns(first, second):
    """
    The turns that could take the first part's principal axes onto the
    second's, each with whether it is a mirror: every sign of each axis, and
    about an axis of equal moments, the turns that bring a corner of one onto
    a corner of the other.
    """
    found = []
    for signs in ((1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1), (-1, -1, -1), (-1, 1, 1), (1, -1, 1), (1, 1, -1)):
        turn = second.axes @ numpy.diag(signs) @ first.axes.T
        found.append(turn)
    moments = first.moments
    spread = max(abs(moments[-1]), 1e-12)
    equal = [i for i in range(2) if abs(moments[i + 1] - moments[i]) <= EQUAL_MOMENTS * spread]
    if len(equal) == 1:
        # Two equal moments: the turn about the third axis is open, so try each that lays a corner of one on one of the other.
        lone = 2 if equal == [0] else 0
        extra = []
        for base in found:
            axis = second.axes[:, lone]
            moved = first.points @ base.T
            radial = lambda p: p - numpy.outer(p @ axis, axis)
            spokes = radial(moved)
            reach = numpy.linalg.norm(spokes, axis=1)
            if not len(reach) or reach.max() < 1e-9:
                continue
            k = int(reach.argmax())
            targets = radial(second.points)
            for j in numpy.nonzero(numpy.abs(numpy.linalg.norm(targets, axis=1) - reach[k]) <= CORNER * second.size + CORNER_MM)[0]:
                a, b = spokes[k], targets[j]
                angle = math.atan2(numpy.dot(numpy.cross(a, b), axis), numpy.dot(a, b))
                c, s = math.cos(angle), math.sin(angle)
                x = numpy.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
                about = numpy.eye(3) + s * x + (1 - c) * (x @ x)
                extra.append(about @ base)
        found += extra[:400]
    return [(turn, numpy.linalg.det(turn) < 0) for turn in found]


def _same(first, second):
    """Whether two parts alike in their measures are one moved onto the other: 'same', 'mirror', or nothing."""
    from scipy.spatial import cKDTree

    if not first.alike(second):
        return None
    tree = cKDTree(second.points)
    reach = CORNER * second.size + CORNER_MM
    mirrored = False
    for turn, mirror in _turns(first, second):
        distances, _ = tree.query(first.points @ turn.T)
        if float(distances.max(initial=0.0)) <= reach:
            if not mirror:
                return "same"
            mirrored = True
    return "mirror" if mirrored else None


def _box(shape):
    """A part's size as its stock would be: the smaller of its box as placed and its box along its principal axes."""
    box = shape.bounding_box()
    placed = sorted((box.size.X, box.size.Y, box.size.Z), reverse=True)
    points = numpy.array([tuple(v) for v in shape.tessellate(max(box.diagonal * 1e-3, 1e-3))[0]], dtype=float)
    if len(points) < 4:
        return placed
    _, axes = numpy.linalg.eigh(numpy.array(shape.matrix_of_inertia, dtype=float))
    along = points @ axes
    own = sorted((along.max(axis=0) - along.min(axis=0)).tolist(), reverse=True)
    return own if math.prod(own) < math.prod(placed) - 1e-9 else placed


def _base(names):
    """What a row of several parts is called: their shared name, numbers dropped, or their names."""
    bare = {re.sub(r"\s*\d+$", "", name) for name in names}
    if len(names) > 1 and len(bare) == 1 and next(iter(bare)):
        return next(iter(bare))
    return ", ".join(names)


def materials_of(asked, names):
    """Each part's material, from {name or /pattern/: material}; raises ValueError for a name of no part or a part given two."""
    given = {}
    for key, material in (asked or {}).items():
        if not isinstance(material, str) or not material.strip():
            raise ValueError(f"materials gives {key} no material; give it as text, such as steel")
        for name in patterns.expanded([key], names, "materials"):
            if name not in names:
                raise ValueError(f"materials names {name}, which is not among the parts listed: {', '.join(names)}")
            if name in given and given[name] != material.strip():
                raise ValueError(f"materials gives {name} both {given[name]} and {material.strip()}; give it one")
            given[name] = material.strip()
    return given


def _density(material):
    from .requirements import DENSITIES

    return next((value for key, value in DENSITIES.items() if key.lower() == material.lower()), None)


def rows(parts, materials=None, files=None, bought=None, otherwise=None):
    """
    The rows of a parts list of `parts`, (name, shape) in the order shown:
    each with its item number, how many, the names it holds, made or bought,
    what it is, its material and mass, its size and its files. A made part
    given no material is of the one `otherwise` gives it by name, if any,
    and its row says so. And what could not be told, as sentences.
    """
    names = [name for name, _ in parts]
    given = materials_of(materials, names)
    bought = bought if bought is not None else bom_record.bought()
    files = files or {}
    groups = []
    mirrors = []
    measured = {}
    taken = set()
    for name, shape in parts:
        material = given.get(name)
        record = bought.get(name)
        if material is None and record is None and (otherwise or {}).get(name):
            material = otherwise[name]
            taken.add(name)
        if record is not None:
            key = ("bought", record["class"], record["size"], record["standard"], record["length"], material)
            group = next((g for g in groups if g["key"] == key), None)
            if group is None:
                groups.append({"key": key, "names": [name], "shape": shape, "record": record, "material": material})
            else:
                group["names"].append(name)
            continue
        measured[name] = _Shape(shape)
        placed = False
        for group in groups:
            if group["record"] is not None or group["material"] != material:
                continue
            found = _same(measured[name], measured[group["names"][0]])
            if found == "same":
                group["names"].append(name)
                placed = True
                break
            if found == "mirror":
                mirrors.append((group["names"][0], name))
        if not placed:
            groups.append({"key": None, "names": [name], "shape": shape, "record": None, "material": material})
    listed = []
    for item, group in enumerate(groups, start=1):
        shape, record, material = group["shape"], group["record"], group["material"]
        density = _density(material) if material else None
        listed.append(
            {
                "item": item,
                "count": len(group["names"]),
                "names": list(group["names"]),
                "name": _base(group["names"]),
                "bought": record is not None,
                "description": bom_record.described(record) if record else "",
                "class": record["class"] if record else None,
                "material": material or "",
                # The names in the row that took `otherwise`, having no material of their own.
                "otherwise": [name for name in group["names"] if name in taken],
                "mass": shape.volume * density / 1000 if density is not None else None,
                "size": _box(shape),
                "solids": len(shape.solids()),
                "files": sorted({file for name in group["names"] for file in files.get(name, [])}),
            }
        )
    return listed, _untold(listed, given, mirrors)


def _untold(listed, given, mirrors):
    """What the parts list could not tell, a sentence each."""
    from .requirements import DENSITIES

    said = []
    unnamed = [row["name"] for row in listed if not row["material"]]
    if unnamed:
        said.append(
            f"No material or mass for {_listed(unnamed)}: materials gives {'it' if len(unnamed) == 1 else 'them'} none; "
            'give each as {"Part": "steel"}, a name or a /pattern/.'
        )
    unknown = {}
    for row in listed:
        if row["material"] and row["mass"] is None:
            unknown.setdefault(row["material"], []).append(row["name"])
    for material, whose in unknown.items():
        said.append(
            f"No mass for {_listed(whose)}: {material} is not in the material table, which holds {', '.join(DENSITIES)}."
        )
    for row in listed:
        if row["solids"] > 1:
            said.append(
                f"{row['name']} holds {row['solids']} solids, listed as one part; show each piece as a part of its own to count it."
            )
        if not row["bought"] and any(STANDARD_WORDS.search(name) for name in row["names"]):
            said.append(
                f"{row['name']} is not one of bd_warehouse's standard parts, so it is listed as made; "
                "a bought part is recognised when the script shows bd_warehouse's own, as SocketHeadCapScrew(...)."
            )
    for first, second in mirrors:
        said.append(f"{first} and {second} are mirror images of each other, so each is a row of its own.")
    return said


def size_text(size):
    return " × ".join(mm(v) for v in size)


def row_line(row, files=True):
    """One row as the answer says it, with the files it is in, or without for a drawing's."""
    many = row["count"] > 1
    held = f" ({_listed(row['names'])}, the same {'part' if row['bought'] else 'shape'})" if many and row["name"] not in row["names"] else ""
    what = (
        f"bought, {row['description']}, bd_warehouse's {row['class']}"
        if row["bought"]
        else f"made, {size_text(row['size'])} mm"
    )
    material = f", {row['material']}" if row["material"] else ""
    mass = f", {mm(row['mass'])} g{' each' if many else ''}" if row["mass"] is not None else ""
    where = "" if not files else f"; in {', '.join(row['files'])}" if row["files"] else "; in no part file this call wrote"
    return f"- {row['item']}: {row['count']} × {row['name']}{held}: {what}{material}{mass}{where}."


def write(path, parts, materials, files, bought=None):
    """Writes the parts list of `parts` as a CSV a spreadsheet opens, and answers what it holds, a line each."""
    listed, untold = rows(parts, materials, files, bought)
    with open(path, "w", encoding="utf-8-sig", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(COLUMNS)
        for row in listed:
            writer.writerow(
                [
                    row["item"],
                    row["count"],
                    row["name"],
                    "bought" if row["bought"] else "made",
                    row["description"],
                    row["material"],
                    mm(row["mass"]) if row["mass"] is not None else "",
                    size_text(row["size"]),
                    "; ".join(row["files"]),
                ]
            )
    count = sum(row["count"] for row in listed)
    head = f"a parts list of {len(listed)} {'row' if len(listed) == 1 else 'rows'} from {count} {'part' if count == 1 else 'parts'}:"
    return [head, *(row_line(row) for row in listed), *untold]


def files_of(exports, names):
    """Each part's files among a build's exports that hold parts, by the names the model gave them."""
    found = {}
    for wanted in exports:
        if wanted.get("kind") not in PART_FILES or not wanted.get("name"):
            continue
        try:
            held = patterns.expanded(wanted.get("parts") or names, names, "an export's parts")
        except ValueError:
            continue
        for name in held:
            found.setdefault(name, []).append(wanted["name"])
    return found
