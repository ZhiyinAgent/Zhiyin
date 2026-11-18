"""
Hollows of a part that a ball of a size cannot leave: space inside the
part's outline wide enough to hold the ball, joined to the outside only
through openings narrower than it, as resin or powder stays in a hollow
print whose drain holes are too small. Found on a grid of cells: the part
filled from rays straight up through each column, the space around it
measured for how far each empty cell is from the part, and the cells a
ball's centre fits in followed out from the edge of the grid. Closed voids,
which no opening reaches, are the exact check's, so the grid is of the
part's outer skin alone. The grid's pitch is said with what it finds: an
opening is read to within it.
"""

import numpy

# At most how many cells the grid holds, and at least how many across the opening asked.
MOST_CELLS = 8_000_000
ACROSS = 6


def _outer(shape):
    """The part's solids as their outer skins alone, closed voids filled."""
    import build123d as bd
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
    from OCP.BRepClass3d import BRepClass3d
    from OCP.TopoDS import TopoDS

    solids = []
    for solid in shape.solids():
        outer = BRepClass3d.OuterShell_s(TopoDS.Solid(solid.wrapped))
        solids.append(bd.Solid(BRepBuilderAPI_MakeSolid(outer).Solid()))
    return bd.Compound(solids)


def _filled(shape, low, counts, pitch):
    """Which cells of the grid lie inside the part, from a ray up each column."""
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
    from OCP.TopAbs import TopAbs_IN

    rays = IntCurvesFace_ShapeIntersector()
    rays.Load(shape.wrapped, 1e-7)
    classifier = BRepClass3d_SolidClassifier(shape.wrapped)
    nx, ny, nz = counts
    inside = numpy.zeros(counts, dtype=bool)
    heights = low[2] + (numpy.arange(nz) + 0.5) * pitch
    start = low[2] - pitch
    # Off the cells' centres by a little, so a ray seldom runs along an edge or a face.
    off = pitch * 0.0137
    for i in range(nx):
        x = low[0] + (i + 0.5) * pitch + off
        for j in range(ny):
            y = low[1] + (j + 0.5) * pitch + off * 0.71
            rays.Perform(gp_Lin(gp_Pnt(x, y, start), gp_Dir(0, 0, 1)), 0.0, 1e9)
            if not rays.IsDone() or rays.NbPnt() == 0:
                continue
            hits = sorted(start + rays.WParameter(k) for k in range(1, rays.NbPnt() + 1))
            spans = []
            if len(hits) % 2 == 0:
                spans = list(zip(hits[0::2], hits[1::2]))
            else:
                # A ray grazing an edge meets it once: each stretch between hits is classified at its middle.
                for a, b in zip(hits, hits[1:]):
                    classifier.Perform(gp_Pnt(x, y, (a + b) / 2), 1e-7)
                    if classifier.State() == TopAbs_IN:
                        spans.append((a, b))
            for a, b in spans:
                inside[i, j] |= (heights >= a) & (heights <= b)
    return inside


def trapped(shape, opening):
    """
    The hollows a ball of Ø`opening` fits in and cannot leave by: each one's
    volume, its box, and the grid's pitch they were found on.
    """
    from scipy import ndimage

    box = shape.bounding_box()
    size = numpy.array([box.size.X, box.size.Y, box.size.Z])
    pitch = opening / ACROSS
    pad = opening + 2 * pitch
    while numpy.prod(numpy.ceil((size + 2 * pad) / pitch)) > MOST_CELLS:
        pitch *= 1.25
        pad = opening + 2 * pitch
    low = numpy.array([box.min.X, box.min.Y, box.min.Z]) - pad
    counts = tuple(int(c) for c in numpy.ceil((size + 2 * pad) / pitch))
    empty = ~_filled(_outer(shape), low, counts, pitch)
    # How far each empty cell's centre lies from the part, in mm.
    reach = ndimage.distance_transform_edt(empty) * pitch
    centres = empty & (reach >= opening / 2)
    labels, _ = ndimage.label(centres, structure=numpy.ones((3, 3, 3)))
    border = numpy.unique(numpy.concatenate([labels[0].ravel(), labels[-1].ravel(), labels[:, 0].ravel(), labels[:, -1].ravel(), labels[:, :, 0].ravel(), labels[:, :, -1].ravel()]))
    outside = numpy.isin(labels, border[border > 0])
    held = centres & ~outside
    if not held.any():
        return {"hollows": [], "pitch": pitch}
    # The space a ball from outside sweeps, and what is left of the empty space beyond it.
    swept = ndimage.distance_transform_edt(~outside) * pitch <= opening / 2
    left, _ = ndimage.label(empty & ~swept)
    found = []
    for label in numpy.unique(left[held]):
        if label == 0:
            continue
        cells = numpy.argwhere(left == label)
        lowest, highest = cells.min(axis=0), cells.max(axis=0) + 1
        found.append(
            {
                "volume": float(len(cells) * pitch**3),
                "min": tuple(low + lowest * pitch),
                "max": tuple(low + highest * pitch),
            }
        )
    return {"hollows": sorted(found, key=lambda one: -one["volume"]), "pitch": pitch}
