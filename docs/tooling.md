# Tooling

The toolchain, lint, tests, observability, supply chain, gate and packaging.
Each choice comes with its reason; when a reason stops being true, change the
choice.

## Workspace layout

```
apps/desktop/          # Electron: main process, preload bridge, drawing process, renderer
  src/main/            #   composition root and IPC wiring only
  src/preload/         #   the bridge, and nothing else
  src/drawing/         #   the contained document-drawing process
  src/comparing/       #   the main process's thread that compares pictures' pixels
  src/renderer/        #   the window, in independently bounded modules
  installed/           #   tests against the built application
  system-boundary/     #   tests against real browsers and Windows file behavior
packages/              # one package per feature, pure computation, platform mechanism, group or test helper
docs/  scripts/
```

Every package has a document in `docs/architecture/features/`, and every
document there has a package; one without the other is a defect in one of
them. The contract is documented there too: it is shared vocabulary rather than
a feature, and every package depends on it. The renderer is documented in
`docs/architecture/renderer/` as a set of modules.

The main process holds wiring only. It may say which implementation a feature
uses, never what that implementation does.

Scripts run on plain Node import workspace packages as their TypeScript
source, and Node only strips types: it refuses syntax that compiles to code,
such as constructor parameter properties or enums. The typecheck holds every
package to `erasableSyntaxOnly`, and a test loads what `pnpm release:publish`
imports in a separate Node process with no flags.

## Feature boundaries are enforced by lint

TypeScript has no private module boundary, so the rules the architecture
depends on (ADR 0002) live in `eslint.config.js` and run in the gate.

- Every package sits in the folder of its layer, `packages/<layer>/<name>`
  (contract, pure, platform, feature, group, loop, core, and test-helper
  beside them), and imports only the layers below it (ADR 0002). A pure
  package imports only the contract and other pure packages, and every layer
  above the contract may import it whole (ADR 0002). A feature imports
  `@zhiyin/contract`, pure packages and platform mechanisms, never another
  feature; a group imports only its own members and pure packages. Above the
  feature layer only types may be imported, pure packages aside, so no
  orchestrator constructs an implementation. A folder under `packages` that
  is not a layer stops lint. The rules read every kind of TypeScript file:
  `.ts`, `.tsx`, `.mts` and `.cts`.
- The contract and the pure packages run wherever they are imported, the
  window included: their source imports no Node module, by `node:` or its
  bare name, and no npm package, by a static or dynamic import, an inline
  type or a `require`. Their tests may use the test runner and Node.
- Test helpers (the test-support package: temporary folders, waits, file
  holds) sit in a layer of their own beside the others (ADR 0002). Any package's tests, and the code
  that runs only for tests, may import them; nothing the app runs may, the
  composition root included. A test helper imports only the contract.
- A package's fakes are its own, in its `test` folder, published as
  `@zhiyin/<name>/testing` (ADR 0002). Only test code imports one, and only
  where it may import the package itself; nothing the app runs may, the
  composition root, the window and the drawing process included.
- A feature's tests are held to the feature's rule, so the feature is testable
  with nothing else present, and so are the contract's and a pure package's.
  An orchestrator's tests may use real implementations; that is what an
  integration test is for. They still reach only what their layer reaches, so
  the fakes a group or the loop composes keep to it.
- Above the group layer, a group's members are reached through the group. A
  direct import is refused unless the configuration lists it with the reason
  the group does not answer for it. The two listed are the browser panel and
  the 3D view, which a person drives themselves. Some members are served
  through the contract: the composition root hands the group what they offer,
  so the group imports nothing of theirs, and the configuration says why for
  each.
- No package deep-imports another's internals: a package's entry point is its
  public interface. Its `index.ts` only re-exports, so the entry point is the
  list of what the package offers.
- A workspace package is named by a static import. The layer rules read import
  declarations, so a dynamic import, a type named inline or a runtime require
  of a workspace package is refused.
- The renderer imports no backend package and no Electron, only the contract
  and pure packages; everything it does goes through the preload bridge.
  Inside it, each folder under `ui` is a module
  used only through its `index.ts`. Modules do not import each other or the app
  shell, and shared presentation imports neither. Every other renderer folder
  that holds code is held to the same entry points. Both lists are read from
  the folders, so a new folder is covered without editing the config.
- Outside the composition root, the main process and the bridge import no
  workspace package but the contract. The window and the main process or bridge
  do not import each other's code. The drawing process imports, of the
  workspace packages, only the document viewer, and nothing from the window,
  the main process or the bridge.
- A test makes its temporary folders with `TemporaryFolders`, which removes
  them, so no run leaves folders behind: test code imports file functions by
  name, never `mkdtemp`, the whole module or its `promises`. A dynamic
  `import()` is not checked.
- Imports do not form cycles. A cycle means two files each need the other to be
  understood; move the shared piece out.
- Files split where their responsibilities part, not at a line count. A
  backstop of 1,000 lines of code (comments and blank lines are not counted)
  covers every package, the main, preload and drawing processes, and the
  renderer's modules and demo stage. Reaching it is a prompt to review what the
  file is responsible for, and the lint message says so. A file that does one
  job may have its ceiling raised in the lint configuration, beside its path,
  with a reason naming that job; the configuration refuses a raise without a
  reason or below the backstop.
- Contract files are held to 300 lines, one file per concept. Everything
  imports the contract, so a change to a shared file touches every dependent;
  small files keep that readable. The same raise with a reason applies.
- `knip` fails the gate on a file nothing reaches, a dependency nothing
  imports, or an export nothing imports. Dependencies loaded by name at run
  time, such as native modules, are listed in the `knip` section of
  `package.json`.

A lint rule is weaker than a compiler and can be silenced with a comment. The
repository's tests lint imports that must be refused, so a boundary rule that
stops working fails the gate. The path rules rely on the resolver's extension
alias: source imports name the `.js` file TypeScript emits, and without the
alias a rule cannot find the `.ts` file behind the name and reports nothing.

## Python is linted by Ruff and tested by pytest

The app ships two Python harnesses as source: the script Blender runs for the
3D studio, and the one the CAD studio's Python runs. They run only inside
Blender and the CAD environment, so TypeScript's checks never read them, and
a misspelled name in one fails only when a person's command reaches it. The
Python environment's startup file, which every environment runs as it starts
so Python's library works in the container, is a `.py` file too, bundled
into the app as text and written into each environment. The
gate's `ruff` step (`pnpm lint:python`) runs Ruff over every Python file in
the repository, with the rules `ruff.toml` chooses: names that are undefined,
unused or defined twice, syntax errors, bare excepts, mutable default
arguments and Bugbear's other likely bugs, and imports grouped and sorted as
`ruff check --fix` writes them. Each rule left out is listed there with the
reason.

`ruff.toml` pins one Ruff release, which the script reads and runs through
uv: uv fetches that release from the Python Package Index once and keeps it.
The uv is the one `ZHIYIN_UV` names, or else the release the app pins,
installed and verified as the tests install it, into `ZHIYIN_TEST_TOOLS`
when that names a folder and otherwise into `node_modules/.cache`. uv runs
Ruff in an environment of its own, so it needs a Python: the one on the PATH,
or one uv downloads. To move to a newer Ruff, change `required-version` and
fix what the new release reports.

Each harness is a package beside its start script, which puts the script's
folder first on Python's path; a module added to either package is imported
by its package name, needs nothing registered, and ships with the app, which
copies every `.py` file of both folders.

The harnesses' code that needs neither Blender nor the CAD environment, such
as the binary USD and USD package readers, the ISO 286 fits and the strength
calculations, has plain pytest tests in each studio package's `test/python`
folder, outside the folders the app ships. The gate's `python tests` step
(`pnpm test:python`) runs them through the same uv, with the pytest release
`scripts/python-tests.mjs` pins, on Python 3.13, the version Blender and the
CAD environment run the harnesses on; it writes no compiled files beside
them. A module these tests load may import Blender's own modules: the 3D
studio's tests stand in empty ones that refuse every name, so code that
reaches Blender fails its test. The rest of the harnesses runs only in the
real-engine tests below.

## Errors

An error a caller is expected to handle is part of the interface, so an error
that crosses a feature boundary is typed: a discriminated union or a named
error class, not a bare `Error` with a message to match on. Errors at system
boundaries (user input, provider responses, subprocesses) are handled where
they occur and translated into that typed shape.

## Testing

What to test is in `docs/testing-philosophy.md`. Mechanically:

- Vitest runs everything. Package tests run in Node; only the renderer pays for
  a DOM.
- There are seven projects. `pnpm test` runs `packages`, `desktop`,
  `repository` (checks over the repository as a whole, such as the lint rules)
  and `system-boundary`. `installed` starts the built app in Electron through
  Playwright, with its own data folder, so it runs after the build as its own
  gate step. Whatever is only true of a real launch is tested there: the
  preload bridge, a second copy of the app, a folder moved while the app was
  closed, history that will not open, a page drawn in the drawing process. It
  runs in every gate, not only before a release. `live` holds the tests that
  call a provider's real API (files named `live*.test.ts` or `*.live.test.ts`)
  and runs only through `pnpm test:live`, so no other run spends credit;
  `installed-live` holds the installed app's own (`*.live.test.ts` there) and
  runs only through `pnpm test:live:installed`, after a build.
- With `ZHIYIN_TEST_WINDOWS=aside`, the installed app's windows open on a
  screen other than the main one and take no focus, so the suite and the gate
  can run beside someone working. With one screen, they open where they would,
  still without focus.
- With `ZHIYIN_TEST_NO_GRAPHICS_CARD=1`, an app that is not installed starts
  every Blender as on a PC whose graphics card cannot draw: a picture drawn on
  the card ends that Blender, so the 3D studio finds out, as it would there,
  and draws with Cycles on the processor.
- A test that needs a tool, a browser or a key the machine lacks skips itself.
  After `pnpm test` and `pnpm test:installed`, the run names every file with
  tests that did not run, how many, and what they need. A file may skip only
  where the reporter's list expects it to: a skip in any other file, or one
  where what the file needs is present, fails the run.
- The gate builds Zhiyin's shell, busybox-w32 and the git hand-off, from its
  pins before the tests when the build is not in place, keeping its downloads
  in `ZHIYIN_TEST_TOOLS` or else `node_modules/.cache/zhiyin-tools`. The run
  names it in `ZHIYIN_BUSYBOX` when the pinned build is there, so the tests of
  sealed-off commands run on real app containers; in CI they may not skip.
- With `ZHIYIN_TEST_TOOLS` naming a folder, the run first installs Typst,
  Tectonic, uv and Node there from their pinned downloads, verified as the app
  verifies them, fetching again a kept download that fails that, and downloads
  Blender's archive for the test that installs it, so the tests that need them
  run. CI sets it, so there those tests may not skip. No Blender is installed
  for the tests that run scenes in one: the gate has no graphics card, and
  they run where `ZHIYIN_BLENDER` names a Blender. A separate CI job, beside
  the gate, installs the pinned Blender and runs the files that ask for no
  picture on its machine, where the session draws on the processor; the files
  that render run on a PC with a graphics card.
- The tests that need a real Blender or the CAD environment, those the
  skip list says need `ZHIYIN_BLENDER` or `ZHIYIN_CAD_PYTHON`, are recorded
  in `scripts/real-engine-record.json` each time one runs, however it is
  started: for each file, the commit, a fingerprint of the files such a run
  loads as that commit holds them, the Blender and build123d it ran with,
  and how many of its tests passed, failed and were skipped. A run writes
  only from a working tree with no change but the record, so the commit names
  the code that ran, and a file whose tests all skipped keeps its entry. The
  record is committed, and the release gate reads it: a run whose fingerprint
  is the commit's own ran on the same code, even when a rebased merge renamed
  its commit.
- `system-boundary` tests drive real browsers, Windows processes and file
  replacement. They run one file at a time, after the parallel projects, so
  shared machine resources do not skew them. Each scope has its own test
  directory, so adding a boundary test needs no exclusion list.
- **Permission engine:** the adversarial corpus is a table of actions and
  expected decisions, each with its reason, run through one loop. A newly
  found bypass is one more entry.
- **Enforcement is tested apart from decisions.** That the engine *decides*
  correctly and that a caller *cannot bypass* it are two claims needing two
  tests; only the second validates the trust boundary.
- **Process containment is tested against real processes** (ADR 0005): a
  process that starts a detached child, a tree whose owner is killed outright,
  a process that commits more memory than its limit. These run with the rest of
  the suite; a fake cannot show that a process ended.
- **The agent loop is composed from interfaces.** Sequencing tests use fakes;
  permission-enforcement tests add a real temporary-folder sentinel, so a
  denial is shown by the effect not happening. If constructing the loop needs a
  filesystem, a subprocess or a network connection, something concrete has
  leaked into what should be an interface.
- **Renderer:** pure functions get plain-data tests; component tests render
  production components and find elements by role, label or text.

## Observability

What the app did is recorded as structured data a person can inspect, not
reconstructed from logs:

- Each conversation keeps its actions, with their inputs, approval, outcome
  and timings, and each model response, with the upstream that served it,
  usage, timings and retries (ADR 0015). The window shows these, and the saved
  conversation keeps them.
- Corrections answered to the model alone are written to the corrections log
  (ADR 0009).
- The main process writes a diagnostic log on this computer, one JSON line per
  event, kept for two weeks.
- `AppEvent` in the contract is everything the core tells the window; the
  window's state is built from it alone (ADR 0003).

## The core and renderer contract

Everything that crosses between the core and the window is in the `contract`
package: the API the preload bridge exposes, and one `AppEvent` union for
everything the core can say. Both sides are TypeScript and import it directly;
there is no code generation and nothing to keep in sync.

## Keeping docs true

Feature docs state invariants and boundaries in the present tense, without file
paths, line numbers or test names. Each invariant is covered by a test, so
breaking it fails the gate. When an invariant changes, the doc and its test
change together.

## Supply chain

pnpm's strict resolution surfaces phantom dependencies that npm and yarn let
through.

The gate fails on any published advisory, at any severity, in any dependency:
`pnpm audit`, not `pnpm audit --prod`. Electron's runtime and the renderer's
bundled libraries (React, the Markdown renderer, Mermaid) are `devDependencies` of the
desktop app yet ship in the installer, so a production-only audit would miss
them. CI also runs the gate weekly, so an advisory published while nobody
commits still turns it red.

With pnpm 11.25.0, when an advisory names a transitive package whose parents
already accept the patched version, `pnpm update --depth Infinity <name>` and
`pnpm audit --fix update` can leave the old version in the lockfile;
Dependabot's security updates do the same. To move it, add an `overrides`
entry for the vulnerable range in `pnpm-workspace.yaml`, run `pnpm install`,
remove the entry, and run `pnpm install` again. The lockfile keeps the patched
version because it satisfies the parents' ranges. Keep an override only where a
parent's range excludes the fix, with a comment naming the advisory.

An advisory with no fix yet is excepted under `auditConfig.ignoreGhsas` in
`pnpm-workspace.yaml`, with a comment saying why it does not apply or what it
waits on. `pnpm audit --ignore <GHSA id>` writes the same entry, so the gate
runs plain `pnpm audit` and each exception has one home.

## The gate and CI

`scripts/gate.ps1` is the single definition of "green". It runs ESLint, Ruff,
the theme check, knip, `pnpm audit`, Prettier, the typecheck, a check that every
test needing a program is listed where it may skip, the test suite, the
harnesses' Python tests, the build and the installed-app suite, which is not run when the build failed: there
would be no app to start. The checks that read the source come first, and when
one fails the tests, build and installed app are not run, since they take most
of the time and could not make the run green. `-Quick` runs only those first
checks, in about two minutes, to run before a commit whose hook runs the rest. `-Full` adds packaging; a check that the
packaged executable's Electron fuses refuse `ELECTRON_RUN_AS_NODE`,
`NODE_OPTIONS` and `--inspect` (ADRs 0001 and 0004), give a page loaded from `file:`
nothing beyond what a
browser gives one, load the app only from its archive and check the
archive against the hash in the executable; the packaged executable itself,
started on a saved conversation and read from outside through UI Automation
(`ZHIYIN_PACKAGED_APP` names it), which must show that conversation and must
refuse to start with Chromium's debugging switches; a check
that the packaged app holds every spelling dictionary unchanged; and the
installed documents test run against the packed
`app.asar` (named by `ZHIYIN_APP_ARCHIVE`), so a packaging change that stops
document drawing, or drops the font it falls back on, fails it. Packaging is slow, so it sits behind the flag. The
packaging workflow runs it on GitHub when how the package is made changes, and
on request.

`-Release` is `-Full` for a release, and the release workflow runs it on a
release tag. Among the first checks it reads the record of the real-engine
tests and fails unless every file the skip list says needs a real Blender or
the CAD environment ran whole, with nothing failed or skipped, with the
Blender the app installs and the build123d the CAD environment's lock pins,
on a commit since which nothing such a run loads has changed. What a run
loads is followed from those test files through their imports, relative and
of the workspace's packages, with the runner's configuration and setup. A
change counts when it is to any file of a package reached that way, whole
package folders because the Python scripts and pins a package reads while it
runs are not imported; to a file reached outside the packages; or to the
workspace's manifest, lock, package list, compiler settings or
`.gitattributes`. A change to docs, workflows, another script or a package
those tests do not load needs no new run; the check names each change that
does. The files that
render, and the CAD suites, run only on a PC with a graphics card before a
release; the record is what shows they ran on the code released. CI's Blender
job covers about two thirds of the Blender files without one, in three parts
of about 25 minutes each: on its machine they take about three times as long
as on a PC with a graphics card (measured 2026-11-14).

The pre-commit hook and the CI workflow both call the script rather than
restating its checks, so they cannot drift apart. A change to documentation
alone, the root READMEs and changelog, `docs/`, and `.github`'s Markdown,
issue templates and pictures, needs only `-Docs`: the source checks and the
repository tests, which hold the decision records and the overview to the
code. Both read what the change touches the same way, the hook from what is
staged and CI from the files changed against the pull request's base or the
commit `main` moved on from, and run the whole gate for anything else, or when
that cannot be read. Markdown inside a package is read by the app or its
tests, and the third-party licences ship in the installer, so a change to
either runs the whole gate. CI's Blender job does not run for documentation
alone. The CI job keeps temporary
files on the runner's work disk: a fresh machine's system disk is busy with
Windows' own work for its first minutes, and browsers and app copies started
from a profile there were measured waiting on it. CI runs on Windows for pull
requests, pushes to `main`, and weekly. Pull requests receive no provider
credentials; live provider behavior is checked separately.

## Packaging

How a release is published, and the keys, model list and mirrors the
maintainers keep, are in the [maintainers' guide](maintainers.md).

`electron-builder` produces the Windows installer. Native and runtime-loaded
dependencies (electron-updater, the credential binding of ADR 0025, koffi,
Playwright) stay
outside the JavaScript bundle and load from the packaged app's
`node_modules`. electron-builder unpacks their native binaries from the
archive, and the bundled ripgrep is unpacked so it can be started. A library
only the window uses, such as Mermaid, is a `devDependency`: Vite bundles it
into the window's script, and the packager copies only `dependencies` into the
app. Source maps are left out of the package.

The build writes `THIRD_PARTY_NOTICES.txt` beside each bundled part of the app,
with the name, version and licence text of every npm package whose code that
part carries, since a bundle drops the folders those licences came in.

A build of the main process, the preload bridge or the window fails, naming
the file, when its bundle takes in test code as lint defines it or any
package's `testing` entry (ADR 0002). The everyday gate builds the app, so it
holds every commit to this; packaging builds it the same way.

Building the desktop app first fetches the spelling dictionaries listed in
`packages/feature/spelling/dictionaries.json` into `apps/desktop/dictionaries`, which
git ignores. They come from the server Chromium itself downloads them from, and
each is kept only if its SHA-256 matches the list (ADR 0027). A first build,
and every CI run, needs that server; later local builds find the files in
place. A file the server fails to send is asked for up to four times in all.
It then fetches the font documents are drawn with for characters their own
fonts lack, named in `apps/desktop/fonts.json`, from a pinned commit of the
font's GitHub repository into `apps/desktop/fonts`, which git also ignores. It
is kept the same way, only if its SHA-256 matches, and packed in the app's
archive (ADR 0019).

## Theme and style checks

ESLint does not read CSS, so two checks stand where lint rules would.

The theme check (`scripts/check-theme.mjs`, a gate step) holds the renderer's
stylesheets to the theme. Every colour comes from the theme blocks: the dark
`:root` block and the light one under `prefers-color-scheme: light`. Both
blocks define the same tokens, and every token a rule uses is defined. No text
is set under 12 px: a size in px or rem is measured, and one relative to its
parent is written as `max(12px, …)` so it holds the floor itself. Every text
colour reaches 4.5:1 contrast on every ground of its theme, and every chart
mark colour 3:1; a numbered series (`.model-key--3`) is drawn only in one of
those colours. No stylesheet reads an attribute's value, as a tooltip of
its own would: hover tips are the shared one. A literal colour goes unnoticed
until the theme changes, and an undefined token paints nothing; a DOM test
catches neither. The demo
stage, the frame drawn around the app for review, is excluded.

A repository test holds style ownership. Each renderer module's styles are a
CSS Module beside its components, and the global stylesheets define only the
theme, the reset and the shared basics (buttons, text buttons, eyebrow and
instrument labels). A module that needs another's look uses that module's
component or one of its options, never its class names. The test fails when a
global stylesheet defines any other class, when a module stylesheet names a
class it does not own, when a component writes a class name as plain text
other than a shared basic, and when a component looks up a class its own
stylesheet does not define, which is `undefined` at run time and leaves the
element unstyled. DOM tests keep a module's class names as written; the built
app does not, so tests find elements by role, label or text.

## Platform and development workspace

Windows only (ADR 0001); nothing runs against macOS or Linux.

`pnpm dev` keeps its data in a folder of its own, Zhiyin Development, beside
the installed app's: it opens neither the person's history nor an installed
Zhiyin that is running, and its keys are the same ones.

In a build that is not installed, a `ZHIYIN_TEST_WORKSPACE` environment variable
names the folder a conversation starts in when the history names none, for
focused testing; under `pnpm dev` without it, that is the repository root. An
installed app ignores it and starts each conversation in the folder a person
chooses, returning to it on the next launch; it does not fall back to its
launch directory. A folder named this way
is not one the person chose: it is not saved as the folder shown or offered
among the recent ones until it is chosen.
