# CAD studio: building parts

Invariants of the [CAD studio](README.md): the helpers a script is given, the
library look-up, the script mistakes the answer names, the checks for how a
part is made, and positions, sweeps, gears and explode. The README holds what
the studio is for, its interface and the invariants that hold for every call.
Each invariant here is covered by a test.

## The helpers and the library look-up

- The helpers a script is given build valid solids: a casting with drafted,
  rounded sides; a boss, a pad or a rib joined to the part it stands on;
  real bolts with their clearance holes cut; a pipe bent through its points;
  a hose seated in its two ports with a clamp at each; a belt wrapped round
  its pulleys. Where the kernel refuses what is asked, a helper does what it
  can and never fails the script: `round_edges`, where the radius
  asked does not fit, rounds the edges together with the largest smaller
  radius they all take, so edges alike stay alike; only when not even the
  smallest it is given (a quarter of the radius unless told) fits them all
  at once does it round them one at a time, each with the largest it takes,
  and leave sharp those not even the smallest fits. Each radius down to the
  smallest is tried before an edge is called sharp, and the answer says,
  under what the helpers did, the radius they got, or how many got less and
  which stayed sharp, and where. A pipe's corners are bent with the radius
  asked, and a hose's turns as wide as its ports and points leave room for,
  each less where the straight runs either side are too short, which the
  answer says. Neither is ever bent tighter than just over its own radius,
  as a tighter bend folds it through itself, which the kernel's check passes
  but no cut or join through it survives; the bends of the finished path are
  measured before it is swept. A pipe or a hose with no room for such a bend,
  or that the kernel cannot sweep, is not made: the helper answers `None` in
  its place, and the answer says why and how much further apart its points
  must be; `show` given `None` shows nothing there and says so, and the
  script goes on. The answer says the bend a pipe was given, and a hose's
  length and tightest bend. A belt's length
  and how far it wraps each pulley are said. A coil spring is one sweep of
  its wire, its ends ground flat, said with its turns and sizes; its `.glb`
  is meshed as fine as its wire needs to look round, not to the tolerance of
  printing, so a scene can hold many. Turns that cannot fit the length are
  refused, saying how many can.
- A script's `sheet()` folds a flat outline, drawn to the outside of its
  bends, into a valid solid of those outside sizes, and gives its flat
  pattern, shorter by each bend's two setbacks less its bend allowance, with
  K from DIN 6935; the answer gives the flat's size and each bend line on it,
  up or down, with its angle and allowance. Where a bend ends inside the
  sheet, `sheet()` cuts a relief, or, told not to, names each place the sheet
  would tear; folded flats that run into each other are named with the
  volume they share and where. A bend line that does not part the sheet is
  refused, saying to run it from edge to edge.
- The strength helpers (a shaft, a beam, a bolt, a bearing's life, a gear
  tooth, a column) say each check under what the helpers did, with its
  measure, limit and margin, from the material's figures or those given,
  and refuse a material with none. A bolt's shear is checked against the
  slip of its preloaded joint only for a slip-resistant joint, never for a
  bearing joint, which a bolt is unless said. `iso_fit` gives the ISO 286 limits of a
  hole, a shaft or a fit and says whether the fit clears, is a transition or
  grips. Each helper the tools name is one the harness gives, and a helper's
  own function, as `strength.bearing`, is looked up by name.
- A part's surfaces named in `show` are faces of the part as shown, before
  or after it is moved; a face that is not one, such as a face of the shape
  before a cut changed it, is refused with why. A cutaway names the faces
  its cut leaves as the surfaces `cut`. The answer says each part's named
  surfaces and how many faces each holds.
- `cad_api` answers a helper's, a build123d name's or a bd_warehouse part's
  inputs and description from the library installed, without reading or
  writing the workspace, and runs no code of the model's, so it runs
  without asking; a name it lacks is answered with the names near it.
  Several names are answered in one call, in the order asked, so a script's
  helpers and classes are read at once rather than one start of Python
  each. A look-up may take a minute, which its description states; one
  stopped there says so and to look up fewer names at a time. A bd_warehouse
  module that fails to import, as in a CAD environment from an older release,
  is said with its error and that the CAD studio is updated on the Plugins
  page, never as a name it lacks; a name a bd_warehouse module lacks is
  answered with the names near it in that module. Its description names the
  versions installed. A name the version installed lacks that build123d's or
  bd_warehouse's development docs describe for a later release, such as
  BuildSheet or BevelGear, is answered as only theirs, with what the version
  installed has for the same job; a bd_warehouse module of the same name,
  as `bd_warehouse.flange`, is looked up as itself. Asked alone or with
  others like it, it is answered without starting Python; among other names,
  in its place.

## Script mistakes the answer names

- A cut the script makes that would break the part it cuts is skipped, the
  part kept as it was before it: one that leaves nothing of the part, one
  whose cutter is turned inside out, and, when a part the script showed is
  not a valid solid, one that leaves no valid solid, found by running the
  script once more with each cut checked. A cut is the script's when it asks
  for it: by the minus operator, a builder's subtract, or the kernel's cut
  itself; the cuts build123d makes inside its own work, as a tapered extrude
  of a face with a hole or a hollow sweep makes, and the helpers' are not
  checked. The answer's first line, a build's or a drawing's, says how many
  of the script's cuts were skipped and that the parts are not what the
  script writes until they change; below, it says where in the
  script each skipped cut is, the part's and the cutter's size and place,
  why, and the shown parts where its cutter lies. A run kept from that second
  run is kept whole, with what the helpers said and how its parts are meshed,
  and what the script prints in it is not said a second time.
- The checks of a script's run watch build123d's and bd_warehouse's own
  operations through one hold the harness takes on them while the script
  runs: each operation watched is replaced once, its checks see what it
  gave, only the cut check may give back another result, and every one is
  put back when the run ends. The names replaced are listed in one place
  with the library versions they were last proved against by the
  real-library tests, which are the versions the CAD environment's lock
  pins. The views of a drawing worked out by runs of their own are handed
  back as JSON data, as the parts are handed to them.
- A join or a cut the script asks for, by the same ways a checked cut is
  asked for, with a shape that has faces but no volume, as a loft of
  sections that all lie in one plane gives without an error, adds nothing
  and takes nothing away. The answer names each, where in the script it is
  and how often, with that shape's size and place. A solid thinner than a
  thousandth of a millimetre along an axis has no volume; an empty shape
  made on purpose, as `Part()` to add to, holds no face and is not one.
- A cut the script asks for that takes nothing away, its cutter clear of
  the part, in a hollow of it, or only touching its surface, is named with
  where in the script it is and how often, the cutter's and the part's size
  and place, and where the cutter lies: how far above, below or off which
  side of the part, when their boxes are apart. Of a cut by several
  cutters that takes something away, as a builder's holes at several
  locations, the cutters whose boxes lie clear of the part are named the
  same way.
- A solid the script makes with an operator or a shape's own fuse, cut or
  intersect inside a `BuildPart` block goes into no builder, so one that
  nothing takes in after it is made, no builder, no later operation and no
  `show()`, and whose material lies in no part shown, is named with where
  in the script it is, how often, the block it was made in, and its size
  and place, saying to `insert()` it inside the block or build the part in
  one mode. A copy of a solid placed elsewhere is the same solid, so one
  added in its place is taken in.
- A line of the script that is an operation or a call alone, outside any
  builder's block, whose result is a solid, as `part.rotate(Axis.Z, 90)` or
  `part - hole` not assigned, changes nothing, as build123d's operators and
  methods return their result and leave the shape they work on as it was;
  it is named with where in the script it is, the line quoted, and the
  shape's size and place. A method that moves the shape itself, as `move`,
  gives back that same shape and is not one, whether the shape is a name or
  read through one, as `body.part.move(…)`. A name at the script's top that
  holds a solid, a `BuildPart` block's included, and that the script never
  reads again is named the same way, unless the line is named already as a
  solid lost from a builder. A `BuildPart` block inside another's joins its
  part to that one's and is used, unless it is private. Only the script's
  own lines are looked at.

## Checks for how a part is made

- Each part is checked for the way it is made, and only what is past a
  limit is said, a line each, with the measure and the limit and at most
  four places, the worst first, with how many more; a measure under 1 mm
  is given to three figures, so none reads as 0. The way is what
  `show(..., making=…)` says: printed, moulded (injection-moulded or cast,
  pulled along +Z) or milled (the tool along Z), or sheet. Said nowhere, a
  part with a draft requirement, by its name or a pattern, is moulded along
  its pull and parting, one that holds what `cast()` made, at the place it
  made it, solid there or shelled since with walls all round its middle,
  moulded along the way it was cast, and one written to STL or 3MF or
  checked for overhangs printed; a part bent from sheet is checked as sheet,
  saying it was taken for sheet by its shape, and a part meant to print is
  not. Every part is checked for closed voids, each named with its volume
  and box: a part meant to print is told it prints them sealed, any other
  that no tool or mould reaches them. A moulded part is checked for faces
  the mould traps: from points of each face's exact surface, the way its
  half of the mould leaves, the way the face looks along the pull or, given
  a parting, the half above or below it, meets the part again, so a rounded
  face that looks along the pull is not trapped and a ledge hanging over a
  floor is; each is named with its area and a point, and the ways square to
  the pull a side action could leave it by, or that none does. It is checked
  for sections thicker than 1.3 times its nominal wall, the median thickness
  of its largest faces, those holding a quarter of its surface, so ribs,
  however many, do not set it; thickness is the largest ball inside it
  touching the surface, measured again on the exact faces where it reads
  over, and straight in, so the corners of an even wall, whose ball is at
  most 1.27 walls across, are not one and a solid boss is. Its ribs, found on it as the ribs
  requirement finds them, however they were made, and the bosses `boss()`
  made on it, at the place it made them, are checked against the wall they
  stand on, measured through the part as shown beside the feature's foot,
  clear of a round at its root: a rib's root at most 0.6 of
  that wall and its height at most three walls, a boss's wall round its hole
  at most 0.6 of the wall beside it, 0.4 past 3.2 mm. Inner corners, bends,
  flanges and the walls of round holes are found one way for these checks
  and the requirement kinds alike. A milled part is checked for inside corners along the
  tool, sharp ones and those rounded tighter than a third of their depth; a
  round face most of the way round is a drilled hole and is not one. A part
  is taken for sheet when its bends, an inside and an outside round face
  about one axis, part of a turn, agree on one thickness, it is that thick
  nearly everywhere, all its faces are flat or round about one axis, and it
  unfolds: each bend runs between flat faces along its axis and ends only at
  the sheet's cut edges, so a shelled box with rounded corners, where three
  walls meet, is not sheet and a U channel is. It is checked by the
  sheet-metal rules the bend requirement applies, the two reading one table
  so a hole is never faulted by one and passed by the other: bends with an
  inside radius under the thickness, flanges shorter than four thicknesses,
  holes nearer a bend than 2.5 thicknesses and the bend's inside radius, and
  holes nearer an edge than two thicknesses. A part shown as sheet that is flat, cut from sheet with no bend,
  is checked for holes near its edges; one with neither bends nor a flat
  shape is told it has no bend to check. Each check stops when the build's
  time runs out, and a part it runs out before or during is named as not
  checked in full, with what was found of it before kept. A check the
  kernel cannot make is said for a part whose way is known, and nothing is
  said of a part whose way is not.

## Positions, sweeps, gears and explode

- A build given positions runs its script once with each one's arguments
  and checks the parts for overlaps at every position, saying at which they
  overlap and where; the first is the one measured, written and shown.
  Positions are for a build alone, never beside arguments. They are run
  in the script's run, after the build's own, leaving the run that measures
  them a share of the build's time: a position that would not finish before
  then is not started, and the answer names it and those after it, with how
  long each took, to check in another call.
- A build given positions and steps sweeps between them: each move from
  one position to the next is cut into that many even steps, every argument
  that differs between the two a number stepped from one to the other, and
  the build runs and checks at each step as at a position given, a
  clearance requirement included. One whose differing arguments are not
  numbers, or whose steps would make more than 48 runs, is refused. The
  answer names the pairs of parts moving with respect to each other that
  come within 5 mm at any step, the nearest first, each with its least gap
  measured exactly, where, and at which step of which move, so a near miss
  between two positions given shows.
- A build given a sweep moves parts as one rigid piece from that one build:
  turned about the axis through a point in degrees, or, with no point, slid
  along a direction in mm, in up to 360 even steps; it is refused beside
  positions, and refused for a turn past a whole one, an axis of no length or
  an empty move. Up to five further groups move with the first, as a gear
  with its pinion or a rack: each turned about its own axis, or slid, by its
  rate times the first group's move; a part named in two groups, a rate that
  is not a number other than zero, more groups, or a group's own from, to or
  steps is refused. Each part is meshed and boxed once, and the moving
  meshes and boxes moved.
  For each moving part and each part that stays or moves in another group
  within 5 mm of it, the answer says where they meet, from which step to
  which, how far they go into each other at most and where, and how near
  they come elsewhere, measured exactly; parts of one group are not measured
  against each other. The answer says how long the sweep took, in all and
  each position. A bd_warehouse gear turned about an axis more than a
  thousandth of a millimetre from its own, found on its solid, or not
  parallel to it, is named with where its own axis runs. A gear in no group
  that meshes a gear the sweep turns is named, with its own axis and the
  rate that turns it with the other, as its teeth would otherwise run into
  the other's. A part that stays and meets a part the sweep turns, with a
  round face on that part's axis and inside it, is named as a shaft made one
  with it, to be shown as its own part and turned with the other. Each group
  the sweep turns is slid a tenth of a millimetre
  each way along its axis from where it stands: a way it slides with no part
  that stays going further into it is said, with what stops it the other
  way, and a part that turns is said to need a stop each way. A sweep naming
  a part the script does not show says so, with the parts it shows.
- A gear of bd_warehouse's spur or helical gears is found in every part
  shown that keeps its teeth: bored for its shaft, moved, or joined with a
  web and another gear into a compound gear, each gear by the faces of its
  teeth, its axis where it was made, through its centre of mass, carried by
  how those faces moved. Two gears of two parts on parallel axes, side by
  side along them, with their tips reaching into each other, are said as a
  mesh from the figures each was made with: the centre distance against
  where their pitch circles meet, the backlash that alone opens, the working
  pressure angle and the contact ratio, and for helical gears the overlap
  ratio; gears whose base pitches differ are said not to mesh. A gear of a
  compound part meshes only the gears beside it along its axis. The mesh
  lines end by naming strength.gear for how the teeth fare, which the mesh
  does not measure.
- A mesh requirement holds two parts' gears to a least and most backlash,
  from their centre distance, and a least contact ratio; a pair none of
  whose gears mesh fails, and a part keeping no gear the studio knows is not
  checked.
- A build with positions may write a `.json` motion file: for each named part
  that moves, how it is moved from the first position at every position
  checked, found from the part's own corners and points along its edges
  however the script placed it, a stretch included, as a compressed
  spring's, so a plain shaft or ball turning about its own axis turns
  rather than slides; the answer says how many parts move over how many positions and
  how many stay put, and names each part no move, turn and stretch takes
  from one position to another, or whose points leave its turn open. A
  motion file without positions or explode is refused.
- A build or a drawing given explode moves its parts apart, as an exploded
  view: those it names, or all but those it keeps in place, or all but the
  largest. They are taken out one at a time, the one that clears the parts
  left soonest first, each along a way it is free to leave by: an axis, or
  the axis of its own round faces, as a slanted pin leaves its hole. A way
  is free when, moved along it as far as it goes, the part meets none of
  the parts left, found on their meshes by rays from each part's corners
  and edges along the way and back; a part that only touches another, or
  slides in its hole, is not stopped by it. When no part comes out alone,
  the smallest set that comes out together does, a part with what stops
  it, as a plug with the pin across it. Each is moved past the boxes of the
  parts it sits on, in or against, out of a pocket as well as off a face,
  and further by a share of its own size, and a part taken out earlier is
  moved further out wherever one taken out after it would pass where it
  lies. A part nothing frees stays in, and the answer names what blocks it.
  The answer gives the order, each part's way and how far it went. A
  build's preview shows the parts moved apart, and so do the exports marked
  exploded; its `.json` export holds the assembly sequence, every part out
  and then each going in in turn, from the parts as built. A drawing is
  drawn of the parts moved apart.
