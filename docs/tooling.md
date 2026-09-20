# Tooling

Toolchain, lint, test, observability, packaging. Every choice here has
a reason attached; if a reason stops being true, change the choice
rather than keeping it out of habit.

## Workspace layout

```
apps/desktop/          # Electron: main process, preload bridge, renderer
  src/main/            #   composition root + IPC wiring ONLY, no logic
  src/preload/         #   the bridge, and nothing else
  src/renderer/        #   independently bounded renderer modules
packages/
  contract/            # What crosses to the renderer. Types, no behaviour.
  agent-loop/  permission-engine/  tools/  mcp/  skills/
  subagents/  usage/  session/  model-client/  interactive-browser/
docs/  scripts/
```

One package per feature, and `docs/architecture/features/` is the list —
a feature package here without a feature doc there, or the reverse, is a
defect in one of the two. The contract has a boundary document because every
package depends on its shared vocabulary, though it remains data rather than a
feature. The renderer is documented separately as a set of enforced modules
rather than as a package of its own.

The main process holds wiring only. It may say which implementation a
feature uses; it may never say what that implementation does. Logic
accumulating there is the god-class failure arriving by the back door.

## Feature boundaries are enforced by lint

TypeScript has no private module boundary, so the rules the architecture
depends on live in `eslint.config.js` and run in the gate:

- Every package declares a layer — contract, platform, feature, group, loop,
  core —
  and imports only the layers below it. A feature imports
  `@zhiyin/contract` and platform mechanisms, never another feature; a group
  imports its own members.
  Above the feature layer only types may be imported, so no orchestrator
  constructs an implementation. A package with no declared layer stops
  lint rather than escaping it (ADR 0034).
- Above the group layer, a group's member is reached through its group. A
  direct import is refused unless it is listed with the reason the group
  does not answer for it — today, the browser panel a person watches
  themselves (ADR 0037).
- Nothing may deep-import another package's internals. A package's entry
  point is its public interface.
- A workspace package is named by a static import. A dynamic import, a type
  named inline, or a name handed to a runtime require reaches past the layer
  rules, which read import declarations, and reports nothing.
- The renderer may not import backend packages or Electron. Everything
  it can do arrives through the preload bridge.
- Inside the renderer, each folder under `ui` is a module used only through
  its `index.ts`. Modules do not import each other or the app shell, and
  shared presentation imports neither. Every other folder of the renderer that
  holds code is held to those same entry points. Both lists are read from the
  folders, so a new one is guarded without editing the config.
- The window, the main process and the bridge do not import one another's
  code. The window reaches the core through the bridge; what the window is
  made of is none of the other two's business.
- A file in an orchestration layer — the agent loop, the core, the groups,
  the main process and preload, the renderer's app shell — may hold at most
  600 lines of code, comments and blank lines not counted. Those layers are
  where a god class grows back. A file already past the limit may be pinned at
  an explicit lint ceiling. Raising that ceiling deliberately is legitimate
  when the commit records why; the ratchet stops growth nobody decided on.

This is weaker than a compiler and can be silenced with a comment — see
ADR 0001's consequences. Because a lint rule that silently stops working
is worse than none, the rules are checked by deliberately violating them
when they change.

That is not hypothetical. The path rules need to find the file behind an
import, and source imports name the `.js` file TypeScript emits rather than
the `.ts` file on disk. Until a resolver with that extension alias was
configured, the rule against climbing into a sibling package resolved nothing
and therefore reported nothing — silently, since an unresolved import is
allowed. It was found on 2026-09-11 by linting an import that had to fail.

## Error handling convention

Errors crossing a feature boundary are typed — a discriminated union or
a named error class, never a bare `Error` with a string. This keeps
errors part of the interface, the same as any other part of it. Errors
at system boundaries (user input, provider responses, subprocesses) are
handled where they occur and translated into that typed shape.

## Testing

See `docs/testing-philosophy.md` for what to test. Mechanically:

- Vitest for everything, one runner for the workspace. Package tests run
  in a Node environment; only the renderer pays for a DOM.
- **Five projects.** `packages`, `desktop`, `repository`, and
  `system-boundary` are the suite that `pnpm test` runs. `installed` starts the built app in Electron through
  Playwright, against its own data folder, and so runs after `build` as
  its own gate step. It is where anything that is only true of a real
  launch belongs: the preload bridge, a second copy of the app, a folder
  that moved while the app was closed, history that will not open. It is
  not optional and not release-only - an installed-app contract that runs
  only before a release is a contract nobody checks.
- **Permission engine:** the adversarial corpus is a data-driven table
  of `{input, expected decision}` run through one test loop, so adding a
  newly-discovered bypass is a one-line diff. Plus property-based tests
  over the command parser asserting invariants hold under randomized
  input (a blocked pattern is never approved regardless of surrounding
  chaff) — the fixed corpus covers what we thought of, the property test
  covers what we didn't.
- **Test enforcement separately from decisions.** That the engine
  *decides* correctly and that a caller *cannot bypass* it are two
  different claims needing two different tests. Only the second one
  validates the trust boundary.
- **Process teardown is the highest-value integration test in the app.**
  Spawn a real process that itself spawns a child, tear it down, assert
  zero descendants survive. It runs with every other test and is never
  skipped. It matters more than it did under the previous design,
  because the mechanism available from Node is weaker — ADR 0001.
- **The agent loop is composed from interfaces.** Sequencing uses fakes, while
  permission enforcement adds a real temporary-filesystem sentinel so denial is
  proven by the absence of the effect. If constructing the loop itself needs a
  filesystem, subprocess, or network connection, something concrete has leaked
  into a dependency that should be an interface.
- **Renderer:** pure `(data) → descriptor` functions get plain-data
  tests; a small set of component tests covers the flows named in the
  renderer architecture doc.
- **System-boundary and installed-app tests** drive real browsers, Windows
  process ownership, file replacement, and the built application. They run
  serially where shared machine resources would make parallel evidence noisy.
  Each scope has its own discovered test directory, so adding a boundary test
  never requires keeping an ordinary-suite exclusion list synchronized with a
  boundary-suite inclusion list.

## Observability

Structured events across the agent loop, permission decisions, and
tool/MCP calls. This is a **product requirement**, not just a debugging
aid: the app must be auditable by a curious non-technical user, and a
plain-language audit trail is only possible if the underlying events are
structured and complete.

The `AppEvent` stream in `contract` is that record. The live UI and the
audit trail render from the same sequence, so the app cannot do
something user-visible that the trail omits.

## The core/renderer contract

Everything crossing the boundary lives in the `contract` package: the
API the preload bridge exposes and one `AppEvent` union covering
everything the core can say. Both sides are TypeScript and import it
directly — there is no code generation and nothing to keep in sync. The
contract is the file, not a build step.

## Doc/code drift defense

Feature docs state invariants and boundaries, never file paths or line
numbers (those rot). Each documented invariant maps to a named test, so
a violated invariant fails the gate rather than quietly becoming
fiction. When an invariant changes, the doc and its test change together
— a doc that disagrees with the code is worse than no doc.

## Supply chain

`pnpm` (strict resolution surfaces phantom-dependency bugs that npm and
yarn allow through). Add `pnpm audit` to the gate once there is a
dependency surface worth auditing; prior art shipped with a
known-vulnerable dependency flagged in its own docs and never addressed.

## Packaging and the gate

`electron-builder` produces the Windows installer. `scripts/gate.ps1` is the
gate and the single definition of "green" (ADR 0004) — lint, theme, formatting,
typecheck, tests, build, with `-Full` adding packaging. The pre-commit hook and
Windows GitHub Actions workflow both invoke it rather than restating the checks.

The theme step is `scripts/check-theme.mjs`. ESLint does not read CSS,
so it stands where a lint rule would: every colour in the renderer's
stylesheets must come from the `:root` token block, and every token a
rule references must actually be defined. A literal colour in a rule is
invisible until the ground changes underneath it, and an undefined token
paints nothing at all — neither is caught by a DOM test. The demo stage
is excluded because it is the window frame drawn around the app for
review, not product surface.

Style ownership is held by a repository test for the same reason (ADR
0035). Each renderer module's styles are a CSS Module, and the one global
stylesheet may define only the theme, the reset and the shared basics. The
test fails when a global stylesheet defines any other class, when a module
stylesheet names another stylesheet's class that is not a shared basic, and
when a component writes a class name as plain text that is not one. DOM tests
keep a module's class names as written; the built app does not, so nothing
outside a module can select by them.

Windows only (ADR 0004). Nothing is run against macOS or Linux.

During repository development, the desktop composition binds workspace tools
to the repository root rather than pnpm's package working directory. A
`ZHIYIN_WORKSPACE` environment value overrides that root for focused testing.
This is a development mechanism. Installed apps use explicit folder selection
and restore that choice; they do not fall back to their launch directory.

The credential binding is the one production dependency that must remain
external to the JavaScript bundle. electron-builder includes it and
smart-unpacks its native binary; a full packaging check must confirm that binary
whenever Electron, electron-builder, or the binding changes (ADR 0007).

Alpha tags publish unsigned developer-preview installers, their SHA-256
checksums, and public-repository build provenance. Code signing, automatic
updates, and upgrade qualification remain requirements for a consumer-ready
release and need their own decision before that release line exists.
