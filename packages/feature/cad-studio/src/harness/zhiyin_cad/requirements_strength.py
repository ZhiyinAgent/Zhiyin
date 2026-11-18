"""
Strength requirements, measured on a part's own sections by beam theory: a
part taken as a beam along its length, cut square to it at stations along
it, each cut's area, centroid and second moments read from the exact solid,
so a shaft's shoulders, a bracket's taper or a hole through it count where
they are.

- stress: a load square to the length, on a part resting at both ends,
  held at its root (a cantilever) or held at both ends, at its middle, its
  free end or spread along it, and a torque about its length. Each
  station's bending moment is the textbook's for the case (Roark's Formulas
  for Stress and Strain; Shigley's Table A-9), its bending stress from its
  own section, its shear stress from the torque: T·r / J on a round
  section, solid or a tube, and on any other, as a D-flat, a square or a
  keyway, Saint-Venant torsion solved on the section itself (torsion),
  once for each different section. Von Mises √(σ² + 3τ²), the highest
  bending and the highest shear taken together, against the yield over the
  safety factor. With a deflection
  limit, the curvature at each station, its moment over E and its section,
  is summed twice along the length. A part held at both ends is taken with
  a uniform beam's moments.
- strain: an arm held at its root and pushed sideways at its tip, as a
  snap fit is: the force that bends it by the deflection asked, found from
  its sections, and the strain that leaves at each station, against the
  strain the material allows.

Static and elastic: no stress raised at shoulders, grooves or holes beyond
the section they leave, no fatigue, no buckling, no shear deflection. A
design they pass is sized, not proven.
"""

import math

import build123d as bd
import numpy

from . import strength_materials as materials
from . import torsion
from .unchecked import Unchecked
from .words import mm as _mm
from .words import point as _at
from .words import way as _way

# How many stations along the length the part is cut at.
STATIONS = 61
# How far in from each end, as a share of the length, the first and the last are.
END_SHARE = 0.002
# How many points along each edge of a cut its farthest fibre is looked for at.
EDGE_POINTS = 24
# How far a cut's polar moment may be from a round section's of its area and outer radius.
ROUND = 0.02


def _unit(vector):
    vector = numpy.array(vector, dtype=float)
    return vector / numpy.linalg.norm(vector)


def _corners(shape):
    return numpy.array([tuple(v) for v in shape.tessellate(0.05, 0.3)[0]], dtype=float)


def _cut(shape, origin, along, near):
    """
    The part's cut square to `along` through `origin`: its area, its centroid,
    its second-moment tensor about the centroid, points round its edges and
    its faces; with `near`, only the piece of the cut nearest that point.
    None when the plane cuts nothing.
    """
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    found = shape.intersect(bd.Plane(origin=tuple(origin), z_dir=tuple(along)))
    faces = list(found.faces()) if found is not None else []
    if not faces:
        return None
    if near is not None:
        faces = [min(faces, key=lambda face: face.distance_to(bd.Vector(*near)))]
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(bd.Compound(faces).wrapped, props)
    area = props.Mass()
    if area <= 1e-9:
        return None
    centre = props.CentreOfMass()
    matrix = props.MatrixOfInertia()
    tensor = numpy.array([[matrix.Value(i, j) for j in (1, 2, 3)] for i in (1, 2, 3)])
    points = []
    for face in faces:
        for edge in face.edges():
            points += [tuple(edge.position_at(t)) for t in numpy.linspace(0, 1, EDGE_POINTS)]
    return area, numpy.array([centre.X(), centre.Y(), centre.Z()]), tensor, numpy.array(points), faces


class _Beam:
    """A part as a beam along `along`, from its root, cut at stations."""

    def __init__(self, name, shape, asked, toward=None):
        self.name = name
        # Each different section's torsion solved, by its shape.
        self.twists = {}
        self.along = _unit(asked["along"])
        corners = _corners(shape)
        heights = corners @ self.along
        root = numpy.array(asked["root"], dtype=float) if asked.get("root") is not None else None
        start = float(root @ self.along) if root is not None else float(heights.min())
        self.length = asked.get("length") or float(heights.max()) - start
        if self.length <= 0:
            raise Unchecked(f"{name} reaches no further along {_way(self.along)} than its root")
        if toward is not None:
            u = numpy.array(toward, dtype=float)
            u = u - (u @ self.along) * self.along
            if numpy.linalg.norm(u) < 1e-6:
                raise Unchecked("toward lies along the part's length; give the way the load pushes, square to along")
            self.u = _unit(u)
        else:
            self.u = _unit(numpy.cross(self.along, [1.0, 0.0, 0.0] if abs(self.along[0]) < 0.9 else [0.0, 1.0, 0.0]))
        self.w = numpy.cross(self.along, self.u)
        base = root if root is not None else corners[int(heights.argmin())]
        self.base = base - (base @ self.along - start) * self.along
        self.xs = numpy.linspace(END_SHARE, 1 - END_SHARE, STATIONS) * self.length
        self.cuts = []
        for x in self.xs:
            point = self.base + self.along * x
            cut = _cut(shape, point, self.along, point if root is not None else None)
            if cut is None:
                raise Unchecked(f"{name} has no material across its length {_mm(x)} mm from its root, at {_at(point)}")
            self.cuts.append(cut)

    def section(self, k):
        """A station's area, its second moments S_uu, S_ww, S_uw, and its edge points about its centroid as (u, w)."""
        area, centre, tensor, points, _ = self.cuts[k]
        u, w = self.u, self.w
        s_uu, s_ww, s_uw = float(w @ tensor @ w), float(u @ tensor @ u), -float(u @ tensor @ w)
        rel = points - centre
        return area, s_uu, s_ww, s_uw, rel @ u, rel @ w, centre

    def per_moment(self, k):
        """For a bending moment of 1 N·mm at a station: its curvature times E (1/mm), and its stress at the farthest fibre (MPa)."""
        _, s_uu, s_ww, s_uw, pu, pw, _ = self.section(k)
        det = s_uu * s_ww - s_uw**2
        a, b = s_ww / det, -s_uw / det
        return a, float(numpy.abs(a * pu + b * pw).max())

    def place(self, k):
        """Where a station's section has its centroid."""
        return self.cuts[k][1]

    def twisted(self, k):
        """
        A station's shear per N·mm of torque in MPa and its torsion constant
        J in mm⁴: T·r / J on a round section, solid or a tube, and on any
        other Saint-Venant torsion solved on its faces, once for each
        different section, with where its shear is highest.
        """
        area, s_uu, s_ww, s_uw, pu, pw, centre = self.section(k)
        polar = s_uu + s_ww
        outer = float(numpy.hypot(pu, pw).max())
        inner_squared = outer**2 - area / math.pi
        round_polar = math.pi / 2 * (outer**4 - max(inner_squared, 0.0) ** 2)
        if inner_squared >= -1e-6 * outer**2 and abs(polar - round_polar) <= ROUND * round_polar:
            return {"per_torque": outer / polar, "J": polar}
        size = math.sqrt(area)
        key = (f"{area:.5g}", len(self.cuts[k][4]), *(round(v / size**4, 5) for v in (s_uu, s_ww, s_uw)), *(round(float(v) / size, 4) for v in (pu.min(), pu.max(), pw.min(), pw.max())))
        if key not in self.twists:
            try:
                solved = torsion.section(self.cuts[k][4], centre, self.u, self.w)
            except torsion.Unsolved as why:
                raise Unchecked(f"{self.name}'s section {_mm(self.xs[k])} mm along it, at {_at(centre)}, could not be solved for torsion: {why}") from None
            self.twists[key] = {**solved, "at": solved["at"] - centre}
        found = self.twists[key]
        return {**found, "at": centre + found["at"]}


def _moments(supports, spread, load, length, xs):
    """The bending moment in N·mm at each station, for the load in N."""
    if supports == "cantilever":
        return load * (length - xs) ** 2 / (2 * length) if spread else load * (length - xs)
    if supports == "fixed":
        if spread:
            w = load / length
            return numpy.abs(w * (6 * length * xs - 6 * xs**2 - length**2) / 12)
        return numpy.abs(load * (4 * numpy.minimum(xs, length - xs) - length) / 8)
    if spread:
        w = load / length
        return w * xs * (length - xs) / 2
    return load * numpy.minimum(xs, length - xs) / 2


def _figures(asked):
    """The material's figures: those of the table, each replaced by one given; E only where a deflection needs it."""
    material, given = asked.get("material"), asked.get("yield")
    if material not in materials.MATERIALS and given is not None and asked.get("modulus") is None and asked.get("deflection") is None:
        return {"grade": f"{material or 'the material given'}, yield {given:g} MPa as given", "yield": float(given), "E": None}
    try:
        return materials.of(material or "the material given", given, asked.get("modulus"))
    except materials.NoFigures:
        known = ", ".join(materials.MATERIALS)
        raise Unchecked(
            f"there are no strength figures for {asked.get('material')} here: give yield, and modulus with deflection, in MPa from its datasheet, or a material of {known}"
        ) from None


def _deflection(beam, curvature, supports):
    """The largest deflection in mm along the beam, from each station's curvature, held as it is."""
    xs = beam.xs
    slope = numpy.concatenate([[0.0], numpy.cumsum((curvature[1:] + curvature[:-1]) / 2 * numpy.diff(xs))])
    bent = numpy.concatenate([[0.0], numpy.cumsum((slope[1:] + slope[:-1]) / 2 * numpy.diff(xs))])
    if supports == "simple":
        # Resting at both ends: what lies on the line between its ends.
        bent = bent - bent[-1] * (xs - xs[0]) / (xs[-1] - xs[0])
    k = int(numpy.abs(bent).argmax())
    return float(abs(bent[k])), k


def stress(parts, asked):
    supports = asked.get("supports", "simple")
    spread = bool(asked.get("spread"))
    load = asked.get("load") or 0.0
    torque = (asked.get("torque") or 0.0) * 1000
    figures = _figures(asked)
    allowed = figures["yield"] / asked["safety"]
    worst = None
    for name, shape in parts:
        beam = _Beam(name, shape, asked, asked.get("toward"))
        moments = _moments(supports, spread, load, beam.length, beam.xs) if load else numpy.zeros(len(beam.xs))
        peak = None
        curvature = numpy.zeros(len(beam.xs))
        for k in range(len(beam.xs)):
            area, s_uu, s_ww, s_uw, pu, pw, _ = beam.section(k)
            per, fibre = beam.per_moment(k)
            bending = moments[k] * fibre
            if figures["E"] is not None:
                curvature[k] = moments[k] * per / figures["E"]
            shear, twisted = 0.0, None
            if torque:
                twisted = beam.twisted(k)
                shear = torque * twisted["per_torque"]
            mises = math.sqrt(bending**2 + 3 * shear**2)
            if peak is None or mises > peak[0]:
                peak = (mises, k, bending, shear, area, s_uu, twisted)
        mises, k, bending, shear, area, s_uu, twisted = peak
        factor = figures["yield"] / mises if mises > 0 else math.inf
        case = []
        if load:
            where = "spread along it" if spread else ("at its free end" if supports == "cantilever" else "at its middle")
            case.append(f"{_mm(load)} N toward {_way(beam.u)} {where}")
        if torque:
            case.append(f"{_mm(torque / 1000)} N·m about its length")
        parts_said = ([f"bending {_mm(bending)} MPa"] if load else []) + ([f"shear {_mm(shear)} MPa"] if torque else [])
        section_said = f"its section there {_mm(area)} mm², I {_mm(s_uu)} mm⁴"
        if twisted is not None and "points" in twisted:
            section_said += (
                f", J {_mm(twisted['J'])} mm⁴ from Saint-Venant torsion solved on the section in {twisted['points']} points, its shear highest at {_at(twisted['at'])}"
                + (
                    f", leaving out the {_mm(twisted['sharp'])} mm about its sharp inner corners, where the shear has no finite peak; give them a radius to have them measured"
                    if twisted["sharp"] is not None
                    else ""
                )
                + (
                    f", the highest shear still changing by {100 * twisted['change']:.1f}% solved finer about it"
                    if twisted["change"] > torsion.SETTLED
                    else ""
                )
            )
        elif twisted is not None:
            section_said += f", J {_mm(twisted['J'])} mm⁴, its shear T·r/J as a round section"
        held = {"simple": "resting at both ends", "cantilever": "held at its root", "fixed": "held at both ends"}[supports]
        said = (
            f"{name}, {_mm(beam.length)} mm along {_way(beam.along)} {held}, under {' and '.join(case)}, in {figures['grade']} (yield {_mm(figures['yield'])} MPa): "
            f"its highest stress is {_mm(mises)} MPa von Mises, {_mm(beam.xs[k])} mm along it, at {_at(beam.place(k))}"
            f" ({', '.join(parts_said)}; {section_said}), "
            f"a safety factor of {_mm(factor)} where at least {_mm(asked['safety'])} is asked, {_mm(allowed)} MPa allowed"
        )
        margins = [((allowed - mises) / allowed, allowed - mises, "MPa")]
        if asked.get("deflection") is not None:
            bent, j = _deflection(beam, curvature, supports)
            limit = asked["deflection"]
            said += f"; it bends {_mm(bent)} mm at {_mm(beam.xs[j])} mm along it, where at most {_mm(limit)} mm is asked (E {_mm(figures['E'] / 1000)} GPa)"
            margins.append(((limit - bent) / limit, limit - bent, "mm"))
        said += f". Beam theory on {STATIONS} sections: static, no stress raised at shoulders, grooves or holes"
        share, margin, unit = min(margins)
        if worst is None or share < worst[0]:
            worst = (share, {"margin": margin, "unit": unit, "measured": said})
    return worst[1]


def strain(parts, asked):
    limit = asked["max"]
    worst = None
    for name, shape in parts:
        beam = _Beam(name, shape, asked, asked["toward"])
        per = numpy.array([beam.per_moment(k) for k in range(len(beam.xs))])
        arm = beam.length - beam.xs
        # The tip moves by F/E times the sum along the arm of (L - x)² times the curvature a unit moment gives.
        reach = (arm**2 * per[:, 0])
        force_over_e = asked["deflection"] / float(numpy.sum((reach[1:] + reach[:-1]) / 2 * numpy.diff(beam.xs)))
        strains = 100 * force_over_e * arm * per[:, 1]
        k = int(strains.argmax())
        peak = float(strains[k])
        said = (
            f"{name}, {_mm(beam.length)} mm along {_way(beam.along)} from its root, its tip pushed {_mm(asked['deflection'])} mm toward {_way(beam.u)}: "
            f"its highest strain is {peak:.2f}%, {_mm(beam.xs[k])} mm along it, at {_at(beam.place(k))}, where at most {limit:g}% is asked. "
            f"Beam theory on {STATIONS} sections, elastic: no stress raised at a sharp root"
        )
        margin = limit - peak
        if worst is None or margin < worst["margin"]:
            worst = {"margin": margin, "unit": "%", "measured": said}
    return worst
