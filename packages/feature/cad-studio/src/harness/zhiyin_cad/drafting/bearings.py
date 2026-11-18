"""
Rolling bearings drawn as ISO 8826-1's general simplified representation:
a bought bearing is drawn as its outline alone, a ring of its outside
diameter, bore and width, its rings, balls and cage left out. A section
through its axis cuts the ring but does not hatch it, and draws an upright
cross in each half, clear of the outline. A bearing whose outline cannot be
found on its faces is drawn as made.
"""

import build123d as bd

# Half of each arm of the cross, as a share of the smaller of the ring's width and depth.
ARM = 0.3
# How square a view must look across a bearing's axis, as a cosine, for its crosses to be drawn.
SQUARE = 1e-6


def recorded(parts):
    """Each shown part bought as a bd_warehouse bearing, by its name, with its outline as found on its faces."""
    from .. import bom_record

    bought = bom_record.bought()
    found = {}
    for name, shape in parts:
        if "Bearing" not in (bought.get(name) or {}).get("class", ""):
            continue
        outline = outline_of(shape)
        if outline is not None:
            found[name] = outline
    return found


def outline_of(shape):
    """
    A bearing's axis, the middle of its width on it, its outside and bore
    radii and its width: the largest round face, the smallest on the same
    axis, and how far the part reaches along it. None when it has no such faces.
    """
    rounds = [face for face in shape.faces() if face.geom_type == bd.GeomType.CYLINDER]
    if not rounds:
        return None
    outer = max(rounds, key=lambda face: face.radius)
    axis = outer.axis_of_rotation
    along, through = axis.direction.normalized(), axis.position

    def on_axis(face):
        other = face.axis_of_rotation
        off = other.position - through
        return abs(abs(other.direction.normalized().dot(along)) - 1) < 1e-9 and (off - along * off.dot(along)).length < 1e-3

    inner = min((face for face in rounds if on_axis(face)), key=lambda face: face.radius)
    if inner.radius >= outer.radius:
        return None
    heights = [(vertex.center() - through).dot(along) for vertex in shape.vertices()]
    low, high = min(heights), max(heights)
    centre = through + along * ((low + high) / 2)
    return {
        "axis": [along.X, along.Y, along.Z],
        "centre": [centre.X, centre.Y, centre.Z],
        "outer": float(outer.radius),
        "inner": float(inner.radius),
        "width": float(high - low),
    }


def drawn(bearing):
    """The ring a bearing is drawn as."""
    along = bd.Vector(*bearing["axis"])
    plane = bd.Plane(origin=bd.Vector(*bearing["centre"]) - along * (bearing["width"] / 2), z_dir=along)
    align = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
    ring = bd.Cylinder(bearing["outer"], bearing["width"], align=align) - bd.Cylinder(bearing["inner"], bearing["width"], align=align)
    return bd.Location(plane) * ring


def crosses(view, bearings, through):
    """
    The upright cross in each half of each bearing a section's plane, through
    `through`, cuts along its axis: one arm along the axis, one across it, in
    the middle of the ring's cut face, as visible lines.
    """
    for bearing in bearings:
        along = bd.Vector(*bearing["axis"])
        if abs(along.dot(view.look)) >= SQUARE:
            continue
        centre = bd.Vector(*bearing["centre"])
        if abs((centre - bd.Vector(*through)).dot(view.look)) > bearing["inner"]:
            continue
        u = (along.dot(view.right), along.dot(view.up))
        n = (-u[1], u[0])
        middle = (bearing["outer"] + bearing["inner"]) / 2
        arm = ARM * min(bearing["width"], bearing["outer"] - bearing["inner"])
        cx, cy = view.flat(centre)
        for side in (1, -1):
            px, py = cx + n[0] * middle * side, cy + n[1] * middle * side
            view.lines.append(("visible", [(px - u[0] * arm, py - u[1] * arm), (px + u[0] * arm, py + u[1] * arm)]))
            view.lines.append(("visible", [(px - n[0] * arm, py - n[1] * arm), (px + n[0] * arm, py + n[1] * arm)]))
