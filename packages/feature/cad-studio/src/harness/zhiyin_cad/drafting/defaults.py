"""
The dimensions a drawing of parts carries when it is asked for none: the
overall sizes, the main view's width and height and the depth from a view
beside it, and the distance between the axes of each pair of gears in mesh,
on a straight view that looks along them. Each is measured as any other is;
one that cannot be is left out. A drawing given an empty list of dimensions
asked for none, and carries none.
"""

from . import gearing


def _straight(built):
    """The straight views drawn, the front first."""
    named = [view for view in built.values() if view.kind == "named" and view.name != "iso"]
    return sorted(named, key=lambda view: view.name != "front")


def _along(view, direction):
    """Which of a view's directions, horizontal or vertical, runs along `direction`, or nothing."""
    if abs(abs(view.right.dot(direction)) - 1) < 1e-6:
        return "horizontal"
    if abs(abs(view.up.dot(direction)) - 1) < 1e-6:
        return "vertical"
    return None


def dimensions(built, gears):
    """The dimensions to draw, as a call gives them, on the views built; `gears` are the gears each part keeps, by name."""
    straight = _straight(built)
    if not straight:
        return []
    main = straight[0]
    found = [
        {"view": main.name, "kind": "overall", "direction": "horizontal"},
        {"view": main.name, "kind": "overall", "direction": "vertical"},
    ]
    # The depth, the main view's look, from the first view beside it that shows it across or up.
    for view in straight[1:]:
        direction = _along(view, main.look)
        if direction:
            found.append({"view": view.name, "kind": "overall", "direction": direction})
            break
    for _, first, _, second in gearing.meshing(gears):
        view = next((one for one in straight if gearing.faced(one, first)), None)
        if view is None:
            continue
        a, b = view.flat(first["centre"]), view.flat(second["centre"])
        dx, dy = abs(b[0] - a[0]), abs(b[1] - a[1])
        direction = "horizontal" if dy < 1e-6 else "vertical" if dx < 1e-6 else "aligned"
        found.append({"view": view.name, "kind": "length", "from": list(first["centre"]), "to": list(second["centre"]), "direction": direction})
    return found


def note(drawn):
    """What the answer says of the dimensions drawn when none was asked for."""
    if not drawn:
        return "No dimensions asked for, and none could be measured; give dimensions to place them."
    gear = any(one.spec["kind"] == "length" for one in drawn)
    return (
        "No dimensions asked for, so the drawing gives the overall sizes"
        + (" and the distance between the axes of each pair of gears in mesh" if gear else "")
        + ". Give dimensions to choose them, or dimensions: [] for none."
    )
