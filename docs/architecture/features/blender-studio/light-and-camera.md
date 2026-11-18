# 3D studio: light and camera

Invariants of the [3D studio](README.md): the camera, the lights, the world
and the look of a render. The README holds what the studio is for, its
interface and the invariants that hold for every call. Each invariant here is
covered by a test.

## The camera

- **Framing fits the shapes.** A framed object reaches the picture's edges by
  its outline, not its box, a model file's parts each by its own surface, centred with as much space on each side, and is
  seen from the side and elevation asked. A turn round adds to the
  direction's own, and the answer says where the camera lands. An
  orthographic camera is sized to it the same way.
- **A view from above reads as a plan.** A camera looking straight down,
  framed from the top, raised all the way or placed by hand, has +y up its
  picture and +x to the right. A turn round turns the picture, and the answer
  says which way is up it.
- **The camera says what it cannot see.** A shape in the picture that others
  cover wherever it is in it is said to be hidden behind them, a camera inside
  a closed shape says so, and a part is told with the object it belongs to.
- **A lens shift slides the picture without turning the camera.** The camera
  tool takes one as across and up, each a share of the picture's longer side,
  as Blender measures it: what the camera sees slides that far, and the camera stays as level as it was. The shift a
  camera has is said in every camera answer and in the scene's description,
  however it was set, and a camera call that names none leaves it. Framing
  centres what it frames under a shift, and what the camera is said to show
  is what it shows.
- **Focus follows its object.** A camera focused on an object keeps focusing
  on its middle when either moves: after every call that can move a camera
  or an object or change a shape (the camera, lighting, editing, shaping,
  settling, scattering, animating, rigging, simulating and scripts), and
  after no other.

## Lighting and the look of a render

- **A product backdrop surrounds the scene.** With the product lighting, a
  camera from any side sees the backdrop, never the world beyond it, and it
  is never said to go into what it surrounds. In reflections it is as
  bright as a white surface beside the product, so a glossy deep colour keeps
  its colour, unless the model brightens it there; the picture's background
  stays the same either way. Through clear glass it is as bright as beside
  the glass, so the glass looks clear rather than smoked. Its floor lies a
  hair under what stands on it, so glass on the backdrop renders as glass
  standing on a surface, the same as glass held a hair above it.
- **A product's colour renders as given.** The product lighting sets a tone
  that shows colours as given, so an object's colour comes out close to the
  one asked on a white backdrop in Cycles, and close to Cycles in EEVEE.
- **A light lights only what it is linked to,** in Cycles and EEVEE, and its
  answer names what gets none of its light. An object that may not cast a
  light's shadows leaves what is under it lit.
- **An area light takes the shape and size asked.** A square, a disk, a
  rectangle such as a strip light, or an ellipse, at [width, height]; an
  uneven size makes a square a rectangle and a disk an ellipse, and a square
  or disk asked with an uneven size is refused.
- **A light says the light it gives.** A colour temperature colours a light,
  and its answer gives the colour that makes; an exposure brightens one light,
  and its answer gives the power that comes to. A sun has its width in the
  sky, and says how bright it lights a white matt surface square to it: π
  lights it to white.
- **A sky's sun is said by its side.** The sun's rotation is a compass
  bearing with +y as north. Setting a sky, the daylight preset and the
  scene's description each say how high the sun is, which side it stands on
  by the scene's axes, and which way its light travels, so a window can be
  given the sun without a picture to find out.
- **A sky has ground under it.** Below its horizon a sky is near black and
  blue, which reads as a sea through a window and as night behind a house seen
  from above. There the surroundings are level ground instead, as bright as
  grey ground lit by that sky and sun would be, and the scene's description
  says so.
- **The studio has surroundings to reflect.** The studio preset sets its
  lights in Blender's own photographed studio, kept in the scene so it reads
  no file outside the workspace: chrome shows its white floor, while the
  camera sees plain dark grey behind the scene. Blender's other surroundings
  can light a scene by name, the camera seeing them or a plain colour given
  with them.
- **A preset replaces only what a preset made.** The model's own lights stay
  through a preset, and replacing the lights keeps the backdrop. A light named
  again changes only what is given, and a moved light stays aimed at the point
  it was aimed at. The answer that makes a light says where it was put, and
  an area light's says whether it is round or square, as the call asked. A
  preset sets the tone and leaves the exposure, and says the exposure it
  leaves when that is not 0. The backdrop is the one a preset made, whatever
  its name: a model's own object named Backdrop keeps its material and is
  exported like any other.
- **Cards are seen by no camera** unless a card's own rays say so, which
  later changes to it keep. Reflection, bounce and flag cards, and objects
  whose rays are set, each say which rays see them, and each card says which
  objects it brightens or darkens, measured in a small Cycles picture with it
  and without. An EEVEE picture names what it leaves out because only other
  rays see it, and a picture's colours leave out what its camera does not see.
- **Fog says how far one sees through it:** the depth that lets a twentieth
  of the light through, how much of the farthest shape shows, and, measured
  in a small Cycles picture with it and without, what it adds to or takes
  from the picture's brightness and how much longer the picture took. Fog
  that thins with height lets the camera above it see further and changes the
  picture less. Endless world fog is said to let no sun light through.
  Density 0 removes fog.
- **Caustics are Cycles only and say what they lack.** An EEVEE picture says
  it draws none. Caustics are measured in small Cycles pictures with them and
  without: light a glass ball focuses brightens part of the floor, and an
  opaque ball brightens none of it. Path guiding stays in the scene.
- **A Cycles render says how many samples it spent and what stopped it,**
  how much of the picture took every sample while still over the noise
  threshold, how it was denoised and what its samples are clamped to.
  Sampling, the denoiser and the clamps stay in the scene; EEVEE refuses
  them.
- **Outlines name their method** and darken edges in both engines. A new
  method replaces the old one, and none removes them all; an outline by
  script is refused without a camera. A render with outlines says how much of
  the outlined silhouettes carries a line, and names a shape whose line is
  missing along much of its edge.
- **A toon material splits its light into the bands asked for** in each
  engine, and the answer gives the bands' colours, tinted when a shadow
  colour is given, and its rim. Nodes that feed only Cycles' own output are
  not said to be missing from EEVEE. A material given toon by its call is
  shaded the same; one with an input toon lacks is refused. A render says
  how many flat colours each toon shape shows against the bands asked, says
  when they are fewer, and gives the picture's palette.
- **A render's post is Blender's own compositor nodes and groups,** laid
  over that render and every later one in both engines, in order. Their
  inputs in use are read back and out-of-range values are said; an unknown
  input or choice is refused with those it has, and an input its choices
  leave unused is refused with those choices. A render says what it was
  composited with, and an empty post removes it. The camera refuses picture
  effects and points to the post. A picture with the post is drawn raw and
  composited from its light, the same picture a composited render gives, so
  its light is measured as the scene made it. A glare given no threshold
  glows past one measured from that light, and the answer gives it and the
  share of the picture brighter, saying when nothing glows. A picture on
  white has no post, nor has a plan. A script lays one too, and appends any compositor group
  Blender bundles by its name, a name it lacks refused with those it has.
