---
name: subd-modelling
description: >-
  Use for soft, flowing forms in the 3D studio that no primitive or profile gives: a mouse, a remote, a soap bar, a cushion, a toy, a handle, a car's panel, a creature: a coarse cage of quads smoothed by subdivision, with edges held where the form is tight.
metadata:
  stage: model
  domain: product organic
  gate: The subdivided surface reaches the sizes planned and shades smoothly from two sides, with no pinch, crease or facet where none is meant.
---

**A subdivision surface is a coarse cage** of four-sided faces that Blender smooths into a soft surface lying inside it. Build the cage with blender_run_script and bmesh, then subdivide and smooth it with blender_shape_objects (open toolkit:3d-rendering/modelling).

**The surface shrinks inside its cage.** A plain box cage subdivided comes out at about 84% of its width, round as a pebble. Where the form is tight, hold it with support loops close to the edge: the nearer the loops, the tighter the round and the closer the surface comes to the cage's size. A two-segment bevel of the cage's edges puts a loop each side of them; with loops 5% in from every edge a box comes out at 99.8% of its size with small, clean rounds. A loop across a ring of faces is cut with `bmesh.ops.subdivide_edgering(bm, edges=ring, cuts=1)`; `bpy.ops.mesh.loopcut` ends a Blender without a window, and the studio refuses it.

**For example,** a soap bar 90 × 60 × 30 mm, soft on top and held tight along its flat base:

    import bmesh
    mesh = bpy.data.meshes.new("Soap")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.09, 0.06, 0.03), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, 0.015), verts=bm.verts)
    base = [e for e in bm.edges if all(v.co.z < 1e-6 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=base, offset=0.002, segments=2, affect="EDGES")
    bm.to_mesh(mesh)
    bm.free()
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("Soap", mesh))

**Then subdivide and smooth:** blender_shape_objects with a subdivision of 2 levels and a smooth step. The smooth step is Blender's Smooth by Angle, kept after the subdivision, so it shades the smoothed surface, whose faces meet at small angles, and keeps sharp only a crease the surface really has. Make the cage larger than the size wanted where it has no support loops, and read the size from the answer.

**Read the cage in the subdivision's answer** before trusting the surface: it counts the cage's quads, triangles and faces of more than four sides, its poles (points where 3, or 5 or more, edges meet) with a place for each, the edges it creases and its shortest and longest edge. A box-like cage has its eight 3-edge poles at its corners; a pole elsewhere, a triangle, or a longest edge many times the shortest is where a pinch or a ripple shows. Then look at it with blender_look and shading reflections: smooth bands mean a smooth surface, and the answer gives where neighbouring faces turn most from each other.

**Creases** hold an edge without extra loops: a float attribute on the edges, `crease_edge`, 0 to 1, which the subdivision uses (`edge.crease` was removed in Blender 4.0). In bmesh: `layer = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")`, then `edge[layer] = 1.0`. A full crease keeps the edge at the cage's size but leaves it hard; support loops give a real round, as anything moulded or sewn has. To crease chosen edges in the subdivision step, pick them with `zhiyin.pick(obj, "edges", ..., name="rim")` in a script, then give the subdivision crease 1 and edges "rim".

**Keep the cage clean:** quads, spread evenly, with as few faces as hold the form; a triangle or a face of five sides or more pinches the surface round it, and a point where five or more edges meet belongs on a flat stretch, not on a highlight. Mirror before subdividing for anything symmetric. Two levels suit most views; three where the outline is seen close, since two leave its silhouette faceted. Check the outline and the shading from the front and the three-quarter, and from below for anything that stands.
