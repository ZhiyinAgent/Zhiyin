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
  (ADR 0023).
- Windows is the one platform that is built, tested and supported. CI runs the
  repository gate on a Windows runner.
- **The packaged executable starts only as Zhiyin, and runs only its own
  code.** The Electron fuses that would let it run as Node.js
  (`ELECTRON_RUN_AS_NODE`), accept the inspector arguments, or load code named
  by `NODE_OPTIONS` are off, and so is the fuse that gives a page loaded from
  `file:` more than a browser gives it. The app loads only from its archive,
  and the archive is checked against the hash built into the executable. The
  full gate reads every one of these fuses from the packaged executable.

## Why

One language runs from the window to the core, so both import the same
declarations: no generated bindings, one toolchain, one language to review.
How fast Zhiyin feels is set by model latency and the programs it runs, not by
the core's own speed. The libraries it relies on most (the MCP SDK, Playwright,
pdf.js) are TypeScript or JavaScript.

Windows is where Zhiyin is developed and used, and the mechanisms its safety
rests on are Windows ones: Job Objects (ADR 0005), app containers (ADR 0006),
Credential Manager (ADR 0027) and the Recycle Bin (ADR 0012).

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
  processes already, and contained (ADR 0005).
- macOS and Linux: the mechanisms above have no tested equivalent there.
- Honouring `NODE_OPTIONS` for `NODE_EXTRA_CA_CERTS`: it asks the person to
  find and install their company's root as a file, and leaves a way for
  another program to run its own code inside Zhiyin.

## Assumptions

- The people reviewing the code read TypeScript fluently, and that is worth
  more than compiler-enforced boundaries.
- Model latency and subprocess time, not the core's execution speed, set how
  fast Zhiyin feels.
- Nothing in Zhiyin forks its main process or starts its own executable as
  Node.js. A dependency that did would fail only in the packaged app.
- The people who use Zhiyin are on Windows.
