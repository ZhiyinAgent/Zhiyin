"""
blender_rig's ready rigs: one of Rigify's metarigs made, its joints moved onto a body mesh where the body's
sections place them, and Rigify's rig generated from it. The rig keeps the metarig's place and turn, its
widget shapes stay out of the scene, and the metarig is kept hidden: moving its bones generates the rig
again. The rig names the mesh it was fitted to in its `zhiyin_rig_of` property.
"""

import importlib

import addon_utils
import bpy
import mathutils

from . import rig_bones_landmarks as landmarks
from .arguments import need
from .errors import Refused
from .finding import find_object, link, scene
from .mesh_math import to_segment
from .rig_bones_body import Body
from .tolerances import BONE_OUT
from .wording import length, point_text

# Each kind of ready rig: Rigify's metarig module, and how its body is measured.
KINDS = {
    "human": ("human", landmarks.biped),
    "basic_human": ("Basic.basic_human", landmarks.biped),
    "quadruped": ("Basic.basic_quadruped", landmarks.creature),
    "cat": ("Animals.cat", landmarks.creature),
    "wolf": ("Animals.wolf", landmarks.creature),
    "horse": ("Animals.horse", landmarks.creature),
    "bird": ("Animals.bird", landmarks.creature),
    "shark": ("Animals.shark", landmarks.creature),
}
# What a rig, its metarig and the mesh they fit are to one another, kept on the objects.
# A limb bent less than this at a joint, in radians, is straight there.
STRAIGHT = 0.035
# How far a straight limb's joint is moved to bend it, as a share of the limb's length across it.
BEND = 0.03
RIG_OF = "zhiyin_rig_of"
METARIG_OF = "zhiyin_metarig_of"
LEGS = {"limbs.leg", "limbs.paw", "limbs.front_paw", "limbs.rear_paw"}
ROLES = {
    "biped leg": ("hip", "knee", "ankle"),
    "front leg": ("shoulder", "elbow", "wrist"),
    "hind leg": ("hip", "knee", "hock"),
    "arm": ("shoulder", "elbow", "wrist"),
}


def rigify():
    """Rigify's generator, its add-on turned on for this session when it is not."""
    if not addon_utils.check("rigify")[1]:
        addon_utils.enable("rigify", default_set=True, persistent=False)
    need(addon_utils.check("rigify")[1], "Blender's Rigify add-on could not be turned on in this session.")
    return importlib.import_module("rigify.generate")


def connected_chain(bone):
    """A bone and the bones connected after it, one each, to where it ends or branches."""
    chain = [bone]
    while True:
        nxt = [c for c in chain[-1].children if c.use_connect]
        if len(nxt) != 1:
            return chain
        chain.append(nxt[0])


class Chain:
    """A limb of the metarig: its bones, the keys of its joints, where the metarig has them, and their names."""

    def __init__(self, bones, meta, kind, front=False):
        self.bones = [b.name for b in bones]
        self.meta = [mathutils.Vector(p) for p in meta]
        side = "L" if self.meta[-1].x > 0 else "R"
        self.side_word = "left" if side == "L" else "right"
        self.is_front = front
        self.kind = kind
        self.leg_word = f"{self.side_word} {'front' if front else 'hind'} leg" if kind in ("front leg", "hind leg") else f"{self.side_word} {kind.split()[-1]}"
        roles = ROLES.get(kind, ("root", "elbow", "wrist"))
        count = len(self.meta)
        self.roles = [roles[i] if i < len(roles) else f"joint {i + 1}" for i in range(count - 1)] + ["tip"]
        self.keys = [f"{self.bones[i]}:head" for i in range(count - 1)] + [f"{self.bones[-1]}:tip"]

    def share(self, i):
        """How far along the limb, root to tip, its joint `i` is in the metarig."""
        steps = [(self.meta[k + 1] - self.meta[k]).length for k in range(len(self.meta) - 1)]
        return sum(steps[:i]) / max(sum(steps), 1e-9)


class Metarig:
    """A metarig's shape as the measures need it: its height, length, width, limbs and spine keys."""

    def __init__(self, obj, family):
        bones = obj.data.bones
        types = {b.name: obj.pose.bones[b.name].rigify_type for b in bones}
        points = [p for b in bones for p in (b.head_local, b.tail_local)]
        self.height = max(p.z for p in points)
        self.front = min(p.y for p in points)
        self.length = max(p.y for p in points) - self.front
        self.width = max(p.x for p in points) - min(p.x for p in points)
        self.points = {}
        self.legs, self.arms = [], []
        wide = max(abs(p.x) for p in points)
        for bone in bones:
            kind = types[bone.name]
            chain = connected_chain(bone)
            tip = chain[-1].tail_local
            # A leg stands on the ground from a joint well up the body; toes and claws lie on the ground.
            if kind in LEGS and tip.z < 0.06 * self.height and bone.head_local.z > 0.25 * self.height:
                self.legs.append(chain)
            # An arm, or a wing reaching out far to the side.
            elif kind == "limbs.arm" or (kind == "limbs.simple_tentacle" and len(chain) >= 3 and abs(tip.x) > 0.5 * wide):
                self.arms.append(chain)
        tips = [c[-1].tail_local.y for c in self.legs]
        middle = sum(tips) / len(tips) if tips else 0.0
        made = []
        for chain in self.legs:
            meta = [b.head_local for b in chain[:-1]] + [chain[-1].tail_local]
            front = chain[-1].tail_local.y < middle and len(self.legs) == 4
            kind = "front leg" if front else "hind leg" if len(self.legs) == 4 else "biped leg"
            made.append(Chain(chain, meta, kind, front))
        self.legs = made
        made = []
        for chain in self.arms:
            out = chain[0].head_local
            way = (chain[-1].tail_local - out).normalized()
            farthest = max((p for b in [chain[-1], *chain[-1].children_recursive] for p in (b.head_local, b.tail_local)), key=lambda p: (p - out).dot(way))
            meta = [b.head_local for b in chain] + [farthest]
            made.append(Chain(chain, meta, "arm" if types[chain[0].name] == "limbs.arm" else "wing"))
        self.arms = made
        for chain in [*self.legs, *self.arms]:
            for key, point in zip(chain.keys, chain.meta):
                self.points[key] = point
        self.spine = {}
        for bone in bones:
            kind = types[bone.name]
            chain = connected_chain(bone)
            if kind == "spines.basic_spine":
                self.spine["hips"] = self.key(f"{bone.name}:head", bone.head_local)
            elif kind == "spines.super_head":
                if family is landmarks.biped:
                    self.spine["neck"] = self.key(f"{chain[min(1, len(chain) - 1)].name}:head", chain[min(1, len(chain) - 1)].head_local)
                    self.spine["head_top"] = self.key(f"{chain[-1].name}:tail", chain[-1].tail_local)
                else:
                    self.spine["neck_base"] = self.key(f"{chain[0].name}:head", chain[0].head_local)
                    self.spine["head_base"] = self.key(f"{chain[-1].name}:head", chain[-1].head_local)
                    self.spine["head_tip"] = self.key(f"{chain[-1].name}:tail", chain[-1].tail_local)
            elif kind == "spines.basic_tail" and family is not landmarks.biped:
                self.spine["tail_tip"] = self.key(f"{chain[-1].name}:tail", chain[-1].tail_local)
        order = ["tail_tip", "hips", "neck_base", "head_base", "head_tip"] if family is not landmarks.biped else ["hips", "neck", "head_top"]
        run = [self.spine[k] for k in order if k in self.spine]
        self.segments = list(zip(run, run[1:]))
        for chain in [*self.legs, *self.arms]:
            self.segments += list(zip(chain.keys, chain.keys[1:]))

    def key(self, name, point):
        self.points[name] = mathutils.Vector(point)
        return name

    def meta(self, key):
        return self.points[key]


def similarity(a, b, a2, b2):
    """The turn, scale and move that take the segment a-b onto a2-b2."""
    old, new = b - a, b2 - a2
    turn = old.normalized().rotation_difference(new.normalized()) if old.length > 1e-9 and new.length > 1e-9 else mathutils.Quaternion()
    scale = new.length / old.length if old.length > 1e-9 else 1.0
    return lambda p: a2 + turn @ ((p - a) * scale), turn


def fitted(rig, found, obj):
    """Moves every bone of the metarig onto the body, each end by the segment between joints nearest it."""
    keys = {k: found.joints[k].point for k in rig.points if k in found.joints}
    segments = [(rig.meta(a), rig.meta(b), *similarity(rig.meta(a), rig.meta(b), keys[a], keys[b])) for a, b in rig.segments if a in keys and b in keys]
    need(segments, "No joint of the body could be measured to fit the metarig to.")

    # A point on the middle plane moves with the spine, never with one side's limb.
    middle = [s for s in segments if abs(s[0].x) < 1e-4 and abs(s[1].x) < 1e-4] or segments

    def place(p):
        a, b, move, turn = min(middle if abs(p.x) < 1e-4 else segments, key=lambda s: to_segment(p, s[0], s[1]))
        return move(p), turn

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        # Every end is placed from where the metarig had it: a connected bone's head moves with its parent's tail.
        was = {b.name: (b.head.copy(), b.tail.copy(), b.z_axis.copy()) for b in obj.data.edit_bones}
        for bone in obj.data.edit_bones:
            head, tail, axis = was[bone.name]
            (head, turn), (tail, _) = place(head), place(tail)
            if (tail - head).length < 1e-5:
                continue
            bone.head, bone.tail = head, tail
            bone.align_roll(turn @ axis)
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")


def make_metarig(kind, name, body):
    module = importlib.import_module("rigify.metarigs." + KINDS[kind][0])
    need(bpy.data.objects.get(name) is None, f"An object named “{name}” already exists: name the rig with armature, or remove it.")
    obj = link(bpy.data.objects.new(name, bpy.data.armatures.new(name)))
    obj.matrix_world = body.matrix()
    for other in bpy.context.view_layer.objects.selected:
        other.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    module.create(obj)
    if obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def fit(spec, rig_name):
    """
    Makes the metarig of the kind asked, fitted to the body mesh named; the metarig and the lines saying
    each joint, what it was fitted to and what was not found.
    """
    need(isinstance(spec, dict), "from is a ready rig: its kind and the mesh to fit it to.")
    kind = spec.get("kind")
    need(kind in KINDS, f"from.kind is one of {', '.join(KINDS)}.")
    mesh = find_object(spec.get("fit_to"), {"MESH"})
    rigify()
    body = Body(mesh, spec.get("facing", "-y"))
    rig_name = rig_name or f"{mesh.name} rig"
    obj = make_metarig(kind, metarig_name(rig_name), body)
    family = KINDS[kind][1]
    shape = Metarig(obj, family)
    found = family(body, shape)
    scale = body.height / shape.height
    middle = shape.front + shape.length / 2
    for key, point in shape.points.items():
        if key not in found.joints:
            found.put(key, (point.x * scale, (point.y - middle) * scale, point.z * scale), "by proportion of the height, as the metarig has it")
    keep_bends(shape, found)
    fitted(shape, found, obj)
    obj[METARIG_OF] = mesh.name
    obj.data.rigify_rig_basename = rig_name
    lines = [f"Fitted Rigify's {kind} metarig to {mesh.name} ({length(body.height)} tall, its front toward {body.facing}) as {obj.name}. Its joints, to confirm with blender_look:"]
    for chain in [*shape.legs, *shape.arms]:
        for role, key in zip(chain.roles, chain.keys):
            lines.append(joint_line(f"{role} of the {chain.leg_word}", key, found, body))
    for role, key in shape.spine.items():
        lines.append(joint_line(role.replace("_", " "), key, found, body))
    if found.missing:
        lines.append(f"Not found on the body, so placed by the metarig's proportions: {'; '.join(dict.fromkeys(found.missing))}.")
    return obj, lines


def keep_bends(rig, found):
    """
    A limb measured straight at a joint is bent there as the metarig bends it, scaled to the limb: Rigify
    finds which way a knee or an elbow bends from the bend, and a straight limb has none.
    """
    for chain in [*rig.legs, *rig.arms]:
        for i in range(1, len(chain.keys) - 1):
            a, b, c = (found.joints[chain.keys[k]].point for k in (i - 1, i, i + 1))
            if (b - a).length < 1e-6 or (c - b).length < 1e-6 or (b - a).angle(c - b) > STRAIGHT:
                continue
            ma, mb, mc = chain.meta[i - 1], chain.meta[i], chain.meta[i + 1]
            line = mc - ma
            if line.length < 1e-9 or (c - a).length < 1e-9:
                continue
            off = (mb - ma) - line * ((mb - ma).dot(line) / line.length_squared)
            turn = line.normalized().rotation_difference((c - a).normalized())
            push = turn @ off
            if push.length < 1e-9:
                continue
            push = push.normalized() * min(push.length * (c - a).length / line.length, BEND * (c - a).length)
            joint = found.joints[chain.keys[i]]
            joint.point = b + push
            joint.how += f"; moved {length(push.length)} the way the metarig's {chain.roles[i]} bends, as Rigify needs a bend to know it"


def metarig_name(rig_name):
    """The metarig of a rig named "Body rig" is "Body metarig"; of one named "Hero", "Hero metarig"."""
    return f"{rig_name[: -len(' rig')] if rig_name.endswith(' rig') else rig_name} metarig"


def joint_line(role, key, found, body):
    bone, end = key.split(":")
    where = f"{bone}'s {end}" if end != "tip" else f"past {bone}, its farthest point"
    joint = found.joints[key]
    return f"- {role} ({where}) at {point_text(body.world(joint.point))}: {joint.how}."


def is_metarig(obj):
    return obj.type == "ARMATURE" and bool(obj.get(METARIG_OF))


def generated_from(obj):
    """The metarig a generated rig was made from, or None."""
    for other in scene().objects:
        if other.type == "ARMATURE" and other is not obj and getattr(other.data, "rigify_target_rig", None) == obj:
            return other
    return None


def generate(metarig):
    """Generates (or generates again) the rig from a metarig; the lines saying what it made."""
    generator = rigify()
    again = metarig.data.rigify_target_rig is not None
    metarig.hide_set(False)
    metarig.hide_viewport = False
    for other in bpy.context.view_layer.objects.selected:
        other.select_set(False)
    bpy.context.view_layer.objects.active = metarig
    metarig.select_set(True)
    try:
        generator.generate_rig(bpy.context, metarig)
    except Exception as error:
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        raise Refused(f"Rigify could not generate a rig from {metarig.name}: {error}") from None
    rig = metarig.data.rigify_target_rig
    rig.matrix_world = metarig.matrix_world.copy()
    rig[RIG_OF] = metarig[METARIG_OF]
    widgets = metarig.data.rigify_widgets_collection
    if widgets is not None:
        widgets.use_fake_user = True
        for holder in [scene().collection, *bpy.data.collections]:
            if widgets.name in holder.children:
                holder.children.unlink(widgets)
    metarig.hide_set(True)
    metarig.select_set(False)
    bones = rig.data.bones
    deform = [b for b in bones if b.use_deform]
    collections = list(rig.data.collections_all)
    lines = [
        f"{'Generated again' if again else 'Generated'} {rig.name} from {metarig.name}: {len(bones)} bones, {len(deform)} of them deforming (the DEF- bones), in {len(collections)} bone collections; "
        f"its {RIG_OF} is {rig[RIG_OF]}. {metarig.name} is hidden: move its bones with bones and armature {metarig.name}, and the rig is generated again."
    ]
    bound = [o.name for o in scene().objects if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    if again and bound:
        lines.append(f"{', '.join(bound)} {'is' if len(bound) == 1 else 'are'} bound to {rig.name} with weights from before: bind again to weight the new joints.")
    return lines


def lies_outside(metarig, mesh_name, pieces):
    """
    The metarig's bones with a part outside the mesh they were fitted to, taking its pieces together, and
    how far out: the face's bones and the heels, which lie on the surface, are left out.
    """
    own = [p for p in pieces if p.obj.name == mesh_name]
    if not own:
        return []
    skipped = set()
    for bone in metarig.data.bones:
        if metarig.pose.bones[bone.name].rigify_type.startswith("faces.") or bone.name.startswith("heel"):
            skipped |= {bone.name, *(b.name for b in bone.children_recursive)}
    said = []
    for bone in metarig.data.bones:
        if bone.name in skipped:
            continue
        head, tail = metarig.matrix_world @ bone.head_local, metarig.matrix_world @ bone.tail_local
        out = []
        for share, part in ((0.0, "head"), (0.5, "middle"), (1.0, "tail")):
            point = head.lerp(tail, share)
            gap = min(p.gap(point) for p in own)
            if gap > BONE_OUT and not any(p.holds(point) for p in own):
                out.append(f"its {part} {length(gap)} out")
        if out:
            said.append(f"{bone.name}: {', '.join(out)}")
    return said
