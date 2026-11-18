/** The written pages for blender_simulate's rigid bodies, baking and geometry nodes simulation zones. */

import { materialDensities, statedNumbers } from "./stated-numbers.js";
import type { WrittenPage } from "./written-pages.js";

const simulate = statedNumbers.simulate;

const lines = (...said: string[]) => said.join("\n");

export const simulateBodyPages: readonly WrittenPage[] = [
  {
    id: "doc:3d-rendering/physics",
    title: "3D physics: rigid bodies, keeping where they rest, and baking",
    summary:
      "How blender_simulate gives objects to the rigid-body physics, weighs them, runs and measures them over the timeline, keeps them where they rest or keys their motion, and bakes every simulation in the scene.",
    terms: [
      "blender_simulate",
      "rigid",
      "rigid body",
      "mass",
      "density",
      "collision shape",
      "settle",
      "to_keys",
      "bake",
      "point cache",
      "physics",
      "baked range",
      "stability",
      "soft body",
      "particles",
    ],
    text: lines(
      "rigid gives groups of objects to Blender's rigid-body physics. Each group has a role:",
      "- active (default): falls and is pushed. It is weighed by exactly one of density (kg/m³), material, or mass (kg). With a density or a material its mass is its closed volume, measured on its shape with every step on it, times that density; a shape that is not closed has no volume and needs a mass.",
      "- passive: held still, as a floor, a table or a bowl. It has no mass.",
      "- animated: moved by its own keys (key it with blender_animate first), pushing what it meets, as a paddle or a door. It has no mass.",
      `material is one of Blender's table, in kg/m³: ${Object.entries(
        materialDensities,
      )
        .map(([name, density]) => `${name} ${density}`)
        .join(", ")}.`,
      "",
      `shape is how the physics sees each object: hull (its convex outline), mesh (exact, for anything hollow: a bowl, a cup, a box with an open top), box, sphere, cylinder, capsule or cone. By default an active body is its hull, and a passive one its hull where it is convex, as a floor or a table top is, and its mesh where it is not: a box dropped flat onto a floor seen by its mesh lands sliding and turning, which onto its hull it does not. friction is ${simulate.friction} by default; bounce is 0 to 1, ${simulate.bounce} by default. Shapes are given a ${simulate.margin_mm} mm margin.`,
      "Bodies that start inside each other are refused with how deep, as are bodies inside another's convex collision shape: fruit in a bowl seen by its hull is inside the hull, so give the bowl shape mesh. An object attached to another, or an active one moving by keys, is refused.",
      "",
      `world sets gravity (m/s², (0, 0, ${simulate.gravity_z}) by default), substeps a frame (${simulate.substeps}) and solver iterations (${simulate.iterations}): more substeps keep fast, small or thin bodies from passing through each other. The physics runs over the scene's timeline from its first frame; set its length with blender_animate.`,
      "",
      `The answer gives each body's role, shape and mass, the world, and for each active body: when it comes to rest (slower than ${simulate.rest_speed_mm} mm/s and ${simulate.rest_turn}°/s to the end), its top speed and when, measured frame to frame, what it rests on (another body within ${simulate.rests_on_mm} mm), and where it is at the end; or that it is still moving at the end, at what speed, so make the timeline longer; or that it touches no other body, as one that fell off. The scene is back on its frame after.`,
      "",
      "then settle keeps each active body where it is at the end of the timeline as its plain place, for a still, and removes the rigid-body physics. then to_keys keys each active body's place and turn on every frame, drops keys a straight line between their neighbours already gives, and removes the physics, so the motion plays and exports without it, as glTF or FBX keys.",
      "",
      "bake: true bakes every simulation in the scene over the timeline, in the order one depends on another: the rigid-body world, cloth, soft bodies, emitted particles and hair dynamics, dynamic paint, liquids and smoke, then geometry nodes simulation zones. Each answers its frames, the seconds it took and its cache's size and where it is kept, or why it failed; one failing does not stop the rest. Nothing is written beside the scene. Rigid bodies, cloth, soft bodies, particles and simulation zones are kept in the scene file, a cache set to disk switched to it; a liquid made with liquid is baked into a new folder of the conversation's own, so a scene put back keeps the liquid it was baked with. Dynamic paint, which Blender caches only in a folder beside the scene, a liquid whose cache folder is the scene's own, and a zone set to bake to a folder of its own are left for a script to bake, and freeing leaves them as they are. A baked simulation no longer follows changes: after moving what it meets, bake again, or bake: false to free every bake.",
      `After a bake, each baked cloth, soft body and particle system is stepped through its frames and said sound or unsound: its top speed against ${simulate.blown_speed_share} times what a fall through the scene's height reaches, at least ${simulate.blown_least_speed} m/s, past which it blew up; a cloth's or soft body's box from its first frame to its last, unsound past ${simulate.blown_growth} times its size, and whether it still moves over its last ${simulate.settled_seconds} s; the particles alive at the end; and, for a soft body or particles, the points left inside a closed collider.`,
      "A simulation not baked is worked out from the frame before: a frame sheet, close-ups or a still at a moment reach it by stepping every frame from where it starts, and say so; with every simulation baked, a moment is read straight from the bakes, and each look names the bake it read and any frames it does not reach. blender_describe_scene lists each simulation with the frames it is baked over against the scene's, or as not baked. A video is refused when it would show a simulation wrongly: one baked over fewer frames than the video runs, or one not baked while the video starts after it, skips frames, slows time or is drawn over several calls. Rendered from its start in one call, an unbaked simulation is worked out by Blender as it renders, as the answer says.",
      "For simulation zones: doc:3d-rendering/simulation-zones.",
    ),
  },
  {
    id: "doc:3d-rendering/simulation-zones",
    title: "Geometry nodes simulation zones, and checking one after a bake",
    summary:
      "How a geometry nodes simulation zone is built in a script with its exact node and socket names, Delta Time and Skip, and what blender_simulate checks after baking it.",
    terms: [
      "simulation zone",
      "GeometryNodeSimulationInput",
      "GeometryNodeSimulationOutput",
      "Delta Time",
      "Skip",
      "state_items",
      "pair_with_output",
      "geometry nodes",
    ],
    text: lines(
      "A simulation zone carries a state from one frame to the next: what its output gives at a frame is its input at the next. Build it in blender_run_script:",
      "  si = tree.nodes.new('GeometryNodeSimulationInput'); so = tree.nodes.new('GeometryNodeSimulationOutput'); si.pair_with_output(so)",
      "The pair starts with one state item, Geometry. Add more with so.state_items.new(socket_type, name), such as so.state_items.new('FLOAT', 'Time'): each item is a socket of that name on both nodes (sockets Geometry and Time on the input node's inputs and outputs, and on the output node's).",
      "- Simulation Input's inputs are the state at the first frame; its outputs are the state from the frame before, and Delta Time, the seconds since the frame before: 0 on the first frame, then 1 / frame rate (0.0417 s at 24 frames a second). Scale every rate by Delta Time, so a speed in m/s moves Delta Time × speed a frame.",
      "- Simulation Output's inputs are Skip, a boolean, and the state for the next frame. While Skip is true the state is held as it was, unchanged: the zone pauses.",
      "Link from the input node's outputs to the output node's inputs by name: tree.links.new(si.outputs['Geometry'], ...), tree.links.new(..., so.inputs['Geometry']). Use the output node's outputs after the zone.",
      "A zone runs over the scene's timeline from its first frame; it is worked out frame by frame, so a still at a moment steps through every frame before it.",
      "",
      "blender_simulate bake: true bakes each zone over the timeline and packs its bake into the scene file; a zone set to bake to a folder of its own is left for a script. After the bake it steps through every frame and says the zone object's point count (mesh points, point cloud points, curve points and instances): the same at every frame, or from the first frame to the last and the most; whether every position stays finite, and if not the frame it stops being finite, with how far the points had gone the frame before; and how far its points reach from the object's origin. A state that grows each frame without bound, as positions multiplied every step, turns to infinity: the zone blew up.",
    ),
  },
];
