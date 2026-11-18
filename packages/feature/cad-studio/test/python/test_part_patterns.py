"""Part names written as patterns between slashes."""

import pytest
from zhiyin_cad import patterns

PARTS = ["Pin_1", "Pin_2", "Base", "Lid", "Pin_cap"]


def test_a_pattern_stands_for_every_part_whose_whole_name_it_matches():
    assert patterns.expanded([r"/Pin_\d/", "Base"], PARTS, "the export") == ["Pin_1", "Pin_2", "Base"]


def test_a_pattern_matches_whole_names_only():
    assert patterns.expanded(["/Pin/"], ["Pin", "Pin_1"], "the export") == ["Pin"]


def test_each_part_is_named_once():
    assert patterns.expanded(["Pin_1", "/Pin_.*/"], PARTS, "the export") == ["Pin_1", "Pin_2", "Pin_cap"]


def test_the_answer_says_what_each_pattern_named():
    patterns.expanded([r"/Pin_\d/"], PARTS, "the export")
    assert patterns.said == [r"/Pin_\d/ named 2 parts: Pin_1, Pin_2."]


def test_a_pattern_that_matches_nothing_is_refused_naming_the_parts():
    with pytest.raises(ValueError, match="matches no part's whole name; the parts are Pin_1, Pin_2, Base"):
        patterns.expanded(["/Bolt.*/"], PARTS, "the export")


def test_a_pattern_that_is_not_one_is_refused():
    with pytest.raises(ValueError, match="which is not a pattern"):
        patterns.expanded(["/Pin_(/"], PARTS, "the export")
