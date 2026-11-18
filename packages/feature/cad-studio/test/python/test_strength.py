"""
The strength helpers' figures, against the textbook formulas each names,
worked out here independently, and against tabled values where a standard
prints them.
"""

import math

import pytest
from zhiyin_cad import notes
from zhiyin_cad.strength import StrengthRefused, strength

STEEL_YIELD = 235.0
STEEL_E = 210_000.0


def test_a_solid_shaft_in_torsion_is_held_to_von_mises_against_the_yield():
    d, torque = 20.0, 50.0
    tau = 16 * torque * 1000 / (math.pi * d**3)
    result = strength.shaft(d, torque=torque)
    assert result.torsion == pytest.approx(tau)
    assert result.bending == 0
    assert result.von_mises == pytest.approx(math.sqrt(3) * tau)
    assert result.safety == pytest.approx(STEEL_YIELD / (math.sqrt(3) * tau))
    assert result.holds


def test_a_tube_carries_less_than_a_solid_shaft_of_its_diameter():
    d, bore, torque = 20.0, 10.0, 50.0
    result = strength.shaft(d, torque=torque, bore=bore)
    assert result.torsion == pytest.approx(16 * torque * 1000 * d / (math.pi * (d**4 - bore**4)))


def test_a_shaft_loaded_between_its_bearings_bends_and_deflects():
    d, length, load = 20.0, 200.0, 1000.0
    i = math.pi * d**4 / 64
    result = strength.shaft(d, length=length, load=load)
    moment = load * length / 4
    assert result.bending == pytest.approx(moment * (d / 2) / i)
    assert result.deflection == pytest.approx(load * length**3 / (48 * STEEL_E * i))


@pytest.mark.parametrize(
    ("supports", "spread", "moment_share", "deflection_share"),
    [
        ("simple", False, 1 / 4, 1 / 48),
        ("simple", True, 1 / 8, 5 / 384),
        ("cantilever", False, 1, 1 / 3),
        ("cantilever", True, 1 / 2, 1 / 8),
        ("fixed", False, 1 / 8, 1 / 192),
        ("fixed", True, 1 / 12, 1 / 384),
    ],
)
def test_a_beam_s_moment_and_deflection_follow_its_supports(supports, spread, moment_share, deflection_share):
    width, height, length, load = 10.0, 20.0, 500.0, 1000.0
    i = width * height**3 / 12
    result = strength.beam(length, load, width=width, height=height, supports=supports, spread=spread)
    assert result.moment == pytest.approx(moment_share * load * length / 1000)
    assert result.stress == pytest.approx(moment_share * load * length * (height / 2) / i)
    assert result.deflection == pytest.approx(deflection_share * load * length**3 / (STEEL_E * i))


def test_a_beam_short_of_its_safety_factor_fails_and_says_so():
    result = strength.beam(500.0, 1000.0, width=10.0, height=20.0)
    assert result.safety == pytest.approx(235 / 187.5)
    assert not result.holds
    assert "fails" in notes.said[-1]


def test_an_m12_grade_8_8_bolt_resists_what_eurocode_3_tables():
    result = strength.bolt("M12", "8.8")
    # ISO 898-1's stress area of M12, and EN 1993-1-8's resistances for it.
    assert result.stress_area == pytest.approx(84.3, abs=0.05)
    assert result.shear_resistance == pytest.approx(32_400, abs=100)
    assert result.tension_resistance == pytest.approx(48_600, abs=100)


def test_a_bolt_s_shear_is_held_to_slip_only_in_a_slip_resistant_joint():
    # The preload of an M12 8.8 holds 0.3 * 0.7 * 800 * 84.3 / 1.25 N, about 11.3 kN, against slip.
    bearing = strength.bolt("M12", "8.8", shear=12_000)
    slip = strength.bolt("M12", "8.8", shear=12_000, joint="slip")
    assert bearing.holds
    assert not slip.holds
    assert "against slip" not in notes.said[0]
    assert "shear against slip of the preloaded joint 12000 N" in notes.said[1]


@pytest.mark.parametrize(("kind", "power"), [("ball", 3), ("roller", 10 / 3)])
def test_a_bearing_s_rating_life_is_iso_281_s(kind, power):
    result = strength.bearing(10_000, 1_000, 1_000, kind=kind)
    assert result.turns == pytest.approx(10**power)
    assert result.hours == pytest.approx(10**power * 1e6 / (60 * 1_000))


def test_a_gear_tooth_s_stress_is_lewis_s_with_the_tabled_form_factor():
    result = strength.gear(module=2, teeth=20, width=20, torque=20)
    assert result.form_factor == pytest.approx(0.322)
    assert result.force == pytest.approx(2000 * 20 / 40)
    assert result.stress == pytest.approx(1000 / (20 * 2 * 0.322))


def test_a_gear_between_the_table_s_rows_takes_the_form_factor_between_them():
    assert strength.gear(module=2, teeth=23, width=20, torque=20).form_factor == pytest.approx(0.334)


def test_a_slender_column_buckles_at_euler_s_load():
    d, length = 20.0, 1000.0
    i = math.pi * d**4 / 64
    result = strength.column(length, 1000.0, diameter=d)
    assert result.method == "Euler"
    assert result.critical == pytest.approx(math.pi**2 * STEEL_E * i / length**2)


def test_a_short_column_takes_johnson_s_parabola():
    d, length = 20.0, 200.0
    area = math.pi * d**2 / 4
    radius = d / 4
    result = strength.column(length, 1000.0, diameter=d)
    assert result.method == "Johnson"
    expected = area * (STEEL_YIELD - (STEEL_YIELD * length / (2 * math.pi * radius)) ** 2 / STEEL_E)
    assert result.critical == pytest.approx(expected)


def test_a_material_with_no_figures_is_refused_until_they_are_given():
    with pytest.raises(StrengthRefused, match="yield_strength= and modulus="):
        strength.shaft(20.0, torque=10.0, material="oak")
    result = strength.shaft(20.0, torque=10.0, material="oak", yield_strength=40.0, modulus=11_000.0)
    assert result.safety == pytest.approx(40.0 / result.von_mises)


def test_a_figure_given_replaces_the_tabled_one():
    result = strength.shaft(20.0, torque=10.0, yield_strength=355.0)
    assert result.safety == pytest.approx(355.0 / result.von_mises)
