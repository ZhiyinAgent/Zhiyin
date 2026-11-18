---
name: sculpting
description: >-
  Use for forms that are sculpted rather than built in the 3D studio: a face, a creature, a statue, a rock with character, folds in leather or fabric, worn or eroded surfaces, and fine detail baked into maps for a light model.
metadata:
  stage: model check export
  domain: sculpting organic
  gate: The sculpt reads as itself from the front and the three-quarter, its symmetry measured where it should be symmetric, at a face count that suits where it is used.
  works-with: scene-stages subd-modelling making-assets rigging
---

Sculpt like a sculptor: big forms first, then the secondary ones, and the fine detail last, checking the whole from several sides at each step. You do not drag a brush by hand: each stroke is a list of points in the world, so plan strokes from the sizes blender_describe_scene gives, in metres.

**The functions** are in the zhiyin script library, used in blender_run_script; each has a catalog page by its id, such as function:3d-rendering/zhiyin.sculpt:

- zhiyin.sculpt: one stroke with a brush, draw, clay, crease, inflate, grab, flatten, pinch or smooth, with a radius, a depth or a strength, mirror across the object's axes, and a mask.
- zhiyin.sculpt_filter: the whole mesh at once, smoothed, relaxed, sharpened, inflated or roughened with noise.
- zhiyin.sculpt_mask: a mask made from picked points, so a stroke leaves the rest alone.
- zhiyin.sculpt_remesh: even voxels again, between passes.
- zhiyin.sculpt_detail, then zhiyin.sculpt_reshape: Multires levels and a copy to sculpt fine detail on, put back into the levels.
- zhiyin.sculpt_bake: the levels baked into normal and displacement maps on the base mesh.
- zhiyin.symmetry measures how far the shape is from symmetric; zhiyin.sculpt_symmetrize makes it so.

**Start from a base that already has the main proportions:** a block-out of primitives joined, or a subdivided cage (skill:3d-rendering/subd-modelling). Remesh it with zhiyin.sculpt_remesh at a voxel about a hundredth of its size, so the brushes have even points to move.

**Work from big to small:**
- the big forms with a radius a quarter to a half of the part;
- then the secondary forms, a muscle, a brow or a fold, at a tenth;
- then the fine detail, pores, scratches and creases, at the size the real ones have.

Use mirror x for anything symmetric, and remesh again when strokes have stretched the faces. Fine detail goes on Multires levels with zhiyin.sculpt_detail, as remeshing would blur it.

**Check after each pass** with blender_look from the front and the three-quarter, shaded and with faces coloured by the way they point: a sculpt that reads in one view can be flat or lumpy in another. A face or a creature meant to be symmetric is measured with zhiyin.symmetry rather than judged by eye.

**For a light model,** a game asset or one to scatter, bake the detail into maps with zhiyin.sculpt_bake, or bake from the sculpt onto a low copy with blender_bake's from, in toolkit:3d-rendering/bake, after blender_unwrap in toolkit:3d-rendering/unwrap. blender_measure's deviation, in toolkit:3d-rendering/measure, says how far the low copy strays from the sculpt. A sculpt to be animated is rigged after it is finished (skill:3d-rendering/rigging), and its base keeps loops round the joints.
