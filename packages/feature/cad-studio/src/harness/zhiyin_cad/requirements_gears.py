"""
A mesh requirement: how two parts' gears mesh, from the gears each keeps,
as the gear mesh finds them. The backlash is what the centre distance opens
beyond where the pitch circles meet, as bd_warehouse's teeth have none of
their own; with the contact ratio, each is held to its limits.
"""

from . import bom_record, gears
from .unchecked import Unchecked
from .words import figures as _n
from .words import mm as _mm


def _asked(asked):
    """What the requirement asks, in words."""
    low, high, ratio = asked.get("min"), asked.get("max"), asked.get("contact_ratio")
    said = []
    if low is not None and high is not None:
        said.append(f"{_mm(low)} to {_mm(high)} mm of backlash")
    elif low is not None:
        said.append(f"at least {_mm(low)} mm of backlash")
    elif high is not None:
        said.append(f"at most {_mm(high)} mm of backlash")
    if ratio is not None:
        said.append(f"a contact ratio of at least {_n(ratio)}")
    return " and ".join(said) + (" are asked" if len(said) > 1 else " is asked")


def mesh(first, second, asked):
    """
    The requirement measured on the pairs of parts named, `first` and
    `second` each (name, shape): the pair that meshes worst against the
    limits, or a failure when no gear of one meshes one of the other.
    """
    kept = bom_record.kept_gears()
    for name, _ in first + second:
        if not kept.get(name):
            raise Unchecked(f"{name} keeps no gear the studio knows, one of bd_warehouse's SpurGear or HelicalGear made in the script")
    ones, others = {n for n, _ in first}, {n for n, _ in second}
    worst = None
    for a, fa, b, fb, apart in gears.pairs(kept):
        if not ((a in ones and b in others) or (b in ones and a in others)) or not gears.can_mesh(fa, fb):
            continue
        found = gears.figures(fa, fb, apart)
        margins = []
        if asked.get("min") is not None:
            margins.append(found["backlash"] - asked["min"])
        if asked.get("max") is not None:
            margins.append(asked["max"] - found["backlash"])
        margin = min(margins) if margins else None
        ratio_ok = asked.get("contact_ratio") is None or found["ratio"] >= asked["contact_ratio"]
        key = (ratio_ok, margin if margin is not None else 0.0)
        if worst is None or key < worst[0]:
            worst = (key, a, fa, b, fb, apart, found, margin, ratio_ok)
    if worst is None:
        names = lambda group: ", ".join(n for n, _ in group)  # noqa: E731
        return {
            "margin": None,
            "holds": False,
            "measured": f"no gear of {names(first)} meshes one of {names(second)}: none lies beside another with their tips reaching into each other",
        }
    _, a, fa, b, fb, apart, found, margin, ratio_ok = worst
    if abs(found["wider"]) < 0.005:
        backlash = "where their pitch circles meet, so with no backlash"
    elif found["wider"] < 0:
        backlash = f"{_mm(-found['wider'])} mm closer than where their pitch circles meet, so their teeth bind"
    else:
        backlash = f"{_mm(found['backlash'])} mm of backlash from that alone"
    said = f"{a} ({fa['teeth']:g} teeth) and {b} ({fb['teeth']:g} teeth) mesh {_mm(apart)} mm apart, {backlash}, contact ratio {_n(found['ratio'])}; where {_asked(asked)}"
    return {"margin": margin, "unit": "mm", "holds": ratio_ok and (margin is None or margin >= -1e-9), "measured": said}
