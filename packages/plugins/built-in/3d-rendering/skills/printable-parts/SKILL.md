---
name: printable-parts
description: Use when designing parts to 3D print: brackets, holders, enclosures, replacements for broken pieces.
---

Design a part that prints and fits the first time. Measurements, clearances and wall thickness come before looks.

Collect the dimensions that matter: what the part attaches to, the screws or pegs and their diameters, the load it carries. Ask when a measurement that decides the fit is missing. Think the part through in use: what rests on what, which way it tips, and the whole path of whatever passes through it. A cable, a screwdriver or a strap comes in one side and goes on out another, so its opening is a slot or a channel that runs to an edge, never a hole that ends in the desk or a wall.

Model it from simple solids joined with boolean unions, and make holes with boolean differences using cylinder cutters. Leave clearance: a hole for a 4 mm screw is 4.3 to 4.5 mm, and parts that slide together need about 0.2 mm on each side. Keep walls at least 1.2 mm thick and round outside edges slightly; avoid overhangs steeper than 45° where possible, or say that a support is needed.

Check it with blender_describe_scene: every mesh to print must be closed, and its size must match the plan. Its volume gives the plastic it needs (PLA weighs about 1.24 g per cm³).

Export with blender_export as .stl, which is written in millimetres for slicers. Render a picture of the part as well, so the person can check it before printing, from the side that shows its openings, and in a colour with some depth: white plastic on a white backdrop shows only by its shading.
