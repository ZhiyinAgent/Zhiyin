# 0001. Electron with an all-TypeScript core

Status: accepted

## Context

The app needs a permission gate, tool execution, MCP server management
(which spawns third-party programs, including browsers), skills,
session/undo, a model client, and an agent loop that orchestrates them.
It is written by Claude under live human supervision; the user reviews
rather than authors.

An earlier version of this project was built on Tauri with an all-Rust
core. The reasoning was sound on its own terms — compiler-enforced crate
boundaries, OS-level process grouping, one toolchain — and it rested on
a stated assumption: that because Claude writes essentially all the
code, which language it is written in barely matters.

That assumption turned out to be wrong, and it is the reason this
decision exists. Rust's cost did not land on writing the code; it landed
on everything around it — a cross-language contract needing generated
bindings and a drift check, a build with two toolchains, and a review
surface in a language the supervisor reads less fluently than the one
the UI is already written in. The complexity was real and it was paid
continuously.

**Assumptions this decision depends on** (revisit it if any changes):
- The supervisor reads and reviews TypeScript more fluently than Rust,
  and that fluency is worth more than compiler-enforced boundaries.
- The app is bound by model latency and subprocess time, never by the
  core's own execution speed.
- Subsystem isolation matters, but the subsystems that actually need it
  are separate programs already.

## Decision

Electron, with the entire core in TypeScript as a pnpm workspace: one
package per feature, plus a `contract` package for what crosses to the
renderer, and a desktop app package holding the Electron main process,
the preload bridge, and the renderer.

Features are plain modules in the main process, composed by the agent
loop (ADR 0002). Genuinely external programs — shell commands, MCP
servers, browsers — remain real OS child processes.

`utilityProcess` isolation per subsystem was considered and rejected.
The failures worth preventing are orphaned external process trees and
capability loss after a crash, and the things that produce them are
already separate processes by nature; our code around them is a protocol
client and a registry. Isolating those would put an async serialization
boundary between every feature to protect against a failure nobody has
observed. `utilityProcess` remains the escape hatch if a subsystem later
blocks the main process or hosts untrusted native code.

The renderer has `contextIsolation` on, `nodeIntegration` off, and
`sandbox` on. It reaches the core only through the preload bridge, which
exposes exactly the contract's API and nothing else.

Rejected alternatives: staying on Tauri/Rust, which is what this
supersedes; a Node backend as a sidecar to a native shell, which
reintroduces a cross-process contract to avoid a problem Electron does
not have.

## Consequences

- **The cross-language contract disappears entirely.** No generated
  bindings, no drift check, no code generator to depend on. Both sides
  import the same TypeScript declarations. This was the single largest
  source of incidental complexity and it is gone rather than reduced.
- **Compiler-enforced boundaries are gone, and this is the real loss.**
  A non-`pub` Rust item was physically unreachable from another crate.
  TypeScript has no equivalent, so package boundaries are enforced by
  lint rules in the gate instead. Lint is weaker than a compiler and can
  be disabled with a comment. The rules exist and they are tested by
  deliberately violating them, but nobody should mistake them for the
  guarantee they replace.
- **Process teardown gets structurally weaker.** There is no maintained
  Node binding for Windows Job Objects, so tearing down a process tree
  means walking it at kill time rather than owning it as a unit. A
  descendant spawned during teardown can survive. This is a genuine
  regression from the previous design and it is why the teardown test
  is written before the mechanism it tests.
- Larger memory footprint than a native-webview shell, and identical
  rendering across platforms instead of per-platform variance.
- Iteration is faster: the core hot-reloads, which the previous design
  explicitly accepted losing.
- The ecosystem for this problem domain is in TypeScript, including the
  MCP SDK, which removes a class of "does a Rust crate exist for this"
  questions.
