"""
One drawing: the views asked for, worked out from the parts' exact shapes,
dimensioned as measured, laid out on a sheet with a frame and a title block,
and written to each file asked for, with a picture of it for the model.
"""

import json
import math
import os

import build123d as bd

from .. import patterns, progress
from ..words import listed as _listed
from . import (
    apart,
    bearings,
    defaults,
    dimension_kinds,
    dimensions,
    dxf,
    gearing,
    layout,
    parts_list,
    revolved,
    sheet,
    views,
    writers,
)
from .marks import HATCH_ANGLES, centre_lines, cutting_line, detail_mark, direction_mark, drawn_segments, hatch

# The shares of the room their dimensions would take alone that views are tried spaced by, widest first.
ROOM_SHARES = (1.0, 0.6, 0.35)
# How many standard scales below the sheet's the angled view may be drawn at, for room.
ANGLED_STEPS = 2
# The title block's fields the answer names when left empty, by key, with their labels.
TITLE_FIELDS = (("title", "Title"), ("number", "Drawing number"), ("author", "Drawn by"))


class DrawingRefused(Exception):
    """What the drawing asks for cannot be drawn as asked; the reasons say why, and whether it was for want of time."""

    def __init__(self, reasons, out_of_time=False):
        super().__init__(reasons)
        self.out_of_time = out_of_time


def _up_for(look):
    look = bd.Vector(look).normalized()
    return (0, 0, 1) if abs(look.dot(bd.Vector(0, 0, 1))) < 0.99 else (0, 1, 0)


def _angled(view):
    """Whether a view is the angled one, or a detail taken from it."""
    while view is not None:
        if view.kind == "named" and view.name == "iso":
            return True
        view = getattr(view, "parent", None) if view.kind == "detail" else None
    return False


def _view_specs(given):
    """Each view as a dict, the default three and an angled one when none is given."""
    if not given:
        given = ["front", "top", "right", "iso"]
    return [{"view": v} if isinstance(v, str) else dict(v) for v in given]


class Solids:
    """What a drawing of parts is drawn from: their exact shapes, by OpenCASCADE's hidden-line removal."""

    def __init__(self, parts, chosen, centre=None, gears=None, bearing_outlines=None, made_as=None):
        names = [name for name, _ in parts]
        # How each part is made, by name, where the build knows it.
        self.made_as = dict(made_as or {})
        unknown = [n for n in chosen if n not in names]
        if unknown:
            raise DrawingRefused([f"the drawing names {', '.join(unknown)}, which the script did not show; it showed {', '.join(names)}"])
        self.shapes = [shape for name, shape in parts if name in chosen]
        self.names = [name for name, _ in parts if name in chosen]
        if centre is None:
            whole = self.shapes[0] if len(self.shapes) == 1 else bd.Compound(children=[bd.Shape.cast(s.wrapped) for s in self.shapes])
            # The box from the parts' own tolerances: the tight one takes seconds on a part of many curved faces.
            centre = whole.bounding_box(optimal=False).center()
        self.centre = bd.Vector(*centre)
        self.ready = {}
        # The gears each part keeps, by its name, which the views draw as ISO 2203 does.
        kept = gearing.recorded() if gears is None else gears
        self.gears = {}
        for name, shape in zip(self.names, self.shapes):
            found = [gear for gear in kept.get(name, []) if gears is not None or gearing.fits(shape, gear)]
            if found:
                self.gears[name] = found
        # Each bought bearing's outline, by its name, which the views draw as ISO 8826-1 does.
        self.bearings = bearings.recorded(zip(self.names, self.shapes)) if bearing_outlines is None else dict(bearing_outlines)
        self._drawn = {}
        self._parted = {}

    def _gears_of(self, indices):
        return [gear for index in indices for gear in self.gears.get(self.names[index], [])]

    def drawn_shapes(self):
        """The parts as a view that cuts nothing draws them: each gear a solid bounded by its tip, each bearing its outline."""
        out = []
        for name, shape in zip(self.names, self.shapes):
            if name in self.gears and name not in self._drawn:
                self._drawn[name] = gearing.drawn(shape, self.gears[name])
            if name in self.bearings and name not in self._drawn:
                self._drawn[name] = bearings.drawn(self.bearings[name])
            out.append(self._drawn.get(name, shape))
        return out

    def _section_shapes(self, whole):
        """
        The parts as a section cuts them, and the bands of teeth it cuts but
        does not hatch: a gear's body in its place, its teeth apart, or the
        gear filled to its tip where it is left whole.
        """
        drawn = self.drawn_shapes()
        shapes, plain = [], []
        for index, (name, shape) in enumerate(zip(self.names, self.shapes)):
            if name in self.bearings:
                shapes.append(drawn[index])
            elif name not in self.gears:
                shapes.append(shape)
            elif index in whole:
                shapes.append(drawn[index])
            else:
                if name not in self._parted:
                    self._parted[name] = gearing.parted(shape, self.gears[name])
                found = self._parted[name]
                shapes.append(found[0] if found else shape)
                plain += found[1] if found else []
        return shapes, plain

    def work_out(self, specs, by, folder):
        """Works the views asked for out side by side, each kept for `view` to answer; those not done by `by` are left out."""
        asked = [spec for spec in specs if "detail" not in spec]
        if not asked:
            return
        # Each shape alone, without what a script hung on it, as a fillet's
        # history, which the kernel cannot hand to another run.
        bare = [(name, bd.Shape.cast(shape.wrapped)) for name, shape in zip(self.names, self.shapes)]
        try:
            results = apart.worked_out(bare, self.centre, asked, _named, by, folder, self.gears, self.bearings)
        except (OSError, TypeError) as problem:
            # Parts that cannot be handed over, or no run started, are drawn here, one view after another.
            progress.step(f"Drawing the views one after another, as they could not be handed to runs of their own: {problem}.")
            return
        self.ready = {json.dumps(spec, sort_keys=True): results[index] for index, spec in enumerate(asked)}

    def worked_out(self, spec):
        """Whether `work_out` made this view, or tried to: its steps are said already."""
        return json.dumps(spec, sort_keys=True) in self.ready

    def view(self, spec):
        """A straight, angled, auxiliary or section view, as asked; or why it cannot be made."""
        ready = self.ready.get(json.dumps(spec, sort_keys=True))
        if isinstance(ready, Exception):
            raise ready
        if ready is not None:
            return ready
        shapes, names, centre = self.shapes, self.names, self.centre
        if "section" in spec:
            look, up = views.NAMED[spec["looking"]]
            uncut = spec.get("uncut") or []
            unknown = [name for name in uncut if name not in names]
            if unknown:
                raise ValueError(
                    f"section {spec['section']} leaves {', '.join(unknown)} whole, which the drawing does not show; "
                    f"it shows {', '.join(names)}"
                )
            revolved_names = spec.get("revolved") or []
            _check_revolved(spec, revolved_names, names)
            whole = {index for index, name in enumerate(names) if name in uncut}
            turned = {index for index, name in enumerate(names) if name in revolved_names}
            cut, plain = self._section_shapes(whole)
            view = views.section(spec["section"], cut, look, up, centre, spec["through"], whole, turned, plain)
            gearing.pitch_marks(view, self._gears_of([i for i in range(len(names)) if i not in turned]))
            # A bearing's cut ring is not hatched, and carries its crosses.
            cut_bearings = [i for i, name in enumerate(names) if name in self.bearings and i not in whole and i not in turned]
            view.unhatched = cut_bearings
            bearings.crosses(view, [self.bearings[names[i]] for i in cut_bearings], spec["through"])
            if turned:
                faces = [triangle for index in sorted(turned) for triangle in _triangles(shapes[index])]
                revolved.turn_into(view, faces, spec["axis"]["through"], spec["axis"]["along"])
            return view
        drawn = self.drawn_shapes()
        if "auxiliary" in spec:
            look = spec["direction"]
            view = views.projected(spec["auxiliary"], drawn, look, _up_for(look), centre, hidden=spec.get("hidden", True))
            view.facing = _facing(shapes, look)
        else:
            name = spec["view"]
            look, up = views.NAMED[name]
            view = views.projected(name, drawn, look, up, centre, hidden=spec.get("hidden", name != "iso"))
        gearing.pitch_marks(view, self._gears_of(range(len(names))))
        for first_name, first, second_name, second in gearing.meshing(self.gears):
            others = [shape for shape, one in zip(drawn, names) if one not in (first_name, second_name)]
            gearing.mesh_seen(view, first, second, others)
        gearing.helix_marks(view, self.gears, drawn, names)
        return view

    def lines_found(self, spec):
        """How many lines Blender found of a view: none, as the parts' views are worked out here."""
        return None

    def profile(self, view):
        """A straight or auxiliary view's DXF: the parts' cutting profile through it."""
        return views.profile(view.name, self.shapes, view.look, view.up, view.centre)


# How far a part's faces, as triangles, may stray from the part, as a share of its size.
TRIANGLES_OFF = 1e-3


def _triangles(shape):
    """A part's faces as triangles, each three points in its own millimetres."""
    size = max(shape.bounding_box().diagonal, 1e-6)
    points, triangles = shape.tessellate(size * TRIANGLES_OFF)
    at = [(p.X, p.Y, p.Z) for p in points]
    return [(at[a], at[b], at[c]) for a, b, c in triangles]


def _check_revolved(spec, asked, names):
    """Why a section's revolved parts cannot be drawn: one it does not show."""
    unknown = [name for name in asked if name not in names]
    if unknown:
        raise ValueError(
            f"section {spec['section']} revolves {', '.join(unknown)}, which the drawing does not show; "
            f"it shows {', '.join(names)}"
        )


# What became of a view asked for: drawn, left out for want of time, or
# refused with its reason among the drawing's problems.
DRAWN, LEFT_OUT, REFUSED = "drawn", "left out", "refused"


def _build_views(source, specs, problems, left_out, fates, by=None, folder=None):
    """
    Builds the views asked for, keeping in `fates`, by each view's name, what
    became of it, and in `left_out` each not done by `by`.
    """
    built = {}
    order = []
    # Every view asked for is in the record, nothing yet become of it.
    for spec in specs:
        fates.setdefault(_view_name(spec), None)
    # Views of the parts' shapes are worked out side by side first, those not
    # done by `by` left out.
    if hasattr(source, "work_out") and folder is not None:
        source.work_out(specs, by, folder)
    # Details last, each once the view it is taken from is made, however
    # they are listed: a detail of a detail follows its own.
    rest = [spec for spec in specs if "detail" not in spec]
    pending = [spec for spec in specs if "detail" in spec]
    while pending:
        ready = [spec for spec in pending if spec.get("of") in built or spec.get("of") not in {d["detail"] for d in pending}]
        if not ready:
            ready = pending[:1]
        rest_now, pending = ready, [spec for spec in pending if spec not in ready]
        _build_some(source, rest + rest_now, problems, built, order, left_out, fates)
        rest = []
    if rest:
        _build_some(source, rest, problems, built, order, left_out, fates)
    return built, order


def _named(spec):
    """A view as the steps of a drawing name it."""
    for key, word in (("section", "section"), ("auxiliary", "view"), ("detail", "detail")):
        if key in spec:
            return f"{word} {spec[key]}"
    return f"the {spec.get('view')} view"


def _view_name(spec):
    return spec.get("view") or spec.get("section") or spec.get("auxiliary") or spec.get("detail")


def _build_some(source, specs, problems, built, order, left_out, fates):
    for spec in specs:
        name = _view_name(spec)
        # A view worked out apart said its own steps as it went.
        apart_already = "detail" not in spec and getattr(source, "worked_out", lambda _: False)(spec)
        if not apart_already:
            found = source.lines_found(spec) if "detail" not in spec else None
            progress.step(f"Drawing {_named(spec)}" + (f", from the {found} lines Blender found." if found is not None else "."))
        try:
            if "detail" in spec:
                parent = built.get(spec["of"])
                if parent is None:
                    # One taken from a view left out is left out with it.
                    if fates.get(spec["of"]) == LEFT_OUT:
                        left_out.append(spec)
                        fates[name] = LEFT_OUT
                        continue
                    # One taken from a view refused already says nothing more.
                    if fates.get(spec["of"]) == REFUSED:
                        fates[name] = REFUSED
                        continue
                    # Any other missing view is said, by name, never passed over.
                    raise ValueError(
                        f"detail {spec['detail']} is of the {spec['of']} view, which "
                        + ("was not drawn before it" if spec["of"] in fates else "the drawing does not have")
                    )
                view = views.detail(spec["detail"], parent, spec["at"], float(spec["radius"]))
                view.label = f"DETAIL {spec['detail']}"
                view.magnify = float(spec.get("scale", 2))
                view.kind = "detail"
            elif "section" in spec:
                view = source.view(spec)
                view.label = f"SECTION {spec['section']}-{spec['section']}"
                # The straight view it looks as, whose place it can take.
                view.looks_as = spec["looking"]
                view.kind = "section"
            elif "auxiliary" in spec:
                view = source.view(spec)
                view.label = f"VIEW {spec['auxiliary']}"
                view.kind = "auxiliary"
            else:
                view = source.view(spec)
                view.kind = "named"
        except apart.LeftOut:
            left_out.append(spec)
            fates[name] = LEFT_OUT
            continue
        except (ValueError, KeyError) as problem:
            problems.append(str(problem).strip("'\""))
            fates[name] = REFUSED
            continue
        except Exception as problem:  # noqa: BLE001 - the kernel's own failures, said as the view's
            said = str(problem).strip() or "no reason given"
            problems.append(
                f"{_named(spec)} could not be drawn: "
                + (said if isinstance(problem, apart.ViewFailed) else f"{type(problem).__name__}, {said}")
                + ("; a plane through other geometry, even a little away, may cut it" if "section" in spec else "")
            )
            fates[name] = REFUSED
            continue
        name = view.name
        if name in built:
            problems.append(f"two views are called {name}")
            continue
        built[name] = view
        fates[name] = DRAWN
        order.append(view)
        if not apart_already:
            progress.step(f"Drew {_named(spec)}: {len(view.lines)} lines and {len(view.arcs)} arcs.")


def _draw_view(target, view, origin, scale):
    """Draws a view, and answers its centre lines on the sheet, which marks placed after keep clear of."""
    at = lambda p: (origin[0] + p[0] * scale, origin[1] + p[1] * scale)
    for layer, points in view.lines:
        target.line(layer, [at(p) for p in points])
    for layer, cx, cy, r, start, end in view.arcs:
        x, y = at((cx, cy))
        target.arc(layer, x, y, r * scale, start, end)
    centres = centre_lines(view, origin, scale)
    for a, b in centres:
        target.line("centre", [a, b])
    for cx, cy, r, start, end in getattr(view, "pitch", []):
        x, y = at((cx, cy))
        target.arc("centre", x, y, r * scale, start, end)
    unhatched = set(getattr(view, "unhatched", ()))
    for index, polygons in view.cut:
        if index in unhatched:
            continue
        hatch(target, [[at(p) for p in polygon] for polygon in polygons], HATCH_ANGLES[index % len(HATCH_ANGLES)])
    return centres


# Hidden edges crowd a view where, in this many squares of paper this wide in
# mm, they run on average closer than CROWDED_GAP mm apart: dashes that close
# run together into a mass, as a bladed row's seen end on do.
CROWDED_SQUARE = 5.0
CROWDED_GAP = 1.0
CROWDED_SQUARES = 4


def _hidden_crowded(slot):
    """Whether a view's hidden edges lie so close on the sheet, somewhere, that they read as a mass."""
    view, scale = slot.view, slot.scale
    segments = [(a, b) for layer, points in view.lines if layer == "hidden" for a, b in zip(points, points[1:])]
    for layer, cx, cy, r, start, end in view.arcs:
        if layer != "hidden":
            continue
        sweep = (end - start) % 360 or 360
        steps = max(4, math.ceil(sweep / 10))
        turn = lambda i: math.radians(start + sweep * i / steps)
        points = [(cx + r * math.cos(turn(i)), cy + r * math.sin(turn(i))) for i in range(steps + 1)]
        segments += list(zip(points, points[1:]))
    ink = {}
    for a, b in segments:
        length = math.dist(a, b) * scale
        pieces = max(1, math.ceil(length))
        for k in range(pieces):
            t = (k + 0.5) / pieces
            x, y = (a[0] + (b[0] - a[0]) * t) * scale, (a[1] + (b[1] - a[1]) * t) * scale
            square = (math.floor(x / CROWDED_SQUARE), math.floor(y / CROWDED_SQUARE))
            ink[square] = ink.get(square, 0.0) + length / pieces
    # Lines a gap apart lay square / gap of their length in each square.
    dense = CROWDED_SQUARE * CROWDED_SQUARE / CROWDED_GAP
    return sum(1 for length in ink.values() if length > dense) >= CROWDED_SQUARES


def _view_report(slot):
    """A view as the answer gives it: what it spans of the model, across and up, so its scale can be checked."""
    left, bottom, right, top = slot.view.bounds()
    return {
        "name": slot.view.name,
        "kind": slot.view.kind,
        "scale": layout.scale_text(slot.scale),
        "size": [round(right - left, 2), round(top - bottom, 2)],
        **({"hiddenCrowded": True} if _hidden_crowded(slot) else {}),
    }


def _facing(shapes, look):
    """The middle, by area, of the flat faces a view along `look` sees squarely, or nothing."""
    towards = -bd.Vector(look).normalized()
    total, middle = 0.0, bd.Vector(0, 0, 0)
    for shape in shapes:
        for face in shape.faces().filter_by(bd.GeomType.PLANE):
            if face.normal_at().dot(towards) >= 0.99:
                total += face.area
                middle += face.center() * face.area
    return middle / total if total > 1e-9 else None


def _sheet_at(scale, spec, slots, built, found, projection, listed=None):
    """
    The sheet with its views at `scale`, marked and dimensioned, and how many
    of its dimensions found no clear room; nothing when the views do not fit.
    """
    target = sheet.Sheet(spec.get("sheet", "A3"), spec.get("orientation", "landscape"))
    # A parts list takes room above the title block: the views are laid out
    # in the frame round the corner the two hold, and keep out of it.
    area, corner = parts_list.area(target, listed) if listed else (target.drawing_area(), None)
    if layout.arrange(slots, projection, area, scale, corner) is None:
        return None
    target.cut = sheet.frame_and_title(target, spec.get("title") or {}, layout.scale_text(scale), projection)
    taken = dimensions.Taken(area)
    if listed:
        parts_list.table(target, listed, taken)
        taken.texts.append(corner)
    for slot in slots:
        left, bottom, right, top = slot.view.bounds()
        taken.views.append(
            (
                (slot.origin[0] + left * slot.scale, slot.origin[1] + bottom * slot.scale,
                 slot.origin[0] + right * slot.scale, slot.origin[1] + top * slot.scale),
                slot.view.name,
            )
        )
    by_name = {slot.view.name: slot for slot in slots}
    for slot in slots:
        taken.lines += _draw_view(target, slot.view, slot.origin, slot.scale)
    # What marks a view on another comes before the dimensions, which keep clear of it.
    for slot in slots:
        if slot.view.kind == "detail":
            target.arc("thin", slot.origin[0], slot.origin[1], slot.view.window[2] * slot.scale)
            detail_mark(target, slot.view, by_name[slot.view.parent.name], taken)
    for wanted in _view_specs(spec.get("views")):
        if "section" not in wanted or wanted["section"] not in built:
            continue
        section_view = built[wanted["section"]]
        for slot in slots:
            if slot.view.kind == "named" and slot.view.name != "iso" and cutting_line(target, slot.view, slot, section_view, wanted["through"], taken):
                break
    for slot in slots:
        if slot.view.kind == "auxiliary":
            direction_mark(target, slot.view, slots, taken)
    # Lengths first, each side's shortest nearest its view, then leaders, which find their way between them.
    placers = {
        slot.view.name: dimensions.Placer(
            target, slot.origin, slot.scale, slot.view.bounds(), taken, slot.view.name, slot.view.circles, drawn_segments(slot)
        )
        for slot in slots
    }
    for slot in slots:
        dimension_kinds.place_lines(placers[slot.view.name], found[slot.view.name], slot.scale)
    for slot in slots:
        dimension_kinds.place_leaders(placers[slot.view.name], found[slot.view.name])
    # Balloons after the leaders, round the view they are on.
    crowded_balloons = 0
    if listed:
        crowded_balloons = parts_list.balloons(target, slots, taken, listed)
    # A view's name last, under all it holds, so it is never caught between
    # a view and its own dimensions.
    for slot in slots:
        if slot.view.label:
            _name_view(target, slot, scale, taken)
    return target, sum(m.crowded for measures in found.values() for m in measures) + crowded_balloons


def _name_view(target, slot, scale, taken):
    """
    A section's, a detail's or a direction's name under its view, below all
    the view holds there: its centre lines, the circles of details marked on
    it, and the stack of its dimensions and marks, followed down as long as
    each lies within a level of the one above. Where that meets something,
    above the view the same way; failing both, at the foot of the room the
    view was given.
    """
    label = layout.label_of(slot, scale)
    width = sheet.lettering.width(label, sheet.TEXT)
    span = (slot.origin[0] - width / 2, slot.origin[0] + width / 2)
    _, bottom, _, top = slot.view.bounds()
    marked = bool(slot.view.circles or slot.view.axes or slot.view.arcs)
    past = layout.CENTRE_PAST if marked else 0.0
    lowest = slot.origin[1] + bottom * slot.scale - past
    highest = slot.origin[1] + top * slot.scale + past
    for _, cy, r in slot.marks:
        lowest = min(lowest, slot.origin[1] + (cy - r) * slot.scale)
        highest = max(highest, slot.origin[1] + (cy + r) * slot.scale)
    held = [box for box in list(taken.texts) + [dimensions._box_of([a, b]) for a, b in taken.lines]
            if box[2] >= span[0] and box[0] <= span[1]]
    reach = dimensions.STEP + sheet.TEXT
    moved = True
    while moved:
        moved = False
        for box in held:
            if box[1] < lowest <= box[3] + reach and box[3] <= highest:
                lowest, moved = box[1], True
            if box[3] > highest >= box[1] - reach and box[1] >= lowest:
                highest, moved = box[3], True
    _, height = slot.footprint(scale)
    floor = slot.origin[1] - (height - layout.NAME_ROOM) / 2 - sheet.TEXT - 3
    candidates = [lowest - 2 - sheet.TEXT, highest + 2, floor]
    boxes = [(span[0], y, span[1], y + sheet.TEXT) for y in candidates]
    box = next((b for b in boxes if taken.clear([b], [])), boxes[-1])
    target.text(label, slot.origin[0], box[1], sheet.TEXT, "centre")
    taken.texts.append(box)


def _unmarked(built, specs, left_out=()):
    """
    Sections and views along a direction that no straight view of the
    drawing can mark, with the views that could: a section's cutting plane is
    drawn on a view that sees it edge on, a direction's arrow on one it is
    seen across.
    """
    straight = [view for view in built.values() if view.kind == "named" and view.name != "iso"]
    # A straight view left out for time would have marked it: its absence is said already.
    straight += [views.View(one["view"], *views.NAMED[one["view"]], (0, 0, 0)) for one in left_out if one.get("view") in views.NAMED and one["view"] != "iso"]
    sees = {
        "section": lambda view, look: bd.Vector(look).cross(view.look).length >= 1e-9,
        "auxiliary": lambda view, look: math.hypot(look.dot(view.right), look.dot(view.up)) >= 0.3,
    }
    problems = []
    for wanted in specs:
        kind = "section" if "section" in wanted else "auxiliary" if "auxiliary" in wanted else None
        view = built.get(wanted.get(kind)) if kind else None
        if view is None or any(sees[kind](other, view.look) for other in straight):
            continue
        could = []
        for name in ("top", "front", "right", "left", "bottom", "back"):
            look, up = views.NAMED[name]
            if sees[kind](views.View(name, look, up, (0, 0, 0)), view.look):
                could.append(name)
        what = (
            f"section {view.name}'s cutting plane shows on no view of the drawing"
            if kind == "section"
            else f"view {view.name}'s direction shows on no view of the drawing"
        )
        problems.append(f"{what}, which it is marked on; add one, such as {' or '.join(could[:2])}")
    return problems


def _left_out_note(left_out, dimensions):
    """What the drawing left out for want of time, with the dimensions on it, and what draws it."""
    names = [_named(one) for one in left_out]
    gone = {_view_name(one) for one in left_out}
    on_them = [str(index + 1) for index, wanted in enumerate(dimensions) if wanted.get("view") in gone]
    return (
        f"Left out, not done in the time the drawing has: {_listed(names)}"
        + (f", with dimension{'s' if len(on_them) > 1 else ''} {_listed(on_them)} on {'them' if len(names) > 1 else 'it'}" if on_them else "")
        + f". Draw {'them' if len(names) > 1 else 'it'} in a call of {'their' if len(names) > 1 else 'its'} own, or of fewer parts."
    )


def _broken_notes(built, names):
    """Each section that left out parts the kernel could not cut cleanly, by name."""
    return [views.broken_said(view.name, [names[index] for index in view.broken]) for view in built.values() if getattr(view, "broken", None)]


def draw(source, spec, folder, by=None):
    """
    Draws from `source`, the parts' shapes or a scene's lines, writes each
    output, and answers what the drawing holds; or refuses, saying why.
    Views not done by `by`, a time as time.time() gives it, are left out and
    said.
    """
    problems = []
    left_out = []
    fates = {}
    specs = _view_specs(spec.get("views"))
    # Parts a section leaves whole or turns, named by patterns, by the parts they match.
    for one in specs:
        for key in ("uncut", "revolved"):
            if one.get(key):
                try:
                    one[key] = patterns.expanded(one[key], list(getattr(source, "names", [])), f"{_named(one)}'s {key}")
                except ValueError as problem:
                    problems.append(str(problem))
    built, order = _build_views(source, specs, problems, left_out, fates, by, folder)
    if left_out and not built and not problems:
        raise DrawingRefused(
            [f"no view was done in the time the drawing has ({_listed([_named(one) for one in left_out])}); draw fewer parts, or fewer views in a call"],
            out_of_time=True,
        )
    notes = ([_left_out_note(left_out, spec.get("dimensions") or [])] if left_out else []) + _broken_notes(built, getattr(source, "names", []))

    problems += _unmarked(built, _view_specs(spec.get("views")), left_out)
    # The title block's fields a reader looks for first, said when left empty.
    empty = [(label, key) for key, label in TITLE_FIELDS if not str((spec.get("title") or {}).get(key, "")).strip()]
    if empty:
        notes.append(
            f"The title block leaves {_listed([label for label, _ in empty])} empty: "
            f"give {_listed([f'title.{key}' for _, key in empty])} to fill {'it' if len(empty) == 1 else 'them'}."
        )
    # Text the lettering cannot draw is refused, not drawn as question marks.
    for key, value in (spec.get("title") or {}).items():
        missing = sheet.lettering.unlettered(str(value))
        if missing:
            problems.append(
                f"the title's {key} has characters the lettering cannot draw: {' '.join(missing)}; "
                "scripts whose letters join, as Arabic, Hebrew, the Indian scripts and Thai do, are not lettered, "
                "so write it in another script or spell it in Latin letters"
            )

    found = {name: [] for name in built}
    for index, wanted in enumerate(spec.get("dimensions") or []):
        view = built.get(wanted.get("view"))
        if view is None:
            # One on a view refused, or left out and said so, says nothing more.
            if fates.get(wanted.get("view")) not in (LEFT_OUT, REFUSED):
                problems.append(
                    f"dimension {index + 1} is on the {wanted.get('view')} view, which "
                    + ("was not drawn" if wanted.get("view") in fates else "the drawing does not have")
                )
            continue
        if _angled(view):
            problems.append(
                f"dimension {index + 1} is on {'the angled view' if view.kind == 'named' else f'detail {view.name}, of the angled view,'} "
                "where lengths are foreshortened; dimension a straight view"
            )
            continue
        try:
            measured = dimension_kinds.measure(view, wanted, index, getattr(source, "shapes", None))
        except dimensions.Unmeasured as problem:
            problems.append(str(problem))
            continue
        differs = dimensions.checked(measured)
        if differs:
            problems.append(f"dimension {index + 1} {differs}")
            continue
        found[view.name].append(measured)
    # A drawing of parts asked for no dimensions carries its overall sizes
    # and its gears' centre distances, each left out where it cannot be measured.
    if spec.get("dimensions") is None and hasattr(source, "shapes"):
        given = []
        for wanted in defaults.dimensions(built, getattr(source, "gears", {})):
            try:
                measured = dimension_kinds.measure(built[wanted["view"]], wanted, len(given), source.shapes)
            except dimensions.Unmeasured:
                continue
            found[wanted["view"]].append(measured)
            given.append(measured)
        notes.append(defaults.note(given))
    listed = None
    if spec.get("parts_list"):
        try:
            listed = parts_list.listed(source, spec, built)
        except ValueError as problem:
            problems.append(str(problem))
    if problems:
        raise DrawingRefused(problems)

    size = spec.get("sheet", "A3")
    projection = spec.get("projection", "first")
    # The back view stands beyond the side view it is projected past; without
    # that view it would stand in its place, so it is placed apart and named.
    beside_back = "right" if projection == "third" else "left"
    for view in order:
        if view.kind == "named" and view.name == "back" and beside_back not in built:
            view.label = "BACK VIEW"
    slots = []
    rooms = []
    for view in order:
        rooms.append(dimension_kinds.room(found[view.name], view.bounds()))
        slots.append(layout.Slot(view, getattr(view, "magnify", 1.0), 0, 0, view.label is not None))
    by_name = {slot.view.name: slot for slot in slots}
    for slot in slots:
        if slot.view.kind == "detail":
            by_name[slot.view.parent.name].marks.append(slot.view.window)

    def spaced(share):
        """The room kept round each view: a share of what its dimensions would take each on a level of its own."""
        for slot, (room_x, room_y) in zip(slots, rooms):
            slot.room_x, slot.room_y = room_x * share, room_y * share

    asked = layout.parse_scale(spec["scale"]) if spec.get("scale") else None
    # The largest standard scale at which the views fit and every dimension
    # is placed clear, the views spaced as widely as that allows: dimensions
    # that need not stack share levels, so the room each would take alone is
    # often more than they need. Failing that, the next scale down, if it
    # places them all clear, as a drafter steps down once for room; else the
    # largest, spaced where fewest are crowded. Further down the part only
    # shrinks under lettering of the same size, which is no clearer: a
    # larger sheet is.
    # The angled view, which carries no dimension, can be drawn at a scale of
    # its own and named with it: where it alone keeps the views from fitting,
    # it steps down before the sheet does, by two standard scales at most, so
    # it stays a picture of the part and never shrinks to a speck.
    angled = next((slot for slot in slots if slot.view.kind == "named" and slot.view.name == "iso"), None)

    def angled_at(sheet_scale, own):
        if angled is None:
            return
        angled.magnify = float(own / sheet_scale) if own is not None else 1.0
        angled.named = own is not None
        angled.view.label = "ISO VIEW" if own is not None else None

    tried = []
    for scale in [asked] if asked is not None else layout.SCALES:
        smaller = [None] + ([s for s in layout.SCALES if s < scale][:ANGLED_STEPS] if angled is not None else [])
        for own in smaller:
            angled_at(scale, own)
            for share in ROOM_SHARES:
                spaced(share)
                progress.step(f"Laying the views out at {layout.scale_text(scale)}.")
                drawn = _sheet_at(scale, spec, slots, built, found, projection, listed)
                if drawn is None:
                    continue
                tried.append((drawn[1], scale, share, own))
                if drawn[1] == 0:
                    break
            if any(one[1] == scale for one in tried):
                break
        if (tried and tried[-1][0] == 0) or len({one[1] for one in tried}) > 1:
            break
    if not tried:
        raise DrawingRefused(
            [
                f"the views do not fit on {size} at {spec['scale']}; choose a smaller scale or a larger sheet"
                if asked
                else f"the views do not fit on {size} at any standard scale; choose a larger sheet or fewer views"
            ]
        )
    clear = [one for one in tried if one[0] == 0]
    largest = [one for one in tried if one[1] == tried[0][1]]
    crowded, scale, share, own = clear[0] if clear else min(largest, key=lambda one: one[0])
    angled_at(scale, own)
    spaced(share)
    target, _ = _sheet_at(scale, spec, slots, built, found, projection, listed)

    # Each output written, or why not, in the order asked.
    outputs = []
    for output in spec.get("outputs") or []:
        path = os.path.join(folder, output["file"])
        kind = output["kind"]
        if kind == "dxf" and output.get("view"):
            view = built.get(output["view"])
            if view is None and fates.get(output["view"]) == LEFT_OUT:
                outputs.append(
                    {"file": output["file"], "failed": f"the {output['view']} view was not done in the time the drawing has; draw it in a call of its own"}
                )
                continue
            if view is None:
                raise DrawingRefused(
                    [
                        f"{output.get('name') or output['file']} is of the {output['view']} view, which "
                        + ("was not drawn" if output["view"] in fates else "the drawing does not have")
                    ]
                )
            if view.kind in ("named", "auxiliary"):
                view = source.profile(view)
            dxf.view_dxf(view, path)
        elif kind == "dxf":
            dxf.sheet_dxf(target, path)
        elif kind == "svg":
            writers.svg(target, path)
        elif kind == "pdf":
            writers.pdf(target, path)
        elif kind == "png":
            writers.png(target, path, longest=int(output.get("pixels", 4000)))
        else:
            raise DrawingRefused([f"no drawing is written as {kind}"])
        outputs.append({"file": output["file"]})
        progress.step(f"Wrote the {kind.upper()}.")
    if spec.get("picture"):
        # As large as a model is shown a picture, so none of its lines is resampled.
        writers.png(target, os.path.join(folder, spec["picture"]), longest=2000)
    return {
        "sheet": size,
        "orientation": spec.get("orientation", "landscape"),
        "scale": layout.scale_text(scale),
        "scaleAsked": asked is not None,
        "titleCut": target.cut,
        "projection": projection,
        "views": [_view_report(slot) for slot in slots],
        "dimensions": [
            {
                "view": name,
                "text": m.text,
                "kind": m.kind,
                **({"crowded": True} if m.crowded else {}),
                **({"beside": True} if m.beside else {}),
                **({"outside": True} if m.outside else {}),
                **({"moved": m.moved} if m.moved else {}),
                **({"said": m.said} if getattr(m, "said", None) else {}),
            }
            for name, measures in found.items()
            for m in measures
        ],
        "outputs": outputs,
        **({"leftOut": True} if left_out else {}),
        **({"notes": notes} if notes else {}),
        **({"partsList": parts_list.report(listed)} if listed else {}),
    }
