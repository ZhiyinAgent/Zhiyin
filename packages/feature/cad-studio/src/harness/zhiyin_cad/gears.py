"""
How the gears a build shows mesh: each pair of bd_warehouse's spur or
helical gears on parallel axes, side by side along them, whose tips reach
into each other, from the figures each gear was made with. A gear is found
in any part shown that keeps its teeth: bored for a shaft, moved, or joined
with a web and another gear into one compound part, each by the faces of
its teeth, which a cut, a move or a join leaves as they were made. Its axis
is where it was made, through its centre of mass along the principal axis
its moment of inertia sets apart from the other two, carried by the move
those faces show. All of it is recorded in the script's run as plain
numbers. The answer gives the centre distance
against the pitch circles', the backlash that alone opens, the working
pressure angle and the contact ratio, how many pairs of teeth carry the load
on average: ε = (√(ra1² − rb1²) + √(ra2² − rb2²) − a sin αw) / pb, with
cos αw = (rb1 + rb2) / a and pb the base pitch, 2π rb / z (Shigley's
Mechanical Engineering Design, the contact ratio of spur gears), and for
helical gears the overlap ratio b sin β / (π mn) beside it.
"""

import math

import numpy

from . import interception
from .words import figures as _n

# The classes whose figures are recorded, and the figures, each a number.
CLASSES = ("SpurGear", "HelicalGear")
FIGURES = ("teeth", "module", "pressure_angle", "pitch_radius", "base_radius", "addendum_radius", "root_radius", "helix_angle", "thickness")
# Axes this near parallel, as the cosine between them, are parallel.
PARALLEL = 0.9999
# Base pitches further apart than this share do not mesh.
PITCH_SHARE = 0.01
# Under this contact ratio a spur pair runs rough; under 1 its teeth lose contact.
SMOOTH = 1.2
# A part keeps a gear when it keeps at least this share of the faces it was made with.
KEPT = 0.5
# Gears whose faces overlap along their axes by less than this, in mm, lie beside each other, not side by side.
SIDE_BY_SIDE = 0.01

# Every gear made in this run: its figures, its axis where it was made and how many faces it had.
_made = []
# Each face of those gears by its shape at no place: the gear's place in _made and where the face was made.
_faces = {}


def _key(face):
    from OCP.TopLoc import TopLoc_Location

    return hash(face.wrapped.Located(TopLoc_Location()))


def _matrix(face):
    """Where a face is, as a 4 x 4 matrix."""
    trsf = face.wrapped.Location().Transformation()
    return numpy.array([[trsf.Value(r, c) for c in range(1, 5)] for r in range(1, 4)] + [[0.0, 0.0, 0.0, 1.0]])


def _record(shape):
    """Records a gear just made: its figures, its axis and its faces."""
    figures = figures_of(shape)
    if figures is None:
        return
    centre, axis = _axis(shape)
    faces = shape.faces()
    index = len(_made)
    _made.append({"figures": figures, "centre": centre, "axis": axis, "faces": len(faces)})
    for face in faces:
        _faces.setdefault(_key(face), (index, _matrix(face)))


def start():
    """
    Records from now on in this process every gear made while the libraries
    are held, a SpurGear with its tooth count, module and pressure angle,
    which it does not keep itself, as a HelicalGear does.
    """
    _made.clear()
    _faces.clear()


# SpurGear(module, tooth_count, pressure_angle, thickness, ...): its figures by place or by name.
_SPUR = ("module", "tooth_count", "pressure_angle", "thickness")


def _spur_made(self, args, kwargs, result, caller):
    given = dict(zip(_SPUR, args))
    given.update({name: kwargs[name] for name in _SPUR if name in kwargs})
    self.zhiyin_gear = given
    _record(self)


def _helical_made(self, args, kwargs, result, caller):
    _record(self)


interception.sees(("bd_warehouse.gear", "SpurGear", "__init__"), _spur_made)
interception.sees(("bd_warehouse.gear", "HelicalGear", "__init__"), _helical_made)


def carried(shape):
    """
    Each gear a part keeps the teeth of, with its figures and where its axis
    now runs: `centre` and `axis` as three numbers each, the axis one long.
    A part made of none is an empty list.
    """
    if not _made:
        return []
    moves = {}
    for face in shape.faces():
        hit = _faces.get(_key(face))
        if hit is None:
            continue
        index, made = hit
        move = _matrix(face) @ numpy.linalg.inv(made)
        place = (index, tuple(numpy.round(move[:3], 6).ravel()))
        moves[place] = moves.get(place, 0) + 1
    found = []
    for (index, flat), count in moves.items():
        gear = _made[index]
        if count < KEPT * gear["faces"]:
            continue
        move = numpy.array(flat).reshape(3, 4)
        axis = move[:, :3] @ gear["axis"]
        found.append(
            {
                **gear["figures"],
                "centre": [float(v) for v in move[:, :3] @ gear["centre"] + move[:, 3]],
                "axis": [float(v) for v in axis / numpy.linalg.norm(axis)],
            }
        )
    return found


def figures_of(shape):
    """A gear's figures as plain numbers, or nothing for a part that is not one of bd_warehouse's gears."""
    if type(shape).__name__ not in CLASSES or not (type(shape).__module__ or "").startswith("bd_warehouse."):
        return None
    kept = getattr(shape, "zhiyin_gear", {})
    found = {
        "teeth": getattr(shape, "tooth_count", kept.get("tooth_count")),
        "module": getattr(shape, "module", kept.get("module")),
        "pressure_angle": getattr(shape, "pressure_angle", kept.get("pressure_angle")),
        "pitch_radius": getattr(shape, "pitch_radius", None),
        "base_radius": getattr(shape, "base_radius", None),
        "addendum_radius": getattr(shape, "addendum_radius", None),
        "root_radius": getattr(shape, "root_radius", None),
        "helix_angle": getattr(shape, "helix_angle", 0.0),
        "thickness": getattr(shape, "thickness", kept.get("thickness")),
    }
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in found.values()):
        return None
    return {key: float(value) for key, value in found.items()}


def _number(one):
    if isinstance(one, bool) or not isinstance(one, (int, float)) or not math.isfinite(one):
        raise ValueError("a gear's figure is not a number")
    return float(one)


def checked(value):
    """A gear a part keeps, as read back: its figures, centre and axis, each a number; or ValueError."""
    if not isinstance(value, dict) or set(value) != {*FIGURES, "centre", "axis"}:
        raise ValueError("a gear's figures are not one")
    found = {key: _number(value[key]) for key in FIGURES}
    for key in ("centre", "axis"):
        if not isinstance(value[key], list) or len(value[key]) != 3:
            raise ValueError("a gear's axis is not one")
        found[key] = [_number(v) for v in value[key]]
    if abs(numpy.linalg.norm(found["axis"]) - 1) > 1e-6:
        raise ValueError("a gear's axis is not one")
    return found


def _axis(shape):
    """The gear's axis on its solid: through its centre of mass, along the principal axis set apart."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape.wrapped, props)
    centre = props.CentreOfMass()
    principal = props.PrincipalProperties()
    moments = numpy.array(principal.Moments())
    axes = [principal.FirstAxisOfInertia(), principal.SecondAxisOfInertia(), principal.ThirdAxisOfInertia()]
    apart = [abs(moments[k] - moments[(k + 1) % 3]) + abs(moments[k] - moments[(k + 2) % 3]) for k in range(3)]
    d = axes[int(numpy.argmax(apart))]
    return numpy.array([centre.X(), centre.Y(), centre.Z()]), numpy.array([d.X(), d.Y(), d.Z()])


def pairs(kept):
    """
    Each two gears of two parts on parallel axes, side by side along them,
    whose tips reach into each other, from the gears each part keeps, by its
    name: (first name, its gear, second name, its gear, how far apart their
    axes are).
    """
    gears = [(name, one, numpy.array(one["centre"]), numpy.array(one["axis"])) for name, found in kept.items() for one in found]
    for i, (a, fa, ca, na) in enumerate(gears):
        for b, fb, cb, nb in gears[i + 1 :]:
            if a == b or abs(float(na @ nb)) < PARALLEL:
                continue
            off = cb - ca
            # Side by side along their axes, or one beside the other.
            if abs(float(off @ na)) > (fa["thickness"] + fb["thickness"]) / 2 - SIDE_BY_SIDE:
                continue
            apart = float(numpy.linalg.norm(off - (off @ na) * na))
            if apart >= fa["addendum_radius"] + fb["addendum_radius"] or apart <= fa["base_radius"] + fb["base_radius"]:
                continue
            yield a, fa, b, fb, apart


def base_pitches(fa, fb):
    """The base pitch of each of two gears, in mm: equal, to PITCH_SHARE, when they can mesh."""
    return 2 * math.pi * fa["base_radius"] / fa["teeth"], 2 * math.pi * fb["base_radius"] / fb["teeth"]


def can_mesh(fa, fb):
    pitch_a, pitch_b = base_pitches(fa, fb)
    return abs(pitch_a - pitch_b) <= PITCH_SHARE * max(pitch_a, pitch_b)


def figures(fa, fb, apart):
    """
    How two gears that can mesh mesh `apart` mm apart: where their pitch
    circles meet, how much wider they are than that, the backlash that alone
    opens (below 0 where they bind), the working pressure angle in degrees
    and the contact ratio.
    """
    ra1, ra2, rb1, rb2 = fa["addendum_radius"], fb["addendum_radius"], fa["base_radius"], fb["base_radius"]
    nominal = fa["pitch_radius"] + fb["pitch_radius"]
    working = math.acos(min(1.0, (rb1 + rb2) / apart))
    ratio = (math.sqrt(ra1**2 - rb1**2) + math.sqrt(ra2**2 - rb2**2) - apart * math.sin(working)) / base_pitches(fa, fb)[0]
    wider = apart - nominal
    return {"nominal": nominal, "wider": wider, "backlash": 2 * wider * math.tan(working), "working": math.degrees(working), "ratio": ratio}


def meshes(kept):
    """A line for each pair of gears of two parts that mesh, saying how, from the gears each part keeps, by its name."""
    from .words import mm as _mm

    lines = []
    for a, fa, b, fb, apart in pairs(kept):
        named = f"{a} ({fa['teeth']:g} teeth) and {b} ({fb['teeth']:g} teeth)"
        if not can_mesh(fa, fb):
            pitch_a, pitch_b = base_pitches(fa, fb)
            lines.append(
                f"{named} reach into each other {_mm(apart)} mm apart but cannot mesh: their base pitches differ, {_mm(pitch_a)} and {_mm(pitch_b)} mm, so their modules or pressure angles do."
            )
            continue
        found = figures(fa, fb, apart)
        nominal, wider, ratio = found["nominal"], found["wider"], found["ratio"]
        if abs(wider) < 0.005:
            distance = f"{_mm(apart)} mm apart, where their pitch circles meet"
        elif wider > 0:
            distance = f"{_mm(apart)} mm apart, {_mm(wider)} mm wider than where their pitch circles meet ({_mm(nominal)} mm), about {_mm(found['backlash'])} mm of backlash from that alone"
        else:
            distance = f"{_mm(apart)} mm apart, {_mm(-wider)} mm closer than where their pitch circles meet ({_mm(nominal)} mm), so their teeth bind"
        line = f"{named} mesh {distance}: contact ratio {_n(ratio)} at a working pressure angle of {_mm(found['working'])}°"
        helix = fa["helix_angle"]
        if helix:
            width = min(fa["thickness"], fb["thickness"])
            overlap = width * math.sin(math.radians(abs(helix))) / (math.pi * fa["module"])
            line += f", and an overlap ratio of {_n(overlap)} along their {_mm(width)} mm width, {_n(ratio + overlap)} in all"
        if ratio < 1:
            line += "; under 1, one pair of teeth leaves before the next meets, so the gears knock: bring them closer or give them longer teeth"
        elif ratio < SMOOTH and not helix:
            line += f"; under about {SMOOTH:g}, below which gears are not normally used, as their shafts and bearings then need special care"
        lines.append(line + ".")
    if lines:
        lines.append(
            "How the teeth fare is not measured here: strength.gear rates a gear's teeth at the torque and speed they carry,"
            " and printed teeth take the plastic's yield from its datasheet."
        )
    return lines
