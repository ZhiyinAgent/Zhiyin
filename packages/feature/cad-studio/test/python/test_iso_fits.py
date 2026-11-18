"""iso_fit's limits, against the values ISO 286-2's tables print."""

import pytest
from zhiyin_cad import notes
from zhiyin_cad.fits import FitRefused, deviations, iso_fit


@pytest.mark.parametrize(
    ("tolerance", "size", "lower", "upper"),
    [
        ("H7", 25, 0, 21),
        ("F8", 25, 20, 53),
        ("K7", 25, -15, 6),
        ("N7", 40, -33, -8),
        ("R7", 60, -60, -30),
        ("g6", 25, -20, -7),
        ("k6", 25, 2, 15),
        ("p6", 25, 22, 35),
        ("s6", 60, 53, 72),
        ("js6", 25, -6.5, 6.5),
        # A size on a range's upper end belongs to that range.
        ("H7", 3, 0, 10),
        # ISO 286-1's one exception to its rule for holes.
        ("M6", 300, -41, -9),
    ],
)
def test_a_class_is_made_between_the_tabled_deviations(tolerance, size, lower, upper):
    found_lower, found_upper, _hole = deviations(tolerance, size)
    assert (found_lower, found_upper) == (lower, upper)


@pytest.mark.parametrize(
    ("fit", "least", "most", "kind"),
    [
        ("H7/g6", 0.007, 0.041, "clearance"),
        ("H7/k6", -0.015, 0.019, "transition"),
        ("H7/p6", -0.035, -0.001, "interference"),
    ],
)
def test_a_fit_gives_its_clearance_and_kind(fit, least, most, kind):
    result = iso_fit(fit, 25)
    assert result.clearance == pytest.approx((least, most))
    assert result.kind == kind


def test_a_fit_gives_each_part_s_sizes_in_millimetres():
    result = iso_fit("H7/g6", 25)
    assert (result.hole.least, result.hole.greatest) == pytest.approx((25.0, 25.021))
    assert (result.shaft.least, result.shaft.greatest) == pytest.approx((24.98, 24.993))


def test_the_answer_says_the_limits_and_the_kind():
    iso_fit("H7/g6", 25)
    assert notes.said == [
        "iso_fit H7/g6 at Ø25: hole H7 25.000 to 25.021 mm (0 / +21 µm); "
        "shaft g6 24.980 to 24.993 mm (-20 / -7 µm); "
        "clearance +0.007 to +0.041 mm, below zero an interference: a clearance fit."
    ]


@pytest.mark.parametrize(
    ("fit", "size", "why"),
    [
        ("H7", 600, "up to 500 mm"),
        ("X7", 25, "is not a class given here"),
        ("H7/H8", 25, "two holes"),
        ("H12", 25, "IT12 is not given here"),
        ("K9", 25, "up to grade 8"),
        ("7H", 25, "is not a tolerance class"),
    ],
)
def test_what_iso_286_does_not_give_here_is_refused_with_why(fit, size, why):
    with pytest.raises(FitRefused, match=why):
        iso_fit(fit, size)
