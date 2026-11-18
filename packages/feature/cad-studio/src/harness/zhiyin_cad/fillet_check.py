"""
Fillets and chamfers given edges that are not edges of the shape they round.
build123d answers both a radius too large and an edge of another shape with
"Failed creating a fillet with radius of …, try a smaller value", so a
script that took its edges from a shape before a move, or from another shape
built alike, is sent to change a radius that was never the fault. When the
kernel fails, the edges are checked against the shape's own, and an edge
that is none of them fails the call with that said instead.
"""

from . import interception


def _foreign(shape, edges):
    """The edges given that are not edges of the shape, whatever their orientation."""
    own = shape.edges()
    known = set(own)
    return [edge for edge in edges if edge not in known and not any(edge.is_same(one) for one in own)]


def _said(what, foreign, given):
    edges = "an edge that is not one" if given == 1 else f"{given} edges, {foreign} of them not edges"
    return (
        f"{what} was given {edges} of the shape it works on: an edge of another shape, or of this one "
        "before a move or an operation remade it. Take the edges from the shape as it is at that step, "
        "as made.edges() in its BuildPart or part.edges()."
    )


def _edges_of(args, kwargs, place):
    """The edges a fillet or chamfer was given, by keyword or at their place among the arguments."""
    if "edge_list" in kwargs:
        return kwargs["edge_list"]
    return args[place] if len(args) > place else ()


def _checked(what, place):
    def failed(self, args, kwargs, error):
        edges = list(_edges_of(args, kwargs, place))
        foreign = _foreign(self, edges)
        return ValueError(_said(what, len(foreign), len(edges))) if foreign else None

    return failed


# fillet(radius, edge_list) and chamfer(length, length2, edge_list, face=None).
interception.fails(("build123d.topology.three_d", "Mixin3D", "fillet"), _checked("fillet", 1))
interception.fails(("build123d.topology.three_d", "Mixin3D", "chamfer"), _checked("chamfer", 2))
