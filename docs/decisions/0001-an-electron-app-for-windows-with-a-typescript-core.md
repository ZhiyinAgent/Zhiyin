# 0001. Zhiyin is an Electron app for Windows, with its whole core in TypeScript

Status: accepted

## Decision

- Zhiyin is an Electron desktop app written in TypeScript throughout. The core
  is a pnpm workspace with one package per feature, loaded as plain modules in
  Electron's main process. The window is a React app in the desktop package.
- The programs Zhiyin runs are separate operating-system processes: shell
  commands, the browser, ripgrep, git and the downloaded toolchains. Zhiyin's
  own code runs in a separate process only where it parses untrusted input in
  native code: documents are read and drawn in an Electron utility process
  (ADR 0018).
- Windows is the one platform that is built, tested and supported. CI runs the
  repository gate on a Windows runner.
- The packaged executable starts only as Zhiyin. The Electron fuses that would
  let it run as Node.js (`ELECTRON_RUN_AS_NODE`) or accept the inspector
  arguments are off, and the full gate reads both from the packaged executable.
  `NODE_OPTIONS` stays honoured, because `NODE_EXTRA_CA_CERTS` is how someone
  behind a company proxy reaches the model provider.

## Why

One language runs from the window to the core, so both import the same
declarations: no generated bindings, one toolchain, one language to review.
How fast Zhiyin feels is set by model latency and the programs it runs, not by
the core's own speed. The libraries it relies on most (the MCP SDK, Playwright,
pdf.js) are TypeScript or JavaScript.

Windows is where Zhiyin is developed and used, and the mechanisms its safety
rests on are Windows ones: Job Objects (ADR 0004), Credential Manager
(ADR 0019) and the Recycle Bin (ADR 0008).

The fuses close a way for another program to run its own code as Zhiyin's
executable and, once releases are code-signed, under its signature.

## Rejected

- A native shell with a Rust core: compiler-enforced module boundaries, paid
  for with a cross-language contract, generated bindings, two toolchains and
  review in two languages. Lint holds the boundaries instead (ADR 0002).
- A Node backend as a sidecar to a native shell: a cross-process contract that
  solves nothing Electron needs solved.
- A utility process per feature: an asynchronous serialization boundary between
  every pair of features. The programs that can leak or hang are separate
  processes already, and contained (ADR 0004).
- macOS and Linux: the mechanisms above have no tested equivalent there.
- Turning off `NODE_OPTIONS` as well: it would also drop
  `NODE_EXTRA_CA_CERTS`.

## Assumptions

- The people reviewing the code read TypeScript fluently, and that is worth
  more than compiler-enforced boundaries.
- Model latency and subprocess time, not the core's execution speed, set how
  fast Zhiyin feels.
- Nothing in Zhiyin forks its main process or starts its own executable as
  Node.js. A dependency that did would fail only in the packaged app.
- The people who use Zhiyin are on Windows.
