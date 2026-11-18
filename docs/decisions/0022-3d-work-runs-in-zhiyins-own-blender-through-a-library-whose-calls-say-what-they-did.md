# 0022. 3D work runs in Zhiyin's own Blender, through a library whose calls say what they did

Status: accepted

## Decision

### Zhiyin's own Blender, one session per conversation

- **Zhiyin runs its own Blender and never the person's.** It installs a
  pinned portable release of Blender when the person agrees, checked against
  the fingerprint Blender publishes (ADR 0027), and runs it headless. Driving
  a Blender window the person has open is not a goal.
- **One session per conversation, reached over pipes only Zhiyin holds.** A
  conversation's Blender starts the first time it is used, in its Job Object
  and its app container (ADR 0005, ADR 0006), and stays open while the
  conversation uses it. Commands and answers travel over two pipes created
  for that launch; the session listens on no port and loads no add-on. The
  session script ships as plain files beside the app's archive and Blender
  runs it where it is installed.
- **Stopping a turn keeps the scene open** with its session, so the next turn
  carries on from it (ADR 0007). A 3D command that was running when the turn
  stopped still ends the session; the scene file and the preview stay.
  Deleting a conversation, and closing Zhiyin, end its session. A
  conversation left alone for fifteen minutes, neither on screen nor running a
  turn, has its session ended, and the next command starts it again.
  Anything that changes the conversation starts the count again.
- **The scene is a file in the workspace.** A session works on one `.blend`
  file the model opens or creates there, and saves it after every change. When
  the file changes on disk, through going back in the conversation or by the
  person's hand, the session reloads it before the next command, so the file
  is always the truth and going back covers it like any other file.
- **A saved scene holds the pictures it uses.** Each save packs every picture
  read from a file that still exists into the `.blend`, and packs it again
  only when the file has changed since. A picture made or changed by a script
  and not saved, one packed by other means, and a missing file are left as
  they are; the material check names the first and the last.
- **A command that does not finish ends the session.** When a command runs
  past its time limit or the turn is stopped, the session is ended and the
  next command starts a new one from the saved file. The model is told the
  change was not made. A command that fails loads the saved file again, so a
  half-made change never reaches it.
- **A PC whose graphics card cannot draw keeps every tool, drawing with
  Cycles.** EEVEE and the solid view draw on the graphics card; on a PC whose
  card cannot draw for Blender, Blender ends the moment it starts one of their
  pictures, with nothing Python could catch. A session draws a warm-up picture
  as it starts, before it opens any scene, so a start that ends there loses
  nothing. After two such starts, before any Blender has drawn in the app's
  run, a Blender started for that alone draws the same picture: when it ends
  too, or cannot draw it, the PC draws on its processor for the rest of the
  run, and the answer is found once for every conversation. Every Blender
  after it, a script's included, draws no warm-up picture and draws with
  Cycles what EEVEE or the solid view would have: the person's view and a
  look's views within their usual drawing times, and a render or a video
  asked of EEVEE as a draft of 16 samples whose answer says Cycles drew it,
  and why. Grease Pencil objects, which only a graphics card draws whatever
  the engine, are left out of those pictures and named. The person and the
  model are told once that this computer draws on the processor and that
  pictures take longer. On a PC that draws, nothing of this runs.

### Typed tools, scripts and the library

- **Typed tools for the common steps, code for the rest.** Adding and editing
  objects, modelling operations such as cutting a hole, materials, the camera,
  lighting, rendering and exporting are tools with schemas, each described in
  a sentence a person can read. Any other Blender Python runs through one
  script tool. Each call declares its effects and is decided by them
  (ADR 0012): a call that changes only the workspace, which Zhiyin backs up,
  runs without asking. Blender describes its commands as it starts, and what
  the installed Blender's API accepts is answered by the running Blender
  itself.
- **A model's script never runs in the conversation's session.** A Blender
  started for that script alone opens the saved scene, runs the script, saves
  the scene and is ended. The session, which never ran the script's code,
  then loads the saved file, checks the change, measures the scene and draws
  the views. A script that changed nothing causes no save or reload. Whatever
  the script replaced or left in Python ends with its Blender.
- **A script in the 3D studio has `zhiyin` beside `bpy`.** It is Zhiyin's
  library: each function acts on the scene, then measures what it did and
  keeps one line of it, such as how many faces a pick took, their area and
  where they lie. Those lines come back in the script's answer, after what the
  script printed and before what it left in the scene, so a script that
  prints nothing still says what its calls did. A script that fails names the
  calls undone with it. Past 60 lines, the latest are listed and the rest
  counted.
- **A call refuses what it cannot do as asked, saying why.** A pick that takes
  nothing is refused with what each of its conditions alone would take and
  where the mesh's elements lie, never answered with an empty selection.
- **Elements are chosen by meaning, not by index.** A pick names which way
  elements face, where they are in the world, which side of a plane, which
  material, grown by rings of neighbours. A pick given a name is kept on the
  mesh, and a later script takes it up by that name. An edit spends the pick
  it used: every function refuses a spent pick, and each edit hands back a
  pick of what it made.
- **Inputs are named as people see them.** A Geometry Nodes modifier's inputs
  are set by the names its group gives them, never by socket identifiers, and
  each value is read back after it is set: Blender takes a value past an
  input's range without a word.
- **Each function is a catalog entry**, `function:3d-rendering/zhiyin.<name>`,
  found by what it does and opened as its call, its arguments, an example and
  what it reports (ADR 0017). The functions scripts reach and those the
  catalog lists are the same set.
- **Sculpting is a set of library functions** that move a mesh's own points
  in Python inside Blender: brushes along strokes (draw, clay, crease, inflate,
  grab, smooth, flatten, pinch), whole-mesh filters, masks as vertex groups, a
  voxel remesh, fine detail through Multires, and symmetrizing. Blender's
  sculpt mode is not used. Each call says the points moved, the most and
  where, the volume change and any new crossing faces. Detail is added where a
  stroke needs it, by splitting the edges under it and those it stretches.
  Fine detail goes on a subdivided copy, put back through Multires reshape
  point for point, and bakes to normal and displacement maps. Symmetry is
  measured and restored point by point, each point paired with its mirror by
  where it stood before sculpting.

### Toolkits for kinds of 3D work

- **Seven kinds of 3D work get a toolkit each**, loaded when the work needs
  it (ADR 0017): scatter (`blender_scatter`), decals (`blender_add_decal`),
  unwrap (`blender_unwrap`), bake (`blender_bake`), measure
  (`blender_measure`), rig (`blender_rig`) and simulate (`blender_simulate`).
- **Each answers as measured.** A scatter says what each rule removed, the
  least gap between footprints and what any copy goes into; an unwrap
  measures stretch, texel density, overlaps and seams on the shape; a bake
  gives each map's value range and the texels its rays missed; a decal says
  where it landed, its stretch, the share off an edge and whether the camera
  could mix it up with the surface.
- **Measuring changes nothing.** It is the one place a model asks how far
  apart two shapes are, surface to surface, instead of working it out from
  boxes.
- **A bake writes only the files its call declares,** one picture per object
  and map, and gives the object a copy of its material drawn from them; its
  own materials stay. An export to `.glb` may bake, for that file only, the
  looks the format cannot hold, packed inside it.
- **A scatter is linked objects or instances,** at most 1,000 objects or
  10,000 instances, and scattering the same items onto the same surface again
  replaces the earlier scatter. A decal is an object of its own with a
  material of its own, a copy of the surface's, held by the object it lies on.
- **Rigging and simulation are one tool each, whose inputs are parts.** A rig
  call makes or fits bones first, then binds meshes and sets reaching chains;
  a simulate call sets up cloth and liquids first, then rigid bodies, then
  bakes, settles or keys, then measures a cloth the bake ran.
- **Ready rigs are Rigify's metarigs, fitted by measuring the body.** A
  metarig is fitted to the mesh by its cross-sections, each joint said with
  what it was fitted to, for the model to confirm by looking; the generated
  rig names its mesh, so a binding in the same or a later call finds it.
- **A binding is pose-tested.** Each joint is turned both ways on a copy at
  rest, and the volume lost near it and new self-crossings are said. A
  reaching chain is checked at every frame for falling short, flipping its
  bend and stretching.
- **Motion is `blender_animate`'s**: bone keys, poses, drivers and aims with
  an up axis, a locked axis, stretch or a curve. Rigging makes the rig,
  animating moves it.
- **Simulations bake in the order one depends on another,** each saying its
  frames, seconds and cache, and nothing is written beside the scene. Point
  caches and simulation zones are kept in the scene file; a liquid the studio
  made is baked into a new folder in the conversation's own home, so a scene
  put back keeps the liquid it was baked with. Dynamic paint, which Blender
  caches only beside the scene, and a liquid the scene caches beside it are
  left for a script.
- **Rigid bodies are weighed by their measured volume** times a density, a
  material from Blender's own table, or a given mass, and refused when they
  start inside one another, which the physics would throw apart.

### Seeing the scene

- **The person watches the scene change.** After every change the session
  renders a quick preview, kept in the app's data folder and never in the
  workspace, and the 3D view beside the conversation shows it. A new preview
  replaces the shown one only once it is complete. The view shows the scene's
  camera, or an overview framing every object that the person can turn by
  dragging; turning it never changes the scene.
- **Final renders and exports are workspace files.** They are written where
  the model asks, and a render opens in the document viewer like any picture.
- **A render is measured on its own light, then composited.** The picture is
  drawn without the compositor, its light metered, its colours read and its
  noise measured, and only then are the scene's compositor steps laid over it
  from that light, which redraws nothing. `blender_render` takes `post`, a
  list of compositor steps (bloom, glow, streaks, lens distortion, sharpen,
  colour balance, painterly and Blender's bundled groups), kept in the scene
  until changed; the camera takes no effects. A glare step with no threshold
  takes one from the light measured: a stop under the brightest half percent,
  never below what shows as white.
- **An 8-bit picture laid on a surface uses channel-packed alpha.** Straight
  alpha darkens a picture's colour where it is partly transparent, in Cycles
  and EEVEE alike, which draws dark fringes round a label or a leaf.
- **An area light has a shape and two sides.** `shape` is square, rectangle,
  disk or ellipse and `size` is `[width, height]`, so a strip light can be
  made; a light's colour can be a temperature in kelvin.

### Drawings of a scene

- **`cad_draw` draws the 3D scene open in the conversation** when it is called
  with `scene: true` instead of a script, and `objects` instead of `parts`.
  The sheet, the views, the dimensions, `expect` and every file written are
  the CAD studio's drafting (ADR 0023): a scene's drawing differs only in
  where its lines come from.
- **Blender finds the lines, with Line Art.** The conversation's own session
  takes the views asked for and, for each, looks through a temporary
  orthographic camera at copies of the objects as they are evaluated, their
  modifiers applied and what they place as instances included, in a scene of
  their own. It gives the edges in sight and, for a straight or an auxiliary
  view, those behind something. For a section it first cuts the copies where
  the plane passes and gives the faces it cut, to be hatched, and their
  outlines as lines in sight: nothing lies nearer the eye than the cut, and
  Line Art can lose part of an edge where the cut faces of two objects meet
  in one plane, as walls at a corner do. Everything it made is removed after,
  and the scene and its file are as they were.
- **The drafting reads those lines as views.** It cuts each stroke at its
  corners, joins lines that lie on one line, turns runs that lie on a circle
  into arcs and circles, and leaves out what is behind where it lies under
  what is seen. Points are the scene's own coordinates in millimetres.
- **The two studios meet through the contract's `SceneLines` port.** The 3D
  studio implements it on a conversation's session, the composition root
  hands it to the CAD studio, and neither imports the other (ADR 0002). The
  lines pass as JSON in the app's data, never in the workspace.
- **The approval names the scene file and the objects drawn,** says Blender
  reads the scene and leaves it as it was, and is bound to that scene: one
  approved for one scene does not draw another opened since.

## Why

3D work is a way to make things a person can use: product pictures, a room
from its floor plan, a part to print. Blender does all of it, runs headless,
and is free software with a published fingerprint for every release, so it
fits the way Zhiyin installs Typst and uv.

A Blender that starts for every call costs about two seconds, and its first
EEVEE picture compiles shaders for about ten more. Held open, the same session
renders a 960×540 preview in a fifth of a second on a recent GPU, which is
what lets the person watch every change rather than wait for a final render.
For the same reason a stop leaves the session open: the scene the agent built
is not what the person stopped, and the next turn needs it. The cost: a
session left open holds its memory until the conversation is left alone long
enough, deleted, or Zhiyin closes.

A PC with no graphics card Blender can draw on, such as a virtual machine
with a basic display adapter, still runs Cycles on its processor, and Cycles
draws everything the tools need, only more slowly; refusing the tools there
would leave that PC without 3D work at all. Blender gives no warning before it
ends, so the only safe way to learn is to let a Blender that holds nothing try.
The session's own warm-up is that Blender on a PC that draws, so finding out
costs such a PC no time; the Blender of its own is started only once two
warm-ups have ended, and tells a PC that cannot draw from a start that failed
for some other reason, as one can on a busy graphics card. Starting that
Blender at every first start would cost every PC a Blender start for what
almost none needs.

The confinement keeps the person's computer from a script; a Blender of the
script's own keeps Zhiyin's checks from it. A script that replaced a function
of Zhiyin's modules, of `bpy` or numpy, or left a handler, in the session
itself, could change what every later measure and view reports.

A script is precise for a model but opaque to a person, and Blender's Python
API changes between releases: 4.0 renamed most inputs of its main material
node, and 4.1 removed auto smooth. Generated code written for an older release
fails, most of all from the inexpensive models Zhiyin is meant to work with. A
typed tool hides those changes and reads as a sentence; the script tool stays
for everything a fixed set of tools cannot cover. A script's author counts
faces by index and never checks what a step took: in one run the first pick
took 80 faces instead of 8 and nothing said so. A library whose every call
measures and reports gives a script the answers a typed tool gives, without a
schema for each step in every request.

Product shots, scenes, game assets, rigs and simulations need steps that go
wrong without showing it: how many rocks went into the ground, whether a
label is stretched, which texels a bake missed, a heel that weighs nothing, a
knee that loses its volume when bent, a cloth that crosses itself, a liquid
that leaks through a wall thinner than a voxel. Each as a typed tool answers
those as measured; each as a toolkit keeps its definition out of requests that
do not need it. One tool per kind keeps the parts that must run together in
one call, in the right order.

Blender's brushes need a 3D view, which the headless session has none of, and
its sculpt filters, masks and symmetrize end the session (probed in Blender
5.2.2). A library on the mesh runs without a window, can measure every stroke,
and works the same on every scene.

A scene copied or sent elsewhere lost every texture it used when the `.blend`
held only paths to files beside it; packing makes the file the scene. Effects
composited inside the render made the metering, the colour readout and the
noise check read the picture after a vignette, grain or grade had changed it:
a dark vignette read as an underexposed scene. Measuring the raw light first
keeps those checks about the scene, and a glare threshold can follow the
picture's real highlights.

A person who built a room or a piece of furniture checks it against their own
measurements, and hands it to a builder, as a dimensioned plan and
elevations. The drafting measures what is drawn rather than writing numbers
given, so the same code gives a scene's drawing the same guarantee. A mesh has
no exact solids for OpenCASCADE's hidden-line removal, and Blender is where
the scene is; Line Art's occlusion levels give the hidden lines a drawing
needs. The drafting needs build123d, ezdxf, Pillow and fontTools, which live in
the CAD environment and not in Blender's Python, so Blender gives lines and the
CAD studio draws them.

## Rejected

- The person's Blender, through Blender Lab's MCP server and add-on: it drives
  a window the person has open, needs their installation and add-on, speaks
  over stdio, which Zhiyin's connections do not, and reaches Blender through a
  TCP socket any local program can connect to.
- A new Blender process for every call: too slow to preview every change, and
  nothing would hold the scene between calls but the file.
- A local socket to the session: any program on the machine could drive it.
- Ending the session on every stop: it throws away the session the next turn
  needs, and makes a stop costly.
- Only a script tool: approvals become code, and API changes break generated
  scripts. Only typed tools: Blender's API is larger than any fixed set.
- A typed tool for every step: definitions in every request, and still no way
  to chain steps in one call. A tool for every rigging and simulation part:
  the parts depend on each other within a call, and a toolkit holds at most
  ten tools.
- Library functions that return values and report nothing: a script that does
  not print them leaves the model as blind as before.
- Indices as the way to choose elements: they change with every edit and say
  nothing about what was chosen.
- Growing the modelling or surfacing tools to hold scatter, decals, unwrap,
  bake and measure: their definitions are near their size budgets, and every
  request would carry them. Those as library functions only: the answers
  depend on measuring the result, which a typed tool does every time and a
  script only when its author remembers.
- A bake that writes wherever Blender's settings say: the call could not
  declare the files it changes.
- Blender's own Calculate Mass: it weighs the convex hull, not the shape.
- Caching simulations beside the scene: a typed change writes only the files
  it declares, and a simulation writes an unknown number of them.
- Blender's Bake to Keyframes for keying the bodies: it says nothing of when
  each came to rest or what it rests on, which the run measures anyway.
- Blender's sculpt operators: they crash or do nothing without a window. A
  typed sculpt tool: a stroke is many small steps a script repeats and varies.
  Sculpting only by geometry nodes: their displacement cannot be stroked along
  a path or masked by hand, and is not the mesh the model edits next.
- Blender's own autopack: it packs fonts and sounds as well, and keeps a
  packed picture as it was when its file changes afterwards.
- Effects kept on the camera, measured after: the checks would describe the
  grade, not the scene, and a model would adjust lights to undo a vignette.
- Drawing the scene in the window from an exported model: it would parse a
  model-made file in the app's own processes, and the preview would differ
  from what Blender renders.
- Online design services: local work was preferred, with nothing sent
  anywhere to make a picture.
- A drafting package both Pythons use: Blender's Python would need ezdxf and
  fontTools, which Zhiyin does not ship for it.
- The scene's lines as a file in the workspace that `cad_draw` reads: a file
  the person did not ask for, which any later call could edit before it is
  read.
- Line Art on the scene itself: it hides lines behind every object of the
  scene it is in, so the objects not drawn, and the objects a section's cut
  copies were made from, would hide the lines asked for.
- A camera exactly along the view's axis: faces along it are edge on, and
  which way Line Art takes them to face is left to rounding, so outlines along
  them, as a hole's sides, come and go. The camera is turned 0.1 milliradian
  off the axis, and the points are still laid flat along the view's own axes.

## Assumptions

- Blender's portable release for Windows runs from any folder without
  installing. Blender 5.2.2 is a 404 MB download and 914 MB unpacked (10
  October 2026).
- Blender's sources are GPL-2.0-or-later (checked on 5.2.2), and Blender asks
  that published scripts using its API be shared under a GPL-compatible
  licence. The session script Zhiyin runs inside Blender is Apache-2.0, which
  is compatible with GPLv3.
- Measured on an RTX 4070 Ti SUPER, 10 October 2026: a headless start in about
  2 s, the first EEVEE picture in about 10 s, then 0.14 to 0.19 s for each
  960×540 preview; Cycles with OptiX at 16 samples in 2.6 s.
- Blender is not marked as able to use long paths, so Windows' long-path
  setting does not help it. Its deepest file is 142 characters below its
  folder; installed where that passes 260 characters, it cannot load its own
  scripts and fonts. Started through a `\\?\` path it loads them, but Cycles
  then cannot find its GPU kernels (5.2.2, 10 October 2026), so Zhiyin starts
  it normally and refuses one installed too deep, saying why. In the default
  data folder that happens only for user folders over 27 characters long.
- On a PC whose only display adapter is a basic one, Blender works without a
  graphics card except where it draws on one. Measured 2026-11-14 on a GitHub
  Windows Server 2025 runner whose only adapter is "Microsoft Hyper-V Video",
  with Blender 5.2.2 `--background --factory-startup`: adding a cube, a bevel,
  evaluating it and saving the file work, and so does a Cycles render on the
  processor (4 samples, 64 px); an EEVEE render ends the process with an
  access violation (exit code -1073741819), raising nothing in Python.
- The solid view (Workbench) draws on the graphics card as EEVEE does, and so
  does Grease Pencil in a Cycles render, which Blender draws with its draw
  manager after the engine (`DRW_render_gpencil`, read in Blender's source on
  2026-11-14). Neither was measured on such a PC; Zhiyin keeps both from the
  graphics card there, as it keeps EEVEE.
- Pictures drawn by Cycles in their place stay within the tools' time limits,
  as the reasons beside those limits say; that is not measured on a slow
  processor.
- Code run inside Blender reaches only what its container is given: its
  installation, the session script, the workspace and its own parts of the
  conversation's folder, and no network (ADR 0006).
- A session that sits idle uses memory and nothing else.
- Models call a library they find in the catalog and are told of in the script
  tool's description, and load a toolkit when the catalog's words for it match
  the work. One line per call is enough to judge a step; a model that needs
  more reads the scene with the reading tools.
- The limits (1,000 objects, 10,000 instances, 30 minutes for a bake) cover
  the scenes people make; past them a scene is split.
- A `.glb` is the format whose pictures travel inside it; other formats refer
  to picture files and are baked with `blender_bake` first.
- Rigify keeps shipping with Blender and generating without a window; its
  drivers are simple expressions, so none needs Python.
- A liquid's cache in the conversation's own home is enough for its renders;
  in another conversation or the person's own Blender it is baked again.
- Joints narrow in a body's sections often enough to fit legs and necks;
  elbows and quadruped knees fall back to the metarig's proportions, as the
  answer says.
- A stroke on a mesh of a few hundred thousand points runs in seconds; the
  remesh refuses sizes past about two million faces. Blender's Multires
  reshape and its Multires bake keep running headless, as probed in 5.2.2.
- Packing every picture costs disk space, not time on later saves: a picture
  is read again only when its file's time or size changes.
- Compositing from an Image node gives the same picture as a composited
  render; measured pixel for pixel in Blender 5.2.2 on 2026-11-07. A video
  renders with the scene's compositor as it stands; its glare threshold is the
  last still's, or Blender's own when none was measured.
- Blender 5.2.2's Line Art modifier runs headless on a Grease Pencil object of
  a scene that is not the active one, its depsgraph evaluated through a
  context override, and gives each stroke's points in world space; with
  `stroke_depth_offset` 0 they lie on the edges found (checked 2026-10-24).
- Turning the camera by 0.1 milliradian moves where a line passes behind
  another by 0.1 mm for every metre between them, which a drawing at 1:10 or
  smaller does not show.
- A room of 304 objects, walls and tables on round legs, gives a plan in
  0.35 s and a plan with two elevations in 2.1 s (checked 2026-10-24).
- Round edges are polygons in a mesh. One modelled with 12 sides or more is
  read as a circle, to within a hundredth of its radius; a coarser one is
  drawn as the lines it is. A mesh knows no round faces, so a scene's views
  have no centre lines along a cylinder seen side on, and do not tell holes
  from pins.
