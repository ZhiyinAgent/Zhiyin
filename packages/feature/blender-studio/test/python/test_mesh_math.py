"""
The geometry every measure of the 3D studio asks the same way, on plain arrays: the pieces a mesh's
triangles join into, whether they close a shape, how far a point is from a segment, and points
spread evenly over triangles by area.
"""

import numpy
import pytest
from zhiyin_studio.mesh_math import closed, evenly, joined_points, pieces, point_labels, spread, to_segment

# A unit cube's corners and its twelve triangles, every one facing out.
CUBE_CORNERS = numpy.array(
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], dtype=float
)
CUBE_TRIANGLES = numpy.array(
    [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ]
)


def two_cubes(apart):
    """Two unit cubes `apart` along x, as one mesh's corners and triangles."""
    corners = numpy.concatenate([CUBE_CORNERS, CUBE_CORNERS + [apart, 0, 0]])
    return corners, numpy.concatenate([CUBE_TRIANGLES, CUBE_TRIANGLES + 8])


def test_points_joined_through_pairs_share_the_least_index_among_them():
    assert point_labels(6, [(4, 2), (2, 5), (1, 3)]).tolist() == [0, 1, 2, 1, 2, 2]
    assert point_labels(3, []).tolist() == [0, 1, 2]
    assert joined_points(6, [(4, 2), (2, 5), (1, 3)]) == [[0], [1, 3], [2, 4, 5]]


def test_a_chain_joined_one_pair_at_a_time_is_one_group():
    pairs = [(i, i + 1) for i in range(98, -1, -1)]
    assert joined_points(100, pairs) == [list(range(100))]


def test_a_mesh_parts_into_the_pieces_its_triangles_join_into():
    corners, triangles = two_cubes(3.0)
    found = pieces(corners, triangles)
    assert len(found) == 2
    for own_corners, own_triangles in found:
        assert len(own_corners) == 8 and len(own_triangles) == 12
        assert closed(own_triangles)
    lows = sorted(own_corners.min(axis=0)[0] for own_corners, _ in found)
    assert lows == [0.0, 3.0]


def test_pieces_that_share_a_corner_are_one():
    corners, triangles = two_cubes(1.0)
    # The second cube's corners at x = 1 are the first's own.
    shared = {8: 1, 11: 2, 12: 5, 15: 6}
    renumbered = numpy.vectorize(lambda i: shared.get(i, i))(triangles)
    assert len(pieces(corners, renumbered)) == 1
    assert pieces(corners, numpy.zeros((0, 3), dtype=numpy.int64)) == []


def test_triangles_close_a_shape_only_when_every_edge_has_two():
    assert closed(CUBE_TRIANGLES)
    assert not closed(CUBE_TRIANGLES[1:])
    assert not closed(numpy.zeros((0, 3), dtype=numpy.int64))
    # A third triangle on an edge leaves it with three.
    assert not closed(numpy.concatenate([CUBE_TRIANGLES, [[0, 1, 6]]]))


@pytest.mark.parametrize(
    ("point", "expected"),
    [
        ((0.5, 1.0, 0.0), 1.0),  # beside the segment's middle
        ((-3.0, 4.0, 0.0), 5.0),  # past its start: from the start
        ((4.0, 0.0, 2.0), (9 + 4) ** 0.5),  # past its end: from the end
        ((0.25, 0.0, 0.0), 0.0),  # on it
    ],
)
def test_a_points_distance_from_a_segment_is_from_its_nearest_point(point, expected):
    a, b = numpy.array([0.0, 0.0, 0.0]), numpy.array([1.0, 0.0, 0.0])
    assert to_segment(numpy.array(point), a, b) == pytest.approx(expected)


def test_a_segment_of_one_point_is_measured_from_that_point():
    a = numpy.array([1.0, 1.0, 1.0])
    assert to_segment(numpy.array([1.0, 1.0, 3.0]), a, a.copy()) == pytest.approx(2.0)


def test_evenly_takes_every_nth_item_and_all_of_a_few():
    assert evenly(list(range(10)), 3) == [0, 3, 6, 9]
    assert evenly(list(range(4)), 10) == [0, 1, 2, 3]
    assert len(evenly(numpy.zeros((10000, 3)), 4000)) == 5000


def test_points_are_spread_over_triangles_by_their_area():
    # One triangle with nine times the area of the other.
    small = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    large = [[10, 0, 0], [13, 0, 0], [10, 3, 0]]
    points = spread(numpy.array([small, large], dtype=float), 1000)
    assert points.shape == (1000, 3)
    on_large = int((points[:, 0] >= 10).sum())
    assert on_large == pytest.approx(900, abs=2)
    # Every point lies on the triangle it was spread over.
    on_small = points[points[:, 0] < 10]
    assert (on_small >= -1e-12).all() and (on_small[:, 0] + on_small[:, 1] <= 1 + 1e-12).all()
    moved = points[points[:, 0] >= 10] - [10, 0, 0]
    assert (moved >= -1e-12).all() and (moved[:, 0] + moved[:, 1] <= 3 + 1e-12).all()


def test_spread_points_cover_a_triangle_evenly_and_the_same_each_time():
    triangle = numpy.array([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]], dtype=float)
    points = spread(triangle, 2000)
    assert numpy.array_equal(points, spread(triangle, 2000))
    # Each of the four triangles halving the sides cuts holds a quarter of them.
    x, y = points[:, 0], points[:, 1]
    quarters = [(x < 0.5) & (y < 0.5) & (x + y >= 0.5), x >= 0.5, y >= 0.5, x + y < 0.5]
    for quarter in quarters:
        assert int(quarter.sum()) == pytest.approx(500, abs=25)


def test_nothing_is_spread_over_no_area():
    assert spread(numpy.zeros((0, 3, 3)), 10).shape == (0, 3)
    flat = numpy.array([[[0, 0, 0], [1, 0, 0], [2, 0, 0]]], dtype=float)
    assert spread(flat, 10).shape == (0, 3)
