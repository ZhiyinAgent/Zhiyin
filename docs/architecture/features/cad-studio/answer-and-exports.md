# CAD studio: the answer and the exports

Invariants of the [CAD studio](README.md): what a build's answer says of its
parts, and the files it writes. The README holds what the studio is for, its
interface and the invariants that hold for every call. Each invariant here is
covered by a test.

## Exports and the answer

- A build may add up to four sections to its picture, to show inside the
  parts: each cuts them, or the parts it names, with a plane through a point,
  square to the side it is looked at from; each part's cut faces are filled
  in its colour and hatched, and the edges beyond drawn. A section that cuts
  nothing, or names a part not shown, is said, and the rest are drawn. A
  part whose cut the kernel gives back as no valid solid, as a cut through a
  part that folds through itself does, is left out of the section, and the
  answer names it; in a drawing too. The sections are worked out side by
  side, each by a run of its own, in the time the build has, keeping room
  for its picture; one not done in it is named, to ask for alone.
- A list of part names, an export's, a section's, a drawing's or a
  section's uncut or revolved, takes patterns: a name between slashes stands
  for every shown part whose whole name it matches, and the answer begins
  with what each pattern named. One that matches nothing is refused, naming
  the parts there are.
- Exports are copied to the paths that were approved, each holding whole the
  parts it names, a shape shown under two names included; parts shown as a
  list under one name are numbered. A file that appeared at
  one of them while the part was built, or a folder on its way that changed,
  is left as it is, and the answer says that export was not written. A
  mesh file, STL, 3MF or glTF, holding a part whose faces cannot be divided
  into triangles, as a solid that crosses itself, is not written, and the
  answer names the part and why; the other files, the picture and the
  measurements stand, and the person's view leaves that part out, as the
  picture does. Every mesh is made in one way, so none holds a part with a
  face missing. Any file that cannot be written costs only itself. Two
  exports where one would be a folder of the other are refused before
  anyone is asked.
- The answer says, for each part shown, whether it is a valid solid, its size
  and where it lies, its volume and surface, its centre of mass, its faces by
  kind, its outside edges by kind and the diameters and counts of its round
  holes. Outside edges are those where the part's faces meet at a convex
  angle; inside ones, as a pocket's floor and corners, are not counted, so a
  pocket adds only its rim. One is sharp where the surface turns across it
  by more than 30°, rounded where a curved face runs smoothly into two
  flatter ones, as a fillet does, and chamfered where a narrow flat or
  conical face sits at a shallow angle between two wider ones; an edge a
  round or a chamfer bounds is counted with it, and the patch where three
  rounds or chamfers meet at a corner is none of its own. The answer gives
  the counts alone, never a list, and nothing of whether sharp is meant.
  Round holes are walls all the way round an axis, however many faces make them, so a fillet, a notch or a
  slot's round end is not one, a wall in halves from two surfaces, as a
  mirror or another program's STEP holds it, is one, and a hole another
  crosses, larger or smaller, is still one. A part of several solids that
  overlap is measured in every respect by the material they make, however
  many there are, with what they share said. A part holding a face that
  belongs to no solid is refused, though its solids share faces. A part that
  is not a valid solid is told where it goes wrong: each face or edge the
  kernel rejects, and each that crosses another, with its kind, where it lies
  and its size, and whether the kernel's repair, `fix()`, makes it valid.
  With more than one part it names each two that overlap, with the volume
  they share, how thick that shared material is and the box it lies in, or
  says none do. Parts of several solids each are measured solid by solid,
  so what they share is the same however they are turned and moved
  together. Each part's box is measured once for all its pairs, so a part
  of many curved faces among dozens of others is checked in seconds. A
  press fit shares a ring as thick as its interference, while a part lying
  wholly inside another, or shown twice in one place, shares material as
  thick as itself. An overlap of a tenth of a millimetre or less is said to
  be as little as a press fit, a deeper one to be one part running into the
  other; two or more press fits are said in one line, each pair with what it
  shares, and the deeper overlaps each in full. It names what nothing holds: each piece
  of a part made of several that no other piece holds, its own part's or
  another's, and, where two or more parts are held by another, each part
  that none holds. A piece is held by one it lies in, on or against, or
  comes within a millimetre of, as a pin turning in its bore with a running
  clearance does; parts laid out apart, as for printing, are no assembly.
  A part meant to print, one a build writes to STL or 3MF or an overhang
  requirement checks, is held together only where its own pieces touch, to
  a hundredth of a millimetre, since any gap between them prints as two
  objects; another part still holds a piece of it within the millimetre.
  That is measured for at most a minute, and when it is not finished the
  answer says so and names none as held by nothing, naming instead the
  parts not yet found held, each piece and by another part; every other
  part was. A piece lying wholly in another is
  found from one point of it; any other way two pieces meet, their
  surfaces meet too, and the meshes find it. A piece is asked against its
  own part's pieces first, and each point of a mesh is measured only to the
  triangles of the other that can lie within reach of it, so ten bearings
  of sixteen solids each among twenty other parts are settled in seconds. It gives each file written with its size and the parts it holds,
  and what the script printed, and carries a picture of the parts, each
  part named in every view it shows in, beside it where it is too small to
  hold its name, as long as there is room; six or more alike parts numbered
  in a row are named once for all of them. A part
  whose faces cannot be divided into triangles, as a solid that crosses
  itself, is left out of the picture and named with why; when none can be
  drawn, the answer says why there is no picture, and the measurements
  stand. Lengths are millimetres, and halves round away from zero, so a mirrored
  part reads the same on both sides.
- Each build is compared with the last build of the same script in the
  conversation: the same workspace file with the same arguments, or, for
  code given in the call, the last build of code, when it shows a part of
  the same name; code that shows none is another design. For each part shown in
  both that changed notably, the answer gives one line of what changed:
  its volume, by 2% or more, a side of its box, by 1% of its longest side or
  more, its number of solids, and whether it is a valid solid. A part with
  no volume is said whatever came before, the parts the last build showed
  that this one does not are named, and a part unchanged is not mentioned
  among the changes. The parts a build shows exactly as the last build of
  that script measured them are named in one line instead of measured again,
  unless one is not a valid solid or has a fault, which is always said in
  full. Parts alike in every measure but where they are, as a row of screws,
  are said in one line with the centre of mass of each.
- A file a build of a script wrote, still as it was written, is said in one
  line when a later build of that script shows a part it holds changed
  since: changed in any measure the answer gives, its place included. The
  next build to write that file clears it; a file changed or removed since,
  or written last by another script, is not said. What the builds showed
  and wrote is kept in the conversation's own folder.
- A file written for printing, STL or 3MF, says of each part in it whose
  solids print as more than one object how many solids it is and how many
  separate objects they print as: solids that touch or overlap, to a
  hundredth of a millimetre, are one object. What is not found in twenty
  seconds is not said.
- A script may show nothing, to work something out and print it: it answers
  with what it printed, and that nothing was measured or drawn. A drawing,
  an export or a check of positions still needs a part. `show` works in the
  workspace modules a script imports too.

## The files a build writes

- A STEP file the studio wrote reads back into a later build.
- `zhiyin_cad_helpers.py` is written only under that name and holds no
  part: it is the helpers module with each harness module it needs held as
  that module's own source, and the modules that tell a build what the
  helpers made held as ones that keep nothing, so what the helpers say is
  printed as they say it. A script beside it runs with build123d and
  bd_warehouse alone, and prints what the build's answer said the helpers
  did.
- A `.glb` holds each part as a mesh of its own, named, placed where the
  script placed it about the origin it was modelled at, a part alone as
  much as one of many, in metres with y up; each face its own run of points,
  so joining the points in the same place closes the mesh. Each group of a
  part's named surfaces is drawn with a material of the group's name, and
  the mesh lists its groups and is marked as a CAD part's, with the part's
  exact size along its own axes, which its facets only approach. Those marks
  carry the contract's names, and a motion file holds the contract's fields
  and no others.
- A mesh is as fine as its use needs. STL and 3MF are meshed for printing,
  within a fiftieth of a millimetre of the surface; a `.glb` for viewing,
  within a thousandth of each part's size and a quarter of a millimetre at
  most, many times lighter, so a scene of hundreds of curved parts loads;
  and, asked for close-ups, four times finer. The answer names each mesh's
  use and how far its facets lie from the surface at most, and of a file for
  printing how many triangles it holds and whether it closes, or how many
  of their edges, their points joined, no other triangle shares.
- A build's `.png` is the picture of the views its answer shows, of the
  parts it names, with the sections asked for: the same sheet, kept in the
  workspace.
