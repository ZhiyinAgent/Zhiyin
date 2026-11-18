---
name: interiors-from-plans
description: Use when building rooms, flats or venues from a floor plan or measurements, and showing them from inside.
metadata:
  stage: block-out model light render drawing
  domain: interior architecture
  gate: The plan view matches the given plan wall for wall, with each door and window where the plan puts it.
  works-with: scene-stages simulations set-dressing publishing/latex-typst-authoring
---

Turn a plan into a space a person recognises as theirs. Every measurement in the plan matters more than decoration.

**Read the plan first:** room sizes, wall thickness, where doors and windows are and how wide, ceiling height. When something is missing, use common values and say so: interior walls 0.1 m, outer walls 0.25 to 0.3 m, ceilings 2.5 m, doors 0.9 × 2.1 m, windows from 0.9 m above the floor.

**Lay the plan out on the floor,** x across and y up the page, with z up. A picture of the plan at its real width, lying flat on the floor, can be traced over and hidden afterwards.

**Build the walls** with the tools of toolkit:3d-rendering/modelling, as outlines extruded to the ceiling height: one outline per run of wall, or one outline of the whole plan with the rooms as holes.
- Cut doors and windows with boolean differences using box cutters, so they stay movable.
- An opening reads as a window once it has a frame round it and a pane of glass a few millimetres thick, which lets the sun through as real glass does, and as a door with its frame or its leaf; left bare it reads as a hole in the wall.
- Add the floor as a plane or a thin box, and a ceiling the same way: without one, a view from inside shows the sky above the walls and daylight pours in from overhead.

**Furnish at real sizes:** a sofa 0.9 m deep and 0.85 m high, a dining table 0.75 m high, a bed 1.6 × 2.0 m, a kitchen counter 0.9 m high and 0.6 m deep.
- Keep at least 0.8 m to walk between pieces, measured between their surfaces with blender_measure (toolkit:3d-rendering/measure).
- Set furniture against its wall with against in blender_edit_objects, and dress the rooms with what is used in them, in groups by use and off the grid, as skill:3d-rendering/set-dressing lays out.
- Cushions, a throw over a sofa's arm and curtains hanging from their rail are draped with blender_simulate (skill:3d-rendering/simulations), and plants or stones in a garden are scattered with blender_scatter (toolkit:3d-rendering/scatter).
- Wooden floors and furniture take the wood finish on their material (toolkit:3d-rendering/surfacing): the grain runs along each piece's longest side, so a top reads along its length and a leg up it, and a floor laid as boards shows each board.

**Light it with daylight,** or a sky with the sun on the side the windows face, and add soft area lights indoors when rooms are dark; the lighting and camera tools are in toolkit:3d-rendering/light-and-camera. A sky has level ground under it to the horizon, so a window looks out on ground and sky without anything built outside. That ground is only a backdrop and takes no shadow: a building shown from outside stands on ground of its own, a lawn or paving a few metres wider than it. Seen from outside, the same daylight is far too bright for the exposure that suits the rooms: the render's answer gives the one that suits the view.

**Show it from inside:** a camera at eye height (1.6 m) with a lens of 24 to 35 mm, looking across the room towards the windows or the main feature.

**Check the plan from above.** The plan of the whole place from above checks it against the original, wall for wall: blender_render with view plan draws it in one call with +y up the picture, as the plan has north, cut 1.2 m above the floor as a drawn plan is.
- The ceiling and whatever else stands above the cut is not drawn, walls are filled dark where they are cut, a door shows as a gap in its wall and a window as the lighter top of the wall under it, and tall furniture keeps its own colour.
- Hand the plan over at that height: cut above the heads of the doors, every door and window closes up and the plan can no longer be checked against the original.
- Its even light is not shaded by walls, so every floor shows close to the colour it was given, and the scene keeps its camera, lights and ceiling as they were.
- Through the scene's own camera aimed down with the ceiling hidden, the sky pours in many times brighter than the room was and bleaches the picture, and whatever was hidden or changed for it stays in the saved file until it is put back.

**A drawing for a builder.** When the person needs a drawing to check against their measurements or to hand to a builder, draw the scene with cad_draw and scene: true, from the CAD studio, once the walls and openings are built.
- Elevations are the front, back, left and right views.
- A plan as a builder reads it is a section looking as the top view through a point 1200 mm above the floor: it cuts the walls, hatches them and shows the openings in them, and needs an elevation on the sheet to mark where it is cut.
- Name the walls, doors and windows in objects to leave the furniture out of a builder's drawing.
- Points are the scene's coordinates in millimetres, a metre being 1000: dimension each room's inside from wall corner to wall corner, the walls' thickness, and each door and window from the nearest corner and across its opening, with expect for every size the plan gives, so a wall built in the wrong place refuses the drawing instead of being drawn.
- Rooms are drawn at 1:50 or 1:100 on A3; write a .pdf to print and a .dxf for another CAD program.
