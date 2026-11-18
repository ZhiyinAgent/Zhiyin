"""blender_rig: bones, a ready rig fitted to a body, a mesh bound to its bones, and limbs that reach."""

from . import rig_bind, rig_bones
from .aiming import keeps_focus
from .arguments import need


@keeps_focus
def rig(args, scene_file):
    """Makes or fits the bones first, then binds and sets reaching limbs; each part answers its own lines."""
    lines = rig_bones.apply(args) + rig_bind.apply(args)
    need(lines, "This call rigs nothing.")
    return "\n".join(lines)
