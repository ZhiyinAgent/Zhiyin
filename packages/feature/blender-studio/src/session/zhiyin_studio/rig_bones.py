"""
blender_rig's bones and ready rigs fitted to a body: an armature's bones set by name, edited as a list,
mirrored from one side and gathered into collections; or one of Rigify's metarigs fitted to a mesh and
its rig generated. Every bone change is answered with the bones as Blender holds them afterwards.
"""

import bpy

from . import rig_bones_edit as edit
from . import rig_bones_ready as ready
from .arguments import need
from .errors import Refused
from .rig_bones_report import armature_lines, bone_line, scene_pieces

EDITS = ("bones", "bone_edits", "symmetrize", "collections")


def apply(args):
    """The lines this part answers; none when the call gives none of its inputs."""
    editing = [k for k in EDITS if k in args]
    if "from" not in args and not editing:
        return []
    lines = []
    metarig = None
    if "from" in args:
        metarig, said = ready.fit(args["from"], args.get("armature"))
        lines += said
        obj, made = metarig, False
    if editing:
        if metarig is None:
            need("armature" in args, f"{editing[0]} changes an armature: name it with armature.")
            obj, made = edit.armature_named(args["armature"], make="bones" in args)
            source = ready.generated_from(obj)
            if source is not None:
                raise Refused(f"{obj.name} is generated from {source.name} and is made again from it: change the bones of {source.name} instead.")
        lines += changed(obj, args)
    if metarig is not None or ready.is_metarig(obj):
        target = metarig or obj
        lines += ready.generate(target)
        pieces = scene_pieces()
        outside = ready.lies_outside(target, target[ready.METARIG_OF], pieces)
        if outside:
            lines.append(f"Metarig bones partly outside {target[ready.METARIG_OF]}: {'; '.join(outside[:12])}{' …' if len(outside) > 12 else ''}.")
        if metarig is None:
            touched = [b for b in args.get("bones") or [] if isinstance(b, dict)]
            lines += [bone_line(obj, obj.data.bones[b["name"]], pieces) for b in touched if b.get("name") in obj.data.bones]
        return lines
    return lines + armature_lines(obj, made)


def changed(obj, args):
    """Applies the bone changes in order: bones, the list edits, the mirror, then the collections."""
    said = []
    with edit.Editing(obj) as editing:
        if "bones" in args:
            edit.set_bones(editing, args["bones"])
        if "bone_edits" in args:
            said += edit.edit_bones(editing, args["bone_edits"])
        if "symmetrize" in args:
            mirrored = edit.symmetrize(editing, args["symmetrize"])
            said.append(f"mirrored {len(mirrored)} bone{'s' if len(mirrored) != 1 else ''} to {', '.join(mirrored)}")
    if "collections" in args:
        edit.set_collections(obj, args["collections"])
    bpy.context.view_layer.update()
    return [f"On {obj.name}: {'; '.join(said)}."] if said else []
