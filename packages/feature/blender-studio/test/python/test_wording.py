"""
The words the 3D studio's answers give names, lengths, areas, volumes, places and colours, so every
tool says the same thing the same way.
"""

import pytest
from zhiyin_studio.wording import (
    area_text,
    enumerated,
    hex_of,
    in_brief,
    length,
    listed,
    one_of,
    point_text,
    size_text,
    stems_text,
    volume_text,
)


def test_names_are_joined_by_and_or_or_as_the_sentence_needs():
    assert listed(["Box"]) == "Box"
    assert listed(["Box", "Ball"]) == "Box and Ball"
    assert listed(["Box", "Ball", "Cone"]) == "Box, Ball and Cone"
    assert listed(["a", "b", "c", "d", "e"], most=2) == "a, b and 3 more"
    assert one_of(["hull", "mesh", "box"]) == "hull, mesh or box"
    assert one_of(["hull"]) == "hull"
    assert enumerated(["a", "b", "c", "d"], 2) == "a, b and 2 more"
    assert enumerated(["a", "b"], 2) == "a, b"


def test_many_names_are_told_by_the_name_they_share():
    rocks = [f"Rock.{i:03d}" for i in range(1, 8)]
    assert stems_text([*rocks, "Log"]) == "Rock ×7, Log"
    assert in_brief(["Box", "Ball"]) == "Box and Ball"
    assert in_brief([*rocks, "Log"]) == "Rock ×7, Log"


@pytest.mark.parametrize(
    ("metres", "said"),
    [
        (0.25, "250 mm"),
        (0.99999994, "1 m"),
        (1.5, "1.5 m"),
        (0.0000004, "0 mm"),
        (-0.002, "-2 mm"),
        (12.3456, "12.35 m"),
    ],
)
def test_a_length_reads_in_millimetres_below_a_metre_to_four_figures(metres, said):
    assert length(metres) == said


def test_areas_and_volumes_take_the_unit_that_keeps_them_plain():
    assert area_text(0.00005) == "50 mm²"
    assert area_text(0.12) == "1200 cm²"
    assert area_text(8.16) == "8.16 m²"
    assert volume_text(0.0005) == "500 cm³"
    assert volume_text(0.25) == "250 L"
    assert volume_text(2) == "2 m³"


def test_sizes_and_places_share_one_unit_by_their_largest():
    assert size_text([0.2, 0.3, 0.05]) == "200 × 300 × 50 mm"
    assert size_text([2, 0.3, 0.05]) == "2 × 0.3 × 0.05 m"
    assert point_text([0.1, -0.2, 0.0000001]) == "(100, -200, 0 mm)"
    assert point_text([1.5, 0, 0]) == "(1.5, 0, 0 m)"


def test_a_colour_is_said_as_the_hex_a_screen_shows_it_by():
    assert hex_of((1.0, 1.0, 1.0, 1.0)) == "#ffffff"
    assert hex_of((0.0, 0.0, 0.0)) == "#000000"
    # Half the light of white is shown brighter than the middle of the screen's scale.
    assert hex_of((0.5, 0.5, 0.5)) == "#bcbcbc"
    assert hex_of((2.0, -1.0, 0.0)) == "#ff0000"
