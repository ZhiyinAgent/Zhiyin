"""
How far apart two colours look, as the 3D studio's checks weigh a render's colour against the one
asked for: CIEDE2000, held to pairs from Sharma, Wu and Dalal's published test data for it.
"""

import pytest
from zhiyin_studio.colour_difference import OTHER, delta_e, lab_difference, to_lab


@pytest.mark.parametrize(
    ("first", "second", "expected"),
    [
        ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
        ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
        ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
        ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
    ],
)
def test_the_difference_of_two_lab_colours_is_ciede2000s(first, second, expected):
    assert lab_difference(first, second) == pytest.approx(expected, abs=1e-4)
    assert lab_difference(second, first) == pytest.approx(expected, abs=1e-4)


def test_srgb_colours_are_read_in_lab_under_d65():
    # White to a fiftieth: the conversion's matrix is written to four figures.
    assert to_lab((255, 255, 255)) == pytest.approx((100.0, 0.0, 0.0), abs=0.02)
    assert to_lab((0, 0, 0)) == pytest.approx((0.0, 0.0, 0.0), abs=1e-9)
    # sRGB's red, as the CIE's tables give it.
    assert to_lab((255, 0, 0)) == pytest.approx((53.24, 80.09, 67.20), abs=0.05)


def test_a_colour_against_itself_is_no_difference_and_black_against_white_is_another_colour():
    assert delta_e((120, 80, 40), (120, 80, 40)) == 0
    assert delta_e((0, 0, 0), (255, 255, 255)) > OTHER
