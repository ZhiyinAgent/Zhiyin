---
name: making-assets
description: >-
  Use when making 3D assets to fill or dress a scene: rocks, plants, crates, props, fences, books on a shelf, anything many of which appear, or anything a game, a render or another scene will reuse.
metadata:
  stage: model check export
  domain: assets props game
  gate: Each asset reads as itself by its outline from three views, at a face count that suits where it is used.
  works-with: scene-stages subd-modelling hard-surface-bevels sculpting
---

Make assets the way a technical artist does: from geometry that is described, not sculpted by hand, so each one is quick to change and to vary.

**Build from procedures before anything else.** Start from primitives at the asset's real size with blender_add_objects: a primitive is where an asset starts, never what it ends as. Shape it with blender_shape_objects, both in toolkit:3d-rendering/modelling, and with the edits an artist makes by hand in blender_run_script: zhiyin.extrude, inset, bevel, bridge, loop_cut, scale, rotate and delete on the faces, edges and loops a pick chooses. Keep every step editable until the asset is done. Among the steps:
- a bevel so no edge is perfectly sharp;
- an array for planks, slats, steps and rungs;
- a mirror for anything symmetric;
- solidify for sheets with thickness;
- subdivision for soft forms;
- booleans for cut-outs.

**Shape kinds for common props.** Tubes along points make cables, rails, branches and handles; a revolve profile makes pots, posts and turned legs; an outline with a height makes boards, signs and panels.

**Rocks, bark and ground** are primitives with their surface displaced by a noise texture: a Displace step with a Clouds or Voronoi texture, added with blender_run_script after asking blender_api what the installed Blender accepts, and with enough subdivision underneath that the displacement has vertices to move. A form with character, a weathered rock, a carved trunk or a creature, is sculpted (skill:3d-rendering/sculpting).

**Make many from one.** A forest, a pile of stones or a full bookshelf is a few assets copied, never hundreds modelled.
- Duplicate with blender_edit_objects, which gives each copy an offset, and then turn, resize and move each copy a little, so no two read as the same.
- For dozens to thousands over a surface, scatter them with blender_scatter (toolkit:3d-rendering/scatter): copies that share their mesh, kept apart and standing on the surface, with random turns and sizes from a seed, so the result is the same each time it is run. Copies that share a mesh cost one mesh's memory; say the seed so the person can get the same scatter again.
- A heap that must look fallen, stones in a pile or apples in a crate, is dropped with blender_simulate's rigid bodies and settled where it rests (skill:3d-rendering/simulations).

**Vary what repeats.** Real things in a group differ: fence posts lean and differ in height and weathering, stones differ in size, planks in grain and shade. Pick a small set of sizes and colours that belong together rather than random ones, and keep the variation within what the real things show.

**Name and seat each asset.** Name each asset for what it is, keep its origin where it will be placed (the bottom centre for anything that stands, so rest_on puts it down), and attach its parts to it so it moves and copies as one.

**Check before finishing:**
- **Silhouette.** Render it against a plain background from the front, the three-quarter and the top with blender_set_camera (toolkit:3d-rendering/light-and-camera) and blender_render. A good asset reads as itself from its outline alone; if two views look the same, it lacks the details that make it what it is.
- **Polygon count.** blender_describe_scene gives each object's faces. A prop seen from across a room needs hundreds to a few thousand faces, not hundreds of thousands: lower subdivision levels, or the count of an array, until the silhouette starts to change, and stop just before it does. Anything to be scattered by the hundred is kept lightest.
- **Size and seating.** The answers give each object's size, bottom and top; an asset that floats above or sinks into what it rests on shows there.

**An asset for a game or another program** takes its looks as pictures: lay it flat with blender_unwrap (toolkit:3d-rendering/unwrap), then bake its materials, or a sculpted or detailed copy's shape, into maps with blender_bake (toolkit:3d-rendering/bake); the answer says how much of the layout the maps cover and what the rays missed.

**Export with blender_export,** in toolkit:3d-rendering/output: .glb for games, the web and other scenes, which keeps its materials and real size. Say how many faces it has and what it is made of, so the person knows where it fits.
