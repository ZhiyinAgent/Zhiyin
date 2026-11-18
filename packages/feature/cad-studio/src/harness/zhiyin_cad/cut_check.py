"""
Cuts a script makes that would break the part they cut are skipped, and
said: one that leaves nothing of the part, one whose cutter is turned inside
out, and, when the run is thorough, one that leaves no valid solid. The part
is kept as it was before that cut, and the build's answer says where in the
script the cut is, what it cut, and where the cutter was. Only the script's
own cuts are checked, never build123d's or the harness's: a cut is the
script's when the script asks for it, by calling the kernel's cut itself,
by the minus operator, or by a builder's subtract, as an extrude or a Hole
in subtract mode makes; a cut build123d makes inside its own work, as a
tapered extrude of a face with a hole, a hollow sweep or a loft makes, is
its own. Checking every
cut's result is valid takes as long as a third of an engine's build, so a
run is thorough only when a part it showed came out broken.

A join or a cut the script asks for with a shape that has faces but no
volume, as a loft of sections that all lie in one plane gives, adds nothing
to the part and takes nothing away, without any error: each is said, with
where in the script it is and where the shape lies. An empty shape made
on purpose, as `Part()` to add to in a loop, holds no faces and is not one.

A cut of the script's that takes nothing away, its cutter clear of the
part, in a hollow of it or only touching its surface, is said too, with
where the cutter lies; so is each cutter of several whose box lies clear of
the part.
"""

import os
import traceback

import build123d as bd
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN

from . import interception

skipped = []
# Each join or cut that adds or takes nothing, and each solid lost from a builder, by where it is in the script and which it is.
empty = {}
# The run being checked: how its files are named, and whether each cut is checked to leave a valid solid.
_run = {"scripts": None, "thorough": False}

_inside = [os.path.normcase(os.path.dirname(os.path.abspath(path))) for path in (bd.__file__, __file__)]
# The interception's file, whose wrappers stand between an operation and whoever asked for it.
_WATCHING = os.path.normcase(os.path.abspath(interception.__file__))


def _box_text(shape):
    box = shape.bounding_box()
    size = " × ".join(f"{v:.4g}" for v in (box.size.X, box.size.Y, box.size.Z))
    middle = ", ".join(f"{v:.4g}" for v in (box.center().X, box.center().Y, box.center().Z))
    return f"{size} mm about ({middle})"


# The ways a script asks build123d for a cut or a join: the operators, and a builder's subtract or add.
_ASKING = {"__sub__", "__isub__", "__add__", "__iadd__", "_add_to_context"}
# A solid thinner than this along an axis, in mm, holds no volume.
FLAT = 1e-3


def _inside_ours(frame):
    """Whether a frame is build123d's or the harness's."""
    where = os.path.normcase(os.path.abspath(frame.filename)) if not frame.filename.startswith("<") else frame.filename
    return any(where.startswith(folder + os.sep) for folder in _inside)


def _caller(scripts, depth=2):
    """
    Where in the script's own files a cut was asked for, as file:line in
    function, or nothing for a cut of build123d's or the harness's own.
    `depth` is how many frames of the harness's own lie innermost.
    """
    # The innermost first, from the frame that called the kernel's cut
    # outward, past the interception's wrappers of the operations on the way.
    frames = [frame for frame in reversed(traceback.extract_stack()[:-depth]) if os.path.normcase(os.path.abspath(frame.filename)) != _WATCHING]
    if not frames:
        return None
    asker = frames[0]
    if _inside_ours(asker):
        # Within build123d, only the minus operator and a builder's
        # subtract cut for whoever called them; anything else is its own work.
        if asker.name not in _ASKING:
            return None
        frames = frames[1:]
        if asker.name != "_add_to_context":
            # The operator cuts for the frame that wrote it, past a subclass's
            # operator handing on to its parent's: the script's, or build123d's own.
            while frames and _inside_ours(frames[0]) and frames[0].name in _ASKING:
                frames = frames[1:]
            frames = frames[:1]
    for frame in frames:
        if _inside_ours(frame):
            continue
        named = scripts(frame.filename)
        if named is None:
            return None
        place = f"line {frame.lineno} of {named}" if named == "the script" else f"{named}:{frame.lineno}"
        return place + (f" in {frame.name}" if frame.name != "<module>" else "")
    return None


def _no_volume(shape):
    """Whether a shape has faces but no volume: no solid, or only solids flat along some axis."""
    if not isinstance(shape, bd.Shape) or shape._wrapped is None:
        return False
    solids = shape.solids()
    if not solids:
        return bool(shape.faces())
    for solid in solids:
        size = solid.bounding_box(optimal=False).size
        if min(size.X, size.Y, size.Z) >= FLAT:
            return False
    return True


def _noted(scripts, what, shapes):
    """Notes a join or cut the script asked for with any of `shapes` of no volume."""
    hollow = [shape for shape in shapes if _no_volume(shape)]
    if not hollow:
        return
    where = _caller(scripts, 3)
    if where is None:
        return
    key = (where, what)
    if key not in empty:
        empty[key] = {"where": where, "what": what, "shape": _plain_box(hollow[0]), "times": 0}
    empty[key]["times"] += 1


def _plain_box(shape):
    """A shape's box, as its size about its middle, to a thousandth of a millimetre."""
    box = shape.bounding_box(optimal=False)

    def plain(value):
        value = round(value, 3)
        return f"{0.0 if value == 0 else value:g}"

    size = " × ".join(plain(v) for v in (box.size.X, box.size.Y, box.size.Z))
    middle = ", ".join(plain(v) for v in (box.center().X, box.center().Y, box.center().Z))
    return f"{size} mm about ({middle})"


# How near, in mm, a point counts as on a face, and how far apart two boxes must be to count as apart.
ON = 1e-5


def _gaps(cutter, part):
    """
    Where a cutter's box lies off a part's, in words, as "43 mm above", or
    nothing when the boxes meet.
    """
    a, b = cutter.bounding_box(optimal=False), part.bounding_box(optimal=False)
    words = []
    for axis, low, high in (("Z", "below", "above"), ("X", "off the −X side of", "off the +X side of"), ("Y", "off the −Y side of", "off the +Y side of")):
        k = "XYZ".index(axis)
        over = tuple(a.min)[k] - tuple(b.max)[k]
        under = tuple(b.min)[k] - tuple(a.max)[k]
        if over > ON:
            words.append(f"{round(over, 3):g} mm {high}")
        elif under > ON:
            words.append(f"{round(under, 3):g} mm {low}")
    return " and ".join(words)


# The faces of the shape a cut gave last, by key: a loop cutting the same part cuts that shape next.
_last_faces = [None, None]


def _sub_shapes(shape, kind):
    from OCP.TopExp import TopExp_Explorer

    found = TopExp_Explorer(shape, kind)
    while found.More():
        yield found.Current()
        found.Next()


def _face_keys(shape):
    """A shape's faces in the kernel, by key."""
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopoDS import TopoDS

    if _last_faces[0] is not None and _last_faces[0].IsSame(shape.wrapped):
        return _last_faces[1]
    return {hash(face): TopoDS.Face(face) for face in _sub_shapes(shape.wrapped, TopAbs_FACE)}


def _point_inside(face):
    """A point inside a face's bounds, found on its surface from a grid over its parameters, or nothing."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.BRepTools import BRepTools
    from OCP.gp import gp_Pnt2d
    from OCP.TopAbs import TopAbs_IN

    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    surface = BRepAdaptor_Surface(face)
    for i, j in ((1, 1), (1, 2), (2, 1), (2, 2), (1, 3), (3, 1), (3, 3), (2, 3), (3, 2)):
        u, v = u0 + (u1 - u0) * i / 4, v0 + (v1 - v0) * j / 4
        if BRepClass_FaceClassifier(face, gp_Pnt2d(u, v), 1e-7).State() == TopAbs_IN:
            return surface.Value(u, v)
    return None


def _only_touches(old, new):
    """
    Whether a cut changed a part's faces, `old`, to `new`, both by key,
    without taking any of it away: each face it made lies on a face the part
    had, split where the cutter touched. The simplest faces it made are
    looked at first, as one the cutter made usually is.
    """
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.TopAbs import TopAbs_EDGE

    gone = [face for key, face in old.items() if key not in new]
    came = sorted((face for key, face in new.items() if key not in old), key=lambda face: sum(1 for _ in _sub_shapes(face, TopAbs_EDGE)))
    boxes = {}
    if not gone or not came:
        return False
    for face in came:
        point = _point_inside(face)
        if point is None:
            return False
        vertex = BRepBuilderAPI_MakeVertex(point).Vertex()
        on = False
        for old_face in gone:
            if id(old_face) not in boxes:
                boxes[id(old_face)] = bd.Face(old_face).bounding_box(optimal=False)
            box = boxes[id(old_face)]
            if not all(lo - ON <= v <= hi + ON for v, lo, hi in zip((point.X(), point.Y(), point.Z()), box.min, box.max)):
                continue
            distance = BRepExtrema_DistShapeShape(vertex, old_face)
            if distance.IsDone() and distance.Value() <= ON:
                on = True
                break
        if not on:
            return False
    return True


def _missed(where, part, cutters, result):
    """
    Notes a cut of the script's that takes nothing away, or each of its
    cutters whose box lies clear of the part's, with where the cutter lies.
    """
    solid = [c for c in cutters if isinstance(c, bd.Shape) and c._wrapped is not None and not _no_volume(c)]
    if not solid:
        return
    try:
        old, new = _face_keys(part), _face_keys(result)
        _last_faces[:] = [result.wrapped, new]
        same = old.keys() == new.keys()
        if same or _only_touches(old, new):
            one = len(solid) == 1
            cutter = solid[0] if one else bd.Compound(children=solid)
            gaps = _gaps(cutter, part)
            if gaps:
                lies = f"{'lies' if one else 'lie'} {gaps}"
            elif same:
                lies = f"{'lies' if one else 'lie'} in a hollow or a gap of"
            else:
                lies = f"only {'touches' if one else 'touch'} the surface of"
            what = "a cut takes nothing away: its cutter" if one else f"a cut by {len(solid)} cutters takes nothing away: its cutters"
            _note_missed(where, what, cutter, lies, part)
            return
        if len(solid) > 1:
            clear = [(c, gaps) for c in solid if (gaps := _gaps(c, part))]
            if clear:
                cutter, gaps = clear[0]
                many = len(clear) > 1
                what = f"{len(clear)} of the {len(solid)} cutters of a cut {'take' if many else 'takes'} nothing away: {'the first' if many else 'its cutter'}"
                _note_missed(where, what, cutter, f"lies {gaps}", part)
    except Exception:  # noqa: BLE001 - a cut the kernel cannot compare is left unsaid, never failed
        return


def _note_missed(where, what, cutter, lies, part):
    """Notes a cut that takes nothing away, once for its place in the script, counting how often."""
    key = (where, "miss")
    if key not in empty:
        empty[key] = {
            "where": where,
            "what": "miss",
            "shape": f"{what}, {_plain_box(cutter)}, {lies} the part it cuts, {_plain_box(part)}. Move the cutter into the part, or take the cut out.",
            "times": 0,
        }
    empty[key]["times"] += 1


def _inside_out(solid):
    """Whether a solid's faces are turned inward, so that it holds all space but itself."""
    classifier = BRepClass3d_SolidClassifier(solid.wrapped)
    classifier.PerformInfinitePoint(1e-7)
    return classifier.State() == TopAbs_IN


def _broken(cutters, result, thorough):
    """Why a cut breaks the part, or nothing for a sound one."""
    if not result.solids():
        return "it would leave nothing of the part"
    if any(_inside_out(solid) for cutter in cutters if isinstance(cutter, bd.Shape) for solid in cutter.solids()):
        return "its cutter is turned inside out, so it would take away all of the part but where the cutter is"
    if thorough and not result.is_valid:
        return "it would leave no valid solid"
    return None


def start(scripts, thorough=False):
    """
    Checks the script's cuts and joins while the libraries are held:
    `scripts` names a file as the model knows it, or answers nothing for a
    file not the script's own; `thorough` checks that each cut leaves a
    valid solid.
    """
    _run["scripts"], _run["thorough"] = scripts, thorough


def _cut(self, to_cut, _, result, caller):
    """A cut that would break the part gives the part back as it was, and is noted as skipped."""
    scripts = _run["scripts"]
    if scripts is None or self._dim != 3 or not self.solids() or not to_cut:
        return result
    _noted(scripts, "cut", to_cut)
    where = _caller(scripts)
    if where is None:
        return result
    why = _broken(to_cut, result, _run["thorough"])
    if why is None:
        _missed(where, self, to_cut, result)
        return result
    cutters = [c for c in to_cut if isinstance(c, bd.Shape)]
    skipped.append(
        {
            "where": where,
            "why": why,
            "part": _box_text(self),
            "cutter": _box_text(cutters[0] if len(cutters) == 1 else bd.Compound(children=cutters)),
            "at": tuple(cutters[0].bounding_box().center()) if cutters else None,
        }
    )
    return self


def _fused(self, to_fuse, _, result, caller):
    """A join with a shape of no volume: a shape's and a builder's by its fuse."""
    if _run["scripts"] is not None and self._dim == 3:
        _noted(_run["scripts"], "join", (self, *to_fuse))


def _plus(self, others, _, result, caller):
    """A join with a shape of no volume: a part's by its own operator."""
    other = others[0] if others else None
    if _run["scripts"] is not None and self._dim == 3 and other is not None:
        _noted(_run["scripts"], "join", (self, *([other] if isinstance(other, bd.Shape) else other)))


interception.alters(("build123d", "Shape", "cut"), _cut)
interception.sees(("build123d", "Shape", "fuse"), _fused)
interception.sees(("build123d", "Compound", "__add__"), _plus)


def forget():
    skipped.clear()
    empty.clear()
    _last_faces[:] = [None, None]
    _run["scripts"], _run["thorough"] = None, False


def empty_said(records):
    """Each join or cut of `records`, a run's, that adds or takes nothing, and each solid lost from a builder, in words."""
    lines = []
    for one in records:
        times = f" ({one['times']} times)" if one["times"] > 1 else ""
        if one["what"] != "join" and one["what"] != "cut":
            # A cut that takes nothing away, or a solid no part took in: said as it was noted.
            lines.append(f"At {one['where']}{times}: {one['shape']}")
            continue
        doing = "a join with" if one["what"] == "join" else "a cut by"
        effect = "adds nothing" if one["what"] == "join" else "takes nothing away"
        lines.append(
            f"At {one['where']}{times}: {doing} a shape of no volume, {one['shape']}, {effect}; the step that made that shape came out flat or empty."
        )
    return lines


def said(records, parts):
    """Each skipped cut of `records`, a run's, in words, with the shown parts whose place its cutter lies in."""
    lines = []
    for one in records:
        inside = []
        if one["at"] is not None:
            point = bd.Vector(*one["at"])
            for name, shape in parts:
                box = shape.bounding_box()
                if name and all(lo - 1e-6 <= v <= hi + 1e-6 for v, lo, hi in zip(point, box.min, box.max)):
                    inside.append(name)
        lines.append(
            f"At {one['where']}: a cut of the part {one['part']}, its cutter {one['cutter']}: {one['why']}, so the part was kept as it was before it"
            + (f". Its cutter lies where {', '.join(inside[:6])} {'is' if len(inside) == 1 else 'are'} shown." if inside else ".")
        )
    return lines
