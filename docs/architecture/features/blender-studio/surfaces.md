# 3D studio: surfaces

Invariants of the [3D studio](README.md): materials, unwrapping, baking and
decals. The README holds what the studio is for, its interface and the
invariants that hold for every call. Each invariant here is covered by a test.

## Unwrapping, baking and decals

- **An unwrap cuts each part until it lies flat,** and with a camera the cuts
  run where it sees least. Seams given to a projection, which takes none, are
  refused.
- **An unwrap's answer measures the layout on the shape** with its steps:
  islands, angle and area stretch, texel density, faces turned over,
  overlaps, how much of the tile it fills and what reaches outside, and the
  seams with the share the camera sees. Islands a mirror step stacks on their
  twins are named as mirror twins, not as faces turned over.
- **A bake writes only the files its approval names:** one PNG per object and
  map in the workspace folder given. It reads any material's own values, so
  a glow or an opacity does not darken another map. A baked object wears a
  copy of its material drawn from the maps; its own materials stay in the
  file, and the scene's render and bake settings and selection are as
  before. A bake from high-detail objects sets its cage from the gap measured
  between the surfaces, and says the share of texels its rays missed.
- **A decal is laid where it is cast and says how it lies:** where it landed
  and which way the surface faces there, its size on the surface and its
  area, its worst stretch and where, and how much of it is off an edge or on
  the back side. A mesh decal says its least and most gap to the surface.
- **A decal's material is its own:** a copy of the surface's material under
  it, with the decal mixed into only the channels it affects, so the rest
  matches, and the surface showing through where the picture is
  transparent; both Cycles and EEVEE draw it. A decal is held by what it lies
  on, never a loose piece of it.
- **A decal says whether the camera would mix it up with the surface,** from
  its gap at the camera's distance, against what EEVEE and Cycles can tell
  apart. A decal laid over another stands above it, and the answer names the
  overlap. A decal named as one already there replaces it; a name another
  object holds is refused.
- **A strip says its runs,** its length, its pattern pieces at the pitch they
  were evened out to, the gaps across the corners where runs meet, and how
  far it stands off; folded over an edge, it lies on the faces either side.
- **A normal decal changes only the relief, by shading.** It draws one of
  Zhiyin's own shapes, made at run time, or a picture's brightness as height,
  bending the surface's material on top of the relief it already has; round
  the shape the surface renders as it did. A groove or shape strip does the
  same along a line, and a groove says whether it runs unbroken, which open
  ends stop short of an edge, how far a curve strays off the surface, its
  width in the camera's picture and where it reaches the outline the camera
  sees.
- **A wrap label says the arc it covers** round the object's axis at its
  radius, and across its height how far the radius under it changes and its
  width stretches with it. Paper shows white where the picture is clear;
  clear film shows the surface, through the ink too when the ink has no white
  under it. A label more than once round is refused.

## Materials

- **Wood is a finish.** A material given an amount of wood shows grain in
  the colour it was given, which stays the wood's own: streaks along each
  object's longest side, a few centimetres wide whatever its size, in Cycles
  and in EEVEE. One material serves a top and its legs, each board has its
  own streaks and tone, and a board that is resized keeps its grain along
  its length. The end of a post or a plank shows rings; an end wider than a
  board is sawn, as the top of a cupboard is, shows a panel, with streaks
  along its longer side. The way each object's grain runs is laid after the
  same calls that settle a sheet of glass, and after no other. Half is a
  calm grain whose light and dark stay
  within a tenth of the colour; the whole is bolder. A wooden surface is
  described by its colour and its amount of grain, and the light on it is
  metered as on paint. Wood and a picture are not given together.
- **A finish is drawn at its real size.** Metal (cast, machined, brushed,
  painted, plated, heat-tinted, anodised, galvanised), car paint, carbon fibre,
  textured plastic, rubber, braided steel, leather, fabric, knit, ceramic glaze,
  concrete, stone, marble, frosted glass, paper, cardboard and skin are drawn
  on any shape with nothing to unwrap, in metres on the object itself: a
  braid's strands are as wide on a small part, on a large one and on one a
  script scaled up, in Cycles and in EEVEE, and every finish renders in both.
  Left without a colour, a finish has its own colour, metal, roughness and
  coat, which the answer says with what the finish shows, and the scene's
  description lists the finish with the material's values. A finish is not
  given with wood or a picture, and frosted glass is the one finish that lets
  light through, which the answer and the description say.
- **Brushed metal is brushed the way the answer says.** Its lines run along an
  axis of the object's own, in circles round one or out from one: given, or
  the object's longest side for lines, else the axis it is as wide round both
  ways, or its thinnest side; the lines show along that axis in Cycles and in
  EEVEE. The answer names the axis and why, and that only Cycles draws the
  highlights out across the lines. Skin and marble scatter light under their
  surface, and the answer gives how far against the object's thinnest side.
- **Wear and dirt come from the shape.** Wear rubs edges through, in chips, to
  polished or bare metal; grime darkens where a surface meets a wall; rust
  starts on edges and in corners and runs down the walls below them as the
  object stood when it was given it, turning with the object afterwards; drip
  streaks run down the same way; dust settles on faces that look up, leaving
  the sides as they were; scratches run along the object's longest side and
  fingerprints lie on open faces, both out of recesses. Each is drawn in
  Cycles and in EEVEE, each an amount from 0 to 1, over a finish, wood, a
  picture or a plain colour. Glass takes dust, scratches, drips and
  fingerprints, never wear, grime or rust. The answer says, for each object,
  about how much of its surface each covers and how much of that lies on
  edges, in recesses and on open faces, and how far runs reach down,
  estimated without rendering from points sampled on the surface: they follow
  the picture's formula with Blender's Python noise in place of the shader's,
  so the share of a whole surface comes close to the picture's and the marks
  fall elsewhere. The scene's description names each mark's
  amount and how metal was brushed.
- **A sheet of glass lets light through.** A flat sheet of glass far thinner
  than it is wide, such as a window pane, casts no shadow and stands out of
  the way of the light that reaches a surface, so a room behind a glazed
  window is lit as through the open hole, with its patch of sun. This is
  settled after every call that can give a material, change one or change a
  size (adding, editing, shaping, materials, scattering, decals, baking,
  animating, simulating and scripts), over every object, whatever made the
  sheet or changed it, and after no other call; the answer names a sheet
  when it becomes one, and the scene's description says which objects cast
  no shadow. The light that passes is not coloured by the
  glass. Glass that is not a sheet shades what is behind it from direct
  light, as Cycles draws it.
- **A picture can be what glows.** A glowing material with a picture and no
  glow colour of its own glows with the picture, as a screen does; given a
  glow colour, it glows in that colour.
- **A glow can have a colour temperature** and can be kept from being
  sampled as a light; it says both, and a later change to another of its
  values keeps them.
- **A picture on a front face reads the right way up.** Seen from the front,
  its top is up.
- **A picture laid by layout goes only where a layout fits it.** A material
  with a picture laid by the shape's layout, new or named again, is refused
  for a shape with no layout, as a ring or a turned profile has, and for one
  whose layout is wholly turned over or leaves more than a fiftieth of its
  surface no room, as lettering's and an outline's are; the refusal names
  the projections that fit any shape.
- **Materials start from Blender's own defaults.** Specular and the coat's
  roughness, left out, are what Blender gives a new material.
- **A material names each input it holds that is not the default.** The
  coat's tint and ior, the tint of its reflections, its diffuse roughness and
  GGX reflections in place of multiscatter GGX are each said when given, with
  what an engine does not show: diffuse roughness is Cycles' alone. Named
  again, a material says which of them changed.
- **Light inside is weighed against the shape.** A material scattering light
  inside starts from skin, marble, milk or fruit as they were measured, or
  from wax, jade or egg as starting points to judge by eye, taking that
  colour unless given one. The answer gives how far light reaches in red,
  green and blue, and each object's thinnest part: a reach wider than it
  lets light through, which the answer calls jelly, giving the scale that
  keeps the reach under half of it. It says what EEVEE draws differently.
- **A tint is the colour seen through a depth.** A clear material given a
  tint absorbs light inside so that the colour shows through that depth,
  measured in Cycles, and the answer gives the colour seen through each
  object's thickest part, its own colour filtering it too. A tinted material
  is white unless given a colour. A tint is refused on an opaque material and
  on a shape with no inside, and the answer says EEVEE does not show it.
- **Relief says whether the shape can show it.** Height from a picture or a
  pattern, at a depth in metres, is drawn as bump, by moving the surface, or
  both. Moving it, the answer sets the mesh's edges, or the edges an
  adaptive subdivision dices it to, against the size of the detail, a
  pattern's or a pixel's, and says how far the object's box grows.
- **A material can go on some faces.** A mesh's faces picked by the way they
  face within an angle, by a box in the world, by a face attribute or kept
  pick, or by the material they show, take the material in a slot of their
  own, and the rest keep theirs; the answer gives how many faces and their
  area, and a pick that takes nothing is refused.
- **A texture set is laid by its names.** Its pictures are named one by one
  or found in a workspace folder by the word that ends each name; each drives
  its input, read as colour or as data, relief read smoothly. Where a set has
  more than one of a kind, the normal map for OpenGL and then the largest is
  taken. The answer lists each map with its pixels and how large one lies on
  each object, the maps it leaves and why, a value given that a map drives
  instead, and a height map left undrawn until height is given a depth. A
  size in metres lays one repeat over that much of each object.
- **A normal map's convention is said.** A normal map is read as OpenGL or
  DirectX as given, or as its name or its set says, or as OpenGL, Blender's
  own, and the answer says which and why.
