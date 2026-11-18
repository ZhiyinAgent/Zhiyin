---
name: part-stages
description: >-
  Use at the start of any work in the CAD studio, one part or a machine: the stages from requirements to drawings and files, what must hold before each next one, and which skill to open when.
metadata:
  stage: requirements
  domain: mechanical printing
  gate: The requirements file holds every number that decides the fit, each with the person's words, before the first build.
  works-with: mechanical-design printable-parts cad-feature-order realistic-machines lathe-profiles scene-stages publishing/latex-typst-authoring
---

The CAD studio's tools, cad_build, cad_draw and cad_api, are there from the start. Go through the stages in order and pass each gate before the next. When a check fails, go back to the stage that made the fault and change the part there, never the check.

**build123d, not CadQuery.** A part is built in `with BuildPart() as made:`; a 2D shape (Circle, Rectangle) goes in a `with BuildSketch():` inside it, and a BuildLine's outline is closed with `make_face()` in that BuildSketch; after the block, the part is `made.part`. CadQuery's forms fail in build123d. doc:3d-rendering/cad-build123d has CadQuery's forms beside build123d's, the version installed and what differs from intuition: open it before the first script. cad_api says what a build123d or bd_warehouse name takes; find with kind doc looks up their reference pages.

**1. Requirements.** Write requirements.json beside the design's scripts before anything is built.
- Each number the person gives or the job decides goes in, in the kinds cad_build checks: size, fits, hole, clearance, separate, wall with its thinnest, thickest and spread, overhang, draft, undercut, void, smooth, corner, ribs, bend, mass, balance, insert, stress, strain.
- Each has the person's words in says.
- Take what is not given from what such things measure, and say it.
- Open skill:3d-rendering/mechanical-design for anything of several parts that fit or move, and skill:3d-rendering/printable-parts for a part to print, mill or cut.

Gate: every number that decides the fit is in the file.

**2. Sketch.** Put the main sizes in one place, named: at the top of a one-part script, or in a layout module that every part of a machine imports. Draw each profile on the plane it belongs to, from those names.

Gate: every axis, mounting face, clearance and place where two parts meet has a name, and no size is typed twice.

**3. Features.** Build each part in the order it is made, with the operations a CAD designer would use for it, not only boxes and cylinders:
- revolve for what is turned;
- loft and sweep for what changes along its length;
- offset for a shell;
- draft, ribs and bosses for what is moulded or printed;
- bd_warehouse's screws, nuts, bearings, gears and threads for bought parts;
- rounds and chamfers on every edge the real part has rounded or broken. round_edges rounds edges without ever failing the build.

A part of plain blocks with every edge sharp is a block-out, and it looks like one in every picture of it. Open skill:3d-rendering/cad-feature-order, skill:3d-rendering/lathe-profiles for turned parts, and skill:3d-rendering/realistic-machines for a machine that will be shown. Run cad_build after each few features rather than once at the end, so a step that fails is found where it is.

Gate: each part is one valid solid of the size planned, its holes the diameters and count intended, and the answer's count of its edges shows its outside edges rounded or chamfered where the real part's are; teeth, threads and knurls stay sharp.

**4. Check.** Show the parts as their assembly and read the answer as a review:
- overlaps, with how deep each goes;
- pieces nothing holds;
- each requirement's margin;
- sections through what the outside hides;
- a mechanism at the positions of its whole cycle, with steps between them, so the nearest gap between parts is found where it closes, not only where it was listed.

Look at the four views and the one at an angle, never the front alone.

Gate: every requirement holds and every overlap named is meant, as a press fit is. A requirement that fails is fixed in the part, or, when the design means it to differ, as a flexing tongue is thinner than the walls, restated in the file to say what the design is; never kept failing and called intended. Only what cannot be fixed is left failing, and the answer says which and why.

**5. Drawing**, when a maker needs one. cad_draw from a script that shows the part alone, with expect on every size the part must have, so a part built wrong is refused instead of drawn.

Gate: the drawing is drawn, not refused, and gives every size its maker needs once.

**6. Export.** STEP for machining or another CAD program, STL or 3MF for printing, GLB for the 3D studio, where skill:3d-rendering/scene-stages takes it on.

Gate: each file the answer names was written by the build that answered for it.

**7. Review and answer.** Before the final answer, review the last build against the request.
- Look at its four views, where each part is named, and at renders from two sides when it was shown in the 3D studio.
- List every flaw they show, such as a part missing, floating, in the wrong place or of the wrong size, or a requirement failing. Fix each, or say it in the answer.
- Say of each file only what the build that wrote it answered.
- Give a picture as a link to its file, such as [the views](out/part.png): pictures are not drawn in an answer.
- End with what you assumed and what the person should check before making it.

A document that gathers the work, such as a report, a manual, a datasheet or a catalogue of the drawings and pictures, is written in Typst and compiled to PDF with compile_document, from the publishing plugin: open skill:publishing/latex-typst-authoring.

Gate: every flaw the last look found is fixed or said in the answer.
