# Blender studio

## Purpose

Builds and renders 3D scenes in a Blender that Zhiyin installs and runs
itself, one headless session per conversation (ADR 0026). The model works on a
`.blend` file in the workspace through tools a person can read before
approving, and the person watches each change as a preview beside the
conversation. People see it as the 3D studio.

It is a feature of its own because the session is a long-lived process with
its own state, preview feed and failure modes, unlike the Python environment
or the document compiler, which run a program once per call. Blender runs
inside a process container (ADR 0004) and is reached over two pipes created
for its launch; nothing listens on a port.

## Boundaries

- **Owns:** each conversation's Blender session and its lifecycle, the script
  Zhiyin runs inside Blender, the scene file a session works on, the tools and
  how each is described for approval, the previews and the person's view of
  them.
- **Does not own:** installing Blender (toolchains), permission decisions
  (permission engine), the connection's lifecycle (MCP), choosing what is
  shown beside the conversation (core), drawing the 3D view (renderer), or
  showing a final render (document viewer).
- **Talks to other features only through:** the interface below and contract
  types. The capabilities group adapts a session's automation into a built-in
  connection; the core follows a session's state for the 3D view.

## Public interface

- `new ConversationScenes({ blender, directory, launch, script })` holds every
  conversation's scene. `blender` answers where Blender is installed,
  `script` is the session script shipped with the app, and `launch` starts
  Blender; `containedSessionLaunch(containment, open)` is the one the app
  uses. It starts Blender at low integrity and opens the conversation's own
  folder to it with `open` (ADR 0028).
  - `scene(conversationId)` returns that conversation's `SceneSession`,
    created on first use and started when a tool first needs it;
    `existing(conversationId)` returns it only if it exists.
  - `onScene(listener)` hears each scene as it comes into being.
  - `directory(conversationId)` is where that conversation's Blender keeps
    its previews, settings and logs, in the app's data.
  - `close(conversationId)` ends a conversation's Blender, which starts again
    from the scene file on the next command; `forget(conversationId)` also
    removes its folder; `closeAll()` ends every session.
- A `SceneSession` has `state()` and `onState(listener)`, a
  `ScenePanelState`: whether Blender is closed, starting, open or failed, the
  scene file, the view and the latest preview. `look(intent)` applies a
  `SceneIntent` from the person: camera or overview, turning or zooming the
  overview, back to the start, and the size the view is drawn at. `close()`
  ends the session.
- `sceneAutomation(session, { workspaceRoot, blender, directory,
  openToBlender })` returns the tools for the model, a `WritingConnection`:
  `listTools`, `callTool`, `inspect`, `describeResult`, `produced` and
  `close`. `openToBlender` lets
  Blender write in the workspace; `workspaceOpening(open)` is the one the app
  uses. `describeSceneTools(blender)` lists the tools without starting
  Blender.
- Twelve tools:
  - `blender_open_scene` opens or creates the scene file.
  - `blender_add_objects` adds shapes, text, an outline extruded to a height,
    a profile turned around an axis, a tube along a path, an SVG drawing, a
    picture on a plane, or a model file read with Blender's own importers.
  - `blender_edit_objects` moves, turns, resizes, renames, attaches, hides,
    duplicates, sets down on the floor or on another object, or deletes
    objects.
  - `blender_shape_objects` cuts, joins or intersects objects (a cutter can
    be described in the call, which is how a hole is made), and rounds edges,
    repeats, mirrors, thickens, smooths or subdivides them.
  - `blender_set_material`, `blender_set_camera` and `blender_set_lighting`
    set how the scene looks.
  - `blender_render` and `blender_export` write a picture or a model file.
    A picture is taken through the scene's camera, or is the plan of the
    whole scene from above.
  - `blender_describe_scene` reports the objects with their sizes, positions,
    materials and modifiers, whether each mesh is closed and its volume, the
    camera, the lights and the render settings with the tone and exposure.
  - `blender_api` answers what the installed Blender's API accepts, read from
    the running Blender.
  - `blender_run_script` runs any Blender Python in the session.
- `studioTools`, the 3D studio's tools as the model is offered them.
- The types these take and return: `ConversationScenesOptions`, `SceneCommand`,
  `SceneOutcome`, `SceneSessionOptions`, `SceneAutomationOptions`, `LaunchSession`, `OpenFolder`,
  `SessionLaunchOptions`, `SessionProcess`, `StudioTool`.

## Invariants

- **One conversation, one session.** A conversation's tools and view reach
  only its own Blender.
- **A Blender too deep to run is refused before it starts.** Where some of
  its own files lie past the 260 characters Blender can open, the session
  says so instead of starting a Blender that cannot load them.
- **Blender yields the processor.** It runs below normal priority, so a
  long render on the processor leaves the person's own programs responsive.
- **Blender starts on compiled Python.** Its archive carries its scripts as
  source, and contained it can keep no compiled copy beside them.
  `compiledBlenderPython` is the step the installer runs once: Blender's own
  Python, taking nothing from the person's, compiles Blender's scripts and
  library, and the compiled files name their sources where they are installed.
- **Blender starts on its own settings.** It ignores the person's Blender
  startup file, preferences and add-ons, Blender's own variables in Zhiyin's
  environment, and USD's and MaterialX's, which name the plugins it loads and
  the folders it reads models and materials from; it keeps its own settings in Zhiyin's data, and never
  runs a script saved in a scene file.
- **Nothing changes before a scene is open.** The scene file is a
  workspace-relative `.blend` that stays inside the workspace, and creating
  one never replaces an existing file. A scene opened in a folder the
  conversation has since left is not open in the new one: nothing there
  changes it, and a scene the new folder contains is named as that folder
  has it.
- **Every file a tool names stays in the workspace.** Pictures, fonts,
  drawings and models it reads, and renders and exports it writes, are
  workspace-relative paths with an expected kind of file. Anything else is
  refused before Blender is reached. A file it writes is named as the
  workspace has it, however the path was written, so the approval and the
  conversation's files agree.
- **A model file reads nothing from outside the workspace.** A model whose
  pictures, geometry, materials or parts lie outside is refused and leaves the
  scene as it was; what an importer would read itself is refused before it is
  read. USD comes as text, binary or a package (`.usd`, `.usda`, `.usdc` and
  `.usdz`): text is checked by the paths it writes as files, binary USD by
  every string it holds, and a package by each scene in it, read as USD reads
  them; its pictures are kept in the scene named as the package holds them.
  Each path is checked from every folder USD would look in, the workspace
  being the folder Blender reads from while it imports. USD that names a file
  in a way the check reads differently from USD, binary USD or a package that
  cannot be read that way, and USD text that plays clips are refused. A scene
  file that uses files kept elsewhere opens, and the answer names them.
- **An export writes the one file it names.** No materials, pictures or data
  are written beside it, and objects it names are exported even when hidden.
- **A change is saved, answered, then previewed.** After every command that
  changes the scene, the session saves the file and answers; the preview
  follows, so stopping a preview never takes back a saved change. A command
  that fails, a render included, reloads the saved file, so a half-made change
  reaches neither the file nor the preview.
- **An error the session carries on past is kept.** Where the session goes on
  past an error, such as a saved file that cannot be loaded again after a
  failed change, it writes the reason and its trace to the session's log in
  the conversation's 3D folder.
- **The file is the truth.** When the scene file changed on disk since the
  session saved or loaded it, the session loads it before the next command.
- **A command that does not finish ends the session.** Past its time limit,
  or stopped with the turn, the session is ended and the answer says what was
  left: no change, a change already saved to the scene file, or a file that
  was being written and may be incomplete. The next command starts a new
  session from the file. A session that exits on its own is reported as
  failed, with what it printed. Stopped while Blender is still starting, a
  command answers at once that nothing changed, and Blender goes on starting
  for the next one.
- **Previews stay out of the workspace and never flash.** A preview is
  written in the app's data, and the view replaces the shown preview only with
  a complete one.
- **The person's view changes only the preview.** Choosing camera or
  overview, turning, zooming or resizing the view re-renders the preview and
  never touches the scene or its file.
- **Turning keeps up with the hand.** While the view moves, each change is
  drawn quickly, as Blender's solid view draws the scene in each surface's own
  colour, and the full preview follows once the view has been still for a
  moment. A zoom scales the picture on screen at once, until Blender draws it.
- **What is inside glass shows.** EEVEE draws light through one layer of glass
  at most, so a full preview of a scene with glass or a liquid is drawn by
  Cycles on the graphics card, as the render will be. EEVEE also lets a sky's
  light through walls and ceilings, so a full preview through a camera that
  has something of the scene straight above it, as in a room, is drawn by
  Cycles too, at half size on a PC with no graphics card Cycles can use, and
  shows the room as a render does. A full preview drawn by
  Cycles takes about a second of drawing at most, so a scene that is slow to
  draw never holds up turning for long, and the scene's own settings stay as
  they were.
- **The view says what it cannot show.** The view appears as soon as Blender
  starts, and says so. A preview of a scene with nothing in it says the scene
  is empty, and the view says so instead of showing it, adding that the agent
  is still at work while it is. While Blender works, the view says that over
  it.
- **What is approved is what runs.** A call is described the same way each
  time it is looked at, so one approved after a wait still runs. The approval
  holds the scene it works on and whether each file it writes is new, so a
  different scene or a file that appeared meanwhile asks again.
- **One allowance covers work on the open scene.** Every call on the open
  scene that writes only new files offers the same allowance for the
  conversation, named after the scene (ADR 0027). Opening another scene and
  replacing an existing file ask again, and offer only that exact call.
- **A script says what it can reach.** It is asked for every time, and its
  approval says, beside the code, that it can change any file in the
  workspace and none outside it, that it can read any file the person's
  account can read and use the network, and that going back restores only the
  scene file. A repair never rewrites
  its code. It runs in the workspace folder, so a workspace path opens as it
  is.
- **Only the preview Zhiyin asked for is read.** A preview file Blender names
  is read and removed only when it is the one the session chose.
- **Calls read as words.** Each call is shown, for approval and in its details,
  as a few named rows in plain words with sizes in metres or millimetres, and
  the files it changes are named alongside; the script tool shows the whole
  script as code.
- **Every input has one type.** No tool input may be either of two kinds of
  value, so a provider that reads a written-out call back by declared type
  receives every value whole.
- **An input a shape does not take is refused,** and the refusal says what it
  takes, so nothing given is dropped without a word. A cutter always has a
  size, and the answer says it.
- **A size is the object's own.** An object's size is along its own axes,
  before it is turned, both when it is given and when it is said back, so
  resizing a turned object changes it along its own length.
- **A location is an origin.** Solids, text, pictures, drawings and model files
  are centred on their origin; a shape drawn through points (a turned profile,
  an outline, a tube) keeps the coordinates it was drawn in around it. A
  drawing or a model lands where it is asked, at the width or size and the
  depth asked.
- **Positions and turns are the world's.** An attached part is placed, moved
  and turned in the world's terms like any other, including one attached in
  the same call as its parent.
- **An assembly holds together.** Copying, hiding or deleting an object does
  the same to what is attached to it, and the answer names those parts. A
  hole's cutter is attached to its object, so the hole moves, turns and is
  copied with it. Resizing a part leaves what is attached to it as it was; a
  group's parts are the group, so they resize with it.
- **Set down, not dropped through.** Resting an object on another lowers it
  straight down until the two first touch, so it lands on the first surface
  below it, including where the two meet between corners, as crossed logs do,
  and never sinks into it; on the floor, its bottom is at zero.
- **Every answer places what it moved.** Adding, moving or shaping an object
  answers with its size, origin, bottom and top heights, and what it goes
  into; a resting contact is not counted as going into.
- **Lettering and drawings are shapes.** Text and SVG drawings are meshes, so
  they can be rounded, cut into and joined like any other shape, and the
  scene names a text's lettering.
- **A model file is measured as its shape.** A part whose faces each keep
  their own corners, as model files often store them, is measured as closed
  when its corners meet, with its volume.
- **A mirror never overlaps itself.** What reaches across the mirror is cut
  away, keeping the side the object mostly lies on, so the result is the
  shape mirrored and its volume is counted once.
- **A bevel never rounds a shape away.** A bevel wider than half the object's
  thinnest side is refused, and the refusal says the most it can be.
- **Walls are as thick as asked.** Thickening grows walls inward, so the
  outside keeps its size, and they keep their thickness at corners.
- **The scene can be read back.** Describing the scene gives each material's
  values and each editing step's, what the camera's picture shows whole, cuts
  off or misses, and the render settings with the tone and exposure. A
  material is set whole on each call, except that naming one with nothing
  else puts it on as it is. The preview shown with it is said to be the 3D
  view's quick one, and from where, so it is not taken for a render.
- **Round is smooth unless asked otherwise.** A tube is a curve through its
  points, ends included, or straight runs between them when its corners are
  sharp. Round shapes are smooth-shaded with their sharp edges kept crisp, or
  flat when asked; every other shape, an outline included, is flat.
- **Saying where one shape goes into another is about the shapes.** Whether a
  point is inside a shape does not depend on which way its surfaces face. A
  shape clear of another, or only against it, does not go into it; one that
  does is said to go in as deep whichever of the two is described. It holds
  as well far from the scene's origin.
- **Framing fits the shapes.** A framed object reaches the picture's edges by
  its outline, not its box, centred with as much space on each side, and is
  seen from the side and elevation asked. A turn round adds to the
  direction's own, and the answer says where the camera lands. An
  orthographic camera is sized to it the same way.
- **A profile off the axis turns into a solid ring.** A turned profile of
  three points or more that touches the axis at neither end is closed, its
  last point joined to its first, so a band, a sleeve or a washer is a closed
  shape; it stays an open sheet only when asked, and two points always do.
  A profile with both ends on the axis is closed by the axis, asked to be
  closed or not.
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
- **Lettering bends with a round surface.** Text given the radius of a jar
  or a bottle lies on it along its whole length, its back on the surface,
  and is as long along the surface as it was flat. Text longer than the way
  round is refused, and both the approval and the answer say it is bent.
- **A view from above reads as a plan.** A camera looking straight down,
  framed from the top, raised all the way or placed by hand, has +y up its
  picture and +x to the right. A turn round turns the picture, and the answer
  says which way is up it.
- **The camera says what it cannot see.** A shape in the picture that others
  cover wherever it is in it is said to be hidden behind them, a camera inside
  a closed shape says so, and a part is told with the object it belongs to.
- **A lens shift slides the picture without turning the camera.** The camera
  tool takes one as across and up, in picture widths: what the camera sees
  slides that far, and the camera stays as level as it was. The shift a
  camera has is said in every camera answer and in the scene's description,
  however it was set, and a camera call that names none leaves it. Framing
  centres what it frames under a shift, and what the camera is said to show
  is what it shows.
- **Focus follows its object.** A camera focused on an object keeps focusing
  on its middle when either moves.
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
- **An EEVEE picture is said to be a draft.** The answer to an EEVEE render
  says it is a quick look at layout and framing, and that light, colours and
  the picture to hand over are Cycles's; a Cycles render says nothing of the
  kind. An EEVEE render through a camera with something of the scene straight
  above it, as in a room, is drawn by Cycles at a few samples, so its light
  and colours are the room's, and its answer says so.
- **A plan is one picture that leaves the scene as it was.** A render asked
  for as a plan shows the whole scene from straight above, with +y up the
  picture, lit by a white background alone in the neutral tone, with the
  lights left out. EEVEE draws it, because its light from the background is
  not shaded by walls: a floor shows close to the colour it was given
  however high the walls round it are. Cycles is refused for it, and it is
  not called a draft. The scene's camera, lights, background, tone, exposure,
  picture size and hidden objects are the same after it as before.
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
  object it was cut from. Reading them leaves the scene as it was. It
  also gives the tone and exposure the picture was made with, which decide
  how those colours stand against the ones given.
- **Thick glass has no dark bands.** With something see-through in the scene,
  renders and full previews follow light through enough bounces, and the
  scene keeps its own settings.
- **A white render is exact white around the product.** Everything but the
  product and the shadow it casts on the floor is pure white, as marketplaces
  ask, the product looks as it does on the backdrop, and glass shows white
  through it. Nothing but the picture is written to the workspace. It
  renders with Cycles, and EEVEE is refused.
- **A render says which lettering does not read.** Lettering that shows
  within thirty levels of the colour of what it lies on is named, with what
  it lies on; in a colour that stands apart nothing is said.
- **A render meters its own light.** A matt surface shows at its own colour
  when the light on it, after the exposure, is what a white card would give
  back as white. When surfaces covering a tenth of a Cycles picture are lit
  two and a half times past that, the answer names them, says how many times,
  and gives the exposure that shows them at their colours; set, the next
  picture shows them so and says nothing. Glass, liquids, metals, textured
  and glowing surfaces are not metered, nor is a plan, a picture on white or
  transparent, or EEVEE. Under the studio and the product lighting a subject
  is lit to show near its colour, and nothing is said of it.
- **A script is told what this Blender's numpy lacks.** Blender's own numpy
  can come without its random numbers. The script tool says so where it is
  offered, and a script that asks for them is told so, and that Python's own
  random module is there.
- **A script says what it left in the scene.** After what it printed, its
  answer names each object it added, moved or resized, and removed, as the
  other tools say their own work: the object's size, where its bottom and top
  are, and what it goes into, so a part left floating or sunk shows before a
  picture is made. Of what one object goes into, the deepest three are named
  and the rest counted. Past a dozen, objects are counted by the name they share,
  with how high they reach, and the answer names the tool that says the rest
  of any of them. A script that only looks answers what it printed and no
  more.
- **A failed script is told by its own lines.** The answer gives the error
  and the way to it through the script, each line with its number and as it
  was written, and nothing of Zhiyin's own code or of the folder it is
  installed in.
- **A path a script hands to Blender is the workspace's.** A script runs in
  the workspace, and a path without a drive letter means the workspace to
  Blender as it does to Python's own file functions, wherever in it the
  script chose: where the script assigns the path to an attribute or passes
  it as an argument named `filepath`, `filepath_raw`, `directory` or
  `base_path`, gives it to one of `bpy.data`'s loaders, or to
  `save_render`. A path that names its drive, or starts with Blender's `//`
  for beside the scene file, is left as written. A new scene's own render
  output is beside the scene file.
- **Blender writes only in the workspace and in its own folder.** Windows
  refuses it, and anything it starts, a write anywhere else, whichever way
  the write is asked for (ADR 0028). A path with no drive that reaches
  Blender by a route no reading of the script sees, such as `setattr`, makes
  nothing at the drive's root. Inside the workspace Blender writes anywhere:
  new files, folders that were there before, and files it replaces. It reads
  what the person can read, wherever it is kept.
- **A script refused a write is told where Blender may write.** One refused
  a file outside the workspace is told the file is outside it; one whose
  path Blender itself took to the drive's root is told to begin it at the
  scene's folder.
- **The workspace is opened to Blender before a call reaches it**, once for
  each workspace. A whole drive, or a folder that holds the person's user
  folder, is never opened: a call there is refused before Blender hears of
  it. Where Windows will not open a workspace, the call goes on, and the
  reason is said with any call that then fails.
- **What Blender keeps for itself is in the conversation's folder**: its
  settings, its temporary files and the render kernels its graphics driver
  builds.
- **Wood is a finish.** A material given an amount of wood shows grain in
  the colour it was given, which stays the wood's own: streaks along each
  object's longest side, a few centimetres wide whatever its size, in Cycles
  and in EEVEE. One material serves a top and its legs, each board has its
  own streaks and tone, and a board that is resized keeps its grain along
  its length. The end of a post or a plank shows rings; an end wider than a
  board is sawn, as the top of a cupboard is, shows a panel, with streaks
  along its longer side. Half is a calm grain whose light and dark stay
  within a tenth of the colour; the whole is bolder. A wooden surface is
  described by its colour and its amount of grain, and the light on it is
  metered as on paint. Wood and a picture are not given together.
- **A sheet of glass lets light through.** A flat sheet of glass far thinner
  than it is wide, such as a window pane, casts no shadow and stands out of
  the way of the light that reaches a surface, so a room behind a glazed
  window is lit as through the open hole, with its patch of sun. This is
  settled after every change, whatever made the sheet or changed it; the
  answer names a sheet when it becomes one, and the scene's description says
  which objects cast no shadow. The light that passes is not coloured by the
  glass. Glass that is not a sheet shades what is behind it from direct
  light, as Cycles draws it.
- **A picture can be what glows.** A glowing material with a picture and no
  glow colour of its own glows with the picture, as a screen does; given a
  glow colour, it glows in that colour.
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
- **A preset replaces only what a preset made.** The model's own lights stay
  through a preset, and replacing the lights keeps the backdrop. A light named
  again changes only what is given, and a moved light stays aimed at the point
  it was aimed at. The answer that makes a light says where it was put. A
  preset sets the tone and leaves the exposure, and says the exposure it
  leaves when that is not 0.
- **A picture on a front face reads the right way up.** Seen from the front,
  its top is up.
- **Materials start from Blender's own defaults.** Specular and the coat's
  roughness, left out, are what Blender gives a new material.
- **Renders and exports are produced files**, so they are listed with the
  conversation's work and a render can be shown in the document viewer.
- **No Blender, no tools.** With Blender not installed the connection offers
  nothing, and it offers every tool once Blender is installed.
- **No drawing, no tools.** A Blender that ends while it draws its warm-up
  picture, as one does on a PC without a working graphics driver, means the
  3D tools cannot show or render a scene there. That start fails saying so,
  and for the rest of the app's run no Blender is started: every call to a
  3D tool is refused with the same reason, and a conversation that has not
  listed the tools yet is not offered them, also saying why. A Blender that
  ends before it begins drawing only failed to start, and the tools stay.

## Testing notes

The session's launch is replaceable, so lifecycles, refusals, time limits and
approvals are tested against a stand-in session. The script inside Blender,
the pipes and the previews are tested against a real Blender when
`ZHIYIN_BLENDER` names its executable; without it those tests are skipped and
say so. They need a graphics card, so they do not run in CI, whose machine
has none; they run on a PC that has one.

The compile step is tested for what it asks of Blender's Python. Blender
installed from its real archive, compiled and started once, is tested when
`ZHIYIN_BLENDER_ARCHIVE` names the archive; without it that test is skipped,
except in CI, which keeps the archive for it.

When EEVEE cannot render, previews fall back to Cycles on the processor. No
test covers that path: it needs a PC whose graphics EEVEE cannot use. Nor
does one cover a room's preview or draft on a PC with no graphics card Cycles
can use, which Cycles draws on the processor: the tests run on a PC with one.
That a Blender on a PC without a working graphics driver ends while it draws its
warm-up picture is not tested either; the stand-in session ends there, and
the tests of what follows run on it.

Blender at low integrity is tested with NVIDIA graphics, in a workspace on a
drive that keeps permissions. Other makers' graphics, a drive without
permissions and a network share are not tested.
