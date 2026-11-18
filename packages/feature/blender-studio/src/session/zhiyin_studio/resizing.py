"""
A part resized along its own axes without what is attached to it: a mesh in its own shape, its
steps and its cutters' holes following, anything else by its scale.
"""

import contextlib

import bpy
import mathutils
import mathutils.bvhtree

from .arguments import need
from .finding import is_helper
from .geometry import flat_axis
from .keys import own_keys, scale_keys, stretch_keys
from .placing import TRANSFORM_PATHS, cuts_its_parent, keyed_paths, slanted_by
from .scales import SHAPE_SCALE, even, shape_scale


def resize(obj, factors, exact=False):
    """
    Resizes a part by `factors` along its own axes, without what is attached
    to it: that keeps its own size and place. A mesh is resized in its own
    shape, so it never carries a resize in its scale for a part attached to
    it to inherit; its cutters are resized with it. One with a step whose
    sizes cannot follow its shape is resized by its scale, if nothing is
    attached to it. Anything else is resized by its scale, and a group's
    parts with it, since they are the group. Factors as near one another as
    an answer's sizes can tell are one factor, unless `exact`. Answers what
    it says of the resize beside the part's new place.
    """
    if even(factors) and not exact:
        factors = [sum(factors) / 3] * 3
    bpy.context.view_layer.update()
    cutters = cutters_of(obj)
    attached = [c for c in obj.children if c not in cutters]
    # A mesh's cutter that cuts other parts too is kept where it is, as an attached part is.
    shared = [c.name for c in attached if obj.type == "MESH" and cuts_its_parent(c)]
    notes = [f"{', '.join(shared)} {'cuts' if len(shared) == 1 else 'cut'} other parts too, so {'it keeps its' if len(shared) == 1 else 'they keep their'} place and size"] if shared else []
    # A cutter people see is a part of the scene: say it changed with its hole.
    seen = [c.name for c in cutters if not is_helper(c)]
    if seen and obj.type == "MESH":
        notes.append(
            f"{', '.join(seen)}, which {'cuts' if len(seen) == 1 else 'cut'} its holes, "
            f"{'is' if len(seen) == 1 else 'are'} resized and moved with them"
        )
    if obj.type == "MESH":
        unfollowed = [s for s in obj.modifiers if not step_follows(s)]
        if not unfollowed:
            resize_shape(obj, factors, cutters)
            return notes
        need(
            not attached,
            f"“{obj.name}” has a {unfollowed[0].type.lower().replace('_', ' ')} step, whose sizes cannot follow its "
            f"shape, and parts attached to it ({', '.join(c.name for c in attached)}), which would stretch with it. "
            "Detach those parts first and attach them again after.",
        )
    if obj.type == "EMPTY" and not even(factors):
        turned = slanted_by(obj)
        need(
            not turned,
            f"“{obj.name}” holds parts turned within it ({', '.join(turned[:4])}), which an uneven resize would "
            "slant. Resize it evenly, by one factor on every side.",
        )
    kept = [] if obj.type == "EMPTY" else attached
    with kept_in_place(obj, kept):
        obj.scale = [obj.scale[i] * factors[i] for i in range(3)]
        # Its keyed scale too, or the next frame would undo the resize.
        scale_keys(obj, "scale", factors)
    return notes


@contextlib.contextmanager
def kept_in_place(parent, parts):
    """
    Keeps parts attached to `parent` where they are while it changes: through
    the correction Blender keeps for each, so a part's own keys still move it
    as they did.
    """
    bpy.context.view_layer.update()
    before = parent.matrix_world.copy()
    yield
    bpy.context.view_layer.update()
    change = parent.matrix_world.inverted_safe() @ before
    for part in parts:
        part.matrix_parent_inverse = change @ part.matrix_parent_inverse
    bpy.context.view_layer.update()


# Steps of a shape that hold no length, so they follow a resized shape as
# they are.
LENGTHLESS_STEPS = {"BOOLEAN", "MIRROR", "SUBSURF", "TRIANGULATE", "WEIGHTED_NORMAL", "EDGE_SPLIT", "DECIMATE", "WELD"}


def is_diagonal(matrix):
    """Whether a transform only stretches along its own axes."""
    largest = max(abs(matrix[i][i]) for i in range(3))
    return all(abs(matrix[r][c]) <= 1e-6 * largest for r in range(3) for c in range(3) if r != c)


def cutters_of(obj):
    """
    What cuts its holes alone: its own cutters, and the objects attached to it
    that its booleans use, but for one that cuts another part too.
    """
    used = {s.object for s in obj.modifiers if s.type == "BOOLEAN" and s.object is not None}
    elsewhere = {
        s.object for o in bpy.data.objects if o is not obj for s in o.modifiers if s.type == "BOOLEAN" and s.object is not None
    }
    return [c for c in obj.children if c.type == "MESH" and (is_helper(c) or c in used) and c not in elsewhere]


def step_follows(step):
    """Whether a step's sizes can follow its shape when the shape is resized."""
    if step.type in LENGTHLESS_STEPS or step.type in ("BEVEL", "SOLIDIFY"):
        return True
    return step.type == "ARRAY" and step.fit_type == "FIXED_COUNT" and not step.use_object_offset


def resized_steps(obj, factors, matrix=None):
    """
    How each step of a part's shape changes when its shape is resized by
    `factors`, or reshaped by `matrix` when that turns it too. Repeats stay
    apart as the shape stretches. Rounded edges and walls keep one width all
    round, and change with the least of the factors, so an edge rounded to fit
    the part's thinnest side still fits; a flat sheet's walls are its
    thickness, which changes as that side does.
    """
    changes = []
    for step in obj.modifiers:
        if step.type == "ARRAY" and step.fit_type == "FIXED_COUNT" and not step.use_object_offset:
            given = mathutils.Vector(step.constant_offset_displace)
            offset = list(matrix @ given) if matrix is not None else [given[i] * factors[i] for i in range(3)]
            changes.append((step, "constant_offset_displace", offset))
        elif step.type == "BEVEL" and step.offset_type != "PERCENT":
            changes.append((step, "width", step.width * min(factors)))
        elif step.type == "SOLIDIFY":
            axis = flat_axis(obj.data)
            changes.append((step, "thickness", step.thickness * (min(factors) if axis is None else factors[axis])))
    return changes


def own_shape(shape):
    """Gives a shape another object shares a copy of its own, with its shape keys' motion its own too."""
    if shape.data.users > 1:
        shape.data = shape.data.copy()
        if shape.data.shape_keys is not None:
            own_keys(shape.data.shape_keys)


def cutter_plans(obj, factors, cutters):
    """
    How each cutter follows the resize, checked before anything changes: its
    stretch in its own frame, and that same stretch where its keys place it.
    A cutter that turns by keys cannot follow an uneven resize as it turns, nor
    one keyed in a frame turned from its part's.
    """
    stretch = obj.matrix_world @ mathutils.Matrix.Diagonal((*factors, 1)) @ obj.matrix_world.inverted_safe()
    plans = []
    for cutter in cutters:
        keyed = keyed_paths(cutter)
        need(
            even(factors) or not any(path.startswith("rotation") for path in keyed),
            f"“{cutter.name}” cuts “{obj.name}” and turns by keys, which an uneven resize cannot follow as it turns. "
            f"Resize “{obj.name}” evenly, or remove “{cutter.name}”'s turning keys first.",
        )
        world = cutter.matrix_world.copy()
        linear = world.to_3x3().to_4x4()
        local = linear.inverted_safe() @ stretch.to_3x3().to_4x4() @ linear
        need(
            is_diagonal(local) or "scale" not in keyed,
            f"“{cutter.name}” cuts “{obj.name}” turned across the resize, and its size is keyed, which a stretch "
            f"across its turn cannot follow. Remove its scale keys first, or resize “{obj.name}” evenly.",
        )
        unfollowed = [s.name for s in cutter.modifiers if not step_follows(s)]
        need(
            not unfollowed,
            f"“{cutter.name}” cuts “{obj.name}” and has a step ({unfollowed[0] if unfollowed else ''}) whose sizes "
            "cannot follow its hole. Remove that step first.",
        )
        # Stretched across its turn, its frame turns, and parts on it that move
        # by keys would move in a frame their keys do not share.
        moving = [d.name for d in cutter.children_recursive if keyed_paths(d) & TRANSFORM_PATHS]
        need(
            is_diagonal(local) or not moving,
            f"“{cutter.name}” cuts “{obj.name}” turned across the resize, and {', '.join(moving[:4])} attached "
            f"to it {'moves' if len(moving) == 1 else 'move'} by keys, which a stretch across its turn cannot keep. "
            f"Resize “{obj.name}” evenly, or detach {'it' if len(moving) == 1 else 'them'} first.",
        )
        if is_diagonal(local):
            steps = resized_steps(cutter, [abs(local[i][i]) for i in range(3)])
        else:
            own = world.to_scale()
            steps = resized_steps(
                cutter,
                [min(abs(s) for s in own) * f for f in factors],
                matrix=stretch.to_3x3() @ linear.to_3x3(),
            )
        # Where its keys place it: its part's own frame, through Blender's correction.
        placing = cutter.matrix_parent_inverse.inverted_safe() @ mathutils.Matrix.Diagonal((*factors, 1)) @ cutter.matrix_parent_inverse
        need(
            "location" not in keyed or is_diagonal(placing),
            f"“{cutter.name}” cuts “{obj.name}” and moves by keys in a frame turned from it, which a resize cannot "
            "follow. Key it again after the resize.",
        )
        plans.append((cutter, world, linear, local, placing, steps))
    return stretch, plans


def resize_shape(obj, factors, cutters):
    """
    Resizes a mesh in its own shape, so nothing attached to it is stretched,
    turned or keyed as it may be. Its steps follow, its cutters' holes move
    and stretch with it, keys and all, what is attached to a cutter staying
    where it is, and it records what its shape was resized by, so scaling it
    stays a factor on its built size.
    """
    stretch, plans = cutter_plans(obj, factors, cutters)
    changes = resized_steps(obj, factors)
    own_shape(obj)
    obj.data.transform(mathutils.Matrix.Diagonal((*factors, 1)), shape_keys=True)
    obj.data.update()
    for step, name, value in changes:
        setattr(step, name, value)
    shaped = shape_scale(obj)
    obj[SHAPE_SCALE] = [shaped[i] * factors[i] for i in range(3)]
    # Lettering bent round a cylinder is bent round a larger one; stretched
    # unevenly it is bent round none, and is said to be bent no more.
    if obj.get("zhiyin_wrap"):
        if even(factors):
            obj["zhiyin_wrap"] = float(obj["zhiyin_wrap"]) * factors[0]
        else:
            del obj["zhiyin_wrap"]
    for cutter, world, linear, local, placing, steps in plans:
        # Its origin goes where the stretch takes it, and its shape stretches
        # around it, so it is placed, moved and described by its hole.
        moved = stretch @ world.translation
        own_shape(cutter)
        with kept_in_place(cutter, list(cutter.children)):
            if is_diagonal(local):
                cutter.data.transform(local, shape_keys=True)
                cutter.matrix_world = mathutils.Matrix.Translation(moved) @ linear
            else:
                # Stretched across its turn it is no longer a turned box: its
                # turn becomes part of its shape, which it is then described by.
                cutter.data.transform(stretch.to_3x3().to_4x4() @ linear, shape_keys=True)
                cutter.matrix_world = mathutils.Matrix.Translation(moved)
            # Where its keys place it moves with the stretch too, and its own
            # steps follow its hole.
            stretch_keys(cutter, "location", [placing[i][i] for i in range(3)], [placing[i][3] for i in range(3)])
            for step, name, value in steps:
                setattr(step, name, value)
            cutter.data.update()
    bpy.context.view_layer.update()
