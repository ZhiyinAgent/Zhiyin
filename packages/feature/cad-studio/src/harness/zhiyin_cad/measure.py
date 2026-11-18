"""
What a part is, measured from its exact shape: whether it is a valid solid,
its size, volume, area and centre of mass, its faces by kind, its outside
edges by kind, the round holes in it, which parts overlap which, and what nothing holds. Sizes are in millimetres, as the
kernel gives them: the answer's words round them, once.
"""

import itertools
import math
import time

import build123d as bd
import numpy
from OCP.Bnd import Bnd_Box
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.TopAbs import TopAbs_IN, TopAbs_ON

from . import nearness
from .edge_kinds import edges_by_kind

# Below what the kernel itself can tell apart, in millimetres.
NEAR = 1e-6
FULL_TURN = 2 * math.pi - 1e-6


def exact(value):
    """A measure without the float's last digits of noise."""
    return round(float(value), 9)


def point(vector):
    return [exact(vector.X), exact(vector.Y), exact(vector.Z)]


def kind_of(face):
    """A face's kind as a word: plane, cylinder, cone, sphere, torus, or freeform."""
    name = str(face.geom_type).rpartition(".")[2].lower()
    return name if name in ("plane", "cylinder", "cone", "sphere", "torus") else "freeform"


def _frame(direction):
    """Two directions square to an axis and to each other, the same for every face on it."""
    other = bd.Vector(1, 0, 0) if abs(direction.X) < 0.9 else bd.Vector(0, 1, 0)
    first = direction.cross(other).normalized()
    return first, direction.cross(first)


def bore(face):
    """
    A cylindrical face as a hole's wall, if it faces its own axis: its axis
    as a line, its radius, the turn it covers and its stretch along the axis.
    A round bar's faces look away from their axis, and are none. The turn is
    told in a frame of the axis's own, not the face's, so the halves of a
    wall from two surfaces, as a mirror or another CAD program makes them,
    cover one turn together.
    """
    surface = BRepAdaptor_Surface(face.wrapped)
    cylinder = surface.Cylinder()
    axis = cylinder.Axis()
    origin = bd.Vector(axis.Location().X(), axis.Location().Y(), axis.Location().Z())
    direction = bd.Vector(axis.Direction().X(), axis.Direction().Y(), axis.Direction().Z()).normalized()
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face.wrapped)
    on = surface.Value((u0 + u1) / 2, (v0 + v1) / 2)
    middle = bd.Vector(on.X(), on.Y(), on.Z())
    away = middle - origin
    radial = away - direction * away.dot(direction)
    if radial.length < NEAR or radial.dot(face.normal_at(middle)) >= 0:
        return None
    v_middle = (v0 + v1) / 2
    # One direction and one point for every face on the same line.
    if (direction.X, direction.Y, direction.Z) < (0, 0, 0):
        direction = -direction
        v0, v1 = -v1, -v0
    along = origin.dot(direction)
    foot = origin - direction * along
    length = u1 - u0
    if length >= FULL_TURN:
        turn = (0.0, 2 * math.pi)
    else:
        first, second = _frame(direction)

        def angle(u):
            p = surface.Value(u, v_middle)
            w = bd.Vector(p.X(), p.Y(), p.Z()) - foot
            return math.atan2(w.dot(second), w.dot(first)) % (2 * math.pi)

        start, middle, end = angle(u0), angle((u0 + u1) / 2), angle(u1)
        # The face turns from its start to its end one way or the other: its
        # middle says which.
        turn = (start, length) if (middle - start) % (2 * math.pi) < math.pi else (end, length)
    return {
        "line": (direction, foot),
        "radius": cylinder.Radius(),
        "turn": turn,
        "span": (along + v0, along + v1),
    }


def same_line(a, b):
    (d1, p1), (d2, p2) = a, b
    return (d1 - d2).length < NEAR and (p1 - p2).length < NEAR


def covered(turns):
    """How much of a full turn some arcs, each a start and a length, cover together, in radians."""
    pieces = []
    for start, length in turns:
        if length >= FULL_TURN:
            return 2 * math.pi
        start %= 2 * math.pi
        end = start + length
        if end > 2 * math.pi:
            pieces += [(start, 2 * math.pi), (0.0, end - 2 * math.pi)]
        else:
            pieces.append((start, end))
    pieces.sort()
    total, reach = 0.0, 0.0
    for start, end in pieces:
        if end > reach:
            total += end - max(start, reach)
            reach = end
    return total


def _inside(point, walls):
    """Whether a point lies within the bore of one of these stretches of hole wall."""
    for (direction, foot), radius, low, high in walls:
        w = point - foot
        along = point.dot(direction)
        if low - NEAR <= along <= high + NEAR and (w - direction * w.dot(direction)).length < radius - NEAR:
            return True
    return False


def holes_in(shape):
    """
    The diameters of the round holes in a part, each with how many. A hole is
    a wall all the way round its axis: the faces on one line, of one radius,
    that cover a whole turn together, and meet along it or are parted only
    where another hole crosses. A fillet, a notch or a slot's round end covers
    part of one, and is no hole.
    """
    bores = [b for b in (bore(f) for f in shape.faces().filter_by(bd.GeomType.CYLINDER)) if b]
    groups = []
    for wall in bores:
        for group in groups:
            first = group[0]
            if abs(first["radius"] - wall["radius"]) < NEAR and same_line(first["line"], wall["line"]):
                group.append(wall)
                break
        else:
            groups.append([wall])
    # Walls that meet along the line are one stretch; those that go all the way round are walls of holes.
    stretches = []
    for group in groups:
        group.sort(key=lambda b: b["span"][0])
        runs = [[group[0]]]
        for wall in group[1:]:
            if wall["span"][0] <= max(b["span"][1] for b in runs[-1]) + NEAR:
                runs[-1].append(wall)
            else:
                runs.append([wall])
        stretches.append(
            [
                (run[0]["line"], run[0]["radius"], run[0]["span"][0], max(b["span"][1] for b in run))
                for run in runs
                if covered([b["turn"] for b in run]) >= FULL_TURN
            ]
        )
    walls = [wall for stretch in stretches for wall in stretch]
    found = {}
    for stretch in stretches:
        holes = []
        for line, radius, low, high in stretch:
            direction, foot = line
            others = [wall for wall in walls if not same_line(wall[0], line)]
            # Apart along the line, walls are two holes, unless only another hole parts them.
            if holes and all(
                _inside(foot + direction * (holes[-1] + (low - holes[-1]) * share), others)
                for share in (0.25, 0.5, 0.75)
            ):
                holes[-1] = high
            else:
                holes.append(high)
        if holes:
            diameter = exact(stretch[0][1] * 2)
            found[diameter] = found.get(diameter, 0) + len(holes)
    return [{"diameter": d, "count": n} for d, n in sorted(found.items())]


def _material(solids):
    """
    The material its solids make where two of them overlap, as one shape that
    counts each place once, and the volume they share; nothing where none do.
    """
    if len(solids) < 2:
        return None, 0.0
    boxes = [(point(s.bounding_box().min), point(s.bounding_box().max)) for s in solids]
    if not any(
        all(low_a[i] < high_b[i] and low_b[i] < high_a[i] for i in range(3))
        for (low_a, high_a), (low_b, high_b) in itertools.combinations(boxes, 2)
    ):
        return None, 0.0
    total = sum(s.volume for s in solids)
    union = solids[0].fuse(*solids[1:]).clean()
    shared = total - union.volume
    return (union, shared) if shared > NEAR * max(1.0, total) else (None, 0.0)


def material(shape):
    """
    The material a part makes, as one shape that counts each place once, and
    the volume its solids share: the part itself when none overlap. Its
    measurements and its requirements are of this.
    """
    union, shared = _material(list(shape.solids()))
    return (union if union is not None else shape), shared


def measured(name, shape, valid=None, made=None, groups=None):
    """
    A part's measurements, by the material it makes (`made`, from
    `material`, worked out here when not given), and its named surfaces'
    groups, `groups`, by how many faces each holds.
    """
    box = shape.bounding_box()
    solids = shape.solids()
    # Solids that overlap are measured by the material they make.
    material_made, shared = made if made is not None else material(shape)
    volume = sum(s.volume for s in solids) - shared
    faces = {}
    for face in material_made.faces():
        kind = kind_of(face)
        faces[kind] = faces.get(kind, 0) + 1
    part = {
        "name": name,
        # An empty or self-crossing solid can say it is valid; one with no
        # volume is not a part.
        "valid": bool(shape.is_valid if valid is None else valid) and volume > 1e-9,
        "solids": len(solids),
        "size": point(box.size),
        "min": point(box.min),
        "max": point(box.max),
        "volume": exact(volume),
        "area": exact(material_made.area),
        "centre": point(material_made.center(bd.CenterOf.MASS)) if volume > 1e-9 else None,
        "faces": faces,
        "edges": edges_by_kind(material_made),
        "holes": holes_in(material_made),
    }
    if shared:
        part["shared"] = exact(shared)
    if not part["valid"]:
        from .faults import faults

        part["faults"] = faults(shape)
    if groups:
        part["surfaces"] = {group: len(faces) for group, faces in groups.items()}
    return part


def boxes_meet(first, second):
    """Whether two bounding boxes meet or touch."""
    low_a, high_a, low_b, high_b = (point(v) for v in (first.min, first.max, second.min, second.max))
    return all(low_a[i] <= high_b[i] and low_b[i] <= high_a[i] for i in range(3))


# Solids nearer than this, in mm, touch.
TOUCH = 0.01
# A piece this near another, in mm, is held by it: a pin turning in its bore
# or a piston sliding in its cylinder keeps a running clearance from it.
HELD = 1.0


def _near(a, b, reach=HELD):
    """Whether two bounding boxes come within `reach` of each other."""
    low_a, high_a, low_b, high_b = (tuple(v) for v in (a.min, a.max, b.min, b.max))
    return all(low_a[i] <= high_b[i] + reach and low_b[i] <= high_a[i] + reach for i in range(3))


class _Piece:
    """One solid of a part, with its box, a point on it, and a classifier of points against it, made when first needed."""

    def __init__(self, part, solid):
        self.part, self.solid = part, solid
        self.box = solid.bounding_box()
        corners = solid.vertices()
        self.point = (corners[0].center() if corners else solid.faces()[0].center()).to_pnt()
        self._classifier = None
        self._surface = None

    def surface(self):
        """Its surface as a mesh, made when first needed."""
        if self._surface is None:
            self._surface = nearness.Surface(self.solid)
        return self._surface

    def shell(self):
        """Its surface alone: every face, as one compound."""
        return bd.Compound(children=self.solid.faces()).wrapped

    def holds(self, point):
        """Whether a point lies in this solid or on it, to within TOUCH."""
        # Outside its box it cannot; and there the kernel's classifier, casting
        # rays at curved faces, can wrongly say a far point is inside.
        low, high = tuple(self.box.min), tuple(self.box.max)
        if not all(low[i] - TOUCH <= c <= high[i] + TOUCH for i, c in enumerate((point.X(), point.Y(), point.Z()))):
            return False
        if self._classifier is None:
            self._classifier = BRepClass3d_SolidClassifier(self.solid.wrapped)
        self._classifier.Perform(point, TOUCH)
        return self._classifier.State() in (TopAbs_IN, TopAbs_ON)


def _one_in_other(a, b, reach=None):
    """
    Whether a point on either solid lies in the other or on it. One point
    finds a solid lying wholly in another, whose surfaces may be far apart;
    any other way two solids meet, their surfaces meet too, which the meshes
    find. Every corner, classified against a solid of curved faces, took the
    kernel seconds a pair.
    """
    return b.holds(a.point) or a.holds(b.point)


def _mesh_held(a, b, reach=HELD):
    """Whether two solids' meshes show their surfaces within `reach` of each other."""
    return nearness.near(a.surface(), b.surface(), reach)


def _held(a, b, reach=HELD):
    """
    Whether two solids' surfaces come within `reach` of each other, measured
    exactly. Their shells, not the solids: measuring solids, the kernel also
    asks whether one lies inside the other, and on curved faces can wrongly
    find it does; that one lies in the other is the corners' question.
    """
    measure = BRepExtrema_DistShapeShape(a.shell(), b.shell())
    return measure.IsDone() and measure.Value() <= reach


def loose(parts, seconds=None, printed=()):
    """
    What nothing holds, as a part floating where it was put: each piece of
    a part made of several that is held by no other piece, its own part's or
    another's, and, where parts are assembled, so that two or more are held
    by another, each part that none holds. A piece is held by one it lies in,
    on, against or within HELD of, as a pin turning in its bore is. Parts
    laid out apart, as for printing, hold none and are no assembly. A part
    named in `printed` is meant to print, so a piece of it is held by
    another piece of it only where they touch: a gap between them, however
    small, prints as two objects.

    One point of a piece lying in another shows it held at little cost, and
    their meshes most of the rest; only what that leaves is measured
    exactly, which on curved faces is slow. All of it takes at most
    `seconds`: when that runs out, it names none, and says unchecked the
    parts with a piece not yet found held, or not yet found held by
    another part; every other part was.
    """
    pieces = [_Piece(name, solid) for name, shape in parts for solid in shape.solids()]
    if len(pieces) < 2:
        return {"parts": [], "pieces": []}
    deadline = time.time() + seconds if seconds is not None else None
    touched = [False] * len(pieces)
    touching = {name: False for name, _ in parts}
    printed = set(printed)

    def reach(i, j):
        """How near two pieces must come for one to hold the other."""
        return TOUCH if pieces[i].part == pieces[j].part and pieces[i].part in printed else HELD

    near = [[j for j in range(len(pieces)) if j != i and _near(pieces[i].box, pieces[j].box, reach(i, j))] for i in range(len(pieces))]
    # A piece's own part's first: a bearing's ball lies in its races, and far
    # from most of what its box comes near, which is slow to rule out.
    for i, these in enumerate(near):
        these.sort(key=lambda j, i=i: pieces[j].part != pieces[i].part)
    ran_out = False
    answers = {}

    def met(i, j):
        touched[i] = touched[j] = True
        if pieces[i].part != pieces[j].part:
            touching[pieces[i].part] = touching[pieces[j].part] = True

    def settle(pairs_of, settled):
        """Each of a set of questions settled by the first pair held: by corners, by meshes, then exactly, while time lasts."""
        nonlocal ran_out
        for test in (_one_in_other, _mesh_held, _held):
            for key, pairs in pairs_of():
                if settled(key):
                    continue
                for i, j in pairs:
                    if test is not _one_in_other and deadline is not None and time.time() > deadline:
                        ran_out = True
                        return
                    # A pair the pieces asked already, the parts ask again.
                    asked = (test, min(i, j), max(i, j))
                    if asked not in answers:
                        answers[asked] = test(pieces[i], pieces[j], reach(i, j))
                    if answers[asked]:
                        met(i, j)
                        break

    # Each piece, by what is near it; then each part touching none of another, by its pieces'.
    settle(lambda: [(i, [(i, j) for j in near[i]]) for i in range(len(pieces)) if not touched[i]], lambda i: touched[i])
    settle(
        lambda: [
            (name, [(i, j) for i, piece in enumerate(pieces) if piece.part == name for j in near[i] if pieces[j].part != name])
            for name, was in touching.items()
            if not was
        ],
        lambda name: touching[name],
    )
    if ran_out:
        # Each part with a piece not found held, or not found held by another part: the rest are.
        left = {piece.part for piece, was in zip(pieces, touched) if not was} | {name for name, was in touching.items() if not was}
        return {"parts": [], "pieces": [], "unchecked": True, "left": [name for name, _ in parts if name in left]}
    assembled = sum(touching.values()) >= 2
    alone = [name for name, _ in parts if assembled and not touching[name]]
    counts = {}
    for piece, was in zip(pieces, touched):
        held = counts.setdefault(piece.part, [0, 0])
        held[1] += 1
        held[0] += 0 if was else 1
    return {
        "parts": alone,
        "pieces": [
            {"part": name, "loose": count, "of": total, **({"printed": True} if name in printed else {})}
            for name, (count, total) in counts.items()
            if total > 1 and count and name not in alone
        ],
    }


def objects(shape, seconds=None):
    """
    How many separate objects a part's solids print as: solids that touch or
    overlap, to within TOUCH, are one. Nothing when that is not found within
    `seconds`.
    """
    pieces = [_Piece(None, solid) for solid in shape.solids()]
    group = list(range(len(pieces)))

    def top(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    deadline = time.time() + seconds if seconds is not None else None
    for i, j in itertools.combinations(range(len(pieces)), 2):
        if top(i) == top(j) or not _near(pieces[i].box, pieces[j].box, TOUCH):
            continue
        if deadline is not None and time.time() > deadline:
            return None
        a, b = pieces[i], pieces[j]
        if _one_in_other(a, b) or _mesh_held(a, b, TOUCH) or _held(a, b, TOUCH):
            group[top(i)] = top(j)
    return len({top(i) for i in range(len(pieces))})


def overlaps(parts):
    """Each pair of parts that share volume, with how much and the box it lies in."""
    # Each part's box and each of its solids', measured once: an exact box of
    # curved faces takes the kernel a second on a crankshaft, far longer than
    # cutting two parts with each other.
    boxed = [Boxed(name, shape) for name, shape in parts]
    return [found for first, second in itertools.combinations(boxed, 2) if (found := shared(first, second))]


class Boxed:
    """A part with its box and each of its solids with its own, measured when first needed, and its volume."""

    def __init__(self, name, shape):
        self.name, self.shape = name, shape
        self._boxes = None
        self._volume = None

    def boxes(self):
        """Its box, and each of its solids with its own."""
        if self._boxes is None:
            self._boxes = _boxes(self.shape)
        return self._boxes

    @property
    def volume(self):
        if self._volume is None:
            self._volume = self.shape.volume
        return self._volume

    def moved(self, shape, rotation, offset):
        """
        The part moved as one piece to `shape` by `rotation`, a 3 x 3 matrix,
        then `offset`: each box round the corners of its own box moved so,
        which still holds the solid, and its volume as it was.
        """
        box, solids = self.boxes()
        placed = shape.solids() or [shape]
        other = Boxed(self.name, shape)
        other._boxes = (_moved_box(box, rotation, offset), [(solid, _moved_box(own, rotation, offset)) for solid, (_, own) in zip(placed, solids)])
        other._volume = self._volume
        return other


def _moved_box(box, rotation, offset):
    """The box round the corners of `box` turned by `rotation` then moved by `offset`."""
    low, high = tuple(box.min), tuple(box.max)
    corners = numpy.array([(x, y, z) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]) @ numpy.asarray(rotation).T + offset
    moved = Bnd_Box()
    moved.Update(*corners.min(axis=0), *corners.max(axis=0))
    return bd.BoundBox(moved)


def shared(first, second):
    """What two parts, each Boxed, share: how much and the box it lies in, or None when they share no volume."""
    box_a, solids_a = first.boxes()
    box_b, solids_b = second.boxes()
    if not boxes_meet(box_a, box_b):
        return None
    # Solid by solid: the kernel, cutting one compound of solids with
    # another that is turned, keeps only some of what they share.
    pieces, depth = [], 0.0
    for x, y in _meeting_solids(solids_a, solids_b):
        # Nothing when they do not meet; otherwise the solids they share.
        common = x.intersect(y)
        if common is None:
            continue
        these = [piece for piece in (common if isinstance(common, list) else [common]) if piece.volume > 0]
        if these:
            pieces += these
            depth = max(depth, _depth(these))
    if not pieces:
        return None
    volume = sum(piece.volume for piece in pieces)
    # More than the kernel's own error, measured against the smaller part.
    if not (volume > 1e-6 * max(1e-9, min(first.volume, second.volume)) and volume > 1e-6):
        return None
    boxes = [piece.bounding_box() for piece in pieces]
    low = [min(point(box.min)[i] for box in boxes) for i in range(3)]
    high = [max(point(box.max)[i] for box in boxes) for i in range(3)]
    return {"first": first.name, "second": second.name, "volume": exact(volume), "min": low, "max": high, "depth": exact(depth)}


def _boxes(shape):
    """A part's box, and each of its solids with its own; a part without solids stands for itself."""
    box = shape.bounding_box()
    solids = shape.solids()
    if len(solids) == 1:
        return box, [(solids[0], box)]
    return box, [(s, s.bounding_box()) for s in solids] or [(shape, box)]


def _meeting_solids(first, second):
    """The pairs of one part's solids and another's whose boxes meet."""
    for x, box_x in first:
        for y, box_y in second:
            if boxes_meet(box_x, box_y):
                yield x, y


# How many points of what two parts share are measured for how deep one goes into the other.
DEPTH_POINTS = 40
# A chord shorter than this is the ray meeting the face it starts on, in mm.
CHORD_START = 1e-4


def _depth(pieces):
    """
    How deep one part goes into the other, in mm: how thick the material
    they share is, twice the radius of the largest ball found inside it. A
    press fit shares a ring as thick as its interference, hundredths of a
    millimetre; a part placed through another, or lying wholly in it, or
    shown twice in one place, shares material as thick as that part. From
    points on the shared piece's faces, a ray goes straight in to where it
    leaves the piece, and the middle of that chord is as deep inside it as
    its distance to the piece's surface. The points include each face's
    middle, so a box or a cylinder is found as thick as it is; elsewhere the
    largest ball found is a lower bound.
    """
    deepest = 0.0
    for piece in pieces:
        rays = IntCurvesFace_ShapeIntersector()
        rays.Load(piece.wrapped, 1e-6)
        surface = bd.Compound(list(piece.faces()))
        faces = list(piece.faces())
        each = max(1, DEPTH_POINTS // max(1, len(faces)))
        for face in faces:
            for start in _within(face, each):
                try:
                    out = face.normal_at(start)
                except Exception:  # noqa: BLE001 - a point with no normal gives no chord
                    continue
                inward = gp_Dir(-out.X, -out.Y, -out.Z)
                rays.Perform(gp_Lin(gp_Pnt(start.X, start.Y, start.Z), inward), CHORD_START, 1e7)
                if not rays.IsDone():
                    continue
                hits = [rays.WParameter(i) for i in range(1, rays.NbPnt() + 1) if rays.WParameter(i) > CHORD_START]
                if not hits:
                    continue
                middle = start - out * (min(hits) / 2)
                radius = BRepExtrema_DistShapeShape(bd.Vertex(middle).wrapped, surface.wrapped).Value()
                deepest = max(deepest, 2 * radius)
    return deepest


def _within(face, count):
    """Points on a face away from its edges: its middle and up to count of its triangles' middles, brought onto the face."""
    try:
        corners, triangles = face.tessellate(0.05, 0.2)
    except Exception:  # noqa: BLE001 - a face the kernel cannot mesh gives no points
        return []
    step = max(1, len(triangles) // count)
    points = [face.closest_points(face.center())[0]]
    for triangle in triangles[::step]:
        middle = sum((corners[i] for i in triangle), bd.Vector()) / 3
        points.append(face.closest_points(middle)[0])
    return points
