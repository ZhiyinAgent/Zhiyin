"""
Cut views of the parts, for the model to see inside them: a plane through a
point, square to the side it is looked at from, cuts the parts; each cut face
is filled with its part's colour, lighter, and hatched, and the edges beyond
the plane are drawn, as a drawing's section shows them. Made by the drawing
tool's sections, from the exact shapes, and drawn as panels of the build's
picture.
"""

import build123d as bd
from PIL import Image, ImageChops, ImageDraw

from . import patterns
from .drafting import apart, views
from .drafting.marks import HATCH_ANGLES, hatch
from .render import BACKGROUND, EDGE, PALETTE, PANEL, SUPER, TEXT, font, round_length

# Pixels, at the drawing size, to one millimetre of the drawing tool's hatching, so its spacing reads at this size.
HATCH_UNIT = 4


def lighter(colour):
    return tuple(round(c + (255 - c) * 0.55) for c in colour)


def place_text(point):
    return f"({', '.join(f'{round(v, 3):g}' for v in point)})"


def panels(parts, asked, by=None, folder=None):
    """
    The sections asked for, each as a panel; and, for each that could not be
    drawn, why, in words the model can act on. Given a folder to work in,
    they are worked out side by side, and those not done by `by`, a time as
    time.time() gives it, are named.
    """
    names = [name for name, _ in parts]
    drawn, notes = [], []
    wanted = []
    for number, spec in enumerate(asked, start=1):
        try:
            chosen = patterns.expanded(spec.get("parts") or names, names, f"section {number}'s parts")
        except ValueError as problem:
            notes.append(f"Section {number} was not drawn: {problem}.")
            continue
        unknown = [name for name in chosen if name not in names]
        if unknown:
            notes.append(f"Section {number} names {', '.join(unknown)}, which the script did not show; it showed {', '.join(names)}.")
            continue
        # In the build's order, as the shapes are cut: each part keeps its own
        # colour and name, however the section lists them.
        wanted.append((number, spec, [name for name in names if name in chosen]))
    made = _apart(parts, wanted, by, folder) if folder is not None and wanted else {}
    for number, spec, chosen in wanted:
        try:
            view = made[number] if number in made else _section(parts, number, spec, chosen)
            if isinstance(view, Exception):
                raise view
        except apart.LeftOut:
            notes.append(f"Section {number} was not drawn: it was not done in the time the build has; ask for it in a build of its own, or of fewer parts.")
            continue
        except ValueError as refused:
            notes.append(f"Section {number} was not drawn: {refused}.")
            continue
        if view.broken:
            notes.append(views.broken_said(str(number), [chosen[index] for index in view.broken]))
        drawn.append(panel(view, number, spec, [names.index(name) for name in chosen]))
    return drawn, notes


def _section(parts, number, spec, chosen):
    """One section, worked out here."""
    shapes = [shape for name, shape in parts if name in chosen]
    whole = shapes[0] if len(shapes) == 1 else bd.Compound(children=[bd.Shape.cast(s.wrapped) for s in shapes])
    look, up = views.NAMED[spec["looking"]]
    return views.section(str(number), shapes, look, up, whole.bounding_box().center(), spec["through"])


def _apart(parts, wanted, by, folder):
    """The sections, each worked out by a run of its own, by number; none if they cannot be handed over."""
    bare = [(name, bd.Shape.cast(shape.wrapped)) for name, shape in parts]
    specs = [{"section": str(number), "looking": spec["looking"], "through": spec["through"], "parts": chosen} for number, spec, chosen in wanted]
    try:
        results = apart.worked_out(bare, None, specs, lambda one: f"section {one['section']}", by, folder)
    except (OSError, TypeError):
        return {}
    return {number: results[index] for index, (number, _, _) in enumerate(wanted)}


def panel(view, number, spec, indices):
    """One section drawn at twice the size, then reduced, labelled with where it cuts and a scale."""
    size = PANEL * SUPER
    left, bottom, right, top = view.bounds()
    for _, polygons in view.cut:
        for polygon in polygons:
            left = min([left] + [p[0] for p in polygon])
            right = max([right] + [p[0] for p in polygon])
            bottom = min([bottom] + [p[1] for p in polygon])
            top = max([top] + [p[1] for p in polygon])
    # Room above for the label and below for the scale.
    scale = size * 0.7 / max(right - left, top - bottom, 1e-6)
    middle = ((left + right) / 2, (bottom + top) / 2)

    def at(point):
        return (size / 2 + (point[0] - middle[0]) * scale, size / 2 + 10 * SUPER - (point[1] - middle[1]) * scale)

    picture = Image.new("RGB", (size, size), tuple(int(v) for v in BACKGROUND))
    draw = ImageDraw.Draw(picture)
    for index, polygons in view.cut:
        part = indices[index]
        colour = PALETTE[part % len(PALETTE)]
        on_sheet = [[at(p) for p in polygon] for polygon in polygons]
        # Filled by the even-odd rule, so a hole in a cut face stays open.
        inside = Image.new("1", (size, size), 0)
        for polygon in on_sheet:
            one = Image.new("1", (size, size), 0)
            ImageDraw.Draw(one).polygon(polygon, fill=1)
            inside = ImageChops.logical_xor(inside, one)
        picture.paste(lighter(colour), mask=inside)

        class Strokes:
            def line(self, _layer, points):
                draw.line([(x * HATCH_UNIT, y * HATCH_UNIT) for x, y in points], fill=colour, width=SUPER)

        hatch(Strokes(), [[(x / HATCH_UNIT, y / HATCH_UNIT) for x, y in polygon] for polygon in on_sheet], HATCH_ANGLES[part % len(HATCH_ANGLES)])
    ink = tuple(int(v) for v in EDGE)
    for layer, points in view.lines:
        draw.line([at(p) for p in points], fill=ink, width=(2 if layer == "visible" else 1) * SUPER)
    for layer, cx, cy, radius, start, end in view.arcs:
        x, y = at((cx, cy))
        r = radius * scale
        # Anticlockwise in the drawing is clockwise on the picture, whose y runs down.
        draw.arc((x - r, y - r, x + r, y + r), -end, -start, fill=ink, width=(2 if layer == "visible" else 1) * SUPER)
    picture = picture.resize((PANEL, PANEL), Image.LANCZOS)
    label = ImageDraw.Draw(picture)
    label.text((12, 10), f"Section {number}, looking from the {spec['looking']}", fill=TEXT, font=font(15))
    label.text((12, 30), f"through {place_text(spec['through'])}", fill=TEXT, font=font(13))
    per_pixel = scale / SUPER
    length = round_length(PANEL / per_pixel)
    width = length * per_pixel
    end = PANEL - 16
    label.line((end - width, PANEL - 22, end, PANEL - 22), fill=TEXT, width=2)
    for x in (end - width, end):
        label.line((x, PANEL - 27, x, PANEL - 17), fill=TEXT, width=2)
    text = f"{length:g} mm"
    label.text((end - width / 2 - label.textlength(text, font=font(13)) / 2, PANEL - 42), text, fill=TEXT, font=font(13))
    return picture
