"""blender_simulate: rigid bodies, cloth, colliders and liquids set up, then baked, and kept where they rest."""

from . import sim_bodies, sim_cloth, sim_colliders
from .aiming import keeps_focus
from .arguments import need
from .glass import lets_light_through_sheets
from .wood import lays_grain


@keeps_focus
@lets_light_through_sheets
@lays_grain
def simulate(args, scene_file):
    """
    Sets up what each part is given, then bakes, settles or keys it, then measures a cloth the bake
    ran; each part answers its own lines. A drape runs once the colliders are set, so it meets them.
    """
    cloth_lines, draping = sim_cloth.apply(args)
    lines = (
        cloth_lines
        + sim_colliders.apply(args)
        + sim_cloth.settle(draping, args)
        + sim_bodies.apply(args)
        + sim_cloth.after_bake(args)
    )
    need(lines, "This call simulates nothing.")
    return "\n".join(lines)
