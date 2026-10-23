import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { replaceFile } from "@zhiyin/file-replacement";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  ConnectionTool,
  ProducedFile,
  WritingConnection,
} from "@zhiyin/contract";
import {
  confine as confineProgram,
  forgetConfinement,
  runProcess as runProgram,
  type Confinement,
  type ProcessContainment as ProgramContainment,
  type RunProcess as RunProgram,
} from "@zhiyin/process-ownership";
import { realStaysBelow, staysBelow } from "@zhiyin/workspace-containment";
import {
  tectonicReadOutside,
  typstReadOutside,
  type ReadOutside,
} from "./compilation-reads.js";
import { latexPackages } from "./latex-packages.js";

/** The engines this connector can run, and where each comes from. */
export type CompilerPrograms = {
  /** The Typst binary, or nothing when it is not installed. */
  readonly typst?: string;
  /** The Tectonic binary, or nothing when it is not installed. */
  readonly tectonic?: string;
};

export type DocumentCompilerOptions = {
  /** The one folder documents are compiled in. No folder, no compiling. */
  readonly workspaceRoot: () => string | undefined;
  /** Where each engine is, asked again every time so an install is noticed. */
  readonly programs: () => Promise<CompilerPrograms>;
  /**
   * Where Tectonic keeps the TeX packages it downloads, which LaTeX reads and
   * Zhiyin alone changes, and the folders each compile changes.
   */
  readonly tectonicCache: string;
  readonly containment?: ProgramContainment;
  readonly run?: RunProgram;
  /** Grants LaTeX its folders ahead of a run; tests may replace it with the runner. */
  readonly confine?: (confinement: Confinement) => Promise<unknown>;
  /** How long one compilation may take. LaTeX fetches packages on first use. */
  readonly timeoutMs?: number;
};

const compileTool: ConnectionTool = {
  name: "compile_document",
  description:
    "Compile a Typst (.typ) or LaTeX (.tex) document in the workspace to PDF, and report the compiler's errors and warnings. The PDF is written beside the source unless another path is given.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path of the .typ or .tex document.",
      },
      output: {
        type: "string",
        description:
          "Workspace-relative path for the PDF. Defaults to the source path with a .pdf extension.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const noEngine =
  "No document compiler is installed. Install it from the Publishing plugin before compiling.";

type Engine = "typst" | "tectonic";

function engineFor(path: string): Engine | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".typ")) return "typst";
  if (lower.endsWith(".tex")) return "tectonic";
  return undefined;
}

type Request = {
  /** The workspace folder, with links resolved. */
  readonly root: string;
  readonly engine: Engine;
  readonly source: string;
  readonly output: string;
  readonly relativeSource: string;
  readonly relativeOutput: string;
};

/**
 * Where a path really is, every link followed in the part of it that exists:
 * a PDF not written yet is placed by the folder it would be written in.
 */
async function realPlace(path: string): Promise<string | undefined> {
  const rest: string[] = [];
  for (let existing = path; ;) {
    try {
      return join(await realpath(existing), ...rest);
    } catch (error) {
      const parent = dirname(existing);
      if (
        (error as { code?: unknown }).code !== "ENOENT" ||
        parent === existing
      )
        return undefined;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
}

const outsideFolder = "Documents are compiled inside the workspace folder.";

/**
 * What a call asks for, or why it cannot be asked for at all: checked by the
 * paths as written, then again where they really lead, so a link inside the
 * folder does not carry a read or a write out of it.
 */
async function requestFrom(
  root: string,
  args: unknown,
): Promise<Request | { readonly reason: string }> {
  const written = writtenRequest(root, args);
  if ("reason" in written) return written;
  const [realRoot, source, output] = await Promise.all([
    realpath(root).catch(() => undefined),
    realPlace(written.source),
    realPlace(written.output),
  ]);
  if (!realRoot) return { reason: "The workspace folder could not be read." };
  if (
    !source ||
    !output ||
    !realStaysBelow(realRoot, source) ||
    !realStaysBelow(realRoot, output)
  )
    return { reason: outsideFolder };
  // The file replaced is the one the output really is.
  if (!output.toLowerCase().endsWith(".pdf"))
    return { reason: "The compiled document is a PDF." };
  return {
    ...written,
    root: realRoot,
    source,
    output,
    relativeSource: relative(realRoot, source),
    relativeOutput: relative(realRoot, output),
  };
}

function writtenRequest(
  root: string,
  args: unknown,
): Omit<Request, "root"> | { readonly reason: string } {
  const record = (args ?? {}) as Record<string, unknown>;
  const path = record["path"];
  const output = record["output"];
  if (typeof path !== "string" || !path.trim())
    return { reason: "Name the document to compile." };
  if (output !== undefined && (typeof output !== "string" || !output.trim()))
    return { reason: "The output path must be a path." };
  const engine = engineFor(path);
  if (!engine)
    return {
      reason: "Only Typst (.typ) and LaTeX (.tex) documents can be compiled.",
    };
  const source = resolve(root, path);
  const target = resolve(
    root,
    typeof output === "string" && output.trim()
      ? output
      : `${path.slice(0, path.lastIndexOf("."))}.pdf`,
  );
  if (!staysBelow(root, source) || !staysBelow(root, target))
    return { reason: outsideFolder };
  if (!target.toLowerCase().endsWith(".pdf"))
    return { reason: "The compiled document is a PDF." };
  // Tectonic is given a folder and names the PDF after the source.
  const named = `${basename(source, extname(source))}.pdf`;
  if (
    engine === "tectonic" &&
    basename(target).toLowerCase() !== named.toLowerCase()
  )
    return {
      reason: `LaTeX writes the PDF under its source's name: give the output as ${named}, in any folder of the workspace.`,
    };
  return {
    engine,
    source,
    output: target,
    relativeSource: relative(root, source),
    relativeOutput: relative(root, target),
  };
}

/** The command that writes the PDF at `into`, which is named as the output is. */
function argumentsFor(request: Request, into: string): readonly string[] {
  const root = request.root;
  // Typst is told the project root, so a document names files in the
  // workspace only, and lists the files it read, which a link can carry out
  // of it. Tectonic is run untrusted, which disables shell escape, names its
  // PDF after the source, as the output is named, and lists the files it read
  // from disk. It goes on past a document's errors, so that list is written
  // even when the document fails.
  return request.engine === "typst"
    ? [
        "compile",
        "--root",
        root,
        "--deps",
        readsListIn(request.engine, into),
        request.source,
        into,
      ]
    : [
        "-Z",
        "continue-on-errors",
        "--untrusted",
        "--chatter",
        "minimal",
        "--outfmt",
        "pdf",
        "--outdir",
        dirname(into),
        "--makefile-rules",
        readsListIn(request.engine, into),
        request.source,
      ];
}

/** Where a compiler lists the files it read: beside the staged PDF. */
function readsListIn(engine: Engine, into: string): string {
  return join(dirname(into), engine === "typst" ? "reads.json" : "reads.mk");
}

/** The first file a compilation read outside the workspace, if any. */
function readOutside(
  request: Request,
  into: string,
): Promise<ReadOutside | "unknown" | undefined> {
  const list = readsListIn(request.engine, into);
  return request.engine === "typst"
    ? typstReadOutside(list, request.root)
    : tectonicReadOutside(list, {
        root: request.root,
        pdf: into,
        outdir: dirname(into),
        sourceFolder: dirname(request.source),
      });
}

/**
 * Whether Tectonic, gone on past a document's errors, met any: it then
 * reports success, says each error, and warns that it ignored them.
 */
function tectonicErrors(output: string): boolean {
  return /^error:|errors were issued by the TeX engine/m.test(output);
}

/**
 * The folder beside the output a compilation writes into, so the PDF is
 * moved over the one in the workspace only once it is complete.
 */
const stagingPrefix = ".zhiyin-compiling-";
/** A staging folder this old was left by a run that never finished. */
const abandonedAfterMs = 60 * 60_000;

/** Removes staging folders that runs which never finished left in `folder`. */
async function clearAbandoned(folder: string): Promise<void> {
  const entries = await readdir(folder).catch(() => []);
  for (const entry of entries) {
    if (!entry.startsWith(stagingPrefix)) continue;
    const path = join(folder, entry);
    const status = await stat(path).catch(() => undefined);
    if (status?.isDirectory() && Date.now() - status.mtimeMs > abandonedAfterMs)
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A time limit as a person reads it: "3 minutes", "45 seconds". */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds % 60 !== 0 || seconds < 60)
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = seconds / 60;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function shortened(value: string, maximum = 8_000): string {
  const trimmed = value.trim();
  return trimmed.length > maximum
    ? `${trimmed.slice(0, maximum)}\n… the rest of the compiler's output was too long to include.`
    : trimmed;
}

/**
 * The lines a person or a model needs: the diagnostics, not the chatter.
 * Typst prints where an error is on the lines after it — the location, the
 * source line marked, and any hint — so those are kept with it, the folder
 * part of the location made relative.
 */
export function diagnosticsFrom(output: string, root = ""): readonly string[] {
  const kept: string[] = [];
  let inDiagnostic = false;
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*(error|warning)\b/i.test(line)) {
      inDiagnostic = true;
      kept.push(line.trim());
    } else if (inDiagnostic && /^\s*(?:┌─|│|\d+\s*│|= )/.test(line))
      kept.push(line.startsWith(" ") ? relativeLocation(line, root) : line);
    else inDiagnostic = false;
  }
  return kept;
}

function relativeLocation(line: string, root: string): string {
  if (!root || !line.includes("┌─")) return line;
  let end = root.length;
  while (end > 0 && "\\/".includes(root[end - 1]!)) end -= 1;
  const folder = `${root.slice(0, end)}${sep}`;
  return line.replace(`\\\\?\\${folder}`, "").replace(folder, "");
}

/** What LaTeX is run as: its purpose, with the internet to fetch packages. */
const latex = { purpose: "latex", network: true } as const;

/**
 * A compile's home, inside its own folder: nothing it leaves there, such as
 * Tectonic's settings, reaches a later compile.
 */
function homeIn(folder: string): string {
  return join(folder, "home");
}

const notContained =
  "Zhiyin could not start the compiler inside the limits it runs within, so it did not run.";

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * One compiler for every folder: the LaTeX package cache, and the lock that
 * keeps two changes of it apart, are shared, and each folder is offered a
 * connection of its own that compiles there. ADR 0008.
 */
export function documentCompilers(
  options: Omit<DocumentCompilerOptions, "workspaceRoot">,
): (workspaceRoot: () => string | undefined) => WritingConnection {
  const run = options.run ?? runProgram;
  const confine = options.confine ?? confineProgram;
  // Tectonic runs confined: it reads the workspace, its own installation and
  // the shared packages, and changes only a folder of this compile's own,
  // outside the workspace, which holds its copy of the package cache and its
  // PDF.
  const packages = latexPackages({
    cache: options.tectonicCache,
    run,
    ...(options.containment ? { containment: options.containment } : {}),
    grant: async (folder) => {
      await confine({
        ...latex,
        home: homeIn(folder),
        read: [],
        write: [folder],
      });
    },
    // Each compile's home has a container of its own, gone with the folder.
    release: (folder) => forgetConfinement(latex.purpose, homeIn(folder)),
  });
  const timeoutMs = options.timeoutMs ?? 180_000;
  // Which file each successful result wrote, kept beside the result rather
  // than inside it, so nothing the model reads changes.
  const wrote = new WeakMap<object, ProducedFile>();

  const ready = async (): Promise<CompilerPrograms> => {
    const programs = await options.programs();
    if (!programs.typst && !programs.tectonic) throw new Error(noEngine);
    return programs;
  };

  return (workspaceRoot) => ({
    /**
     * Asked again on every look, so installing an engine is noticed without a
     * restart — and so a build with neither engine offers no tool at all.
     */
    async listTools() {
      await ready();
      return [compileTool];
    },
    async inspect(name, args) {
      if (name !== compileTool.name)
        return { ok: false, reason: `The tool “${name}” is not available.` };
      const root = workspaceRoot();
      if (!root)
        return { ok: false, reason: "Choose a folder before compiling." };
      const request = await requestFrom(root, args);
      if ("reason" in request) return { ok: false, reason: request.reason };
      const programs = await options.programs();
      if (!programs[request.engine])
        return {
          ok: false,
          reason:
            request.engine === "typst"
              ? "Typst is not installed. Install it from the Publishing plugin."
              : "Tectonic is not installed. Install it from the Publishing plugin.",
        };
      const exists = await stat(request.output).then(
        () => true,
        () => false,
      );
      return {
        ok: true,
        access: "change",
        scope: "workspace",
        // Declared so a PDF it compiles over is kept, and can be restored.
        changes: [
          {
            path: request.relativeOutput.split(sep).join("/"),
            change: exists ? "updated" : "created",
            omitted: "Its contents are known only once it is compiled.",
          },
        ],
        action:
          request.engine === "typst"
            ? "Compile a Typst document"
            : "Compile a LaTeX document",
        target: request.relativeSource,
        command: `${request.engine} ${request.relativeSource} → ${request.relativeOutput}`,
        // What reaches the network is the engine asking for packages, not
        // the document, so this is a consequence, not a destination.
        detail:
          request.engine === "tectonic"
            ? "Tectonic downloads the TeX packages this document needs from its package server."
            : "Typst downloads the packages this document imports from its package registry.",
        identity: JSON.stringify({
          engine: request.engine,
          source: request.source,
          output: request.output,
        }),
      };
    },
    async callTool(name, args, signal) {
      if (name !== compileTool.name)
        return textResult(`Unknown tool “${name}”.`, true);
      const root = workspaceRoot();
      if (!root) return textResult("Choose a folder before compiling.", true);
      const request = await requestFrom(root, args);
      if ("reason" in request) return textResult(request.reason, true);
      let programs: CompilerPrograms;
      try {
        programs = await ready();
      } catch {
        return textResult(noEngine, true);
      }
      const executable = programs[request.engine];
      if (!executable)
        return textResult(
          request.engine === "typst"
            ? "Typst is not installed."
            : "Tectonic is not installed.",
          true,
        );
      const tectonic = request.engine === "tectonic";
      // LaTeX runs only confined, and only a contained run can be.
      if (tectonic && !options.containment)
        return textResult(notContained, true);
      const existed = await stat(request.output).then(
        () => true,
        () => false,
      );
      // Written aside and moved over the PDF once complete: what the
      // compiler wrote is exactly what is found there, and a compilation
      // that fails leaves the PDF from before as it was.
      const folder = dirname(request.output);
      await clearAbandoned(folder);
      let staging: string;
      try {
        staging = await mkdtemp(join(folder, stagingPrefix));
      } catch (error) {
        return textResult(
          `Zhiyin could not prepare to write ${request.relativeOutput}: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
      /** The folder of this LaTeX compile's own, outside the workspace. */
      let ownFolder: string | undefined;
      try {
        // Tectonic names the PDF after the source it really reads, which a
        // link can name otherwise, and writes it in a folder of its own.
        const kept = join(
          staging,
          tectonic
            ? `${basename(request.source, extname(request.source))}.pdf`
            : basename(request.output),
        );
        let own;
        try {
          own = tectonic
            ? await packages.prepare(executable, signal)
            : undefined;
          ownFolder = own?.folder;
        } catch (error) {
          return textResult(
            `Zhiyin could not prepare the folders LaTeX writes in: ${error instanceof Error ? error.message : String(error)}`,
            true,
          );
        }
        const staged = own ? join(own.folder, basename(kept)) : kept;
        const { exitCode, stdout, stderr, ending, failure, reason } = await run(
          {
            executable,
            arguments: argumentsFor(request, staged),
            cwd: request.root,
            timeoutMs,
            ...(signal ? { signal } : {}),
            ...(options.containment
              ? { containment: options.containment }
              : {}),
            ...(own
              ? {
                  environment: own.environment,
                  confinement: {
                    ...latex,
                    home: homeIn(own.folder),
                    read: [request.root, dirname(executable), own.shared],
                    write: [own.folder],
                  },
                }
              : {}),
          },
        );
        if (failure === "containment") return textResult(notContained, true);
        if (failure === "confinement")
          return textResult(
            `Zhiyin could not give LaTeX the folders it works in, so it did not run. ${reason ?? ""}`.trim(),
            true,
          );
        // What a document read outside the workspace is neither kept nor
        // shown, since an error can quote it.
        const outside = await readOutside(request, staged);
        if (outside !== undefined && outside !== "unknown")
          return textResult(
            outside.throughLink
              ? `The document reads ${outside.path}, which a link carries outside the workspace folder, so nothing the compiler made or said is kept or shown.`
              : `The document reads ${outside.path}, outside the workspace folder, so nothing the compiler made or said is kept or shown.`,
            true,
          );
        // LaTeX lists what it read only when it finishes, and stops before
        // that on a file that is not there, a write refused, no pages or a
        // hundred errors. What it printed is shown all the same: confined, it
        // could read only its folders and what every app container reads,
        // never the person's own files outside the workspace.
        const unknown = outside === "unknown";
        const hidden = unknown && !tectonic;
        const output = hidden
          ? "Its output is not shown, because Zhiyin could not tell which files it read."
          : `${stdout}\n${stderr}`;
        const diagnostics = hidden ? [] : diagnosticsFrom(output, request.root);
        const failed = exitCode !== 0 || (tectonic && tectonicErrors(output));
        if (unknown && !failed)
          return textResult(
            `The compiler did not say which files it read, so ${request.relativeOutput} is not kept.`,
            true,
          );
        if (failed)
          return textResult(
            shortened(
              [
                ending === "timeout"
                  ? `The compiler took longer than ${duration(timeoutMs)}, the most one compilation may take, so it was stopped.`
                  : ending === "stopped"
                    ? "The compilation was stopped before it finished."
                    : ending === "outputLimit"
                      ? "The compiler printed more than Zhiyin keeps, so it was stopped."
                      : exitCode === null
                        ? "The compiler did not finish."
                        : exitCode === 0
                          ? "The compiler reported errors."
                          : `The compiler reported errors (exit code ${exitCode}).`,
                ...(diagnostics.length ? diagnostics : [output]),
              ].join("\n"),
            ),
            true,
          );
        const written = await stat(staged).catch(() => undefined);
        if (!written?.isFile())
          return textResult(
            `The compiler reported success but wrote no ${request.relativeOutput}.`,
            true,
          );
        // A file LaTeX wrote keeps the permissions of its compile's folder and
        // the label of a program in a container, so the PDF kept is a copy
        // Zhiyin makes, with the permissions of the folder it is kept in.
        try {
          await replaceFile(request.output, { copyOf: staged });
        } catch (error) {
          // File replacement names EBUSY a file another program will not let
          // go of. Where Windows cannot rename over an open file, as on a
          // share, a held file is only refused, as a folder or a read-only
          // file is, so a refusal names both.
          const code = (error as { code?: unknown }).code;
          const reason = error instanceof Error ? error.message : String(error);
          return textResult(
            code === "EBUSY"
              ? `The compiler wrote ${request.relativeOutput}, but the one in the workspace could not be replaced. Another program, such as a PDF viewer, may have it open: close it, then compile again.`
              : code === "EPERM" || code === "EACCES"
                ? `The compiler wrote ${request.relativeOutput}, but the one in the workspace could not be replaced: ${reason}. If another program, such as a PDF viewer, has it open, close it, then compile again.`
                : `The compiler wrote ${request.relativeOutput}, but the one in the workspace could not be replaced: ${reason}`,
            true,
          );
        }
        const result = textResult(
          shortened(
            [
              `Wrote ${request.relativeOutput} (${Math.max(1, Math.round(written.size / 1024))} KB).`,
              ...diagnostics,
            ].join("\n"),
          ),
        );
        wrote.set(result, {
          path: request.relativeOutput.split(sep).join("/"),
          change: existed ? "updated" : "created",
          bytes: written.size,
        });
        return result;
      } finally {
        await rm(staging, { recursive: true, force: true }).catch(
          () => undefined,
        );
        if (ownFolder) {
          await packages
            .adopt(ownFolder, executable, signal)
            .catch(() => undefined);
          await rm(ownFolder, { recursive: true, force: true }).catch(
            () => undefined,
          );
          forgetConfinement(latex.purpose, homeIn(ownFolder));
        }
      }
    },
    produced(_name, _args, value) {
      const file =
        value && typeof value === "object" ? wrote.get(value) : undefined;
      return file ? [file] : [];
    },
    describeResult(_name, _args, result) {
      if (result.ok) return [];
      return [{ kind: "text", label: "Compiler output", text: result.reason }];
    },
    async close() {},
  });
}

/** The compiler for one folder. */
export function documentCompiler(
  options: DocumentCompilerOptions,
): WritingConnection {
  return documentCompilers(options)(options.workspaceRoot);
}
