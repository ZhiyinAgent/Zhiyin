"""
blender_rig's binding of meshes to their bones, and chains that reach for targets or lie along
curves. A binding says how each mesh was bound, what its weights hold, the bones that move
nothing and its pose test; each chain says what it reaches for and what the timeline shows of
it at every frame.
"""

from .arguments import need, whole
from .finding import find_objects
from .rig_bind_ik import reach
from .rig_bind_pose import pose_test
from .rig_bind_timeline import timeline_check
from .rig_bind_weights import HOW, SAID_HOW, armature_for, bind_mesh, deforming, keep_heaviest, weights_said
from .wording import listed

# The most bones a binding keeps on each point.
MOST_INFLUENCES = 16


def bind(args):
    need(isinstance(args, dict), "bind names the meshes to bind.")
    names = args.get("meshes")
    need(isinstance(names, list) and names, "bind.meshes lists the meshes to bind.")
    meshes = find_objects(names, {"MESH"})
    how = args.get("how", "automatic")
    need(how in HOW, "bind.how is automatic, envelope or rigid.")
    preserve = args.get("preserve_volume", True)
    need(isinstance(preserve, bool), "bind.preserve_volume is true or false.")
    most = whole(args["influences"], "bind.influences", minimum=1, maximum=MOST_INFLUENCES) if "influences" in args else None
    arm, found = armature_for(args, meshes)
    need(all(m != arm for m in meshes), f"{arm.name} is the armature, not a mesh to bind.")
    bones = deforming(arm)
    lines, moved = [], {}
    for mesh in meshes:
        where, earlier, parts = bind_mesh(mesh, arm, how, preserve, bones)
        volume = ", preserving volume" if preserve and how != "rigid" else ""
        head = (
            f"{mesh.name} bound to {arm.name}{found}{',' if found else ''} {SAID_HOW[how]}, its Armature step {where}{volume};"
            f" {len(bones)} bone{'s' if len(bones) != 1 else ''} deform its {len(mesh.data.vertices)} points."
        )
        if earlier:
            head += " Its earlier weights for these bones were replaced."
        lines += [head, *parts]
        if most is not None:
            lines.append(keep_heaviest(mesh, bones, most))
        said, moving = weights_said(mesh, arm, bones)
        lines += said
        moved[mesh.name] = moving
    idle = [b for b in bones if not any(b in m for m in moved.values())]
    if idle:
        lines.append(f"Bones that move nothing: {listed(idle[:24] + ([f'{len(idle) - 24} more'] if len(idle) > 24 else []))}.")
    return lines + pose_test(meshes, arm, moved)


def reaches(items):
    need(isinstance(items, list) and items, "ik lists the chains that reach.")
    lines, followed = [], []
    for i, item in enumerate(items):
        said, follow = reach(item, f"ik[{i}]")
        lines += said
        followed.append(follow)
    return lines + timeline_check(followed)


def apply(args):
    """The lines this part answers; none when the call gives none of its inputs."""
    lines = []
    if args.get("bind") is not None:
        lines += bind(args["bind"])
    if args.get("ik") is not None:
        lines += reaches(args["ik"])
    return lines
