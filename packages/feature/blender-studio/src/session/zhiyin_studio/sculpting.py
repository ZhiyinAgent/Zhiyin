"""
Sculpting in scripts: brushes along strokes, filters, masks and fine detail, on the mesh itself.
Blender's own sculpt brushes need a 3D view, which the session has none of, so these work on the
mesh's points directly; each call says the points it moved and the most, the volume change and
any new self-crossings, and the model looks with blender_look.
"""

import numpy

from .arguments import is_number, need, number, vector
from .errors import Refused
from .picking import Picked, mesh_object
from .sculpt_brushes import BRUSHES, BY_DEPTH, BY_STRENGTH, BY_VECTOR, FALLOFF, Under, moves, smoothed
from .sculpt_filters import sculpt_filter
from .sculpt_levels import sculpt_bake, sculpt_detail, sculpt_reshape
from .sculpt_masks import sculpt_mask
from .sculpt_refine import refine, stretched
from .sculpt_remesh import sculpt_remesh
from .sculpt_shape import Sculpted, finish
from .sculpt_strokes import FALLOFFS, Copy, Reach, Stroke, frames, mirror_axes, mirrors, surface_tree
from .sculpt_symmetry import sculpt_symmetrize, symmetry
from .wording import length, one_of, point_text


def settings(brush, depth, strength, by):
    """The brush's own amount, refused when it lacks one it needs or is given one it does not take."""
    need(brush in BRUSHES, f"brush must be {one_of(BRUSHES)}.")
    if depth is not None and brush not in BY_DEPTH:
        takes = "strength" if brush in BY_STRENGTH else "by"
        raise Refused(f"{brush} takes {takes}, not depth: depth is for {one_of(BY_DEPTH).replace(' or ', ' and ')}.")
    if strength is not None and brush not in BY_STRENGTH:
        takes = "depth" if brush in BY_DEPTH else "by"
        raise Refused(f"{brush} takes {takes}, not strength: strength is for {one_of(BY_STRENGTH).replace(' or ', ' and ')}.")
    if by is not None and brush not in BY_VECTOR:
        raise Refused(f"{brush} takes no by: by is for grab, the distance it carries points.")
    if brush in BY_DEPTH:
        need(
            depth is not None,
            f"{brush} needs depth: how far the surface moves under the stroke's middle, in metres, outward when positive.",
        )
        need(is_number(depth) and depth != 0, "depth must be a number of metres other than 0.")
    if brush in BY_VECTOR:
        need(by is not None, f"{brush} needs by: [x, y, z] in metres, how far the points under the stroke move.")
        by = vector(by, "by")
        need(by.length > 0, "by must move the points: not [0, 0, 0].")
    if brush in BY_STRENGTH:
        strength = number(strength, "strength", minimum=0, maximum=1, default=0.5)
        need(strength > 0, "strength must be more than 0.")
    return depth, strength, by


def said_settings(brush, radius, falloff, axes, depth, strength, by):
    parts = [f"radius {length(radius)}", f"{falloff} falloff"]
    if axes:
        parts.append(f"mirrored in {axes}")
    if depth is not None:
        parts.append(f"depth {length(depth)}")
    if strength is not None:
        parts.append(f"strength {strength:g}")
    if by is not None:
        parts.append(f"by [{point_text(by)[1:-1]}]")
    return ", ".join(parts)


def sculpt(
    obj,
    brush,
    stroke,
    *,
    radius,
    strength=None,
    depth=None,
    by=None,
    falloff=None,
    mirror=None,
    mask=None,
    detail=None,
):
    """
    Runs a brush along a stroke on a mesh's own points: draw, clay, crease, inflate, grab,
    smooth, flatten or pinch, within `radius` metres of the stroke and fading by the falloff,
    repeated across the object's own axes named in `mirror`, holding back the points the vertex
    group `mask` weighs. With `detail`, edges under the stroke longer than that are split first and
    those it stretches past it after. Says the points moved, the most, the volume change and any
    new self-crossings; returns a pick of the points it moved.
    """
    obj = mesh_object(obj, "sculpt")
    reach = number(radius, "radius", minimum=0)
    need(reach > 0, "radius must be more than 0 metres.")
    depth, strength, by = settings(brush, depth, strength, by)
    falloff = falloff if falloff is not None else FALLOFF.get(brush, "smooth")
    need(falloff in FALLOFFS, f"falloff must be {one_of(FALLOFFS)}.")
    fade = FALLOFFS[falloff]
    axes = mirror_axes(mirror)
    finest = None if detail is None else number(detail, "detail", minimum=0)
    need(finest is None or finest > 0, "detail must be a length in metres more than 0.")
    shape = Sculpted(obj, mask)
    try:
        tree = surface_tree(shape.bm)
        line = Stroke(stroke, tree, reach, obj)
        made = [Copy(line.steps, m, tree) for m in mirrors(obj, axes)]
        # A mirrored copy that falls off the surface would land on whatever is nearest, so it is left out.
        copies = [copy for copy in made if copy.off <= reach]
        extra = []
        if len(copies) < len(made):
            dropped = len(made) - len(copies)
            extra.append(
                f"{dropped} of the stroke's {len(made) - 1} mirrored cop{'ies' if dropped != 1 else 'y'} fell further than"
                f" the radius off {obj.name}'s surface, so {'they' if dropped != 1 else 'it'} did nothing"
            )
        split = 0
        if finest is not None:
            split, short = refine(shape, copies, reach, finest)
            shape.mark_before()
            shape.rebase()
            tree = surface_tree(shape.bm)
        points, normals = shape.befores(), shape.normals()
        found = Reach(points, copies)
        inside = found.distance < reach
        if not inside.any():
            raise Refused(
                f"A radius of {length(reach)} reaches no point of {obj.name}: its point nearest the stroke lies"
                f" {length(float(found.distance.min()))} from it. Give a radius past that, or detail= to add points under the stroke."
            )
        free = shape.held()
        weights = numpy.where(inside, fade(numpy.clip(found.distance / reach, 0, 1)), 0.0) * free
        held_back = int((inside & shape.masked()).sum())
        steps = frames(copies, points, normals, reach, fade, tree)
        if brush == "smooth":
            shape.place(smoothed(shape, points, weights, strength))
        else:
            under = Under(points, normals, weights, found, steps, copies)
            shape.place(points + moves(brush, under, depth, strength, by))
            if finest is not None:

                def place(indices):
                    at, facing = shape.befores()[indices], shape.normals()[indices]
                    near = Reach(at, copies)
                    weight = numpy.where(near.distance < reach, fade(numpy.clip(near.distance / reach, 0, 1)), 0.0)
                    weight *= shape.held()[indices]
                    new = Under(at, facing, weight, near, steps, copies)
                    shape.place_some(indices, at + moves(brush, new, depth, strength, by))

                more, longer = stretched(shape, finest, place)
                split += more
                short = short or longer
        if mask is not None and held_back:
            extra.append(f"the mask “{mask}” held back {held_back} point{'s' if held_back != 1 else ''}")
        if finest is not None:
            words = f"{split} edge{'s' if split != 1 else ''} longer than {length(finest)} split, faces {shape.faces} → {len(shape.bm.faces)}"
            if short:
                words += ", stopped short of the detail asked: the mesh would grow past what a session holds"
            extra.append(words)
        heading = f"Sculpted {obj.name} with {brush} {line.words()}, {said_settings(brush, reach, falloff, axes, depth, strength, by)}"
        outcome = finish(shape, heading, extra)
    finally:
        shape.free()
    return Picked(obj, "verts", [int(i) for i in outcome.moved])


FUNCTIONS = (
    sculpt,
    sculpt_filter,
    sculpt_mask,
    sculpt_remesh,
    sculpt_detail,
    sculpt_reshape,
    sculpt_bake,
    sculpt_symmetrize,
    symmetry,
)
