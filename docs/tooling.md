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
  src/renderer/        #   the window, in independently bounded modules
  installed/           #   tests against the built application
  system-boundary/     #   tests against real browsers and Windows file behavior
packages/              # one package per feature, platform mechanism or group
docs/  scripts/
```

Every package has a document in `docs/architecture/features/`, and every
document there has a package; one without the other is a defect in one of
them. The contract is documented there too: it is shared vocabulary rather than
a feature, and every package depends on it. The renderer is documented in
`docs/architecture/renderer/` as a set of modules.

The main process holds wiring only. It may say which implementation a feature
uses, never what that implementation does.

## Feature boundaries are enforced by lint

TypeScript has no private module boundary, so the rules the architecture
depends on (ADR 0002) live in `eslint.config.js` and run in the gate.

- Every package declares a layer (contract, platform, feature, group, loop,
  core) and imports only the layers below it. A feature imports
  `@zhiyin/contract` and platform mechanisms, never another feature; a group
  imports only its own members. Above the feature layer only types may be
  imported, so no orchestrator constructs an implementation. A package with no
  declared layer stops lint.
- A feature's tests are held to the feature's rule, so the feature is testable
  with nothing else present. An orchestrator's tests may use real
  implementations; that is what an integration test is for.
- Above the group layer, a group's members are reached through the group. A
  direct import is refused unless the configuration lists it with the reason
  the group does not answer for it. The two listed are the browser panel and
  the 3D view, which a person drives themselves.
- No package deep-imports another's internals: a package's entry point is its
  public interface. Its `index.ts` only re-exports, so the entry point is the
  list of what the package offers.
- A workspace package is named by a static import. The layer rules read import
  declarations, so a dynamic import, a type named inline or a runtime require
  of a workspace package is refused.
- The renderer imports no backend package and no Electron; everything it does
  goes through the preload bridge. Inside it, each folder under `ui` is a module
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
- A test that needs a tool, a browser or a key the machine lacks skips itself.
  After `pnpm test` and `pnpm test:installed`, the run names every file with
  tests that did not run, how many, and what they need. A file may skip only
  where the reporter's list expects it to: a skip in any other file, or one
  where what the file needs is present, fails the run.
- With `ZHIYIN_TEST_TOOLS` naming a folder, the run first installs Typst,
  Tectonic and uv there from their pinned downloads, verified as the app
  verifies them, fetching again a kept download that fails that, and downloads
  Blender's archive for the test that installs it, so the tests that need them
  run. CI sets it, so there those tests may not skip. No Blender is installed
  for the tests that run scenes in one: they need a graphics card, which CI's
  machine lacks, and run where `ZHIYIN_BLENDER` names a Blender on a PC that
  has one.
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
  usage, timings and retries (ADR 0016). The window shows these, and the saved
  conversation keeps them.
- Corrections answered to the model alone are written to the audit log
  (ADR 0010).
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

`scripts/gate.ps1` is the single definition of "green". It runs ESLint, the
theme check, knip, `pnpm audit`, Prettier, the typecheck, the test suite, the
build and the installed-app suite, which is not run when the build failed:
there would be no app to start. `-Full` adds packaging; a check that the
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
on request; the release workflow runs it on a release tag.

The pre-commit hook and the CI workflow both call the script rather than
restating its checks, so they cannot drift apart. The CI job keeps temporary
files on the runner's work disk: a fresh machine's system disk is busy with
Windows' own work for its first minutes, and browsers and app copies started
from a profile there were measured waiting on it. CI runs on Windows for pull
requests, pushes to `main`, and weekly. Pull requests receive no provider
credentials; live provider behavior is checked separately.

## Releases and packaging

Releases are developer-preview alpha tags. The release workflow accepts only a
tag of the form `v0.1.0-alpha.1` that matches the desktop package version,
runs the full gate, hashes the installer, publishes the checksum in
`SHA256SUMS.txt` and in the release notes, attests build provenance when the
repository is public, and marks the GitHub release as a prerelease. The
installer is not code-signed yet and has no automatic updates; each needs its
own decision record before it is added.

`electron-builder` produces the Windows installer. Native and runtime-loaded
dependencies (the credential binding of ADR 0027, koffi, Playwright) stay
outside the JavaScript bundle and load from the packaged app's
`node_modules`. electron-builder unpacks their native binaries from the
archive, and the bundled ripgrep is unpacked so it can be started. A library
only the window uses, such as Mermaid, is a `devDependency`: Vite bundles it
into the window's script, and the packager copies only `dependencies` into the
app. Source maps are left out of the package.

The build writes `THIRD_PARTY_NOTICES.txt` beside each bundled part of the app,
with the name, version and licence text of every npm package whose code that
part carries, since a bundle drops the folders those licences came in.

Building the desktop app first fetches the spelling dictionaries listed in
`packages/spelling/dictionaries.json` into `apps/desktop/dictionaries`, which
git ignores. They come from the server Chromium itself downloads them from, and
each is kept only if its SHA-256 matches the list (ADR 0030). A first build,
and every CI run, needs that server; later local builds find the files in
place. A file the server fails to send is asked for up to four times in all.
It then fetches the font documents are drawn with for characters their own
fonts lack, named in `apps/desktop/fonts.json`, from a pinned commit of the
font's GitHub repository into `apps/desktop/fonts`, which git also ignores. It
is kept the same way, only if its SHA-256 matches, and packed in the app's
archive (ADR 0024).

## Model list

The labs' models and prices live in one file,
`packages/model-client/model-list/models.json`, with its signature beside it
in `models.json.sig` (ADR 0031). Each release ships the file as it is on
`main`. Installed apps also read it from `main`, at
`https://raw.githubusercontent.com/ZhiyinAgent/Zhiyin/main/packages/model-client/model-list/`,
when they start and each time the Model page opens, and take it only if a key
they ship signed it and its version is higher than theirs. Git keeps both
files byte for byte (`.gitattributes`), since the signature covers the exact
bytes.

### Updating it

1. On a branch, change the entries of the labs concerned. Check each value
   against the lab's own pages, set that lab's `checked` to today and name
   the pages in its `sources`.
2. Run `pnpm format` and the gate. The model client's tests read the file
   the way an installed app does, so a value the format refuses fails there,
   with the field it is in.
3. Run `pnpm model-list:sign <path to the primary key>` in a terminal: it
   asks for the key's passphrase. It fetches `main` from GitHub; if the
   list's `version` is not above the last signed one there, it raises it by
   one and sets `published` to today, changing nothing else in the file. It
   then writes `models.json.sig`. Sign last: any change to the file
   afterwards, even of a space, needs signing again.
4. Open a pull request with both files. The gate checks that the signature
   verifies against a key in `packages/model-client/src/model-list-keys.ts`.
   Merge it as any change to `main`; squash and rebase both keep the file's
   bytes.

A list on `main` with no signature beside it was never taken by any app, so
signing counts only signed lists: the first signed list can be version 1.

Installed apps take it the next time they start or someone opens the Model
page. Raw files on GitHub may be cached for a few minutes.

A model whose requests need something the app does not yet send, such as a
new reasoning setting, cannot be added this way: it needs a release.

### The keys

`pnpm model-list:keys <folder>` makes the primary and the backup key, each an
Ed25519 key in a passphrase-encrypted PKCS#8 file named after its id, in a
folder outside the repository, and prints the public halves to paste into
`model-list-keys.ts`. Keep the folder off GitHub and out of anything synced
with it; keep the backup key, and a record of the passphrase, somewhere apart
from the primary, so losing one place loses neither. Anything that can read a
key file and its passphrase can sign a list every installed app will take.

Until `model-list-keys.ts` holds a key, the test that checks the shipped
list's signature skips. The everyday gate allows that; the full gate
(`-Full`), which runs before a release, fails on it, so no release ships an
app that would refuse every newer list.

If the primary key is lost or may have been seen, sign the next list with the
backup key, replace the primary's entry in `model-list-keys.ts` with a new
key in the next release, and stop using the old one. Installed apps keep
trusting every key they shipped with until they are updated, so a key that
may have leaked stays a risk for the versions that ship it.

### A new format

`format` is 1. Anything an app of this format would refuse, such as a new
field or a new value for an existing one, needs a new format: the release
that reads it publishes the list at a new address (`model-list/v2/`, say),
and the format 1 file stays where it is, updated alongside it while
releases that read it are in use. Each file then reads the same in every
version that reads it.

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

In a build that is not installed, a `ZHIYIN_WORKSPACE` environment variable
names the folder a conversation starts in when the history names none, for
focused testing; under `pnpm dev` without it, that is the repository root. An
installed app ignores it and starts each conversation in the folder a person
chooses, returning to it on the next launch; it does not fall back to its
launch directory. A folder named this way
is not one the person chose: it is not saved as the folder shown or offered
among the recent ones until it is chosen.
