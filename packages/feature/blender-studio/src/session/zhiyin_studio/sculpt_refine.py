"""
Detail where a stroke needs it, as dynamic topology gives it: the edges under a stroke longer
than the detail asked are split, and split again, until none is; and after the stroke, the edges
it stretched past that length are split the same way, each new point placed where the stroke
puts the place it stands for. Faces a split leaves with more than four sides become triangles.
"""

import bmesh
import numpy

from .sculpt_strokes import Reach

# The most rounds of splitting, and the most points a mesh may grow to by them.
ROUNDS = 12
MOST_POINTS = 2_000_000


def split(shape, edges):
    """Splits each edge in two at its middle; faces left with more than four sides become triangles."""
    bm = shape.bm
    before = len(bm.verts)
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True)
    shape.refresh()
    made = set(range(before, len(bm.verts)))
    crowded = {f for i in made for f in bm.verts[i].link_faces if len(f.verts) > 4}
    if crowded:
        bmesh.ops.triangulate(bm, faces=list(crowded))
        shape.refresh()
    return len(bm.verts) - before


def edge_lengths(shape, positions):
    pairs = shape.pairs()
    return pairs, numpy.linalg.norm(positions[pairs[:, 0]] - positions[pairs[:, 1]], axis=1)


def refine(shape, copies, radius, detail):
    """Splits the edges under the stroke longer than `detail` until none is; how many were split, and whether it stopped short."""
    count = 0
    for _ in range(ROUNDS):
        positions = shape.positions()
        pairs, lengths = edge_lengths(shape, positions)
        middles = (positions[pairs[:, 0]] + positions[pairs[:, 1]]) / 2
        near = Reach(middles, copies).distance < radius + lengths / 2
        long = numpy.nonzero(near & (lengths > detail))[0]
        if not len(long):
            return count, False
        if len(shape.bm.verts) + len(long) > MOST_POINTS:
            return count, True
        count += len(long)
        split(shape, [shape.bm.edges[int(i)] for i in long])
    return count, True


def stretched(shape, detail, place):
    """
    Splits the edges a stroke moved and stretched past `detail`, and places each new point by
    `place(indices)`, until none is longer; how many were split, and whether it stopped short.
    """
    count = 0
    for _ in range(ROUNDS):
        positions = shape.positions()
        moved = numpy.linalg.norm(positions - shape.befores(), axis=1) > 0
        pairs, lengths = edge_lengths(shape, positions)
        long = numpy.nonzero((moved[pairs[:, 0]] | moved[pairs[:, 1]]) & (lengths > detail))[0]
        if not len(long):
            return count, False
        if len(shape.bm.verts) + len(long) > MOST_POINTS:
            return count, True
        first = len(shape.bm.verts)
        count += len(long)
        split(shape, [shape.bm.edges[int(i)] for i in long])
        place(numpy.arange(first, len(shape.bm.verts)))
    return count, True
