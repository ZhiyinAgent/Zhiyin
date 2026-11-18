# 0002. Packages sit in layers held by lint, with pure packages, a test-helper layer, and fakes owned by the package that owns the interface

Status: accepted

## Decision

### The layers

Every workspace package sits in one layer and imports only from the layers
below it:

| Layer | Holds | May import |
| --- | --- | --- |
| contract | Declarations more than one layer must spell the same way | nothing |
| pure | Shared logic with no I/O | contract, other pure packages |
| platform | One mechanism several features share | contract, pure |
| feature | One concept, with the interface for it | contract, pure, platform |
| group | Features only ever used together, presented as one | contract, pure, its members' types |
| loop | One model turn | contract, pure, types from the layers below |
| core | The window's commands, the conversation list, saving, startup | contract, pure, types from the layers below |

Test helpers sit in a layer of their own beside these (below).

- **A package's folder names its layer**: `packages/<layer>/<name>`, with the
  folders `contract`, `pure`, `platform`, `feature`, `group`, `loop`, `core`
  and `test-helper`. The contract and the core, alone in their layers, sit in
  them all the same. Lint reads a package's layer from its folder and nothing
  else declares it. A folder under `packages` that is not a layer, or two
  packages of one name, stop lint. The architecture overview lists the
  packages under their layers' folders, and a repository test holds that list
  to the folders.
- **The contract holds declarations only**: types, the command channels, the
  bridge key, constants and value sets, all of them data. It holds no state,
  does no I/O, and holds nothing a single feature owns. Lint refuses a
  function declaration, a function expression, an arrow function and a method
  in its source. The types a pure package computes over stay in the contract,
  with the value sets it checks against.
- **A pure package computes and does nothing else.** It reads no file, starts
  no process, opens no connection and keeps nothing between runs of the app.
  It may hold state in memory, as the window's copy of the workspace does.
  Everything above the contract may use a pure package whole, its functions
  and classes as well as its types: the window, the platform packages, the
  features, the groups, the loop and the core. Each pure package has one job
  and a README; it needs no decision record, because it holds no mechanism.
  Logic only one feature and the layers above it use stays in that feature.
- **The contract and the pure packages run anywhere.** Their source imports no
  Node module, under `node:` or its bare name, and no npm package, by a static
  import, a dynamic one, an inline type or a `require`. Their tests may use the
  test runner and Node. Lint enforces both, and holds a pure package's tests
  to its own rule, as it does a feature's.
- **A platform package owns a mechanism, not a policy.** A new one needs a
  decision record. A platform package starts no program of its own: one that
  needs a program declares the narrow runner it calls and is handed the
  sandbox's runner, which starts it in its Job Object (ADR 0005).
- **A group exists only where there is joining code to move into it**:
  capabilities (tools, MCP, plugins, toolchains, the interactive browser and
  the Blender studio, and, served through it as built-in connections, Git,
  the document compiler, the Python environment and the CAD studio) and
  rewind (the rewind planner and file recovery). A group keeps none of its
  members' storage. The one thing a group writes itself is the rewind group's
  journal of a rewind in progress, so that a restart can finish it.
- **Above the feature layer, packages import types only.** The composition
  root in the main process constructs every real implementation and hands it
  in. It may say which implementation, never what it does. The rest of the
  main process holds the window, the sender check, the Electron services
  handed to the core (dialogs, notifications, the spellchecker, the document
  processes) and shutdown, and forwards the contract's commands. It imports
  nothing from the workspace but the contract.
- **Above the group layer, a member is reached through its group.** An
  exception is listed in the lint configuration with the reason the group does
  not answer for it. There are two, both panels a person watches and drives:
  the core reaches the interactive browser for the browser panel, and the
  Blender studio for the 3D view.
- **Nothing goes around the rules.** Lint refuses a workspace package reached
  by a dynamic import, an inline type import or a runtime `require`, a relative
  path into a sibling package, and a path into another package's internals.
  The layer rules read every kind of TypeScript file, `.ts`, `.tsx`, `.mts`
  and `.cts`.

### Test helpers and fakes

- **Test helpers sit in the `test-helper` layer.** `test-support` is in it:
  temporary folders, waits and file holds. Any package's tests, and the code
  that runs only for them, may import a test helper. Nothing the app runs may,
  the composition root and the app's other processes included. A test helper
  imports only the contract.
- **What counts as test code is defined once,** in the lint configuration: test
  files, files under a `test` or `system-boundary` folder, and the tests
  against the installed app. The same definition decides where a temporary
  folder must come from.
- **A fake is published by the package that owns the interface it stands in
  for.** A package that others test against offers a second entry,
  `@zhiyin/<name>/testing`, beside its public interface. The entry holds the
  fakes of that package's own interfaces and nothing else. No package writes a
  fake of an interface it does not own.
- **A fake answers plainly and reaches nothing**: no file, process, network
  or clock of its own. A test changes one answer by handing the fake that
  answer.
- **Tests above compose the fakes.** The loop's and the core's test setups
  build their dependencies from the `testing` entries of the packages below
  them. The loop's own `testing` entry offers that composition, since the loop
  owns the dependencies it takes.
- **Only test code imports a `testing` entry,** and only for a package the
  importing package may already import. A feature's tests still import no
  other feature, its `testing` entry included: a feature is testable with
  nothing else present. The code behind a `testing` entry is held to its
  package's own layer rule, and may use the test helpers.
- **No `testing` entry is in the packaged app.** The gate's packaging check
  fails when one is.
- **A fake with behaviour a test relies on is held to the real thing.** Where
  a fake does more than refuse or return nothing, the expectations that
  describe that behaviour are written once and run against both the real
  implementation and the fake. A fake that only refuses is held by its type.

### Platform packages with no record of their own

The platform packages whose mechanism belongs to another record are decided
there: `sandbox` (ADR 0005), `workspace-containment` (ADR 0006), `pdf-engine`
(ADR 0019) and `credential-store` (ADR 0025). These four are decided here:

| Package | Mechanism | Why it is shared |
| --- | --- | --- |
| `file-kinds` | What a file is, from its head | The file tools and the document panel must give the agent and the person one answer |
| `files` | Replacing a file whole; the person's Recycle Bin, and whether Windows would take a path | Every store that must never be read half written replaces through it; the file tools and the history store recycle the same way |
| `picture-comparison` | Measuring how two drawn pictures differ, and drawing the sheet that shows it | It runs on a thread of its own that loads nothing else of the workspace |
| `workspace-listing` | The bundled ripgrep over a workspace folder: what a search or a listing chooses, a folder's files with size and time, two listings compared | The file tools and file recovery must choose files by the same rules |

- **`file-kinds`.** A signature of a few printable letters needs what a real
  file has after it: a bitmap's zero reserved bytes, a Windows program's zero
  header bytes, an MP3 tag's version, and, with bytes that are not text, a
  GIF's full version or `RIFF` before `WEBP`. A PDF's header may start within
  the first kilobyte when only blank space and a byte-order mark come before
  it, or anywhere there when the file's head is not text. How each feature
  acts on the answer stays its own: what `read_file` refuses, what the panel
  draws, the limits of each.
- **`files` replaces a file whole.** The new contents are written beside the
  file under a name no other write uses, flushed to disk, and renamed into its
  place; any failure removes what was written. The rename replaces a file
  others have open, through Windows' rename with POSIX semantics, so a reader,
  an indexer or a virus scanner never stands in the way; where that rename is
  not supported, Node's rename is used. A rename waits up to two seconds for a
  file a program will not let go of. The rewind group is handed the
  replacement function by the composition root, since a group imports only its
  members.
- **`files` holds the Recycle Bin as features are handed it.** The
  `RecycleBin` type is declared there once; the file tools and the history
  store each take one, and the composition root hands both the same.
- **`picture-comparison`** brings two pictures to one size, measures how they
  differ (similarity, colour distance, the areas that differ, an overall
  change of light or colour, a move or a zoom), and draws and encodes the
  sheet. It works on pixels it is handed and decodes no file. The comparing
  thread imports, of the workspace packages, this package alone. The
  `compare_pictures` tool stays in the tools feature: it checks the call,
  reads the files, has them drawn by the contained drawing process
  (ADR 0019), hands the pixels to the comparer, and says in words what it
  found.
- **`workspace-listing`** is the one listing: the file tools search with it and
  list a folder around each command, and file recovery copies a folder by the
  same listing, handed to it by the composition root.

## Why

Each feature can be built and tested with nothing else present, which makes
the code reviewable one feature at a time. The loop is tested for turns
without settings plumbing, and the core for commands without a model.

The orchestrating layers are where a god class grows: a loop that also routes
every window command, a main process that collects decisions of its own. The
layers make that a lint failure rather than a review comment.

TypeScript has no private module boundary, so lint is the boundary. It catches
an accidental import, not a deliberate way around it, and a violation means the
design is wrong, not the rule.

The window may import only the contract and the pure packages (ADR 0003), so
logic both it and the core need must live where the window can reach it and
no I/O can. A contract that held such logic became a utilities drawer: a
580-line difference algorithm, a stateful class, budget arithmetic, type
guards and the rules over a turn's records, with the line between a
"definition" and logic a judgement nothing checked. A rule lint can hold has
no judgement in it, and the contract is the most-imported package, so it is
where a reader checks the rule. The cost is more packages, and a reader looks
in two places for what both sides share: the contract for what they spell
alike, a pure package for what they compute alike.

The layers are the architecture's main rule. With the layer as the folder,
the tree shows it, and moving a package to another layer is a move a reviewer
sees. The cost is a longer path for every file, and a move whenever a package
changes layer.

A test helper imported by the app would ship test machinery, such as a
Windows file hold, in the product. A layer of their own makes the lint
configuration say what their READMEs say.

A fake written by its consumer keeps the old answer when its owner changes
what it answers, with every test above still passing. Giving each fake to the
owner of its interface puts the fake where the change that breaks it is made,
and makes the entry a rule lint and the gate can hold. The cost is a second
entry on each faked package, one lint rule, and shared expectations to
maintain where a fake has behaviour.

Two copies of one rule drift apart. A panel that draws a PDF with a line break
before its header while `read_document` refuses it shows the person a document
the agent is told is not one. A rule that calls text a picture or a program
when it begins with "BM", "MZ" or "ID3" leaves a CSV of car makes neither
readable nor editable. Replacement written store by store drifts the same
way: one flushes before the rename and another does not, one leaves its
temporary file behind, another uses one fixed temporary name. On a power cut
just after a write that was not flushed, NTFS can keep the rename and lose the
data, so a pending rewind's journal, a recovery record or a settings file
would come back damaged.

## Rejected

- The loop as the only composer: it becomes the route for every window
  command.
- A central interfaces package: a dependency magnet and a second place for a
  god class.
- A dependency-injection container: runtime indirection for wiring that
  constructors already do.
- Feature-to-feature imports as listed exceptions: the layer rule becomes
  advisory.
- Groups with no joining code to take over, such as the model client with
  usage, or permissions with the corrections log: a rename, not a group.
- Shared logic in the contract, type guards included: it becomes a utilities
  drawer, every package depends on every algorithm in it, and the line between
  a definition and logic cannot be checked. `oneOf` holds a check's names to
  the type wherever the check is written, so no guard needs to sit beside its
  type.
- One shared package for all shared logic: the same drawer under another
  name.
- Platform packages for shared logic: a platform package owns an
  operating-system mechanism, and the window cannot use one.
- The window's copy of the workspace inside the window's code: the core's
  tests check that what the core sends rebuilds its state in the window's
  real copy, including the copy asking again for a change it missed; from
  inside the window they could reach only a replica.
- The project rules in the memory feature, with the core sending each
  conversation's project: it changes what the window is sent to move sixty
  lines, and the picker also asks which project holds a folder no
  conversation has open.
- Declaring each package's layer in a table in the lint configuration, or
  listing them on a page: the tree still does not show the layers, and two
  lists drift.
- Keeping the contract at `packages/contract`: shorter for the most-read
  package, but the layer would then be read two ways.
- Test helpers in the platform layer with a list of who may import them: the
  list is the layer under another name.
- Test helpers copied into each package's tests: packages may not import each
  other's tests.
- One package of fakes for the whole workspace: it imports the types of every
  layer it imitates, and nobody owns it.
- Testing the core against a fake of the loop alone: the core's tests would
  stop running the real loop, and a stub of the layer that enforces a rule
  says nothing about that rule.
- Each consumer keeping its own fakes: the copies part.
- Declaring every faked interface in the contract so the fakes fit the
  test-helper layer: a feature's interface is its own.
- Copying the panel's file-kind rule into the tools, or handing the panel's
  function to the tools from the composition root: the first drifts, the
  second makes `read_file` depend on an injected function to know what a file
  is.
- Fixing each store's copy of replacement in place: the next store copies one
  of them again.
- Node's rename alone, retried: it fails while any program has the file open,
  even one that lets others delete it, and a reader that reads the file again
  and again keeps it open longer than any wait.
- Moving the rewind journal into the recovery member so it could import
  `files`: the journal belongs to the group that finishes rewinds.
- Picture comparison inside the tools behind a second entry point: it needs a
  lint exception for one door into a feature, and nothing stops the two sides
  importing each other. As a feature it could not be shared with the thread.
- Letting a platform package import the sandbox, or run programs with Node's
  own child processes: the first breaks the layer rule, the second starts
  programs outside the Job Object.
- The runner's type in the contract: each package needs a few of its options,
  and the runner already satisfies each narrow type.

## Assumptions

- The core runs in one process (ADR 0001), so composition is object wiring.
- Groups and pure packages stay few, each with one job. A pure package that
  grows a second job is split, not widened.
- What runs in both the window and Node needs only the language's built-ins.
  A pure package that needs a platform interface, such as `TextEncoder` or
  `crypto`, is a change to this decision.
- A constant computed from data, such as a channel list spread into a larger
  one, is still data; one that needs a function to compute is not.
- The lint resolver understands TypeScript's `.js` import names. If it stopped
  resolving them the rules would go quiet, so the repository's layer tests make
  real imports that lint must refuse or allow.
- A package's name is unique across the layers, as `@zhiyin/<name>` requires.
- A test helper never becomes something the app runs; one that does is a
  platform mechanism.
- Fakes are consumed by the tests of groups, the loop and the core. If a
  feature's tests need another feature's fake, the feature has a dependency
  its layer forbids. A fake that grows logic of its own is a second
  implementation, and wants shared expectations or to be cut back.
- The kinds Zhiyin names, and the bytes after each signature, are as the
  formats' own specifications give them. Readers accept a PDF whose header
  starts later than byte 0.
- On NTFS a rename within one folder replaces the target in one step. Flushing
  the new file before the rename keeps its contents through a power cut;
  Windows offers no flush of a folder, so the rename itself is not flushed.
- Windows replaces a file that is open with `FILE_SHARE_DELETE` when asked
  with `FILE_RENAME_POSIX_SEMANTICS` and `FILE_RENAME_REPLACE_IF_EXISTS`
  (available since Windows 10 1607; checked 2026-10-19 on Windows 11 22631
  with NTFS). Node opens files that way, as do most readers. A program that
  keeps a file open for writing goes on writing into the old file once it is
  replaced; Zhiyin's own stores write one at a time, and an editor doing this
  while the agent writes the file is rare enough to accept.
- Paths are handed to Windows in their long form (`\\?\`). Two seconds covers
  a program that holds a file for a moment; one that keeps it longer, as a PDF
  viewer may, is reported as such by the store.
- Only `compare_pictures` compares pictures, and the comparison needs nothing
  from the operating system.
- The searches and the listing choose files by the same rules, so a copy taken
  before a command and the changes found after it see the same files.
