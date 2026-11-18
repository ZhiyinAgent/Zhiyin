# 3D studio: rigs and simulation

Invariants of the [3D studio](README.md): bones, rigs and binding, and rigid
bodies, cloth and liquids. The README holds what the studio is for, its
interface and the invariants that hold for every call. Each invariant here is
covered by a test.

## Rigs

- **Bones are set by name, at points in the world.** Giving a bone again
  changes only what is given. The answer gives each bone's length, ends,
  roll, parent and whether it deforms, the closed mesh pieces its middle lies
  in and how far an end sticks out, and its chains from root to tip with
  where they are not connected. List edits run in order (extrude, subdivide,
  duplicate with the bones below, rename, remove with the children going to
  the parent), each said. Mirroring a side copies each bone named for it
  across the armature's own x = 0 onto the other side's names, points
  mirrored and roll negated as Blender's Symmetrize does, and counts the pairs
  that mirror within 0.1 mm. Bones without an armature, and list edits
  missing what their kind needs, are refused before approval.
- **A ready rig is fitted to a body by its sections.** A Rigify metarig is
  fitted to a body mesh: legs are followed up from the ground, and a joint
  goes where a limb or the neck narrows, otherwise at the metarig's
  proportion. Each joint is said with what it was fitted to, and what could
  not be found. A limb straight at a joint is bent there the way the metarig
  bends it, so Rigify can generate it. The generated rig keeps the metarig's
  place, keeps its widget shapes out of the scene and names its mesh; the
  metarig stays hidden, moving its bones generates the rig again, and bone
  changes to the generated rig are refused.
- **A mesh is bound with its Armature step first,** after any mirror, keeping
  volume unless asked otherwise, to the armature named, else the rig fitted
  to it, else the scene's only one; with several and none named or fitted,
  the call is refused naming them. A call that fits a ready rig and binds
  binds the rig it made. Binding again replaces the earlier weights of the
  same bones. A rigid binding moves each loose part whole with the bone that
  runs inside it furthest, else the nearest, and says which and how far.
- **A binding says what its weights hold** (points with no weight and where,
  points on more than four bones, bones that move nothing; keeping a number
  of bones keeps the heaviest and sums their weights to one) **and is
  pose-tested:** each joint is turned 60° each way on a copy at rest, and one
  that loses or gains more than 5% of the volume near it, or newly goes
  through itself, is named with the change and one place. On a closed mesh
  the change is the mesh's own volume change.
- **A reaching chain keeps the pose it had and is checked at every frame.**
  Its pole angle is the one that leaves the chain as it was, and a target or
  pole not in the scene is made, attached to the armature. Over the timeline
  the answer says where its tip falls short and by how much, where its bend
  turns to the other side from rest or jumps between frames, and where its
  bones stretch; a chain along a curve says how much of the curve it covers,
  or that it stretches to fit.

## Simulation

- **Rigid bodies are weighed and measured.** An active body's mass is its
  closed volume, measured on its shape with every step on it, times a density,
  a material's from Blender's table, or a mass given; one with no closed
  volume and no mass is refused, as is a weight given to a passive or
  animated body, or an animated body with no keys. A still body is seen by
  its hull where it is convex and by its mesh where it is not. The physics
  runs over the timeline from its start, and each active body is said with
  when it comes to rest, its top speed, what it rests on and where it ends,
  or that it is still moving or touches nothing; the scene is back on its
  frame after.
- **Bodies never start inside each other.** Bodies that start inside each
  other's shapes, or inside another's convex collision shape, are refused
  with how deep, before anything changes.
- **Kept or keyed, the physics goes.** Settling keeps each active body where
  it is at the end of the timeline as its plain place; keying keys its place
  and turn on every frame, dropping keys a straight line already gives. Both
  remove every rigid body and the world.
- **Every simulation is baked in order and says its cache,** writing nothing
  beside the scene. Rigid bodies, cloth, soft bodies, particles, liquids and
  smoke, then simulation zones, each over the timeline, each with its frames,
  seconds, cache size and where it is kept, or why it failed. Point caches
  and zones are kept in the scene file, a disk cache switched to it; a liquid
  the studio made is baked into a new folder of the conversation's own, so a
  scene put back keeps the liquid it was baked with. Those folders hold 2 GiB
  at most together: as a bake starts, the oldest the open scene does not name
  are removed until the rest fit, and a scene put back to one removed shows
  its liquid unbaked until it is baked again. Dynamic paint, which
  Blender caches only beside the scene, a liquid the scene caches beside it,
  and a zone set to bake to a folder of its own are left unbaked, saying how
  to bake them in a script. A zone is checked frame
  by frame for its point count and for positions that stop being finite.
  Freeing names what it freed and what it left. A cloth the call moves and
  bakes is then measured: whether it rests at the end, and how sound it was
  where it stretched most. A cloth set up again in a call that does not bake
  keeps its bake from before, which Blender still plays as it was baked; it
  is not measured, and the answer says the bake does not show what changed
  since.
- **A bake says whether each cloth, soft body and particle system stayed
  sound.** Each is stepped through its baked frames: a top speed past three
  times what a fall through the scene's height reaches, and at least 10 m/s,
  is said to have blown up, as is a cloth's or soft body's box grown past
  twice its first size; one still moving over its last half second is said
  to be moving; particles say how many are alive at the end; a soft body's
  or particles' points left inside a closed collider are counted. Dynamic
  paint sits out the stepping, so nothing is written beside the scene.
- **A baked cloth says any collider it went through,** even where none of
  its points is ever inside it. At each frame, an edge of the cloth that
  enters a closed collider through one face and leaves through a face turned
  the other way counts as going through it, as does an edge across an open
  collider, a floor of one face, or a point whose way from the frame before
  crosses one; the answer names the collider, the frames, the most such
  edges at once and how many of the cloth's points they join. It then names
  the fix: pinned points that carry it through while their pins hold are
  said to, as no collider stops a pin; room between two colliders that squeeze the cloth at its
  start, closer on either side than it keeps from each; otherwise the steps
  a frame that keep its fastest points there within what it keeps from the
  collider in one step. A cloth's steps a frame can be given. A spec's
  separate_in_motion finds the same crossings.
- **A cloth given again keeps its fabric.** Without a fabric named, a cloth
  that already is one keeps the stiffness and mass it has, as a script set
  them, and the answer says them; naming a fabric starts it again from that
  preset. Self-collision is the same: on for a new cloth, set off or on when
  given, and kept as it is, a script's setting included, when not; the
  answer says whether the cloth meets itself.
- **Colliders are for every simulation.** Objects given as colliders get
  collision as their last step, after whatever deforms them, as thick on the
  outside as a tenth of the finest cloth or soft-body spacing, a thickness
  given, or 5 mm when only particles meet them; the answer names what meets
  them, and a simulation that meets only another collection is said to pass
  through them. A scene with nothing they could meet is refused, as is a
  thickness under 1 mm, the least Blender keeps.
- **Each simulation's bake is said against the scene's frames.** The
  scene's description lists each simulation as not baked, with the frame it
  is worked out from, or baked over its frames, saying where they start
  after or end before the scene's.
- **A drape keeps where the cloth comes to rest.** The cloth runs until no
  point moves more than 2% of its spacing over 10 frames, at most 10 s; that
  shape is kept as the mesh, the cloth and the collision given for it are
  removed, and the scene is back at its frame. The answer says when it came
  to rest, how far it rests off each collider, its folds against the grid
  spacing, and whether it stretched, crossed itself or went into a collider.
  A cloth's colliders get collision as their last step, as thick as a tenth
  of the cloth's spacing, and the cloth meets itself unless told not to. A
  drape runs once the call's colliders for every simulation are set too, so
  it meets those as well as its own.
- **A pin, pressure and sewing say what they hold or did:** the points
  pinned, the volume before and after, the longest seam before and after.
  Pressure on an open mesh is refused with its open edges.
- **Pins can let go at a time.** A cloth that moves over the scene's frames
  holds its pinned points still until the time given, then leaves them free
  from that frame on; the answer gives the time and the frame. A release
  with a drape, or at or before the timeline's start or past its end, is
  refused. Setting the cloth up again replaces its release, and without one
  the pins hold throughout.
- **A liquid is baked in the call,** in a domain made round its container and
  sources, its cache kept in the conversation's own folder. Each obstacle's
  thinnest wall is weighed against 1.5 voxels before the bake; after it, the
  volume is measured inside the liquid and outside every obstacle, with what
  lies outside the container or is still falling into it, and how deep it
  stands; inside is asked as every measure asks it, so an obstacle whose
  faces point into it holds no liquid. Liquid that leaves the domain by its
  sides or top is gone.
