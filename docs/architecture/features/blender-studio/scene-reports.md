# 3D studio: what a call says about the scene

Invariants of the [3D studio](README.md): the checks after a change,
describing the scene, and looks and close-ups. The README holds what the
studio is for, its interface and the invariants that hold for every call. Each
invariant here is covered by a test.

## Checks after a change

- **A change is checked where it reaches.** After adding, editing, shaping,
  a material or a script, the answer lists the faults the change left, each
  with its count and one place, by what it is in, or says in a line that there
  are none; a change that touches nothing they check says nothing of them.
  Past a dozen objects with faults, like faults are said once for all the
  objects that have them, counted by the name they share, and the faults an
  answer lists are bounded in length, saying how many lines it leaves out.
  The checks of one call take at most 20 s, or half of what is left of the
  call's time when that is less: an object is checked only while
  the time left holds its faces at the most a face has taken so far, and what
  they leave is named unchecked, never taken as sound. A shape that changed is
  checked for points lying on others unjoined (but for the caps Blender lays
  on a curve's ends), faces
  lying on one another, faces with no area, faces pointing into a solid (a
  hollow's inner walls face its hollow) or against the rest of an open sheet,
  measured as a look counts them, edges more than two faces share,
  points and edges on no face, faces of more than four sides that are not
  flat, faces of four sides folded more than 20° across both diagonals, flat
  areas over a twentieth of its surface that smooth shading leans more than
  2° where a face meets them at 30° or more, holes and crossing faces, and a
  boolean step a script left that takes nothing away. A facet of a curved
  surface, whose neighbours turn from it less, is not such a flat area. A
  shape that was the same on both sides of its own x, y or z = 0 before the
  call and is not after it is said in a line of its own, apart from the
  faults, with how far its surface strays from its mirror, as an RMS and the
  largest, and where; a shape already uneven, or past the points or time its
  symmetry is measured to, is not. Each shape is compared with itself before
  the call whatever it is called now, after a script as after a typed
  change, so renaming one changes nothing checked and a renamed shape that
  lost its symmetry is said. After a shaping step or a script, the
  faces of each shape it changed are counted in a line: quads, triangles and
  faces of more than four sides, with a place for each. A shape moved, changed, added, hidden or taken away is
  checked, with what stood against it, for being held by nothing, lying wholly
  inside the solid of another that lets no light through, and tipping over:
  its centre of mass beyond where it stands, seen from above, on what is under
  it and what it leans against, the floor included. Its centre of mass is the
  middle of its closed pieces' volume, or of its surface where it encloses
  none, as an open bowl's. What lies on its top holds nothing up. One with
  nothing under it, as a picture or a shelf held against a wall, stands on
  nothing and does not tip; nor does one attached to another, or going into
  one, as a handle's ends go into a pot, which is held by it. One whose scale is
  negative, or uneven under steps with widths, is named. A material changed or
  given is checked for metalness between metal and not, a colour whose
  luminance reflects less or more light than real surfaces do (a saturated
  paint reflects far less than white), a metal darker than any metal, a
  refraction no clear material has or none at all for glass, an ior below
  air's, a roughness of 0 on an opaque surface, a colour picture read as data
  and a data picture read as colour, a missing picture file, a partly
  transparent picture read with straight alpha, whose colour Cycles and EEVEE
  darken by its alpha, pixels a script
  set in a picture that is neither packed nor saved, a normal map named as
  made for DirectX but read as OpenGL, in a scene EEVEE renders the nodes only Cycles draws with
  the input each feeds and what EEVEE draws instead, and nodes that feed
  nothing, a chain of them named by its last. A shape whose material lays a
  picture by its layout is checked, when its shape, layout or materials
  change, or a material it wears changes, for faces with no
  room in the picture, faces turned over in it or its whole layout turned
  over, stretch on more than a fiftieth of its surface, and detail per
  centimetre varying more than twice over it; one with no layout is said to
  show the picture as one colour. Faces sharing room in the picture each show
  the whole of it, as a repeat step's copies do, and the faces a mirror step
  turns over mirror the picture with the shape: neither is a fault, as only a
  bake would be harmed. A layout by longitude and latitude, as a
  sphere's, gathers the picture to each pole by its nature, so its stretch
  and detail are not counted.

## Describing the scene

- **Describing the scene names the shapes still as added.** A primitive,
  revolve, outline or tube that adding made keeps its kind and a print of
  its mesh and steps; describing names each still as made, with its kind and
  its steps, among how many meshes are described. Moving, turning or
  resizing it, along its own axes, keeps it as added, and so does a bevel,
  whichever tool rounded it; an edit to its mesh's points or faces, a join,
  shape keys, or any other step added or taken away do not. It is a fact
  about the mesh, not a judgement of the shape.
- **The form of each mesh is measured on its shape, however it was made.**
  Describing, a look and a render each name the meshes they show with sharp
  edges, where neighbouring faces turn by 60° or more with nothing rounding
  them, and how long those edges are in all; a bevel by a step or in a
  script's mesh leaves none, and a sheet's rim thinner than a millimetre is
  not counted. They also name each part pushed into the object it belongs
  to that shares a material with it, and how deep, as a handle into its
  mug; a part of another material, such as the coffee in the mug, is not
  named. The solid-view pictures, a look's sheet and the quick picture of
  the 3D view, are drawn in each surface's own colour, without the camera's
  exposure or tone.
- **A torn shape says where.** An open shape names its holes, how wide each
  is and where. A sheet's outline is no hole: a piece of a mesh closed but for
  a few gaps has holes, but a piece whose open edges enclose a quarter of its
  surface or more is a sheet, however fine its faces, as a floor, a cloth or
  terrain is, and a sheet beside a closed piece leaves that piece's gaps told. A shape whose faces cross each other says how many places
  and one of them, and whether its own steps make them, as a bevel too wide
  for its corners does.
- **A tube end that meets nothing is named.** A tube's end that lies inside
  no other object is given with its place; an end set in what it joins is
  not.
- **The scene can be read back.** Describing the scene gives each material's
  values and each editing step's, what the camera's picture shows whole, cuts
  off or misses, and the render settings with the tone and exposure. An object
  whose material lays a picture by its layout is given the picture's pixels
  per centimetre on it and, from the camera, the most pixels per centimetre
  the shot shows of it, at its nearest point in view, with whether the
  picture is blurred there or more than twice what the shot shows. A scene
  of 600 parts is described whole within the command's time limit. A call
  naming a material that exists changes only the values it gives, keeping
  every other, and its answer says what changed from what; a finish given
  brings its own colour, metal, roughness and coat unless the call gives
  them, and a value given replaces a kept one it cannot stand with. A
  material made by other means, given only values its shader takes, keeps
  its own shader nodes. A material a script built is described by what feeds
  each input of its shader, as “Base Color <- Mix(Noise 3 mm,
  #8a5a3c..#b07a50)”, with the nodes that feed nothing, picture nodes with no
  picture, and, in a scene EEVEE renders, the nodes only Cycles draws. The
  approval shows the values given and says the change reaches wherever that material is used; naming one with nothing
  else puts it on as it is, and its approval says so instead of naming a
  colour and roughness. A material named by nothing is named, and shown, after the
  first object. The preview shown with it is said to be the 3D
  view's quick one, and from where, so it is not taken for a render.
- **Saying where one shape goes into another is about the shapes.** Whether a
  point is inside a shape does not depend on which way its surfaces face. A
  shape clear of another, or only against it, does not go into it; one that
  does is said to go in as deep whichever of the two is described. It holds
  as well far from the scene's origin. What goes into what is measured on the
  shapes' surfaces, never their boxes, and the answers say so. Each closed
  shell of a model's parts holds what is inside it on its own, so a point
  beyond parts that touch face to face is inside none of them. Every answer
  that says how far one shape goes into another measures it one way, so a
  description, a placing, a measure, a spec and a contact agree: the depth
  of the deepest point of either surface inside the other, or, into an open
  surface such as ground of one face, how far one reaches through it on the
  side it reaches less far.
- **What an object places as instances is its shape.** Copies that geometry
  nodes or a collection place are measured with the object that
  places them, wherever an answer measures shapes: its size and heights,
  what goes into what, the pieces nothing holds, setting it down, framing,
  and the scene's description, which says how many it places, of what, and
  their faces. What goes into one is named by the object and what its
  copies copy. Of an object's copies, the first thousand are measured, and
  the description says so past them. In the description, an object placing
  more than one instance says how many of its instances go into each object
  it goes into, measured instance by instance, with the deepest.
- **A piece nothing holds is counted.** Of an object made of separate
  pieces, as a row of blades joined into one mesh, the description says how
  many nothing holds: a piece is held when it rests on, lies against, goes
  into or holds another piece of the object, or the shape of another object
  in the picture, or comes within a millimetre of it, as a pin turning in
  its bore does, measured on their surfaces, or stands on the floor. The
  floor is at z = 0 when the scene's shapes reach it, and otherwise at the
  bottom of the lowest of them, so an object alone always stands on it.
- **What floats is said.** An object none of whose pieces touches another
  object or the floor is said to be held by nothing, with how far above the
  floor its bottom is, or how far above the nearest shape straight under it,
  and how to set it down or attach it; when none of its pieces holds another,
  that is said once, without counting them as well. An object meant
  to hang is not: one attached to another, held by a constraint that
  follows another, moved by keys or drivers, given to a rigid body
  simulation, or marked as flying, as a bird or a drone is.
- **How each object stands is said.** Of each object not attached to
  another, its instances included, what holds it up is said by the surfaces
  that touch it: what it rests on, the floor among them, what it stands
  against, what it hangs from when held only from above, and what it is set
  into when it goes into it. Of two touching shapes, the one something else
  holds up carries the other: a lamp hangs from a ceiling the walls hold,
  and the ceiling does not rest on the lamp. What lies on an object's top
  and nothing else holds is carried by it, so a sheet with plates on it and
  nothing under it is said to have them on it, with how far it is above
  what is under it. One touching nothing is said with how far its bottom is
  above what is under it, found under any part of it, or above the floor
  with nothing under it, and one marked as flying is said as flying. After every change this is one line for the objects that
  moved or were added, what touches nothing first, the farthest above what
  is under it first, and past a dozen, the objects held alike said together,
  counted by the names they share. The description gives it in each
  object's line, and those touching nothing in one line, the farthest first.
- **Many going into one are said together.** In the description, where five
  or more objects go into one, their lines leave it out and one line gives
  how many, their names counted by the names they share, and the deepest.
- **The scene's budget is said.** The description gives the faces the scene
  draws, every instance counted, the faces held in the meshes Blender keeps
  once each and how many those are, the instances, the memory the pictures
  its materials use take as loaded (a material nothing wears is not saved, so
  its pictures are not counted), and the five objects drawing the most
  faces, an object placing instances counted with them. A spec's faces
  requirement is what warns past a budget.
- **A thin sheet is measured by its own thickness.** A label or lettering
  thinner than a millimetre that lies on a surface does not go into it, and
  one that does is said to go in no deeper than it does. A part attached to
  an object is measured by its own thickness, so lettering attached to a jar
  is still a thin sheet.
- **See-through shapes in the same place are said.** When two shapes that
  let light through have surfaces in the very same place, such as a liquid
  drawn standing on its jar's floor, the answer to every change, description
  and render says so, with how much of them, until one reaches into the
  other. Where one of the two is solid, nothing is said: it hides the place.

## Looks and close-ups for the model

- **A look from four sides is for the model, and changes nothing.** It shows
  the scene, or the objects named with their parts, alone, from the front,
  the right and the top drawn flat and from three-quarter, each framed on
  them and labelled, on one sheet kept in the app's data: shaded in each
  surface's colour, as wires along every edge over the surface, or with the
  side of a face that faces out blue and the side that faces in red, or by
  every surface's reflections of a light in bands across the world's x, y or
  z, with how far each mesh's neighbouring faces turn from each other across
  the edges it shades smooth across, the most and where, and what 95% of them
  turn within; `zhiyin.reflection_lines` says the same in a script. The
  scene, its settings and its time are as they were after it.
- **A look counts a mesh's faults.** For each object it says whether it is
  closed or how many open edges it has; the faces pointing inward and where,
  a closed piece's outside found by rays, so the inside of a hollow points
  into the hollow; the faces of more than four sides, the largest and where;
  its pieces and loose points and edges; the thinnest wall of its closed
  pieces and where; and the faces a script left selected, with their
  heights. Each is said on a mesh that has it and not on one that does not,
  and objects with a fault come first. As the checks after a change judge
  them, open edges are a fault only where they are holes, not a sheet's
  outline, and faces of more than four sides only where they are not flat,
  so a cylinder's flat caps and a plane are sound. A model that cannot see pictures
  reads the counts alone.
- **A look counts a mesh's pieces that pass into each other.** Where two
  closed pieces of one mesh share a material and one goes into the other,
  as joining a handle's mesh into its mug's leaves them, the object's count
  says how many and how deep; pieces of different materials, such as a pen
  and its cap, are not said.
- **Close-ups show what an overview hides.** Each object asked for is drawn
  up close from its clearest side and the opposite one, beside the line
  describing it gives.
- **Close-ups can pick the objects a scene is mostly about.** Given how
  many instead of names, close-ups show those the camera's picture shows
  most, past the setting: an object that fills a fifth of the picture or is
  three times as large across as the middle one in view, such as the floor
  or the table. Objects whose pieces pass into each other, or with a part
  pushed into them, come first. A scene's reviewer is handed close-ups of
  four of them besides its views from four sides.
- **A face that bends is measured as it is drawn.** Rays that find which way
  is out of a shape, how thick it is under a face or what closes a face in
  start on the surface Blender draws, so a subdivided shape's curved faces
  point out, have their thickness and are not closed in by themselves.
- **A look at the motion that fails is taken back too.** A frame sheet, a
  look or a video that fails part way loads the scene file again, as a failed change
  does, and says so when it cannot.
