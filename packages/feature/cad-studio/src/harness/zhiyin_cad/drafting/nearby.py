"""
Which of many straight segments lie near a given one, found through a grid
rather than by trying them all: a view of a bladed row has tens of thousands
of edges, and trying every pair of them takes minutes.
"""

import math


class Segments:
    """
    Segments kept by number, each listed in the grid's cells that come within
    `reach` of it, so a segment within `reach` of another is always found
    from the cells that one passes through.
    """

    def __init__(self, segments, reach):
        points = [p for segment in segments for p in segment]
        if points:
            extent = max(
                max(p[0] for p in points) - min(p[0] for p in points),
                max(p[1] for p in points) - min(p[1] for p in points),
            )
        else:
            extent = 1.0
        self.size = max(extent / 512, 4 * reach, 1e-9)
        # Each point of a segment lies within a quarter cell of a point sampled on it.
        self.pad = reach + self.size / 4
        self.cells = {}
        self.kept = {}

    def _cells(self, a, b):
        size, pad = self.size, self.pad
        found = set()
        steps = max(1, math.ceil(math.dist(a, b) / (size / 2)))
        for k in range(steps + 1):
            t = k / steps
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            for i in range(math.floor((x - pad) / size), math.floor((x + pad) / size) + 1):
                for j in range(math.floor((y - pad) / size), math.floor((y + pad) / size) + 1):
                    found.add((i, j))
        return found

    def add(self, number, a, b):
        cells = self._cells(a, b)
        self.kept[number] = (a, b, cells)
        for cell in cells:
            self.cells.setdefault(cell, set()).add(number)

    def remove(self, number):
        _, _, cells = self.kept.pop(number)
        for cell in cells:
            self.cells[cell].discard(number)

    def near(self, a, b):
        """The numbers of the segments that may come within `reach` of ab, lowest first."""
        return sorted({n for cell in self._cells(a, b) for n in self.cells.get(cell, ())})

    def segment(self, number):
        a, b, _ = self.kept[number]
        return a, b


class Places:
    """Things kept by a point of their own, found again from any point within `reach` of it, in the order they were kept."""

    def __init__(self, reach):
        self.size = max(reach, 1e-12)
        self.cells = {}
        self.count = 0

    def _cell(self, point):
        return math.floor(point[0] / self.size), math.floor(point[1] / self.size)

    def add(self, point, thing):
        self.cells.setdefault(self._cell(point), []).append((self.count, thing))
        self.count += 1

    def near(self, point):
        i, j = self._cell(point)
        found = [kept for di in (-1, 0, 1) for dj in (-1, 0, 1) for kept in self.cells.get((i + di, j + dj), ())]
        return [thing for _, thing in sorted(found, key=lambda kept: kept[0])]
