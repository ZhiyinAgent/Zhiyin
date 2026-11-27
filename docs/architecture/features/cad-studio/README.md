# CAD studio

## Purpose

Builds exact parts for the model: a Python script written with build123d
makes solids, and the studio checks and measures them, draws them, writes them
to the workspace as STEP, STL, 3MF or glTF files (ADR 0023), and makes
engineering drawings of them, dimensioned from their geometry (ADR 0023), or
of the 3D scene a conversation built, from the lines Blender finds of it (ADR
0022). People see it as the CAD studio. It is a feature of its own because
exact solids are not scenes: the 3D studio arranges meshes for pictures, while
a part to print or machine needs its faces, holes and sizes to be what they
were meant to be, and to say so.

The idea: the script builds and the studio speaks. A build is two confined,
offline runs. The first runs the script and writes only the shapes it showed,
as data. The second, started beside it and given those shapes once it has
ended, is the studio's harness alone, holding none of the
model's code: it measures the shapes, checks them against how they are made
and the design's requirements, draws them, writes the exports and writes the
one answer Zhiyin reads. Zhiyin then copies the files the approval named into
place. A drawing runs the same way; a drawing of the 3D scene runs only the
second, on the lines Blender gives.

In brief: the approval shows the script whole and names every file written;
what runs is what was approved, and a file changed since does not run; a
part's sizes, overlaps and verdicts are the studio's measures, whatever the
script does; a script that fails writes nothing; no call makes the CAD
environment, which the person sets up on the Plugins page.

## Boundaries

- **Owns:** what a build is approved as, the folder each build runs in, the
  harness that runs the script and measures, draws and exports what it shows,
  copying the exports into the workspace, the answer's words, and the mesh of
  the parts each conversation built last, kept for the person's view of them
  (ADR 0021), the list of the system's fonts kept for the builds' runs,
  what the CAD environment holds: its lock, and the words
  that refuse a package asked for in it, and what the studio knows beyond
  its tools for the catalog: its own pages, the library's reference read
  from the CAD environment, and the known changes in build123d (ADR 0024).
- **Does not own:** making the CAD environment or confining its Python (the
  Python environment, which keeps it), installing uv (toolchains), permission
  decisions, or the connection's lifecycle (MCP). Rendering a part in a scene
  is the 3D studio's, from the `.glb` the studio writes.
- **Talks to other features only through:** the contract's
  `WritingConnection`, which `cadConnection()` in the capabilities group
  adapts into a built-in connection, and `CadPython`, which the composition
  root implements with the Python environment's kept `cad` environment,
  which it has the Python environment keep from `cadEnvironment`,
  and the contract's `SceneLines`, which the 3D studio implements on a
  conversation's Blender session and the composition root hands in. What it
  hands the catalog is the contract's `KnowledgeSource`, which the
  composition root hands the capabilities group. What it
  hands the 3D studio in files is named in the contract: `CAD_PART_EXTRAS`,
  the marks on each part's mesh in a `.glb`, and `CadMotionFile`, a motion
  file's fields and its format, `CAD_MOTION_FORMAT`. The harness keeps its
  own copy of those names, held to the contract's by the tests.

## Public interface

- `cadAutomation(python, { workspaceRoot, harness, directory, preview?, sceneLines?, fonts? })`
  returns a `WritingConnection` for one conversation's folder. `harness` is
  the shipped `run.py`; `directory` is where each run keeps its files while
  it runs. `preview(model, parts, script?)`, when given, is handed the mesh
  each successful build wrote, the parts shown and the script's workspace
  path, and must read the mesh before it returns. `sceneLines`, when given,
  is the conversation's scene, which a drawing can be of. `fonts`, when
  given, is the font list kept for every conversation's builds.
- `KeptFontLists({ directory, python, harness })` keeps the list of the
  system's fonts a build's runs read, in a folder of the app's data of its
  own. `folder()` is the folder of the list for the fonts as they are now,
  or nothing, and then one is made in the background; `settled()` settles
  once the making asked for has ended.
- `PartPreviews(directory)` keeps, for each conversation, the parts it built
  last and their mesh, in a folder of the app's data of its own. `shown(taskId, model,
  parts, script?)` keeps a new build, `state(taskId)` says what the view
  shows, `model(taskId, sequence)` reads a build's mesh, `onChange` tells a
  listener of each change, `putAway(taskId)` and `forget(taskId)` let a
  conversation's parts go.
- `CadConversations(directory)` hands each conversation its folder of the
  studio's records, `folder(conversationId)`, which the composition root
  gives the automation; `forget(conversationId)` removes it when the
  conversation is deleted. The files its builds wrote are in the workspace
  and stay.
- `describeCadTools(python)` lists the tools for a connection not open yet.
- `cadKnowledge(python, { harness, directory })` is the studio's
  `KnowledgeSource` for the catalog, of the 3D & Rendering plugin, with no
  toolkits: its tools are all core. `directory` is the studio's folder in
  the app's data, where the reference is kept. Its entries are the written
  pages `doc:3d-rendering/cad-<topic>` (scripts, build123d, build-answer,
  requirements, assemblies, exports, drawings, dimensions, engineering), the
  versions of build123d and bd_warehouse said on the build123d page; one page per
  build123d class and function, `doc:build123d/0.13/<name>`, and per
  bd_warehouse module and part, `doc:bd_warehouse/0.4/<module>[.<name>]`,
  with each library's index at `doc:build123d/0.13` and
  `doc:bd_warehouse/0.4`, the versions being those the CAD environment's
  lock pins; and the known changes, `break:build123d/0.13/<id>`, whose
  table is also its `breaks`.
- `cadTools`: three tools. `cad_build` takes `code` or a workspace `.py`
  `file`, `arguments` for the script, and up to eight `exports`, each a
  workspace path, or a whole path outside the workspace, ending in `.step`,
  `.stp`, `.stl`, `.3mf`, `.glb` or `.png`, in `.csv` for a parts list with
  each part's `materials`, or in `.json` with positions or explode, or
  named `zhiyin_cad_helpers.py`, the helpers module, holding no part, and,
  optionally, the names of the shown parts it holds and, for a `.glb`,
  `detail: "close-up"`. `cad_draw` takes the
  same script, the `parts` to draw, the `sheet`, `orientation`,
  `projection` and `scale`, up to twelve `views`, up to eighty
  `dimensions` (lengths, overall sizes, diameters, radii, angles, chamfers,
  hole callouts and ordinates), a `parts_list` with its `balloons` view and
  `materials`, the `title` block's fields, and up to six `outputs`, each a
  workspace path, or a whole path outside the workspace, ending in `.pdf`,
  `.svg`, `.png` or `.dxf`, a `.dxf`
  optionally of one `view` alone. With `scene: true` it takes no script and
  draws the open scene, its `objects` named in place of `parts`. With
  `again`, a file a drawing of this conversation wrote, it takes that
  drawing's request, each input given beside `again` in its place; what
  it is drawn from, code, a file or the scene, is one input, so code given
  over a drawing of a file draws from the code, with the file's arguments
  and parts, and the scene given over a drawing of a script's parts leaves
  its arguments and parts behind, as code given over one of the scene
  leaves its objects. A script, as code or a file, is at most 1 MB, which
  both tools' descriptions state; a larger one is refused, naming the limit
  and saying to move parts of it into workspace modules it imports.
  `cad_api` takes a `name` to look up, or up to twelve `names`.
- What a script is given besides build123d: `show(part, name=...,
  surfaces={group: faces})`, and the helpers `round_edges`, `cast`, `boss`,
  `pad`, `rib`, `cutaway`, `bolt_circle`, `bolt_row`, `pipe`, `coil`,
  `hose` and `belt` (ADR 0023), the engineering helpers `sheet`, `strength`
  and `iso_fit` (ADR 0023), with bd_warehouse's standard parts to import.
  They come from the module `zhiyin_cad_helpers`, which the tools tell a
  script to import, so the file says where its names come from; a build
  gives them without the import too. An export named
  `zhiyin_cad_helpers.py` writes that module as one file, holding the source
  of every module the helpers import, so a script beside it runs with
  build123d and bd_warehouse alone. Run so, or with the harness on Python's
  path, the helpers build the same shapes and print what they did that
  differs from what was asked, as the build's answer says it, and `show`
  prints each part's name and size. A cut a build skips, as it would break
  the part, is made there as written; the answer's first line tells the
  model to change it in the script. In a build the helpers are always the
  harness's own, whatever copy lies beside the script.
- `cadPrograms`, the programs the studio needs installed before it can
  run: uv, which makes its environment as the connector is installed.
- `cadEnvironment` is the environment the studio's Python runs in, for
  whoever keeps it: its `name`, `cad`; its `lock`, which pins build123d,
  bd_warehouse and what they need to one version each with the SHA-256 of
  every file, kept beside this package and written by the Python
  environment's lock script; the connector and plugin that install it,
  `installedBy`; and `takesNoPackages`, why no package is added to it.
- `CadPython`, which whoever provides the Python implements: `state()` says
  whether it is ready or cannot run; `run(CadRun)` runs it on
  the harness and its request, reading and writing only the folders given,
  offline, and answers a `CadRunOutcome`.

## Invariants

These hold for every call. What each family of the CAD studio's tools does and
says is on a page of its own, whose invariants are held to tests in the same
way:

- [Building parts](building.md): the helpers a script is given, the library
  look-up, the script mistakes the answer names, the checks for how a part is
  made, and positions, sweeps, gears and explode.
- [Requirements](requirements.md): what each kind of requirement measures and
  how its verdict is said.
- [The answer and the exports](answer-and-exports.md): what a build's answer
  says of its parts, and the files it writes.
- [Drawings](drawings.md): drawing a part or the 3D scene: views, dimensions
  and the sheet.

### Approving a build

- The approval names what a call is about: its workspace file, else the
  parts the script shows or draws by a name written in quotes, else the
  files it writes.
- The approval shows the script whole. A workspace file is read once, as
  UTF-8, and shown as the code it holds; what runs is that code, and a file
  changed after its build was approved does not run. The rest is in words:
  the script's arguments as a command line has them, each with a space, a
  quote or nothing in it quoted, the drawing's sheet, views and dimensions,
  and each file written with what it holds.
- A script that declares an encoding other than UTF-8 is refused, since
  Python would read it differently from what is shown. So are code and a file
  given together, neither given, a file that is not `.py`, an export of
  another kind, a path named twice in any letter case, an export onto a
  folder, and more than eight exports, each before
  anyone is asked. A script outside the workspace, or an export named by a
  workspace path that leads out of it, is refused as nothing the model can
  correct.
- An export or a drawing's output may be written outside the workspace,
  named by a whole path, which is placed as a file inside is: links followed,
  never through one whose target is missing. The approval names it by its
  whole real path and says it is written outside the folder the person
  selected, and no allowance for the conversation covers the call; only a
  grant for that file or its folder does (ADR 0012). A place in Zhiyin's own
  folders is refused whatever would be approved, to the model, which can
  choose another place; one through a link whose target is missing is
  refused to the person. The finished file is
  written into the run's own folder and moved into place at that real path,
  created only where nothing appeared, and an existing file replaced only
  while it is what the approval saw.
- The approval says the script reads the workspace and cannot use the
  internet, and names each file Zhiyin writes, as created or updated. Builds
  that write only new files, or files this conversation's builds wrote and
  nobody changed since, are named as one set the person could allow for the
  conversation, and so are such drawings; one that replaces any other file
  is not (ADR 0012). The set matters only for a call that asks: a build or
  drawing in the workspace is decided by what it declares and runs without
  asking (ADR 0012). One of its own files that changes between the approval
  and the run makes the call refuse, and nothing is written over it.
- Each call declares what it does (ADR 0012). A build or drawing runs
  confined and reads the workspace; it changes the workspace by the files
  Zhiyin writes from it, which are declared and kept to put back, or
  elsewhere when one is outside the workspace. A library look-up reads only
  the library Zhiyin installed.
- A build of a workspace script is bound to that script and every file
  Python can import in its folder or below (`.py`, `.pyw`, `.pyc`, `.pyd`,
  `.so`), as they were read when the call was prepared: one changed,
  appeared or gone between the approval and the run makes the call refuse,
  and nothing runs.
- **No call makes the CAD environment** (ADR 0023). It is made as the CAD
  studio connector is set up, or updated after a release changes its
  packages, on the Plugins page. Until its Python is ready, the studio
  offers no tool, refuses every call, a library look-up included, saying
  that the person sets it up there, and runs nothing.

### Running a build

- A build or a drawing of parts is two confined runs. The second starts
  beside the first, so loading build123d overlaps the script's run, and is
  given its request, what it measures, only once the first has ended and
  handed on its parts. When the script fails, hands
  nothing on or is stopped, or the build is cancelled, the second is stopped
  without a request; either way it has ended before the call answers. The
  first runs the script, at each position and again to check its cuts, and
  writes only what it built: each shown part as a file of the geometry
  kernel's own exact format, which holds data and no code, with a list of
  their names, the faces of each named surface, the faces a helper marked
  to mesh finer or coarser, what the helpers did and the cuts skipped, the
  way each part is made where the script said, and where `cast()` and
  `boss()` made what they made. The
  second is the harness alone, in isolated Python with a home and an output
  folder the first never had and nothing of the workspace on its path. It
  reads those files as data and runs nothing of them, then measures and
  checks the parts, works out explode, draws them, writes the exports and
  the picture, and writes the answer, the only one Zhiyin reads. So what
  the answer says of the parts, their sizes, overlaps and requirements, and
  the files written, are the studio's, of the parts the script built,
  whatever the script does in its own run; what the helpers did and the
  cuts skipped are as the script's run reported them. A drawing of the 3D
  scene runs no script, so it is the second run alone.
- The script's run reads the workspace, the harness and the run's folder,
  writes only its own output folder and a home of its own, cannot change the
  workspace and cannot reach the internet. Each run's folder, its homes
  with it, is removed when the build ends, with what Windows kept for those
  homes in the person's profile, so nothing is kept from one build to the
  next but the files written. A run folder Windows still held then is
  removed at the conversation's next run, unless a call is using it.
- Both runs read the list of the system's fonts that ezdxf, which build123d
  loads, would otherwise make again on each start, kept for every
  conversation in Zhiyin's data, and neither may change it. It is made by a
  run of its own, isolated, which reads only the harness, writes only a
  folder new for it, lists the fonts and runs nothing else; Zhiyin writes
  what it listed into the kept folder, so nothing a conversation ran is in
  it. One list is kept for this release's CAD packages and the system's
  fonts folder as it is, named by that folder's time of change, which moves
  on as a font is added or removed there. A build that finds no list for the
  fonts as they are now, the first one, or the first after a font was added,
  lists the fonts in each run itself, so the font is found, and the list is
  made beside it, once while the app runs, for the builds after; one that
  could not be made leaves each build listing them itself.
- What either run leaves is read as untrusted: the answer is checked as
  data, and the only files taken from it are those Zhiyin named, each a
  plain file of the run's own folder. A run cannot point Zhiyin at any
  other file, to copy or to show.
- A workspace script runs from a copy of the files its approval recorded,
  laid out as in the workspace, each checked against what was recorded
  before it runs; one that differs stops the build. Python is given neither
  the script's folder nor the current one on its path and writes no
  compiled files, so it imports only those copies from beside the script,
  whatever else is there.
- A workspace script runs as that file, with its arguments, and imports the
  files beside it; code imports the files at the workspace's top. The script
  runs as `__main__` and each module it imports under its own name, so parts
  a module shows only under `if __name__ == "__main__":` are not shown when
  another script imports it. Each run of
  the script, at each position and when it is run again to check its cuts,
  imports the workspace's modules afresh, as a script run from a command line
  does, so the parts they show are in every run. Code that
  cannot import a module kept in a folder of the workspace is told where it
  is and how to build beside it.

### Failures and limits

- A script that fails answers with its error and the line it failed on in
  the script, and in each workspace file it imports on the way, quoted,
  without the harness's or build123d's frames, and what it printed
  before; nothing is written. The script is named as the model knows it: its
  workspace path, or "the script" for code, never the copy that runs. So does a run whose answer is not one the harness
  writes.
- A script whose error, or a deprecation warning the library gave while it
  ran, in the script or in a workspace module it imports, matches a known
  change in build123d is answered with the form that works in the version
  installed, in place of the old one, and the pages to open; a build that
  succeeds says it too, after its measures. Each change in the table is one
  whose old form gives that error or warning in the CAD environment while
  the new form runs there. An error that matches none is answered as it is.
- A script that fails where the library's own words mislead is answered,
  after its error, with what fixes it: a CadQuery habit build123d does not
  share (a selector string, `centered=`, a hole or shell method, a
  Workplane chain, a diameter where build123d takes a radius) with
  build123d's form; a name only a later release has with what the version
  installed has for the same job; and the geometry kernel's failure, whose
  words never say what to change, with its likeliest cause, the most
  particular one known alone. Each habit's error is the one it gives in the
  CAD environment.
- A fillet or chamfer the kernel cannot make, given an edge that is not an
  edge of the shape it works on, as one of the shape before a move or of
  another shape built alike, fails saying so and to take the edges from the
  shape as it is at that step, never as a radius too large.
- A build or a drawing runs for five minutes, or for the whole minutes the
  model gives it, up to thirty, which the approval then says. One that is
  stopped, or runs past its time, answers that it did not finish, which of
  the two, how far it got, step by step, and what the script printed before;
  run past its time, it is told to do less in a call or to ask for more
  minutes. A script may print 64 MB; one stopped there is told the limit
  and to print less. The time a build says it took counts Python's start
  and loading build123d.
- A run that ends without an answer is told what the script printed, and
  none of the warnings ezdxf, which build123d loads, gives about the system's
  fonts. When Python itself crashed, as the geometry kernel makes it on a
  shape it cannot work, the answer names the call that crashed and the line
  of the script or of its workspace module that made it; a crash in no code
  of the script's is said to be the CAD studio's own.

### Handing a design to its reviewer

- **A built design is handed to its reviewer.** Each build checked against
  requirements keeps, in the conversation's own folder, what
  `3d-rendering/part-reviewer` is handed (ADR 0024): the requirements as
  first written in the conversation, those removed or changed since, each
  one's latest measure, the build's answer as the model read it and its
  drawing from four sides, for a reviewer that can see it. `PartReviews`
  answers what was built after a time, a design built against several
  requirements files as one piece: each file's requirements, then the last
  build's answer and drawing. Among the scripts built against one
  requirements file, each requirement is judged by its latest measure,
  whichever script's build gave it, and a script is reviewed only for the
  requirements whose latest measure is its own; one no build measured goes
  with the script that measured most of them. A script that holds none, as
  a diagnosis the model ran beside its design, is not reviewed. The
  requirements as first written are the file's, from its first build in the
  conversation.

### Showing the parts built

- A successful build hands over a glTF binary of the parts it showed, each
  part named, with the parts and their sizes; a failed build, a build whose
  mesh could not be made, and a drawing hand over nothing, so the parts shown
  before stay. The mesh is written in the run's folder and never reaches the
  workspace.
- The parts a conversation built last are kept with their mesh in a folder
  of the conversation's own, apart from every other conversation's, and
  outlive the run that made them. Each build is numbered: its mesh is read
  back only by its number, and a view asking for a build since replaced gets
  nothing. Reading the mesh of the build shown fails when it cannot be read,
  so nothing always means replaced. A mesh that cannot be kept leaves the
  parts shown before.
- Listeners hear of each build and of the parts put away; a forgotten
  conversation's parts and mesh are removed, and what a previous run kept is
  removed before anything new is kept.

### What the studio knows

- Each tool's definition, as a model is sent it, is under 6,500 characters:
  what the tool does, its limits and what its answer holds, and every input
  in a clause of its own, a number or a point with its unit and a direction
  said to be one, with the reference a call may need on the studio's written
  pages, which it names and the studio's knowledge opens.
- Every input has one type, so a provider that reads a written-out call back
  by declared type receives every value whole: a point or a direction is
  three numbers, a section's `looking` names a straight view, and an
  auxiliary view's `direction` is the way it looks. An auxiliary view given
  `looking` is refused, naming `direction`.
- Listing the studio's entries never starts Python. Before the reference is
  read, the list holds the written pages, the known changes and one entry
  per library saying it is read the first time it is opened; after, every
  page of it.
- The reference is read the first time any page of it is opened, in the CAD
  environment's Python, confined to reading the harness and its run's own
  folder and writing only that folder, gone after the run. Openings at the
  same moment share one read. What it gives is read as data: a page of
  another kind, or a name that is no Python name, keeps nothing and says the
  reference could not be read.
- The reference is kept in the studio's data under the versions of build123d
  and bd_warehouse the CAD environment's lock pins, and read from there by
  every later opening, after a restart too, with no Python. A reference of
  other versions is never listed or opened, and is removed once the
  reference of these is kept; Python that gives other versions keeps
  nothing and says to update the studio.
- A class's page gives its signatures, the library's description of it and
  its own methods and properties, each with its signature and first
  paragraph; those it takes from a class with a page of its own are named,
  pointing there. A name the library lacks opens nothing.
- Common library names carry, as other names, the plain words for what they
  make that their own description lacks, so a search in those words finds
  them: "round the edges" finds `fillet`, "digits" finds `Text`, "coil" finds
  `Helix`. Every name given such words has a page in the installed library.
- Until the CAD environment is ready, opening the reference says the studio
  is not set up and runs nothing.

## Testing notes

The unit tests replace the Python with a stand-in that answers as the harness
does, which proves the approvals, the folders a run is given and the files it
writes. The system-boundary tests run the real harness in a made CAD
environment, confined as the kept environments are, and are skipped unless
`ZHIYIN_CAD_PYTHON` names that environment's Python: they are what shows the
measurements, the exports, the picture and the confinement hold, and,
handed lines as Blender gives them, that the drafting reads a scene's. A
drawing of a real scene, with both studios real, is tested where the
composition joins them. They also read the real library's reference, and
build each known change's old form, which must be answered with its new
one, and every new form, which must build. Each run is recorded with its
commit and build123d's version, and a release needs them all run and passing
on its commit. The harness's code that needs no geometry kernel, the ISO 286
fits, the strength calculations, the part-name patterns and the making of
the helpers' one file, is tested in plain Python in every gate; that file
running a script with nothing of Zhiyin's is a real-CAD test.

The hand-off to the 3D studio is checked twice. With the CAD environment, a
real build's `.glb` and motion files are read against the contract's names
and fields. Without it, as in CI, the code that writes each file is read for
those names, which catches a rename on this side but not a key written under
a name built at run time.
