"""
ISO 286 limits and fits for sizes up to 500 mm: a hole's or a shaft's
tolerance class, as H7 or g6, gives the sizes it is made between, and a
fit, as H7/g6, the clearance or interference between the two.

The tolerance grades IT4 to IT11 are ISO 286-1's table. A shaft's
fundamental deviation is its upper one, es, for d to h and its lower one,
ei, for k to s, from ISO 286-1's tables; js is ±IT/2. A hole's comes from
the shaft's of its letter by ISO 286-1's rules: EI = −es for D to H; ES =
−ei + Δ for K, M and N to IT8 and P to S to IT7, Δ being IT(n) − IT(n−1) of
the hole's grade n, and ES = −ei past those grades for P to S; JS is ±IT/2.
"""

from types import SimpleNamespace

from . import notes

# The upper end of each size range, in mm: a size lies in the first range whose end it does not pass.
_RANGES = (3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500)

# ISO 286-1 standard tolerance grades, in µm, for each range.
_IT = {
    4: (3, 4, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20),
    5: (4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27),
    6: (6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40),
    7: (10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63),
    8: (14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97),
    9: (25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155),
    10: (40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250),
    11: (60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400),
}

# Shafts' upper deviation es, in µm, for each range.
_UPPER = {
    "d": (-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230),
    "e": (-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135),
    "f": (-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68),
    "g": (-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20),
    "h": (0,) * 13,
}

# Shafts' lower deviation ei, in µm, for each range; k's for grades 4 to 7, 0 for the others.
_LOWER = {
    "k": (0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5),
    "m": (2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23),
    "n": (4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40),
    "p": (6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68),
}

# r and s change within the ranges above 50 mm: the upper end of each finer range and ei there, in µm.
_FINER = (3, 6, 10, 18, 30, 50, 65, 80, 100, 120, 140, 160, 180, 200, 225, 250, 280, 315, 355, 400, 450, 500)
_LOWER_FINER = {
    "r": (10, 15, 19, 23, 28, 34, 41, 43, 51, 54, 63, 65, 68, 77, 80, 84, 94, 98, 108, 114, 126, 132),
    "s": (14, 19, 23, 28, 35, 43, 53, 59, 71, 79, 92, 100, 108, 122, 130, 140, 158, 170, 190, 208, 232, 252),
}

SHAFTS = tuple(_UPPER) + ("js",) + tuple(_LOWER) + tuple(_LOWER_FINER)
HOLES = tuple(letter.upper() for letter in SHAFTS)


class FitRefused(ValueError):
    """A tolerance class or a size ISO 286 is not given for here, with why."""


def _index(size, ends):
    for k, end in enumerate(ends):
        if size <= end:
            return k
    raise FitRefused(f"ISO 286 is given here for sizes up to {ends[-1]} mm, not {size:g} mm.")


def _class(text):
    letters = "".join(c for c in text if c.isalpha())
    digits = text[len(letters) :]
    if not letters or not digits.isdigit():
        raise FitRefused(f"{text!r} is not a tolerance class: a letter or two and a grade, as H7 or g6.")
    return letters, int(digits)


def _it(grade, size):
    if grade not in _IT:
        raise FitRefused(f"IT{grade} is not given here: grades {min(_IT)} to {max(_IT)} are.")
    return _IT[grade][_index(size, _RANGES)]


def _shaft_lower(letter, grade, size):
    if letter in _LOWER_FINER:
        return _LOWER_FINER[letter][_index(size, _FINER)]
    if letter == "k" and not 4 <= grade <= 7:
        return 0
    return _LOWER[letter][_index(size, _RANGES)]


def deviations(tolerance, size):
    """A class's lower and upper deviations from the size, in µm, and whether it is a hole's."""
    letters, grade = _class(tolerance)
    if not 0 < size <= _RANGES[-1]:
        raise FitRefused(f"ISO 286 is given here for sizes above 0 and up to {_RANGES[-1]} mm, not {size:g} mm.")
    it = _it(grade, size)
    hole = letters[0].isupper()
    letter = letters.lower()
    if letter not in SHAFTS or (hole and letters != letters.upper()) or (not hole and letters != letter):
        raise FitRefused(f"{tolerance} is not a class given here: holes {', '.join(HOLES)}; shafts {', '.join(SHAFTS)}.")
    if letter == "js":
        return -it / 2, it / 2, hole
    if not hole:
        if letter in _UPPER:
            upper = _UPPER[letter][_index(size, _RANGES)]
            return upper - it, upper, False
        lower = _shaft_lower(letter, grade, size)
        return lower, lower + it, False
    if letter in _UPPER:
        lower = -_UPPER[letter][_index(size, _RANGES)]
        return lower, lower + it, True
    if letter in ("k", "m", "n"):
        if grade > 8:
            raise FitRefused(f"{tolerance} is not given here: K, M and N are up to grade 8.")
        delta = 0 if size <= 3 else it - _it(grade - 1, size)
        ei = _LOWER[letter][_index(size, _RANGES)]
        upper = -ei + delta
        if tolerance == "M6" and 250 < size <= 315:
            # ISO 286-1's one exception to the rule.
            upper = -9
    else:
        delta = 0 if size <= 3 or grade > 7 else it - _it(grade - 1, size)
        upper = -_shaft_lower(letter, grade, size) + delta
    return upper - it, upper, True


def _um(value):
    return f"{value:+g}" if value else "0"


def _size(value):
    return f"{value:.3f}"


def iso_fit(fit, size):
    """
    ISO 286 limits for a size in mm: a hole's class (H7), a shaft's (g6) or
    a fit of both (H7/g6). Answers the hole's and the shaft's least, greatest
    and middle sizes in mm, their deviations in µm, and for a fit the least
    and greatest clearance in mm, below zero an interference, and its kind:
    clearance, transition or interference. A bearing's seat takes the class
    its maker's catalogue gives for the load, as k6 or m6 on a shaft turning
    with the inner ring and H7 or J7 in the housing; bd_warehouse's
    PressFitHole cuts a seat given its interference.
    """
    parts = [one.strip() for one in str(fit).split("/")]
    if len(parts) > 2 or not all(parts):
        raise FitRefused(f"{fit!r} is a class, as H7, or a fit, as H7/g6.")
    size = float(size)
    found = {}
    for one in parts:
        lower, upper, hole = deviations(one, size)
        key = "hole" if hole else "shaft"
        if key in found:
            raise FitRefused(f"{fit} gives two {key}s: a fit is a hole's class, upper case, over a shaft's, lower case.")
        found[key] = SimpleNamespace(tolerance=one, lower=lower, upper=upper, least=size + lower / 1000, greatest=size + upper / 1000, middle=size + (lower + upper) / 2000)
    said = [f"iso_fit {fit} at Ø{size:g}"]
    for key in ("hole", "shaft"):
        if key in found:
            one = found[key]
            said.append(f"{key} {one.tolerance} {_size(one.least)} to {_size(one.greatest)} mm ({_um(one.lower)} / {_um(one.upper)} µm)")
    result = SimpleNamespace(size=size, hole=found.get("hole"), shaft=found.get("shaft"), clearance=None, kind=None)
    if len(found) == 2:
        least = (found["hole"].lower - found["shaft"].upper) / 1000
        most = (found["hole"].upper - found["shaft"].lower) / 1000
        kind = "clearance" if least >= 0 else ("interference" if most <= 0 else "transition")
        result.clearance, result.kind = (least, most), kind
        said.append(f"clearance {least:+.3f} to {most:+.3f} mm, below zero an interference: {'an' if kind == 'interference' else 'a'} {kind} fit")
    notes.say(": ".join(said[:1]) + ": " + "; ".join(said[1:]) + ".")
    return result
