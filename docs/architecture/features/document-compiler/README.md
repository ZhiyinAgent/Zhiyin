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
- **Talks to other features only through:** the contract's
  `WritingConnection`, which `documentsConnection()` in the capabilities group adapts into a built-in
  connection the MCP feature serves.

## Public interface

- `documentCompiler({ workspaceRoot, programs, tectonicCache, containment?, run?, timeoutMs? })`
  returns a `WritingConnection`: `listTools`, `callTool`, `inspect`,
  `describeResult`, `produced` and `close`.
- One tool, `compile_document`, takes the document's workspace-relative path
  and an optional output path. By default the PDF is written beside the
  source.
- `programs()` is asked on every look, so an engine installed while the app
  runs is picked up without a restart.
- Engines run through the process-ownership mechanism, so a compile lives in a
  Job Object and ends with the app (ADR 0004). Tests may replace the runner.
- `diagnosticsFrom(output)`, the lines of a compiler's output a person or a
  model needs: the diagnostics, not the chatter.
- The types these take and return: `ProgramContainer`, `ProgramContainment`,
  `ProgramRun`, `RunProgram`, `CompilerPrograms`, `DocumentCompilerOptions`.

## Invariants

- A document is compiled inside the workspace folder only. A source or output
  outside it, as written or where a link leads, is refused before anything
  runs.
- The engine follows the file: `.typ` runs Typst and `.tex` runs Tectonic.
  Anything else is refused, and so is an output that is not a PDF, as written
  or where a link leads. Tectonic names the PDF after its source, so a LaTeX
  output under another name is refused before anything runs; a source reached
  through a link still writes the output as the path names it.
- Typst is given the workspace as its root, so a Typst document names files
  in the workspace only, besides the packages Typst keeps.
- Tectonic runs with `--untrusted`, which turns off shell escape, so a LaTeX
  document cannot run programs. It runs at low integrity, and writes only in
  a folder of this compile's own under `tectonicCache`, which holds its
  temporary files, its PDF and its copy of the package cache. The copy is
  made of hard links to the shared packages, which stay at the person's
  integrity, so a document reads every kept package and can change none, and
  what it writes there is gone with its folder. A package a compile fetched
  joins the shared cache by name only, fetched again by Zhiyin through
  Tectonic's bundle, which runs no document; so does the format LaTeX starts
  from, built from a document Zhiyin writes. Nothing in the workspace is opened to it,
  so on a drive that keeps integrity labels, as NTFS does, Windows refuses a
  document's write anywhere else, the workspace included, unless something
  else opened the workspace to low integrity, as the 3D studio does for
  Blender. A FAT or exFAT drive keeps no labels, so there Windows refuses no
  write. The PDF kept is a copy Zhiyin itself makes, so it is no more open to
  low integrity than the folder it is kept in. Without containment, LaTeX
  does not run.
- Each engine lists the files it read: Typst all of them, Tectonic those it
  read from disk. When one lies outside the workspace, named so or carried
  there by a link, or no list was written, nothing the compiler made or
  printed is kept or shown, since an error can quote what it read. A name is
  checked as Windows opens it, without trailing dots and spaces, and a list
  that is not Tectonic's own for this compile, or names a file that cannot be
  found, counts as no list. Tectonic
  goes on past a document's errors so that the list is still written, and
  those errors fail the compile though Tectonic reports success. It writes no
  list when a document has no pages, names a file that is not there, writes
  one where it may not, or reaches a hundred errors; the answer then names
  those causes.
- A failure reports the compiler's own diagnostics, not a bare exit code: each
  error or warning with its file, line and column relative to the workspace,
  the marked source line, and any hint.
- Success means this compile wrote the PDF. The compiler writes it beside
  the output, under the same name in a folder of its own, and it is moved
  over the output only once the compile has succeeded: a compiler that
  reports success but wrote nothing is reported as a failure, however
  quickly one compile follows another, and a compile that fails leaves the
  PDF from before as it was. When the output cannot be replaced, as when
  another program holds it open, the answer says so. A folder left by a
  compile that never finished is removed by a later one an hour on.
- A compile that ends early says why: it took longer than its time limit,
  which it names, it was stopped, or it printed more than is kept.
- The PDF is declared as a change before the compile runs, as created or
  updated, so a PDF it overwrites is backed up and can be restored. After a
  successful compile it is declared as produced and appears among the work's
  files. A failed compile produces nothing.
- With no engine installed the connector offers no tool.
- The approval names the document and the file that will be written, and
  says where packages come from: Tectonic downloads the packages a LaTeX
  document needs from its package server, and Typst those a document imports
  from its package registry.

## Testing notes

The runner is replaceable, so arguments, containment and reporting are tested
without a compiler. A system-boundary test runs the real engines when
`ZHIYIN_TYPST` and `ZHIYIN_TECTONIC` point to them, and is skipped otherwise;
CI's gate installs both, so there it runs.
