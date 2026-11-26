# Blender studio

## Purpose

Builds and renders 3D scenes in a Blender that Zhiyin installs and runs
itself, one headless session per conversation (ADR 0022). People see it as
the 3D studio. It is a feature of its own because the session is a
long-lived process with its own state, preview feed and failure modes, unlike
the Python environment or the document compiler, which run a program once per
call.

The idea: a scene is one `.blend` file in the workspace, and the file is the
truth. The model changes it with typed tools a person can read before
approving, or with a Blender Python script, and every answer says, measured
on the shapes, what the call did and what it left wrong, so a mistake shows in
words before a picture is made.

A call is checked against its schema and the workspace and described for
approval, then run by the conversation's Blender, confined in a process
container (ADR 0005) and reached over two pipes created for its launch;
nothing listens on a port. The session saves the file, checks the change and
the scene's spec, answers, and then draws the preview the person watches
beside the conversation.

In brief: a conversation reaches only its own Blender, which changes only the
workspace and the conversation's own folders; Zhiyin moves a file outside the
workspace into place only where the approval names it; what is approved is
what runs; a command that fails loads the saved file again, so a half-made
change never reaches it, and one past its time limit ends the session and
says what it left; what goes into what, and what holds what up, is measured
on surfaces, never boxes.

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
  connection; the core follows a session's state for the 3D view; the CAD
  studio draws the scene through the contract's `SceneLines` (ADR 0022).
  What the CAD studio hands it in files is named in the contract:
  `CAD_PART_EXTRAS`, the marks on a CAD part's mesh in a `.glb`, and
  `CadMotionFile`, a motion file's fields. The session keeps its own copy of
  those names, held to the contract's by the tests.
- **Keeps its checks from a script.** A model's script never runs in the
  conversation's session. A Blender started for that script alone opens the
  saved scene, runs the script, saves the scene and is ended; the session,
  which never ran the script's code, then loads the saved file and says what
  the script left, checks the change, measures the scene against its spec,
  describes it and draws the views a reviewer sees. Whatever the script
  replaced or left in Python, a function of Zhiyin's own modules, of `bpy`,
  `mathutils` or numpy, or a handler, ends with its Blender, as in the CAD
  studio, whose checks run in a second process that holds none of the
  model's code. The confinement keeps the person's computer from the script;
  the separate Blender keeps Zhiyin's checks from it. The typed tools run
  none of the model's code.

## Public interface

- `new ConversationScenes({ blender, directory, launch, script })` holds every
  conversation's scene. `blender` answers where Blender is installed,
  `script` is the session script shipped with the app, and `launch` starts
  Blender; `containedSessionLaunch(containment, { scripts })` is the one the
  app uses. It starts Blender confined (ADR 0006), running a copy of the
  session script it keeps in `scripts`; a file missing from the copy, or not
  the size shipped, is copied again before Blender starts. With
  `withoutGraphicsCard`, which only the `ZHIYIN_TEST_NO_GRAPHICS_CARD` test
  switch sets, every Blender behaves as on a PC whose graphics card cannot
  draw.
  - `scene(conversationId)` returns that conversation's `SceneSession`,
    created on first use and started when a tool first needs it;
    `existing(conversationId)` returns it only if it exists.
  - `onScene(listener)` hears each scene as it comes into being.
  - `knowledge()` is the studio's `KnowledgeSource` for the catalog (ADR
    0017, ADR 0024), of the plugin `3d-rendering`: its toolkits' words, its
    own `doc:3d-rendering/<topic>` pages, the API changes since earlier
    Blenders as `break:blender/5.2/<change>` entries, and Blender's API as
    the installed Blender has it, `doc:blender/<series>/<name>`, one page for
    each type, operator module, and bmesh, mathutils and bpy_extras module
    or class, a module too long for one page split into an index and a page
    for each member. `doc:blender/api` names that reference before it is
    read, and is its index after.
  - `directory(conversationId)` is where that conversation's Blender keeps
    its previews, settings and logs, in the app's data.
  - `close(conversationId)` ends a conversation's Blender, which starts again
    from the scene file on the next command. `putAway(conversationId, keep)`
    does so for going back in the conversation and drops the latest preview,
    which shows what the removed turns did; with `"nothing"` the scene file
    goes from the session too, as a removed turn opened it, and the view has
    nothing to show. `forget(conversationId)` also
    removes its folder and its container; `closeAll()` ends every session.
    A Blender still starting is ended once it has started, before any of
    these returns.
- A `SceneSession` has `state()` and `onState(listener)`, a
  `ScenePanelState`: whether Blender is closed, starting, open or failed, the
  scene file, the view, the latest preview and, on a PC whose graphics card
  cannot draw, a `note` saying so. `look(intent)` applies a
  `SceneIntent` from the person: camera or overview, turning or zooming the
  overview, back to the start, and the size the view is drawn at.
  `sceneIn(workspace)` names the scene file open as that workspace has it,
  or nothing when none is open or it is not in that workspace. `close()`
  ends the session.
- `scenePrograms`, the programs the studio needs installed before it can
  run: Blender.
- `sceneAutomation(session, { workspaceRoot, blender, directory, video?, protect?, held? })`
  returns the tools for the model, a `WritingConnection`: `listTools`,
  `callTool`, `inspect`, `describeResult`, `produced` and `close`.
  `protect` is Zhiyin's own folders, which no tool writes whatever is
  approved. `held` says whether sealed-off programs are held from changing
  a path for the run going on.
  `describeSceneTools(blender)` lists the tools without starting Blender.
- `sceneLines(session, directory, blender)` returns the contract's
  `SceneLines` on a session: `installed()` says whether `blender` finds
  Blender, `open(workspace)` names the scene file open as that workspace
  has it, or nothing when it is not in it, and `lines(request, options)`
  has Blender find, with Line Art, the edges of the views a drawing asks
  for, of the objects named or every shape the scene shows, and gives them
  as JSON. `directory` is the conversation's folder.
- The tools:
  - `blender_open_scene` opens or creates the scene file.
  - `blender_add_objects` adds shapes, text, an outline extruded to a height,
    a profile turned around an axis, a tube along a path, an SVG drawing, a
    picture on a plane, or a model file read with Blender's own importers.
  - `blender_edit_objects` moves, turns (round its origin or a hinge),
    resizes, renames, attaches, hides, duplicates (a step apart, round an
    axis, or sharing one mesh), sets out along a path, sets down on the floor
    or on other objects, or deletes objects.
  - `blender_settle_objects` drops objects onto what they rest on with
    rigid-body physics and keeps where they settled.
  - `blender_shape_objects` cuts, joins or intersects objects (a cutter can
    be described in the call, which is how a hole is made), and rounds edges,
    repeats, mirrors, thickens, smooths or subdivides them.
  - `blender_set_material`, `blender_set_camera` and `blender_set_lighting`
    set how the scene looks.
  - `blender_render` and `blender_export` write a picture or a model file.
    A picture is taken through the scene's camera or one named for it
    alone, or is the plan of the whole scene from above, and of an animation
    at a moment.
  - `blender_animate` keys where objects are, how they turn and size, whether
    they show, a camera's lens, a light's power and colour, a material's
    colour and glow, and any value Blender can animate, at times in seconds
    and eased as asked; sends an object along a path through points; keeps
    one aimed at another; makes one of an object's values follow another's,
    at a ratio or by a formula; keys an armature's bones and named poses;
    drives any value from others; clears an object's motion; and sets the
    frame rate and length.
  - `blender_scatter` scatters copies over a surface by rules;
    `blender_add_decal` lays a picture, a mesh or a strip on a surface;
    `blender_unwrap` lays out a mesh's UVs; `blender_bake` bakes maps to
    pictures; `blender_measure` measures between objects, along an axis, a
    clearance or how far one shape strays from another.
  - `blender_rig` makes and edits bones, fits a Rigify ready rig to a body
    mesh, binds meshes to an armature and makes chains reach for targets or
    lie along curves.
  - `blender_simulate` sets up rigid bodies, cloth and liquids, bakes every
    simulation in the scene, and keeps rigid bodies where they rest or keys
    their motion.
  - `blender_frame_sheet` shows the model frames of the animation side by
    side, each labelled with its time, and says where each moving object is
    at each.
  - `blender_close_ups` shows objects up close from two sides, each with
    what describing it says.
  - `blender_render_video` writes the animation as a video for the person.
  - `blender_look` shows the model the scene, or objects, from the front,
    the right, the top and three-quarter on one sheet, shaded, as wires, by
    the way each face points or by its reflections of a banded light, with
    each mesh's faults counted.
  - `blender_describe_scene` reports the objects with their sizes, positions,
    materials and modifiers, whether each mesh is closed and its volume, how
    many of its edges are creased, bevel-weighted, sharp or seams, the
    camera, the lights and the render settings with the tone and exposure.
  - `blender_api` answers what the installed Blender's API accepts, read from
    the running Blender.
  - `blender_run_script` runs any Blender Python in the session, with
    `zhiyin`, the studio's library, beside `bpy`.
- `studioTools`, the 3D studio's tools as the model is offered them, each
  with the `toolkit` it loads with: `modelling` (adding, editing, shaping
  and settling objects), `surfacing` (materials), `light-and-camera`,
  `motion` (animating, the frame sheet, close-ups and the video),
  `scatter`, `decals`, `unwrap`, `bake`, `measure`, `rig`, `simulate` and
  `output` (export). Opening, describing and looking at a scene, a script, a render
  and looking up the API are core tools, with no toolkit.
- `sceneReviews({ directory, tools, open })` is the 3D studio's
  `StudioReviews` (ADR 0024): what it hands `3d-rendering/scene-reviewer`
  for each scene a conversation changed with a spec. `tools` is the
  conversation's studio tools, which draw the reviewer's views, and `open`
  answers which scene is open.
- The types these take and return: `ConversationScenesOptions`, `SceneCommand`,
  `SceneOutcome`, `SceneSessionOptions`, `SceneAutomationOptions`, `LaunchSession`,
  `SessionLaunchOptions`, `SessionProcess`, `StudioTool`.

## Invariants

These hold for every call. What each family of the 3D studio's tools does and
says is on a page of its own, whose invariants are held to tests in the same
way:

- [Modelling](modelling.md): adding, placing, sizing and shaping objects,
  scattering copies and measuring.
- [What a call says about the scene](scene-reports.md): the checks after a
  change, describing the scene, and looks and close-ups.
- [The spec](spec.md): how a scene is measured against its requirements, and
  what the answer and the person's card say.
- [Surfaces](surfaces.md): materials, unwrapping, baking and decals.
- [Light and camera](light-and-camera.md): the camera, the lights, the world
  and the look of a render.
- [Motion](motion.md): keys, paths, drivers and the timeline, and videos.
- [Rigs and simulation](rigs-and-simulation.md): bones, rigs and binding, and
  rigid bodies, cloth and liquids.
- [Renders, exports and drawing lines](output.md): pictures, model files and
  the lines a CAD drawing is made from.
- [Scripts](scripts.md): what a script is given in `zhiyin`, sculpting
  included.

### The session and its Blender

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
  startup file, preferences and add-ons. Of Zhiyin's own environment it is
  given only the variables every confined program is, so none of Blender's,
  USD's or MaterialX's can name the plugins it loads or the folders it reads
  models and materials from, and no key kept in a variable reaches a script.
  Its settings, scripts and add-ons are in Zhiyin's data, in a folder new
  for each start and only read by Blender, so nothing a script leaves runs at
  a later start; nor does a script saved in a scene file. Besides the workspace, it
  may change only folders of the conversation's own: its home and caches,
  and those it writes previews, pictures, the spec's verdicts, a drawing's
  lines and the files bound outside the workspace in.
- **A script runs in a Blender of its own.** The session first makes sure a
  scene is open, as its file now is, and refuses the script before any
  Blender starts for it when none is. The script's Blender is started sealed:
  it answers that one script and nothing else, draws no warm-up picture, and
  the session's own Blender refuses a script. It opens the scene file, runs
  the script and saves; the session, still holding the scene as it was
  before, then loads what was saved and answers for it as for a change. A
  script that changed nothing a save writes, as one that only reads and
  prints, saves nothing, and the session keeps the scene it holds. The
  script may run for the call's time less a fifth of it, at most a minute,
  which is kept for the session's part. What a script left only in Blender's
  memory goes with its Blender: Python state, handlers, functions of its own
  a driver calls and properties it registered. Pixels it set in a picture
  neither packed nor saved are gone too, and its answer, and the checks of
  each material that shows the picture, name each such picture. Data with no
  user is kept as one Blender would hold it, though Blender writes only data
  that has one: data a script made that nothing uses yet, such as a material
  made for the next script to assign, stays until something uses it or
  blender_open_scene opens the scene again, which then saves it without
  that data; and
  data something saved refers to without counting as its user, such as an
  object only a boolean cuts with or the collection a soft body collides
  with, stays while it is referred to. Each loads with no user, as it was,
  and every save keeps it, the session's own included. Any other data
  nothing uses, such as a material whose last object was removed, goes at
  the next save. A picture whose file changed is packed again by the
  script's save, so the next call reads it as its file now holds it. A
  script that fails, is
  stopped or runs past its time ends only its own Blender; the session
  carries on with the scene as saved. One that ran, after which the
  session's part fails, is answered as failed, saying the scene file keeps
  what the script did.

### The scene file and the workspace

- **Nothing changes before a scene is open.** The scene file is a
  workspace-relative `.blend` that stays inside the workspace, and creating
  one never replaces an existing file. A scene opened in a folder the
  conversation has since left is not open in the new one: nothing there
  changes or draws it, and a scene the new folder contains is named as that
  folder has it, by the 3D tools and a drawing alike. Blender started in a
  folder without the scene leaves it unopened and remembered, so what needs
  no scene still answers there, and back in its folder the scene is open
  again. A description asked for with no scene open is answered, not
  refused: none is open, and how to open one, without Blender being asked;
  every other tool on the scene is refused with how to open one.
- **Every file a tool names stays in the workspace, unless the person
  approves a place outside it.** Pictures, fonts, drawings and models it
  reads are workspace-relative paths with an expected kind of file, and so
  are the renders, videos and exports it writes, or whole paths outside the
  workspace (ADR 0012). Anything else is refused before Blender is reached. A
  file it writes is named as the workspace has it, however the path was
  written, so the approval and the conversation's files agree.
- **A file written outside the workspace is approved by its real place.** Its
  approval names the whole real path, links resolved, says it is outside the
  folder the person selected, and the person can allow that file or its
  folder. A render also declares the scene, which keeps its settings, so the
  scene is backed up as for a render inside the workspace. A place in Zhiyin's own folders, or one
  reached through a link whose target is missing, is refused before Blender
  is reached: the first to the model, which can choose another place, naming
  the output; the second to the person. Blender, confined to the workspace as it started, writes the
  file in a folder of the conversation's own, and Zhiyin moves it into place:
  a place new at approval is only created, never written over a file that
  appeared since, and a file there is replaced only while it is as approved.
  A move that fails says why, and nothing staged is kept. What the call
  wrote is named by its whole real path.
- **A script writes a folder outside the workspace only through Zhiyin.** A
  script may name folders outside the workspace, each by a whole path that is
  there and reached through no link; one inside the workspace is the
  workspace's. Zhiyin's own folders, a folder holding one, a drive, the
  person's user folder and a folder holding it are refused before Blender is
  reached, and the folders are checked again when it runs. Its approval names
  each folder as outside the folder the person selected, and the script
  declares each for Zhiyin to copy before it runs, so it is allowed by those
  folders. The script writes each folder's files into the folder of its
  own it is given, and when it ends Zhiyin moves them into the approved
  folder, keeping the folders it made, replacing a file there as a write
  would; a file whose place leads out of the folder is not moved, nor is one
  whose place is held from sealed-off programs for the run, as Git's folder,
  a Startup folder and what could not be copied are, which the answer says
  may only be read. A script that fails has nothing moved. A direct write to such a folder is refused,
  and the refusal names the folder to write into instead.
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

### Saving, failures and time

- **A change is saved, answered, then previewed.** After every command that
  changes the scene, the session saves the file and answers; the preview
  follows, so stopping a preview never takes back a saved change. A command
  that fails, a render included, reloads the saved file, so a half-made change
  reaches neither the file nor the preview; so does a picture, video, drawing
  or measure that fails part way, which may have moved the scene's time or
  settings. Each answer says which of these the command is, a change, one of
  those that show the scene, or a read, and that alone decides what is said
  of putting the scene back. Its answer keeps what the session
  said besides the error, such as the scene file loaded again from disk, and
  says when the saved file could not be loaded again, so the scene still holds
  the half-made change, or may still hold the moved time or settings. A failed
  command after which the file was loaded again from disk gets a new preview.
- **An error the session carries on past is kept.** Where the session goes on
  past an error, such as a saved file that cannot be loaded again after a
  failed change, it writes the reason and its trace to the session's log in
  the conversation's 3D folder.
- **The file is the truth.** When the scene file changed on disk since the
  session saved or loaded it, the session loads it before the next command. A
  file that changed into one Blender cannot load is answered: the answer names
  it and the reason, Blender carries on, and no scene is open.
- **A scene file holds its pictures.** As the session saves, each picture read
  from a file is packed into the scene file, keeping its path, so the scene
  opens whole when the file is gone; a picture whose file changed is packed
  again as the file now holds it. Pixels a script set and kept nowhere are
  not packed, and the script's answer names the picture. A picture a material or a decal lays is read with its
  colour and alpha apart, so a partly transparent 8-bit picture keeps its
  colour where straight alpha would darken it; a float picture is read as it
  is.
- **A command that does not finish ends the session.** Each tool's
  description states how long one call may run. Past that limit, or stopped
  with the turn, the session is ended and the answer says what was left: no
  change, a change already saved to the scene file, or a file that was being
  written and may be incomplete. Past its limit, the answer also names the
  limit and says to do less in one call or split the work over several. The
  next command starts a new session from the file. A script that does not
  finish ends only the Blender running it, and its answer says whether the
  scene file changed, and that the files it wrote in the workspace before it
  stopped stay as they are. A session that exits on its own is reported as failed, with what it
  printed. Stopped while Blender is still starting, a command answers at once
  that nothing changed, and Blender goes on starting for the next one.
- **A command's checks share its time.** Each command reaches Blender with
  the seconds it may run. A tenth is kept back for saving and the answer,
  and every check that runs within a time (describing's pieces nothing
  holds, holes and what goes into what, a change's checks, the spec, the
  form lines, light, scatter, the pose test, symmetry and measuring) takes
  at most its own seconds and half of what is left of the rest when it
  starts, so checks one after another never take the whole, and work after
  them still has time. What a check leaves is said unchecked for want of
  time.
- **A new session opens the scene file before anything else.** Whatever it is
  asked first, a command or a preview of the person's view, it opens the file
  first, so it never shows Blender's own startup scene. When the file cannot
  be opened, no scene is open, the view shows an empty scene, and a command
  that needs a scene is answered with why until one is opened.

### The person's view

- **Previews stay out of the workspace and never flash.** A preview is
  written in the app's data, and the view replaces the shown preview only with
  a complete one.
- **A preview never evaluates a shape again.** A preview takes each shape
  with its steps as the session already evaluated it, as its steps show it
  while modelling, so a shape whose steps are slow to evaluate is evaluated
  once, when it changes, not at every preview after a call that left it
  alone. A script that changed the scene is the exception: the session loads
  the scene again from the file the script's Blender saved, which holds no
  evaluated shapes, so the first preview after it evaluates every shape once
  more. After any call, the checks measure symmetry again only on the shapes
  it changed.
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
- **Only the preview Zhiyin asked for is read.** A preview file Blender names
  is read and removed only when it is the one the session chose.

### Approvals and what a call declares

- **Calls read as words.** Each call is shown, for approval and in its details,
  as a few named rows in plain words with sizes in metres or millimetres, and
  the files it changes are named alongside; the script tool shows the whole
  script as code.
- **What is approved is what runs.** A call is described the same way each
  time it is looked at, so one approved after a wait still runs. The approval
  holds the scene it works on and whether each file it writes is new, its
  own or another, so a different scene, a file that appeared meanwhile, or
  one of its own that changed meanwhile refuses the call, and it asks again.
- **One allowance names work on the open scene.** Every call on the open
  scene that writes only new files, or files this conversation's calls wrote
  and nobody changed since, names the same allowance for the conversation,
  after the scene (ADR 0012); creating another scene, a script, and
  replacing any other existing file name none. The allowance matters only
  for a call that asks: one that changes only the workspace is decided by
  what it declares and runs without asking (ADR 0012).
- **Each call declares what it does** (ADR 0012), **and reads run without
  asking** (ADR 0012). Opening an existing scene, which runs none of its
  scripts, describing it, measuring in it and looking at it, its frames or
  close-ups only read the workspace; a look-up of Blender's API reads only
  the Blender Zhiyin installed. A
  typed change runs Blender confined and changes the workspace by the files
  it declares, kept to put back, or elsewhere when one is outside the
  workspace. A script runs confined and may change any file in the
  workspace, which Zhiyin copies before it runs and can put back; given
  folders outside it, it reads and changes elsewhere, those folders copied
  the same way. One that names files in `change_locked`, which Zhiyin could
  not copy and held read-only for an earlier run, in the workspace by their
  path there or in a folder it is given by their whole path, changes them
  for good. Every script saves the open scene, so a script names the scene
  as a file it always changes: one too large to copy is left writable and
  changed for good, asked about before the script runs (ADR 0013).
- **A script says what it can reach.** It is asked about when it changes a
  file for good, which its approval names, and the person can allow changes
  to that one file without a backup for the conversation; otherwise what it
  does decides, so one that changes only the workspace runs without asking.
  Its approval says once,
  in rows beside the code, that it can read and change any file in the
  workspace, which Zhiyin copies first to put back, and in each folder
  outside it the script names, and nothing else of the person's, and that it
  cannot use the internet. The
  longest script, 100,000 characters, is stated in its schema; a longer one
  is refused with that limit and how to split the work over several calls. It runs
  in the workspace folder, so a workspace path opens as it is.

### Handing a scene to its reviewer

- **A changed scene is handed to its reviewer.** Each scene a change was
  measured on against its spec is handed over with the spec as first written
  in the conversation, those of its requirements removed or changed since,
  each one's latest measure, the scene as described now and each object's
  mesh counts. The open scene comes with views from four sides in each of the
  three shadings, for a reviewer that can see them; a scene no longer open is
  handed over from its measures alone, and says so. The spec and the scene
  are named by their paths from the workspace's top, as reading a file takes
  them, with whether the spec lies beside the scene or at the top, and the
  scene is said to be a Blender file only the 3D tools look into. Opening or
  describing a scene changes nothing a reviewer is handed.

### Tools, inputs and the API reference

- **A tool's definition says what it does, its inputs and its limits.**
  Every input has a clause of its own, and every number says its unit, or that it is a count, a share, a
  multiple or a direction. The description and the descriptions in its
  schema stay within 4,000 characters, or, for a tool with many inputs,
  within what those clauses need, the shaping tool's 9,250 at most; detail,
  as each finish, each lighting preset or how a plan is cut, is on the
  studio's own pages, which the definition names. Every page it names is
  one the studio has.
- **Blender owns what a command takes, and says so as it starts.** Its first
  answer describes every command it runs: what the command does to the
  scene, and, for the inputs a tool's schema states, the choices, the
  options an object takes, the defaults and the limits, each the value the
  command checks with; the numbers and defaults a tool's description, a
  studio page or an approval states in words, such as a render's samples by
  default, a threshold a check measures with, or a settle's shape; and each
  function of the script's library with its arguments and defaults as
  Python declares them. A default that is Blender's own, such as a scene's
  frame rate, is read from the Blender running. Every choice, option,
  default and limit a schema states, every such number and word, and every
  call the catalog lists for the library, is Blender's own. A limit or default a schema
  states that Blender does not describe is a difference too, except the
  longest script, which Zhiyin holds before Blender sees the call.
- **The toolkits are the studio's kinds of work.** Each tool other than the
  core ones names one toolkit, each toolkit is declared once with its own
  words, and none holds more than ten tools.
- **Opening a scene names how 3D work goes.** Its answer names the skill
  that stages the work and the toolkits each stage's tools load with.
- **Blender's API is read from the installed Blender, once.** The first time
  a page of it is opened, a Blender started for that alone reads it by
  introspection and is ended; what it read is kept in the studio's folder
  by Blender's version, and opened again without starting Blender, in this
  run of the app or a later one. Listing the studio's entries never starts
  Blender: before there is a reference for the installed Blender, the list
  holds the studio's own pages, its API changes and the one entry that
  reads the reference. A Blender updated since is read again. Pages opened
  together are read once. A reference that cannot be read opens as a page
  saying why, and is read again the next time. Each page names the version
  it was read from; nothing of Blender's own text ships with Zhiyin.
- **A list of names takes patterns, and says what they named.** Wherever a tool
  takes several objects by name, a name written between slashes stands for
  every object whose whole name it matches, each once. The answer begins with
  each pattern and the objects it named, and those it matched that the tool
  cannot take, such as a group's empty given a material; a pattern that
  matches nothing, or is not one, is refused with why.
- **Every input has one type.** No tool input may be either of two kinds of
  value, so a provider that reads a written-out call back by declared type
  receives every value whole.
- **A change missing what it needs is refused before anyone is asked.** A
  call is checked against its tool's schema first, as every connection's
  calls are, so an object without a name or kind, a key without its object or
  moment, a CAD motion without its end or a path without its points never
  reaches the studio. The studio then refuses what the schema cannot say: a
  shaping step without the size or count its kind needs, a cut with neither
  an object nor a cutter, blur without exactly one thing to focus on, a belt
  without exactly one of a speed and a pulley to follow. Each is refused with
  the inputs it lacks, as a mistake the model can correct, so an approval
  never shows a change with a part left blank. Ranges, and whether a named
  object exists, stay Blender's to judge.
- **An input a shape does not take is refused,** and the refusal says what it
  takes, so nothing given is dropped without a word. A cutter always has a
  size, and the answer says it.

### Where Blender may reach

- **A path a script hands to Blender is the workspace's.** A script runs in
  the workspace, and a path without a drive letter means the workspace to
  Blender as it does to Python's own file functions, wherever in it the
  script chose: where the script assigns the path to an attribute or passes
  it as an argument named `filepath`, `filepath_raw`, `directory` or
  `base_path`, gives it to one of `bpy.data`'s loaders, or to
  `save_render`. A path that names its drive, or starts with Blender's `//`
  for beside the scene file, is left as written. A new scene's own render
  output is beside the scene file.
- **Blender reaches only the workspace and its own folder.** Windows refuses
  it, and anything it starts, every other file the person keeps, for reading
  as for writing, whichever way the file is asked for, and the network
  (ADR 0006). Besides these it reads its own installation and the session
  script. A path with no drive that reaches Blender by a route no reading of
  the script sees, such as `setattr`, makes nothing at the drive's root.
  Inside the workspace Blender writes anywhere: new files, folders that were
  there before, and files it replaces. The workspace's integrity label stays
  as it was.
- **A script refused a file is told where Blender may reach.** One refused a
  file outside the workspace, to read or to write, is told the file is
  outside it; one whose path Blender itself took to the drive's root is told
  to begin it at the scene's folder.
- **Blender works in the conversation's workspace.** It is started with that
  workspace, and a call made after the conversation moved to another starts
  it again with the new one. A workspace that cannot be given to Blender,
  such as a whole drive or a folder that holds the person's user folder,
  starts nothing, and the call says why.
- **What Blender keeps for itself is in the conversation's folder**: its
  home with its temporary files, its previews and pictures, the lines of
  drawings while they are read, and the render
  kernels its graphics driver builds, kept between pictures. These and the
  workspace are all it may change. The container it runs in is the
  conversation's own, removed when the conversation is. A script can use the
  temporary folders Python makes, though Python makes them private.

### Produced files, and when the tools are offered

- **Renders and exports are produced files**, so they are listed with the
  conversation's work and a render can be shown in the document viewer.
- **No Blender, no tools.** With Blender not installed the connection offers
  nothing, and it offers every tool once Blender is installed.
- **No graphics card, still every tool.** A Blender that ends while it draws
  its warm-up picture, before any scene is open, is started once more. When
  that one ends there too, before any Blender has drawn in the app's run, a
  Blender started for that alone draws the same picture and ends. If it ends
  while drawing, as Blender does on a PC whose graphics card cannot draw, or
  says it could not draw, the PC draws on its processor for the rest of the
  app's run: the session starts again at once, drawing with Cycles, and every
  Blender after it in every conversation does the same without finding out
  again, a script's included. Several conversations starting together find
  out once. If that Blender draws, the PC draws: the start only failed,
  saying so, and the next one draws on the graphics card. Once a Blender has
  drawn, one that ends there twice later, as one can on a busy graphics card,
  only failed to start, saying so. A Blender that ends before it begins
  drawing only failed to start. On every PC the tools stay offered.
- **On the processor, Cycles draws in EEVEE's place, and says so once.**
  There no Blender draws a warm-up picture or uses EEVEE or the solid view.
  The view's quick pictures are drawn by Cycles at half size, within a
  quarter of a second of drawing, and its full ones as on a PC whose EEVEE
  fails; a look's shaded and wire views are drawn by Cycles lit evenly from
  all round, and what a render shows is read from flat drawings Cycles makes.
  A render or a video asked of EEVEE, a plan included, is drawn by Cycles as
  a draft of 16 samples, and its answer says so and why; eevee settings given
  are kept in the scene, and no light probes are baked. A script's render
  with EEVEE or the solid view, its OpenGL render and its light-probe bake are
  refused before they run, saying what to do instead. Grease Pencil objects,
  which only a graphics card draws whatever the engine, are left out of every
  picture, and the call's answer names them. The view says once, in one
  sentence, that this computer draws on the processor and that pictures take
  longer, and the first answer of each conversation's scene after that tells
  the model the same.

## Testing notes

The session's launch is replaceable, so lifecycles, refusals, time limits and
approvals are tested against a stand-in session. The script inside Blender,
the pipes and the previews are tested against a real Blender when
`ZHIYIN_BLENDER` names its executable; without it those tests are skipped and
say so. Most need a graphics card, so they do not run in CI, whose machine
has none; they run on a PC that has one. Each run is recorded with its
commit and Blender's version, and a release needs them all run and passing
on its commit. The session code that needs no Blender, such as the readers
of binary USD and USD packages, the geometry the measures share on plain
arrays, the formulas a part follows another by and the words answers give
sizes in, is tested in plain Python, with the NumPy Blender bundles, in every
gate.

Each real-Blender test file makes conversation folders of its own, and a
Blender's first start in a new folder compiles the shaders its warm-up picture
draws with into the graphics driver's cache in its container's folder. Those
tests start on a copy of a cache kept for them beside their temporary
folders, one per Blender executable, and keep the cache a session leaves when
it differs; without one, or when the copy fails, a start compiles them as a
new conversation's does. The test of the commands Blender describes as its
session starts always starts on none, so that path stays tested too.

Reading Blender's API, and each API change both ways, are tested against
Blender 5.2 when `ZHIYIN_BLENDER` names it; without it, keeping, listing
and reading again are tested against the stand-in session, which gives a
reference of two pages.

The CAD parts and motion files those tests bring in are written in the
contract's names and fields. Without a Blender, the code that reads each file
is read for those names, which catches a rename on this side.

The compile step is tested for what it asks of Blender's Python. Blender
installed from its real archive, compiled and started once, is tested when
`ZHIYIN_BLENDER_ARCHIVE` names the archive; without it that test is skipped,
except in CI, which keeps the archive for it.

A PC whose graphics card cannot draw is tested on one that can: with the
test switch, every Blender ends the moment it draws on the graphics card, as
one does there, and Cycles finds no card. On a real Blender so started, the
session finds out with a Blender of its own that ends, starts on the
processor, adds and measures a shape, draws the view quick and full as real
pictures, renders what was asked of EEVEE with Cycles, refuses a script's
EEVEE render, leaves a Grease Pencil object out of a render and looks at the
scene in three shadings. Those tests need no graphics card. The order of
starts, the answer found once for every conversation and the sentence said
once are tested against the stand-in session. A real PC without a graphics
card is not tested, so the switch stands for it: that the solid view and
Grease Pencil end Blender there as EEVEE does is read from Blender's source,
not measured; a room's preview or draft on such a PC, and the time Cycles
takes there, are not measured either. A Blender whose EEVEE raises an error
instead of ending, which then draws its previews with Cycles, is not tested.

Blender confined is tested with NVIDIA graphics, in a workspace on a drive
that keeps permissions. Other makers' graphics, a drive without
permissions and a network share are not tested.

A render or a video refused because it would run past its time limit is not
tested: a scene that slow would hold a test for many minutes. The estimate
is tested on a large picture that finishes, and the refusal follows from it
by the same comparison. Measured on an RTX 4070 Ti SUPER, over a table and
chairs, glass, a room with furniture, a textured crate and a mug, the
estimate of a picture of 20 to 80 seconds came within 7% under to 9% over
the time it took, and of a picture of 7 to 15 seconds within 19% under to
14% over; a picture is refused past 85% of the call's time, which leaves
twice the shortfall measured on the longer ones. Pictures of many minutes,
other graphics cards and a card shared with other work are not measured.
