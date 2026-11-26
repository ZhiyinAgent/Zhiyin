# 3D studio: renders, exports and drawing lines

Invariants of the [3D studio](README.md): pictures, model files and the lines
a CAD drawing is made from. The README holds what the studio is for, its
interface and the invariants that hold for every call. Each invariant here is
covered by a test.

## Exports

- **An export writes the one file it names.** No materials, pictures or data
  are written beside it, and objects it names are exported even when hidden,
  with the parts attached to them. A hole's cutter is never exported, and an
  export that names nothing takes what is shown, leaving out parts the model
  hid. A USD file names the pictures it uses from where it is, so its folder
  can move with them. A `.usd`, `.usda` or `.usdc` file is written whether
  the workspace is on Zhiyin's drive or another. A `.glb` holds what
  geometry nodes place, as it holds what a collection places.
- **An export says what of a material the file cannot hold.** A model file
  carries a surface's values and its pictures, not nodes that work a look
  out, as noise, wood, a finish, wear and grime do. The answer names each
  material with a colour, metalness, roughness, relief, glow or opacity
  driven that way, what the file gives it instead, as a `.glb` holds it, and
  that exporting a `.glb` with bake keeps it. With bake, a `.glb` carries
  those looks in pictures baked for it and packed inside, which the answer
  names, and the scene keeps its own materials; a format without materials,
  or one that refers to picture files, refuses bake. A plain colour or a picture is said
  nothing of. A picture laid by projection or by coordinates other than the
  shape's layout is said to be laid by the layout in the file, and a picture
  mixed with other nodes to lose them: `.glb` and USD keep the picture alone,
  and an FBX keeps the input's own value instead.

## Lines for a CAD drawing

- **Finding a drawing's lines leaves the scene as it was.** Blender finds them
  on copies of the objects in a scene of its own, which it removes, and the
  scene file and every object are as they were. What an object places as
  instances, copies of a collection or those geometry nodes make, is drawn
  with it, and a section hatches each copy it cuts. A section's cut faces are
  outlined all round, walls that meet at a corner included. A view told to
  draw no hidden edges is given none. Objects a section revolves are neither
  cut nor drawn by Line Art: their surfaces are given as triangles, for the
  drafting to turn into the plane. Nothing is asked of Blender
  while no scene is open, and the answer says so. The lines are written in
  the conversation's own folder, never the workspace, and none is kept once
  read; when Blender cannot find them, the answer is its reason.

## Renders

- **An EEVEE picture is said to be a draft, unless it is final.** The answer
  to an EEVEE render says it is a quick look at layout and framing, and that
  light, colours and the picture to hand over are Cycles's, and glass too
  when the scene has some; a Cycles render says nothing of the kind. An EEVEE
  render through a camera with something of the scene straight above it, as
  in a room, is drawn by Cycles at a few samples, so its light and colours are
  the room's, and its answer says so. An EEVEE render asked to be final, or
  showing a toon material, is the picture to hand over: EEVEE draws it, and
  its answer says the shadows, ray tracing, volumes and samples it was drawn
  with instead of calling it a draft. Its quality options stay in the scene,
  and baking light probes fits a volume round a scene that has none. On a PC
  whose graphics card cannot draw, Cycles draws every picture asked of EEVEE,
  a plan and a video included, as a draft of 16 samples, and the answer says
  that EEVEE cannot draw on this computer; the quality options given stay in
  the scene, no light probes are baked, and a toon material shows as Cycles
  draws it (see the README).
- **A plan is one picture that leaves the scene as it was.** A render asked
  for as a plan shows the whole scene from straight above, with +y up the
  picture, lit by a white background alone in the neutral tone, with the
  lights left out. EEVEE draws it, because its light from the background is
  not shaded by walls: a floor shows close to the colour it was given
  however high the walls round it are. Cycles is refused for it before it is
  approved, and it is not called a draft. The scene's camera, lights, background, tone, exposure,
  picture size and hidden objects are the same after it as before.
- **A camera named for a picture is for that picture.** A render or a video
  through a named camera is taken through it, says so, and leaves the scene's
  own camera as it was.
- **A picture can show one part alone, framed for it.** A render that names
  only some objects shows them and their parts, with the lights and the
  backdrop, and its colours name nothing else; framed for itself, it is taken
  through a copy of the camera fitted to them from the side asked for. Every
  object shows again afterwards, and the scene's camera is where it was.
  Naming objects both to show only and to leave out is refused.
- **A picture written over an older one replaces it whole.**
- **A render measures its own light.** Its answer gives the share of the
  picture clipped to white and crushed to black, and when either is past
  what a picture keeps detail with, 1% and 5%, names the limit and the
  objects it is mostly on; how many stops the middle of its light lies from
  middle grey, beside where a white surface lit to show white lies; how far
  its light spreads; how much of the picture the subject covers, where its
  middle is, the space above it, the edges it meets, and the camera's tilt
  off level. A plan and a picture on white are not measured so.
- **A Cycles render says its noise.** Two more pictures at half its size,
  with other seeds and no post, differ by its noise, said as a share of the
  brightness, with the objects it is most on past 2%, and the lone bright
  samples in the light of one of them only, before denoising; when the call
  sets a clamp, those are counted with it and without it. Denoised, it names
  the surfaces whose fine detail, which both noisy pictures share, the
  denoiser smoothed away, with the share each keeps. It is measured when
  asked, or unasked when the picture took 20 seconds or less, and not when
  asked not to.
- **A large render is timed before it is made.** A Cycles picture of as many
  pixels and samples as 1920 by 1080 at 128 or more is timed from two
  smaller ones first, after a third drawn untimed, which readies what they
  all draw with, so that time is not counted as the picture's own. One that,
  with the time the call has already taken and the two pictures its noise is
  measured from when that is asked, would take past most of the call's time
  limit is refused before it is made, with the time, its size and samples
  and what to lower; otherwise its answer gives the estimate. Each Cycles
  render says the most memory it took.
- **A render says what it leaves in the scene.** A size given for a picture
  through the camera becomes the scene's, and the answer says the new size
  and the old one. A scene with no lights, under no sky whose sun is up, is
  said to be lit by its background alone.
- **A video is timed before it is made.** One frame is drawn alone, after
  the first readies what the rest draw with, and its answer gives the
  estimate. A video in the workspace whose frames would take past most of the
  call's time limit is drawn frame by frame over several calls with the same
  inputs instead, at least one frame a call, its frames kept in the
  conversation's own folder under the name it was approved by and its
  settings; each call skips the frames made and says the frames made and
  left, the seconds a frame took and the time the rest need, and the call
  that makes the last writes the video and removes the frames. One outside
  the workspace is refused with the time and what to lower.
- **A picture can leave objects out.** Objects named to be left out of a
  render are missing from that picture and from the colours it reports, and
  stay in the scene, unhidden.
- **A plan is cut as a drawn plan is.** By default the cut is 1.2 m above
  the floor at z = 0, or above the lowest point of a scene that stands
  elsewhere, and `cut` sets another height. Nothing above the cut is drawn,
  so a ceiling does not hide the rooms. Each closed shape the cut passes
  through is filled where it is cut. One as high as the highest of them is
  filled dark, as a drawn plan fills its walls. A lower one, as a door's
  leaf, a window or a wardrobe is, is filled in its own colour, so it is not
  taken for a wall. A door shows as a gap in its wall and a window shows the
  top of the wall under it. The answer says the height, what stands above,
  what was filled dark and what in its own colour, each from the object that
  covers most of the plan. Walls drawn as one outline with their openings cut
  into it are filled as separate walls are, also when a sill or a worktop
  lies at the very height of the cut: such a face is left whole, and what
  starts at that height is not drawn. A cut above everything takes nothing
  away, and a picture through the camera refuses one.
- **A plan says what lies over the rooms.** An object left under the cut that
  covers most of the plan from high up is named in the answer with how to
  leave it out.
- **A see-through render leaves the backdrop out.** The product stays whole
  in the picture and the background around it is clear.
- **A render says the colours it shows.** Its answer gives the colour each
  object shows in the picture, what is inside glass or a liquid told apart
  from it, and the background's; in a plan, what fills a cut is said as the
  object it was cut from. It tells up to 4,094 drawn objects apart, and says
  how many more it did not. Which object is where is found in drawings of
  the scene itself, made without its compositor or sequencer, so a scene
  that composites its picture still has its colours told by object.
  Reading them leaves the scene as it was. It
  also gives the tone and exposure the picture was made with, which decide
  how those colours stand against the ones given. An exposure given to a
  render is that picture's alone, as a camera named for it is: the scene
  keeps its own, which the answer gives when they differ, and a plan, drawn
  at its own exposure, refuses one.
- **A render keeps the scene's denoising and says what guiding does.** A
  Cycles render denoises as the scene is set to; a draft and the full
  previews, drawn at a few samples, are denoised and leave the setting as it
  was. Cycles guides paths only on the processor, so a render on a graphics
  card of a scene that asks for path guiding says it was drawn without it,
  and the scene keeps the setting.
- **Thick glass has no dark bands.** With something see-through in the scene,
  renders and full previews follow light through enough bounces, and the
  scene keeps its own settings.
- **A white render is exact white around the product.** Everything but the
  product and the shadow it casts on the floor is pure white, as marketplaces
  ask, the product looks as it does on the backdrop, and glass shows white
  through it. Nothing but the picture is written to the workspace. It
  renders with Cycles, and EEVEE is refused before it is approved.
- **A render says which lettering does not read.** Lettering that shows
  within thirty levels of the colour of what it lies on is named, with what
  it lies on; in a colour that stands apart nothing is said.
- **A render meters its own light.** A matt surface shows at its own colour
  when the light on it, after the exposure, is what a white card would give
  back as white. When surfaces covering a tenth of a Cycles picture are lit
  two and a half times past that, the answer names them, says how many times,
  and gives the exposure that shows them at their colours; set, the next
  picture shows them so and says nothing. A surface drawn as wood or a
  finish, worn or grimy, is metered by the colour it was given. Glass,
  liquids, metals, surfaces showing a picture and glowing surfaces are not
  metered, nor is a plan, a picture on white or
  transparent, or EEVEE. Under the studio and the product lighting a subject
  is lit to show near its colour, and nothing is said of it. The light
  metered is the scene's own, before any compositor: a post that darkens the
  picture leaves it as it was.
- **A render says how far each colour is from its material's.** Each object
  with one plain colour of its own is given the CIEDE2000 difference between
  the colour it shows and that colour, most apart first, and one past 5 is
  said to read as another colour.
