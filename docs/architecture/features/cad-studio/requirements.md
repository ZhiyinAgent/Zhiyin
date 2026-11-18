# CAD studio: requirements

Invariants of the [CAD studio](README.md): what each kind of requirement
measures and how its verdict is said. The README holds what the studio is for,
its interface and the invariants that hold for every call. Each invariant here
is covered by a test.

## Requirements

- A build is checked against the design's requirements: the workspace file
  it names, or, naming none, `requirements.json` beside the script's file
  or at the workspace's top. The file holds from 1 to 100 requirements in at
  most 256 KB, each requirement's words, each name or pattern and each list
  of names at most 200 long, which the tool's description states; a file
  past one is not checked, its answer naming the limit and what to do
  instead, as a pattern between slashes standing for many parts. The file's
  format, its kinds and the verdicts' words are the studio-requirements
  package's, shared with the 3D studio. Each requirement is a check of a kind the CAD
  studio measures, measured on the parts by the CAD studio, never by the
  script: the size of a part, whether the parts fit a box, a part's holes of
  a size, the clearance between two parts, parts that must not overlap, the
  thinnest wall, the overhangs, the least draft, the mass in a material,
  whether a part goes into its place, its inner corners, its ribs, its bends,
  where the centre of mass lies, the faces a mould traps, its hollows, how
  smoothly its faces meet, and the stress and strain its sections take. A
  kind the 3D studio measures, as the
  file is shared with its spec, is read with its fields and never reaches the
  harness: the answer says it is not checked, as it is measured in the 3D
  studio. A kind neither measures is refused naming those the CAD studio
  does. A part of several solids that overlap is checked by the
  material they make, as it is measured, never solid by solid. The answer
  says how many hold, each one's measure and its
  margin to the limit, and how each margin moved since the last build of
  the same design checked against the same file in the conversation: the
  same script's file, whatever its arguments, or code given in the call; a requirement that
  failed in that build and is no longer in the file is named once, with how
  far past its limit it was, so taking one out is said, never silent. The
  person is shown the same verdicts as a list of checks under the build,
  each requirement holding, failing or not checked with its measure, and a
  removed failure under the list; a build with no requirements shows none. A
  requirement whose
  part the build did not show is said not checked. A part with fewer holes
  of the size than asked fails, saying how many of how many, with no
  margin, since no size limit measures a missing hole. An overhang
  requirement finds each surface steeper than its limit and measures how
  far its farthest point lies from an edge held up from below: one on the
  bed, or one the surface beside goes on downward from, as a wall under a
  ceiling. A surface passes when that is within half the bridge the
  requirement allows, so the top of a short window passes and a wide
  ceiling fails; the answer names the surface reaching farthest, its area
  and its place. A part with no surface past the limit holds with its
  steepest overhang as the margin. Draft is measured
  on every face toward the way its half of the mould leaves it: the mould
  splits at the height along the pull the requirement gives, or at the
  part's lowest, faces above leaving along the pull and those below
  against it, and faces lying flat where the halves meet need none. A face
  leaning back from its half's way, as a taper the wrong way, a waist or a
  groove's ceiling, is an undercut: its draft is below zero, and the answer
  says where it is. A face crossing the parting is in both halves, so
  unless it lies along the pull it is an undercut on one side, which the
  answer names, saying to part the mould where the walls turn from leaning
  one way to the other. A wall requirement measures the part's thickness
  inward from 600 points spread over its faces by their area; one that
  fails names every place thinner than its limit, the thinnest first, each
  with its thinnest point, its extent and how many points it holds, a
  place being thin points that are each other's neighbours, so a thick
  wall between two thin spots keeps them apart. It names at most eight,
  and how many more there are. It says how far apart those points lie, and
  measures a grid around the thinnest, finer each round, so a thin spot
  between the points first measured, as under a cone's tip, is found and
  named as a place. A size may be given as a range along each
  axis, a single number held to a hundredth of a millimetre. A clearance
  may also ask for more room near the print bed, the parts' lowest, where
  the first layers spread: within half a millimetre unless it says how
  high, so a hinge fused at its base fails though its bore clears above.
  A corner requirement finds every inner corner, a concave edge of radius
  0 or a concave round that does not go all the way round as a hole's wall
  does, and, given the cutter's axis, only those running along it, so a
  pocket's rounded upright corners pass for a cutter on that axis while its
  sharp floor edges fail when every corner is checked; it fails with the
  tightest, where it is, and how many of each radius are under the limit.
  A ribs requirement finds each flat-topped wall standing out from a face,
  drafted or with a rounded root, more than three times as long along its
  top as it is thick and at least as tall as thick, so a pad or a boss is
  none, and measures its thickness at the root and its height against the
  share and multiple of the wall asked. Its height is how far it stands out
  of the face it rises from, the shorter of its two sides, so a lip flush
  with an enclosure's inside wall stands out of the rim, not the wall. Where
  ribs cross, the end of one past the last crossing is part of that rib, not
  one standing on the other. A part's own walls and edges, whose sides end
  at convex edges or at a round that bends back in, as a shelled cover's
  rounded edges do, are no ribs, and a part with none found is not checked. A
  bend requirement finds each bend of a part bent from sheet, two rounds
  on one axis a sheet's thickness apart, and measures its inside radius,
  the shortest flat beyond a bend and the nearest round hole to one; a part
  with no bend is not checked. It may ask for every sheet-metal rule from the
  sheet's thickness (inside radius, flange, hole to bend, hole to edge, and
  reliefs where a bend ends inside the sheet), each said with its margin; a
  bend that ends inside the sheet with no relief fails it with no margin. A balance requirement weighs each part by
  its material when given, and checks the centre of mass against a point
  within a tolerance, any axis left free, and against the outline of what
  the parts stand on, seen along up, failing a design that tips by how far
  outside it the centre lies. A wall requirement may also ask how the wall
  spreads about its nominal, the thickness over the part's largest faces
  unless given, for any way of making: its thickest section, the largest
  ball inside it, against a most or a multiple of the nominal, and the share
  of its surface outside a band about the nominal. A point reads thin when
  straight in is and thick when its ball is, measured again on the exact
  faces, so an even wall's corners and a rib's top read as the wall and a
  solid boss reads as thick; the answer gives the share of the surface in
  each band of thickness, the thickest place and where the wall changes
  most steeply. An undercut requirement finds the faces the mould traps, as
  the check of a moulded part does, and holds when their area is within the
  most allowed, a face a side action square to the pull frees allowed when
  the mould has them. A void requirement fails on each closed void, and,
  given an opening, on each hollow wide enough to hold a ball of that size
  that the ball cannot leave by, found on a grid whose pitch the answer
  gives, so a hollow print whose drain is too small fails and one whose
  drain the ball passes holds. A smooth requirement compares the faces
  meeting at each edge between those checked, the part's named surfaces or
  all its faces: their normals within an angle (G1), and at G2 their
  curvature across the edge within a share of the larger, so a box's rounds
  hold G1 and fail G2, and a sharp edge fails both. A stress requirement
  cuts the part square to its length at 61 stations and reads each
  section's area and second moments from the solid, so a shoulder or a hole
  counts where it is: the bending moment of its beam case at each, resting
  at both ends, held at its root or at both ends, the load at its middle,
  its free end or spread, and a torque's shear: T·r/J on a round section,
  solid or a tube, and on any other, a D-flat, a square, a keyway or a
  hollow, Saint-Venant torsion solved on the section by finite elements,
  each different section once, within 1% of the closed forms of a round, a
  square and a hollow ellipse; the answer gives the torsion constant and
  which way it was found. The solve is finer about small rounds the
  material wraps and again about its highest shear until that settles,
  saying so when it does not. A sharp inner corner has no finite peak of
  shear, so the shear is read clear of it, and the answer says how far and
  that a radius has it measured; von Mises against the yield
  over the safety factor asked gives the margin in MPa, and a deflection
  limit is checked by the curvature summed along the length. A strain
  requirement takes an arm held at its root and pushed at its tip by the
  deflection asked, finds from its sections the force that takes and the
  strain it leaves, and checks the highest against the strain the material
  allows. A file named that is
  missing refuses the build. A file that is not requirements of those
  kinds never blocks one: the build goes ahead checking none, and its
  answer, and the person's list of checks, say which requirement and field
  to fix.
- An insert requirement moves a part into the place the script showed it
  along the way it names, from clear of the parts it goes into, or of every
  other part, or from as far out as it asks, as an axle goes through its
  bores or a lid onto its box. Where the part would first meet one is found
  on the parts' meshes, from every corner of each and points along its
  edges, by a ray along the way the part moves against the other; a part
  that only touches another, or slides along it, does not meet it, so a gap
  under twice the meshes' tolerance counts as touching. One that would meet
  another fails, saying how far short of its place, where on the other, and
  how far into it it would go: the thickness of the material they would
  share, cut exactly a fifth of a millimetre to five millimetres past where
  they meet. One that gets to its place holds by how near it passes the
  others, measured square to the way between the points of their meshes
  that pass each other, so a pin's clearance in its bore is what is read and
  a seat it comes down onto is not; the answer says, too, what it sits
  against at its place, measured exactly, and a part that overlaps another
  there by less than the meshes find fails, saying how far into it.
