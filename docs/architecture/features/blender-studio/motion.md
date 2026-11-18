# 3D studio: motion

Invariants of the [3D studio](README.md): keys, paths, drivers and the
timeline, and videos. The README holds what the studio is for, its interface
and the invariants that hold for every call. Each invariant here is covered by
a test.

## Motion

- **Motion is timed in seconds.** Keys, paths, frames and videos are given
  in seconds, and a change of frame rate keeps every key at its time: an
  object's, its camera's or light's, its shapes', and its material's, each
  moved once however many objects share it. A key eases into its
  place as asked: eased in, an object goes faster as it nears it. Each of
  several size keys in one call gives the size asked. No time a motion
  input names, of a key, a path, a belt, a CAD motion, a frame sheet, a
  still, close-ups or a video, reaches past 600 s, the longest timeline:
  one that does is refused, naming the limit. A video lasts at most 300 s,
  and a formula a part follows another by is at most 500 characters. Each
  limit is stated in the schema and description of the input it holds, and
  a call past one is refused, naming the limit and how to work within it.
  A new scene's timeline, still Blender's 250 frames and set by no call's
  length or loop, ends at the last key rather than holding the last pose,
  as the answer says, unless a motion carries on past its keys.
- **A custom property is keyed by its path.** A property path ending in a
  custom property, such as `["open"]`, keys it, made where it is missing,
  and the answer says it was made; a path naming an item of a collection
  rather than a value is refused in words. The scene's description gives,
  for each object, every keyed value's key times, or how many keys over
  what span, and a value keyed once is said to hold at every time.
- **A path and an aim are followed.** An object sent along a path passes
  through its points from its start time to its end; an attached part's
  points are on what it is attached to, so the path moves with it. A path
  may follow a curve object's first spline instead, round it when it is
  closed; one with both points and a curve, or neither, is refused before
  it is approved. Banked, an object leans into its turns about the axis it
  faces along, its top toward the turn, the hardest turn by the angle
  given. A train behind it rides the same route, each object the spacing
  behind the one before. The answer gives the route's length and its top
  speed. One
  aimed at another keeps pointing at it as either moves, by the axis asked,
  its front by default, at the target's origin; the answer names the axis,
  the origin and how far off the target's middle it lies when that is more
  than a degree, a line within five degrees of straight up or down, where a
  small move turns the object round the line, and, when a shape's length runs
  across that axis, the axis that would aim its length.
  Told to stop, it
  stays turned as it is, or, when its turn is keyed, its keys turn it again,
  as the answer says. Only its turn changes: where its other constraints put
  it, it stays.
- **A part that follows another moves with it at every moment.** Its place,
  turn or scale along one axis is the followed value at a ratio, or by a
  formula of it, in the tools' units, a turn followed on past a whole turn.
  A formula is arithmetic Blender works out without Python, and any other is
  refused in words. One longer than Blender works out live is worked out by
  the studio at every frame of the timeline and keyed there, and the answer
  says it follows the motion as keyed then. A value that is keyed cannot follow, a value that follows
  cannot be keyed, and a part cannot follow one that moves with it. An
  attached part's following place counts in the terms of what it is
  attached to, and the answer says where its zero is in the world.
- **A belt or a chain runs round its pulleys.** Laid onto the path round
  the pulleys or sprockets given, it stays exactly where it was, and moving
  it along that path carries every link, tooth and rib round the loop. Its
  run is keyed at a speed, the way the pulleys are listed, and runs on past
  its last key, or follows a pulley's turn at that pulley's radius, an idler
  on the belt's back turning the other way. Laid again, it is laid from
  where it rests.
- **A CAD model moves as the CAD placed it.** From the motion file a build
  wrote at its positions, each part of a model found in the scene by name is
  keyed at every frame, through its positions evenly in time and smoothly
  between them, moved, turned and stretched as the CAD found it, in the
  model's frame wherever the model was put. Positions given as a cycle run
  back to the first and on, a part that turns keeping on turning rather
  than winding back, each loop exactly as long as from to to, whole frames
  or not. Parts of the file not in the scene are named and left. A part
  attached, directly or through other objects, to one that moves on its
  own, by keys, a follow or a constraint, is not keyed, and the answer names
  what it is attached through; one attached through objects that stay put
  to a part the same motion keys is placed as the CAD placed it. Several
  parts keyed over the longest timeline finish well inside the command's
  time limit.
  An assembly sequence's file is keyed straight between its positions, so
  each part waits where it is until its turn and then goes straight in, and
  the answer gives the order: at each step, its times and the parts that
  move, with how far.
- **Clearing is the object's own, where it stands.** Cleared, an object keeps
  no keys, no aim and nothing it follows, and stays where and as turned as it
  is; one given new motion in the same call is said to have its earlier
  motion cleared. Its attached
  parts keep all their keys, the shown or hidden keys its own key gave them
  included, which cannot be told apart from their own; the answer names the
  parts still shown or hidden by keys, to clear too. Keys of a material,
  camera, light, mesh or its shapes it shares with another object stay, and
  the answer says so.
- **An animation call sets something.** One with no keys, paths, aims,
  follows, drives, poses, clearing, frame rate or length is refused before it
  is approved.
- **A bone is keyed by its turn about its own axes,** from its rest, in the
  rotation mode its rig keeps, or by its place along them; a bone joined to
  the one before moves only by turning, and a place for it is refused. A
  bone reaching for a point has its IK target keyed there; one without an IK
  constraint is refused, naming the bones that have one. A pose is saved on
  its armature by name, from the bones given or as the rig stands; a key by
  its name keys each of its bones, and an unknown name is refused with those
  saved. The answer gives each keyed bone's tip in the world at its key, and
  how far a reaching tip falls short.
- **A driven value runs without Python.** Any value by its path is driven
  from values, distances or turns between two parts, combined or by a
  formula, angles in degrees; one that would need Python is refused. The
  answer gives the value at the start, its range over the timeline and the
  range Blender holds it to.
- **A driver that does not run is said.** Blender here runs no Python in a
  driver, so one whose expression needs it holds its value at 0. The answer
  to a script, an animation, opening the scene and describing it names each
  such driver, what it drives and its expression, and how to write it as an
  expression Blender works out itself, or to key the value instead.
- **An aim may keep an axis up, turn about one axis, stretch or keep to a
  curve.** Turning about one of its own axes only says how far it points off
  the line it cannot close; stretching to reach its target keeps its
  thickness and gives its length over the timeline; kept on a curve, the
  answer says how its place maps along the curve. A target that is not a
  curve, or a stretch along an axis other than y, is refused.
- **A frame sheet is for the model, and changes nothing.** It is kept in the
  app's data and nothing is written to the workspace. Its answer places, at
  each time, the objects asked for, up to eight, or each that moves; a
  camera, a light or an empty by its place and turn. A mesh that bones bend
  is followed by its surface: its points jumping in one frame are a pop, its
  lowest points travelling over what they rest on slide, with the bone that
  bends them most, its fastest point is named with its speed, and a bone's
  keyed angle that jumps past half a turn is a flip. A mesh whose shape
  changes while its origin stays, by keyed shape keys or keys on its mesh,
  bones, or a step such as a cloth simulation or a cache, moves, and is
  measured at every frame for what it goes into as a part that travels is;
  a shape changed by steps alone is told moving by its points at the frames
  looked at. A wide picture's frames
  are drawn wider, and a tall one's narrower, rather than refused; one too
  wide or too tall for that is refused in words. The answer says what drew
  them, and opens with the pairs of parts that go into each other, deepest
  first, with how deep, when deepest and over which spans, checked at every
  frame from the first drawn to the last, between them too, for every part
  that moves, not only
  those it places: the objects asked for first, then the others, up to
  sixty, and the answer says how many moving parts past those were not
  checked. Framed on the objects asked for, every frame shows them
  all the same way, wherever they go, from the side the rest of the scene
  covers least of them, which the answer names; one covered from every side
  tried is named too. Moving objects it does not place are counted, and the
  answer says to name them to see where they are. An object that keys show
  and hide is followed while it shows.
- **A motion is checked at every frame.** A frame sheet steps through every
  frame from its first time to its last, up to 360 frames and past them
  every so many, saying so; it then measures turns and speeds from each
  frame it takes to the frame after, checks keyed angles at every frame, and
  tells an overlap that lasts as one span of the frames it took. It names
  what moves wrong between the frames it draws as at them: a part whose
  place jumps in one frame far further than in the frames either side; a
  keyed angle that jumps past half a turn between two frames; a part turning
  more than 30 degrees a frame, which a video shows turning backward; an
  object shown or hidden for one frame; a part that slides along what it
  rests on, counted against what carries it, and a part rolling on it,
  turning about a level line across its way, whose travel and roll differ by
  more than a tenth, while one that swings about an upright line through
  itself, as a door on its hinge or a turntable does, travels nowhere; a rod
  or a link, an aimed part whose shape reaches at least halfway to what it
  aims at, whose distance to it changes, while a camera, a light or a part
  that only looks toward something has no length to keep; and an object that
  leaves the camera's picture. Each is said on a motion that has it and
  nothing is said on one that does not, and the fastest parts are named with
  their top speed and turn. Asked as a loop, it says whether the frame after
  the timeline's last is where its first is, moving and turning as there;
  a last frame that is the first again, while the first moves on, is said
  to show that moment twice, with the time a frame earlier to end at. An
  animation keyed as a loop ends its timeline a frame before the scene's last
  key, so that key's pose, the first again, is the frame after the last, and
  the check then finds it plays round. It names the parts that accelerate
  hardest, in m/s² and in g. Parts named as feet, paws, hooves, shoes, wheels,
  tyres or casters are named as such, with how far each one's lowest point
  goes into the surface under it and when deepest. Pairs of parts allowed to
  touch are left out of the overlaps and said apart, with how deep, and
  those that never touched are named. Asked without pictures, it draws
  nothing and checks every frame from its start to its end, however many,
  until most of the call's time limit is spent, and says where it stopped.
- **An animation says which values are keyed once.** A value with a single
  key holds at every time, so a part keyed only where it ends is there from
  the start; the answer names each such value and its time, and says nothing
  once each has a start.
- **A motion past its keys says how it meets itself,** with the seam's
  position and speed. Keys added later widen the round. A loop says whether
  the timeline plays round seamlessly. Extending an unkeyed object is
  refused.
- **A still and close-ups can be taken at a moment.** A moment between two
  frames is drawn as exactly as one on a frame, so close-ups and a frame
  sheet at the same moment agree. The answer says the moment asked, and the
  scene is at its own time again after it.
- **A simulation is shown where it has got to.** In a scene with a rigid body
  world, cloth, soft bodies, fluid, dynamic paint, emitted particles, hair
  dynamics or a geometry nodes simulation, a frame sheet, a still or close-ups
  at a moment reach it through every frame from the earliest start of the
  simulations not baked, so a falling box is drawn where it has fallen to;
  with every simulation baked, the moment is read from the bakes. Each says
  which simulations it stepped and which it read from their bakes, naming a
  bake that does not reach the frames looked at.

## Videos

- **A video is for the person.** The answer says the person can play it
  beside the conversation, and how to show it again. It is written as an MP4 in the workspace,
  any other kind of file is refused before it is approved, and it shows the
  model no picture. The scene's own render settings are as they were after
  it, every video setting and the way its file is named included. A name holding `#`, which Blender
  would replace with frame numbers, is refused before it is approved, and the
  size approved is the even one it is made at. One stopped while writing is
  said to be perhaps incomplete. A video written whole is handed to `video`,
  given its workspace path and file, for the person to watch; one stopped or
  failed is not, nor one the call left as it was.
- **A video may skip frames, slow time and sample for itself.** Every so
  many frames, each is held as long as those it stands for, so it plays at
  its real speed; slowed, the motion is worked out between frames and the
  answer gives how long it plays. Sampling given for a video is for that
  video alone, its seed changing each frame, and the scene's sampling is as
  it was after it.
- **A video never shows a simulation wrongly.** One whose frames reach past
  a simulation's bake, or that would jump a
  simulation not baked, by starting after it starts, skipping frames,
  slowing time or being drawn over several calls, is refused before anything
  is drawn, saying to bake first. Rendered in order from its start in one
  call, a simulation not baked is worked out by Blender as it renders, as
  the answer says.
