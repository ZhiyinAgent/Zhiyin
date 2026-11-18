"""
Requirements a way of making a part sets, measured on its exact faces: the
inner corners a cutter can reach, the ribs a moulding stands, the faces a
mould traps, and the hollows nothing can reach or drain. Each answers
whether it holds, what was measured, the limit and the margin, as every
requirement does. The forms themselves are found as the build's own checks
find them.
"""

import math

import build123d as bd
import numpy

from . import forms, hollows
from . import making as ways
from .unchecked import Unchecked
from .words import mm as _mm
from .words import point as _at
from .words import way as _way

# Lengths closer than this, in mm, are the same.
NEAR = forms.NEAR


# ---- corner -----------------------------------------------------------------


def corner(parts, asked):
    along = bd.Vector(*asked["along"]).normalized() if asked.get("along") else None
    least = asked["min"]
    way = f" along {_way(tuple(along))}" if along is not None else ""
    worst = None
    for name, shape in parts:
        corners = [(one["radius"], one["at"]) for one in forms.inner_corners(shape, along)]
        if not corners:
            result = {"margin": None, "unit": "", "measured": f"{name} has no inner corner{way}"}
            rank = math.inf
        else:
            radius, place = min(corners, key=lambda one: one[0])
            tightest = "a sharp edge" if radius < NEAR else f"R{_mm(radius)} mm"
            said = f"{name}'s tightest inner corner{way} is {tightest}, at {_at(place)}"
            under = [r for r, _ in corners if r < least - 1e-9]
            if under:
                sizes = {}
                for r in under:
                    key = "sharp edge" if r < NEAR else f"R{_mm(r)} mm"
                    sizes[key] = sizes.get(key, 0) + 1
                listed = ", ".join(
                    f"{n} {key}{'s' if n > 1 and key == 'sharp edge' else ''}" if key == "sharp edge" else f"{n} of {key}"
                    for key, n in sorted(sizes.items(), key=lambda item: item[0] != "sharp edge")
                )
                said += f"; inner corners under R{_mm(least)} mm: {listed}"
            result = {"margin": radius - least, "unit": "mm", "measured": said}
            rank = radius - least
        if worst is None or rank < worst[0]:
            worst = (rank, result)
    return worst[1]


# ---- ribs -------------------------------------------------------------------


def ribs(parts, asked):
    wall = asked["wall"]
    ratio, tall = asked.get("ratio"), asked.get("height")
    worst = None
    for name, shape in parts:
        found = forms.ribs(shape)
        if not found:
            raise Unchecked(f"no rib was found on {name}: a rib here is a flat-topped wall standing out from a face, more than three times as long as it is thick")
        margins = []
        said = [f"{name} has {len(found)} {'rib' if len(found) == 1 else 'ribs'}"]
        if ratio is not None:
            thickest = max(found, key=lambda one: one["thickness"])
            limit = ratio * wall
            margins.append(limit - thickest["thickness"])
            said.append(
                f"the thickest is {_mm(thickest['thickness'])} mm at its root, {_mm(thickest['thickness'] / wall)} of the {_mm(wall)} mm wall, at {_at(thickest['at'])}, where at most {_mm(ratio)} ({_mm(limit)} mm) is asked"
            )
        if tall is not None:
            tallest = max(found, key=lambda one: one["height"])
            limit = tall * wall
            margins.append(limit - tallest["height"])
            said.append(
                f"the tallest stands {_mm(tallest['height'])} mm out, {_mm(tallest['height'] / wall)} times the wall, at {_at(tallest['at'])}, where at most {_mm(tall)} ({_mm(limit)} mm) is asked"
            )
        margin = min(margins)
        if worst is None or margin < worst["margin"]:
            worst = {"margin": margin, "unit": "mm", "measured": "; ".join(said)}
    return worst


# ---- undercut ---------------------------------------------------------------


def undercut(parts, asked):
    """
    The faces a mould traps: from points of each face, the way its half of
    the mould leaves meets the part again, as the build's check of a moulded
    part finds them. With side actions, a face one square to the pull frees
    is not trapped. The margin is the area allowed less the area trapped.
    """
    pull = numpy.array(asked.get("pull", [0, 0, 1]), dtype=float)
    pull /= numpy.linalg.norm(pull)
    allowed = asked.get("max", 0)
    sides = bool(asked.get("sides"))
    worst = None
    for name, shape in parts:
        found = ways.undercuts(shape, pull, asked.get("parting"))
        trapped = [one for one in found if not (sides and one["sides"])]
        freed = [one for one in found if sides and one["sides"]]
        area = sum(one["area"] for one in trapped)
        split = f", the mould parted at {_mm(asked['parting'])} mm along the pull" if asked.get("parting") is not None else ""
        if not trapped:
            said = f"no face of {name} is trapped along {ways._axis_words(pull)}{split}"
        else:

            def place(one):
                frees = (
                    f"a side action along {' or '.join(ways._axis_words(s) for s in one['sides'])} frees it"
                    if one["sides"]
                    else "no side action square to the pull frees it"
                )
                return f"{_mm(one['area'])} mm² at {ways._at(one['at'])}, {frees}"

            listed = "; ".join(place(one) for one in trapped[: ways.PLACES])
            more = f"; and {len(trapped) - ways.PLACES} more" if len(trapped) > ways.PLACES else ""
            faces = f"{len(trapped)} {'face' if len(trapped) == 1 else 'faces'}"
            said = f"{name} has {faces}, {_mm(area)} mm², trapped along {ways._axis_words(pull)}{split}: {listed}{more}"
        if freed:
            said += f"; {len(freed)} more {'face' if len(freed) == 1 else 'faces'}, {_mm(sum(one['area'] for one in freed))} mm², freed by side actions"
        said += f", where at most {_mm(allowed)} mm² is asked"
        margin = allowed - area
        if worst is None or margin < worst["margin"]:
            worst = {"margin": margin, "unit": "mm²", "measured": said}
    return worst


# ---- void -------------------------------------------------------------------


def void(parts, asked):
    """
    The hollows of a part nothing reaches: each closed void inside it, and,
    given an opening, each hollow wide enough to hold a ball of that size
    that the ball cannot leave by, as resin or powder stays in a hollow
    print whose drain holes are too small. Any fails, with no margin, as no
    distance to a limit measures a hollow that should not be.
    """
    opening = asked.get("opening")
    said, holds = [], True
    for name, shape in parts:
        closed = ways.voids(shape)
        if closed:
            holds = False
            listed = "; ".join(f"{_mm(one['volume'])} mm³, {ways._box_words(one['min'], one['max'])}" for one in closed[: ways.PLACES])
            more = f"; and {len(closed) - ways.PLACES} more" if len(closed) > ways.PLACES else ""
            words = f"{name} holds {len(closed)} closed {'void' if len(closed) == 1 else 'voids'}: {listed}{more}"
        else:
            words = f"{name} holds no closed void"
        if opening is not None:
            found = hollows.trapped(shape, opening)
            count = len(found["hollows"])
            if count:
                holds = False
                listed = "; ".join(f"about {_mm(one['volume'])} mm³, {ways._box_words(one['min'], one['max'])}" for one in found["hollows"][: ways.PLACES])
                more = f"; and {count - ways.PLACES} more" if count > ways.PLACES else ""
                words += f"; {count} {'hollow is' if count == 1 else 'hollows are'} open to the outside only through less than Ø{_mm(opening)} mm: {listed}{more}"
            else:
                words += f"; every hollow wide enough for a ball of Ø{_mm(opening)} mm opens to the outside through at least that"
            words += f", found on a grid of {_mm(found['pitch'])} mm"
        said.append(words)
    return {"margin": None, "unit": "", "holds": holds, "measured": "; ".join(said)}
