---
name: scene-building
description: >-
  Use when building or changing a 3D scene in Blender: real sizes, placing objects, modelling steps, and checking the work.
metadata:
  stage: block-out model check
  gate: Every object is at its real size and place, touching what it rests on and nothing else, in the answers and in renders from two sides.
  works-with: mechanical-design scene-stages simulations set-dressing
---

Work like a careful 3D artist who measures. The person watches each change in the 3D view, so build in steps that make sense to watch.

Something mechanical, whose parts must fit together, carry a load or move, is designed in the CAD studio first: open skill:3d-rendering/mechanical-design, and bring its parts here to show them.

Start with blender_open_scene: create a new scene file, or open the one the person names. Everything else works on that scene, and it is saved after every change.

**Build at real size, with z up.** The front looks from -y toward +y, and +x is to the right. Sizes and positions are in metres and angles in degrees; a can is about 0.066 × 0.066 × 0.115 m, a door 0.9 × 2.1 m, a dining table 0.75 m high.
- An object's location is its origin, as in Blender: a solid is centred on it, and a shape drawn through points keeps the coordinates it was drawn in.
- A size is along the object's own axes, before it is turned.
- Planes, text, pictures and drawings lie flat, facing up; rotation [90, 0, 0] stands one up, facing the front.

**Place by contact, not by worked-out heights.**
- To stand one thing on another, give rest_on ("floor" or the object below): it lands on the first surface beneath it, so a cup sits in a saucer's well.
- To stand one against another, as a bookcase against a wall, give against with the side.
- To lay a point of it on another's, as a vase's bottom-centre on a table's top-centre, give to.

Each answer says the gap after, 0 mm when they touch. Every answer says where each object's bottom and top are and what it goes into; read them before the next step.

**Many things.** A room, a desk, a shop or a street dressed with many objects is arranged by use, in groups, off the grid: open skill:3d-rendering/set-dressing. Many copies over a surface, stones on a path or plants in a bed, are scattered with blender_scatter (toolkit:3d-rendering/scatter). Things that lie as they fell, a pile of books or a throw over a chair, are dropped or draped with blender_simulate and kept where they rest (skill:3d-rendering/simulations).

**Model with all of Blender.** Add objects with blender_add_objects and shape them with blender_shape_objects (a hole is a boolean difference with a cutter described in the call), both in toolkit:3d-rendering/modelling. A form their kinds and steps do not give is modelled in blender_run_script, where zhiyin's edits extrude, inset, bevel, bridge, cut loops, scale, rotate, delete and dissolve on the faces and edges a pick chooses, as an artist does by hand, and Blender's own modifiers, curves and geometry nodes are there too. A scene of plain boxes, cylinders and spheres is a block-out, not a finished scene.

**For looks, prefer the typed tools to scripts:** the material tool (toolkit:3d-rendering/surfacing) and the camera and lighting tools (toolkit:3d-rendering/light-and-camera). Their approvals read as sentences, and they work across Blender versions. A script that sets looks is for what those tools cannot do.
- Wood is a finish on the material, as metal is; so are cast aluminium and iron, machined, plated, painted and heat-tinted metal, textured plastic, rubber and braided hose, each drawn at its real size with no picture, and wear and grime on any material. Use them before writing node graphs in a script.
- The studio preset puts its lights in a photographed studio, so metal has something to reflect; blender_set_lighting can also light a scene with one of Blender's own surroundings by name.

**Lights and glow.**
- A screen that is on, a lit sign or a lamp's shade is a material that glows; with a picture and no glow colour of its own, the picture is what glows.
- A neon tube is a thin glowing tube in its colour, with blender_render's post step bloom for the haze round it and a real light of the same colour beside it, low and small, for the light it spills on the wall: a thin glow alone lights little round it.
- A lamp's colour is its kelvin, on the light and on the glow alike (2700 a household bulb, 1900 a candle), rather than a guessed colour.
- A screen or a sign seen more than shining takes lights_scene false, so Cycles does not sample it as a light.

**Scripts.** Before writing a script that calls bpy directly, ask blender_api what the installed Blender accepts: Blender's API changes between versions. A script runs in the workspace folder, so relative paths are the workspace's.

**Build things the way they are made,** because a picture shows how they are made. Before modelling, recall the real thing: its parts, how they are joined, and the details that make it read as itself, such as a neck, a rim, a seam or a thread, and how a Blender artist would model each.
- Hollow things are hollow, with walls of their real thickness: a revolve profile that runs up the outside and back down the inside, solidify, or a boolean difference.
- What a container holds fills its inside up to a level and reaches a fraction of a millimetre into the glass around it and under it: an air gap between them shows through glass as a clear band, and two see-through surfaces in the very same place show as wedges of one and the other.
- Parts meet as they are joined: what is one piece in the real thing is one surface, as a spout grown from a teapot's body or an armrest from a chair's frame, rather than two meshes pushed or joined into each other; a cap sits on the neck it closes, a label lies on the surface it is stuck to.

The answers say what goes into what and where every bottom and top is, so a part that floats, sinks or leaves a gap shows there before it shows in a picture.

**Name and attach.** Name objects for what they are, such as "Lid" or "Left wall", so later steps and the person can refer to them. Attach a part to the object it belongs to (a wheel to its cart, a lid to its jar): moving, turning, copying, hiding or deleting the object then does the same to its parts, and positions stay the world's. Lights are named too, and changing one by name changes only what is given.

**Check your work.** blender_describe_scene gives every object's size, origin, heights, materials and steps with their values, what it goes into, whether a mesh is closed, and what the camera's picture shows, hides behind something or misses; when you can see pictures it also shows the preview. Compare the sizes with what was asked before rendering.
- How close two shapes come, a drawer's clearance or the gap behind a sofa, is measured surface to surface with blender_measure (toolkit:3d-rendering/measure), never read from their boxes.
- A render's answer gives the colour each object shows in the picture, and the background's, so colours are checked without a script.
- Then judge each picture as the person will: does every object read as the real thing, do parts touch where they should and nowhere else, are the colours and the background what was asked?

Fix a flaw a check shows rather than explaining it away: it will be in the final picture too.

**Render.** Finish with blender_render for pictures and blender_export, in toolkit:3d-rendering/output, for model files. EEVEE is quick for checking layout and framing; Cycles is what the final picture should be, and it shows more of what surroundings light and reflect and sees through glass as it is, so check colours, brightness and anything see-through with a small Cycles render first.

**Exposure and tone.**
- The camera's exposure brightens or darkens the whole picture, background included: when one surface is too bright, lower the light that falls on it, by its name, or its colour instead.
- Sunlight is tens of times brighter than the light in a room, so a view outdoors under a sky needs an exposure several stops lower than a view from inside the same scene, and the exposure is set again when the camera moves between the two.
- A Cycles render's answer says when surfaces are lit past their own colours, which shows them pale or glaring, and gives the exposure that shows them as they are: set that on the camera.
- The agx tone is the one for sunlight, because it holds bright light; neutral and standard show colours as given under soft studio light and turn what the sun lights into glaring ones.

**A stylised picture,** toon, cel, anime, NPR or a flat illustration, is finished in EEVEE, the one engine where it is the picture to hand over: it draws flat bands of light from Shader to RGB, outlines and its own volumes quickly, and Cycles' bounced light and caustics add nothing such a picture wants. Keep Cycles for a picture that should look photographed, and for glass, caustics and soft light bounced round a room.
- Shade its materials with blender_set_material's toon, outline it with blender_set_camera's outlines, light it from one side so the bands show, and render with engine eevee.
- A toon material makes that picture final by itself, and eevee final says so for any other stylised look, with its shadows, ray tracing, volumes and light probes set there.
- Read the stylised lines of the render's answer: a silhouette missing its line, a toon shape showing fewer bands than asked, or a palette wider than the style, is fixed before the picture is handed over.
- Bloom on what glows, a vignette and film grain are blender_render's post, and a bloom's threshold is measured from the picture itself.

**Measured drawings.** To measure a built piece of furniture or a room on paper, draw the scene with cad_draw and scene: true: it lays out the views Blender's Line Art finds, hidden edges dashed and sections hatched, and dimensions them from the corners and circles drawn, in millimetres. A round edge reads as a circle when it was modelled with twelve sides or more.
