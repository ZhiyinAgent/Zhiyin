---
name: set-dressing
description: >-
  Use when arranging many objects in a 3D scene so they read as a lived-in place rather than a catalogue: a furnished room, a shop counter, a market stall, a workshop, a kitchen, a garden or a street corner.
metadata:
  stage: block-out model check
  domain: set-dressing
  gate: Every object touches what holds it, nothing goes into anything it should not, walkways stay clear, and the plan from above and the camera's view read as groups placed by use, not as a grid or a pile.
  works-with: scene-building interiors-from-plans making-assets simulations scene-stages
---

Dress a set the way a set dresser does: the place first, then what people use in it, then the small things that show someone lives or works there. Every piece has a reason to be where it is.

**Write the list as a table before placing anything:** each object, its real size, what it stands on or against, which group it belongs to, and roughly where. For forty objects this table is the plan; place from it and change it when the plan view shows a problem. Sizes come from what such things measure, said where they are not given.

**Each piece is an asset,** modelled as skill:3d-rendering/making-assets says before it is placed, those nearest the camera with the most detail: forty plain boxes and cylinders in good places are a block-out of a set, not a set. Make each kind of thing once, check it, then place it and its copies.

**Place the anchor pieces first:** the largest, those that stand against walls or edges, such as a bookcase, a sofa, a bed, a counter or a workbench. Set each one down with rest_on and push it against its wall with against in blender_edit_objects (toolkit:3d-rendering/modelling), so it touches the wall and the floor and the answer says gap 0 mm. Leave the walkways first: at least 0.8 m between pieces where people pass, 0.6 m in front of a drawer or a door that opens, measured surface to surface with blender_measure (toolkit:3d-rendering/measure).

**Then group what is used together,** three to five pieces a group: a reading corner (a chair, a lamp, a side table, a rug), a potting bench (a bench, a stool, a watering can, a sack of soil), a coffee tray (cups, a pot, a spoon). Groups sit where their use happens, against the anchors, not spread evenly across the floor. A group of an odd number reads more natural than a pair or a four.

**Break the grid.**
- Align edges that real use aligns, a jar's label with the shelf's front, a stool square to its counter, and turn the rest 5 to 15° from each other: a kettle to the right of a toaster, a stool pulled out a little.
- Vary the gaps between neighbours, so no row is evenly spaced unless it is meant to be, as shelves of jars in a shop are.
- Keep nothing on the exact centre line of a table, a shelf or a room: real things sit off centre, nearer the side they are used from.

**Everything touches what holds it.** A cup rests on its saucer, a book on its shelf, a frame against its wall, a rug on the floor with a chair's legs on the rug.
- Use rest_on, rest_across for one thing on two supports, against for a side, and to with a point, such as a vase's bottom-centre on the table's top-centre.
- For things that lie as they fell, logs stacked unevenly, cushions on a sofa, fruit in a bowl, drop them with blender_settle_objects, or drape cloth with blender_simulate (skill:3d-rendering/simulations).
- Many small copies over a surface, gravel, leaves, plants in a bed, go through blender_scatter (toolkit:3d-rendering/scatter) with weights for how common each is and sink to bed stones in soil.
- A thing used many times, a chair round a table or crates in a stack, is one object and its linked copies or instances, so memory holds one mesh.

**Check the arrangement from above and in numbers,** not only through the camera.
- blender_render with view plan draws the whole floor from above: groups should read as clusters by use, with clear walkways between them, and no straight rows or even spacing the plan did not ask for.
- After each change, read the answer's lines: what each object rests on, what touches nothing, farthest first, and what goes into what. A thing that floats or sinks into its neighbour shows there before it shows in a render; mark a bird or a drone as flying so it is not said to float.
- blender_describe_scene then gives the scene's faces drawn and held, the instances and the pictures in memory, and names the five biggest.

Finish by looking through the camera from two sides and listing what reads as placed by hand rather than by use; move those pieces, then look again.
