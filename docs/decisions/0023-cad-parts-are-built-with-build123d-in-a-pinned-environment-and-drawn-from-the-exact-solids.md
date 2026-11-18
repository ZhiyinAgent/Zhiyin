# 0023. CAD parts are built with build123d in a pinned environment and drawn from the exact solids

Status: accepted

## Decision

### The environment

- **Exact solids come from build123d,** a Python library over the OpenCASCADE
  kernel, in an environment named `cad` that Zhiyin keeps beside `default`
  (ADR 0020). It is made from a lock like the default's: every package pinned
  to one version, each file checked against its SHA-256, wheels only. Like
  `default`, it cannot be created or removed by name, and resetting it
  rebuilds it from the lock, asked for each time with what it downloads.
- **bd_warehouse 0.4.0 is in the lock**, for standard parts: fasteners,
  bearings, flanges, pipes, gears, sprockets, threads, O-rings. `cad_api`
  reads what the installed helpers, build123d and bd_warehouse accept, as
  `blender_api` does for Blender.
- **Installing the CAD studio connector makes its environment.** The Plugins
  page installs uv, then has uv make the `cad` environment from its lock:
  Python, then the locked packages, each checked against its hash, then
  compiled. It uses the same sources, mirrors and retries as every Python step
  (ADR 0027), and a stop or a failure leaves no half-made environment: one
  being replaced is put back as it was.
- **The consent states the whole download before anything is fetched.** The
  install dialog lists uv, the Python build, unless Zhiyin already keeps a
  Python of that minor version, and the CAD packages, each with where it
  comes from. uv's size is pinned. The Python build's size and each package's
  are recorded in the lock by the script that writes it: the Python build's
  as its site answers for the build the pinned uv downloads, and each
  package's as the Python Package Index publishes the largest file of that
  version, among those whose hash the lock holds, that installs on the lock's
  Python and platform. The packages' total is shown as about that size, since
  pip, which comes with the environment, is not counted and uv does not
  download again what it has cached.
- **Its progress is told by step.** uv reports no bytes as it downloads, so
  the connector says which of three steps it is on: setting up Python,
  installing the packages, preparing the packages. The person can stop it at
  any step.
- **Until it is made, the connector is not installed.** The CAD tools are not
  offered, a CAD call, a library look-up included, is refused, and the model
  is told that the person sets it up on the Plugins page. When a release
  changes the CAD package list, the environment reads as needing an update in
  the same way, and updating makes it again from the new lock, setting the
  old one aside until the new one is whole.
- **No call makes it.** Neither a CAD tool nor a Python script asked to run in
  `cad` makes the environment or makes it again; each is refused, saying how
  it is installed.
- **The connection's install has two parts, joined by the capabilities
  group.** A connection names the programs it needs and, where it has one,
  what it makes with them: a step with a state, in the same terms as a
  program's, and an install. The Python sandbox provides the CAD
  environment's, and the composition root hands it in for the `cad`
  connection; neither feature knows the other (ADR 0002).

### A build

- **The CAD studio is a feature of its own.** It owns its tools and the Python
  that measures, draws and exports a part. It runs that Python through a
  runner the composition root hands it, which the Python environment feature
  provides for its own environments; neither feature imports the other. It
  ships in the 3D & Rendering plugin, as the CAD studio connector, and needs
  `uv` and nothing else.
- **One call builds the parts from nothing.** A call gives a script, as code
  or a workspace `.py` file, that builds parts and shows them. Nothing is kept
  between calls but files: a part another call made is read back from the
  STEP file it wrote. The script runs to the end each time, so what a call
  answers depends on the call alone. A build or a drawing runs for five
  minutes, or for the whole minutes the model gives it, up to thirty.
- **A build reads the workspace and writes only what its call names.** The
  script runs confined (ADR 0006), reaching no host, reading the workspace and
  writing only a folder of the run's own. The exports the call names, by path
  and kind, are copied from there into the workspace, or by a whole path
  outside it, once the run ends; each is declared, as new or replacing a
  file, and backed up (ADR 0013). The script cannot change any other file.
- **A workspace script runs from a copy of the files read when the call was
  prepared**, each checked against that reading, with neither its folder nor
  the current one on Python's path and no compiled files written, so it
  imports only what was read: the script and every file Python can import in
  its folder or below (`.py`, `.pyw`, `.pyc`, `.pyd`, `.so`). One changed,
  appeared or gone between the approval and the run makes the call refuse,
  and nothing runs.
- **A build is two runs: the script's, then the studio's.** The first runs the
  model's script and writes only the parts it showed, each as a file of the
  kernel's own exact format, with a manifest of their names and the marks the
  helpers left on their faces. The second is the harness alone, in isolated
  Python with a home and output folder of its own: it reads those files as
  data, then measures, checks, draws and exports the parts and writes the
  answer, the only one Zhiyin reads. The harness ships as plain files beside
  the app's archive, and Python runs it where it is installed.
- **The answer is measured, and drawn for the model to see.** Each part is
  checked as a valid solid and measured: its size, volume, area, centre of
  mass, faces by kind, and the diameters of its round holes; parts that
  overlap are named with the volume they share. A picture of four views,
  shaded with their edges drawn, is rendered from the exact shapes in the
  studio's run, for the model to look at. The answer also says what a
  picture of the whole hides: where a part that is not a valid solid goes
  wrong, how deep two parts overlap, a tube end that meets nothing.
- **Exports are STEP, STL, 3MF, glTF binary and a parts list as `.csv`.**
  build123d writes the first three; the studio writes its own glTF (below).

### Helpers

- **Scripts are given shaping helpers, as they are given `show`.**
  `round_edges`, `cast`, `boss`, `pad`, `rib`, `cutaway`, `bolt_circle`,
  `bolt_row`, `pipe`, `coil`, `hose`, `belt` and `sheet` build the forms real
  parts have in the ways the kernel builds reliably: drafts by tapered
  extrusion, features sunk into the body by a clear margin, fillets tried edge
  by edge with a smaller radius where the larger one fails. Where the kernel
  cannot do all that is asked, a helper does what it can and the build's
  answer says what it left and where, in its first line for a cut it skipped;
  it never fails the script. A name the script defines itself replaces a
  helper's. In a build the helpers are always the harness's own.
- **The helpers can leave Zhiyin.** An export named `zhiyin_cad_helpers.py`
  writes them as one module, so a script beside it runs with build123d and
  bd_warehouse alone and builds the same shapes.
- **Sheet metal is a helper of Zhiyin's own, `sheet()`.** It folds a flat
  outline along bend lines (bends, flanges, hems, jogs) into a solid, gives
  its flat pattern by DIN 6935's K factor, and cuts reliefs where a bend ends
  inside the sheet. A bend requirement can ask for every sheet-metal rule
  from the thickness, each with its margin; there is one set of these rules.
- **Strength is checked by hand formulas first:** shafts, beams, bolts, a
  bearing's L10 life, Lewis gear-tooth bending and column buckling, each
  naming its source and assumptions and saying its checks with margins, from
  a material table of named grades. ISO 286 fits give hole and shaft limits.
  Finite elements are not offered.
- **A parts list is measured from the parts shown.** A build's `.csv` export
  and a drawing's `parts_list` count identical shapes once, list
  bd_warehouse's standard parts as bought by class and size, and weigh each
  part by its volume and the material given. The drawing balloons each item
  on a chosen view, numbered as its table.

### Parts in the 3D studio

- **The studio writes its own glTF.** Each part is a mesh of its own, placed
  where the script placed it about the origin it was modelled at; each face a
  run of points with the surface's normals; each group of surfaces the script
  names (`show(..., surfaces=...)`, or a cutaway's cut faces) drawn with a
  material of the group's name; each mesh marked as a CAD part's.
- **The 3D studio makes every model file's meshes whole** as it reads them:
  points in the same place are joined, keeping sharp the edges where the
  file's normals part. A CAD part's groups of surfaces are slots of their own,
  and keep their materials through `shapes_from`.
- **A CAD part's shape changes only in the CAD.** The 3D studio refuses to
  bevel, subdivide, thicken, cut, mirror or repeat a mesh marked as a CAD
  part's, and says how to change it in the CAD instead.

### Drawings

- **A drawing is made by its own tool, `cad_draw`.** It takes a `cad_build`
  script, builds the parts the same way, and draws them on a sheet instead of
  measuring and exporting them. A scene from the 3D studio is drawn by the
  same tool from the lines Blender finds (ADR 0022).
- **Views are projected from the solids by the kernel's hidden-line removal,**
  through build123d's `project_to_viewport`: named views, sections cut
  through a point, details enlarged from a view, and auxiliary views along any
  direction. Hidden edges are drawn dashed and round faces get centre lines.
  The views are placed by first- or third-angle projection, at the largest
  ISO scale that fits the sheet unless the call names one.
- **Dimensions name geometry, not numbers.** A length gives two points, which
  snap to the nearest corner or edge end drawn in its view. A diameter or a
  radius gives a point on or inside a circle drawn there. Angles, chamfers,
  ordinates and hole callouts join them. The value written is the one
  measured on the drawing. A callout reads the hole's drill, depth,
  counterbore or countersink from the solid, and its thread only where
  bd_warehouse made it, saying when the thread is not known. A call may also
  give the size it expects: if the part differs from it, the drawing is
  refused and the answer says by how much.
- **The sheet is Zhiyin's own drafting code,** in the harness: an ISO 7200
  title block, line weights and types by layer, single-stroke lettering, and
  dimension placement that keeps text and leaders apart. It writes PDF, SVG
  and PNG itself, and DXF through ezdxf. A DXF can also hold one view alone,
  at full size, for cutting.
- **The answer gives the sheet as drawn:** its scale, every view and every
  dimension as written, the files, and a picture of the sheet for the model
  to look at.

## Why

A drawing turned into a part, a bracket to print or a fixture to mill must
have exact sizes and faces a CAM program or a slicer can take. Blender's
meshes are the wrong representation for that: a STEP file from a mesh has no
cylinders and no planes, only triangles. build123d builds boundary-represented
solids with the OpenCASCADE kernel, reads and writes STEP, and is plain
Python, which models write well. Keeping it in a pinned environment Zhiyin
owns means every install has the same kernel and the same behaviour, checked
against hashes, as the default data stack is.

The environment is large, about 250 MB to download and 640 MB installed, most
of it the kernel. Made inside a first tool call, the download ran with no
prompt for a read and stalled a task for minutes when a call did ask, and
every kind of call had to remember to warn about it. The person already
chooses the CAD studio by setting up its connector, which is the moment to
download it, as Blender, Typst and Tectonic are downloaded. The cost: someone
who sets up the CAD studio and never builds a part has downloaded the
environment anyway, and the size is an estimate rather than a pinned figure.

Building from nothing on every call costs the library's import, about two and
a half seconds warm, on every call. In return there is no session to keep,
end or recover, and a call's answer cannot depend on what an earlier one left.

Copying the named exports in, rather than letting the script write the
workspace, binds what is declared to what is written: a script shown in full
can still compute a path, and confinement grants folders, not files. The copy
a workspace script runs from makes what Python imports equal to what was
read; predicting from outside every file Python might load is a list that
changes between versions: compiled files, extension modules, archives, `.pth`
files, namespace packages, links.

The script and the code that judges its parts run in separate processes
because Python hides nothing from code in the same process: its module table,
the garbage collector and stack frames reach every function, so a script
could replace the requirements check, the measuring or the answer. The
confinement is the security boundary either way; the split keeps the answer
true. The parts that are measured and the files delivered come from the same
exact-geometry files, written before any of the studio's code runs on them,
and the studio never loads anything from the first run that could run code,
such as a pickle.

A weaker model given raw build123d builds parts from boxes and cylinders:
lofted heads with bosses came out invalid with no word of where, a 16 mm
fillet failed a whole build, a belt drive was dropped because its path round
the pulleys was maths it had to do, and a hose ended in the air. build123d's
glTF export draws each face as a piece of its own, so a twelve-face part read
as twelve pieces with 1,050 open edges, and its placement of a single part is
in the wrong axes; faking rounding with Blender bevels then tore the block.
Each of these is work the harness can do once, exactly, for every model.

A model that writes dimension numbers itself can write numbers the part does
not have. Snapping each dimension to drawn geometry and writing the measured
value means a drawing says what the part is, and `expect` turns a drawing into
a check of the part. Hidden-line removal on the exact solids gives true edges
and circles, which become arcs and circles in the DXF that CAM and laser
software need. A part someone orders or makes needs a parts list, a drawing a
shop can read and a reason to believe it holds; counting, weighing and reading
holes from the solid keeps each true to the model rather than to what a script
meant. build123d 0.13.0, the latest release (checked 2026-11-07), has no sheet
metal. Hand formulas answer most sizing questions in milliseconds and say
their assumptions.

## Rejected

- CAD through `run_python` alone: no measured answer, no picture, and every
  export a path the script computes.
- CadQuery: build123d is the newer API over the same kernel. Its builder
  context reads closer to how a part is described.
- A persistent CAD session like Blender's: it saves the import on later calls
  but adds a session to keep, end and recover, for a script that runs in
  seconds.
- Drawing the picture in the conversation's Blender: it couples two features
  and starts Blender for a part that needs only a projection of its faces.
- FreeCAD, for building or TechDraw: a large application rather than a
  library, driven through its own executable.
- A second process for the requirements alone: some checks reuse what the
  measuring found, as the check that parts are separate reuses the overlaps,
  and the sizes in the answer and the exported files would still come from
  the script's process.
- Refusing scripts that import the harness, or hiding the checker: code in the
  same process reaches it all the same.
- Adding kinds of file to the reading's record instead of the copy: it fixes
  today's list and leaves the next import mechanism open.
- Making the environment on the first CAD call, with or without asking: it
  stalls a task for minutes, and keeps the warning in every call path, the
  trap that let a read download unasked. Installing uv alone and making the
  environment on first use, read calls included, behind an approval: the
  same stall, and a read that asks.
- Pinning each wheel's size in source like the programs: the lock is written
  by script from uv's resolution; recording the sizes there keeps one source.
- Byte progress from uv: uv 0.12.15 reports none a caller can read.
- Advice alone in the skills: the model followed the advice it had and still
  met kernel failures with no way through them.
- Welding meshes only in the CAD export: files from elsewhere are drawn the
  same way.
- Warning, not refusing, on a bevel of a CAD part: the result is torn whatever
  the warning says, and the CAD route keeps drawings and checks true.
- Patching build123d's exporter: per-face materials need a writer that knows
  the groups, and a short one over the kernel's own meshing does it.
- A helper that fillets by `max_fillet`: it searches each edge at length and
  still fails where faces crowd; trying smaller radii is quicker and says what
  it did.
- build123d's own drafting objects (`TechnicalDrawing`, `ExtensionLine`): they
  are sketch geometry the script places by hand, a dimension measures the
  path it is given, and nothing lays out views, sections or details.
- Drawings of a part from Blender's Line Art: its edges are a mesh's, with no
  true circles, and it needs the conversation's Blender for a part that has
  none.
- Dimension values written by the model: nothing would check them.
- A parts list from the script's own names: two names for one shape would
  count twice, and a bought part would read as made.
- Thread callouts guessed from a hole's diameter: a Ø6.8 hole is an M8 tap
  drill or a plain hole, which only the part that made it knows.
- Waiting for build123d's sheet metal: it is not in a release.
- Finite elements (Gmsh and CalculiX) now: meshing and solving need an
  environment and checks of their own, and most first questions are answered
  by the formulas.

## Assumptions

- build123d 0.13.0 and its kernel, cadquery-ocp-novtk 8.0.1.1.0, publish
  Windows wheels for Python 3.11 to 3.14 (checked 2026-10-24), so the lock
  installs with `--no-build`. bd_warehouse stays compatible with the
  build123d the lock pins (0.4.0 declares build123d ≥ 0.12, < 0.14); it is
  pre-1.0, so the lock pins it.
- Importing build123d takes about 2.6 s warm on the development PC
  (2026-10-24). If it grows much past that, a persistent session is
  reconsidered.
- A part a person asks Zhiyin for is built in under five minutes.
- The kernel's binary format keeps each part's faces in their order, so face
  numbers in the manifest name the same faces when read back: checked on 40
  filleted parts, 1,040 faces, 2026-10-28. Writing and reading them took under
  half a second; a second Python start with build123d imported adds about
  2.2 s a build.
- Python's `-I` drops the variables that make it print UTF-8, so the studio's
  run is started with `-X utf8` too; the script's run keeps them, with `-P -B`
  in place of `-I`.
- A workspace script imports only from its own folder and below, which is
  where the harness puts it on Python's path; a link could lead it elsewhere.
- `uv python list <version> --only-downloads --output-format json` names the
  Python build the pinned uv downloads, and its site answers a HEAD request
  with the build's size (checked 2026-10-28). PyPI's JSON API gives each
  file's size and SHA-256 for a version, and the file uv installs is one of
  those the lock hashes (checked 2026-10-28).
- An installed `cad` environment takes about 640 MB and its Python about
  70 MB, measured on the development PC on 2026-10-29.
- The kernel meshes the edge two faces share with the same points for both,
  so joining points in the same place closes a mesh where its shape is closed
  (verified on filleted and boolean parts, 2026-10-26).
- Blender's glTF importer keeps a mesh's extras as its custom properties and
  draws each piece of a mesh in a slot of its own, in order (Blender 5.2).
- build123d 0.13.0's `project_to_viewport` returns visible and hidden edges in
  the view's plane, centred on the point looked at. It takes about 0.01 s per
  view for a bracket (checked 2026-10-24).
- ezdxf 1.4.5, Pillow 13.0.0 and fontTools 4.67.0 come in the `cad` lock as
  build123d's own dependencies, and build123d ships the ReliefSingleLine
  single-stroke font, under the OFL (checked 2026-10-24).
- A drawing with a dozen views and up to 80 dimensions is drawn well within
  the five minutes a run may take: a six-view A3 sheet takes about 0.5 s
  beside the build.
- bd_warehouse's classes keep their attributes through moves and copies, and
  its holes give their places in builder mode.
- The sheet-metal rules are rules of thumb that shops vary (hole to bend from
  1.5t + r to 3t + r); a limit given in millimetres replaces its rule.
- A bearing's dynamic rating comes from its maker's catalogue, as
  bd_warehouse's bearings carry none.
