"""
A drawing sheet as lines, arcs and filled shapes in millimetres, origin at its
bottom left, each on a layer that says how it is drawn: the kinds of line ISO
128 gives a technical drawing. Every format a drawing is written to draws the
same sheet.
"""

import datetime
import math
import unicodedata

from . import lettering

# Landscape sizes, ISO 216.
SIZES = {"A4": (297, 210), "A3": (420, 297), "A2": (594, 420), "A1": (841, 594), "A0": (1189, 841)}

# How each layer is drawn: its width, and its dashes (on, off, ...), in mm.
LAYERS = {
    "visible": {"width": 0.5, "dash": None},
    "hidden": {"width": 0.25, "dash": (3.0, 1.0)},
    "centre": {"width": 0.25, "dash": (8.0, 1.0, 1.0, 1.0)},
    "thin": {"width": 0.25, "dash": None},
    "hatch": {"width": 0.18, "dash": None},
    "cutting": {"width": 0.25, "dash": (8.0, 1.0, 1.0, 1.0)},
    "cutting-ends": {"width": 0.7, "dash": None},
    "text": {"width": 0.25, "dash": None},
    "frame": {"width": 0.7, "dash": None},
}

# The shortest dash or gap a line is drawn with, in mm: shorter, a reader sees
# none, and a PDF reader refuses a dash that rounds to nothing.
LEAST_DASH = 0.1


def dashes(layer, points, closed=False):
    """
    A line's dashes on its layer, made shorter on a line too short for two of
    them, so even a short hidden or centre line shows a gap and reads as one.
    A line too short for any dash a reader could see is drawn solid.
    """
    pattern = LAYERS[layer]["dash"]
    if not pattern:
        return None
    run = points + [points[0]] if closed else points
    length = sum(math.dist(a, b) for a, b in zip(run, run[1:]))
    cycle = sum(pattern)
    if length >= 2 * cycle:
        return pattern
    fitted = tuple(d * length / (2 * cycle) for d in pattern)
    return fitted if min(fitted) >= LEAST_DASH else None


TEXT = 3.5
SMALL = 2.5
LEFT_MARGIN = 20
MARGIN = 10
TITLE_WIDTH = 180
TITLE_HEIGHT = 40


class Sheet:
    def __init__(self, size, orientation="landscape"):
        width, height = SIZES[size]
        if orientation == "portrait":
            width, height = height, width
        self.size = size
        self.width = width
        self.height = height
        self.lines = []  # (layer, points, closed)
        self.arcs = []  # (layer, cx, cy, radius, start°, end°), counter-clockwise
        self.fills = []  # (layer, points)

    def line(self, layer, points, closed=False):
        if len(points) > 1:
            self.lines.append((layer, [tuple(p) for p in points], closed))

    def arc(self, layer, cx, cy, radius, start=0.0, end=360.0):
        self.arcs.append((layer, cx, cy, radius, start, end))

    def fill(self, layer, points):
        self.fills.append((layer, [tuple(p) for p in points]))

    def text(self, value, x, y, height=TEXT, anchor="left", angle=0.0):
        for stroke in lettering.strokes(value, height, x, y, anchor, angle):
            self.line("text", stroke)

    def drawing_area(self):
        """Inside the frame, above the title block: (left, bottom, right, top)."""
        return (LEFT_MARGIN + 5, MARGIN + TITLE_HEIGHT + 5, self.width - MARGIN - 5, self.height - MARGIN - 5)

    def polylines(self, tolerance=0.05):
        """Every line and arc as points, arcs flattened to within `tolerance` mm."""
        out = [(layer, points, closed) for layer, points, closed in self.lines]
        for layer, cx, cy, radius, start, end in self.arcs:
            sweep = (end - start) % 360 or 360
            steps = max(8, math.ceil(math.radians(sweep) / (2 * math.acos(max(-1, 1 - tolerance / max(radius, 1e-9))))))
            points = [
                (cx + radius * math.cos(math.radians(start + sweep * i / steps)), cy + radius * math.sin(math.radians(start + sweep * i / steps)))
                for i in range(steps + 1)
            ]
            out.append((layer, points, sweep >= 360))
        return out


def projection_symbol(sheet, x, y, projection):
    """ISO 5456-2's symbol for first- or third-angle projection, its middle at (x, y)."""
    # A truncated cone, its large end to the left, seen from the front and
    # from its small end; that view goes right of the front in third-angle
    # projection and left of it in first-angle.
    large, small, long = 4.5, 2.5, 7.0
    apart = 10.0
    cone_x, circle_x = (x + apart / 2, x - apart / 2) if projection == "first" else (x - apart / 2, x + apart / 2)
    sheet.line(
        "thin",
        [(cone_x - long / 2, y - large), (cone_x + long / 2, y - small), (cone_x + long / 2, y + small), (cone_x - long / 2, y + large)],
        closed=True,
    )
    sheet.arc("thin", circle_x, y, large)
    sheet.arc("thin", circle_x, y, small)
    sheet.line("centre", [(x - apart / 2 - large - 2, y), (x + apart / 2 + large + 2, y)])


# The smallest lettering a title block's field is made, in mm.
LEAST = 1.8
# A line's height and the space under it, as a share of the lettering's height.
LINE_PITCH = 1.4


def wrapped(value, height, room):
    """
    Text in lines no wider than `room` at `height`, broken between words, or
    between characters where a word, or a script without spaces, is wider.
    """
    lines = []
    value = unicodedata.normalize("NFC", value)
    for word in value.split(" "):
        line = f"{lines[-1]} {word}" if lines else word
        if lines and lettering.width(line, height) <= room:
            lines[-1] = line
            continue
        piece = ""
        for character in word:
            if piece and lettering.width(piece + character, height) > room:
                lines.append(piece)
                piece = ""
            piece += character
        lines.append(piece)
    return lines


def frame_and_title(sheet, title, scale_text, projection):
    """
    The frame, and the title block at its bottom right, as ISO 7200 lays one
    out. Answers the fields cut short, which are those that, at the smallest
    lettering and on as many lines as their cell holds, still do not fit.
    """
    cut = []
    right, top = sheet.width - MARGIN, sheet.height - MARGIN
    sheet.line("frame", [(LEFT_MARGIN, MARGIN), (right, MARGIN), (right, top), (LEFT_MARGIN, top)], closed=True)
    left = right - TITLE_WIDTH
    bottom = MARGIN
    block_top = bottom + TITLE_HEIGHT
    row = TITLE_HEIGHT / 4
    split = left + 110
    half = 35
    sheet.line("frame", [(left, bottom), (left, block_top), (right, block_top)])
    for i in (1, 2):
        sheet.line("thin", [(left, bottom + i * row), (right, bottom + i * row)])
    sheet.line("thin", [(split, bottom), (split, block_top)])
    sheet.line("thin", [(left + 55, bottom), (left + 55, bottom + 2 * row)])
    sheet.line("thin", [(split + half, bottom), (split + half, block_top)])

    def label(text, x, cell_top):
        sheet.text(text, x + 1.5, cell_top - SMALL * 0.8 - 1.2, SMALL * 0.8)

    def fitted(name, value, x, y, room, height, tall):
        """
        Text in a cell `room` wide and `tall` above its lowest baseline at
        `y`: on one line, made smaller to fit, else on more lines, the largest
        that fits; cut short with an ellipsis, and answered as cut, when even
        the smallest lettering on as many lines as the cell holds does not.
        """
        size = height
        while size >= LEAST - 1e-9:
            lines = wrapped(value, size, room)
            if size * (1 + LINE_PITCH * (len(lines) - 1)) <= tall:
                for index, line in enumerate(lines):
                    sheet.text(line, x, y + (len(lines) - 1 - index) * size * LINE_PITCH, size)
                return
            size = round(size - 0.1, 6)
        most = max(1, int((tall / LEAST - 1) / LINE_PITCH) + 1)
        lines = wrapped(value, LEAST, room)[:most]
        last = lines[-1]
        while last and lettering.width(last + "...", LEAST) > room:
            last = last[:-1]
        lines[-1] = last.rstrip() + "..."
        for index, line in enumerate(lines):
            sheet.text(line, x, y + (len(lines) - 1 - index) * LEAST * LINE_PITCH, LEAST)
        cut.append(name)

    # Under a field's label: what is left of its cell above its lowest baseline.
    field_tall = row - 1.6 - (SMALL * 0.8 + 1.2) - 0.6

    def field(name, key, value, x, y, width):
        label(name, x, y + row)
        if value:
            fitted(key, value, x + 1.5, y + 1.6, width - 3, TEXT, field_tall)

    when = title.get("date") or datetime.date.today().isoformat()
    label("Title", left, block_top)
    if title.get("title"):
        fitted("title", title["title"], left + 1.5, bottom + 2 * row + 2, split - left - 3, 6.0, 2 * row - 2 - (SMALL * 0.8 + 1.2) - 1)
    field("Drawing number", "number", title.get("number", ""), left, bottom + row, 55)
    field("Material", "material", title.get("material", ""), left + 55, bottom + row, split - left - 55)
    field("Drawn by", "author", title.get("author", ""), left, bottom, 55)
    field("Date", "date", when, left + 55, bottom, split - left - 55)
    field("Scale", "scale", scale_text, split, bottom + row, half)
    field("Sheet", "sheet", sheet.size, split + half, bottom + row, right - split - half)
    field("Revision", "revision", title.get("revision", ""), split, bottom, half)
    field("Units", "units", "mm", split + half, bottom, right - split - half)
    label("Projection", split, block_top)
    projection_symbol(sheet, split + half / 2, bottom + 2.75 * row, projection)
    label("By", split + half, block_top)
    if title.get("company"):
        fitted("company", title["company"], split + half + 1.5, bottom + 2 * row + 2, right - split - half - 3, SMALL, 2 * row - 2 - (SMALL * 0.8 + 1.2) - 1)
    return cut
