---
name: simulations
description: >-
  Use when things in a 3D scene must fall, pile, tumble, drape, hang, pour or slosh as real ones do, for a still or an animation: rigid bodies, cloth, liquids, geometry nodes simulation zones, and baking them.
metadata:
  stage: model animate render check
  domain: physics simulation
  gate: Every simulation comes to rest or runs as planned within the timeline, its answer shows nothing passing through anything, and it is baked before a video is rendered.
  works-with: scene-stages animations
---

Simulate like an effects artist who reads the numbers before watching the result. The tools are blender_simulate, in toolkit:3d-rendering/simulate, and blender_animate for the timeline's length, in toolkit:3d-rendering/motion.

**Build every object at its real size first:** physics works in metres, kilograms and seconds, so a cup made ten times too big falls as slowly as a car.

**Rigid bodies**, for things that fall, stack, tumble or are pushed: rigid with groups. What moves is active, weighed by a density or a material, or by a mass when its shape is not closed. What holds still, a floor, a table or a shelf, is passive. A paddle or a door that pushes is animated, keyed first. Anything hollow that holds something, a bowl, a cup or a crate, takes shape mesh; otherwise what lies inside it starts inside its outline and is refused. Start the bodies apart, a few millimetres above what they will land on, never inside it.

The rigid bodies' answer gives when each body comes to rest, what it rests on and where; one still moving at the end needs a longer timeline. For a still, then settle keeps where they came to rest; for an animation or an export, then to_keys keys the motion. Both remove the physics, so the result stays as it was.

**Cloth**, for a curtain, a flag, a bed sheet, a cushion or a garment: cloth with the mesh, its fabric and its colliders. A cloth folds only as finely as its grid: subdivide_to about half the size of the smallest fold you want, about 20 mm for a bed sheet; a cloth of more than 25,000 points is refused. Pin what holds it, a curtain's top edge or a flag's side; pressure inflates a cushion; sew pulls panels together. For a still, drape runs it until it rests and keeps that shape. Read the answer: when it came to rest, how far it rests off each collider, how much it stretched, and whether any of it crossed itself or went into a collider. Fix a crossing or a cloth inside a collider with a finer grid or a thicker collider, never by hiding it.

**Liquids**, for a glass filling, a pour or a splash: liquid with the container and the sources. Start at the draft resolution and look at the result before raising it: bake time grows steeply with resolution. Before the bake, the answer warns of walls thinner than the voxel can hold, which leak; raise the resolution it names. After the bake, check that the volume holds over time and that nothing lies outside the container, then render in Cycles.

**Simulation zones**, for anything a node tree must carry from frame to frame: growth, trails, particles of your own, a counter. Build the zone in blender_run_script with the exact node and socket names in doc:3d-rendering/simulation-zones. Scale every rate by Delta Time, so motion is the same at any frame rate, and use Skip to pause the zone. Then bake it, and read the point count at each frame and whether every position stays finite. A state that grows without bound blew up: find the multiplication that compounds each step.

**Soft bodies and particles**, made in a script: give them what they meet with colliders, which places each collider's collision after whatever deforms it and sizes its thickness from the finest cloth or soft-body spacing.

**Baking.** blender_simulate with bake true bakes every simulation in the scene over the timeline, in the order one feeds another, and keeps the result in the scene file or in this conversation's own folder. Then read each cloth, soft body and particle system's check:
- a top speed past what a fall through the scene reaches means it blew up;
- a box that grew means it flew apart;
- points inside a collider mean the collider needs more thickness or the simulation more steps.

**Bake before rendering a video,** and again after any change to a simulated object, its colliders or the timeline: blender_describe_scene says each bake's frames against the scene's, and a video that would show a simulation unbaked or short of its frames is refused. Blender does not mark a bake outdated when what it meets changes: bake again yourself. Caches that live beside the scene file, such as dynamic paint's or a liquid domain Zhiyin did not make, are left as they are; the answer says which and how to bake them in a script.

**Check each simulation with blender_frame_sheet:** frames side by side, with frames a few tens of milliseconds apart around each impact. Look for a body that passes through another, sinks into the floor or jitters at rest, and cloth that pokes through. A body resting flat may still jitter slightly at the end; for a still, settle keeps it where it is.
