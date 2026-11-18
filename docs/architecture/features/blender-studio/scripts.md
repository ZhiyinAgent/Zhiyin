# 3D studio: scripts

Invariants of the [3D studio](README.md): what a script is given in `zhiyin`,
sculpting included. The README holds what the studio is for, its interface and
the invariants that hold for every call. Each invariant here is covered by a
test.

## Scripts and `zhiyin`

- **A script has `fcurves_of`,** which lists the F-curves keying a data
  block from its action slot, as Blender 5 keeps them, and an empty list for
  one not animated.
- **A script has `zhiyin` beside `bpy`, and its calls say what they did**
  (ADR 0022). Each call's measured line comes back in the script's answer
  after what it printed, a failed script names the calls undone with it, and
  the functions scripts reach are those the catalog lists, each opened as its
  call, arguments, an example and what it reports.
- **A pick chooses elements by meaning and never comes back empty.**
  `zhiyin.pick` takes a mesh's faces, edges or points by which way they face,
  height, a box, nearness, a side of a plane or a material, in the world as
  the object stands, grown by rings of neighbours; it selects them and says
  how many, their area and the extent of what it took. A pick that takes
  nothing is refused with what each condition alone takes and where the
  elements' centres lie. A pick kept by name is taken up by a later script.
- **A script builds a material in metres, and each step says where it lands.**
  `zhiyin.material` gives objects a material with a Principled BSDF and says
  the area each wears it on. Masks by the shape (edges, recesses, occlusion,
  up-facing faces, thin parts, points, the view's angle and loose parts) each
  say which engines show them and, measured on the faces that wear the
  material, where they land: edge lengths and their share of the surface, the
  up-facing area, the thinnest part by rays cast through the shape, the
  occlusion by rays cast into the scene, the points or the loose parts.
  Patterns (noise, cells, stripes, weave, cracks and flakes) are drawn at a
  size in metres on each object, read back from their nodes, and say how many
  fit across each object or that one is wider than it. Mixing, remapping,
  feeding an input and raising relief each say what feeds what in the words
  the scene's description uses; an input the shader lacks, a number for a
  direction and a value past an input's range are refused, since Blender
  holds such a value without a word. A mask or pattern given an option its
  kind does not take is refused.
- **A curve made from points says what it is; a node group's inputs are set
  by the names people see.** `zhiyin.curve` makes a bezier, NURBS or poly
  curve, open or closed, and says its length and its extent as drawn, tube
  included, its sharp corners, its tightest bend's radius and where, a tube
  wider than that bend, which folds into itself there, and where it crosses
  itself or its tube runs into itself, measured on the points Blender draws
  it through. `zhiyin.set_inputs` sets a Geometry Nodes modifier's inputs by
  their names, says each value as Blender holds it afterwards and what it
  was, a value past the input's own range (which Blender takes silently),
  and the nodes' warnings; an input the group lacks, or a value of the wrong
  kind, is refused with the inputs it has.
- **A node tree is built from a description and says what it makes.**
  `zhiyin.nodes` builds a Geometry Nodes tree on Blender 5.2's interface from
  its inputs, outputs, nodes by label and links between named sockets, puts
  it on an object as a modifier (in place of the tree of one of that name),
  sets its inputs by name and writes each output to an attribute of its name.
  Its answer gives each input as Blender holds it, what the tree evaluates to
  (points, faces, loose points, curves, instances) and its extent, instances
  included, and its nodes' warnings. A node type, socket or setting Blender
  lacks, or a link Blender marks invalid, is refused with what there is.
- **An edit says what it made against what was asked, and spends its pick.**
  `zhiyin.extrude`, `inset`, `bevel`, `bridge`, `fill`, `loop_cut`, `merge`
  and `symmetrize` work in the world's metres and say the faces, edges and
  points before and after, any open, loose, flat or crossing faces they
  changed, and a size that came out other than asked (a clamped bevel, a
  narrower ring). An inset that would turn its ring inside out is refused
  with how much fits. Each hands back a pick of what it made; the pick it
  used is spent, and every function refuses a spent pick. A bridge says how
  long the edges between its loops run and how far a bow moved them, and
  one between closed loops turned out of line says how many edges round and
  the twist that makes those edges shortest. Given faces, a bridge removes
  them and joins their rims, as Blender's own does. Between two loops that
  each border faces, as two patches on one side of a body do, the band is
  wound as those faces are, so the surface keeps facing out and the band
  does not cross itself where Blender's pairing would; each row a bow moves
  stays on its own edge between the loops. Between closed loops it says the
  band's section where it leaves them and at its narrowest, so a pinch
  shows. Edges with faces beside them extrude by a distance along those
  faces' normals, kept as far from them all round as Alt-S does, or onward
  past them; edges beside no face are refused a distance. `zhiyin.delete`
  deletes faces, edges or points as Blender's Delete does and names the
  holes it opens by their edges, handing back their rims; `dissolve` joins
  the faces round what it takes and names the n-gons it makes by their
  sides. A fill puts a grid of quads in
  each hole of an even number of edges unless asked otherwise, one face in
  any other, saying why, or a fan round each middle, and says the poles it
  leaves inside the surface by how many edges meet at them.
- **Faces are turned and imprinted by meaning.** `zhiyin.fix_normals` turns
  a mesh's faces out of each closed piece (a hollow's inner walls into its
  hollow) and with the rest of each open one, saying how many it turned and
  the largest. `zhiyin.imprint` presses an outline, lettering or a closed
  curve along a direction onto the surface it meets first and cuts it into
  that surface's faces with Blender's intersect as a knife, which needs no
  view; it says the faces inside and their area, raises or sinks them by a
  depth, and refuses an outline that passes off the surface or a knife that
  would reach the far side.
- **Loops, rings and outlines are taken by where they are, and say what they
  took.** `zhiyin.loop` and `zhiyin.ring` start from the edge nearest a point
  or from picked edges; `boundary`, `region_to_loop` and `loop_to_region`
  turn a mesh's rims, a face region and a closed loop into one another. Each
  says its edges, whether it closes, its length and where it lies, and an
  edge that leads into no loop or ring is refused with what meets at it.
- **Marks and shaping say what changed.** `zhiyin.mark` sets crease, bevel
  weight, sharpness or seam and says how many edges changed and how many now
  carry it; `circularize`, `space_evenly` and `flatten` say how far off round,
  even or flat the points were before and after; `move` says what moved fully
  and what partly within its falloff; `scale` scales the points along the
  world's axes about their middle or a point given, 0 pressing them flat,
  and `rotate` turns them about an axis through their middle or a point
  given; each says where they lay and lie.
- **A panel gap is measured along its seam.** `zhiyin.panel` cuts a groove
  round picked faces, or splits them off as a panel of their own with both
  thickened inward, and says the gap as measured from the panel's edge to the
  body's: one width all along, or its range and where it is widest. A gap with
  no seam to follow, or one that crosses the panel, is refused.
- **A retopology says how close it stays.** `zhiyin.retopo` remakes a closed
  mesh as quads, hides the source and says the share of quads, its poles, how
  far the source lies from the new surface and the change in volume. A source
  that is not one closed surface is refused with where it is open.
- **A script is told what this Blender's numpy lacks.** Blender's own numpy
  can come without its random numbers. The script tool says so where it is
  offered, and a script that asks for them is told so, and that Python's own
  random module is there.
- **A script says what it left in the scene.** After what it printed, its
  answer names each object it added, renamed, moved or resized, and removed,
  as the other tools say their own work: the object's size, where its bottom
  and top are, and what it goes into, so a part left floating or sunk shows
  before a picture is made. Of what one object goes into, the deepest three are named
  and the rest counted. Of an object it changed, the answer says how it was
  before in what changed: where it was, its size, its turn, what it was
  attached to and whether it was hidden. An object is told from the one it
  was before the script, whatever it is called now: one renamed is said as
  renamed, never as one removed and another added, and a copy the script made
  of one is added, whatever name each ends with. Past a dozen, objects are counted by
  the name they share, with how high they reach and how many moved and by
  how much, and the answer names the tool that says the rest of any of them. A script that only looks answers what it printed and no
  more.
- **A failed script is told by its own lines.** The answer gives the error
  and the way to it through the script, each line with its number and as it
  was written, and nothing of Zhiyin's own code or of the folder it is
  installed in.
- **A script's error says what Blender 5.2 changed.** A script that fails on
  an API Blender 5.2 changed from the Blenders models were trained on, as
  an action's `fcurves`, a mesh's auto smooth, a context given to an
  operator as a dict, the Principled BSDF's old input names or EEVEE's old
  settings, is answered after its error with the form Blender 5.2 takes and
  the pages to open. Each change is matched by the error the old form
  raises in Blender 5.2, and the form given instead runs there. Reading or
  setting a geometry-nodes modifier's input by `mod["Socket_2"]` is
  answered with where that input now is and its name, and the new form is
  not said twice. A script that fails for any other reason is told nothing
  of Blender 5.2. A script is read before it runs for the changes Blender 5.2
  runs without an error, such as a material's `blend_method` or `use_nodes`,
  and its answer says what each does in 5.2 and the form that works; a name
  in a comment is not counted. One page lists every change the studio knows,
  and another the Noise texture's inputs as 4.1 rebuilt it round the Musgrave
  texture.
- **A script never ends its Blender by an operator.** The operators that end
  a Blender with no window (loop cut, the sculpt filters, symmetrize, the
  sculpt mask and face-set operators, mask fill, UV stitch and projection
  painting) are refused while a script runs, each with an error naming it
  and the bmesh or data way to the same result, and the session carries on.
  A transform asked to snap, which without a window moves by the plain
  value, is refused with how to place by measured positions instead. On a PC
  whose graphics card cannot draw, a render with EEVEE or the solid view, or
  with Grease Pencil objects showing, an OpenGL render and a light-probe bake
  are refused too, each saying what to do instead.
  Zhiyin's own work calls them as they are.

## Sculpting

- **A sculpt stroke works on the mesh's own points and says what it did.**
  `zhiyin.sculpt` runs draw, clay, crease, inflate, grab, smooth, flatten or
  pinch along points laid on the surface or a curve, within a radius and
  fading by its falloff, repeated across the object's own axes, holding back
  the points a mask's vertex group weighs. It says the points moved, the most
  and where, the volume change or that the surface is open, and any new
  crossing faces. A stroke point further off the surface than the radius, a
  radius that reaches no point, an amount the brush does not take and a mask
  the mesh lacks are refused; a mirrored copy that falls off the surface is
  left out and said. Given a detail length, edges under the stroke longer
  than it are split before it and those it stretches past it after.
- **Whole-mesh filters and a remesh say the same measures.** Smooth, relax,
  sharpen, inflate and noise answer as a stroke does, and an option their
  kind does not take is refused. A voxel remesh says how far it strays from
  the shape before and the volume change, and carries masks over.
- **Fine detail goes through Multires.** A copy of the finest level is
  sculpted and put back point for point; the reshape is refused once the
  copy's points changed. The levels bake onto the base as a tangent-space
  normal map and a displacement map, saying the displacement's reach and the
  layout's coverage; a bake with no UV layout is refused.
- **Symmetry is measured point by point and restored without changing the
  points.** Points pair with their mirror by where they stood before
  sculpting; a point with no mirror is laid onto the mirrored surface.
