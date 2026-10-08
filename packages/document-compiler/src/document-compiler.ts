import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  ActionDetail,
  ProducedFile,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import {
  runProcess as runProgram,
  type ProcessContainment as ProgramContainment,
  type RunProcess as RunProgram,
} from "@zhiyin/process-ownership";
import { staysBelow } from "@zhiyin/workspace-containment";

/** The engines this connector can run, and where each comes from. */
export type CompilerPrograms = {
  /** The Typst binary, or nothing when it is not installed. */
  readonly typst?: string;
  /** The Tectonic binary, or nothing when it is not installed. */
  readonly tectonic?: string;
};

export type CompilerTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

export type CompilerAutomation = {
  inspect(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ToolCallInspection>;
  describeResult(
    name: string,
    args: Readonly<Record<string, unknown>>,
    result: ToolInvocationResult,
  ): readonly ActionDetail[];
  /** The PDF a call wrote, given the value that call returned. */
  produced(
    name: string,
    args: Readonly<Record<string, unknown>>,
    value: unknown,
  ): readonly ProducedFile[];
  listTools(): Promise<readonly CompilerTool[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
};

export type DocumentCompilerOptions = {
  /** The one folder documents are compiled in. No folder, no compiling. */
  readonly workspaceRoot: () => string | undefined;
  /** Where each engine is, asked again every time so an install is noticed. */
  readonly programs: () => Promise<CompilerPrograms>;
  readonly containment?: ProgramContainment;
  readonly run?: RunProgram;
  /** How long one compilation may take. LaTeX fetches packages on first use. */
  readonly timeoutMs?: number;
};

const compileTool: CompilerTool = {
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
  readonly engine: Engine;
  readonly source: string;
  readonly output: string;
  readonly relativeSource: string;
  readonly relativeOutput: string;
};

/** What a call asks for, or why it cannot be asked for at all. */
function requestFrom(
  root: string,
  args: unknown,
): Request | { readonly reason: string } {
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
    return { reason: "Documents are compiled inside the workspace folder." };
  if (!target.toLowerCase().endsWith(".pdf"))
    return { reason: "The compiled document is a PDF." };
  return {
    engine,
    source,
    output: target,
    relativeSource: relative(root, source),
    relativeOutput: relative(root, target),
  };
}

function argumentsFor(request: Request, root: string): readonly string[] {
  // Typst is told the project root, so a document can only read from the
  // workspace. Tectonic is run untrusted, which disables shell escape.
  return request.engine === "typst"
    ? ["compile", "--root", root, request.source, request.output]
    : [
        "--untrusted",
        "--chatter",
        "minimal",
        "--outfmt",
        "pdf",
        "--outdir",
        request.output.slice(0, request.output.lastIndexOf(sep)) || root,
        request.source,
      ];
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

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

export function documentCompiler(
  options: DocumentCompilerOptions,
): CompilerAutomation {
  const run = options.run ?? runProgram;
  const timeoutMs = options.timeoutMs ?? 180_000;
  // Which file each successful result wrote, kept beside the result rather
  // than inside it, so nothing the model reads changes.
  const wrote = new WeakMap<object, ProducedFile>();

  const ready = async (): Promise<CompilerPrograms> => {
    const programs = await options.programs();
    if (!programs.typst && !programs.tectonic) throw new Error(noEngine);
    return programs;
  };

  return {
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
      const root = options.workspaceRoot();
      if (!root)
        return { ok: false, reason: "Choose a folder before compiling." };
      const request = requestFrom(root, args);
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
        ...(request.engine === "tectonic"
          ? {
              destination:
                "Tectonic downloads the TeX packages this document needs from its package server.",
            }
          : {}),
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
      const root = options.workspaceRoot();
      if (!root) return textResult("Choose a folder before compiling.", true);
      const request = requestFrom(root, args);
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
      const existed = await stat(request.output).then(
        () => true,
        () => false,
      );
      const { exitCode, stdout, stderr } = await run({
        executable,
        arguments: argumentsFor(request, root),
        cwd: root,
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(options.containment ? { containment: options.containment } : {}),
      });
      const output = `${stdout}\n${stderr}`;
      const diagnostics = diagnosticsFrom(output, root);
      if (exitCode !== 0)
        return textResult(
          shortened(
            [
              exitCode === null
                ? "The compiler did not finish."
                : `The compiler reported errors (exit code ${exitCode}).`,
              ...(diagnostics.length ? diagnostics : [output]),
            ].join("\n"),
          ),
          true,
        );
      const written = await stat(request.output).catch(() => undefined);
      if (!written)
        return textResult(
          `The compiler reported success but wrote no ${request.relativeOutput}.`,
          true,
        );
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
  };
}
