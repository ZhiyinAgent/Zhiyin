"""
Checks a build makes of each part for the way it is made, unasked. A part
is printed, moulded (injection-moulded or cast), milled or bent from sheet:
as `show(..., making=…)` says, else as the build shows it, a draft
requirement or the cast() helper making it moulded, a file for printing or
an overhang requirement printed, and its bends a sheet part. What each
check finds past its limit is said in one line with the measured value and
the limit; a part that keeps to them is not mentioned.

- Every part: closed voids inside it, which no tool or mould reaches and a
  print seals.
- Moulded: faces the part covers along the mould's pull (trapped, needing a
  side action), sections thicker than the nominal wall allows, and ribs and
  bosses the helpers made thicker or taller than their wall allows.
- Milled, with the tool along Z: inside corners along the tool, sharp or
  rounded tighter than a tool that reaches their depth.
- Sheet: inside bend radius, flange length, and holes too near a bend or an
  edge, by the sheet-metal rules the bend requirement applies.

The script's run notes what the helpers made, here, for the measuring run.
"""

import math

import build123d as bd
import numpy

from . import forms, patterns, sheet_rules
from .thickness import Balls as _Balls
from .thickness import OutOfTime, nominal_wall, thicknesses
from .thickness import first_hit as _first_hit
from .thickness import hits as _hits
from .thickness import in_time as _in_time
from .thickness import on_face as _on_face
from .thickness import part_mesh as _part_mesh
from .thickness import rays as _rays
from .thickness import tolerance as _tolerance
from .words import mm as _mm
from .words import point as _at

METHODS = ("printed", "moulded", "milled", "sheet")

# What the helpers made, noted in the script's run: each a record of plain numbers.
features = []


def note(kind, **fields):
    features.append({"kind": kind, **{key: _plain(value) for key, value in fields.items()}})


def forget():
    features.clear()


def _plain(value):
    if isinstance(value, bd.Vector):
        return [float(value.X), float(value.Y), float(value.Z)]
    if isinstance(value, (tuple, list)):
        return [float(v) for v in value]
    return None if value is None else float(value)


# ---- limits -------------------------------------------------------------------------------------

# A moulded wall keeps within a quarter of its nominal thickness, and the largest ball in a corner
# where three even walls meet is 1.27 walls across; thicker sinks and holds voids.
THICK_SHARE = 1.3
# A rib's root at most this share of the wall it stands on, and at most this many walls tall.
RIB_SHARE = 0.6
RIB_HEIGHT = 3.0
# A boss's wall at most this share of the wall it stands on, or this share past a wall of 3.2 mm.
BOSS_SHARE = 0.6
BOSS_SHARE_THICK = 0.4
BOSS_THICK_WALL = 3.2
# A milled inside corner along the tool: its radius at least this share of its depth.
CORNER_DEPTH_SHARE = 1 / 3
# Sheet parts are held to the sheet-metal rules the bend requirement applies.

# How many points of a face its undercut is looked for at.
FACE_POINTS = 9
# Facing the pull less than this, a face lies along it: its draft is the draft check's.
ALONG = 0.02
# At most how many places each line names.
PLACES = 4


def _box_words(box_min, box_max):
    size = " × ".join(_mm(b - a) for a, b in zip(box_min, box_max))
    middle = ", ".join(_mm((a + b) / 2) for a, b in zip(box_min, box_max))
    return f"{size} mm about ({middle})"


def _axis_words(d):
    for i, name in enumerate("XYZ"):
        if abs(abs(d[i]) - 1) < 1e-6:
            return f"{'+' if d[i] > 0 else '-'}{name}"
    return "(" + ", ".join(_mm(v) for v in d) + ")"


# ---- the way each part is made --------------------------------------------------------------------


def _inside(shape, point):
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.gp import gp_Pnt
    from OCP.TopAbs import TopAbs_IN

    for solid in shape.solids():
        if BRepClass3d_SolidClassifier(solid.wrapped, gp_Pnt(*point), 1e-6).State() == TopAbs_IN:
            return True
    return False


def _cast_in(shape, cast):
    """
    Whether the part holds what cast() made, where it made it: a point of it
    up its height, or, shelled since, walls all round its middle.
    """
    base, pull = numpy.array(cast["base"]), numpy.array(cast["pull"])
    height = abs(cast["height"] or 0)
    if any(_inside(shape, base + pull * height * share) for share in (0.1, 0.25, 0.5, 0.75)):
        return True
    rays = _rays(shape)
    return all(_first_hit(rays, base + pull * height / 2, side, 0.0) is not None for side in _square_to(pull))


def chosen(parts, declared, printed, requirements, made):
    """
    Each part's way of making, by name: the method, what chose it, and for a
    moulded part the pull and the parting height along it, if one is given.
    """
    found = {}
    drafts = {}
    names = [name for name, _ in parts]
    for one in requirements or []:
        if one.get("check") == "draft" and isinstance(one.get("part"), str):
            try:
                named = patterns.expanded([one["part"]], names, "the draft requirement's part")
            except ValueError:
                continue
            for name in named:
                drafts.setdefault(name, one)
    for name, shape in parts:
        method = declared.get(name)
        if method:
            found[name] = {"method": method, "why": "as shown", "pull": [0.0, 0.0, 1.0], "parting": None}
            continue
        if name in drafts:
            pull = drafts[name].get("pull") or [0, 0, 1]
            found[name] = {"method": "moulded", "why": "its draft requirement", "pull": pull, "parting": drafts[name].get("parting")}
            continue
        cast = next((one for one in made if one["kind"] == "cast" and _cast_in(shape, one)), None)
        if cast is not None:
            found[name] = {"method": "moulded", "why": "cast()", "pull": cast["pull"], "parting": None}
            continue
        if name in printed:
            found[name] = {"method": "printed", "why": "written for printing", "pull": None, "parting": None}
            continue
        found[name] = {"method": None, "why": None, "pull": None, "parting": None}
    for one in found.values():
        if one["pull"] is not None:
            pull = numpy.array(one["pull"], dtype=float)
            one["pull"] = pull / (numpy.linalg.norm(pull) or 1.0)
    return found


# ---- shared measures ------------------------------------------------------------------------------


def _whole(found):
    """What a measure of the forms found, when it looked at everything before the time ran out."""
    if found.left:
        raise OutOfTime()
    return found


def _places(points, values, chosen_mask, spacing):
    """The chosen points joined into places of neighbours, each as its indexes, the largest value first."""
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree

    index = numpy.flatnonzero(chosen_mask)
    if not len(index):
        return []
    tree = cKDTree(points[index])
    pairs = tree.query_pairs(2.5 * spacing, output_type="ndarray")
    from scipy.sparse import coo_matrix

    graph = coo_matrix((numpy.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(index), len(index))) if len(pairs) else coo_matrix((len(index), len(index)))
    _, labels = connected_components(graph, directed=False)
    places = [index[labels == label] for label in numpy.unique(labels)]
    return sorted(places, key=lambda place: -values[place].max())


# ---- every part ---------------------------------------------------------------------------------


def voids(shape):
    """Each closed void inside the part: its volume and its box."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
    from OCP.BRepClass3d import BRepClass3d
    from OCP.TopoDS import TopoDS

    found = []
    for solid in shape.solids():
        outer = BRepClass3d.OuterShell_s(TopoDS.Solid(solid.wrapped))
        for shell in solid.shells():
            if shell.wrapped.IsSame(outer):
                continue
            hollow = bd.Solid(BRepBuilderAPI_MakeSolid(TopoDS.Shell(shell.wrapped)).Solid())
            box = shell.bounding_box()
            found.append({"volume": abs(hollow.volume), "min": tuple(box.min), "max": tuple(box.max)})
    return sorted(found, key=lambda one: -one["volume"])


def _voids_line(name, shape, method=None):
    found = voids(shape)
    if not found:
        return None
    listed = "; ".join(f"{_mm(one['volume'])} mm³, {_box_words(one['min'], one['max'])}" for one in found[:PLACES])
    more = f"; and {len(found) - PLACES} more" if len(found) > PLACES else ""
    count = f"{len(found)} closed {'void' if len(found) == 1 else 'voids'}"
    if method == "printed":
        # How it prints, sealed and empty or full of resin or powder, is the print's way, which the build is not told.
        return f"{name} holds {count} inside it: {listed}{more}. {'It prints' if len(found) == 1 else 'They print'} sealed."
    return (
        f"{name} holds {count} inside it, where none can be: {listed}{more}. No tool or mould reaches a closed void, "
        "and a resin or powder print keeps it full; open it to the outside, or fill it."
    )


# ---- moulded ------------------------------------------------------------------------------------


def _face_points(face, triangulation, count=FACE_POINTS):
    """
    Up to `count` points of a face's exact surface, spread over it by area,
    each with the face's outward normal there, from the part's mesh. A
    facet's middle lies inside a curved face by its sag, so each is taken to
    the surface itself.
    """
    corners, triangles = triangulation
    if not len(triangles):
        return []
    a, b, c = (corners[triangles[:, k]] for k in range(3))
    cross = numpy.cross(b - a, c - a)
    sizes = numpy.linalg.norm(cross, axis=1)
    keep = numpy.flatnonzero(sizes > 1e-12)
    if not len(keep):
        return []
    reach = numpy.cumsum(sizes[keep]) / sizes[keep].sum()
    picked = sorted({int(keep[min(numpy.searchsorted(reach, (i + 0.5) / count), len(keep) - 1)]) for i in range(count)})
    found = [_on_face(face, (a[k] + b[k] + c[k]) / 3) for k in picked]
    return [one for one in found if one is not None]


def _square_to(pull):
    """The two axes of X, Y and Z most square to the pull, each both ways, as the ways a side action can go."""
    axes = sorted(numpy.eye(3), key=lambda axis: abs(axis @ pull))[:2]
    found = []
    for axis in axes:
        side = axis - (axis @ pull) * pull
        side /= numpy.linalg.norm(side)
        found += [side, -side]
    return found


def undercuts(shape, pull, parting=None, by=None, mesh=None):
    """
    Each face of the part that the mould cannot leave along the pull: from
    points of it, the way its half of the mould leaves meets the part again.
    Each half leaves the way its faces look, or, given the parting, the half
    above it along the pull and the one below against. Answers each trapped
    face's area, a point of it, and the ways square to the pull a side
    action could leave it by.
    """
    rays = _rays(shape)
    size = max(shape.bounding_box().diagonal, 1e-3)
    off = size * 1e-5 + 1e-5
    mesh = mesh if mesh is not None else _part_mesh(shape)
    found = []
    for face, triangulation in zip(shape.faces(), mesh):
        _in_time(by)
        points = _face_points(face, triangulation)
        if not points:
            continue
        hit, looked = [], 0
        for p, n in points:
            facing = n @ pull
            if abs(facing) < ALONG:
                continue
            if parting is None:
                way = pull if facing > 0 else -pull
            else:
                way = pull if p @ pull >= parting else -pull
            looked += 1
            if _first_hit(rays, p + n * off, way, off) is not None:
                hit.append((p, n))
        if not hit:
            continue
        sides = [
            side
            for side in _square_to(pull)
            if all(n @ side > -ALONG and _first_hit(rays, p + n * off, side, off) is None for p, n in points)
        ]
        found.append({"area": face.area * len(hit) / looked, "at": hit[0][0], "sides": sides})
    return sorted(found, key=lambda one: -one["area"])


def _undercuts_line(name, shape, how, mesh=None, by=None):
    found = undercuts(shape, how["pull"], how.get("parting"), by, mesh)
    if not found:
        return None
    total = sum(one["area"] for one in found)

    def place(one):
        frees = f"a side action along {' or '.join(_axis_words(s) for s in one['sides'])} frees it" if one["sides"] else "no side action square to the pull frees it"
        return f"{_mm(one['area'])} mm² at {_at(one['at'])}, {frees}"

    listed = "; ".join(place(one) for one in found[:PLACES])
    more = f"; and {len(found) - PLACES} more" if len(found) > PLACES else ""
    faces = f"{len(found)} {'face' if len(found) == 1 else 'faces'}"
    return (
        f"{name}, moulded ({how['why']}) along {_axis_words(how['pull'])}: {faces}, {_mm(total)} mm², trapped where the mould "
        f"leaving along the pull meets the part again, against none allowed: {listed}{more}."
    )


def _thick_line(name, shape, mesh=None, by=None):
    points, normals, thick, across, faces = thicknesses(shape, by=by, mesh=mesh)
    if len(thick) < 10:
        return None
    nominal = nominal_wall(shape, thick, faces)
    limit = nominal * THICK_SHARE
    # Thick both ways: a corner of even walls holds a larger ball than the walls do, but is as thick straight in.
    over = (thick > limit + 1e-6) & (across > limit + 1e-6)
    if not over.any():
        return None
    # Among points of the surface a ball reads large where they are sparse, as along a corner's edge: each is
    # measured again on the exact faces.
    balls = _Balls(shape)
    for k in numpy.flatnonzero(over):
        _in_time(by)
        over[k] = balls.over(faces[k], points[k], normals[k], limit + 1e-6)
    if not over.any():
        return None
    spacing = math.sqrt(shape.area / len(thick))
    places = _places(points, thick, over, spacing)
    share = 100 * over.mean()

    def place(indexes):
        k = indexes[numpy.argmax(thick[indexes])]
        exact = balls.largest(faces[k], points[k], normals[k], thick[k] + 2 * _tolerance(shape), by)
        return f"{_mm(exact)} mm at {_at(points[k])}"

    listed = ", ".join(place(one) for one in places[:PLACES])
    more = f", and {len(places) - PLACES} more" if len(places) > PLACES else ""
    return (
        f"{name}: walls {_mm(nominal)} mm nominal, thicker than the {_mm(limit)} mm ({THICK_SHARE:g} × nominal) a moulded wall keeps to, corners included, "
        f"over {share:{'.0f' if share >= 1 else '.2g'}}% of its surface, in {len(places)} {'place' if len(places) == 1 else 'places'}: {listed}{more}. "
        "A thick section sinks and holds voids as it cools; core it out to the nominal wall."
    )


def _wall_under(rays, top, way, height):
    """The wall a feature of `height` stands on, from a ray down through it from just above its top."""
    way = numpy.array(way, dtype=float)
    hits = _hits(rays, numpy.array(top) + way, -way)
    if len(hits) < 2:
        return None
    wall = hits[1] - hits[0] - height
    return wall if wall > 1e-3 else None


# How far out from a feature's foot, in mm, the wall it stands on is read, until two readings agree.
BESIDE = (0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4)


def _wall_beside(rays, foot, out, way):
    """
    The wall a feature stands on, read stepping out from its foot until two
    readings agree, so clear of a round at its root; the thinnest read when
    none agree, or nothing when no reading is a wall.
    """
    read = []
    for step in BESIDE:
        wall = _wall_under(rays, foot + out * step, way, 0.0)
        if wall is not None and read and read[-1] is not None and abs(wall - read[-1]) <= 0.01 * wall:
            return wall
        read.append(wall)
    walls = [one for one in read if one is not None]
    return min(walls) if walls else None


def _ribs_lines(name, shape, rays, by=None):
    """Each rib of the part thicker or taller than the wall it stands on allows, a line each."""
    lines = []
    for one in _whole(forms.ribs(shape, deadline=by)):
        _in_time(by)
        way, out = numpy.array(tuple(one["way"])), numpy.array(tuple(one["out"]))
        # On the face the rib stands on, beside its root.
        wall = _wall_beside(rays, numpy.array(tuple(one["at"])), out, way)
        if wall is None:
            continue
        faults = []
        if one["thickness"] > RIB_SHARE * wall + 1e-6:
            faults.append(f"{_mm(one['thickness'])} mm thick at its root, over the {_mm(RIB_SHARE * wall)} mm ({RIB_SHARE:g} of the wall) that keeps the face behind it from sinking")
        if one["height"] > RIB_HEIGHT * wall + 1e-6:
            faults.append(f"{_mm(one['height'])} mm tall, over the {_mm(RIB_HEIGHT * wall)} mm ({RIB_HEIGHT:g} walls) a mould fills and releases")
        if faults:
            lines.append(f"{name}: the rib at {_at(one['at'])}, on a {_mm(wall)} mm wall, is {' and '.join(faults)}.")
    return lines


def _bosses_lines(name, shape, rays, made, by=None):
    """Each boss boss() made on the part whose wall round its hole is thicker than the wall beside it allows, a line each."""
    lines = []
    for one in made:
        if one["kind"] != "boss" or not one.get("hole"):
            continue
        _in_time(by)
        at, way = numpy.array(one["at"]), numpy.array(one["way"])
        ring = (one["diameter"] - one["hole"]) / 2
        side = numpy.cross(way, [1.0, 0, 0] if abs(way[0]) < 0.9 else [0, 1.0, 0])
        side /= numpy.linalg.norm(side)
        if not _inside(shape, at + side * (one["hole"] + ring) / 2 + way * min(one["height"] / 2, 0.5)):
            continue
        wall = None
        for turn in (side, -side, numpy.cross(way, side), -numpy.cross(way, side)):
            wall = _wall_beside(rays, at + turn * one["diameter"] / 2, turn, way)
            if wall is not None:
                break
        if wall is None:
            continue
        share = BOSS_SHARE if wall <= BOSS_THICK_WALL else BOSS_SHARE_THICK
        if ring > share * wall + 1e-6:
            lines.append(
                f"{name}: the boss at {_at(at)}, Ø{_mm(one['diameter'])} round a Ø{_mm(one['hole'])} hole, has a wall of {_mm(ring)} mm, "
                f"over the {_mm(share * wall)} mm ({share:g} of the {_mm(wall)} mm wall beside it) that keeps the face behind it from sinking."
            )
    return lines


# ---- milled -------------------------------------------------------------------------------------


def _milled_line(name, shape, by=None):
    corners = _whole(forms.inner_corners(shape, bd.Vector(0, 0, 1), deadline=by))
    sharp = [one for one in corners if one["radius"] < forms.NEAR]
    tight = [one for one in corners if forms.NEAR <= one["radius"] < CORNER_DEPTH_SHARE * one["depth"] - 1e-6]
    if not sharp and not tight:
        return None
    said = []
    if sharp:
        listed = ", ".join(f"{_mm(one['depth'])} mm deep at {_at(one['at'])}" for one in sharp[:PLACES])
        more = f", and {len(sharp) - PLACES} more" if len(sharp) > PLACES else ""
        said.append(f"{len(sharp)} sharp inside {'corner' if len(sharp) == 1 else 'corners'} along the tool, where an end mill leaves its own radius: {listed}{more}")
    if tight:
        tight.sort(key=lambda one: one["radius"] / one["depth"])
        listed = ", ".join(
            f"R{_mm(one['radius'])} {_mm(one['depth'])} mm deep at {_at(one['at'])}, under R{_mm(CORNER_DEPTH_SHARE * one['depth'])}" for one in tight[:PLACES]
        )
        more = f", and {len(tight) - PLACES} more" if len(tight) > PLACES else ""
        said.append(f"{len(tight)} inside {'corner' if len(tight) == 1 else 'corners'} rounded tighter than a third of their depth, the smallest tool that reaches it: {listed}{more}")
    return f"{name}, milled with the tool along Z: {'; '.join(said)}."


# ---- sheet --------------------------------------------------------------------------------------


def _unfolds(shape, found, thickness, by=None):
    """
    Whether the bends lie flat when unfolded: each a round between flat
    faces along its axis, and at its ends only the sheet's cut edges. A
    corner rounded where three walls meet, as a shelled box's, joins a wall
    at its end and does not unfold.
    """
    beside = {}
    faces = forms.Faces(shape)
    for edge, pair, _ in faces.edges(by):
        for one, other in ((pair[0], pair[1]), (pair[1], pair[0])):
            beside.setdefault(hash(one), []).append((other, edge))
    if faces.done < faces.count():
        raise OutOfTime()
    for bend in found:
        for face in (bend["inside"], bend["outside"]):
            for other, edge in beside.get(hash(face), []):
                straight = forms.line(edge)
                if straight is not None and forms.parallel(straight, bend["axis"]):
                    if forms.plane(other) is None:
                        return False
                elif not sheet_rules.narrow(other, thickness):
                    return False
    return True


def sheet(shape, by=None):
    """
    A part bent from sheet: its thickness and its bends, or nothing for a
    part that is not one. A part is sheet when its bends agree on one
    thickness, it is that thick nearly everywhere, its faces are flat or
    round about one axis, as a press brake leaves them, and its bends lie
    flat unfolded; a shell rounded at its corners has curves both ways or
    corners that do not unfold.
    """
    if any(face.geom_type not in (bd.GeomType.PLANE, bd.GeomType.CYLINDER) for face in shape.faces()):
        return None
    found = _whole(forms.bends(shape, deadline=by))
    if not found:
        return None
    thickness = float(numpy.median([one["thickness"] for one in found]))
    found = [one for one in found if abs(one["thickness"] - thickness) < 0.02 * thickness]
    if not _unfolds(shape, found, thickness, by):
        return None
    _, _, measured, _, _ = thicknesses(shape, 600, by)
    if not len(measured) or abs(numpy.median(measured) - thickness) > 0.05 * thickness or numpy.percentile(measured, 95) > 1.15 * thickness:
        return None
    return {"thickness": thickness, "bends": found}


def flat(shape):
    """
    A flat part's thickness, as one cut from sheet: a prism square to its
    largest face, which is flat, its faces flat or round about that way; or
    nothing for a part that is not one.
    """
    faces = shape.faces()
    largest = max(faces, key=lambda face: face.area, default=None)
    found = forms.plane(largest) if largest is not None else None
    if found is None:
        return None
    normal = found[0]
    for face in faces:
        across = forms.plane(face) or forms.cylinder(face)
        if across is None:
            return None
        if forms.cylinder(face) is not None:
            if not forms.parallel(across[0], normal):
                return None
        elif not (forms.parallel(across[0], normal) or abs(across[0].dot(normal)) < 1e-6):
            return None
    heights = [bd.Vector(*v).dot(normal) for v in shape.vertices()]
    thickness = max(heights) - min(heights)
    if thickness < forms.NEAR or abs(shape.volume - largest.area * thickness) > 0.01 * shape.volume:
        return None
    return thickness


def _sheet_line(name, shape, bent, declared=False, by=None):
    t = bent["thickness"]
    said = []
    tight = [one for one in bent["bends"] if one["radius"] < sheet_rules.least_radius(t) - 1e-6]
    for one in tight[:PLACES]:
        said.append(f"a bend at {_at(one['inside'].position_at(0.5, 0.5))} with an inside radius of {_mm(one['radius'])} mm, under the {_mm(sheet_rules.least_radius(t))} mm thickness, which cracks the outside of most sheet")
    least_flange = sheet_rules.least_flange(t)
    short = sorted((one for one in _whole(forms.flanges(shape, bent["bends"], deadline=by)) if one[0] < least_flange - 1e-6), key=lambda one: one[0])
    # A flange's two faces, the inside and the outside of its bend, are one flange.
    legs = []
    for reach, at in short:
        if not any(abs(reach - other) < 1e-3 and numpy.linalg.norm(numpy.array(tuple(at)) - numpy.array(tuple(there))) < 1.5 * t for other, there in legs):
            legs.append((reach, at))
    for reach, at in legs[:PLACES]:
        said.append(f"a flange {_mm(reach)} mm long at {_at(at)}, under the {_mm(least_flange)} mm ({sheet_rules.FLANGE_WORDS}) a press brake holds")
    said += _holes_said(shape, t, bent["bends"], by)
    if not said:
        return None
    taken = "" if declared else " It is taken for sheet by its shape: show it with making= naming how it is made, if not."
    return f"{name}, bent from {_mm(t)} mm sheet with {len(bent['bends'])} {'bend' if len(bent['bends']) == 1 else 'bends'}: {'; '.join(said)}.{taken}"


def _holes_said(shape, t, bends, by=None):
    """Each round hole of a sheet `t` thick too near a bend or one of its cut edges, in words."""
    said = []
    edges = sheet_rules.cut_edges(shape, t)
    edge_limit = sheet_rules.least_to_edge(t)
    for hole in _whole(forms.hole_walls(shape, deadline=by)):
        _in_time(by)
        nearest = sheet_rules.to_bend(hole, bends, t)
        if nearest is not None and nearest[0] < -1e-6:
            _, near_bend, least, radius = nearest
            said.append(f"a Ø{_mm(2 * hole['radius'])} hole at {_at(hole['at'])} {_mm(near_bend)} mm from a bend, under the {_mm(least)} mm ({sheet_rules.to_bend_words(radius)}) that keeps it round as the sheet bends")
            continue
        near_edge = sheet_rules.to_edge(hole, edges)
        if near_edge < edge_limit - 1e-6:
            said.append(f"a Ø{_mm(2 * hole['radius'])} hole at {_at(hole['at'])} {_mm(near_edge)} mm from an edge, under the {_mm(edge_limit)} mm ({sheet_rules.EDGE_WORDS}) a {_mm(t)} mm sheet keeps")
    return said


# ---- the checks, by part ------------------------------------------------------------------------


def checked(parts, ways, made, by=None):
    """
    Each fault the checks for its way of making find in the parts, a line
    each, and the parts left unchecked for want of time.
    """
    lines, unchecked = [], []
    for name, shape in parts:
        how = ways.get(name) or {}
        method = how.get("method")
        # Each check's line as it is made, so those made before the time runs out are kept.
        said = []
        try:
            _in_time(by)
            said.append(_voids_line(name, shape, method))
            if method == "moulded":
                rays = _rays(shape)
                # Meshed once for both measures: meshing a part takes as long again each time.
                mesh = _part_mesh(shape)
                said.append(_undercuts_line(name, shape, how, mesh, by))
                said.append(_thick_line(name, shape, mesh, by))
                said += _ribs_lines(name, shape, rays, by)
                said += _bosses_lines(name, shape, rays, made, by)
            elif method == "milled":
                said.append(_milled_line(name, shape, by))
            elif method in (None, "sheet"):
                said.append(_sheet_said(name, shape, method == "sheet", by))
        except OutOfTime:
            unchecked.append(name)
        except Exception as problem:  # noqa: BLE001 - a check the kernel cannot make is said, and the build stands
            # A part whose way of making nothing names is only looked at, and says nothing it could not look at.
            if method:
                said.append(f"{name} could not be checked for the way it is made: {str(problem).strip() or type(problem).__name__}.")
        lines += [one for one in said if one]
    return lines, unchecked


def _sheet_said(name, shape, declared, by=None):
    """What the sheet checks find of a part bent from sheet, or shown as sheet, flat or not."""
    bent = sheet(shape, by)
    if bent is not None:
        return _sheet_line(name, shape, bent, declared, by)
    if not declared:
        return None
    t = flat(shape)
    if t is not None:
        said = _holes_said(shape, t, [], by)
        return f"{name}, flat {_mm(t)} mm sheet: {'; '.join(said)}." if said else None
    return f"{name}, shown as sheet, has no bend of one thickness to check: each bend is an inside and an outside round face about one axis, their radii differing by the sheet's thickness."
