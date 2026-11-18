"""
blender_simulate's rigid bodies, settling, keys and baking of every simulation. Bodies and the world
are set up first, then every simulation is baked or freed where asked, each cloth, soft body and
particle system baked then checked for blowing up and settling, then the rigid-body physics
is run over the timeline and each active body measured; last, the bodies are kept where they rest
or keyed, where asked.
"""

from . import sim_bake, sim_bodies_run, sim_bodies_setup, sim_stability
from .arguments import need
from .errors import Refused

INPUTS = ("rigid", "world", "bake", "then")


def apply(args):
    """The lines this part answers; none when the call gives none of its inputs."""
    if all(args.get(key) is None for key in INPUTS):
        return []
    then = args.get("then")
    need(then is None or then in sim_bodies_run.KEEPING, "then is settle or to_keys.")
    bake = args.get("bake")
    need(bake is None or isinstance(bake, bool), "bake is true, to bake every simulation, or false, to free every bake.")
    settings = sim_bodies_setup.world_settings(args.get("world"))
    groups = args.get("rigid")
    rigid = groups is not None or settings or then is not None
    if rigid and groups is None:
        need(sim_bodies_setup.rigid_objects(), "The scene has no rigid bodies: give them with rigid.")
    lines = sim_bodies_setup.set_up(groups, settings) if rigid else []
    if bake is True:
        lines += sim_bake.bake_all()
        lines += sim_stability.after_bake()
    elif bake is False:
        lines += sim_bake.free_all()
    if sim_bodies_run.active_bodies() and (rigid or bake is True):
        lines.append(sim_bodies_setup.world_text())
        run = sim_bodies_run.Run()
        lines += run.lines
        if then is not None:
            lines += sim_bodies_run.kept(then, run)
    elif then is not None:
        raise Refused("The scene has no active rigid bodies to keep where they rest: give them with rigid.")
    return lines
