"""
Gears drawn as ISO 2203 draws them, from the figures each part's gears were
made with: a gear is a solid bounded by its tip surface, its teeth left out,
with its pitch surface a thin long chain line, a circle where the view looks
along its axis and a line past each side of it where the view looks across
it; the root surface is not drawn. In a section the band of teeth, between
root and tip, is cut but not hatched, with its root line drawn, and the rest
of the gear is hatched as any part. Pitch lines are drawn in hidden portions
and sections too. A view at an angle to the axis, as the angled one, shows
the gear's outline without its pitch line. Two gears in mesh seen across
their axes do not hide each other's tip lines there, as the standard has it,
unless another part stands in front. A part whose gear cannot be drawn so,
the kernel failing on it, is drawn as made.
"""

import math

import build123d as bd

# How square a view must look along or across a gear's axis, as a cosine, for its pitch surface to be drawn.
SQUARE = 1e-6
# How far below the root the band of teeth reaches, as a share of the module, so the band and the rest meet cleanly.
BELOW_ROOT = 0.01
# How far past the tips, in mm, the filled band reaches: the teeth's lands lie
# on the tip cylinder, and a band that met them there would keep the seams
# between them, drawn as lines across the face. Far under what a drawing writes.
PAST_TIP = 1e-3
# The helix lines' reach along the axis, as a share of the face width, and how far apart they lie, as a share of the pitch radius.
HELIX_LENGTH = 0.7
HELIX_APART = 0.25


def recorded():
    """The gears each shown part keeps, by its name, as the run of the script recorded them."""
    from .. import bom_record

    return bom_record.kept_gears()


def fits(shape, gear):
    """
    Whether a part still has a gear's teeth where the gear was recorded: about
    half the points round its pitch circle, in the middle of its face width,
    lie in teeth. A part moved since, as a drawing taken apart moves it, has
    not, and is drawn as it is.
    """
    axis = bd.Vector(*gear["axis"]).normalized()
    plane = bd.Plane(origin=bd.Vector(*gear["centre"]), z_dir=axis)
    count = max(8, int(2 * gear["teeth"]))
    # Half a step off, so no point falls on a flank.
    points = [plane.from_local_coords(bd.Vector(gear["pitch_radius"] * math.cos(a), gear["pitch_radius"] * math.sin(a), 0)) for a in
              (2 * math.pi * (i + 0.25) / count for i in range(count))]
    inside = sum(1 for point in points if shape.is_inside(point))
    return 0.2 <= inside / count <= 0.8


def _band(gear, outer, grow=0.0):
    """The ring a gear's teeth fill, from just below its root to `outer`, over its face width and `grow` more each side."""
    axis = bd.Vector(*gear["axis"]).normalized()
    width = gear["thickness"] + 2 * grow
    plane = bd.Plane(origin=bd.Vector(*gear["centre"]) - axis * (width / 2), z_dir=axis)
    inner = gear["root_radius"] - BELOW_ROOT * gear["module"]
    whole = bd.Cylinder(outer, width, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    hollow = bd.Cylinder(inner, width, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    return bd.Location(plane) * (whole - hollow)


def drawn(shape, gears):
    """
    A part with gears as an unsectioned view draws it: each band of teeth
    filled out to the tip, so the gear is a solid bounded by its tip surface.
    The part itself where that fails.
    """
    try:
        whole = shape
        for gear in gears:
            whole = whole.fuse(_band(gear, gear["addendum_radius"] + PAST_TIP))
        whole = whole.clean()
        return whole if whole.is_valid and whole.solids() else shape
    except Exception:  # noqa: BLE001 - a gear the kernel cannot fill is drawn as made
        return shape


def parted(shape, gears):
    """
    A part with gears as a section cuts it: the part without its teeth, which
    is hatched, and each gear's band of teeth to its tip, which is not; or
    nothing where the kernel fails on it.
    """
    try:
        body = shape
        for gear in gears:
            body = body.cut(_band(gear, gear["addendum_radius"] * 1.05 + gear["module"], grow=gear["module"] * 1e-3))
        body = body.clean()
        bands = [_band(gear, gear["addendum_radius"]) for gear in gears]
        if not body.is_valid or not body.solids():
            return None
        return body, bands
    except Exception:  # noqa: BLE001 - a gear the kernel cannot part is drawn as made
        return None


def pitch_marks(view, gears):
    """
    Each gear's pitch surface on a view: a circle where the view looks along
    its axis, kept in `view.pitch`, and a line each side of the axis, the
    gear's face width long, where it looks across, kept with the centre
    lines, which run past what they mark.
    """
    for gear in gears:
        axis = bd.Vector(*gear["axis"]).normalized()
        along = axis.dot(view.look)
        centre = bd.Vector(*gear["centre"])
        radius = gear["pitch_radius"]
        if abs(abs(along) - 1) < SQUARE:
            cx, cy = view.flat(centre)
            view.pitch.append((cx, cy, radius, 0.0, 360.0))
        elif abs(along) < SQUARE:
            u = (axis.dot(view.right), axis.dot(view.up))
            n = (-u[1], u[0])
            cx, cy = view.flat(centre)
            half = gear["thickness"] / 2
            for side in (1, -1):
                ox, oy = cx + n[0] * radius * side, cy + n[1] * radius * side
                view.pitch_lines.append(((ox - u[0] * half, oy - u[1] * half), (ox + u[0] * half, oy + u[1] * half)))


def mesh_seen(view, first, second, others):
    """
    The tip lines of two gears in mesh, seen across their axes, drawn as
    seen where only the other gear hides them, as ISO 2203 has neither gear
    hide the other in the portion in mesh: each gear's tip line on the side
    of the other, where no part of `others` stands in front of it.
    """
    for gear, partner in ((first, second), (second, first)):
        axis = bd.Vector(*gear["axis"]).normalized()
        if abs(axis.dot(view.look)) >= SQUARE:
            return
        centre = bd.Vector(*gear["centre"])
        off = bd.Vector(*partner["centre"]) - centre
        off = off - axis * off.dot(axis)
        # Beside each other in the view, not one in front of the other.
        if off.length < 1e-9 or abs(off.normalized().dot(view.look)) > 1e-3:
            return
        toward = off.normalized()
        half = gear["thickness"] / 2
        tip = [centre + toward * (gear["addendum_radius"] + PAST_TIP) + axis * (half * s) for s in (-1, 1)]
        if _hidden_by(others, (tip[0] + tip[1]) * 0.5, view.look):
            continue
        a, b = view.flat(tip[0]), view.flat(tip[1])
        view.lines = [piece for layer, points in view.lines for piece in _shown_on(layer, points, a, b)]


def helix_marks(view, gears_by_part, drawn, names):
    """
    The direction of a helical gear's teeth, as ISO 2203 marks it: three thin
    parallel lines across the middle of a gear seen across its axis, along its
    teeth on the side facing the viewer, where no other part stands in front.
    bd_warehouse turns a tooth of a positive helix angle positively about the
    axis as it runs along it.
    """
    for name, gears in gears_by_part.items():
        others = [shape for shape, one in zip(drawn, names) if one != name]
        for gear in gears:
            beta = math.radians(gear["helix_angle"])
            axis = bd.Vector(*gear["axis"]).normalized()
            if not beta or abs(axis.dot(view.look)) >= SQUARE:
                continue
            centre = bd.Vector(*gear["centre"])
            toward = -bd.Vector(view.look).normalized()
            if _hidden_by(others, centre + toward * (gear["addendum_radius"] + PAST_TIP), view.look):
                continue
            across = axis.cross(toward)
            along = axis + across * math.tan(beta)
            half = HELIX_LENGTH * gear["thickness"] / 2
            apart = HELIX_APART * gear["pitch_radius"]
            for k in (-1, 0, 1):
                middle = centre + across * (apart * k)
                view.lines.append(("thin", [view.flat(middle - along * half), view.flat(middle + along * half)]))


def _hidden_by(shapes, point, look):
    """Whether any of the shapes stands between a point and the viewer looking along `look`."""
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector

    towards = -bd.Vector(look).normalized()
    line = gp_Lin(gp_Pnt(point.X, point.Y, point.Z), gp_Dir(towards.X, towards.Y, towards.Z))
    for shape in shapes:
        meets = IntCurvesFace_ShapeIntersector()
        meets.Load(shape.wrapped, 1e-6)
        meets.Perform(line, 1e-4, 1e9)
        if meets.IsDone() and meets.NbPnt() > 0:
            return True
    return False


def _shown_on(layer, points, a, b):
    """A drawn line, its length that lies along the segment ab, if hidden, drawn as seen."""
    if layer != "hidden" or len(points) != 2:
        return [(layer, points)]
    length = math.dist(a, b)
    if length < 1e-9:
        return [(layer, points)]
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    p, q = points
    off = lambda r: abs((r[0] - a[0]) * uy - (r[1] - a[1]) * ux)
    if off(p) > 1e-4 or off(q) > 1e-4:
        return [(layer, points)]
    along = lambda r: (r[0] - a[0]) * ux + (r[1] - a[1]) * uy
    lo, hi = sorted((along(p), along(q)))
    start, end = max(lo, 0.0), min(hi, length)
    if end - start < 1e-6:
        return [(layer, points)]
    at = lambda t: (a[0] + ux * t, a[1] + uy * t)
    pieces = [("visible", [at(start), at(end)])]
    if start - lo > 1e-6:
        pieces.append(("hidden", [at(lo), at(start)]))
    if hi - end > 1e-6:
        pieces.append(("hidden", [at(end), at(hi)]))
    return pieces


def meshing(kept):
    """
    The pairs of gears of two parts that mesh, each (first part, its gear,
    second part, its gear): on parallel axes, side by side along them, their
    tips reaching into each other.
    """
    from .. import gears

    return [(a, ga, b, gb) for a, ga, b, gb, _ in gears.pairs(kept)]


def faced(view, gear):
    """Whether a view looks along a gear's axis."""
    return abs(abs(bd.Vector(*gear["axis"]).normalized().dot(view.look)) - 1) < SQUARE
