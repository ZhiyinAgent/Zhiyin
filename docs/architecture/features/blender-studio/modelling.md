# 3D studio: modelling

Invariants of the [3D studio](README.md): adding, placing, sizing and shaping
objects, scattering copies and measuring. The README holds what the studio is
for, its interface and the invariants that hold for every call. Each invariant
here is covered by a test.

## Shaping

- **A cut is said as measured.** A boolean's answer comes from the part's
  shape before and after it: the volume taken away or added, and a cut's
  width across and depth along the cutter's own axis, or that it goes
  through. A cut that takes nothing away is refused, saying so and why where
  it can: a cutter that is not closed, or one that does not reach the part.
  Where the result has faces doubled or without area, as shapes that share
  faces leave where they meet, its points less than a micrometre apart are
  joined, so they join into one clean shape. A cutter described in the call
  is a box, cylinder, sphere, box with rounded upright edges, slot with round
  ends, prism on an outline or lettering, each standing along its own z. A
  result with sliver faces under 0.01 mm², where the part's faces and the
  cutter's nearly meet, says how many and where, as does one with open edges
  the part did not have.
- **A displace says where its pattern can show.** Held to the faces facing
  up or sideways, it moves each point by the share of its faces that face
  that way, and nothing elsewhere. Where the edges it moves are longer, at
  their median, than its pattern is across, its answer says so and how fine
  to subdivide; noise, which has no size, refuses one.
- **Each shaping step is said as measured.** A step's answer comes from the
  shape before and after it. Rounding names how many edges it rounds, and one
  that rounds none, every edge being blunter than its angle, is refused with
  the sharpest edge's angle. Repeats say how far apart they are and the gap
  between them, or how far each goes into the next; repeats in one place are
  refused. A mirror says how far apart its halves stand or that what reached
  across was cut away, and a mirror that leaves the shape as it was says so.
  Thickening a closed shape says it is now a sealed hollow, with its volume
  before and after. Subdividing gives the faces before and after, how far
  it shrinks the shape, and the cage read before smoothing: its quads,
  triangles and faces of more than four sides, its poles by how many edges
  meet at them, each kind with a place, the edges it creases, and its shortest
  and longest edge; it creases the edges sharper than an angle or those of a
  pick kept by name, and a name no pick of edges has is refused with those
  the mesh keeps. Smoothing by angle is Blender's Smooth by Angle step, kept
  last and its node group kept in the file, so the edges later steps make
  are shaded by its angle; it names the edges kept sharp, and shading flat,
  smooth or by marked edges removes it. Removing a step gives the faces and
  size it leaves. A closed shape's answer ends with its thinnest wall and
  where.
- **A remesh says how far it strays.** It bakes the steps before it, and its
  answer gives how far the new surface strays from the shape before: the
  most, the mean, what 95% of it lies within, and where. A deviation between
  any two shapes, from a script or a measure, is measured both ways over each
  whole surface. A closed shape's remesh says its volume change in percent; a
  QuadriFlow remesh says its poles of 3, 5, and 6 or more edges, and one of a
  shape whose edges join more than two faces is refused, saying where. A
  voxel remesh that would make more than 2,000,000 faces is refused alike as
  a shaping step and between sculpt passes, with the faces it would make and
  the smallest voxel that keeps within them, estimated at 1.5 faces for each
  voxel-sized square of surface, as Blender makes on a curved surface. The
  faces are counted on the mesh as Blender remeshes it, in its own space by
  voxels scaled with the object's largest scale, so a shape squashed by its
  scale is refused by the faces its mesh would make, not by its smaller
  surface in the scene.
- **A boolean says its solver.** One chosen for the shapes says which solver
  it used and why; the manifold solver refuses an open shape; a cut whose
  shapes only touch in one plane is refused saying so.
- **A mirror's seam is said.** On each mirror plane it is closed, opens beyond
  its merge distance, or overlaps when the mirror does not cut what reaches
  across.
- **Copies round an axis say how they stand.** Their angle apart, their
  distance from the axis and the gap between neighbours; copies along a
  curve say how far their middles lie off it.
- **Walls, cages, shading and wraps are measured.** Walls are measured
  between their two shells; a subdivision says how far its surface lies in
  from the cage; shading steps say how many faces shade flat and the share of
  the surface they cover; a wrap says how many points lie on the target and
  how far the rest remain.
- **An input a shaping step's kind does not take is refused,** naming the
  kinds that take it. A CAD part's remesh, displace, wrap and hard-surface
  stack are refused like its other shape changes.
- **A mirror never overlaps itself.** What reaches across the mirror is cut
  away, keeping the side the object mostly lies on, so the result is the
  shape mirrored and its volume is counted once.
- **A bevel never rounds a shape away.** A bevel wider than half the object's
  thinnest side is refused, and the refusal says the most it can be.
- **Walls are as thick as asked.** Thickening grows walls inward, so the
  outside keeps its size, and they keep their thickness at corners.

## Adding shapes and models

- **A shape adding makes lays its picture at its real proportions.** A box,
  a plane, a cylinder and a cone are laid out after they are sized: each
  flat face on its own and a round side unrolled in one piece, every piece
  at one scale, apart from the others and none turned over, in the
  picture's square. A sphere is laid out by longitude and latitude, as a
  picture of a globe expects. Resized by the edit tool, a shape whose layout
  is still the one adding laid is laid out again at its new proportions,
  which the answer says where a picture is laid by it; a layout the person
  or a script made stays as it is. A shape adding makes names its layout
  UVMap.
- **A primitive's answer says what it is made of:** its faces and points by
  the counts that set them, and for a tapered tube or one of a drawn
  section, how wide it is across at each end.
- **Round is smooth unless asked otherwise.** A tube is a curve through its
  points, ends included, or straight runs between them when its corners are
  sharp. Round shapes are smooth-shaded with their sharp edges kept crisp, or
  flat when asked; every other shape, an outline included, is flat. A model
  file asked to be smooth is shaded so in every part, its sharp edges kept.
- **A profile off the axis turns into a solid ring.** A turned profile of
  three points or more that touches the axis at neither end is closed, its
  last point joined to its first, so a band, a sleeve or a washer is a closed
  shape; it stays an open sheet only when asked, and two points always do.
  A profile with both ends on the axis is closed by the axis, asked to be
  closed or not.
- **Lettering and drawings are shapes.** Text and SVG drawings are meshes, so
  they can be rounded, cut into and joined like any other shape, and the
  scene names a text's lettering.
- **Lettering bends with a round surface.** Text given the radius of a jar
  or a bottle lies on it along its whole length, its back on the surface,
  and is as long along the surface as it was flat. Text longer than the way
  round is refused, and both the approval and the answer say it is bent.
- **An opened scene says when its units are not metres.** A file whose unit
  scale is not 1, or that shows feet and inches, is said to, with what that
  means for the sizes the tools give and take.
- **A size is the object's own.** An object's size is along its own axes,
  before it is turned, both when it is given and when it is said back, so
  resizing a turned object changes it along its own length. A subdivided
  shape is measured by the shape it shows, not the box of its cage.
- **Heights are the object's own.** Wherever an object's bottom and top are
  said, in describing the scene and in an answer that places it, they are
  its own shape's, beside its own size; where what is attached to it reaches
  lower or higher, that span follows, marked as with what is attached. A
  group with no shape of its own is as high as its parts.
- **A location is an origin.** Solids, text, pictures and drawings are centred
  on their origin; a shape drawn through points (a turned profile, an outline,
  a tube) keeps the coordinates it was drawn in around it, and so does a model
  file, round the file's own origin, so a part designed in CAD is where the
  design put it. A drawing lands where it is asked, at the width and the depth
  asked; a model's origin lands there, at the size asked.
- **A model's parts arrive unturned.** The quarter turn a modeller that works
  with z up wraps a glTF model in is built into its parts' shapes: each part
  stands unturned in the world, its origin where it was modelled, so a key of
  its turn starts from where it was made. Its shading is kept. A model with
  anything but meshes and empties, or anything animated, arrives as it is.
- **A model takes new shapes and keeps the rest.** Given a model file, an
  object and its parts take the shapes of the file's parts of the same names,
  about the origins the file gives them, and keep their place, turn,
  attachments, materials, steps and motion. The answer names the parts given
  a shape, those whose size changed, those the file lacks and those it adds;
  nothing else of the file is left in the scene. A CAD part's size is the
  one the CAD studio measured on the exact solid, when both its old and new
  shapes carry one, so a part meshed again more or less finely is not said
  to have changed, and one that changed is said by its exact sizes. The file is a workspace one,
  checked before it is approved.
- **A model file's meshes arrive whole.** Points a file stores apart in the
  same place are joined as it is read, so a shape whose faces meet is closed
  in the scene; edges where the file's normals part stay sharp. All of a
  file's parts are joined in one pass, so a model of hundreds of parts comes
  in within seconds. Its parts turn by angles about x, y and z, as every
  other object does, so a turn a script sets takes; parts the file animates
  keep the turns their keys use.
- **A model file is measured as its shape.** A part whose faces each keep
  their own corners, as model files often store them, is measured as closed
  when its corners meet, with its volume.
- **A CAD part keeps its surfaces apart.** Each group of surfaces the CAD
  studio named is a material slot of its own, and keeps the material it was
  given through a new shape from the CAD. A material can be given to one
  group, or to the rest of the faces, leaving the others as they were; given
  no name, it is a material of that group's own, never the part's. A group
  the object lacks is refused with the groups it has. Describing the object
  gives each group's material.
- **A changed material says where else it shows.** Changing a material that
  other objects, or other groups of a part's surfaces, also show changes
  them too, and the answer names them.
- **A CAD part's shape changes only in the CAD.** Rounding, subdividing,
  thickening, cutting, mirroring or repeating a mesh marked as a CAD part's
  is refused before anything changes, and the refusal says how to make the
  change in the CAD and bring the new shape in.

## Placing, sizing and assemblies

- **Every answer places what it moved.** Adding, moving or shaping an object
  answers with its size, origin, bottom and top heights, and what it goes
  into; a resting contact is not counted as going into. An edit says what it
  changed from: where a moved or set-down object was, a resized or scaled
  one's size and a turned one's turn before, and where each copy landed. Heights are its
  shape's, so a round part turned about its axis is as high as it is across,
  and rests on what is below it by its shape, not its box.
- **Positions and turns are the world's.** An attached part is placed, moved
  and turned in the world's terms like any other, including one attached in
  the same call as its parent.
- **An assembly holds together.** Copying, hiding or deleting an object does
  the same to what is attached to it, and the answer names those parts, and
  what each copy goes into where it landed. A
  hole's cutter is attached to its object, so the hole moves, turns and is
  copied with it. A copy of a moving object has keys of its own and moves as
  the original does, offset with it. Resizing a part leaves what is attached
  to it as it was, turned or keyed, however unevenly the part is resized: a
  shape is resized in its own shape, so it never holds a stretch for a part
  attached to it, then or later, to inherit, and it comes out the same with
  parts attached or without. Its repeats stay apart as it stretches; its
  rounded edges and walls keep one width all round and change with its least
  change, and a flat sheet's walls are its thickness. Its holes' cutters move
  and stretch with their holes, keyed motion and all, those of the scene's own
  objects attached to it included, which the answer names, and what is
  attached to a cutter stays where it is; one stretched across its turn
  takes its turn into its shape and is described by it. A size asked is
  reached, walls grown outward included; one a step keeps it from, as a
  mirror across another object keeps its halves apart, is said with the size
  it reached. A cutter that also cuts another part keeps its
  place and size, as an attached part does, so that part's hole is as it was,
  and the answer says so. A hole an uneven resize stretches out of its shape
  is named with its cutter's size before and after, and a round one is said
  to be round no more. A part whose cutter turns by keys is resized only
  evenly. A shape it shared becomes its own with motion of its own. Scaling
  a part, a drawing or a model fitted to a size is a factor on the size it
  was added at, in an edit or a key. A shape with a step whose sizes cannot
  follow it is resized by its scale, and refused with the reason when parts
  are attached to it. A part whose scale is keyed keeps a resize at every
  key. Factors as near one another as an answer's sizes, to four figures,
  can tell are one factor, so the sizes an answer states, doubled, double the
  part evenly. A group's parts are the group, so they resize with it; a group
  holding parts turned within it, now or by keys, other than cutters, is
  resized only evenly, since an uneven resize would slant them. A keyed scale
  scales what is attached with the part, as Blender's parts do, and an uneven
  one is refused where it would slant a part turned on it; so are attaching
  a part to one stretched unevenly, now or by keys, where it or a part
  attached to it is turned on that one, and turning such a part by an edit
  or a key. A cutter's own steps follow its hole, and parts attached to a
  cutter keep their keyed motion when they are keyed again. A part attached
  or detached keeps its keyed motion where it was, its keys moved to its new
  axes; one whose new axes are turned or stretched from its old is refused,
  and one whose old or new holder moves by keys is said to move on its new
  holder's axes. Attaching an object to itself, or to one of its own parts,
  is refused with the reason.
- **Lengths are the scene's.** The widths of rounded edges, walls and
  repeats are given and told as the scene has them, however the part is
  scaled; a flat sheet's walls across its flat side alone. Bent lettering
  says the radius it is bent round in the scene.
- **Set down, not dropped through.** Resting an object on another lowers it
  straight down until the two first touch, so it lands on the first surface
  below it, including where the two meet between corners, as crossed logs do,
  and never sinks into it; on the floor, its bottom is on a Floor or Ground
  object under it, or else at zero. Set across several supports, it lands on
  the first it meets and is said to rest on each it then touches; set on
  "below", on whatever is under it. Tilted to the surface, it is turned about
  its contact to follow that surface, lowered again, and the tilt is said.
  The answer gives the gap measured after, surface to surface, between it
  and each support: 0 mm where they touch. An object added or moved to be
  set down takes its location as [x, y], where across, the setting down
  giving its height; [x, y] without a setting down is refused in words.
- **Pushed until it meets, or laid point on point.** Pushed against a side
  of another object, an object moves along that one axis, keeping its place
  across, until the two surfaces meet or stand the gap asked apart, measured
  on their shapes from points of both, so a box meets a round post where the
  post's surface is and goes into nothing; one not level with the other
  across that axis is refused, as it would pass it. Laid onto another, a
  point of its box, or its origin, goes onto a point of the other's shape:
  the top of its middle, or its surface, corner, edge middle or face middle
  nearest that point. Each answer gives the gap measured after, 0 mm where
  they touch, the side they meet on and what it goes into; setting down and
  laying onto in one edit are refused.
- **An instance is an object.** Added as an instance of a collection or an
  object, it draws its source's shape where it is, sharing its meshes, and
  is measured and checked as that shape: its size and heights, what it goes
  into and what holds it up. The answer says how many instances it places,
  of what, and the box round them; smoothing or bevelling one is refused, as
  that belongs on its source.
- **A turn round a hinge moves what it turns.** Turning an object round an
  axis through a point or another object's origin moves it as it turns, and
  the answer says where it went from.
- **Copies say what they share.** Copies go a step apart or round an axis,
  evenly round a full turn with the original among them; linked copies share
  one mesh, and the answer says how many objects share it, with the faces
  that mesh holds in memory and the faces all of them draw. Resizing one
  gives it a mesh of its own, and that is said.
- **A row says its spacing.** Setting objects out along a line, a circle, a
  curve or points places their origins evenly apart, a distance apart, or
  with even clear gaps between them, turned to follow the path or to face a
  circle's middle; the answer gives the spacing and the gaps reached, or how
  far neighbours overlap, and what any goes into.
- **Settled with physics, kept without it.** Settling runs rigid-body physics
  with the dropped objects active and their supports still, keeps each
  object's final place as a plain place and removes the physics, back at the
  frame it started on. Its bodies are given to the physics and run as
  simulating gives and runs them: each meets the others as its steps shape
  it, as a floor an array step lengthens, and a body is still moving at the
  end by the same measure. The answer says how far each fell, slid and
  turned, what it rests on, whether it was still moving at the end and
  whether it fell off; an attached or keyed object, or a scene with physics
  of its own, is refused.

## Scatter and measuring

- **A scatter keeps to its rules and says what each removed.** Copies are
  scattered at points spread evenly by area, at random by a seed, so the same
  call scatters the same way; each point is kept or removed by the rules
  given in turn (a material, a vertex group as likely as its weight, a slope,
  a height, a distance away from or near objects). Each copy's footprint, the
  circle round its own box seen from its up at its scale, is kept clear of
  every other's by the spacing, and its shape out of what it keeps clear.
  Each copy stands on its point by the middle of its box's base, upright or
  tilted to the surface, raised or lowered along its up by an offset and
  sunk into the surface by a random depth between the two a sink gives; each
  copy is one of the items, as likely as the weight given it by name, an
  item not named weighing one, so an item of weight 0 is never drawn. The
  answer gives how many were placed against asked, how many points each
  rule, the footprints and keep-clear removed, the least gap between
  footprints, the slopes of the faces the copies stand on, how far each was
  raised or sunk, and the faces the copies draw against those the items'
  shared meshes hold in memory; one short of its count says no more
  fit, and one that places nothing is refused with what the surface has for
  the rule that removed every point.
- **A scatter says what its copies go into.** Each copy is measured on its
  shape against the objects near it, the surface, the items and the other
  copies included: one standing on a level surface goes into nothing, one
  upright on a slope goes into it as deep as it does. Instances are measured
  as Blender evaluated them.
- **A scatter is objects or instances, and replaces the one before.** As
  objects, copies are linked copies sharing the items' meshes in a collection
  of their own, at most 1,000; as instances, one object places them with
  geometry nodes, at most 10,000, and the scene's description counts them in
  its heading. Scattering the same items onto the same object again removes
  the earlier copies or instances first and says so, and the answer gives how
  many objects and instances the scene then has.
- **Measuring reads shapes and changes nothing.** Between two objects it
  gives the distance surface to surface with the two nearest points, how deep
  they go into each other and where, or that they touch; then how far apart
  or overlapping their extents are along x, y and z, and, apart along one
  axis only, how far one would move along it to touch the other. Centres are
  the middles of their extents. From one object along an axis it names what
  it meets first and how far; a clearance is the least distance to
  everything else but its own parts, naming the nearest and the next three.
  What an object places as instances is its shape, and in a clearance each
  instance is an object of its own. A deviation gives how far one shape
  strays from another. An object with no shape is refused.
