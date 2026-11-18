/** The 3D studio's page on binding meshes to bones and chains that reach. */

import { percent, statedNumbers } from "./stated-numbers.js";
import type { WrittenPage } from "./written-pages.js";

const rig = statedNumbers.rig;

export const bindingPage: WrittenPage = {
  id: "doc:3d-rendering/binding",
  title: "3D rigging: binding meshes to bones, and limbs that reach",
  summary:
    "How blender_rig's bind puts meshes on an armature's bones and what its weights and pose test measure, and how ik makes chains reach for targets or lie along curves, checked at every frame.",
  terms: [
    "blender_rig",
    "bind",
    "weights",
    "automatic weights",
    "envelope",
    "rigid",
    "preserve volume",
    "influences",
    "pose test",
    "ik",
    "pole",
    "pole angle",
    "spline ik",
    "stretch",
    "knee flip",
  ],
  text: [
    "bind puts each mesh on the armature's deforming bones: an Armature step goes first in its steps, after any mirror, and the mesh is attached to the armature, so it moves with it. The armature is the one named, else the rig the same call made or fitted to one of the meshes, else the scene's only armature; with several and none named, the call is refused naming them. Weights are worked out with the armature at rest, whatever its pose.",
    "- automatic (default): Blender's heat weights, each point weighted by the bones nearest it that it can see from inside the mesh. A loose part far from every bone takes the nearest.",
    "- envelope: by each bone's envelope, its radius at head and tail and its distance; a point outside every envelope gets no weight.",
    "- rigid: each loose part of the mesh moves whole with one bone, the one whose length runs inside it furthest, else the nearest, as a robot's plates or a jointed toy. The answer names each part by where it is, its points, its bone and how it was chosen.",
    "preserve_volume (true by default) bends by dual quaternions, so an elbow or a knee keeps its thickness rather than thinning to a crease; rigid binding needs none. influences keeps at most so many bones on each point, the heaviest, their weights summing to 1: a game engine keeps 4. Binding again replaces the earlier weights of the same bones.",
    "",
    `After binding, the answer says: points with no weight and where, which stay put when the bones move; points on more than ${rig.engine_most} bones and the most on one; bones that move nothing. Then a pose test on a copy of the rig at rest, without its constraints or motion: each bone that moves points and hangs from another is turned ${rig.pose_turn}° each way about its own x axis, as Blender's bones bend, and the mesh's steps up to its Armature step are measured. For each joint that loses or gains more than ${percent(rig.pose_kept_share)} of the volume within ${percent(rig.pose_near_share)} of its shorter bone, or whose surface newly goes through itself, it gives the volume lost or gained, as a share of the volume near the joint and in litres, and the new self-crossings, pairs of faces passing through each other, with one place. On a closed mesh the loss is the change in the mesh's own volume. The test stops after ${rig.pose_seconds} s, or half of what is left of the call's time, naming the joints it left.`,
    "",
    `ik makes a chain of bones reach. bone is the chain's last bone; chain counts its bones, the last included, ${rig.target_chain} by default (a thigh and a shin). target is the object the tip reaches for; one not in the scene is made, an empty at the tip attached to the armature, ready to key with blender_animate. pole is the object the bend points to, a knee forward, an elbow back; one not in the scene is made on the side the chain bends now, a chain's length out. The pole angle is worked out so the chain keeps the pose it has, and the answer says how far, as set, the chain turns from it. Without a pole nothing holds the side a chain bends to, and a straight chain may bend either way: give a joint a slight bend first. stretch lets bones stretch past their length to reach.`,
    "curve in place of target is Spline IK: the chain lies along the curve from its start, every bone to the root by default. Each bone keeps its length, so a chain shorter than the curve covers only its first part, as the answer says; with stretch, each bone stretches or shrinks to fit the whole curve. A chain along a curve takes no pole.",
    "",
    "Each chain is then checked at every frame of the timeline, every few past 360: where its tip falls short of its target and by how much, with the target's distance from the chain's root against its length; where its bend turns to the other side from where it bends at rest (measured against the bone it hangs from), or jumps more than 90° between frames, a knee or an elbow flipping; and where its bones stretch past their length. A chain along a curve says where it lies off its curve. Times are in seconds from the timeline's start.",
  ].join("\n"),
};
