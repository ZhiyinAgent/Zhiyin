---
name: rigging
description: >-
  Use when a character, a creature or a jointed thing such as a robot arm or a puppet must be posed or animated with bones in the 3D studio: making or fitting a rig, binding the mesh to it, limbs that reach, and checking how it bends.
metadata:
  stage: model animate check
  domain: rigging character
  gate: Every point of the mesh moves with a bone, and the pose test bends each joint without losing volume or the surface passing through itself.
  works-with: scene-stages animations sculpting
---

Rig like a rigger who checks every joint by bending it. The tools are blender_rig, in toolkit:3d-rendering/rig, and blender_animate for the poses and motion, in toolkit:3d-rendering/motion.

**Model the body first,** in a rest pose that leaves room at the joints: standing on its lowest point, z up, x across it with its left at +x, its front toward -y, arms out and a little down, legs a little apart, elbows and knees a little bent. A joint bends only as smoothly as its mesh: give each elbow, knee, wrist, shoulder and hip a few edge loops round it, and keep the body one closed mesh, or closed pieces that overlap where they join.

**For a person or an animal, fit a ready rig:** blender_rig with from, kind human, basic_human (no face or fingers), quadruped, cat, wolf, horse, bird or shark, and fit_to the body. Each joint is measured on the body's sections, and the answer says which were fitted to a narrowest section and which were placed by proportion. Look at the rig against the body with blender_look before binding: a joint placed by proportion is a guess, and a hip or a shoulder in the wrong place bends wrong however good the weights are. Move a joint by giving the metarig its new head or tail; the rig is generated again.

**For a mechanism, a robot or a toy, make the bones yourself** with bones, one per moving part, each from its pivot to where the part ends, parented as the parts hang from each other; symmetrize mirrors one side onto the other.

**Bind with bind.** automatic suits one skin over the whole body; rigid suits parts that move whole, as a robot's armour panels or a jointed toy; keep preserve_volume on so elbows and knees keep their thickness. For a game, influences 4.

**Read the bind's answer:**
- points with no weight stay behind when the body moves;
- a bone that moves nothing is in the wrong place or should not deform;
- the pose test bends each joint 60° each way and says where volume is lost and where the surface goes into itself.

Fix these at their cause: a joint moved to the pivot, loops added round a joint that collapses, a piece that does not reach a bone joined to the body. Then bind again.

**Limbs that reach for something take ik:** the chain's last bone, the chain length (2 for a thigh and shin, or an upper arm and forearm), a target to reach, and a pole the bend points to, in front of a knee and behind an elbow. The answer checks every frame for a tip that falls short, a bend that flips side, and bones that stretch. A tail, a spine or a cable lies along a curve with ik's curve.

**Pose and animate with blender_animate:** a bone's rotation, location or IK reach as keys, poses saved by name and keyed by name, as skill:3d-rendering/animations says for timing. Check the motion with blender_frame_sheet and the joints up close with blender_close_ups. Export a rigged model with blender_export, in toolkit:3d-rendering/output, naming the rig, which brings the meshes bound to it: a .glb carries the bones, the weights and the keys.
