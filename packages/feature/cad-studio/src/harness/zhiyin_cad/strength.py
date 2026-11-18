"""
Hand calculations of strength a script runs on the numbers of its design:
a shaft, a beam, a bolt, a bearing's life, a gear tooth and a column. Each
answers its figures and says, under what the helpers did, one line per
check as a requirement does: what was measured, the limit, and the margin
to it. They are the textbook's static formulas, each with its source and
assumptions in its own description: no fatigue, no stress raisers, no
dynamic load beyond what is said. A design they pass is sized, not proven.

Units: lengths in mm, forces in N, torques and moments in N·m, stresses in
MPa, speeds in rpm. Materials by the requirements' names, with figures in
strength_materials.
"""

import math
from types import SimpleNamespace

from . import notes
from . import strength_materials as materials
from .words import figures as _n


class StrengthRefused(ValueError):
    """A calculation that cannot be made as asked, with why."""


def _check(what, measured, limit, unit, at_least=True):
    """
    One check as a requirement says it: what was measured against its limit
    and the margin, at least or at most the limit. Answers whether it holds
    and the words.
    """
    margin = measured - limit if at_least else limit - measured
    holds = margin >= -1e-12
    words = f"{what} {_n(measured)}{unit}, where {'at least' if at_least else 'at most'} {_n(limit)}{unit} is asked: {'holds' if holds else 'fails'}, {_n(abs(margin))}{unit} {'to spare' if holds else 'past the limit'}"
    return holds, words


def _material(material, yield_strength, modulus, shear_modulus=None):
    try:
        return materials.of(material, yield_strength, modulus, shear_modulus)
    except materials.NoFigures as why:
        raise StrengthRefused(str(why)) from None


def _said(name, facts, checks, caveat):
    holds = all(ok for ok, _ in checks)
    said = "; ".join(words for _, words in checks)
    line = f"strength.{name}: {facts}. " + (said[:1].upper() + said[1:] + ". " if checks else "") + caveat
    notes.say(line.strip())
    return holds


def _positive(**values):
    for key, value in values.items():
        if value is not None and not (isinstance(value, (int, float)) and value > 0):
            raise StrengthRefused(f"{key} is a number above 0.")


def _section(width=None, height=None, diameter=None, bore=0.0, inertia=None, fibre=None, area=None):
    """
    A cross-section's second moment of area I (mm⁴), its extreme fibre c (mm),
    its area A (mm²) and its words: a rectangle width × height bent about the
    axis along its width, a round bar or tube, or I and c given.
    """
    if diameter is not None:
        _positive(diameter=diameter)
        if not 0 <= bore < diameter:
            raise StrengthRefused("bore is 0 or more and under the diameter.")
        i = math.pi * (diameter**4 - bore**4) / 64
        a = math.pi * (diameter**2 - bore**2) / 4
        words = f"Ø{_n(diameter)} mm" + (f" tube, bore Ø{_n(bore)} mm," if bore else " solid")
        return i, diameter / 2, a, words
    if width is not None and height is not None:
        _positive(width=width, height=height)
        return width * height**3 / 12, height / 2, width * height, f"{_n(width)} mm wide, {_n(height)} mm deep rectangle"
    if inertia is not None and fibre is not None:
        _positive(inertia=inertia, fibre=fibre, area=area)
        return inertia, fibre, area, f"I {_n(inertia)} mm⁴, c {_n(fibre)} mm"
    raise StrengthRefused("give the section: width and height, diameter (and bore for a tube), or inertia and fibre.")


class strength:
    """
    Strength checks of a design's numbers, given to scripts with no import:
    strength.shaft, strength.beam, strength.bolt, strength.bearing,
    strength.gear and strength.column. Each says its checks under what the
    helpers did, and answers its figures, with holds: whether every check
    held. Lengths mm, forces N, torques and moments N·m, stresses MPa.
    """

    @staticmethod
    def shaft(diameter, torque=0.0, moment=0.0, material="steel", bore=0.0, length=None, load=None, supports="simple", safety=2.0, max_deflection=None, max_twist=None, yield_strength=None, modulus=None, shear_modulus=None):
        """
        A round shaft, solid or a tube (bore), under torque and bending:
        bending stress 32·M·d / (π (d⁴ − bore⁴)), torsion 16·T·d / (π (d⁴ − bore⁴)),
        von Mises √(σ² + 3τ²) against the yield strength for the safety factor
        (Shigley's Mechanical Engineering Design, static failure by the
        distortion-energy theory). Given length and a load at the middle
        between two bearings (supports "simple") or at the end of an overhang
        ("cantilever"), its bending moment F·L/4 or F·L when moment is not
        given, its deflection F·L³/(48 E I) or F·L³/(3 E I), and with torque
        its twist T·L/(G J). Static only: fatigue, and the stress raised at
        shoulders, keyways and grooves, are not counted.
        """
        _positive(diameter=diameter, length=length, load=load, safety=safety)
        if supports not in ("simple", "cantilever"):
            raise StrengthRefused('supports is "simple" (a load midway between two bearings) or "cantilever" (a load at the end of an overhang).')
        figures = _material(material, yield_strength, modulus, shear_modulus)
        i, c, _, words = _section(diameter=diameter, bore=bore)
        j = 2 * i
        if load is not None and length is None:
            raise StrengthRefused("a load is given with the length between the bearings, or of the overhang.")
        if load is not None and not moment:
            moment = load * length / (4 if supports == "simple" else 1) / 1000
        bending = abs(moment) * 1000 * c / i
        torsion = abs(torque) * 1000 * c / j
        von_mises = math.sqrt(bending**2 + 3 * torsion**2)
        factor = figures["yield"] / von_mises if von_mises > 0 else math.inf
        checks = [_check("safety factor against yield", factor, safety, "")]
        deflection = twist = None
        if load is not None:
            deflection = load * length**3 / ((48 if supports == "simple" else 3) * figures["E"] * i)
            if max_deflection is not None:
                checks.append(_check("deflection", deflection, max_deflection, " mm", at_least=False))
        if length is not None and torque:
            twist = math.degrees(abs(torque) * 1000 * length / (figures["G"] * j))
            if max_twist is not None:
                checks.append(_check("twist", twist, max_twist, "°", at_least=False))
        facts = (
            f"{words} {material} shaft ({figures['grade']}: yield {_n(figures['yield'])} MPa), {_n(torque)} N·m torque, {_n(moment)} N·m bending"
            f": bending {_n(bending)} MPa, torsion {_n(torsion)} MPa, von Mises {_n(von_mises)} MPa"
            + (f", deflection {_n(deflection)} mm" if deflection is not None else "")
            + (f", twist {_n(twist)}°" if twist is not None else "")
        )
        holds = _said("shaft", facts, checks, "Static only: no fatigue, and no stress raised at shoulders, keyways or grooves.")
        return SimpleNamespace(bending=bending, torsion=torsion, von_mises=von_mises, safety=factor, deflection=deflection, twist=twist, holds=holds)

    @staticmethod
    def beam(length, load, material="steel", width=None, height=None, diameter=None, bore=0.0, inertia=None, fibre=None, supports="simple", spread=False, safety=2.0, max_deflection=None, yield_strength=None, modulus=None):
        """
        A straight beam of one section bending under a load: at its middle,
        or spread evenly along it (spread=True, load the total), on supports
        "simple" (resting on one at each end), "cantilever" (held at one end)
        or "fixed" (held at both). Its largest moment and deflection (Roark's
        Formulas for Stress and Strain, Shigley's Table A-9): simple F·L/4 and
        F·L³/(48 E I), spread W·L/8 and 5 W·L³/(384 E I); cantilever, the load
        at its end, F·L and F·L³/(3 E I), spread W·L/2 and W·L³/(8 E I); fixed
        F·L/8 and F·L³/(192 E I), spread W·L/12 and W·L³/(384 E I). Stress
        M·c / I against the yield for the safety factor. Elastic and static:
        no buckling of a thin flange or web, no shear deflection.
        """
        _positive(length=length, load=load, safety=safety)
        cases = {
            ("simple", False): (1 / 4, 1 / 48),
            ("simple", True): (1 / 8, 5 / 384),
            ("cantilever", False): (1.0, 1 / 3),
            ("cantilever", True): (1 / 2, 1 / 8),
            ("fixed", False): (1 / 8, 1 / 192),
            ("fixed", True): (1 / 12, 1 / 384),
        }
        if (supports, bool(spread)) not in cases:
            raise StrengthRefused('supports is "simple", "cantilever" or "fixed".')
        figures = _material(material, yield_strength, modulus)
        i, c, _, words = _section(width, height, diameter, bore, inertia, fibre)
        m_share, d_share = cases[(supports, bool(spread))]
        moment = m_share * load * length
        stress = moment * c / i
        deflection = d_share * load * length**3 / (figures["E"] * i)
        factor = figures["yield"] / stress
        checks = [_check("safety factor against yield", factor, safety, "")]
        if max_deflection is not None:
            checks.append(_check("deflection", deflection, max_deflection, " mm", at_least=False))
        how = f"{'spread along it' if spread else ('at its end' if supports == 'cantilever' else 'at its middle')}"
        facts = (
            f"{_n(length)} mm {supports} {material} beam, {words} ({figures['grade']}: yield {_n(figures['yield'])} MPa, E {_n(figures['E'] / 1000)} GPa), {_n(load)} N {how}"
            f": moment {_n(moment / 1000)} N·m, stress {_n(stress)} MPa, deflection {_n(deflection)} mm"
        )
        holds = _said("beam", facts, checks, "Elastic and static: no local buckling, no shear deflection.")
        return SimpleNamespace(moment=moment / 1000, stress=stress, deflection=deflection, safety=factor, holds=holds)

    @staticmethod
    def bolt(size="M8", grade="8.8", tension=0.0, shear=0.0, planes=1, friction=0.3, threads_in_shear=True, torque_factor=0.2, joint="bearing"):
        """
        One bolt of a joint (EN 1993-1-8, Eurocode 3, Table 3.4 and 3.9):
        preload Fp = 0.7 fub As; shear resistance per plane αv fub A / γM2,
        αv 0.6, or 0.5 for 10.9 with the threads in the shear plane, A the
        stress area As there or the shank's otherwise; tension resistance
        0.9 fub As / γM2; the two together Fv/Fv,Rd + Ft/(1.4 Ft,Rd) ≤ 1;
        and the slip a preloaded joint holds, μ Fp planes / γM3, γM2 = γM3 =
        1.25, checked only for joint="slip", a slip-resistant joint: a
        bearing joint, as joint="bearing" is and a bolt is unless said,
        takes its shear on the bolt itself. As = π/4 (d − 0.9382 P)² (ISO 898-1), P the coarse pitch of
        ISO 261 unless the size gives it (M8x1). The tightening torque is
        K Fp d with K = torque_factor, 0.2 for plain dry steel (Shigley). Grades
        4.6, 5.6, 8.8 and 10.9, with Eurocode's fub of 400, 500, 800 and 1000 MPa.
        """
        coarse = {3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2.0, 16: 2.0, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3.0, 27: 3.0, 30: 3.5, 36: 4.0}
        grades = {"4.6": 400.0, "5.6": 500.0, "8.8": 800.0, "10.9": 1000.0}
        if str(grade) not in grades:
            raise StrengthRefused(f"grade is one of {', '.join(grades)}, as Eurocode 3 gives them.")
        if joint not in ("bearing", "slip"):
            raise StrengthRefused('joint is "bearing", where the bolt takes the shear, or "slip", a slip-resistant joint whose preload holds it.')
        text = str(size).upper().replace(" ", "").replace("×", "X")
        try:
            d_text, _, p_text = text.removeprefix("M").partition("X")
            d = float(d_text)
            pitch = float(p_text) if p_text else coarse[int(d)] if d == int(d) and int(d) in coarse else None
        except ValueError:
            pitch = None
            d = None
        if d is None or pitch is None:
            raise StrengthRefused(f"size is a metric size such as M8, or M8x1 with its pitch; coarse pitches are known for M{', M'.join(str(k) for k in coarse)}.")
        _positive(planes=planes, friction=friction, torque_factor=torque_factor)
        fub = grades[str(grade)]
        stress_area = math.pi / 4 * (d - 0.9382 * pitch) ** 2
        shank = math.pi * d**2 / 4
        alpha = 0.5 if str(grade) == "10.9" and threads_in_shear else 0.6
        area = stress_area if threads_in_shear else shank
        gamma = 1.25
        preload = 0.7 * fub * stress_area
        shear_resistance = alpha * fub * area / gamma * planes
        tension_resistance = 0.9 * fub * stress_area / gamma
        slip = friction * preload * planes / gamma
        both = abs(shear) / shear_resistance + abs(tension) / (1.4 * tension_resistance)
        torque = torque_factor * preload * d / 1000
        checks = []
        if shear:
            checks.append(_check("shear", abs(shear), shear_resistance, " N", at_least=False))
            if joint == "slip":
                checks.append(_check("shear against slip of the preloaded joint", abs(shear), slip, " N", at_least=False))
        if tension:
            checks.append(_check("tension", abs(tension), tension_resistance, " N", at_least=False))
        if shear and tension:
            checks.append(_check("shear and tension together", both, 1.0, "", at_least=False))
        facts = (
            f"{text} grade {grade} bolt (fub {_n(fub)} MPa), stress area {_n(stress_area)} mm², preload {_n(preload)} N at {_n(torque)} N·m tightening"
            f"; resists {_n(shear_resistance)} N in shear over {planes} {'plane' if planes == 1 else 'planes'}, {_n(tension_resistance)} N in tension, slip at {_n(slip)} N with μ {_n(friction)}"
        )
        holds = _said("bolt", facts, checks, "Eurocode 3 design resistances, γM2 = γM3 = 1.25; no prying, no bearing of the plates checked.")
        return SimpleNamespace(stress_area=stress_area, preload=preload, torque=torque, shear_resistance=shear_resistance, tension_resistance=tension_resistance, slip=slip, holds=holds)

    @staticmethod
    def bearing(C, P, rpm, kind="ball", hours=None):
        """
        A rolling bearing's basic rating life (ISO 281): L10 = (C / P)^p
        million turns, p = 3 for ball bearings and 10/3 for roller bearings,
        and L10h = 10⁶ L10 / (60 n) hours at n rpm, the life 90% of such
        bearings reach. C, the dynamic load rating in N, comes from the maker's
        catalogue for the exact bearing: bd_warehouse's bearings have their
        sizes and no load ratings. P is the equivalent dynamic load in N.
        """
        _positive(C=C, P=P, rpm=rpm, hours=hours)
        if kind not in ("ball", "roller"):
            raise StrengthRefused('kind is "ball" or "roller".')
        power = 3.0 if kind == "ball" else 10 / 3
        turns = (C / P) ** power
        life = turns * 1e6 / (60 * rpm)
        checks = [_check("L10 life", life, hours, " h")] if hours is not None else []
        facts = f"{kind} bearing, C {_n(C)} N under P {_n(P)} N at {_n(rpm)} rpm: L10 {_n(turns)} million turns, {_n(life)} h"
        holds = _said("bearing", facts, checks, "ISO 281 basic rating life, 90% reliability, no life modification for lubrication or contamination.")
        return SimpleNamespace(turns=turns, hours=life, holds=holds)

    @staticmethod
    def gear(module, teeth, width, torque, rpm=None, material="steel", profile="cut", safety=2.0, yield_strength=None, modulus=None):
        """
        Lewis's bending stress at a spur gear tooth's root (Shigley's
        Mechanical Engineering Design, eq. 14-8 and Table 14-2): σ = Kv Ft /
        (b m Y), Ft = 2000 T / (m z) N at the pitch circle, Y the Lewis form
        factor of a 20° full-depth tooth from 12 teeth up, read from the table
        between its rows; Kv, Barth's velocity factor at the pitch-line speed V
        m/s, (6.1 + V) / 6.1 for a cut or milled profile, (3.56 + √V) / 3.56
        hobbed or shaped, √((5.56 + √V) / 5.56) shaved or ground, (3.05 + V) /
        3.05 cast, and 1 with no rpm. Against the yield for the safety factor.
        One tooth carrying the whole load at its tip: no contact (pitting)
        stress, which AGMA 2001 adds.
        """
        _positive(module=module, teeth=teeth, width=width, torque=torque, rpm=rpm, safety=safety)
        table = [(12, 0.245), (13, 0.261), (14, 0.277), (15, 0.290), (16, 0.296), (17, 0.303), (18, 0.309), (19, 0.314), (20, 0.322), (21, 0.328), (22, 0.331), (24, 0.337), (26, 0.346), (28, 0.353), (30, 0.359), (34, 0.371), (38, 0.384), (43, 0.397), (50, 0.409), (60, 0.422), (75, 0.435), (100, 0.447), (150, 0.460), (300, 0.472), (400, 0.480)]
        if teeth < 12:
            raise StrengthRefused("the Lewis form factor is tabled from 12 teeth: fewer undercut a 20° tooth.")
        if teeth >= 400:
            form = 0.480 if teeth == 400 else 0.485
        else:
            (z0, y0), (z1, y1) = next((table[k], table[k + 1]) for k in range(len(table) - 1) if table[k][0] <= teeth <= table[k + 1][0])
            form = y0 + (y1 - y0) * (teeth - z0) / (z1 - z0)
        profiles = {
            "cut": lambda v: (6.1 + v) / 6.1,
            "hobbed": lambda v: (3.56 + math.sqrt(v)) / 3.56,
            "ground": lambda v: math.sqrt((5.56 + math.sqrt(v)) / 5.56),
            "cast": lambda v: (3.05 + v) / 3.05,
        }
        if profile not in profiles:
            raise StrengthRefused(f"profile is one of {', '.join(profiles)}.")
        figures = _material(material, yield_strength, modulus)
        pitch = module * teeth
        force = 2000 * torque / pitch
        speed = math.pi * pitch / 1000 * rpm / 60 if rpm else 0.0
        kv = profiles[profile](speed)
        stress = kv * force / (width * module * form)
        factor = figures["yield"] / stress
        checks = [_check("safety factor against yield", factor, safety, "")]
        facts = (
            f"m{_n(module)} z{teeth} gear {_n(width)} mm wide in {material} ({figures['grade']}: yield {_n(figures['yield'])} MPa), {_n(torque)} N·m"
            f": pitch Ø{_n(pitch)} mm, tip Ø{_n(module * (teeth + 2))} mm, tooth force {_n(force)} N, Y {_n(form)}, Kv {_n(kv)}"
            + (f" at {_n(speed)} m/s" if rpm else "")
            + f", root stress {_n(stress)} MPa"
        )
        holds = _said("gear", facts, checks, "Lewis bending only: no contact stress, no load sharing between teeth.")
        return SimpleNamespace(force=force, form_factor=form, velocity_factor=kv, stress=stress, safety=factor, pitch_diameter=pitch, tip_diameter=module * (teeth + 2), holds=holds)

    @staticmethod
    def column(length, load, material="steel", width=None, height=None, diameter=None, bore=0.0, inertia=None, area=None, ends="pinned", safety=2.0, yield_strength=None, modulus=None):
        """
        A straight column under an axial load, its critical load from its
        effective length K·L (Shigley's Mechanical Engineering Design, 4-12
        to 4-14): K is 1 with both ends pinned, 0.5 both fixed, 0.7 one fixed
        and one pinned, 2 one fixed and one free. Slender, K·L / r past
        √(2π² E / Sy), Euler's π² E I / (K L)²; shorter, Johnson's parabola
        A (Sy − (Sy K L / (2π r))² / E). r = √(I / A). Against the load for
        the safety factor. A rectangle buckles about its weaker axis. A
        perfectly straight column loaded on its axis: real ones buckle sooner.
        """
        _positive(length=length, load=load, safety=safety)
        lengths = {"pinned": 1.0, "fixed": 0.5, "fixed-pinned": 0.7, "fixed-free": 2.0}
        if ends not in lengths:
            raise StrengthRefused(f"ends is one of {', '.join(lengths)}.")
        figures = _material(material, yield_strength, modulus)
        if width is not None and height is not None:
            thin, thick = sorted((width, height))
            i, _, a, words = _section(width=thick, height=thin)
        else:
            i, _, a, words = _section(diameter=diameter, bore=bore, inertia=inertia, fibre=1.0 if inertia is not None else None, area=area)
            if a is None:
                raise StrengthRefused("a column given by its inertia gives its area too, in mm².")
        k = lengths[ends]
        radius = math.sqrt(i / a)
        slender = k * length / radius
        transition = math.sqrt(2 * math.pi**2 * figures["E"] / figures["yield"])
        if slender >= transition:
            critical, how = math.pi**2 * figures["E"] * i / (k * length) ** 2, "Euler"
        else:
            critical, how = a * (figures["yield"] - (figures["yield"] * k * length / (2 * math.pi * radius)) ** 2 / figures["E"]), "Johnson"
        factor = critical / load
        checks = [_check("safety factor against buckling", factor, safety, "")]
        facts = (
            f"{_n(length)} mm {material} column, {words}, ends {ends} (K {k:g}), {_n(load)} N"
            f": slenderness {_n(slender)} against {_n(transition)} where Euler's takes over, critical load {_n(critical)} N by {how}"
        )
        holds = _said("column", facts, checks, "A straight column loaded on its axis; real ones buckle sooner.")
        return SimpleNamespace(slenderness=slender, critical=critical, method=how, safety=factor, holds=holds)
