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
- **Does not own:** installing the engines (toolchains), opening a PDF
  (the PDF engine, which it reads its compiled PDF back with), showing or
  reading the PDF (the document viewer and the `read_document` tool), permission
  decisions, or the connection's lifecycle (MCP).
- **Talks to other features only through:** the contract's
  `WritingConnection`, which `documentsConnection()` in the capabilities group adapts into a built-in
  connection the MCP feature serves.

## Public interface

- `documentCompiler({ workspaceRoot, programs, tectonicCache, readBack, containment?, confine?, run?, timeoutMs?, protect? })`
  returns a `WritingConnection`: `listTools`, `callTool`, `inspect`,
  `describeResult`, `produced` and `close`.
- `documentPrograms`, the programs the compiler needs installed before it
  can run: Typst and Tectonic.
- `documentCompilers({ programs, tectonicCache, ... })` returns a function
  that makes a connection from a folder getter,
  `(workspaceRoot) => WritingConnection`, read on every call. Each compiles
  in the folder it reads, and
  all share the one package cache: two folders' first LaTeX compiles build
  the format once.
- `tectonicBundleCopy` is Zhiyin's unchanged copy of the TeX bundle Tectonic
  reads by default: its address on `media.zhiyinagent.app`, the original's,
  and the size and SHA-256 of the bundle and of its index, which the scripts
  that upload and check the copy hold it to.
- `compile_document` takes the document's workspace-relative path and an
  optional output path. By default the PDF is written beside the source. An
  absolute output path may name a place outside the workspace.
- `list_fonts`, offered while Typst is installed, names the font families a
  Typst document can use, as Typst finds them, optionally only those with
  one of up to 20 words given among the words of their name.
- `programs()` is asked on every look, so an engine installed while the app
  runs is picked up without a restart. Besides each engine's path it may name
  each one's version, which a successful compile's answer then states.
- Engines run through the sandbox platform, so a compile lives in a
  Job Object and ends with the app (ADR 0005). Tests may replace the runner,
  and the way LaTeX is given its folders.
- `diagnosticsFrom(output)`, the lines of a compiler's output a person or a
  model needs: the diagnostics, not the chatter.
- The types these take and return: `ProgramContainer`, `ProgramContainment`,
  `ProgramRun`, `RunProgram`, `CompilerPrograms`, `DocumentCompilerOptions`.

## Invariants

- A document is compiled inside the workspace folder only. A source outside
  it, as written or where a link leads, is refused before anything runs, and
  so is a relative output that leaves it.
- An absolute output outside the workspace is placed by containment's rule
  for a write outside (ADR 0012): declared by its whole real path, with
  `outside` scope, so the person is asked by that path and the PDF it
  replaces is backed up. One in a `protect` folder, Zhiyin's own, is
  refused before anything runs, to the model, which can choose another
  place, as an output named as Windows names a device or with a colon is.
  Each refusal of where the PDF goes is worded as every feature that writes a
  file words it (workspace containment). An output in a folder not made yet
  is written there, the folder made for it.
- The engine follows the file: `.typ` runs Typst and `.tex` runs Tectonic.
  Anything else is refused, and so is an output that is not a PDF, as written
  or where a link leads. Tectonic names the PDF after its source, so a LaTeX
  output under another name is refused before anything runs; a source reached
  through a link still writes the output as the path names it.
- Typst is given the workspace as its root, so a Typst document names files
  in the workspace only, besides the packages Typst keeps. It runs contained,
  so it ends with Zhiyin, but not confined as LaTeX is. That rests on Typst
  itself: it starts no program a document names, the WebAssembly plugins a
  document loads have no access to files or the network, and it refuses a
  file beyond its root. Tectonic gives no such bounds to what a LaTeX
  package does, so LaTeX runs only confined.
- Tectonic runs with `--untrusted`, which turns off shell escape, so a LaTeX
  document cannot run programs. It runs confined (ADR 0006): it reads the
  workspace, its own installation and the shared package cache, changes only
  a folder of this compile's own under `tectonicCache`, and reaches on the
  network only where its packages come from (ADR 0006): Tectonic's own server,
  the one it sends the bundle on to, and Zhiyin's copy. Besides those, it reads only what Windows opens to every
  app container, such as Windows' own files and the fonts installed for
  everyone: Windows refuses it every other file, the person's own outside the
  workspace included, and every write outside its folder, the workspace's
  included. Its folder holds its temporary files, its PDF and its copy of the
  package cache, made of hard links to the shared packages, except the
  record of when each bundle was last checked, which is a copy: Tectonic
  writes it when it checks the bundle again, so a compile goes on once that
  check is due and the shared record stays as it was. The folder is
  given to it while still empty, so a document reads every kept package and
  can change none, and what it writes there is gone with its folder. The
  format LaTeX starts from is built by Zhiyin into the shared cache, from a
  document Zhiyin writes: before the first compile that finds none, so that
  compile fetches no package the format is built from, and again after a
  compile that had to build a format the shared cache lacks, as after a new
  Tectonic or bundle. Two compiles that start together build it once, and a
  compile goes ahead when it could not be built. A package a compile fetched
  besides those joins the shared cache by name only, fetched again by Zhiyin
  through Tectonic's bundle, which runs no document.
- **When Tectonic's own server cannot be reached, LaTeX reads Zhiyin's copy of
  the bundle** (ADR 0027). A compile, or a build of the format, whose output
  says the bundle's server did not answer is run once more from the copy,
  and every later one in that run of Zhiyin starts from it. A package fetched
  by name for the shared cache is then fetched from the copy too, which
  Tectonic reads through a `Tectonic.toml` naming it in a folder of Zhiyin's
  beside the shared cache, since that step takes no bundle option. Tectonic
  keeps what it reads under the bundle's own digest, so the copy and the
  original fill one cache. A compile that failed for any other reason is not
  run again. The PDF kept is a copy
  Zhiyin itself makes, with the permissions and the label of the folder it is
  kept in, and the workspace's own label never changes. Without containment, or when one of its folders
  cannot be given, LaTeX does not run, and the answer says why.
- Each engine lists the files it read: Typst all of them, Tectonic those it
  read from disk. When one lies outside the workspace, named so or carried
  there by a link, nothing the compiler made or printed is kept or shown,
  since an error can quote what it read. A name is checked as Windows opens
  it, without trailing dots and spaces, and a list that is not Tectonic's own
  for this compile, or names a file that cannot be found, counts as no list.
  When Typst wrote no list, its output is not shown. Tectonic goes on past a
  document's errors so that the list is still written, and those errors fail
  the compile though Tectonic reports success. It writes no list when a
  document has no pages, names a file that is not there, writes one where it
  may not, or reaches a hundred errors. Its errors are shown all the same, so
  they can quote what it reads confined: its folders, its packages and what
  every app container reads, never the person's own files outside the
  workspace. With no list, no PDF is kept.
- A failure reports the compiler's own diagnostics, not a bare exit code: each
  error or warning with its file, line and column relative to the workspace,
  the marked source line, and any hint. Every path in the workspace a
  diagnostic names is relative to it, wherever on its lines it stands. A
  diagnostic the compiler prints again, as Tectonic prints each warning of a
  pass it reruns, LaTeX's overfull and underfull boxes among them, is
  reported once.
- **A successful compile says what the PDF holds, read back from the file
  written** through the `readBack` it is given, which in the app is the
  contained process every PDF is read in, with its time limit (ADR 0019): the
  compiler holds no PDF reader of its own. The answer gives the engine and its version when the programs name it, the
  number of pages and their paper size (A3, A4, A5, Letter or Legal, portrait
  or landscape, or else in millimetres), each size counted when pages
  differ, and the size of the file. Text that runs to a page's edge is named
  by page and side and quoted as the page still shows it, since the glyphs
  past the edge are not read back and Typst reports no overflow at all: text
  whose glyphs come within a millimetre of the edge or cross it, or whose
  line ends within a word space of it, a quarter of its type size. Text set
  with no margin is named; large type inside an ordinary margin, as on slides
  and posters, is not. This is done on the first ten such pages, the rest
  counted, and on the first 500 pages, which the answer says when there are
  more. A PDF that cannot be read back, whose reader cannot start, or that is
  larger than 256 MB, is still
  the compile's success, and the answer says its pages could not be read and why. Typst's
  other overflow, such as text spilling out of a fixed-size box inside the
  page, and its missing glyphs are reported by nothing, which the tool's
  description says, and nor is a line whose baseline lies past the edge,
  since none of its glyphs is read back.
- LaTeX's warnings that Tectonic writes only in its log, such as a
  reference or citation it could not find, a font it replaced and what a
  package warns of, are in the answer, success or failure, each once and on
  one line. The log is kept in the compile's own folder, never in the
  workspace, and is read from its last pass, so a reference found on a later
  pass is not reported. Tectonic's advice to read its log is left out, since
  the answer already holds what the log warns of.
- Success means this compile wrote the PDF. The compiler writes it beside
  the output, under the same name in a folder of its own, and it is moved
  over the output only once the compile has succeeded: a compiler that
  reports success but wrote nothing is reported as a failure, however
  quickly one compile follows another, and a compile that fails leaves the
  PDF from before as it was. When the output cannot be replaced, the answer
  says why: that another program has it open when Windows says so; Windows'
  reason otherwise, adding that a program may hold it when Windows only
  refuses, as it does for a held file on a share. A folder left by a
  compile that never finished is removed by a later one an hour on.
- A compile may take three minutes, which the tool's description states, and
  print 64 MB. One that ends early says why: it took longer than its time
  limit, which it names, with the advice to compile a smaller part or make
  its figures fewer or lighter; it was stopped; or it printed more than the
  64 MB kept, with the advice to fix what repeats in its output.
- The PDF is declared as a change before the compile runs, as created or
  updated, so a PDF it overwrites is backed up and can be restored. After a
  successful compile it is declared as produced and appears among the work's
  files. A failed compile produces nothing.
- With no engine installed the connector offers no tool.
- The approval names the document and the file that will be written, and
  says, as a consequence of compiling, where packages come from: Tectonic
  downloads the packages a LaTeX document needs from relay.fullyjustified.net
  through data1b.fullyjustified.net, or from Zhiyin's copy on
  media.zhiyinagent.app when those cannot be reached, and Typst those a
  document imports from its package registry. It names no place
  the document is sent, since it is sent nowhere.
- A compile declares what it does: it reads the workspace, changes the
  workspace (the PDF is backed up first) or elsewhere for a PDF written
  outside, sends only to the fixed package registries, runs no code the
  document names, and brings nothing from outside back to the model.
- **The fonts a document can use are Typst's to name.** Listing them asks
  Typst itself, needs no folder, and declares that it reads nothing of the
  person's, changes nothing and sends nothing. Given words, it keeps the
  families that have any of them among the words of their name, ignoring
  case, so "SC" keeps Noto Sans SC and not Script, and says when none does
  and how many there are. Without Typst it is neither offered nor run.

## Testing notes

The runner is replaceable, so arguments, containment and reporting are tested
without a compiler. A real-engine test runs the real engines when
`ZHIYIN_TYPST` and `ZHIYIN_TECTONIC` point to them, and is skipped otherwise;
CI's gate installs both, so there it runs.
