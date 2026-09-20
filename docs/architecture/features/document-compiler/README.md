# Document compiler

## Purpose

Compiles a Typst or LaTeX document in the workspace to PDF and reports what the
compiler said, as one built-in connector. It exists because a compiled document
is the point of technical and academic writing, and because the generic shell
tool cannot say what it is about to compile, where the PDF lands, or what a
compiler's output means.

## Boundaries

- **Owns:** deciding which engine a document needs, the arguments each engine
  is run with, path containment, and turning compiler output into a result a
  person and a model can read.
- **Does not own:** installing the engines (toolchains), rendering the PDF for
  review (`read_file` already renders PDF pages), permission decisions, or
  connection lifecycle (MCP).
- **Talks to other features only through:** the connection shape the
  application registers with the MCP feature.

## Public interface

- `documentCompiler({ workspaceRoot, programs, containment?, run?, timeoutMs? })`
  answers a `CompilerAutomation`: `listTools`, `callTool`, `inspect`,
  `describeResult`, `close`.
- Program execution uses the process-ownership platform mechanism; tests may
  replace that runner without redeclaring containment.
- One tool, `compile_document`, taking the document's workspace-relative path
  and an optional output path.
- `programs()` is asked on every look, so installing an engine is noticed
  without a restart.

## Invariants

- **A document is compiled inside the workspace folder, and nowhere else.** A
  source or an output that escapes it is refused before anything runs. Named
  test: `refuses a document or an output outside the workspace folder`.
- **The engine follows the document.** `.typ` is Typst and `.tex` is Tectonic;
  anything else is refused, and so is an output that is not a PDF. Named test:
  `refuses a file neither engine compiles, and an output that is not a PDF`.
- **Typst is confined to the workspace and LaTeX runs untrusted**, so a
  document cannot read outside the folder or run programs of its own. Named
  tests: `compiles Typst inside the workspace and reports the file it wrote`
  and `runs LaTeX untrusted, so a document cannot run programs of its own`.
- **A failure reports the compiler's own diagnostics**, not a bare exit code,
  and the trace around them is left out. Named test: `reports the compiler's own
  errors rather than a bare exit code`.
- **Success means a file exists.** A compiler that claims success but wrote
  nothing is reported as a failure. Named test: `says so when the compiler
  claims success but wrote nothing`.
- **No engine, no tool.** The connector offers nothing until one is installed,
  and offers it as soon as one is. Named tests: `offers no tool at all until an
  engine is installed` and `offers its tool again as soon as an engine is
  installed`.
- **A person is told what will happen before it does**: which document, which
  file will be written, and that LaTeX fetches packages from its package
  server. Named test: `names the document, the file it writes, and where LaTeX
  fetches packages`.

## Testing notes

The invocation is replaceable, so the arguments, containment, and reporting are
tested without running a compiler. `real-compilers.test.ts` runs the actual
engines when `ZHIYIN_TYPST` and `ZHIYIN_TECTONIC` name them, and is skipped
otherwise — the gate installs neither.

## Open questions

- Tectonic downloads its TeX bundle from its package server on first use and
  caches it outside the app's data folder. The plugin says so; the app does not
  manage that cache.
