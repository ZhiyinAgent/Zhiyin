/** The written page on blender_simulate's cloth, colliders and liquids. */

import { percent, statedNumbers } from "./stated-numbers.js";
import type { WrittenPage } from "./written-pages.js";

const s = statedNumbers.simulate;

const lines = (...said: string[]) => said.join("\n");

export const clothAndLiquidPage: WrittenPage = {
  id: "doc:3d-rendering/cloth-and-liquid",
  title: "Cloth, colliders and liquids in a 3D scene",
  summary:
    "How blender_simulate makes a mesh cloth, pins, inflates, sews and drapes it over colliders, and bakes a Mantaflow liquid in a container, with what each answer measures.",
  terms: [
    "blender_simulate",
    "cloth",
    "drape",
    "tablecloth",
    "curtain",
    "cushion",
    "collision",
    "pinned",
    "liquid",
    "fluid",
    "mantaflow",
    "water",
    "pour",
    "voxel",
    "colliders",
    "soft body",
    "particles",
  ],
  text: lines(
    `Cloth: cloth.object is the mesh made cloth. fabric is one of Blender's own presets: cotton (default), silk, denim, leather, rubber. A cloth given again without fabric keeps the fabric it has, a script's own settings included, and the answer says its stiffness; giving fabric starts it again from that preset. subdivide_to cuts every edge until the points are at most that far apart: a cloth folds only as finely as its grid, about twice its spacing, and a grid finer than ${s.tuned_spacing_mm} mm is given more steps a frame so it does not stretch. A cloth past ${s.most_cloth_points.toLocaleString("en")} points is refused as too slow.`,
    "- pinned holds points still: group (a vertex group of the mesh), edge (top, bottom, +x, -x, +y, -y, or border: all round its open edge) or points ([x, y, z] points, each pinning the cloth's nearest point). An edge or points go in a vertex group named Pinned. pinned.release is a time in seconds on the timeline at which the pinned points let go and move freely from then on, for a cloth that moves over the scene's frames; the answer gives the time and frame. A cloth set up again without release is held throughout.",
    "- pressure inflates a closed mesh, as a cushion or a balloon; an open one is refused. The answer gives its volume before and after.",
    "- sew pulls each loose edge (an edge with no face) shut, joining the panels it spans; the answer gives the longest seam before and after.",
    `- colliders: the objects it meets. Each gets collision as the last of its steps, so the cloth meets the shape as it shows, and keeps ${percent(s.collision_share)} of the cloth's spacing from it on each side, so the cloth rests ${percent(2 * s.collision_share)} of its spacing off. The cloth also meets itself; self_collision false turns that off, and a cloth given again without self_collision keeps what it has, a script's own setting included, and the answer says which.`,
    `- drape: true runs the cloth, damped by air ${s.drape_air} times as much as the fabric (which slows it without changing where it rests), from frame 1 until no point moves more than ${percent(s.drape_rest_share)} of its spacing over ${s.drape_last_frames} frames, at most ${s.drape_seconds} s, keeps that shape as the mesh and removes the cloth and the collision it gave, for stills. Steps before the cloth are taken into the shape; those after it stay. Without drape the cloth moves over the scene's frames, from where it is at the first.`,
    "- steps sets the steps a frame Blender takes. A point that moves further in one step than the cloth keeps from a collider (its distance plus the collider's thickness) can step past a thin wall or plate. More steps cost bake time in step.",
    "After a bake, a moving cloth is checked at every frame for any collider it went through: an edge of the cloth that runs in through one side of a closed one and out through the other, which points found inside it would miss when they step right past, or an edge across an open one, as a floor of one face, or a point whose way since the frame before crosses it. The answer names the collider, the frames, the most edges at once and the share of the cloth's points, then what stops it. Pinned points carried through a collider while their pins hold are said so: pins follow what holds them, and no collider stops them. A cloth that starts squeezed, closer to a collider above and one below than it keeps from each, is pushed into one of them however many steps it takes: leave twice what it keeps between them (a book on a rug sits that far over the floor) or give the colliders less thickness. Otherwise the answer gives the steps a frame that keep its fastest points within what it keeps in one step; where they already were, a slower motion or a stiffer fabric is what holds it.",
    "- To pull a cloth from under things, as a dust sheet off furniture or a rug from under a chair: drape it first so it hangs over the edges as cloth does, then simulate it again pinned where a hand would hold it (points along its hanging edge) and key the pull with blender_animate on the cloth object's place: pinned points follow the object, and the rest is pulled along by the cloth. Pinned where it lies flat, the overhang is held out flat in the air. Give pinned.release a time just after the held edge has cleared what the cloth lay over, so the cloth falls free rather than being held out in the air and whipped about.",
    `The drape's answer gives when it came to rest or how much it still moved, how far it rests off each collider, its folds (edges folded past ${s.sharp_fold}°: past ${percent(s.grid_bound)} of them, the grid sets the folds, and subdivide_to half the spacing gives finer ones) and whether it is sound: how far it stretched against its rest lengths, points inside a collider, and faces crossing each other. A cloth stretched past ${s.exploded} times or with points flying off has exploded.`,
    "",
    `Colliders for every simulation: colliders.objects are meshes every cloth, soft body and particle system in the scene meets, those a script made included. Each gets collision as the last of its steps, after whatever deforms it, so it is met as it shows, as thick on its outside as ${percent(s.collision_share)} of the finest cloth or soft-body spacing, or colliders.thickness metres, at least ${statedNumbers.simulate.thinnest_collider_mm} mm, the least Blender keeps, or ${statedNumbers.simulate.particles_collider_mm} mm when only particles meet it. A simulation that meets only one collection of colliders is said to pass through those outside it. A simulation baked before does not see a new collider until it is baked again. A scene with no cloth, soft body or particles is refused: rigid bodies collide by their own shapes, and a liquid meets its obstacles.`,
    "",
    "Liquid: Mantaflow's FLIP liquid, baked over the scene's frames as part of the call. liquid.sources lists where it comes from: flow shape (default) turns a closed object's volume into liquid at the start, as a splash or a blob; flow pour lets liquid in from the object at every frame, as a tap, speed giving its starting velocity in m/s. Sources are hidden from renders: the liquid shows in their place. container is what holds it, and obstacles what it flows round; each is a mesh the liquid cannot enter. preset: water (default), oil (slower to spread) or honey (holds together), each with a clear material of its own.",
    `- The domain, the box the liquid lives in, is made round the container and the sources (without a container, round the sources and obstacles), ${percent(s.domain_margin)} larger each way. Its sides and top are open: liquid that leaves by them is gone, and its floor holds what falls on it. resolution is the voxels along its longest side, ${statedNumbers.simulate.liquid_resolution} by default, a draft; or voxel gives their size. Bake time grows steeply with resolution (doubling it took five times as long for a small glass), so bake a draft first and raise it for the final.`,
    `- Before the bake, each obstacle's thinnest wall is measured against the voxel: walls thinner than ${s.holding_voxels} voxels may let liquid through, and the answer gives the resolution that holds them.`,
    `- After it, the liquid's volume at ${s.measured_frames} frames across the bake, sampled on a grid inside its surface and outside every obstacle (Mantaflow's surface reaches into the obstacles it touches), against what the sources hold; the volume outside the container's outline, and how deep it stands in the container and how far below the rim; the bake's seconds and the cache's size. The cache is kept in the conversation's own folder, outside the workspace, a new one for each bake. A liquid set up again replaces the domain made before.`,
  ),
};
