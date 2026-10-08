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
  the group does not answer for it. The one listed is the browser panel a
  person drives themselves.
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
- There are five projects. `pnpm test` runs `packages`, `desktop`,
  `repository` (checks over the repository as a whole, such as the lint rules)
  and `system-boundary`. `installed` starts the built app in Electron through
  Playwright, with its own data folder, so it runs after the build as its own
  gate step. Whatever is only true of a real launch is tested there: the
  preload bridge, a second copy of the app, a folder moved while the app was
  closed, history that will not open, a page drawn in the drawing process. It
  runs in every gate, not only before a release.
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
- **Process containment is tested against real processes** (ADR 0004): a
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
  usage, timings and retries (ADR 0011). The window shows these, and the saved
  conversation keeps them.
- Corrections answered to the model alone are written to the audit log
  (ADR 0014).
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
bundled libraries (React, the Markdown renderer) are `devDependencies` of the
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
build and the installed-app suite. `-Full` adds packaging; a check that the
packaged executable's Electron fuses refuse `ELECTRON_RUN_AS_NODE` and
`--inspect` (ADR 0001); a check that the packaged app holds every spelling
dictionary unchanged; and the installed documents test run against the packed
`app.asar` (named by `ZHIYIN_APP_ARCHIVE`), so a packaging change that stops
document drawing fails it. Packaging is slow, so it sits behind the flag and
runs before a release.

The pre-commit hook and the CI workflow both call the script rather than
restating its checks, so they cannot drift apart. CI runs on Windows for pull
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
dependencies (the credential binding of ADR 0019, koffi, Playwright) stay
outside the JavaScript bundle and load from the packaged app's
`node_modules`. electron-builder unpacks their native binaries from the
archive, and the bundled ripgrep is unpacked so it can be started.

Building the desktop app first fetches the spelling dictionaries listed in
`packages/spelling/dictionaries.json` into `apps/desktop/dictionaries`, which
git ignores. They come from the server Chromium itself downloads them from, and
each is kept only if its SHA-256 matches the list (ADR 0023). A first build,
and every CI run, needs that server; later local builds find the files in
place.

## Theme and style checks

ESLint does not read CSS, so two checks stand where lint rules would.

The theme check (`scripts/check-theme.mjs`, a gate step) holds the renderer's
stylesheets to the theme. Every colour comes from the theme blocks: the dark
`:root` block and the light one under `prefers-color-scheme: light`. Both
blocks define the same tokens, and every token a rule uses is defined. No text
is set under 12 px, and every text colour reaches 4.5:1 contrast on every
ground of its theme. A literal colour goes unnoticed until the theme changes,
and an undefined token paints nothing; a DOM test catches neither. The demo
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

Under `pnpm dev`, the app's workspace tools are bound to the repository root,
and a `ZHIYIN_WORKSPACE` environment variable overrides that root for focused
testing. An installed app works in the folder a person chooses and returns to
it on the next launch; it does not fall back to its launch directory.
