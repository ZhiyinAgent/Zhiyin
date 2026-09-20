# Tasks

Work that is known but not done. One file per task.

This is deliberately **not** in `docs/`. Everything under `docs/`
describes the system as it is or as it was decided; a task describes
something that does not exist yet. Mixing them invites a future reader
— human or model — to take a half-formed intention for a design.

## The rules

- **One task, one file**, named as a slug: `teardown-test.md`.
- **No numbers in filenames.** They imply an order that goes stale the
  first time priorities change. Order comes from `blocked-by`, which
  encodes a real constraint rather than an opinion.
- **A task says what and why, never how.** Implementation notes written
  before the work is understood are wrong by the time it starts, and
  they crowd out the reason — which is the part that stays true.
- **No file paths or function names**, same as feature docs. They rot,
  and a task that names a stale path is worse than one that names none.
- **`Done when` must be checkable.** "Improve error handling" is not a
  task. "A provider 401 reaches the user as a message naming the key"
  is. If it can't be stated as an observable outcome, the task isn't
  understood well enough to sit here yet.
- **Delete the file in the commit that completes it.** Git history is
  already the archive, and that diff shows exactly which change closed
  which task. No `done/` folder accumulating things nobody reads.
- **Delete abandoned tasks too**, with the reason in the commit message.
  A backlog nobody prunes stops being read.

Start from `_template.md`.

## Effort scale

`Trivial` / `Low` / `Medium` / `High` / `Complex`. Never time estimates.

## Reviewed priorities, 2026-09-10

All tasks were read against the roadmap and the implementation. Six were
discarded; their reasons are in the commit that removed them and summarised
below. Where a discarded task held one live idea, that idea was folded into the
task that owns it rather than lost.

Two axes, kept apart on purpose. **Essential** means the product is wrong or
unsafe without it, at the stage the roadmap says we are at. **Bonus** means it
is a real improvement whose absence is not a defect yet. Effort is in each file.

### Essential — the foundation stage does not close without these

None remain.

### Useful — real defects or real risk, but not gating the stage

None remain.

### Bonus — good ideas whose absence is not a defect

| Task | Note |
| --- | --- |
| `record-serving-provider` | The data is already recorded and restored. Only the display is missing, and nobody is debugging across upstreams yet. |
| `mcp-http-auth-and-project-trust` | Bearer auth works. Interactive OAuth waits for somebody who needs it. |
| `project-capability-import` | Absorbed `skills-source-precedence`. Holds a real invariant - opening a folder is not consent - for a feature that does not exist yet. |
| `subagent-execution-and-cancellation` | Roadmap stage 5. Its ownership tree exists; execution and result handoff do not. |
| `open-source-release-readiness` | Roadmap stage 6. Source publication and unsigned alpha automation are ready; signing, upgrade behavior, and consumer-release qualification remain. |

### Closed, 2026-09-17

`built-in-capability-catalog`, `compiler-connector-latex-typst`,
`sandbox-python-connector`, and `external-plugin-installation-and-updates`.
ADR 0045 made a plugin package the only definition of a component, so the
shipped catalog, the document compiler, and the Python sandbox were built, and
a person's edits to an imported package became overrides that an update no
longer overwrites. See `docs/built-in-plugin-catalog.md`.

### Closed, 2026-09-15

`contained-browser-outlives-a-destroyed-app`. The apparent escape was a test
defect: the automation client reported the command-shell wrapper's pid, so the
test killed that wrapper while leaving Electron alive. The installed regression
now asks Electron for its actual main-process pid, identifies only browsers
carrying that owner in their isolated profile, destroys the main process without
`/T`, and observes the browser tree disappear promptly.

`browser-preview-coverage`. The production component lab and composed workspace
are driven in a real browser at normal and minimum window sizes. Coverage spans
tabs, popups, simultaneous conversations, navigation cancellation, browser
states, approval reachability, conversation position, keyboard and pointer
diagram control, motion settings, adversarial file replacement, and abrupt
application death.

`choose-model-and-upstream`. A withdrawn model names the stored choice at use
and in Settings, automatic routing no longer carries the superseded provider
allowlist, and the page is qualified by keyboard at the minimum window with
ordinary and reduced motion.

`diagram-fit-before-drawing-settles`. Diagram measurement briefly holds ambient
animation still, counted across concurrent drawings, so Mermaid produces the
same geometry across loads, window sizes, and motion preferences.

`reasoning-provider-coverage`. An optional-reasoning endpoint was exercised live
with reasoning on and off; long traces and repeated tool rounds remain
responsive; required, off, unavailable, and unreadable-trace states are covered
in production components; and catalogue failures recover without restart.

`turn-responsiveness-under-many-views`. A turn reports which view request it is
composing while streamed arguments arrive, including after earlier actions. A
live installed session showed the notes across six views and held the renderer
thread once for 83ms over 95.6 seconds.

### Closed, 2026-09-12

`turn-cancellation-and-resource-ownership`. Durable task replacement now binds
the commit point to the exact turn that authored it, so a held save released
after Stop cannot publish or persist the stopped work. Nested ownership is a
tree: parent cancellation reaches every descendant and not an unrelated root.

`serialize-durable-state-writes`. Disk-full, partial-write, and failed-replace
injections all leave the prior committed workspace readable. The built app also
releases its data-folder lock on ordinary quit.

`recover-core-initialization`. The built app starts with unavailable secure
credential storage and reports it in Settings. Damaged-history recovery fits at
720 by 480 and is reachable and activated through the keyboard.

`workspace-selection-and-root`. Built-app tests drive the native folder picker
for an initial choice and for a folder moved while the app was closed; the new
identity reaches the window and the stale notice clears.

`recovery-full-suite-contention`. Tests that exercise real Chromium, Windows
exclusive replacement, and subprocesses run after the parallel unit projects
and one file at a time. The production browser-session capture path replaces a
raw one-shot screenshot; the fix adds no retry.

`feature-docs-match-their-imports`. Each orchestration package now names the
contract, features and groups it actually imports. Returning to a recent folder
is assigned to the core, and startup's boundary says what it waits for without
reducing that work to disk reads.

`shrink-oversized-orchestration-files`. The core's startup and recovery work
now returns what a launch found for the workspace to install and save through
its single durable path. The workspace is under the orchestration limit, so the
last size pin is gone and the pin list is empty.

### Advanced, 2026-09-14

Five tasks moved, and two defects none of them had named were found by probing
the live provider. The apparent process defect found by the installed
application test was resolved on 2026-09-15 as a test that destroyed the launch
wrapper rather than the application itself.

`choose-model-and-upstream`. A model the provider will not serve is refused two
ways — an unrecognised id as `400`, a retired one as `404` — and only the `404`
was read as a model failure; the `400` was reported as the request being too
large. Both now name the stored id and point at Settings. The second defect was
the one this task's own notes predicted: routing still defaulted to ADR 0022's
`["z-ai"]`, which serves exactly one model, so any other model chosen without an
upstream list was refused `404` while the same request without the restriction
was served. ADR 0030 had already decided otherwise; the constant outlived it.

`turn-responsiveness-under-many-views`. Reproduced as a measurement before
anything was changed: the window was told nothing from a round's first argument
fragment to its end. A turn now says what it is composing.

`reasoning-provider-coverage`. Turned on and off against a real endpoint that
permits off. The app's own default model reports `mandatory: true`, so the case
was unreachable from the shipped configuration.

`diagram-fit-before-drawing-settles`. The first two proposed causes were ruled
out by measurement, and a third was found that is worse than either: a person's
motion preference changes what a diagram is. Mermaid measures its labels inside
`document.body`, the application ships five looping animations, and reducing
motion collapses them — so what is moving while a diagram is measured decides
how it comes out. The card now says when its drawing has settled, and repeated
loads of the lab are identical at both window sizes. A fix was tried and
withdrawn, and reading Mermaid's render path afterwards said why: given an
element it wipes that element at the start of every render and applies the
configured font to its measuring div, where left to itself it removes only its
own nodes, appends to `body`, and applies no font at all. Passing a container
therefore swaps the measuring environment rather than steadying it, which
accounts both for drawings destroying each other and for their shapes changing.
Fixed on 2026-09-15, on the seventh explanation and the only one with an
experiment behind it. The labels themselves measure about a pixel different
while the application's decorative animations run — same font, same size — and
the layout engine turns that pixel into a graph 51 pixels wider. Six other
explanations were measured and ruled out, including every one tried before.
Stopping the animations was the only lever that moved it, so a drawing now holds
the page still with the declarations the reduced-motion rule already uses, for
the few milliseconds it is measured, counted so concurrent drawings work. The
regression asserts the two settings agree rather than reporting that they do
not. Complete; delete the file in the commit that completes it.

### Closed, 2026-09-13

`teardown-test`. Windows starts owned processes suspended, assigns them to a
kill-on-close Job Object, and resumes them only after assignment. A real
reparented descendant and the production browser path prove the launch boundary;
shell availability is withdrawn when containment is unavailable.

`normalize-mcp-tool-outcomes`. Remote result content is accepted only in the
supported text, image, and structured JSON shapes. Cancellation before dispatch
is stopped; every resolved or thrown outcome after dispatch retains uncertainty.

`conversation-rewind`. A durable completion journal spans file restoration and
conversation persistence. Startup converges before new work, partial restore is
idempotent, and installed-app tests cover stops on both sides of persistence.
Recovery usage, limits, exclusions, and deletion are visible and keyboard-tested.

`preserve-execution-evidence`. The app shows correction provenance and recovery
storage with explicit retention, redaction limits, and independent deletion.
Correction history is capped at 5,000 entries and private evidence remains out
of usage telemetry and shared evaluation records.

`bounded-work-and-context`. The renewable checkpoint now covers 30 minutes,
500,000 measured or estimated tokens, and USD 10 of provider-reported cost, and
states unavailable coverage. The ledger is ready to be shared by future child
work; that binding remains part of the still-unimplemented subagent task.

`agent-loop-tests-own-the-turn`. Every turn-behaviour test built the core's
workspace around the loop, so the loop was never tested on its own. It now has
its own stand-in for the app around a turn — the conversations, what is
announced about them, and the few questions a turn asks — and holds its tests
beside it: streaming, compaction, outcomes, views, images, pictures, the work
budget, quiet corrections, silent repair, permission boundaries, turn ownership
and the rest, 130 tests that pass with no core present. What stayed with the
core is what needs both: startup, saving, folders, the browser feed, rewind, and
the seams where a turn's result has to reach disk. `user-input` stayed whole
rather than be split for one assertion about a saved interaction.

`core-rules-move-to-their-owners`. Four rules the core held for other packages
went to them: how a turn that did not finish is settled — after a restart, and
when a turn ends with reasoning still arriving — to the agent loop; the list of
interests to the skills those interests switch on, reached through the
capabilities group; the name a saved view's file takes to artifacts; and which
model answers before anyone has chosen one to the model client, which the
composition root had been repeating. The onboarding grid keeps its own words and
icons, with a named test holding its ids to what the skills declare.

`group-members-reached-through-the-group`. The layer rules let the agent loop
and the core import a group's members directly, so a caller could go around the
joining a group exists to do. Lint now refuses that above the group layer unless
the import is listed with the reason the group does not answer for it, guarded
by must-fail cases in the layer tests. Both imports that existed were removed
rather than listed: the browsers the loop held only to close, and the open
workspace folder, whose interface moved to the contract where the tools, the
loop and the core can all name it. One exception is listed — the core reaches
the browser for the panel a person watches and drives themselves. ADR 0037.

`capabilities-close-a-conversation-completely`. Stopping a turn, deleting a
conversation and shutting down each closed the browser and the connections
themselves, and the agent loop was handed the browsers for no other reason. The
capabilities group now owns letting go: one call closes a conversation's browser
and its connections, one lets go of a deleted conversation's entirely, and
shutdown closes every one. The loop no longer knows the browser exists —
`@zhiyin/interactive-browser` left its dependencies with the line that used it.

`renderer-tests-live-with-their-module`. The app shell's folder held tests for
eight components belonging to other modules, and two modules had none of their
own. Each block moved to the module that owns the component, assertions
unchanged; the shell's folder now tests the shell. The usage test builds its
own fixture rather than reaching into the demo's, which a module may not do,
and its totals are the ones the assertions already named.

`shared-holds-only-neutral-loading-states`. Shared presentation drew the
sidebar, the conversation and the context shelf while they loaded, with their
geometry in its stylesheet, so changing one of those layouts meant changing a
second owner. It now holds one placeholder shape and a neutral list; the
conversation's loading state belongs to the conversation, and the workspace's
to the app shell, each with its own styles.

`surface-panel-owns-its-layout`. The shared page frame takes whether it scrolls
and how much room its heading gets as options, so the capability pages no
longer set those properties with rules of their own weight and the answer no
longer depends on which stylesheet loaded last. A real browser measures all
three pages with the stylesheets served in both orders. A person's eye and the
keyboard at the minimum window size were covered with the production component
lab on 2026-09-15.

`command-handlers-typed-from-the-bridge`. The channel list, the window's
interface and the core's handlers are one vocabulary held together by types
instead of three lists kept in step by hand, and the bridge is exposed without
a cast. Checked by breaking it three ways — a channel with no handler, a
handler with no channel, and a method the window is offered that travels
nowhere — each of which stopped the build.

`demo-drives-the-shell-through-a-fake-core`. The app shell now requires the
core's commands, so the second, simulated backend it ran when it had none is
gone, and with it every action the window's reducer carried for the demo alone.
The demo answers those commands from its own store instead: a reducer and a
stand-in core beside it, which also serve the component lab. The shell went
from 731 to 653 lines of code, and the tests for the simulated actions moved
with them, assertions unchanged.

`style-check-parses-stylesheets`. The style ownership check parses CSS instead
of matching patterns, so a module stylesheet is now refused when it styles
elements the module does not own, reaches out through a global selector
written without parentheses, or pulls in another module's styles by `@import`
or `composes`. Each is a must-fail case. The current renderer passes
unchanged: the scan found nothing to fix, only checks that were missing.

`renderer-lint-covers-every-folder`. The renderer's places are read from the
folders that hold code rather than from a list naming `ui` and the demo, so a
folder added beside the modules is held to the same entry points at once; a
folder of images is not a place, because it imports nothing. The window, the
main process and the bridge are now also refused each other's code, which
neither lint nor typecheck caught before.

`package-lint-covers-every-import-form`. The layer rules read import
declarations, so a package named any other way went unseen: a dynamic import,
a type named inline, or a name handed to a runtime require each reached what
the layer forbids and reported nothing. All three are refused now, with the
contract excepted, and each is a must-fail case in the layer tests.

`one-definition-for-shared-failure-and-owner-types`. The person-facing failure
and the tool-owner names each have one definition in the contract, so the core
and the agent loop no longer recognise each other's failures by comparing a
name string, and the permission engine no longer repeats the owner names.
ADR 0036 records what the contract may hold and what it may not.

### Closed, 2026-09-11

`optional-command-arguments-arrive-absent`. The command check counts an
argument left out at the end as absent, whether it is missing or undefined, so
the bridge sends what it was given and the window stops branching to avoid
sending an undefined.

`menu-command-failures-are-reported`. A command from the application menu that
fails now reaches the window and is shown where the window's own command
failures are, instead of being discarded in the main process. The window's
command error moved into its state with everything else it shows, so both
arrive the same way.

`startup-without-waiting-on-the-model-catalogue`. Startup no longer waits for
the provider settings, which looked the model up in the provider's catalogue
twice in a row, each lookup allowed five seconds. Saved conversations appear
from local files; the settings follow as their own event, one lookup answers
both reasoning and picture support, and a read begun at startup cannot
overwrite settings read after a change. The core also stopped keeping a
placeholder model of its own, and the model settings — the key, the models on
offer and the model chosen — moved out of the workspace into their own part of
the core, since nothing in them touches a conversation.

`tools-follow-model-image-support`. The file tools read picture support from
the core's provider settings, the answer a turn is given, instead of a flag the
composition root read once at launch. Switching to a model that cannot be shown
pictures used to leave the picture tool offered until restart; a test against
the application's real composition now switches models and checks what the next
request offers.

`auxiliary-reasoning-budgets`. Auxiliary requests now ask for the least thinking
the model will do, carry a floor of 800 tokens - 1,600 for the plan, which is
the largest answer - and are told to answer rather than deliberate. Both
settings live where the request is sent, so one added later inherits them, and a
model that refuses reasoning control is asked again without it. What this does
not establish is the thing the owner actually reported: that a plan now appears
and a conversation gets named. That shows up in the next real conversation, not
in a regression.

Three defects found by looking at the running app at 720 by 480, all reported by
the owner and all reproduced by measurement before being changed: the floating
navigation button sat 10px above the header it belongs beside, because it was
pinned to a fixed offset rather than centred on it; the sidebar was 550px of
content in a 480px window with no scrolling, so the preferences row holding
settings and usage could not be reached; and both are now guarded by tests that
measure the real window.

### Closed, 2026-09-10

`model-stream-completion`. The parser had no path at all for an error delivered
inside a 200 stream - not a missing test, an unhandled case. A failure after the
headers went out was read, discarded, and the turn recorded as complete. It now
ends the request with the same typed outcome the equivalent status would give
and carries the provider's own sentence.

`first-run-and-reconnect-ui`. A key is checked with the account endpoint before
it is kept, because the catalogue answers a rejected key normally and cannot
decide this - verified against the live provider on 2026-09-10. Refused keys are
not stored; a key that could not be checked is kept and said to be unchecked,
so somebody offline is not told their key is wrong.

`bind-approval-to-exact-effects`. An MCP call is now laid out from the tool's own
schema, one input per row, with the server's description of each carried as that
server's claim. The sender rule on privileged channels was extracted and
exercised. Its one remaining clause - visible source and version for loaded
instructions - is the `connect-skills-to-runtime` work discarded above as
building for a product that does not exist yet, and is not a reason to keep a
task open.

`reviewable-deliverables-and-evaluation`. All three cases ran in the installed
app on 2026-09-10 and all three passed; the run record is in `evaluation/runs/`,
taken from the application's own saved history. What remains - the failure
scenarios inside a case, and nontechnical-user validation - is the roadmap's
alpha milestone gate, not a task.

### Discarded, 2026-09-10

| Task | Why |
| --- | --- |
| `capability-package-lifecycle` | A versioned package manager - manifests, updates, rollback, removal - for an app with no users and no packages. Build it when something needs installing. |
| `connect-skills-to-runtime` | Instruction revision and source provenance for five bundled skills nobody has versioned. The invariant that mattered - enabling instructions grants no tool authority - is structural: skill loading goes through the permission engine. |
| `frontend-feature-boundaries` | Its enforceable half is done and guarded by lint. What remained was stylesheet ownership by convention: internal tidiness with no observable outcome. |
| `skills-source-precedence` | Bundled-versus-user precedence is implemented and tested. Its one live idea, project-source trust, moved to `project-capability-import`. |
| `session-turn-undo` | Superseded by `conversation-rewind`, which owns the preimage store and already enforces the ADR 0019 limits. Its remaining idea - make those limits visible and deletable - moved there. |
| `browser-execution-and-visibility` | Its own evidence said the remainder belonged to browser preview coverage, later completed on 2026-09-15, and its exit condition was met by the `research-build-check` evaluation case. |

Priority is not a dependency. Empty `blocked-by` means work can begin; it does
not mean the feature can ship without the acceptance conditions in its task.
