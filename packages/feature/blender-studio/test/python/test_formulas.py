"""
The formulas a part follows another by: what they accept and work out, what they refuse before
anything is worked out, and how they are written in Blender's units, where angles are radians.
"""

import math

import pytest
from zhiyin_studio.errors import Refused
from zhiyin_studio.formulas import SIMPLE, in_tool_units, worked_out


@pytest.mark.parametrize(
    ("formula", "at", "expected"),
    [
        ("2*v + 10", 3.0, 16.0),
        ("-v", 4.0, -4.0),
        ("+v / 4", 2.0, 0.5),
        ("(v - 1) * (v + 1)", 3.0, 8.0),
        ("pi", 0.0, math.pi),
        ("sin(radians(v))", 90.0, 1.0),
        ("degrees(atan2(1, 1))", 0.0, 45.0),
        ("pow(v, 3)", 2.0, 8.0),
        ("sqrt(v) + abs(-2) + floor(2.7) + fmod(7, 3)", 9.0, 8.0),
        ("min(v, 1, 2) + max(v, 5)", 0.5, 5.5),
        ("100 * cos(radians(v)) + sqrt(4)", 60.0, 52.0),
    ],
)
def test_works_out_arithmetic_at_the_value_followed(formula, at, expected):
    assert worked_out(formula)(at) == pytest.approx(expected)


@pytest.mark.parametrize(
    "formula",
    [
        "v ** 2",
        "v // 2",
        "v % 2",
        "v > 1",
        "v if v else 1",
        "x + 1",
        "e",
        "True + v",
        "'1' + v",
        "v.real",
        "round(v)",
        "max(v, key=abs)",
        "max(*[v])",
        "[v][0]",
        "(lambda: 1)()",
        "__import__('os').system('echo')",
        "v = 1",
        "2*v +",
        "",
    ],
)
def test_refuses_anything_but_numbers_v_pi_and_the_arithmetic_it_names(formula):
    with pytest.raises(Refused) as refused:
        worked_out(formula)
    assert str(refused.value) == SIMPLE


def test_a_value_out_of_a_functions_reach_is_the_error_arithmetic_gives():
    work = worked_out("sqrt(v)")
    with pytest.raises(ValueError):
        work(-1.0)
    with pytest.raises(ZeroDivisionError):
        worked_out("1 / v")(0.0)


def blender_works_out(expression, **values):
    """An expression as Blender's simple drivers work it out: its names, radians and degrees."""
    return eval(expression, {"__builtins__": {}, "radians": math.radians, "degrees": math.degrees}, values)


def test_writes_a_formula_in_blenders_units_where_turns_are_radians():
    # A length following a length is written as it is.
    assert blender_works_out(in_tool_units("2*v + 10", set(), False, SIMPLE), v=3) == pytest.approx(16)
    # A length following a turn reads Blender's radians as the formula's degrees.
    assert blender_works_out(in_tool_units("2*v + 10", {"v"}, False, SIMPLE), v=math.pi) == pytest.approx(370)
    # A turn set by a formula in degrees is set in radians.
    assert blender_works_out(in_tool_units("v * 90", set(), True, SIMPLE), v=1) == pytest.approx(math.pi / 2)
    # Only the names given are turns.
    assert blender_works_out(in_tool_units("a + b", {"a"}, True, SIMPLE), a=math.pi, b=180) == pytest.approx(2 * math.pi)


def test_refuses_what_is_not_an_expression_at_all_with_the_words_given():
    with pytest.raises(Refused) as refused:
        in_tool_units("(v + 1", set(), False, "Write it plainly.")
    assert str(refused.value) == "Write it plainly."
