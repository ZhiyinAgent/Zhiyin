---
name: mechanical-design
description: Use when designing something mechanical, made of parts that fit together, carry a load or move — a machine, mechanism, device, tool, vehicle or rig, from a latch or a clamp to a winch, a pump, an engine or a robot arm — or one part that must fit others; and when such a design is to be shown, animated, drawn or made, even when only a picture of it is asked for.
metadata:
  stage: requirements sketch features check drawing export
  domain: mechanical machine
  gate: Every subsystem builds clean in CAD, its requirements hold and its motion clears over a whole cycle, before it is shown or drawn.
  works-with: part-stages cad-feature-order printable-parts realistic-machines scene-building animations publishing/latex-typst-authoring
---

Design it as a mechanical engineer would: the job first, then the layout, then the parts, each checked against the others before anything is shown or drawn. The CAD studio holds the design; the 3D studio shows it.

**Choose the tool by what decides the shape.**
- Parts whose sizes decide whether they fit, carry their load or move as they should are designed in the CAD studio with cad_build: frames, shafts, housings, brackets, linkages, gears.
- Things judged by how they look, such as scenery, organic shapes, decoration or a room's dressing, are built in the 3D studio directly.
- A design often needs both: the mechanism in CAD, its setting in Blender.
- A machine asked for only as a picture or a video is still designed in CAD and shown in Blender: modelled in Blender alone, its parts cannot be checked to fit, nor drawn true.

**Clarify the job.** Write down what it must do, in numbers: what goes in and what comes out (a load, a speed, a power, a flow), the space it has, what it attaches to, how it will be made (printed, machined, cut, bought) and how many. Ask the person only for what decides the design; take the rest from what such things usually are, and say what you assumed.

**Write the requirements file.** Put the numbers that can be measured on the parts into a requirements.json beside the design's scripts, in the kinds cad_build checks (a size, a fit in a box, a hole, a clearance, parts kept apart, a wall, an overhang, a draft, a mass), each with the person's words in says. Every cad_build of the design is then checked against it, says which hold and how much margin each has left, and shows a change that eats into one. Keep it as the person's needs change, never to make a check pass: a requirement that fails and cannot be met stays, and the answer says which and why. Write in it too the real proportions that matter, such as the overall length to width and height, or a wheel's or a bore's diameter, from what such things measure, rather than guessing them.

**Break it down.** Split the job into the functions it needs and the subsystems that do them: where power or motion comes in, how it is carried and changed, what holds everything in place, what it drives, what encloses or protects it. Choose how each works and size it from a rough calculation: a ratio from the speeds wanted, a shaft from its torque, a beam or a wall from its load and material. Use parts people buy wherever one exists (bearings, motors, springs, belts, fasteners), at their catalogue sizes, and design only what has to be made. Set the stages out with update_plan before modelling, so the person sees the route.

**Lay it out first.** Put the design's key numbers in one workspace file, such as `layout.py`: the main sizes, where each axis and mounting face lies, the clearances, and each place where two parts meet, all named. Every part takes its sizes from there, so a change to the design is a change of one number, and two parts that meet agree on where.

**Put the motion in the layout too.** For each part that moves, write a function of the driving part's angle or travel that gives its place and turn from the design's geometry, such as a piston's height from the crank's angle, a follower's lift from its cam's, or a link's swing from the crank that works it. The assembly places moving parts by these functions, the checks run them over a cycle, and the animation is keyed from them, so what is checked is what is shown.

**Model each part on its own.** Give each part, or each family of alike parts, its own workspace module: a function that builds it from the layout's numbers, in its own coordinates, with the axis it turns or slides on through its origin, along x, y or z.

**Bought parts come at their catalogue size,** named for what they are. bd_warehouse holds bolts, nuts, washers, bearings, flanges, pipes, gears and sprockets to standard, and cad_api says what each takes. The holes for a screw, a nut or a heat-set insert are cut from the fastener itself with ClearanceHole, TapHole and InsertHole (skill:3d-rendering/printable-parts), and a bearing's seat with PressFitHole. What it lacks is a solid of its catalogue envelope, a motor its body and shaft.

**Shape a made part as it is made,** with the helpers cad_build gives:
- a casting raised with cast, drafted and rounded, with boss, pad and rib standing on it and round_edges after its cuts;
- bolts with bolt_circle or bolt_row, holes and all;
- pipes with pipe, springs with coil, hoses between ports with hose, belts round their pulleys with belt.

The helpers never fail the build where the kernel refuses what is asked: they do what can be done, and the answer says what they left, and where. Open skill:3d-rendering/realistic-machines when the machine is to be shown as the real thing.

**A part is one piece as it is made.** A pin, a bolt, a sleeve, a bearing or a spring is a part of its own, shown on its own, never joined into the part it sits in, so a cut made in one never takes away the other and the overlap check says whether it sits where it should.

**Pattern alike parts.** Many alike parts, such as blades, teeth, spokes or bolts, are one shape made once and patterned: build one, then place its copies round their axis or along their row in the module that makes them, never each by hand; a few hundred lofted blades build in under a minute. Within a part, cut its hollows before adding what stands in them, such as bosses or ribs, and look inside it with a section in cad_build's sections. Open skill:3d-rendering/printable-parts for walls, holes, fillets, clearances and gears, and skill:3d-rendering/cad-feature-order for the order of a part's features.

**Place parts by locations.** `Pos(100, 0, 0) * Rot(Z=90) * part` turns the part about its own origin and then moves it: the rightmost acts first. The forms for moving, turning and placing at a pose, shallow copies for many alike bought parts, and a maker's STEP file read with import_step are on doc:3d-rendering/cad-build123d.

**Mesh two spur gears.** bd_warehouse.gear holds SpurGear, HelicalGear, RackGear and worm gears (skill:3d-rendering/printable-parts).
- Each has a tooth on +x as made, so place the mate at the centre distance m·(z1+z2)/2 (over cos β for helical gears) plus an allowance Δa, about 0.05·m for machined gears and 0.1 to 0.2 mm for printed ones.
- Turn the mate 180 + 180/z2 degrees so a gap faces the first gear's tooth.
- A gear of an odd tooth count has its axis a little off the origin as made, as bd_warehouse centres its box there, so move it onto its axis before placing it.

For example:

    gear = SpurGear(module=1.5, tooth_count=20, pressure_angle=20, thickness=8, root_fillet=0.3)
    gear = Pos(-gear.center().X, -gear.center().Y, 0) * gear
    mate = Pos(1.5 * (20 + 30) / 2 + 0.15, 0, 0) * Rot(Z=180 + 180 / 30) * SpurGear(module=1.5, tooth_count=30, pressure_angle=20, thickness=8, root_fillet=0.3)

**Check a mesh turning with a geared sweep,** never positions, which build the whole script again at every step. Sweep the first gear about its axis from 0 to at least one tooth pitch, 360/z1 degrees, in 60 steps or more, with the mate turning about its own axis at rate −z1/z2, written out as a number:

    {"parts": ["Gear"], "through": [0, 0, 0], "along": [0, 0, 1], "from": 0, "to": 18, "steps": 60, "with": [{"parts": ["Mate"], "through": [37.65, 0, 0], "along": [0, 0, 1], "rate": -0.6667}]}

Built once, the answer gives how near their teeth come over the sweep, or where they meet and how deep, and names a gear turned about an axis not its own; it gives each meshing pair's centre distance, backlash and contact ratio.
- Every tooth of a gear is alike, so one tooth pitch checks the mesh.
- A whole turn of the slowest part checks what turns past a part that stays, a lug, a rib or a screw head, and needs only steps as fine as its clearance: a point r mm from the axis moves r·π/180 mm a degree.
- Each position measures every pair within 5 mm of each other exactly, so an assembly of twenty parts in its case takes seconds a position, and the answer says how long the sweep took.
- The gap between the teeth is Δa times the sine of the pressure angle, 0.05 mm for Δa 0.15 mm at 20°: keep a clearance requirement between the pair a little under it, so a change that closes it fails.

**A bevel gear is lofted by hand,** as bd_warehouse has none: loft the tooth plan to its copy scaled toward the cone's apex. For z1 and z2 teeth with shafts at 90°, the pitch cone angle is δ1 = atan(z1/z2), δ2 = 90° − δ1, the cone distance R = m·z1 / (2·sin δ1), and the face width b at most R/3, with `from math import atan, cos, sin`:

    plan = SpurGearPlan(module=m, tooth_count=z1, pressure_angle=20)
    pinion = loft([plan, Pos(0, 0, b * cos(d1)) * plan.scale((R - b) / R)])

Its back face lies on z = 0 and its apex at z = R·cos δ1. Its mate, made the same way with z2 and δ2, goes at `Pos(R * cos(d2) + 0.2, 0, R * cos(d1)) * Rot(Y=-90) * Rot(Z=180 / z2)`, apexes together. A geared sweep clears it through a pitch: the pinion about [0, 0, 1] through the origin, the mate with it about [-1, 0, 0] through the point it is placed at, at rate −z1/z2. Its teeth are spur teeth tapered, not true bevel flanks: right for showing a drive and checking its clearances, not for a bevel gear to cut.

**Build and check each subsystem alone, then join them.** Give each subsystem of the breakdown its own assembly script, which places only its parts from the layout, and check it with cad_build until it is clean: every part a valid solid of the size planned, nothing overlapping that should not, nothing floating, and its motion over a whole cycle. Only then import it into the whole. A machine of a hundred parts first built all at once answers with more than can be read, takes minutes a build, and hides where a fault lies; joined from clean subsystems, what the whole finds lies where two of them meet, and is fixed at the layout number they share. Draw, picture and cut a subsystem from its own script the same way.

**Assemble in CAD.** An assembly script imports every part, places each where the layout puts it with `part.moved(Location(...))`, and shows them all; run it with cad_build as a workspace file, so its neighbours import. Build a part that moves already facing the way it sits, and place it by a move alone: a turn in its placement becomes its starting turn in the 3D studio, which keys of its turn replace. Give a subassembly its own script once the whole is slow to read.

**Read the assembly's answer as a design review:**
- every part a valid solid of the size planned;
- no two parts overlapping except where they are pressed or fastened together;
- a gap where things slide or turn, about 0.2 mm a side when printed, less when machined;
- nothing left floating: the answer names each part and piece that nothing holds, such as a blade left standing off its hub; a part turning or sliding with a clearance of a millimetre or less counts as held.

A check that still names an overlap is not clean: fix it, or say which overlap remains and why it is meant, as a press fit is. The answer says how deep each overlap goes: a press fit goes in by hundredths of a millimetre, and one it calls far deeper is a clash, whatever it was meant to be. A part that is not a valid solid is answered with where its faces go wrong: change the step that made them there. Fix the layout or the part, never the check, and build again.

**Check motion over a whole cycle.**
- A part that moves as one rigid piece, a hatch on its pivot or a carriage on its rail, is checked with sweep: built once, turned about its axis or slid along its rail in fine steps, the answer says where it meets the parts that stay, how deep, and how near it comes elsewhere, in seconds, so "swings to 100° without hitting anything" is measured, not argued.
- A mechanism whose parts move differently, a link, a crank and its rod, takes each position from the script's arguments: build the assembly with positions at both ends of its travel and steps between them. Each step is checked for overlaps, and the answer says how near the moving parts come and at which step. A moving part that clears its neighbours at rest can still strike them half way.
- A mechanism that repeats is checked over a whole cycle of its slowest part, every pair that moves past another included: a camshaft turns once for every two turns of its crank.
- Where a gap must be known finer than the steps give, as a barb camming over a catch over a few degrees, give positions close together around it.

**Check the order of events.** Parts that clear each other can still work in the wrong order. Write down what the mechanism must do over one cycle, which part moves when and how far, and have the script print the design's own events beside it, from the layout's numbers, before anything is animated.

**Check that it can be assembled.** Say how each part goes in, and in what order, and check that its way is clear: a pin with a head on each end cannot pass its bores, nor a lid wider than its lip close over it. explode takes each part out along a way it is free to leave by: one that comes out only with another, or is left in, cannot go in as designed.

**Show it in the 3D studio.** Export the assembly as one .glb and add it with blender_add_objects (toolkit:3d-rendering/modelling) as a model file at [0, 0, 0]. It keeps the coordinates it was designed in, each part as its own object, by its name, a closed mesh at its real size and in its place, its origin where it was modelled, so it turns about its own axis; a place in the CAD, in metres, is the same place in the scene and in the formulas its parts follow.
- Faces named with show's surfaces, such as machined seats or a cutaway's cut faces, come each with a material slot of their own, which blender_set_material (toolkit:3d-rendering/surfacing) can give its own material.
- A design whose lowest point is below the floor is lifted with rest_on "floor"; the answer says where the model's origin went, and every CAD height is then measured from there.
- Give the parts their materials, and a setting and a camera, there; open skill:3d-rendering/scene-building for that and skill:3d-rendering/animations for motion.

**Animate from the driver.** Attach each moving part to what carries it, so a part rides on the one before it. Key only the part that drives the mechanism and make the others follow it, by the ratios and the geometry of the design (skill:3d-rendering/animations), then check every motion with frame sheets before the video, with view objects to see a small mechanism close up. Where a frame sheet says one part goes into another, it measured their surfaces: between parts of the mechanism that is a clash, so find it in the CAD at that moment and fix it there.

**Change no part's shape in Blender.** Its shape there would part from the design, its checks and its drawings, and a bevel or a subdivision tears the joins of its mesh, so the 3D studio refuses to round, cut, thicken or repeat a CAD part. Change the CAD, export again, and give the model its new shapes with blender_edit_objects shapes_from, which keeps every part's place, motion, attachments and materials, each named surface's included. Never turn a part to match by its bounding box: a round part such as a cam or a gear has the same box however far it is turned about its axis.

**Keep one catalogue script** beside the assembly that builds each distinct part alone, in its own coordinates and uncut, chosen by its name from the script's arguments, all of them laid out apart, or the parts list printed. Each part's drawing, its picture and the parts list all come from it, so none of them drifts from the design.

**Draw each part to be made** with cad_draw from a workspace script that imports its module and shows it alone, in its own coordinates, with the dimensions and fits its maker needs.
- Give a view's overall length, width or height as kind overall, which needs no point.
- Give a bore, a pin or a journal as a diameter with only the size the layout gives it in expect, which finds that circle in the view or says the sizes the view has; give points only for the sizes between features.
- For the whole, draw an assembly drawing from the same script, its sections showing how the parts fit: drawn from the exact solids, it is truer than a drawing of the Blender scene, which is for rooms and settings built there.
- A drawing is kept by the files it wrote: cad_draw with again draws it once more, changed only where asked, so a dimension is added without giving the whole drawing again.
- A section along a turned machine, such as an engine, a pump or a turbine, cuts its blades into slivers: name the rows of blades and vanes in the section's revolved, with the axis they turn about, and it draws each turned into the plane as its full outline.
- Where the answer says a view's hidden edges crowd it, draw that view with hidden: false.

**Deliver what was asked:**
- files for making: STEP for machining or another CAD program, STL or 3MF for each printed part;
- a parts list: each part, how many, made or bought, its material, its main size and its file;
- renders and a video in the 3D studio when they were asked for;
- for how it goes together, cad_build or cad_draw explode, keeping the frame or base in place: the parts come apart from the outside in, each along a way it is free to leave by, for an exploded picture, drawing or .glb, and a .json export holds the assembly sequence that blender_animate's cad_motion plays. A part the answer leaves in is held by the design itself, as a one-piece part wrapped round a shaft is: where the real one comes apart, split it there, or say why it stays.
