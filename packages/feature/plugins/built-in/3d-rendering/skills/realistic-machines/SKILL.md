---
name: realistic-machines
description: >-
  Use when a machine, engine, vehicle part, pump, winch, robot or any mechanism must look like the real thing in a picture or a video, not a model of it: how real ones are shaped, joined, finished, lit and checked up close.
metadata:
  stage: model surface light render check
  domain: mechanical machine
  gate: Every part a person sees on the real machine is there, shaped and finished as it is made, and holds up in close-ups of its joints.
  needs: mechanical-design
  works-with: scene-stages publishing/latex-typst-authoring
---

A machine looks real when it is made the way real ones are: cast, machined and bought parts, joined as they are joined, each surface finished as its material is. It looks like a toy when its parts are plain boxes and cylinders with sharp edges, joined by nothing, in one grey. Mechanical design, which comes with this skill, designs and checks the parts; this is how they come to look real.

**List what the real thing shows, before modelling.** Write down, by system, every part a person sees on the real machine, from what such machines are: where its power comes in and how it is carried, what holds it, what feeds it, what cools it, what it is wired with, what it is mounted on. Set the list out with update_plan, and build down it in order of what the eye meets first. A part left out is a gap that shows. For example:
- A car engine shows its block and heads, the covers on them, the intake and its throttle body, the exhaust manifolds, the front cover with its accessory drive (crank pulley, belt, alternator, water pump, tensioner and idlers), the oil pan, filter and dipstick, the fuel rail and injectors, the coil packs or plug leads, the sensors and the wiring that joins them, the hoses with their clamps, and the mounts.
- A pump shows its casing and volute, its inlet and outlet flanges, the motor, the coupling and its guard, and the baseplate.
- A robot arm shows its links, the joint housings and their covers, the actuators and the cables in their carriers.

**Shape each part as it is made.** In the CAD studio, with its helpers:
- A casting is drafted, rounded and ribbed: raise its body with cast (two or three degrees of draft, edges rounded), stand bosses round every bolt hole and port with boss, flat machined seats with pad, and stiffen its walls with rib. Round its outside edges with round_edges after its cuts: a few millimetres on a part held in the hand, five to fifteen on an engine's castings. No cast part has a sharp outside corner.
- A machined part is turned or milled from stock: flat faces, crisp edges broken by a small chamfer or round, bores and threads at standard sizes.
- A cover or a pan is pressed or cast thin: a domed crown, a rolled or flanged edge, a bead round it, a filler or a breather on it.
- Bought parts come at their catalogue sizes, from bd_warehouse where it has them: bolts, nuts, washers, bearings, flanges, pipes, gears, sprockets. A spring is wound with coil.
- A part has the shape the real one has, not its envelope: a crankshaft's webs are counterweights heavy on one side, not discs; a connecting rod or a lever is an I-section between its eyes, not a bar; a gear has a rim of teeth, a web and a hub, not a solid disc; a robot link is a hollow casting, not a block.

**Shape everything in the CAD,** never in the 3D studio, which refuses to round, cut or thicken a CAD part: rounded there, its mesh tears. Before exporting, read each part's faces by kind in cad_build's answer: a casting or a forging of flat and cylindrical faces only has no rounds, and will look like a box. Round it, and build it again.

**Join every part as it is joined.**
- Where two castings meet: a flange on each, a gasket line between them and bolts through both, five to eight bolt diameters apart, put with bolt_circle or bolt_row. A real machine shows dozens of bolts.
- A pipe runs with real bends, with pipe; a hose leaves one port and seats on another, with hose, a clamp at each end.
- A belt wraps its pulleys exactly, with belt, on the faces it runs on.
- Cables run in bundles held by clips every 150 to 250 mm on brackets bolted to the machine.

Nothing floats, sinks into another part, or ends in the air: the answers name each piece held by nothing, each overlap with how deep it goes, and each tube end that meets nothing.

**Finish each surface as its material is.** Name the faces that are finished apart in the CAD, with show's surfaces: machined seats and bores, a cutaway's cut faces (cutaway names them). In the 3D studio give each part the finish of what it is with blender_set_material (toolkit:3d-rendering/surfacing):
- cast-aluminium or cast-iron for castings, painted-metal for a painted block;
- textured-plastic for moulded covers;
- rubber for hoses and belts, braided-steel for braided lines;
- plated-steel for bolts, heat-tinted-steel for exhausts.

Then give each named surface its own with surface, such as machined-metal on a casting's machined surfaces; blender_describe_scene lists each part's surfaces with their materials. A finish is drawn at its real size and has its own colour, so give a colour only where the part is painted one.

**Wear and grime.** Add grime where oil and heat gather on a used machine, and little or none on a new one shown clean; wear rubs paint and edges bright where hands and tools touch. A cutaway's cut faces are painted a colour of their own, as real cutaway models are.

**Move everything the real one moves.** Before animating, list every part that moves on the real machine and what drives it, as you listed what it shows: in an engine the crank drives the rods and pistons, and the camshafts, at half its speed, open each valve against its spring; in a clock each wheel turns at its own ratio; in a robot arm each joint turns the links beyond it; in a pump the motor turns the coupling, the shaft and the impeller.
- Make every moving piece a part of its own in the CAD, never a row of alike pieces joined into one object, which can only move as one.
- Give alike parts one material by naming them all in one blender_set_material.
- Key the part that drives the rest and make the others follow it: a ratio for what turns with it, a formula for what slides or swings; a formula too long for Blender to follow live is keyed at every frame, as the answer says.

**Light it so metal shows as metal.** Metal shows only what it reflects: light it with the studio preset, which surrounds it with a studio to reflect, and give it a floor or a backdrop. Frame it from the three-quarter, a little above, with a 50 to 85 mm lens, and look again from the other side.

**Check it up close before the final render.** A picture of the whole hides what is wrong where parts meet. Look at every joint that matters with blender_close_ups (toolkit:3d-rendering/motion): each hose's ends, each cover on its seat, each part that turns in another. Read each object's line: holes in its surface and faces that cross each other are said with where they are and whether its steps made them. Fix what is wrong in the CAD, export again, and give the parts their new shapes with blender_edit_objects shapes_from, which keeps each surface's material. Every overlap an answer or a frame sheet names is a clash until you have found it in the CAD: fix it, or say in your report which remains and why.

**Judge the render as a person who knows such machines would:** name what still looks made rather than real, and fix that, before the final look from two sides.

**Pictures of each part.**
- A part pictured alone is one blender_render with only, naming it, and frame, for the side to see it from: the rest of the scene and its camera stay as they are, so never hide parts or move the camera with a script for it.
- Its exact shape, as the CAD has it, is cad_build's views picture, written with an export to a .png.
- A cutaway part is pictured whole from its own uncut build.
- Picture every part from one catalogue script that builds each alone, as mechanical-design keeps, in a scene of its own with a plain backdrop, so the machine's scene stays as it is.
