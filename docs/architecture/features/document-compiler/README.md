# Document compiler

## Purpose

Compiles a Typst or LaTeX document in the workspace to PDF and reports what
the compiler said, as a built-in connection. A dedicated tool, rather than the
shell, can tell the person what it is about to compile and where the PDF will
land, and can turn a compiler's output into errors a model can act on.

## Boundaries

- **Owns:** choosing the engine for a document, the arguments each engine runs
  with, keeping paths inside the workspace, and turning compiler output into a
  result a person and a model can read.
- **Does not own:** installing the engines (toolchains), showing or reading
  the PDF (the document viewer and the `read_document` tool), permission
  decisions, or the connection's lifecycle (MCP).
- **Talks to other features only through:** `CompilerAutomation`, which
  `documentsConnection()` in the capabilities group adapts into a built-in
  connection the MCP feature serves.

## Public interface

- `documentCompiler({ workspaceRoot, programs, containment?, run?, timeoutMs? })`
  returns a `CompilerAutomation`: `listTools`, `callTool`, `inspect`,
  `describeResult`, `produced` and `close`.
- One tool, `compile_document`, takes the document's workspace-relative path
  and an optional output path. By default the PDF is written beside the
  source.
- `programs()` is asked on every look, so an engine installed while the app
  runs is picked up without a restart.
- Engines run through the process-ownership mechanism, so a compile lives in a
  Job Object and ends with the app (ADR 0004). Tests may replace the runner.

## Invariants

- A document is compiled inside the workspace folder only. A source or output
  outside it is refused before anything runs.
- The engine follows the file: `.typ` runs Typst and `.tex` runs Tectonic.
  Anything else is refused, and so is an output that is not a PDF.
- Typst is given the workspace as its root, so a Typst document reads only
  from the workspace. Tectonic runs with `--untrusted`, which turns off shell
  escape, so a LaTeX document cannot run programs.
- A failure reports the compiler's own diagnostics, not a bare exit code: each
  error or warning with its file, line and column relative to the workspace,
  the marked source line, and any hint.
- Success means a file exists. A compiler that reports success but wrote
  nothing is reported as a failure.
- The PDF is declared as a change before the compile runs, as created or
  updated, so a PDF it overwrites is backed up and can be restored. After a
  successful compile it is declared as produced and appears among the work's
  files. A failed compile produces nothing.
- With no engine installed the connector offers no tool.
- The approval names the document and the file that will be written. For
  LaTeX it also says that Tectonic downloads the packages a document needs
  from its package server.

## Testing notes

The runner is replaceable, so arguments, containment and reporting are tested
without a compiler. A system-boundary test runs the real engines when
`ZHIYIN_TYPST` and `ZHIYIN_TECTONIC` point to them, and is skipped otherwise.
