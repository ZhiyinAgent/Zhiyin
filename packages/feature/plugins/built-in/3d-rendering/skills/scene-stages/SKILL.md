---
name: scene-stages
description: >-
  Use at the start of any 3D work in the 3D studio, a picture, a room, an asset or an animation: the stages from brief to delivery, what must hold before each next one, which toolkit each opens and which technique skill to open when.
metadata:
  stage: brief
  gate: The brief and the look asked for are written down, and the sizes as the scene's spec, before the first object is added.
  works-with: scene-building product-renders interiors-from-plans making-assets animations realistic-machines part-stages lathe-profiles subd-modelling hard-surface-bevels sculpting rigging simulations publishing/latex-typst-authoring
---

The studio's core tools are there from the start: blender_open_scene, blender_describe_scene, blender_look, blender_run_script, blender_render and blender_api. The rest come in toolkits, each opened once with open(id) when its stage begins. Go through the stages in order and pass each gate before the next; when a check fails, go back to the stage that made the fault.

**1. Brief.** Write down what is asked: the subject, its real sizes, the look, the pictures, video or files to deliver and their size. Take what is not given from what such things measure, and say it. Open the skill for the kind of work:
- skill:3d-rendering/product-renders, skill:3d-rendering/interiors-from-plans, skill:3d-rendering/making-assets or skill:3d-rendering/animations;
- a place dressed with many things, a desk, a room or a shop: skill:3d-rendering/set-dressing and skill:3d-rendering/making-assets, since each thing in it is an asset;
- anything with parts that fit, carry a load or move is designed in the CAD studio first (skill:3d-rendering/part-stages).

Write the sizes as the scene's spec, requirements.json beside the scene file: each part's real size, thickness and reach as ranges, how the parts sit together, and what the camera must see (doc:3d-rendering/spec). Then blender_open_scene; every change from here is measured against the spec, and the answer says what fails.

Gate: the spec is written and reads without a refusal.

**2. Block-out.** Open toolkit:3d-rendering/modelling. Put each main object in as a plain shape at its real size and place, a stand-in that the next stage replaces with the object itself, with rest_on for what stands on something, and a rough camera (toolkit:3d-rendering/light-and-camera). Read blender_describe_scene: every size, bottom and top, and what goes into what; blender_look shows the four sides. Where a box hides how close two shapes come, a gap, a clearance or a part that must pass another, blender_measure (toolkit:3d-rendering/measure) measures surface to surface.

Gate: every size in the spec holds, nothing floats or sinks, and a quick EEVEE render frames the subject. The first time the sizes hold, the person is shown the block-out and may step in; carry on unless they do, and take in what they say before modelling.

**3. Model.** Model each object the way a Blender artist would make the real one, with all of Blender, not only its primitives. Before shaping one, name its parts and the details that make it read as itself, and the operation that makes each: a teapot's spout growing from its body and the knob on its lid, a bicycle's tubes tapering into their joints, a sofa's cushions with their piped seams.

Blender's modelling is all here:
- the shape kinds of blender_add_objects: revolve profiles, tubes along points, outlines with a height, text;
- the steps of blender_shape_objects: bevel, subdivision, solidify, array, mirror, booleans and Blender's other modifiers;
- in blender_run_script, the edits an artist makes by hand on chosen faces, edges and loops: zhiyin.extrude, inset, bevel, bridge, loop_cut, scale, rotate, delete, dissolve, merge and fill, with bmesh, curves and geometry nodes where they suit.

A form no shape kind gives, a handle, a chair's back, a fork's tines, a leaf, is modelled in a script with those edits, and that is the ordinary way to make it, not a last resort. Detail goes where the camera looks: what is seen close up gets its edges, seams and small parts, and what is far off can stay simple.

Open the technique skill the shape needs: skill:3d-rendering/lathe-profiles for turned things, skill:3d-rendering/subd-modelling for soft forms, skill:3d-rendering/hard-surface-bevels for machined and moulded edges, skill:3d-rendering/sculpting for faces, creatures and worn or eroded forms. Many copies over a surface, stones, plants or props, are scattered with blender_scatter (toolkit:3d-rendering/scatter); a pile or a heap that must look fallen is dropped with blender_simulate (toolkit:3d-rendering/simulate) and kept where it rests, and cloth that drapes is draped the same way (skill:3d-rendering/simulations).

Gate: in blender_look, each object reads as itself by its outline from the front and the three-quarter, and its counts show every mesh meant to be closed is, with no face pointing inward. The answers of blender_describe_scene, blender_look and blender_render name the objects still as they were added, the meshes with sharp edges and the parts pushed into the object they belong to: each one left in the first two is as plain or as sharp as the real thing, a sheet of paper or a tile, and each part left pushed in is a separate piece in the real thing too.

**4. Surface.** Open toolkit:3d-rendering/surfacing. Give each object its material or finish; a finish brings its own colour and roughness. A label, a logo, a sticker or stitching goes on with blender_add_decal (toolkit:3d-rendering/decals). A picture that must lie on a surface without stretching, and any bake, needs the surface laid flat first with blender_unwrap (toolkit:3d-rendering/unwrap); blender_bake (toolkit:3d-rendering/bake) turns materials, or a detailed copy's shape, into texture maps for a model that leaves Blender.

Gate: in a small Cycles render, each material reads as the real one, and the render's colour readout matches what was asked.

**5. Light and frame.** In toolkit:3d-rendering/light-and-camera, choose the lighting preset or surroundings and set the camera, lens and margin.

Gate: no surface is lit past its colour (the Cycles render's answer says), and the subject fills the frame as asked.

**6. Motion**, only when something moves. Open toolkit:3d-rendering/motion and skill:3d-rendering/animations. Key the part that drives, let the rest follow, and read blender_frame_sheet; blender_close_ups looks at joints and contacts up close. A character or a creature that bends is rigged first (skill:3d-rendering/rigging, toolkit:3d-rendering/rig); what falls, drapes or pours is simulated (skill:3d-rendering/simulations) and baked before the video.

Gate: the frame sheet shows nothing passing through anything, jumping or floating, at the keys and between them.

**7. Render and deliver.** blender_render for pictures, in Cycles for the final ones; blender_render_video, in the motion toolkit, for a video; toolkit:3d-rendering/output for model files with blender_export.

A document that gathers the work, such as a report, a manual, a datasheet or a catalogue of the drawings and pictures, is written in Typst and compiled to PDF with compile_document, from the publishing plugin: open skill:publishing/latex-typst-authoring.

Gate: each file the answer names was written by the call that answered for it.

**8. Check, before the final answer.**
- Look at the result from at least two sides with blender_look, such as the front and the three-quarter, when you can see pictures, and at the final renders from two sides.
- List every flaw against the brief, each one named in an earlier look included. Fix each at the stage that made it, or say it in the answer.
- Say where each file is, and of each only what the call that wrote it answered.
- Give each picture as a link to its file, such as [the render](renders/front.png): pictures are not drawn in an answer.

Gate: every flaw the last look found is fixed or said in the answer.
