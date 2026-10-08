# 0002. Packages sit in layers, and lint is what holds them

Status: accepted

## Decision

Every workspace package sits in one layer and imports only from the layers
below it:

| Layer | Holds | May import |
| --- | --- | --- |
| contract | What more than one layer must agree on exactly | nothing |
| platform | One mechanism several features share | contract |
| feature | One concept, with the interface for it | contract, platform |
| group | Features only ever used together, presented as one | contract, its members' types |
| agent loop | One model turn | contract, types from the layers below |
| core | The window's commands, the conversation list, saving, startup | contract, types from the layers below |

- **The contract is vocabulary**: shared types, the command channels, the
  bridge key, and the few values and pure functions two layers must compute
  identically, such as the person-facing error, the tool owner names and the
  context budget formula. It holds no state, does no I/O, and holds nothing a
  single feature owns.
- **A platform package owns a mechanism, not a policy**: process containment,
  workspace containment, the PDF engine. A new one needs a decision record.
- **A group exists only where there is joining code to move into it**:
  capabilities (tools, MCP, plugins, toolchains, the browser, Git, the
  document compiler and the Python environment) and rewind (conversation
  rewind and file recovery). A group keeps none of its members' storage. The
  one thing a group writes itself is the rewind group's journal of a rewind in
  progress, so that a restart can finish it.
- **Above the feature layer, packages import types only.** The composition root
  in the main process constructs every real implementation and hands it in. It
  may say which implementation, never what it does. The rest of the main
  process holds the window, the sender check, the Electron services handed to
  the core (dialogs, notifications, the spellchecker, the document processes)
  and shutdown, and forwards the contract's commands. It imports nothing from
  the workspace but the contract.
- **Above the group layer, a member is reached through its group.** An
  exception is listed in the lint configuration with the reason the group does
  not answer for it. There is one: the core reaches the interactive browser for
  the panel a person watches and drives.
- **Nothing goes around the rules.** Lint refuses a workspace package reached
  by a dynamic import, an inline type import or a runtime `require`, a relative
  path into a sibling package, and a path into another package's internals.
- **Every package's layer is declared once**, in the lint configuration. A
  package without one stops lint.

## Why

Each feature can be built and tested with nothing else present, which makes
the code reviewable one feature at a time. The agent loop is tested for turns
without settings plumbing, and the core for commands without a model.

The orchestrating layers are where a god class grows: a loop that also routes
every window command, a main process that collects decisions of its own. The
layers make that a lint failure rather than a review comment.

TypeScript has no private module boundary, so lint is the boundary. It catches
an accidental import, not a deliberate way around it, and a violation means the
design is wrong, not the rule.

## Rejected

- The agent loop as the only composer: it becomes the route for every window
  command.
- A central interfaces package: a dependency magnet and a second place for a
  god class.
- A dependency-injection container: runtime indirection for wiring that
  constructors already do.
- Feature-to-feature imports as listed exceptions: the layer rule becomes
  advisory.
- Executable helpers in the contract: it becomes a utilities drawer.
- Groups with no joining code to take over, such as the model client with
  usage, or permissions with audit: a rename, not a group.

## Assumptions

- The core runs in one process (ADR 0001), so composition is object wiring.
- Groups stay few.
- The lint resolver understands TypeScript's `.js` import names. If it stopped
  resolving them the rules would go quiet, so the repository's layer tests make
  real imports that lint must refuse or allow.
