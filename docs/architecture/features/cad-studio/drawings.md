# CAD studio: drawings

Invariants of the [CAD studio](README.md): drawing a part or the 3D scene:
views, dimensions and the sheet. The README holds what the studio is for, its
interface and the invariants that hold for every call. Each invariant here is
covered by a test.

## Drawing a part

- A build's `.csv` export lists each different part once, with how many:
  parts where one is the other moved and turned are one row, and a mirror
  image is its own. bd_warehouse's standard parts are bought, by class and
  size; mass is volume times the density of the material given. The answer
  says each row and what it could not tell. A parts list whose materials name
  no part is not written, and the answer says so; the build's other files
  stand.
- A drawing's parts list given no materials takes each part's from the
  requirements beside the script that name it a material, then from the last
  drawing of the same file, which wins where both name one; the answer says
  where they came from. A made part still without one, whose way of making
  is known as a build of the script knows it (shown with `making`, a draft
  requirement, `cast()`, or written to STL or 3MF by an earlier build of
  the script in the conversation), takes the title block's material, with
  its mass from that material's density, where the material written there
  names one of the material table, or several of which only one is given to
  no part; the answer names the parts that took it. A bought part never
  takes it, and a made part whose way of making is not known keeps none,
  the answer naming it and saying how to give it one.
- A drawing is kept, in the conversation's own folder, as it was asked for,
  by the files it wrote, and its answer says how to draw it again: given
  `again` and one of those files, a drawing is that request with each input
  given beside `again` in its place, approved as the whole drawing it is.
  `again` naming a file no drawing of this conversation wrote is refused
  before anything runs.
- A drawing is approved and run as a build is, and writes only the files its
  outputs name. A drawing that cannot be made as asked, a view or a
  dimension of a kind it does not take, a key it does not know, an output of
  another kind, a scale not in its lowest terms, two views of one name, a
  dimension, detail or output of a view the drawing does not have, details
  each taken from the other, by any number of steps, or a
  dimension with keys of another kind of dimension, is refused before
  anyone is asked.

## Dimensions

- Each dimension is measured on the part: a length between the corners or
  edge ends drawn nearest its two points, a diameter or a radius of the
  circle drawn at its point, a diameter also of an arc that goes more than
  half way round its circle, and the value written is the one measured. A
  diameter asked of an arc that goes half way round or less is refused,
  saying its size and how far round it goes, and that it is given by its
  radius. A
  diameter of every hole of a size counts the holes of that size, not a pin
  or a shaft of it. Two need no point: an overall size is the view's whole
  width or height, as far as its lines, curves and arcs reach, never to an
  arc's centre outside the part; a
  diameter or radius given only the size it should have is the circle or
  arc of that size the view draws, and none of that size refuses the
  drawing, saying the sizes the view has. A size it was expected to have, read to the decimals it
  is written with, so 80 holds 80.04 and 80.1 does not, that the part does
  not have, a point with no geometry near it, or a view the drawing does not
  have refuses the drawing, saying each, and nothing is written; a point
  with no geometry near it is told the nearest corners, ends and centres,
  with how far each is. So does a
  point that is no corner and lies between two, as a chamfered or rounded
  corner leaves, naming both; a dimension on the angled view or on a detail
  of it, where lengths are foreshortened; a point at the centre of circles
  of different sizes that the view does not tell apart by which it shows,
  given a point on each; a
  section whose plane cuts no part, beside it or on its face, or cuts only
  parts it leaves whole; parts left whole or revolved that the drawing does
  not show; parts revolved without an axis lying in the cutting plane, or
  both left whole and revolved; a
  section or an auxiliary view that no straight view of the drawing can
  mark, naming views that could; a detail whose circle holds nothing of its
  view; a length written as a diameter where no round face's axis or circle
  lies midway between its ends; and title text in a script whose letters
  join, as Arabic, Hebrew, the Indian scripts and Thai do.
- A hole callout is read from the solid: its drilled diameter and depth or
  THRU, the counterbore or countersink at its mouth, and its thread only where
  bd_warehouse's TapHole or ThreadedHole made it in a BuildPart; otherwise the
  answer says its thread is not known. A chamfer is written C<leg> when
  square at 45°, else <leg>×<angle>°; an angle is measured between two edges;
  an ordinate is the signed distance from a datum, set in a row with jogged
  lines. Each kind's expected size is checked, and an angle between parallel
  edges or a chamfer that cuts no corner is refused.
- A drawing of parts given no dimensions carries its overall sizes, the main
  view's width and height and the depth from a view beside it, and the
  distance between the axes of each pair of gears in mesh, on a straight
  view that looks along them, and the answer says so and how to choose them;
  one given an empty list carries none. The answer names the title block's
  title, drawing number and drawn-by fields when left empty.

## Views and their lines

- Gears bd_warehouse made, bored, moved or joined into one part, are drawn
  as ISO 2203 draws them: unsectioned, a solid bounded by the tip surface
  with no teeth, its pitch surface a thin chain line, as a circle seen along
  the axis and a line past each side seen across it; in a section the band
  of teeth is cut and drawn with its root line but not hatched, the rest of
  the gear hatched. Seen across their axes, two gears in mesh do not hide
  each other's tip lines there, unless another part stands in front. A
  helical gear seen across its axis carries three thin parallel lines along
  its teeth on the side facing the viewer, at the helix angle and leaning
  its hand's way. A gear moved since it was
  recorded, as a drawing taken apart moves it, is drawn as made.
- A bearing bought from bd_warehouse is drawn as ISO 8826-1's general
  simplified form: its outline alone, a ring of its outside diameter, bore
  and width, without balls, rings or cage. A section along its axis cuts the
  ring without hatching it and draws an upright cross in each half. A
  bearing whose outline cannot be found on its faces is drawn as made.
- A round edge is drawn and measured as a circle or an arc whichever curve
  it is, as a hole through a shaft's round face shows, and arcs of one
  circle that go all the way round are that circle. Where two faces meet
  smoothly, as a fillet meets a flat face, the edge is a thin line, and is
  not drawn behind. A hidden line or circle found twice or in pieces is one,
  a circle seen edge on is the line it keeps to, and a hidden line or arc is
  left out where it lies under a visible one, as a through hole's far circle
  lies under its near one, keeping only the length nothing seen covers; a
  line too short for two dashes gets shorter ones, so it still reads
  as hidden; one too short for any dash a reader could see is drawn solid, and
  no file holds a dash of no length, which PDF readers refuse. A length whose
  end was found away from the point given says where, and how far. Every hole seen end on, however small, and a slot's half-round
  ends have a centre cross; round faces that go at least half way round,
  tapers included, have a centre line, one along each axis; a rounded
  corner has none, and a section, which draws no hidden edges, has none for
  a hole it does not show. A part is hatched alike in every section, and a
  thin wall or a fin closer than a broad face, so it still reads as cut; and
  parts a section is told to leave whole, as a shaft or a screw cut along
  its length, are drawn whole and not hatched. Parts a section is told to
  revolve, as a row of blades, are turned about the axis given into the
  cutting plane and drawn as their full outline, on both sides of the axis,
  unhatched, hiding the lines, centre lines and circles behind them. A view
  told to draw no hidden edges draws none, and the answer names each view
  whose hidden edges lie closer than a millimetre over several places of
  the sheet, which read as a mass, to be drawn so.
- A view of many thousands of lines, as rows of blades give, is drawn in
  seconds: lines and circles found twice or in pieces are joined by where
  they lie, not each against every other.
- A section cuts a part the plane parts into pieces, and centres round
  faces however they were cut, an off-axis cut through a bore included. A
  plane along a line where two walls of a part touch, as a water jacket's
  walls touch the bores they surround, cuts it as any other.
- A curved edge, or a sliver of one, that keeps to a straight line is drawn
  as that line, never as an arc of a vast circle.
- A view the drafting fails on, from a fault in the kernel or in the lines
  it was given, refuses the drawing, naming that view and the failure, with
  the drawing's other faults.
- The views of a drawing of parts are worked out side by side, each by a
  run of its own, so the drawing takes about as long as its slowest view. A
  view not done in the drawing's time, which keeps room to lay the sheet
  out and write it, is stopped and left out with the details taken from it;
  the sheet is drawn with the rest, and the answer names each left out and
  the dimensions on it; a DXF of such a view alone is not written, and the
  answer says so, by the path the model gave, and why. A drawing none of
  whose views is done in time is refused, saying so. Either way the answer
  names the time the drawing had and says to draw one subsystem per call or
  to ask for more minutes. Every view asked for that is not drawn is
  accounted for: left out for time, refused with its reason, or else named
  as a fault that refuses the drawing, never passed over.
- A detail keeps its parent's arcs as arcs and its cut faces, each cut to
  the detail's circle. Details may be listed in any order, one of another
  included.

## Laying out the sheet

- A drawing's parts list puts the parts table above the title block, and the
  views are laid out in the frame round the corner the two hold, keeping out
  of it. Views that the grid of projection does not hold are packed into
  the room highest first or leftmost first, whichever fills it more evenly.
  Laid out either way, the views then spread apart across the room the
  corner leaves, each axis stretched as a whole and the views moved alike,
  so rows stay level and columns aligned and no two come closer, until the
  narrowest gap between views, the corner and the frame is as wide as it
  can be. The angled view, which lines up with none, comes last, set in the
  middle of the largest room they leave, across and up, a gap clear of
  everything, so no large piece of the sheet is left empty; where it fits
  nowhere, it is spread with the rest. The table's columns for
  a part's name, description and material share their room by how wide
  what they hold is written, so a long material is not cut short while the
  description has room to spare. Each item is ballooned, numbered as the table, on the chosen view
  where a point of it shows there, else on the first other straight, angled
  or auxiliary view that shows one, else on a section, at a point inside a
  face its plane cuts; the answer says which items are on which view, and
  names each item no view shows.
- The views are placed by the projection asked for at the largest standard
  scale at which they fit the sheet, or the next smaller one when only it
  gives every dimension clear room; or at the scale asked for when they
  fit. When the angled view alone keeps them from fitting, it is drawn at a
  smaller scale of its own, written with its name, at most two standard
  scales below the sheet's, before the sheet goes to a smaller one. Every
  other view sits on the same grid, level with the views in its
  row and centred on those in its column: a section in the place of the view
  it looks as when that view is not drawn, as a plan cut through walls takes
  the top view's place, and otherwise level with it; a
  detail beside the view it enlarges; the angled view in an empty corner,
  or round a parts list set apart as above. Only when that grid does not
  fit are they packed into the room left. A
  detail is drawn at its own scale, its sheet's times its own, and
  every scale is written as a drawing writes one, 3:5 and not a float's
  digits. A view is given room for its name, its centre lines and the
  circles of details marked on it. A section's, a detail's or an auxiliary
  view's name is written under the view, below its dimensions, or above it
  when that is clear; a back view without the side view it stands beyond is
  placed apart and named.
- The marks that tie one view to another come first: a section's cutting
  line, across the whole view wherever the plane passes and out past it, so
  its thick ends and arrows lie clear of the view, and its letters; a
  detail's circle and its letter, which keeps about a millimetre of clear
  paper from every line, further out with a thin leader where the circle
  lies on the part; and the arrow and letter saying which way an auxiliary
  view looks, aimed at the faces it sees squarely, on the sheet beside the
  view it is seen across. Lengths come next, the shorter nearer their view, on the
  side nearer what they measure or else the other, their text moved along
  their line where that clears it, and their extension lines kept off
  lettering and other views; a dimension's line within a couple of
  millimetres of another view meets it, as it would read as that view's,
  and an aligned length keeps off its view's edges, not its box. An
  extension line is kept from running just beside an edge of its own view,
  where it would read as that edge's; one that can only run there is named
  in the answer, to be measured where its lines run clear. Centre
  lines are kept clear as other lines are.
  Leaders come last, passing beside the view's other circles, except their
  own and those they lie inside, and crossing as little of their view's
  outline as they can, a radius's arrow on its own arc. Each is placed where
  no line crosses its lettering
  and it meets nothing placed before; one the sheet has no clear room for
  is drawn where it spoils least, its lettering kept clear first, and the
  answer names it, saying a larger sheet or fewer dimensions gives it room,
  or a smaller scale when the scale was asked for; one whose lettering or
  lines reach past the frame is named apart, as drawn past the frame.
- Lettering is single strokes; characters its font lacks, Chinese, Japanese
  and Korean among them, are drawn as outlines from a Windows font that has
  them, and accented Latin, as Vietnamese writes it, is lettered whole.
- Every field of the title block stays in its cell, its text made smaller
  to fit, then set on as many lines as the cell holds, and cut short with
  an ellipsis only when even that does not fit; the answer names each field
  cut short.
- A DXF of one view holds that view alone, at full size, its circles as
  circles. Of a straight or an auxiliary view, it is the part's cutting
  profile along that view, as a laser or a waterjet cuts it: its outline at
  its widest, and a hole only where it goes right through, at its
  narrowest, a countersink's or a chamfer's slope left out. Of a section or
  a detail, it is that view's visible edges.
- The answer gives the sheet, scale and projection, every view with its
  scale where that differs and its size on the part, every dimension as written, each file written with its size, and a picture of
  the sheet 2,000 pixels on its long side, the most a model is shown, so none
  of its lines is resampled. An answer that is not a drawing's is no answer.

## Drawing the 3D scene

- A drawing of the scene runs no script: code, a file, arguments or parts
  given with it, objects given without it, or no scene open in the
  conversation, is refused before anyone is asked, and so is any drawing of
  the scene when the 3D studio is not there. The approval names the scene
  file and the objects drawn, every shape the scene shows when it names
  none, says Blender reads the scene and leaves it as it was, and is bound to
  that scene: one approved before another scene was opened does not run.
- Blender is asked for the lines of the views as the drawing names them, or
  of the front, top, right and angled views when it names none, and the
  drafting is handed exactly what Blender gave. When Blender cannot give
  them, the answer is its reason, and nothing runs or is written.
- The scene is drawn, measured, checked against the sizes it was expected
  to have and written as a part is, in the scene's own millimetres, and its
  file is left as it was. An edge Line Art finds twice, in pieces or going
  back on itself is one line; an edge behind is left out where it lies under
  one in sight. A round edge modelled with twelve sides or more is a circle;
  one with fewer is the lines it is.
