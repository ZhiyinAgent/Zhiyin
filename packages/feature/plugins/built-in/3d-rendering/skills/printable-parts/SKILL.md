---
name: printable-parts
description: >-
  Use when designing parts to 3D print, mill or cut: brackets, holders, enclosures, replacements for broken pieces, a part from a drawing.
metadata:
  stage: requirements features check drawing export
  domain: printing mechanical
  gate: The part is one valid solid of the size planned, its printing requirements hold, and its clearances are in place.
  works-with: part-stages cad-feature-order mechanical-design publishing/latex-typst-authoring
---

Design a part that prints and fits the first time. Measurements, clearances and wall thickness come before looks. A part of a machine or of anything with several parts that fit or move together starts from that design's layout: open skill:3d-rendering/mechanical-design too.

**Collect the dimensions that matter:** what the part attaches to, the screws or pegs and their diameters, the load it carries. Ask when a measurement that decides the fit is missing.

**Think the part through in use:** what rests on what, which way it tips, and how whatever passes through it, a cable, a screwdriver or a strap, gets in and out with what it carries on its ends. Give it a way to an edge wide enough for that, and follow it in the four views.

**Build it with cad_build, in build123d.** Start from a sketch of the part's outline, or a box the size of the part, then cut and add as it would be made:
- holes for screws;
- `extrude` and `revolve` for profiles;
- `loft` and `sweep` for forms that change along their length;
- offset for shells;
- ribs and bosses where a moulded or printed part has them;
- rounds and chamfers on its edges.

Give every important size a name at the top of the script, so a change is one number. What build123d does differently from CadQuery and from intuition, as installed, and how copies are placed at locations, is on doc:3d-rendering/cad-build123d.

**Put how it prints in the requirements file.** Parts that slide together need about 0.2 mm on each side. Keep walls at least 1.2 mm thick and round outside edges slightly. Write in the file the bed, the thinnest wall, the overhangs and the bridges the printer manages, so every build measures them, and change the part where a check fails, or say a support is needed. Write there too the real sizes and proportions that make it work and read as what it is, such as its length to its width and height or a key diameter, from what such things measure, rather than judging them by eye. Never delete or relax a requirement to make a build pass: change the part, or keep the requirement and say in the answer which fails and why.

**Round and break the edges.** Round the outside edges of every part a hand holds or an eye sees, 0.5 to 2 mm on a small print and more on a larger one, and break the rest with a small chamfer. round_edges(part, edges, radius) does it last, after the cuts, and never fails the build: it rounds with less where a shape leaves no room and says which edges got less. The build's answer counts each part's sharp, rounded and chamfered outside edges. Leave teeth, threads and thin ribs sharp. `chamfer(edges, length=2)` cuts an even bevel, `length2=1` an uneven one and `angle=30` one at an angle.

**`fillet`, called directly, is the step most likely to fail.** The kernel refuses one wider than a face beside an edge it rounds, or where many small edges meet, and its error does not say which edge.
- Give it edges chosen by position or length rather than every edge of a face, no wider than about half the narrowest face they touch.
- When one fails, round fewer edges at a time to find the one at fault.
- `part.max_fillet(edges, max_iterations=20)` gives the largest radius those edges take; with its default 10 steps it gives up on most parts over about 25 mm.
- Take the edges from the shape as it is at that step: edges of a copy moved elsewhere, or of another shape built alike, are not its edges.

**Cut screw holes from the screw itself,** with bd_warehouse.fastener, rather than sized by hand: `screw = SocketHeadCapScrew("M4-0.7", 16)`, then at the hole's locations:
- `ClearanceHole(screw, fit="Normal", counter_sunk=False)`: Close, Normal and Loose are 4.3, 4.5 and 4.8 mm for M4.
- `TapHole(screw, material="Soft", depth=8, counter_sunk=False)` for a thread to tap: 3.3 mm, 3.5 in "Hard".
- `InsertHole(HeatSetNut("M4-0.7-Standard"), manufacturing_compensation=0.2)` for a heat-set insert in a print, its hole 0.2 mm wider a side for a printer that over-extrudes.
- `ClearanceHole(HexNut("M4-0.7"), captive_nut=True)` for a hex pocket that holds a nut.

counter_sunk=True, the default, sinks the head as well: a counterbore for a cap screw, a cone for a countersunk one. The hole diameters in the answer confirm each.

**Hollow parts.** Hollow an enclosure or a shell with offset, after rounding the outside's edges by at least the wall's thickness. offset gives the part back whole, with no error, where it cannot make the wall, as with a round smaller than the wall, so check the volume or a wall requirement after it. Keep the walls near one nominal thickness: a section much thicker than the rest sinks and prints or moulds unevenly. A moulded rib is at most 0.6 of the wall it stands on and 3 walls tall, the numbers making="moulded" checks.

**Gears** are built in, in bd_warehouse, and cad_api says what each class takes. A spur gear of z teeth and module m, with involute flanks, centred on the z axis: `from bd_warehouse.gear import SpurGear`, then `SpurGear(module=1.5, tooth_count=20, pressure_angle=20, thickness=8, root_fillet=0.3)`. `HelicalGear(module=1.5, tooth_count=20, pressure_angle=20, helix_angle=20, thickness=8)` is its helical twin, its mate given the opposite helix angle, and `RackGear` and worm gears are beside them.
- Keep the formulas as checks of what the build answers: a spur gear's tip diameter is m·(z+2) and its pitch circle m·z (a helical one's m·z/cos β, its tip 2m more), so a gear whose size in the answer differs is not the gear meant.
- Mesh two gears, and make a bevel gear by hand, with the recipes in skill:3d-rendering/mechanical-design.
- Size the teeth for their load with strength.gear (Lewis's bending stress).
- From a measured tip diameter, the module is that diameter over z+2. Appliance gears are usually a standard module (1, 1.25, 1.5…), so say when the measurement gives another.

**Threads.** A metric thread: `from bd_warehouse.thread import IsoThread`, then `thread = IsoThread(major_diameter=8, pitch=1.25, length=20, end_finishes=("chamfer", "square"))`, along z from 0 to its length, joined to a core of its inner radius: `bolt = Cylinder(thread.min_radius, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) + thread`, one valid solid in about two seconds.
- Give both end finishes: the default, ("fade", "square"), runs the thread most of a pitch past its length.
- A nut's thread is `IsoThread(…, external=False)` joined inside a hole of the major diameter.
- The other thread classes are beside it: `MetricTrapezoidalThread("10x2", 20)` for a lead screw, `AcmeThread("1/4", 20)` in inch sizes, `PlasticBottleThread("M28SP410")` for a bottle's neck and `external=False` for its cap, `WhitworthThread` for British threads and `BSPPThread` for pipe threads.
- A printed thread takes `manufacturing_compensation=0.2`, which moves an external thread 0.2 mm in and an internal one out; calibrate it for the printer.
- bd_warehouse has no splines: draw their profile and extrude it.

**Bearings and fits.** A bearing comes from bd_warehouse.bearing at its catalogue size, with no load ratings: its L10 life needs the dynamic load rating C from the maker's catalogue for that bearing, given to strength.bearing. Its seat and journal take ISO 286 classes, as H7 in the housing and k6 on a turning shaft: iso_fit gives their limits, the part is modelled at the middle size, the drawing carries the class, and PressFitHole cuts a bearing's seat given its interference.

**Sheet metal and strength.** Sheet metal is folded with sheet(), from a flat outline drawn to the outside of its bends, and its flat pattern is part.flat, drawn from the top to a .dxf for cutting; check it with a bend requirement, rules: true. Size shafts, beams, bolts and columns with strength's checks. doc:3d-rendering/cad-engineering says how.

**Check what the build answers against the plan** before going on:
- each part a valid solid, its size the one planned, every hole the diameter and count intended;
- parts that fit together do not overlap; when they do, the answer names them and the volume they share;
- the four views show no cut through the wrong face and no wall left too thin;
- the volume gives the plastic it needs (PLA weighs about 1.24 g per cm³).

**Say how each part goes in or on,** such as a pin through its bores or a lid over its lip, and check that its way is clear: nothing on it wider than the opening it passes, as a head on each end of a pin would be. explode takes each part out along a way it is free to leave by: one that comes out only with another, or is left in, cannot go in as designed.

**Export** .stl or .3mf for a slicer, both in millimetres, and .step as well when the part may be changed in another CAD program or machined. To show the part in a picture, export a .glb too and add it to a scene in the 3D studio with blender_add_objects (toolkit:3d-rendering/modelling), as a model file; it arrives at its real size. Then light and render it from the side that shows its openings, in a colour with some depth: white plastic on a white backdrop shows only by its shading.

**A drawing for a maker.** When the part is for a workshop, a machinist or a laser cutter, draw it with cad_draw from the same script.
- Choose the views that show every feature once: the front, the top and the right, with a section through holes or pockets the outside hides, and a detail of anything small.
- Dimension what the maker needs to make it and check it: overall sizes, hole positions from one edge or datum, each hole's diameter (with `all` for a pattern), radii and thicknesses.
- Point each dimension at the corners and circles it measures, in the part's own coordinates, and give `expect` for every size the part must have, so a drawing of a part built wrong is refused instead of drawn.
- Add a tolerance where a fit matters (a bore for a bearing as H7).
- Fill the title block with the part's name, material and number.
- Write a .pdf to print, and a .dxf of one view alone for a laser or a waterjet: it holds that view at full size, its circles as circles.

Look at the sheet in the answer for dimensions that crowd a view or say the same size twice.
