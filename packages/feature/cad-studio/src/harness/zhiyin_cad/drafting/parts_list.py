"""
A drawing's parts list: the rows of the parts list a build writes, drawn as
a table above the title block, its header next to the block and item 1
above it, as ISO 7573 lays one out; and a balloon for each item, its number
in a circle and a leader to a point of the part that a view shows, found by
looking along the view past every part in front, or, in a section, on the
face the plane cuts. Each item goes on the view its balloons are asked on,
the angled view unless another is named, and an item none of whose parts
shows there goes on the first other view that shows one: a straight, angled
or auxiliary view, then a section. An item no view shows gets no balloon,
and the answer says so. The views are laid out round the table, which
nothing is placed over.
"""

import math
import re

import numpy

from .. import bom
from ..words import listed as _listed
from . import lettering
from .sheet import MARGIN, SMALL, TEXT, TITLE_HEIGHT, TITLE_WIDTH

ROW = 7.0
# The columns, left to right, and how wide each is, in mm: the table is as wide as the title block.
COLUMNS = (("Item", 12), ("Qty", 12), ("Part", 46), ("Description", 62), ("Material", 28), ("Mass (g)", 20))
LEAST = 1.6
BALLOON = 4.5
# How finely a part is meshed to find where a view shows it, as a share of its size.
MESHED = 1e-2
# How many of a part's facets, the largest first, are tried as a balloon's point.
TRIED = 40
# How far in front of a point, in mm, another surface hides it.
HIDES = 1e-3


def listed(source, spec, built):
    """
    The parts list of a drawing of parts, with the view its balloons go on;
    raises ValueError when the drawing has no parts to list or that view is
    not one a balloon can be put on.
    """
    if not hasattr(source, "shapes"):
        raise ValueError("a parts list lists a script's parts; a drawing of the 3D scene has none")
    parts = list(zip(source.names, source.shapes))
    written = str((spec.get("title") or {}).get("material") or "").strip()
    given = bom.materials_of(spec.get("materials"), list(source.names))
    otherwise = title_material(written, given.values())
    # Only a part made a known way is taken to be of the drawing's material.
    made_as = getattr(source, "made_as", {})
    known = {name: otherwise for name in source.names if otherwise and name not in given and made_as.get(name)}
    rows, untold = bom.rows(parts, spec.get("materials"), otherwise=known)
    took = [name for row in rows for name in row["otherwise"]]
    unknown = [name for row in rows if not row["bought"] and not row["material"] for name in row["names"]]
    said = []
    if took:
        one = len(took) == 1
        ways = " or ".join(sorted({made_as[name] for name in took}))
        said.append(
            f"{_listed(took)}, {ways}, {'has' if one else 'have'} no material of {'its' if one else 'their'} own, "
            f"so the parts list gives {'it' if one else 'them'} {otherwise}, from the title block's material, {written}; "
            "give materials to set another."
        )
    if otherwise and unknown:
        one = len(unknown) == 1
        said.append(
            f"{_listed(unknown)} {'takes' if one else 'take'} no material from the title block, as how {'it is' if one else 'they are'} "
            f"made is not known: give {'it' if one else 'them'} one in materials, or show {'it' if one else 'each'} with "
            f'making="printed", or the way {"it is" if one else "each is"} made, to give {"it" if one else "them"} {otherwise}.'
        )
    untold = [*said, *untold]
    asked = spec.get("balloons")
    if asked is None:
        named = [view for view in built.values() if view.kind in ("named", "auxiliary")]
        chosen = built.get("iso") or (named[0] if named else None)
        if chosen is None:
            raise ValueError("a parts list's balloons go on a straight, angled or auxiliary view, and the drawing has none")
    else:
        chosen = built.get(asked)
        if chosen is None:
            raise ValueError(f"balloons are on the {asked} view, which the drawing does not have; it has {', '.join(built)}")
        if chosen.kind not in ("named", "auxiliary"):
            raise ValueError(
                f"balloons are on {chosen.kind} {asked}, where parts are cut or enlarged; put them on a straight, angled or auxiliary view"
            )
    # The views an item is ballooned on, the first that shows it: the one
    # chosen, the other whole views in the drawing's order, then sections.
    others = [view.name for view in built.values() if view.kind in ("named", "auxiliary") and view is not chosen]
    sections = [view.name for view in built.values() if view.kind == "section"]
    return {
        "rows": rows,
        "untold": untold,
        "view": chosen.name,
        "order": [chosen.name, *others, *sections],
        "kinds": {view.name: view.kind for view in built.values()},
        "parts": parts,
        "anchors": {},
        "on": {},
        "unballooned": [],
        "crowded": [],
    }


def title_material(written, given):
    """
    The material a made part given none takes from the title block's
    `written` material: the one material of the material table it names,
    or, of several, the one no part is `given`; nothing when it names none
    or leaves the choice open.
    """
    from ..requirements import DENSITIES

    left, named = written.lower(), []
    # The longest names first, so stainless steel is not read as steel too.
    for material in sorted(DENSITIES, key=len, reverse=True):
        pattern = r"(?<![\w-])" + re.escape(material.lower()) + r"(?![\w-])"
        if re.search(pattern, left):
            named.append(material)
            left = re.sub(pattern, " ", left)
    if len(named) == 1:
        return named[0]
    taken = {material.lower() for material in given}
    open_ = [material for material in named if material.lower() not in taken]
    return open_[0] if len(open_) == 1 else None


def _height(rows):
    return ROW * (len(rows) + 1)


def area(target, plan):
    """
    The room for the views: the whole of the frame but the corner the title
    block and the table above it hold, which is answered apart, with a
    margin round it, as the room the views keep out of.
    """
    left, _, right, top = target.drawing_area()
    table_top = MARGIN + TITLE_HEIGHT + _height(plan["rows"])
    room = (left, MARGIN + 5, right, top)
    corner = (target.width - MARGIN - TITLE_WIDTH - 5, MARGIN, target.width - MARGIN, table_top + 5)
    return room, corner


def _fitted(target, text, x, y, room):
    """Text in a cell `room` wide, made smaller to fit, cut short with an ellipsis only when even that does not."""
    size = SMALL
    while size > LEAST and lettering.width(text, size) > room:
        size = round(size - 0.1, 6)
    while text and lettering.width(text, size) > room:
        text = text[:-2] + "…" if len(text) > 1 else ""
    target.text(text, x, y, size)


def table(target, plan, taken):
    """Draws the parts list above the title block, and keeps its room from everything placed after."""
    right = target.width - MARGIN
    left = right - TITLE_WIDTH
    bottom = MARGIN + TITLE_HEIGHT
    rows = plan["rows"]
    top = bottom + _height(rows)
    target.line("frame", [(left, bottom), (left, top), (right, top), (right, bottom)])
    for index in range(1, len(rows) + 1):
        target.line("frame" if index == 1 else "thin", [(left, bottom + index * ROW), (right, bottom + index * ROW)])
    cells = lambda row: [
        str(row["item"]),
        str(row["count"]),
        row["name"],
        row["description"],
        row["material"],
        bom.mm(row["mass"]) if row["mass"] is not None else "",
    ]
    lines = [[name for name, _ in COLUMNS]] + [cells(row) for row in rows]
    widths = column_widths(lines)
    x = left
    for width in widths[:-1]:
        x += width
        target.line("thin", [(x, bottom), (x, top)])
    for index, values in enumerate(lines):
        x = left
        for value, width in zip(values, widths):
            _fitted(target, value, x + 1.2, bottom + index * ROW + (ROW - SMALL) / 2, width - 2.4)
            x += width
    taken.texts.append((left, bottom, right, top))


# The columns that give and take room as what they hold needs: the part's name, its description and its material.
FLEXIBLE = (2, 3, 4)


def column_widths(lines):
    """
    Each column's width, in mm, adding up to the title block's: the item,
    quantity and mass columns as COLUMNS gives them, and the rest shared out
    by how wide what they hold is written, so a long material is not cut short
    while the description has room to spare.
    """
    need = [max(lettering.width(values[k], SMALL) for values in lines) + 2.4 for k in range(len(COLUMNS))]
    widths = [width for _, width in COLUMNS]
    room = TITLE_WIDTH - sum(widths[k] for k in range(len(COLUMNS)) if k not in FLEXIBLE)
    wanted = sum(need[k] for k in FLEXIBLE)
    for k in FLEXIBLE:
        widths[k] = room * need[k] / wanted
    return widths


def _triangles(shape):
    size = max(shape.bounding_box().diagonal, 1e-6)
    points, triangles = shape.tessellate(size * MESHED)
    at = numpy.array([(p.X, p.Y, p.Z) for p in points], dtype=float)
    return at[numpy.array(triangles, dtype=int).reshape(-1, 3)] if len(triangles) else numpy.zeros((0, 3, 3))


def _seen(view, plan):
    """Each part's facets as the view sees them, (x, y, depth) at each corner, and the area of each, in the view's own mm."""
    right, up, look = (numpy.array(tuple(v)) for v in (view.right, view.up, view.look))
    centre = numpy.array(tuple(view.centre))
    meshed = plan.setdefault("meshed", {})
    seen = []
    for name, shape in plan["parts"]:
        if name not in meshed:
            meshed[name] = _triangles(shape)
        triangles = meshed[name] - centre
        flat = numpy.stack((triangles @ right, triangles @ up, triangles @ look), axis=-1)
        edges = numpy.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        seen.append((flat, 0.5 * numpy.linalg.norm(edges, axis=1)))
    return seen


def _hidden(point, everything):
    """Whether a facet of any part lies in front of a point of the view, (x, y, depth)."""
    x, y, depth = point
    corners = everything
    low, high = corners[:, :, :2].min(axis=1), corners[:, :, :2].max(axis=1)
    near = (low[:, 0] <= x) & (high[:, 0] >= x) & (low[:, 1] <= y) & (high[:, 1] >= y)
    if not near.any():
        return False
    t = corners[near]
    a, b, c = t[:, 0], t[:, 1], t[:, 2]
    det = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
    usable = numpy.abs(det) > 1e-12
    if not usable.any():
        return False
    a, b, c, det = a[usable], b[usable], c[usable], det[usable]
    w1 = ((b[:, 1] - c[:, 1]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (y - c[:, 1])) / det
    w2 = ((c[:, 1] - a[:, 1]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (y - c[:, 1])) / det
    w3 = 1 - w1 - w2
    inside = (w1 >= -1e-9) & (w2 >= -1e-9) & (w3 >= -1e-9)
    front = w1 * a[:, 2] + w2 * b[:, 2] + w3 * c[:, 2]
    return bool((inside & (front < depth - HIDES)).any())


def _anchors(view, plan):
    """For each row, the point of one of its parts the view shows, in the view's mm, or nothing."""
    if view.kind == "section":
        return _cut_anchors(view, plan)
    seen = _seen(view, plan)
    everything = numpy.concatenate([flat for flat, _ in seen]) if seen else numpy.zeros((0, 3, 3))
    index = {name: i for i, (name, _) in enumerate(plan["parts"])}
    anchors = {}
    for row in plan["rows"]:
        for name in row["names"]:
            flat, areas = seen[index[name]]
            # Of its largest facets the view shows, the nearest the viewer: a face on top, not the floor of a recess.
            shown = [flat[k].mean(axis=0) for k in numpy.argsort(-areas)[:TRIED]]
            shown = [middle for middle in shown if not _hidden(middle, everything)]
            if shown:
                middle = min(shown, key=lambda m: float(m[2]))
                anchors[row["item"]] = (float(middle[0]), float(middle[1]))
                break
    return anchors


# How many points across a cut face's box are tried for the one deepest inside it.
GRID = 16


def _cut_anchors(view, plan):
    """
    For each row, a point well inside a face the section's plane cuts of one
    of its parts, which nothing stands in front of: the plane is the nearest
    the section shows. Parts it leaves whole are not ballooned on it.
    """
    index = {name: i for i, (name, _) in enumerate(plan["parts"])}
    faces = dict(view.cut)
    anchors = {}
    for row in plan["rows"]:
        for name in row["names"]:
            polygons = faces.get(index[name])
            point = _inside_point(polygons) if polygons else None
            if point is not None:
                anchors[row["item"]] = point
                break
    return anchors


def _inside_point(polygons):
    """The point of a grid over cut faces, by the even-odd rule, furthest from their edges; or nothing."""
    edges = numpy.array([(a, b) for polygon in polygons for a, b in zip(polygon, polygon[1:] + polygon[:1])], dtype=float)
    if not len(edges):
        return None
    low, high = edges.reshape(-1, 2).min(axis=0), edges.reshape(-1, 2).max(axis=0)
    xs = numpy.linspace(low[0], high[0], GRID + 2)[1:-1]
    ys = numpy.linspace(low[1], high[1], GRID + 2)[1:-1]
    points = numpy.array([(x, y) for x in xs for y in ys])
    a, b = edges[:, 0], edges[:, 1]
    # Even-odd: how many edges a ray to the right of each point crosses.
    px, py = points[:, 0:1], points[:, 1:2]
    spans = (a[:, 1] > py) != (b[:, 1] > py)
    with numpy.errstate(divide="ignore", invalid="ignore"):
        cross_x = a[:, 0] + (py - a[:, 1]) * (b[:, 0] - a[:, 0]) / (b[:, 1] - a[:, 1])
    inside = (numpy.sum(spans & (px < cross_x), axis=1) % 2) == 1
    if not inside.any():
        return None
    points = points[inside]
    # How far each is from the nearest edge.
    d = b - a
    length = numpy.maximum((d * d).sum(axis=1), 1e-18)
    t = numpy.clip(((points[:, None, :] - a[None]) * d[None]).sum(axis=2) / length, 0.0, 1.0)
    nearest = a[None] + t[:, :, None] * d[None]
    clear = numpy.linalg.norm(points[:, None, :] - nearest, axis=2).min(axis=1)
    best = points[int(numpy.argmax(clear))]
    return (float(best[0]), float(best[1]))


def balloons(target, slots, taken, plan):
    """
    Draws a balloon for each row, on the first of the plan's views that shows
    it; answers how many meet something.
    """
    plan["unballooned"], plan["crowded"], plan["on"] = [], [], {}
    by_name = {slot.view.name: slot for slot in slots}
    left = list(plan["rows"])
    met = 0
    for name in plan["order"]:
        slot = by_name.get(name)
        if slot is None or not left:
            continue
        if name not in plan["anchors"]:
            plan["anchors"][name] = _anchors(slot.view, plan)
        anchors = plan["anchors"][name]
        here = [row for row in left if row["item"] in anchors]
        if not here:
            continue
        left = [row for row in left if row["item"] not in anchors]
        plan["on"][name] = [row["item"] for row in here]
        met += _balloons_on(target, slot, taken, plan, here, anchors)
    plan["unballooned"] = left
    return met


def _balloons_on(target, slot, taken, plan, rows, anchors):
    """
    Draws a balloon for each row on the slot's view, round the view in the
    order of the points they lead to, each where it meets least; answers how
    many meet something.
    """
    view = slot.view
    left, bottom, right, top = view.bounds()
    at = lambda p: (slot.origin[0] + p[0] * slot.scale, slot.origin[1] + p[1] * slot.scale)
    box = (*at((left, bottom)), *at((right, top)))
    middle = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    placed = []
    for row in rows:
        point = at(anchors[row["item"]])
        placed.append((math.atan2(point[1] - middle[1], point[0] - middle[0]), row, point))
    met_any = 0
    for angle, row, point in sorted(placed, key=lambda one: one[0]):
        best = None
        for extra in (0, 6, 12, 18, 24, 30):
            for turn in (0, 12, -12, 24, -24, 36, -36):
                way = angle + math.radians(turn)
                c, s = math.cos(way), math.sin(way)
                ends = []
                if abs(c) > 1e-9:
                    ends.append(((box[2] if c > 0 else box[0]) - middle[0]) / c)
                if abs(s) > 1e-9:
                    ends.append(((box[3] if s > 0 else box[1]) - middle[1]) / s)
                out = max(0.0, min(ends)) + BALLOON + 5 + extra
                centre = (middle[0] + c * out, middle[1] + s * out)
                length = math.dist(centre, point)
                if length <= BALLOON:
                    continue
                edge = (centre[0] + (point[0] - centre[0]) * BALLOON / length, centre[1] + (point[1] - centre[1]) * BALLOON / length)
                circle = (centre[0] - BALLOON, centre[1] - BALLOON, centre[0] + BALLOON, centre[1] + BALLOON)
                met = taken.clashes([circle], [(edge, point)], own=view.name, own_box_too=False)
                if best is None or met < best[0]:
                    best = (met, centre, edge, circle)
                if met == 0:
                    break
            if best is not None and best[0] == 0:
                break
        met, centre, edge, circle = best
        if met:
            plan["crowded"].append(row["item"])
            met_any += 1
        target.arc("thin", centre[0], centre[1], BALLOON)
        target.line("thin", [edge, point])
        target.fill("thin", [(point[0] + 0.6 * math.cos(math.radians(a)), point[1] + 0.6 * math.sin(math.radians(a))) for a in range(0, 360, 30)])
        target.text(str(row["item"]), centre[0], centre[1] - TEXT / 2, TEXT, "centre")
        taken.take([circle], [(edge, point)])
    return met_any


def report(plan):
    """What the parts list on the sheet holds and could not do, a line each, for the answer."""
    rows = plan["rows"]
    count = sum(row["count"] for row in rows)
    on = {name: items for name, items in plan["on"].items() if items}
    if not on or list(on) == [plan["view"]]:
        where = f"each item ballooned on {_view_words(plan['view'], plan)}"
    else:
        where = "each item ballooned on the first view that shows it: " + _listed(
            [f"{_items(items)} on {_view_words(name, plan)}" for name, items in on.items()]
        )
    lines = [
        f"A parts list of {len(rows)} {'row' if len(rows) == 1 else 'rows'} from {count} {'part' if count == 1 else 'parts'} above the title block, {where}:",
        *(bom.row_line(row, files=False) for row in rows),
        *plan["untold"],
    ]
    for row in plan["unballooned"]:
        lines.append(
            f"No balloon for item {row['item']}, {row['name']}: no point of it shows in any view of the drawing, others standing in front, "
            "and no section cuts it; a section through it shows it."
        )
    if plan["crowded"]:
        lines.append(
            f"Balloon{'s' if len(plan['crowded']) > 1 else ''} {', '.join(str(i) for i in plan['crowded'])} meet{'' if len(plan['crowded']) > 1 else 's'} "
            "other lines or text, for want of room: a larger sheet gives them room."
        )
    return lines


def _view_words(name, plan):
    """A view as the answer names it: the iso view, section A, view B."""
    kind = plan.get("kinds", {}).get(name, "named")
    return f"section {name}" if kind == "section" else f"view {name}" if kind == "auxiliary" else f"the {name} view"


def _items(items):
    """Item numbers as the answer gives them, runs joined: items 1–3 and 9."""
    runs = []
    for item in sorted(items):
        if runs and item == runs[-1][1] + 1:
            runs[-1][1] = item
        else:
            runs.append([item, item])
    said = [one for a, b in runs for one in ([f"{a}–{b}"] if b > a + 1 else [str(n) for n in range(a, b + 1)])]
    return ("item " if len(items) == 1 else "items ") + _listed(said)

