---
name: hard-surface-bevels
description: >-
  Use for manufactured objects modelled in the 3D studio, housings, appliances, devices, furniture, panels and props with flat faces, cuts and edges: bevel widths that read as real, and shading that keeps flat faces flat round cuts and rounds.
metadata:
  stage: model surface
  domain: product props
  gate: Every edge a viewer sees catches a highlight, and every flat face shades evenly, cuts included, from the front and the three-quarter.
---

**A real edge is never sharp:** it catches a thin line of light, and a model without one reads as computer-made. Edges are rounded with blender_shape_objects (open toolkit:3d-rendering/modelling): a bevel step, then a smooth step. A part from the CAD studio is rounded in its CAD script instead, since the 3D studio refuses to round a CAD part.

**Widths as the real thing has them:** a machined or sheet-metal edge is broken by 0.2 to 0.5 mm, a moulded plastic edge rounded 0.5 to 2 mm, a wooden one 1 to 3 mm, a casting 2 mm and more. Wider reads as soft or toy-like; narrower as no bevel at all. Two or three segments suit a small round; a round wider than a few millimetres seen close takes five or more. The bevel's angle (30 degrees by default) picks the edges sharper than it, so a cylinder's many shallow edges stay as they are while its rim is rounded.

**Order the steps as the object is made:** cuts first, then the bevel, so the cut's rim is rounded too, then the smooth step. A bevel before a cut leaves the cut's rim sharp.

**Flat faces stay flat round cuts.** A boolean cut leaves long thin faces across a flat top, and smooth shading bends their light into streaks running from the cut to the edges. Weighted normals keep each flat face flat and let only the bevels curve. After the last typed step, give the object them with blender_run_script:

    obj = bpy.data.objects["Housing"]
    obj.modifiers["Bevel"].harden_normals = True
    weighted = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True

It works on the steps above it, so add it again at the end when a later typed step comes after it. After every change the answer names a flat area that shades as if curved, how far its corners lean and where: that is the streak to fix, with weighted normals or sharper edges round it.

**The smooth step replaces auto smooth.** Blender 4.1 removed auto smooth: `mesh.use_auto_smooth`, `auto_smooth_angle` and `calc_normals_split()` no longer exist, and the smooth step's angle does what they did: it adds Blender's Smooth by Angle step and keeps it last, so the edges a later cut or bevel makes are shaded by the same angle.

**Check the flow of the light** with blender_look and shading reflections: bands of a striped light that run on unbroken over a flat face and bend smoothly round a bevel; a kink or a break in them is a crease or a dent the bevel left. Its answer gives how far neighbouring faces turn from each other and where most.

**Panel lines, vents and rivets: cut or decal.** A gap that crosses the outline the camera sees, or that the camera comes close enough to see into, is geometry: cut it with a boolean, so its walls and depth show and the outline is notched. A line a few pixels wide on a face seen square on, a row of rivets, a vent or a screw head is a normal decal (blender_add_decal kind normal, or a strip with pattern groove or shape, in toolkit:3d-rendering/decals): shading alone, the surface's own material bent round it. A groove's answer says whether it runs unbroken, which open ends stop short of an edge, how wide it is in the picture and where it meets the outline, which is where a decal groove gives itself away.

**Check under light that shows edges:** a small Cycles render with the studio preset, from the three-quarter and from a low side, where a streak on a flat face or an edge with no highlight shows. blender_close_ups, in toolkit:3d-rendering/motion, looks at a corner or a cut up close.
