"""
Four views of the parts for the model to see: from the front, the top and
the right, at one scale, and at an angle. Each is shaded, with the part's
edges drawn dark and those behind it dashed and faint, so holes and pockets
show through, and each part named where it shows. Drawn from the exact shapes' own triangles with a depth buffer
in numpy, at twice the size, then reduced with Pillow.
"""

import math
import re
from collections import Counter

import numpy as np
from OCP.BRepTools import BRepTools
from PIL import Image, ImageDraw, ImageFont

from . import meshing

PANEL = 480
SUPER = 2
HEADER = 44
BACKGROUND = np.array((246, 247, 249), dtype=np.float32)
EDGE = np.array((34, 38, 46), dtype=np.float32)
HIDDEN = np.array((150, 156, 166), dtype=np.float32)
TEXT = (52, 58, 68)
PALETTE = [
    (92, 134, 186),
    (222, 140, 66),
    (104, 168, 104),
    (158, 112, 180),
    (206, 96, 104),
    (84, 166, 176),
    (184, 160, 80),
    (130, 130, 130),
]
AXES = (("X", (1, 0, 0), (200, 60, 60)), ("Y", (0, 1, 0), (60, 150, 60)), ("Z", (0, 0, 1), (60, 90, 200)))
# How many of the triangles' pixels are worked out at once.
CANDIDATES = 1_000_000


def xyz(vector):
    return (vector.X, vector.Y, vector.Z)


def unit(vector):
    vector = np.asarray(vector, dtype=np.float64)
    return vector / np.linalg.norm(vector)


# Each view's right, up, and towards the viewer, in the world's terms.
VIEWS = (
    ("Front, from -Y", unit((1, 0, 0)), unit((0, 0, 1)), unit((0, -1, 0)), True),
    ("Top, from +Z", unit((1, 0, 0)), unit((0, 1, 0)), unit((0, 0, 1)), True),
    ("Right, from +X", unit((0, 1, 0)), unit((0, 0, 1)), unit((1, 0, 0)), True),
    ("At an angle", unit((1, 1, 0)), unit((-1, 1, 2)), unit((1, -1, 1)), False),
)


def triangles_of(shape, deflection):
    """
    The shape's triangles for a picture: within `deflection` of the surface,
    turning at most 0.2 radians, and none smaller than `deflection`, about a
    pixel, so features too small to see add no facets. The mesh is cleared
    from the shape after, so nothing later reads it as one of that fineness.
    """
    try:
        return meshing.whole(shape, deflection, 0.2, smallest=deflection)
    finally:
        BRepTools.Clean_s(shape.wrapped)


class NothingDrawn(Exception):
    """No part could be divided into triangles; the message says why, part by part."""


class Mesh:
    """
    The parts' triangles and edges, in one set of arrays. A part whose faces
    cannot be divided into triangles is left out, with why, and the rest drawn.
    """

    def __init__(self, parts):
        corners = []
        for _, shape in parts:
            # Only sizes the facets and the edges' steps, so the quick box will do.
            box = shape.bounding_box(optimal=False)
            corners += [xyz(box.min), xyz(box.max)]
        corners = np.array(corners)
        self.diagonal = float(np.linalg.norm(corners.max(axis=0) - corners.min(axis=0))) or 1.0
        vertices, triangles, owners, edges = [], [], [], []
        self.undrawn = []
        for index, (name, shape) in enumerate(parts):
            try:
                points, faces = triangles_of(shape, max(self.diagonal / 800, 1e-4))
            except meshing.Unmeshed as unmeshed:
                self.undrawn.append((name, str(unmeshed)))
                continue
            except Exception as problem:  # noqa: BLE001 - the kernel's own failure, said as the part's
                self.undrawn.append((name, meshing.why(shape, problem)))
                continue
            if len(faces):
                base = sum(len(v) for v in vertices)
                vertices.append(points)
                triangles.append(faces + base)
                owners.append(np.full(len(faces), index))
            step = self.diagonal / 300
            for edge in shape.edges():
                count = int(min(400, max(2, math.ceil(edge.length / step) + 1)))
                along = [xyz(p) for p in edge.positions(list(np.linspace(0, 1, count)))]
                edges.append(np.array(along))
        self.vertices = np.concatenate(vertices) if vertices else np.zeros((0, 3))
        self.triangles = np.concatenate(triangles) if triangles else np.zeros((0, 3), dtype=int)
        self.owners = np.concatenate(owners) if owners else np.zeros(0, dtype=int)
        self.edges = edges
        if len(self.undrawn) == len(parts):
            raise NothingDrawn("; ".join(f"{name} {why}" for name, why in self.undrawn))


def projected(points, right, up, towards):
    return points @ np.stack([right, up, towards]).T


def extent(mesh, right, up, towards):
    """The middle and the larger side of what a view shows, in millimetres."""
    seen = projected(mesh.vertices, right, up, towards)
    if not len(seen):
        return (0.0, 0.0), 1.0
    low, high = seen.min(axis=0), seen.max(axis=0)
    return ((low[0] + high[0]) / 2, (low[1] + high[1]) / 2), max(high[0] - low[0], high[1] - low[1], 1e-9)


class Canvas:
    """One view's pixels, at twice the size: their colour and their nearest depth."""

    def __init__(self, size):
        self.size = size
        self.depth = np.full(size * size, -np.inf)
        self.colour = np.tile(BACKGROUND, (size * size, 1))
        # Which part each pixel shows, by its place among the parts; -1 for none.
        self.owner = np.full(size * size, -1, dtype=np.int64)

    def screen(self, points, view, middle, scale):
        _, right, up, towards, _ = view
        seen = projected(points, right, up, towards)
        x = (seen[:, 0] - middle[0]) * scale + self.size / 2
        y = self.size / 2 - (seen[:, 1] - middle[1]) * scale
        return x, y, seen[:, 2]

    def fill(self, mesh, view, middle, scale):
        _, right, up, towards, _ = view
        if not len(mesh.triangles):
            return
        x, y, z = self.screen(mesh.vertices, view, middle, scale)
        t = mesh.triangles
        corners = mesh.vertices[t]
        normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
        lengths = np.linalg.norm(normals, axis=1)
        normals = normals / np.maximum(lengths, 1e-12)[:, None]
        light = unit(towards + 0.45 * up + 0.3 * right)
        shade = 0.4 + 0.6 * np.abs(normals @ light)
        palette = np.array(PALETTE, dtype=np.float32)
        colours = palette[mesh.owners % len(PALETTE)] * shade[:, None]
        xs, ys, zs = x[t], y[t], z[t]
        area = (xs[:, 1] - xs[:, 0]) * (ys[:, 2] - ys[:, 0]) - (xs[:, 2] - xs[:, 0]) * (ys[:, 1] - ys[:, 0])
        low_x = np.clip(np.floor(xs.min(axis=1)), 0, self.size - 1).astype(np.int64)
        high_x = np.clip(np.floor(xs.max(axis=1)), 0, self.size - 1).astype(np.int64)
        low_y = np.clip(np.floor(ys.min(axis=1)), 0, self.size - 1).astype(np.int64)
        high_y = np.clip(np.floor(ys.max(axis=1)), 0, self.size - 1).astype(np.int64)
        on_screen = (
            (np.abs(area) > 1e-9)
            & (xs.max(axis=1) >= 0)
            & (xs.min(axis=1) < self.size)
            & (ys.max(axis=1) >= 0)
            & (ys.min(axis=1) < self.size)
        )
        chosen = np.nonzero(on_screen)[0]
        # In batches of about as many pixels as their boxes cover.
        boxes = np.cumsum((high_x - low_x + 1)[chosen] * (high_y - low_y + 1)[chosen])
        batch_of = boxes // CANDIDATES
        for number in np.unique(batch_of):
            self.cover(chosen[batch_of == number], xs, ys, zs, area, low_y, high_y, colours, mesh.owners)

    def cover(self, batch, xs, ys, zs, area, low_y, high_y, colours, owners):
        """Fills triangles row by row: each row's span between its edges, nearest first."""
        rows = high_y[batch] - low_y[batch] + 1
        owner = np.repeat(batch, rows)
        first_row = np.repeat(np.cumsum(rows) - rows, rows)
        cy = np.repeat(low_y[batch], rows) + (np.arange(len(owner)) - first_row) + 0.5
        x0, x1, x2 = (xs[owner, i] for i in range(3))
        y0, y1, y2 = (ys[owner, i] for i in range(3))
        left = np.full(len(owner), np.inf)
        right = np.full(len(owner), -np.inf)
        for (xa, ya), (xb, yb) in (((x0, y0), (x1, y1)), ((x1, y1), (x2, y2)), ((x2, y2), (x0, y0))):
            crosses = ((ya <= cy) & (cy < yb)) | ((yb <= cy) & (cy < ya))
            with np.errstate(divide="ignore", invalid="ignore"):
                x = xa + (cy - ya) * (xb - xa) / (yb - ya)
            left = np.where(crosses, np.minimum(left, x), left)
            right = np.where(crosses, np.maximum(right, x), right)
        start = np.clip(np.ceil(left - 0.5), 0, self.size).astype(np.int64, copy=False)
        end = np.clip(np.floor(right - 0.5), -1, self.size - 1).astype(np.int64, copy=False)
        lengths = np.where(np.isfinite(left) & np.isfinite(right), np.maximum(0, end - start + 1), 0)
        if not lengths.sum():
            return
        row = np.repeat(np.arange(len(owner)), lengths)
        px = np.repeat(start, lengths) + (np.arange(len(row)) - np.repeat(np.cumsum(lengths) - lengths, lengths))
        py = (cy[row] - 0.5).astype(np.int64)
        tri = owner[row]
        # Depth on the triangle's plane at each pixel's centre.
        z0, z1, z2 = (zs[tri, i] for i in range(3))
        tx0, tx1, tx2 = (xs[tri, i] for i in range(3))
        ty0, ty1, ty2 = (ys[tri, i] for i in range(3))
        a = area[tri]
        along_x = ((z1 - z0) * (ty2 - ty0) - (z2 - z0) * (ty1 - ty0)) / a
        along_y = ((z2 - z0) * (tx1 - tx0) - (z1 - z0) * (tx2 - tx0)) / a
        depth = z0 + along_x * (px + 0.5 - tx0) + along_y * (py + 0.5 - ty0)
        where = py * self.size + px
        # The nearest of each pixel's candidates, then only where it is nearer.
        order = np.lexsort((-depth, where))
        where, depth, tri = where[order], depth[order], tri[order]
        first = np.concatenate(([True], where[1:] != where[:-1]))
        where, depth, tri = where[first], depth[first], tri[first]
        nearer = depth > self.depth[where]
        self.depth[where[nearer]] = depth[nearer]
        self.colour[where[nearer]] = colours[tri[nearer]]
        self.owner[where[nearer]] = owners[tri[nearer]]

    def lines(self, mesh, view, middle, scale):
        """Edges in front dark, edges behind dashed and faint."""
        depths = self.depth.reshape(self.size, self.size)
        finite = depths[np.isfinite(depths)]
        reach = (finite.max() - finite.min()) if len(finite) else 1.0
        slack = max(reach * 0.004, 1.5 / scale)
        # The farthest of each pixel's neighbours: an edge at a silhouette or
        # a crease is level with one of them.
        padded = np.pad(depths, 1, constant_values=-np.inf)
        around = np.min(
            [padded[dy : dy + self.size, dx : dx + self.size] for dy in range(3) for dx in range(3)],
            axis=0,
        )
        front, behind = [], []
        for edge in mesh.edges:
            x, y, z = self.screen(edge, view, middle, scale)
            # Every half pixel along the edge, its distance along it kept for the dashes.
            lengths = np.hypot(np.diff(x), np.diff(y))
            counts = np.maximum(2, (lengths / 0.5).astype(int) + 1)
            segment = np.repeat(np.arange(len(lengths)), counts)
            t = np.concatenate([np.linspace(0, 1, n) for n in counts])
            sx = x[segment] + (x[segment + 1] - x[segment]) * t
            sy = y[segment] + (y[segment + 1] - y[segment]) * t
            sz = z[segment] + (z[segment + 1] - z[segment]) * t
            ix, iy = sx.astype(int), sy.astype(int)
            keep = (ix >= 0) & (iy >= 0) & (ix < self.size) & (iy < self.size)
            ix, iy, sz = ix[keep], iy[keep], sz[keep]
            seen = sz >= around[iy, ix] - slack
            front.append((ix[seen], iy[seen]))
            dashed = (np.arange(len(ix)) // 14) % 2 == 0
            behind.append((ix[~seen & dashed], iy[~seen & dashed]))
        colour = self.colour.reshape(self.size, self.size, 3)
        for points, ink, width in ((behind, HIDDEN, 1), (front, EDGE, 2)):
            if not points:
                continue
            ix = np.concatenate([p[0] for p in points])
            iy = np.concatenate([p[1] for p in points])
            for dx in range(width):
                for dy in range(width):
                    colour[np.clip(iy + dy, 0, self.size - 1), np.clip(ix + dx, 0, self.size - 1)] = ink

    def picture(self):
        pixels = np.clip(self.colour.reshape(self.size, self.size, 3), 0, 255).astype(np.uint8)
        return Image.fromarray(pixels, "RGB").resize((PANEL, PANEL), Image.LANCZOS)

    def owners(self):
        """Which part each pixel of the picture shows, at the picture's size."""
        step = self.size // PANEL
        return self.owner.reshape(self.size, self.size)[step // 2 :: step, step // 2 :: step]


def font(size):
    return ImageFont.load_default(size=size)


def round_length(longest):
    """A round length in millimetres, near a fifth of the view's width."""
    goal = longest / 5
    power = 10 ** math.floor(math.log10(goal))
    for step in (1, 2, 5, 10):
        if step * power >= goal:
            return step * power
    return 10 * power


def annotate(picture, view, scale):
    title, right, up, _, measured = view
    draw = ImageDraw.Draw(picture)
    draw.text((12, 10), title, fill=TEXT, font=font(15))
    # Which way the world's axes point in this view.
    origin = (40, PANEL - 40)
    for letter, axis, ink in AXES:
        dx, dy = float(np.dot(axis, right)), -float(np.dot(axis, up))
        if math.hypot(dx, dy) < 0.2:
            draw.ellipse((origin[0] - 4, origin[1] - 4, origin[0] + 4, origin[1] + 4), outline=ink, width=2)
            draw.text((origin[0] + 7, origin[1] + 2), letter, fill=ink, font=font(13))
            continue
        tip = (origin[0] + dx * 24, origin[1] + dy * 24)
        draw.line((origin, tip), fill=ink, width=2)
        draw.text((tip[0] + dx * 6 - 4, tip[1] + dy * 6 - 7), letter, fill=ink, font=font(13))
    if measured:
        per_pixel = scale / SUPER
        length = round_length(PANEL / per_pixel)
        width = length * per_pixel
        end = PANEL - 16
        draw.line((end - width, PANEL - 22, end, PANEL - 22), fill=TEXT, width=2)
        for x in (end - width, end):
            draw.line((x, PANEL - 27, x, PANEL - 17), fill=TEXT, width=2)
        label = f"{length:g} mm"
        draw.text((end - width / 2 - draw.textlength(label, font=font(13)) / 2, PANEL - 42), label, fill=TEXT, font=font(13))


LABEL = 13
LABEL_PAD = 3
LONGEST_NAME = 24
# What a name's plate keeps clear of: the view's title, its axes and its scale.
KEPT_CLEAR = ((0, 0, 260, 34), (0, PANEL - 78, 96, PANEL), (PANEL - 170, PANEL - 50, PANEL, PANEL))
# A part shown in fewer pixels than this is too small to name.
FEWEST_PIXELS = 4
# The most names a view holds, so they never hide what they name.
MOST_NAMES = 20
# Alike parts numbered in a row, this many or more, are named once for all of them.
FAMILY = 6


def inwardness(owners, deepest=48):
    """How many pixels in from the edge of the part it shows each pixel lies, up to `deepest`."""
    padded = np.pad(owners, 1, constant_values=-1)
    inside = (
        (owners >= 0)
        & (padded[:-2, 1:-1] == owners)
        & (padded[2:, 1:-1] == owners)
        & (padded[1:-1, :-2] == owners)
        & (padded[1:-1, 2:] == owners)
    )
    depth = inside.astype(np.int64)
    for _ in range(deepest - 1):
        padded = np.pad(inside, 1, constant_values=False)
        inside = inside & padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:]
        if not inside.any():
            break
        depth += inside
    return depth


def overlaps(box, other):
    return box[0] < other[2] and other[0] < box[2] and box[1] < other[3] and other[1] < box[3]


def name_parts(picture, owners, names):
    """
    Writes each part's name in the view, on a white plate edged in the part's
    colour: over the part where its name fits inside it, otherwise beside it
    with a line to it. Plates never cover one another or the view's own marks;
    a name with no room left is not written.
    """
    draw = ImageDraw.Draw(picture)
    depth = inwardness(owners)
    # Alike parts numbered in a row, as "Blade 1" to "Blade 40", are named once
    # for all of them, on the one that shows most.
    stems = [re.sub(r"[\s_-]*\d+$", "", name) or name for name in names]
    family = Counter(stems)
    words = [f"{stem} (all {family[stem]})" if family[stem] >= FAMILY else name for name, stem in zip(names, stems)]
    # Each part's pixels, gathered in one sort, however many parts there are.
    flat = owners.ravel()
    pixels = np.nonzero(flat >= 0)[0]
    pixels = pixels[np.argsort(flat[pixels], kind="stable")]
    shown, starts, counts = np.unique(flat[pixels], return_index=True, return_counts=True)
    anchors = {}
    showing_most = {}
    for index, start, count in zip(shown, starts, counts):
        if count < FEWEST_PIXELS:
            continue
        index = int(index)
        ys, xs = np.divmod(pixels[start : start + count], owners.shape[1])
        # The pixel deepest inside the part, the nearest its middle of those.
        nearest = np.hypot(ys - np.median(ys), xs - np.median(xs))
        best = np.lexsort((nearest, -depth[ys, xs]))[0]
        anchors[index] = (int(xs[best]), int(ys[best]), int(count))
        if family[stems[index]] >= FAMILY:
            kept = showing_most.get(stems[index])
            if kept is None or anchors[kept][2] < count:
                showing_most[stems[index]] = index
    anchors = {
        index: anchor
        for index, anchor in anchors.items()
        if family[stems[index]] < FAMILY or showing_most[stems[index]] == index
    }
    taken = list(KEPT_CLEAR)

    def plate(index):
        name = words[index]
        text = name if len(name) <= LONGEST_NAME else name[: LONGEST_NAME - 3] + "..."
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font(LABEL))
        width, height = right - left + 2 * LABEL_PAD, bottom - top + 2 * LABEL_PAD
        return text, (left, top), width, height

    def free(box):
        return (
            box[0] >= 2 and box[1] >= 2 and box[2] <= PANEL - 2 and box[3] <= PANEL - 2
            and not any(overlaps(box, other) for other in taken)
        )

    def covering(box):
        """What the pixels a plate would cover show, each as a share of them: a part by its place, -1 nothing."""
        region = owners[max(box[1], 0) : max(box[3], 0), max(box[0], 0) : max(box[2], 0)]
        if not region.size:
            return {}
        values, counts = np.unique(region, return_counts=True)
        return {int(value): count / region.size for value, count in zip(values, counts)}

    def write(index, text, offset, box, anchor=None):
        ink = tuple(int(c * 0.7) for c in PALETTE[index % len(PALETTE)])
        if anchor:
            middle = ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)
            draw.line((anchor, middle), fill=ink, width=1)
            draw.ellipse((anchor[0] - 2, anchor[1] - 2, anchor[0] + 2, anchor[1] + 2), fill=ink)
        draw.rectangle(box, fill=(255, 255, 255), outline=ink, width=1)
        draw.text((box[0] + LABEL_PAD - offset[0], box[1] + LABEL_PAD - offset[1]), text, fill=TEXT, font=font(LABEL))
        taken.append(box)

    # Names that fit inside their parts first, the largest part first; then
    # the rest beside their parts, the smallest first, so a small part keeps
    # the room nearest it.
    beside = []
    written = 0
    for index, (x, y, count) in sorted(anchors.items(), key=lambda item: -item[1][2]):
        if written >= MOST_NAMES:
            break
        text, offset, width, height = plate(index)
        box = (x - width // 2, y - height // 2, x - width // 2 + width, y - height // 2 + height)
        if covering(box).get(index, 0) >= 0.9 and free(box):
            write(index, text, offset, box)
            written += 1
        else:
            beside.append(index)
    for index in sorted(beside, key=lambda index: anchors[index][2]):
        if written >= MOST_NAMES:
            break
        x, y, _ = anchors[index]
        text, offset, width, height = plate(index)
        boxes = [
            (bx, by, bx + width, by + height)
            for reach in (10, 26, 46, 70)
            for bx, by in (
                (x + reach, y - height // 2),
                (x - reach - width, y - height // 2),
                (x - width // 2, y - reach - height),
                (x - width // 2, y + reach),
                (x + reach, y - reach - height),
                (x - reach - width, y - reach - height),
                (x + reach, y + reach),
                (x - reach - width, y + reach),
            )
        ]
        # Over open background where there is any near, so the name hides no part.
        box = next((box for box in boxes if free(box) and covering(box).get(-1, 0) >= 0.85), None)
        box = box or next((box for box in boxes if free(box)), None)
        if box:
            write(index, text, offset, box, anchor=(x, y))
            written += 1


def sheet(parts, path, more=()):
    """
    Draws the four views of the parts into one PNG at `path`, with `more`
    panels, such as sections, below them two to a row, and returns the parts
    left out of the views, each with why.
    """
    mesh = Mesh(parts)
    left_out = {name for name, _ in mesh.undrawn}
    size = PANEL * SUPER
    # The three square-on views share one scale, so their sizes compare.
    flat = [extent(mesh, right, up, towards) for _, right, up, towards, measured in VIEWS if measured]
    shared = size * 0.82 / max(side for _, side in flat)
    pictures = []
    for view in VIEWS:
        middle, side = extent(mesh, view[1], view[2], view[3])
        scale = shared if view[4] else size * 0.82 / side
        canvas = Canvas(size)
        canvas.fill(mesh, view, middle, scale)
        canvas.lines(mesh, view, middle, scale)
        picture = canvas.picture()
        annotate(picture, view, scale)
        name_parts(picture, canvas.owners(), [name for name, _ in parts])
        pictures.append(picture)
    pictures += list(more)
    rows = (len(pictures) + 1) // 2
    whole = Image.new("RGB", (PANEL * 2, PANEL * rows + HEADER), tuple(int(v) for v in BACKGROUND))
    for index, picture in enumerate(pictures):
        whole.paste(picture, ((index % 2) * PANEL, HEADER + (index // 2) * PANEL))
    draw = ImageDraw.Draw(whole)
    draw.line((PANEL, HEADER, PANEL, HEADER + PANEL * rows), fill=(214, 218, 224), width=1)
    for row in range(1, rows):
        draw.line((0, HEADER + PANEL * row, PANEL * 2, HEADER + PANEL * row), fill=(214, 218, 224), width=1)
    draw.line((0, HEADER - 1, PANEL * 2, HEADER - 1), fill=(214, 218, 224), width=1)
    x = 14
    drawn = [(index, name) for index, (name, _) in enumerate(parts) if name not in left_out]
    for place, (index, name) in enumerate(drawn):
        width = 20 + draw.textlength(name, font=font(15))
        rest = f"and {len(drawn) - place} more, named in the views"
        # Room is kept for saying how many more there are, unless this is the last.
        room = PANEL * 2 - 120 - (0 if place == len(drawn) - 1 else draw.textlength(rest, font=font(15)) + 22)
        if x + width > room:
            draw.text((x, 13), rest, fill=TEXT, font=font(15))
            break
        ink = PALETTE[index % len(PALETTE)]
        draw.rectangle((x, 15, x + 14, 29), fill=ink)
        draw.text((x + 20, 13), name, fill=TEXT, font=font(15))
        x += width + 22
    note = "Sizes in mm"
    draw.text((PANEL * 2 - 14 - draw.textlength(note, font=font(13)), 15), note, fill=TEXT, font=font(13))
    whole.save(path, "PNG", optimize=True)
    return mesh.undrawn
