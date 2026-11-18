/**
 * The 3D studio's page on a scene's spec: where the file goes, each kind of
 * requirement it measures on the meshes and its fields, and what the answer
 * and the person's checks say.
 */

import type { WrittenPage } from "./written-pages.js";

export const specPage: WrittenPage = {
  id: "doc:3d-rendering/spec",
  title: "A 3D scene's spec: requirements measured on every change",
  summary:
    "The requirements.json a 3D scene is measured against after each change: its kinds, their fields, and the verdicts.",
  terms: [
    "spec",
    "requirements.json",
    "size",
    "thickness",
    "width",
    "reach",
    "wall",
    "overhang",
    "3D printing",
    "rests_on",
    "below",
    "above",
    "joined",
    "inside",
    "count",
    "faces",
    "polycount",
    "budget",
    "in_view",
    "fits",
    "clearance",
    "separate",
    "separate_in_motion",
    "animation",
    "passes through",
    "block-out",
  ],
  text: [
    'A spec is a workspace .json file: { "object": "kettle, 1.7 L", "requirements": [{ "id": "T2", "says": "Lid 2 to 3 mm thick", "check": "thickness", "part": "Lid", "range": [2, 3] }, ...] }. The scene is measured against requirements.json beside its file, or at the workspace\'s top, after every change and when it is opened or described. Write it before modelling, from the real object\'s sizes, and keep it as the person changes what they want. It is the same file the CAD studio reads: a kind only the CAD studio measures, such as hole or draft, is read and left to it.',
    "Sizes are in millimetres. A range is a number the measure must be, within 0.5 mm, or [least, most]. A part names an object, or a pattern between slashes, such as /Leg_.*/, for every object whose whole name it matches; a pattern that matches several is measured on each, the worst deciding, and the answer names that one and gives the others in brief, so one check covers every leg. A part is its own shape and the copies it places, without the parts attached to it; a group with no shape of its own, such as an imported model, is the shape of its parts. Up is +z.",
    "Kinds and their fields:",
    "- size: part; range [x, y, z] along the world's axes, each a range or null; or max and/or min [x, y, z].",
    "- thickness: part, range: how thick its material typically is, the shortest way through it, the median over 800 points spread over its surface. For a bar, a strap or a handle, its thinner side.",
    "- width: part, range: the other side of its material, square to the thickness: for a handle, how wide it is across.",
    "- wall: part, min: its thinnest material anywhere.",
    "- overhang: part, max: the steepest its faces may face down from upright, in degrees, as a printer builds it up from its bed, the part's lowest along up; up [x, y, z], +z by default; bridge: the widest gap in mm the printer crosses in the air, so a surface past max holds when its every point lies within half of it of an edge held up from below, one on the bed or with the surface beside it going on downward. As the CAD studio measures it: the answer gives the steepest face and where, or the surface past max reaching farthest, its area and middle.",
    "- reach: part, from, range: how far it reaches out from another part's surface, at its farthest, as a spout from its kettle.",
    "- rests_on: part, on: what it sits on, the ground at height 0 when left out. It holds when its surface comes within 1 mm of the top of what is under it, measured straight up and down from points spread over both, so a top rests on legs inset under it; neither floating nor sunk in.",
    '- below, above: part, other, by: how far, as a range; sides: the part\'s side then the other\'s, each "top" or "bottom". Left out, below compares the part\'s top with the other\'s bottom and above the part\'s bottom with the other\'s top, the gap between them. A handle\'s top 10 to 15 mm under the rim is below with sides ["top", "top"] and by [10, 15].',
    "- joined: parts: they touch or go into one another, so they hold together as one piece; one part alone holds when its mesh is one piece.",
    "- inside: part, of: a part, a pattern or a list, taken together, as walls and a floor: every point of it lies in one's solid, or is walled in by them: every level way out meets them, and so does the way down, as a sofa in a room or soup in a pot. A part outside is said with its farthest point out and how far that point is from their surface. A point in the notch outside an L-shaped room is out; so is one in an open-fronted shelf, for which rests_on and below say where it sits.",
    "- count: part, a pattern or a name; range, whole numbers: how many objects are drawn by it, instances included.",
    "- faces: max, parts: the most faces drawn, every instance counted; the whole scene when parts is left out.",
    "- in_view: parts, camera: they lie wholly in the camera's frame, the scene's camera when left out; the margin is how near the frame's edge they come, as a share of the frame.",
    "- fits: box [x, y, z], parts, turned: whether the parts together fit in a box, turned a quarter at a time when turned is true, the default.",
    "- clearance: between: two parts or patterns, min: the least gap between them, surface to surface.",
    "- separate: parts, all when left out: no two go into each other, at the scene's moment.",
    "- separate_in_motion: parts; max, the deepest in mm one may go into another, none when left out; start and end in seconds, the timeline's when left out; every, how many frames apart the frames measured are, 1 by default: no two go into each other at any frame measured, as a cloth pulled from a table passes through no plate. Measured on the parts' surfaces as the motion report measures them; the answer gives the deepest overlap, between which parts, when, and over which spans. A cloth among the parts also fails where its edges go through a closed other, as when it steps right past a thin plate or glass wall with no point ever inside: the answer says what it goes through, when, and how much of the cloth, however small the depth. A part moved by a simulation is measured from its bake: until blender_simulate bakes it over the frames asked, the requirement is not checked, as stepping it from its start would hold up every change. A long motion keeps within the spec's 30 s with every.",
    "The answer says how many hold, then only what does not, each with what was measured and how far past its limit, and how its margin moved since the last change; requirements that could not be measured are said with why. The measures take at most 30 s together, and requirements left when the time is up are said not checked; a clearance cut short that already fails is said with the nearest found. A dense part is measured at an even spread of its points: up to 20,000 for reach, 5,000 for in_view, 2,000 for inside and, for how near two parts come, 4,000 corners a side and 4,000 points spread over its faces by area, closed on from the nearest found. joined tells at most 5,000 pieces of a part apart. The person sees every verdict. A requirement that failed and left the file is named once. A file that cannot be read does not stop the change: the answer says which requirement and field to mend. The first time every size and fits requirement holds, the person is shown the block-out and may step in; the work goes on unless they do.",
  ].join("\n"),
};
