"""
Where an object's origin goes: [x, y, z], or [x, y] for an object set down by rest_on or
rest_across, whose height the setting down decides.
"""

import pytest
from zhiyin_studio.arguments import location_of
from zhiyin_studio.errors import Refused


def test_three_numbers_place_the_origin_as_given():
    assert location_of({"location": [1, 2, 3]}, height=0.5) == (1.0, 2.0, 3.0)
    assert location_of({"location": [1, 2, 3], "rest_on": "floor"}, height=0.5) == (1.0, 2.0, 3.0)


def test_two_numbers_place_an_object_set_down_across_at_the_height_it_has_until_it_is_set_down():
    assert location_of({"location": [-0.32, -0.2], "rest_on": "Desk_top"}, height=0.75) == (-0.32, -0.2, 0.75)
    assert location_of({"location": [0, 1], "rest_across": ["A", "B"]}, height=0) == (0.0, 1.0, 0.0)


def test_no_location_is_the_default_when_there_is_one():
    assert location_of({}, height=2, default=(0, 0, 0)) == (0.0, 0.0, 0.0)


@pytest.mark.parametrize(
    ("spec", "said"),
    [
        ({"location": [1, 2]}, "location is [x, y, z]; [x, y] is for an object set down by rest_on or rest_across, which sets its height."),
        ({"location": [1, "2"], "rest_on": "floor"}, "location must be a list of 2 or 3 numbers."),
        ({"location": [1, 2, 3, 4]}, "location must be a list of 3 numbers."),
        ({}, "location is required."),
    ],
)
def test_other_locations_are_refused_in_words(spec, said):
    with pytest.raises(Refused) as refused:
        location_of(spec, height=0)
    assert str(refused.value) == said
