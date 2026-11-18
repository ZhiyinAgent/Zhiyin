"""
Shaping helpers a script is given with show, no import needed: the forms real
parts have, built the way the kernel builds them reliably. Each answers a
build123d shape, and what it could not do as asked is said in the build's
answer rather than failing the script. Sizes are millimetres; a point is
(x, y, z) and a direction a vector or (x, y, z).

- round_edges(part, edges, radius): fillets that never fail the build.
- cast(face, height, draft, round): a casting's body, its sides drafted.
- boss, pad, rib: what stands on a part, sunk into it, its root rounded.
- cutaway(part, cutter): a cut whose faces are named "cut", for their own material.
- bolt_circle, bolt_row: real bolts on a face, with their holes.
- pipe(points, diameter): a tube with real bends; hose(start, end, ...) joins two ports.
- belt(pulleys, width, thickness): the exact belt round pulleys.
- sheet(outline, thickness, bends): sheet metal folded along lines, with its flat pattern.
- strength.shaft, .beam, .bolt, .bearing, .gear, .column: hand strength checks of the design's numbers.
- iso_fit("H7/g6", 25): ISO 286 limits of a hole, a shaft or a fit.
"""

import math

import build123d as bd

from . import bent_path, making, meshing, notes, surfaces
from .fits import iso_fit
from .sheet_metal import sheet
from .strength import strength

# How small a fillet round_edges tries before it leaves an edge sharp, as a share of the radius asked.
SMALLEST_SHARE = 0.25
# Each radius round_edges tries after one that does not fit, as a share of that one, down to the smallest.
RADIUS_STEP = 0.7
# How many times round_edges halves the gap between a radius that fits and the next larger one that does not.
RADIUS_REFINING = 3
# How near an edge must lie to the place an edge was, in mm, to be that edge after another changed.
SAME_EDGE = 1e-3


def _vector(value, name="a direction"):
    try:
        return bd.Vector(value)
    except Exception:  # noqa: BLE001 - said in the script's terms
        raise ValueError(f"{name} is (x, y, z), such as (0, 0, 1).") from None


def _where(vector):
    return "(" + ", ".join(f"{round(v, 1):g}" for v in (vector.X, vector.Y, vector.Z)) + ")"


def _part_name(part):
    return f"“{part.label}”" if getattr(part, "label", "") else "the part"


# ---- rounding -------------------------------------------------------------------------------


def _edge_mark(edge):
    """Where an edge is, to find it again after a fillet elsewhere changed the part around it."""
    return edge.position_at(0.5), edge.length


def _find_again(part, mark):
    """The part's edge through where an edge was, or None once a fillet has taken it."""
    middle, _ = mark
    box = bd.Vector(SAME_EDGE, SAME_EDGE, SAME_EDGE)
    for edge in part.edges():
        low, high = edge.bounding_box().min - box, edge.bounding_box().max + box
        if not all(tuple(low)[i] <= tuple(middle)[i] <= tuple(high)[i] for i in range(3)):
            continue
        if edge.distance_to(middle) <= SAME_EDGE:
            return edge
    return None


def _try_fillet(part, edges, radius):
    try:
        rounded = part.fillet(radius, edges)
    except Exception:  # noqa: BLE001 - a fillet the kernel cannot make
        return None
    if rounded is None or not rounded.is_valid:
        return None
    return rounded


def _sharp_only(part, edges):
    """
    The edges where the part's faces meet at an angle: a fillet rounds a
    corner, and an edge where a round already runs smoothly into a face, as
    along a rounded rectangle's sides, has none to round.
    """
    from OCP.collections import IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher as EdgeFaces
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.TopoDS import TopoDS

    faces_of = EdgeFaces()
    TopExp.MapShapesAndAncestors_s(part.wrapped, TopAbs_EDGE, TopAbs_FACE, faces_of)
    sharp = []
    for edge in edges:
        index = faces_of.FindIndex(edge.wrapped)
        if not index:
            raise ValueError(
                "round_edges: an edge given is not one of the part's. Take the edges from the part itself, "
                "after its cuts, such as part.edges().filter_by(Axis.Z)."
            )
        touching = []
        for face in faces_of.FindFromIndex(index):
            if not any(face.IsSame(other) for other in touching):
                touching.append(face)
        if len(touching) != 2:
            # A seam, where a face meets itself, is smooth; an edge of three faces is no fillet's.
            continue
        middle = edge.position_at(0.5)
        first, second = (bd.Face(TopoDS.Face(f)).normal_at(middle) for f in touching)
        if first.dot(second) < math.cos(math.radians(1.0)):
            sharp.append(edge)
    return sharp


def round_edges(part, edges, radius, smallest=None):
    """
    Rounds the part's edges with fillets of `radius` mm, as a casting or a
    machined part has them, and never fails the build: where the kernel
    cannot make a fillet that large, it rounds the edges together with the
    largest radius they all take, down to `smallest` (a quarter of the
    radius when left out); when not even that fits them all at once, it
    rounds them one at a time, each with the largest it takes, and leaves
    sharp what even `smallest` cannot round. The build's answer says the
    radius they got, or which edges got less and which stayed sharp, and
    where. Give the edges of the finished shape, such as
    part.edges().filter_by(Axis.Z), after its cuts. Answers the rounded part.
    """
    edges = list(edges) if not isinstance(edges, bd.Edge) else [edges]
    asked = len(edges)
    edges = _sharp_only(part, edges)
    if asked and not edges:
        notes.say(f"round_edges: the {asked} edges given of {_part_name(part)} are smooth already, so none was rounded.")
    if not edges:
        return part
    radius = float(radius)
    least = float(smallest) if smallest is not None else radius * SMALLEST_SHARE
    whole = _try_fillet(part, edges, radius)
    if whole is not None:
        notes.say(f"round_edges: rounded {len(edges)} {'edge' if len(edges) == 1 else 'edges'} of {_part_name(part)} by {radius:g} mm.")
        return whole
    # All the edges together first, so edges alike stay alike: the largest radius they all take.
    fits, together = _largest(lambda tried: _try_fillet(part, edges, tried), radius, least)
    if together is not None:
        notes.say(
            f"round_edges: rounded {len(edges)} {'edge' if len(edges) == 1 else 'edges'} of {_part_name(part)} by {fits:g} mm, "
            f"not the {radius:g} mm asked, as the shape around them leaves no room for more."
        )
        return together
    # Not even the smallest fits them all at once: one edge at a time, each at the largest radius the kernel can make there.
    marks = [_edge_mark(e) for e in edges]
    current, given, smaller, sharp = part, 0, [], []
    for mark in marks:
        edge = _find_again(current, mark)
        if edge is None:
            # Taken by a fillet of a neighbour, which rounds through it.
            given += 1
            continue
        fits, done = radius, _try_fillet(current, [edge], radius)
        if done is None:
            fits, done = _largest(lambda tried, on=current, edge=edge: _try_fillet(on, [edge], tried), radius, least)
        if done is None:
            sharp.append(mark[0])
            continue
        if fits < radius:
            smaller.append((fits, mark[0]))
        else:
            given += 1
        current = done
    said = [f"round_edges: of {len(edges)} edges of {_part_name(part)}, {given} rounded by {radius:g} mm"]
    if smaller:
        said.append(
            f"{len(smaller)} with less, as the shape around them leaves no room: "
            + ", ".join(f"{r:g} mm at {_where(w)}" for r, w in smaller[:6])
            + (f" and {len(smaller) - 6} more" if len(smaller) > 6 else "")
        )
    if sharp:
        said.append(
            f"{len(sharp)} left sharp, as not even {least:g} mm fits there: at "
            + ", ".join(_where(w) for w in sharp[:6])
            + (f" and {len(sharp) - 6} more" if len(sharp) > 6 else "")
            + ". Round them before the cuts that crowd them, or with a smaller radius"
        )
    notes.say("; ".join(said) + ".")
    return current


def _largest(fillet, radius, least):
    """
    The largest radius from `radius` down to `least` that `fillet(radius)`
    makes, with what it made, or (None, None) when not even `least` fits:
    falling by steps, `least` itself always tried, then closer between the
    radius that fits and the one above it that did not, to a tenth of a
    millimetre.
    """
    above, tried = radius, radius * RADIUS_STEP
    while True:
        # Two figures, as a radius is written on a drawing.
        rounded = float(f"{tried:.2g}")
        tried = max(rounded if rounded < above else tried, least)
        done = fillet(tried)
        if done is not None:
            break
        if tried <= least + 1e-9:
            return None, None
        above, tried = tried, tried * RADIUS_STEP
    fits = tried
    for _ in range(RADIUS_REFINING):
        between = math.floor((fits + above) / 2 * 10) / 10
        if between <= fits + 1e-9 or between >= above - 1e-9:
            break
        better = fillet(between)
        if better is None:
            above = between
        else:
            fits, done = between, better
    return round(fits, 4), done


# ---- castings and what stands on them -------------------------------------------------------


def cast(face, height, draft=2.0, round=None, direction=None):
    """
    A casting's body: `face` (a sketch, a face or a closed wire, such as a
    rounded rectangle) raised `height` mm along its normal, or `direction`,
    its sides drafted inward by `draft` degrees as a mould needs, and with
    `round` its sides and top edges rounded by that many mm. The drafted
    sides stay flat or conical, so later cuts and bosses join it reliably.
    Answers the part.
    """
    if isinstance(face, bd.Wire):
        face = bd.Face(face)
    amount = float(height)
    shape = bd.extrude(face, amount=amount, dir=_vector(direction) if direction is not None else None, taper=float(draft))
    # The way the mould leaves it, and a point inside it, for the checks of a moulded part.
    way = _vector(direction).normalized() if direction is not None else face.faces()[0].normal_at()
    making.note("cast", pull=way * (1 if amount >= 0 else -1), base=face.center(), height=amount)
    if round:
        # Not the edges it stands on, where it joins what it is cast with.
        base = list(face.edges())
        shape = round_edges(shape, [e for e in shape.edges() if not _on(e, base)], float(round))
    return shape


def _on(edge, among):
    middle = edge.position_at(0.5)
    return any(other.distance_to(middle) <= SAME_EDGE for other in among)


def _sunk(at, direction, height, sink):
    """Where a feature standing on a surface starts and how long it is: from inside the part out."""
    at, direction = _vector(at, "at"), _vector(direction).normalized()
    start = at - direction * sink
    return start, direction, height + sink


def _rounded_root(part, feature, at, direction, root):
    """The part with the feature joined, the edges where they meet rounded by `root` mm."""
    joined = part + feature
    if not root:
        return joined
    before = {_key(e) for e in part.edges()} | {_key(e) for e in feature.edges()}
    meeting = [e for e in joined.edges() if _key(e) not in before]
    return round_edges(joined, meeting, root) if meeting else joined


def _key(edge):
    middle = edge.position_at(0.5)
    return (round(middle.X, 3), round(middle.Y, 3), round(middle.Z, 3), round(edge.length, 3))


def boss(part, at, diameter, height, direction=(0, 0, 1), hole=None, hole_depth=None, root=None, sink=None):
    """
    A round boss standing `height` mm out of the part's surface at `at`,
    along `direction`, as one round a bolt hole or a shaft: it starts inside
    the part, by `sink` mm (a tenth of its diameter and at least 1 mm when
    left out), so it joins whatever the surface's shape. `hole` drills it
    through, `hole_depth` mm deep (its height and sink when left out); `root`
    rounds where it meets the part. Answers the part.
    """
    sink = float(sink) if sink is not None else max(1.0, 0.1 * float(diameter))
    start, way, length = _sunk(at, direction, float(height), sink)
    plane = bd.Plane(origin=start, z_dir=way)
    feature = plane * bd.Cylinder(float(diameter) / 2, length, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    result = _rounded_root(part, feature, at, way, root)
    making.note("boss", at=_vector(at, "at"), way=way, diameter=diameter, height=height, hole=hole)
    if hole:
        depth = float(hole_depth) if hole_depth is not None else length
        top = start + way * length
        drill = bd.Plane(origin=top, z_dir=-way) * bd.Cylinder(float(hole) / 2, depth, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        result = result - drill
    return result


def pad(part, at, size, height, direction=(0, 0, 1), round=None, root=None, sink=None, turn=0.0):
    """
    A flat pad standing `height` mm out of the part at `at`, `size` = (width,
    length) mm across, along `direction`, turned `turn` degrees about it: a
    mounting face, a flange or a machined seat. It starts `sink` mm inside
    the part (1 mm when left out); `round` rounds its corners, `root` where
    it meets the part. Answers the part.
    """
    sink = float(sink) if sink is not None else 1.0
    start, way, length = _sunk(at, direction, float(height), sink)
    plane = bd.Plane(origin=start, z_dir=way).rotated((0, 0, float(turn)))
    width, long = (float(v) for v in size)
    outline = bd.RectangleRounded(width, long, float(round)) if round else bd.Rectangle(width, long)
    feature = bd.extrude(plane * outline, amount=length)
    return _rounded_root(part, feature, at, way, root)


def rib(part, start, end, height, thickness, direction=(0, 0, 1), draft=1.0, root=None, sink=None):
    """
    A stiffening rib along the part's surface from `start` to `end`, standing
    `height` mm out along `direction`, `thickness` mm thick at its root and
    drafted thinner by `draft` degrees a side, as a casting's ribs are. It
    starts `sink` mm inside the part (1 mm when left out); `root` rounds
    where it meets the part. Answers the part.
    """
    sink = float(sink) if sink is not None else 1.0
    a, b = _vector(start, "start"), _vector(end, "end")
    way = _vector(direction).normalized()
    along = b - a
    need_length = along.length
    if need_length < 1e-6:
        raise ValueError("rib: start and end are the same point.")
    across = way.cross(along.normalized()).normalized()
    root_half = float(thickness) / 2
    tall = float(height) + sink
    top_half = max(0.05, root_half - tall * math.tan(math.radians(float(draft))))
    base = a - way * sink
    corners = [
        base - across * root_half,
        base + across * root_half,
        base + across * top_half + way * tall,
        base - across * top_half + way * tall,
    ]
    profile = bd.Face(bd.Wire.make_polygon(corners, close=True))
    feature = bd.extrude(profile, amount=need_length, dir=along.normalized())
    return _rounded_root(part, feature, a, way, root)


# ---- cutaways -------------------------------------------------------------------------------


def cutaway(part, cutter, name="cut"):
    """
    The part with `cutter` taken away, as a cutaway that shows the inside,
    its cut faces named as the surfaces `name` ("cut" when left out): the 3D
    studio gives them a material of their own, as a cutaway model's are
    painted. Answers the cut part.
    """
    result = part - cutter
    shell = bd.Compound(list(cutter.faces()))
    named = []
    for face in result.faces():
        point = _point_on(face)
        if point is not None and shell.distance_to(point) <= SAME_EDGE:
            named.append(face)
    surfaces.name(named, name)
    notes.say(f"cutaway: {len(named)} cut {'face' if len(named) == 1 else 'faces'} of {_part_name(part)} named “{name}”.")
    return result


def _point_on(face):
    """A point that lies on the face itself, not merely on its surface."""
    try:
        corners, triangles = face.tessellate(0.1, 0.5)
    except Exception:  # noqa: BLE001
        return None
    if not triangles:
        return None
    a, b, c = (corners[i] for i in triangles[0])
    # A triangle's middle lies off a curved face by up to the meshing's tolerance: bring it onto the face.
    return face.closest_points((a + b + c) / 3)[0]


# ---- fasteners ------------------------------------------------------------------------------


def _screw(size, length, head):
    from bd_warehouse.fastener import HexHeadScrew, SocketHeadCapScrew

    kind = {"hex": (HexHeadScrew, "iso4014"), "socket": (SocketHeadCapScrew, "iso4762")}.get(head)
    if kind is None:
        raise ValueError('head is "hex" or "socket".')
    maker, standard = kind
    known = maker.sizes(standard)
    full = size if size in known else next((s for s in sorted(known) if s.split("-")[0] == size), None)
    if full is None:
        raise ValueError(f"No {head} screw of size {size}: sizes are such as {', '.join(sorted(known)[:8])}.")
    screw = maker(full, float(length), standard, simple=True)
    return screw, screw.clearance_hole_diameters["Normal"]


def bolt_circle(part, centre, radius, count, size="M8", length=20, direction=(0, 0, 1), head="hex", start=0.0, holes=True):
    """
    `count` real bolts (ISO, from bd_warehouse) on a circle of `radius` mm
    round `centre`, a point on the part's face, their heads on the face and
    their shanks going in against `direction`, the way the face looks out;
    the first at `start` degrees. size is such as "M8"; head "hex" or
    "socket". With holes, each bolt's clearance hole is cut in the part.
    Answers (part, bolts): show the bolts as parts of their own, such as
    show(bolts, name="Cover bolt").
    """
    centre, way = _vector(centre, "centre"), _vector(direction).normalized()
    plane = bd.Plane(origin=centre, z_dir=way)
    places = [plane.location * loc for loc in bd.PolarLocations(float(radius), int(count), float(start))]
    return _bolts_at(part, places, size, length, head, holes)


def bolt_row(part, start, end, count, size="M8", length=20, direction=(0, 0, 1), head="hex", holes=True):
    """
    `count` real bolts evenly along the line from `start` to `end`, both on
    the part's face, as along a flange or a cover's edge; otherwise as
    bolt_circle. Answers (part, bolts).
    """
    a, b, way = _vector(start, "start"), _vector(end, "end"), _vector(direction).normalized()
    count = int(count)
    places = []
    for i in range(count):
        point = a + (b - a) * (i / (count - 1) if count > 1 else 0.5)
        places.append(bd.Plane(origin=point, z_dir=way).location)
    return _bolts_at(part, places, size, length, head, holes)


def _bolts_at(part, places, size, length, head, holes):
    screw, clearance = _screw(size, length, head)
    bolts = [screw.moved(place) for place in places]
    if holes:
        hole = bd.Cylinder(clearance / 2, float(length), align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX))
        cutters = [hole.moved(place) for place in places]
        part = part - bd.Compound(cutters)
    notes.say(f"bolts: {len(bolts)} {size} {head} bolts {float(length):g} mm long, holes of {clearance:g} mm" + (" cut" if holes else " not cut") + ".")
    return part, bolts


# ---- pipes, hoses and belts -----------------------------------------------------------------


def _section(start, tangent, diameter, wall):
    plane = bd.Plane(origin=start, z_dir=tangent)
    outer = bd.Circle(float(diameter) / 2)
    if wall:
        inner = float(diameter) / 2 - float(wall)
        if inner <= 0:
            raise ValueError("The wall is as thick as the pipe is wide.")
        return plane * (outer - bd.Circle(inner))
    return plane * outer


def _swept(path, diameter, wall):
    """A tube swept along the path, or None when the kernel cannot sweep it into a valid solid."""
    section = _section(path.position_at(0), path.tangent_at(0), diameter, wall)
    try:
        tube = bd.sweep(section, path=path, transition=bd.Transition.ROUND)
    except Exception:  # noqa: BLE001 - the kernel's failure, said in the helper's words
        return None
    if not tube.solids() or not tube.is_valid:
        return None
    return tube


def pipe(points, diameter, wall=None, bend=None):
    """
    A pipe through `points`, `diameter` mm across, its corners bent round
    with a radius of `bend` mm (one and a half diameters when left out), as
    a bent tube is: less at a corner whose runs are too short for it, and
    never as tight as its own radius, which would fold it through itself.
    `wall` makes it hollow. Answers the pipe, or None when a corner has no
    room for a bend that does not fold it, which the build's answer says.
    """
    points = [_vector(p, "a point") for p in points]
    if len(points) < 2:
        raise ValueError("A pipe runs through two points or more.")
    bend = float(bend) if bend is not None else 1.5 * float(diameter)
    # A bend no wider than the pipe's radius folds the pipe through itself: the
    # kernel passes it as valid, yet every cut or join through it comes back
    # broken. It is bent at the tightest radius that keeps it whole.
    tightest = bent_path.fold_limit(diameter)
    if len(points) > 2 and bend < tightest:
        notes.say(
            f"pipe: bent with a radius of {tightest:g} mm, not the {bend:g} mm asked: a bend tighter than the pipe's radius, "
            f"{float(diameter) / 2:g} mm, folds the pipe through itself."
        )
        bend = tightest
    try:
        path, corners = bent_path.bent(points, bend, tightest)
    except bent_path.Unbendable as short:
        folds = (
            f", and a pipe {float(diameter):g} mm across bends no tighter than {tightest:g} mm without folding through itself"
            if short.room is not None
            else ""
        )
        notes.say(f"pipe: not built, as {short.why}{folds}" + (f": {short.run}." if short.run else "."))
        return None
    less = [(corner, radius) for corner, radius in corners if radius < bend - 1e-6]
    if less:
        notes.say(
            "pipe: bent with a radius of "
            + ", ".join(f"{bent_path.down(radius)} mm at {bent_path.where(corner)}" for corner, radius in less)
            + f", not the {bend:g} mm asked, as the runs either side leave no room for more."
        )
    tube = _swept(path, diameter, wall)
    if tube is None:
        notes.say(f"pipe: not built, as the kernel could not sweep a pipe {float(diameter):g} mm across along its points.")
    return tube


def coil(diameter, wire, length, turns, at=(0, 0, 0), direction=(0, 0, 1), ground=True):
    """
    A coil spring of round wire, `diameter` mm across its outside, `wire` mm
    thick, `length` mm long and `turns` turns, standing at `at` along
    `direction`: one smooth sweep, meshed for viewing as fine as its wire
    needs. With `ground`, its ends are ground flat, so it stands square on
    its seat, as a valve spring does. Answers the spring.
    """
    diameter, wire, length, turns = float(diameter), float(wire), float(length), float(turns)
    if not 0 < wire < diameter / 2:
        raise ValueError("A coil's wire is thinner than half its diameter.")
    if turns <= 0 or length <= wire:
        raise ValueError("A coil has turns, and is longer than its wire is thick.")
    pitch = (length - wire) / turns
    if pitch <= wire:
        raise ValueError(
            f"{turns:g} turns of {wire:g} mm wire run into each other in {length:g} mm: "
            f"at most {int((length - wire) / wire * 0.999):d} fit, or make it longer."
        )
    # Half a turn more at each end, ground away to flat ends.
    extra = 1.0 if ground else 0.0
    helix = bd.Helix(
        pitch=pitch, height=pitch * (turns + extra), radius=(diameter - wire) / 2,
        center=(0, 0, wire / 2 - pitch * extra / 2),
    )
    section = bd.Plane(origin=helix.position_at(0), z_dir=helix.tangent_at(0)) * bd.Circle(wire / 2)
    spring = bd.sweep(section, path=helix, is_frenet=True)
    if ground:
        spring = spring & bd.Pos(0, 0, length / 2) * bd.Box(diameter * 2, diameter * 2, length)
    spring = bd.Location(bd.Plane(origin=_vector(at, "at"), z_dir=_vector(direction))) * spring
    # A fiftieth of the wire from its surface, and a sixth of a radian, is round to the eye.
    meshing.wire(spring.faces(), wire / 50, 0.35)
    notes.say(
        f"coil: {turns:g} turns of {wire:g} mm wire, {diameter:g} mm across and {length:g} mm long"
        + (", its ends ground flat." if ground else ".")
    )
    return spring


def _port(value, name):
    """A hose's end: a point with the way the hose leaves it, or a round face, whose middle and outward normal give both."""
    if isinstance(value, bd.Face):
        middle = value.center()
        return middle, value.normal_at(middle)
    point, way = value
    return _vector(point, name), _vector(way, f"{name}'s way").normalized()


def _reach(at, way, toward, keep_here, keep_there):
    """
    How far past the clamp a hose runs straight out of a port before it
    turns: half its way across to where it goes next, so a turn between two
    ports side by side is one wide arc, and never past halfway to a point
    ahead of it, where it would have to turn back.
    """
    ahead = (toward - at).dot(way)
    across = ((toward - at) - way * ahead).length
    reach = across / 2
    if ahead > 0:
        reach = min(reach, (ahead - keep_here - keep_there) / 2)
    return max(reach, 0.0)


def hose(start, end, diameter, via=(), inset=None, clamps=True, wall=None):
    """
    A flexible hose from one port to another, leaving each along the way it
    points, through the points `via`, each turn as wide as the room allows
    and never tight enough to fold it. A port is a round face, such as a
    pipe end's (its middle and its normal give where and which way), or
    (point, direction) with the direction pointing out of the port. Each
    end goes `inset` mm into its port (one diameter when left out), so it
    seats on it. With clamps, a band is put round each end. Answers (hose,
    clamps): show them as parts of their own. Ports too close for the hose
    to turn between them answer (None, []), and the build's answer says
    how much further apart they must be.
    """
    (a, a_way), (b, b_way) = _port(start, "start"), _port(end, "end")
    diameter = float(diameter)
    inset = float(inset) if inset is not None else diameter
    # Straight past each port's mouth as far as its clamp reaches.
    clamped = diameter * 0.6
    first, last = a - a_way * inset, b - b_way * inset
    middle = [_vector(p, "a via point") for p in via]
    # Toward the first point after each port, and the clamp at the other end when that is the next port.
    after_a, before_b = (middle[0] if middle else b), (middle[-1] if middle else a)
    other = 0.0 if middle else clamped
    out_a = a + a_way * (clamped + _reach(a, a_way, after_a, clamped, other))
    out_b = b + b_way * (clamped + _reach(b, b_way, before_b, clamped, other))
    tightest = bent_path.fold_limit(diameter)
    ports = f"from {bent_path.where(a)} to {bent_path.where(b)}"
    try:
        path, corners = bent_path.bent([first, out_a, *middle, out_b, last], None, tightest, (inset + clamped, inset + clamped))
    except bent_path.Unbendable as short:
        has = f"it has room for a bend of only {bent_path.down(short.room)} mm" if short.room is not None else short.why
        further = f": move them {bent_path.up(short.lacking)} mm further apart," if short.lacking else ","
        notes.say(
            f"hose: not laid {ports}, as a hose {diameter:g} mm across bends no tighter than {tightest:g} mm without folding "
            f"through itself, and between its ports {has}{further} or lead it round through via points."
        )
        return None, []
    tube = _swept(path, diameter, wall)
    if tube is None:
        notes.say(f"hose: not laid {ports}, as the kernel could not sweep a hose {diameter:g} mm across along its way.")
        return None, []
    bands = []
    if clamps:
        for point, way in ((a + a_way * (diameter * 0.4), a_way), (b + b_way * (diameter * 0.4), b_way)):
            plane = bd.Plane(origin=point - way * diameter * 0.2, z_dir=way)
            band = plane * bd.extrude(bd.Circle(diameter / 2 + 1.2) - bd.Circle(diameter / 2), amount=diameter * 0.4)
            bands.append(band)
    bend = bent_path.tightest(path)
    notes.say(
        f"hose: {path.length:.0f} mm long, {diameter:g} mm across, its ends {inset:g} mm into their ports"
        + (f", its tightest bend {bent_path.down(bend)} mm" if bend != float("inf") else ", straight")
        + (", with a clamp at each." if clamps else ".")
    )
    return tube, bands


def belt(pulleys, width, thickness=6.0, axis=(0, 0, 1)):
    """
    A belt round pulleys, exactly: `pulleys` lists each as (centre, radius)
    in the order the belt runs round them, the radius where the belt's inner
    face rides; give a negative radius for an idler the belt's back runs on,
    outside the loop. The pulleys turn about `axis` and their centres lie in
    one plane square to it. The belt is `width` mm wide along the axis,
    centred on the centres, and `thickness` mm thick. Answers the belt; its
    length and how far it wraps each pulley are in the build's answer.
    """
    axis = _vector(axis).normalized()
    centres = [_vector(c, "a pulley's centre") for c, _ in pulleys]
    radii = [float(r) for _, r in pulleys]
    if len(centres) < 2:
        raise ValueError("A belt runs round two pulleys or more.")
    plane = bd.Plane(origin=centres[0], z_dir=axis)
    flat = [plane.to_local_coords(c) for c in centres]
    if any(abs(p.Z) > 0.01 for p in flat):
        raise ValueError("The pulleys' centres are not in one plane square to the axis.")
    pts = [(p.X, p.Y) for p in flat]
    # The loop runs anticlockwise about the axis; a list given the other way is turned round.
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    order = list(range(len(pts)))
    if area < 0:
        order.reverse()
    t = float(thickness)
    # The belt's middle runs half its thickness off each pulley, on the side away from it.
    signed = [(1 if radii[i] > 0 else -1) * (abs(radii[i]) + t / 2) for i in order]
    centres2 = [pts[i] for i in order]
    count = len(order)
    leave, arrive = [None] * count, [None] * count
    for k in range(count):
        (x1, y1), (x2, y2) = centres2[k], centres2[(k + 1) % count]
        r1, r2 = signed[k], signed[(k + 1) % count]
        dx, dy = x2 - x1, y2 - y1
        span = math.hypot(dx, dy)
        cos = (r1 - r2) / span
        if abs(cos) > 1:
            raise ValueError("Two pulleys lie so close that the belt cannot run between them.")
        ex, ey = dx / span, dy / span
        best = None
        for sine in (math.sqrt(1 - cos * cos), -math.sqrt(1 - cos * cos)):
            nx, ny = cos * ex - sine * ey, cos * ey + sine * ex
            p1, p2 = (x1 + r1 * nx, y1 + r1 * ny), (x2 + r2 * nx, y2 + r2 * ny)
            tx, ty = -ny, nx
            if tx * (p2[0] - p1[0]) + ty * (p2[1] - p1[1]) > 0:
                best = (p1, p2)
        leave[k], arrive[(k + 1) % count] = best
    edges, wraps, total = [], [], 0.0

    def at(p):
        return plane.from_local_coords(bd.Vector(p[0], p[1], 0))

    for k in range(count):
        cx, cy = centres2[k]
        r = signed[k]
        a0 = math.atan2(arrive[k][1] - cy, arrive[k][0] - cx)
        a1 = math.atan2(leave[k][1] - cy, leave[k][0] - cx)
        sweep = (a1 - a0) % (2 * math.pi) if r > 0 else -((a0 - a1) % (2 * math.pi))
        mid = a0 + sweep / 2
        middle = (cx + abs(r) * math.cos(mid), cy + abs(r) * math.sin(mid))
        if abs(sweep) > 1e-6:
            edges.append(bd.Edge.make_three_point_arc(at(arrive[k]), at(middle), at(leave[k])))
        wraps.append(math.degrees(abs(sweep)))
        total += abs(r) * abs(sweep)
        nxt = arrive[(k + 1) % count]
        edges.append(bd.Edge.make_line(at(leave[k]), at(nxt)))
        total += math.dist(leave[k], nxt)
    middle_line = bd.Wire(edges)
    outer = middle_line.offset_2d(t / 2, kind=bd.Kind.ARC)
    inner = middle_line.offset_2d(-t / 2, kind=bd.Kind.ARC)
    if bd.Face(outer).area < bd.Face(inner).area:
        outer, inner = inner, outer
    band = bd.Face(outer, [inner])
    shape = bd.extrude(band, amount=float(width) / 2, both=True, dir=axis)
    wrapped = ", ".join(f"{w:.0f}°" for w in [wraps[order.index(i)] for i in range(len(order))])
    notes.say(f"belt: {total:.0f} mm long along its middle, wrapping the pulleys, in the order given, by {wrapped}.")
    return shape


GIVEN = {
    "round_edges": round_edges,
    "cast": cast,
    "boss": boss,
    "pad": pad,
    "rib": rib,
    "cutaway": cutaway,
    "bolt_circle": bolt_circle,
    "bolt_row": bolt_row,
    "pipe": pipe,
    "coil": coil,
    "hose": hose,
    "belt": belt,
    "sheet": sheet,
    "strength": strength,
    "iso_fit": iso_fit,
}
