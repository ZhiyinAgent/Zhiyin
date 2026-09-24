/**
 * A Python environment for one-off data work, offered as a built-in
 * connector. It is `uv`-managed and kept apart from a person's own projects:
 * every `uv` command runs in the sandbox folder, so nothing in the workspace
 * decides what the sandbox contains.
 *
 * Boundaries and invariants: docs/architecture/features/python-sandbox/README.md
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import {
  runProcess as runProgram,
  type ProcessContainment as ProgramContainment,
  type ProcessRun as ProgramRun,
  type RunProcess as RunProgram,
} from "@zhiyin/process-ownership";

export type {
  ProcessContainer as ProgramContainer,
  ProcessContainment as ProgramContainment,
  ProcessRun as ProgramRun,
  RunProcess as RunProgram,
} from "@zhiyin/process-ownership";

export type SandboxTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

export type SandboxAutomation = {
  inspect(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ToolCallInspection>;
  describeResult(
    name: string,
    args: Readonly<Record<string, unknown>>,
    result: ToolInvocationResult,
  ): readonly ActionDetail[];
  listTools(): Promise<readonly SandboxTool[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
};

export type PythonSandboxOptions = {
  /** The folder scripts read and write in. No folder, no running. */
  readonly workspaceRoot: () => string | undefined;
  /** Where the sandbox environment lives, outside any workspace. */
  readonly directory: string;
  /** The `uv` binary, or nothing when it is not installed. */
  readonly uv: () => Promise<string | undefined>;
  readonly containment?: ProgramContainment;
  readonly run?: RunProgram;
  /** How long one script may run. Preparing the environment gets its own. */
  readonly timeoutMs?: number;
  readonly prepareTimeoutMs?: number;
  readonly pythonVersion?: string;
  readonly packages?: readonly string[];
};

/** What a data-science sandbox is expected to have on hand. */
export const defaultPackages = [
  "pandas",
  "polars",
  "numpy",
  "scipy",
  "matplotlib",
  "seaborn",
  "statsmodels",
] as const;

const notInstalled =
  "The Python sandbox is not installed. Install it from the Data Science plugin before running scripts.";

const tools: readonly SandboxTool[] = [
  {
    name: "run_python",
    description:
      "Run a Python script in Zhiyin's sandbox environment, with the workspace folder as its working directory. Give either code to run or the path of a script in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to run." },
        path: {
          type: "string",
          description: "Workspace-relative path of a .py file to run instead.",
        },
        arguments: {
          type: "array",
          items: { type: "string" },
          description: "Command-line arguments for the script.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "install_python_package",
    description:
      "Add packages to Zhiyin's Python sandbox. This changes only the sandbox, never a project's own environment.",
    inputSchema: {
      type: "object",
      properties: {
        packages: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Package names, optionally with a version specifier.",
        },
      },
      required: ["packages"],
      additionalProperties: false,
    },
  },
  {
    name: "reset_python_sandbox",
    description:
      "Delete Zhiyin's Python sandbox and build it again with its default packages. Anything installed into it is lost.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const packageName =
  /^[A-Za-z0-9._-]+(\[[A-Za-z0-9,._-]+\])?([<>=!~]=?[^\s]+)?$/;

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: text || "(no output)" }],
    ...(isError ? { isError: true } : {}),
  };
}

function shortened(value: string, maximum = 16_000): string {
  const trimmed = value.trim();
  return trimmed.length > maximum
    ? `${trimmed.slice(0, maximum)}\n… the rest of the output was too long to include.`
    : trimmed;
}

/**
 * What a run printed, as whole as the process layer kept it: its start and its
 * end. What the model is shown of it is bounded where every tool's result is,
 * and the rest kept to read again; a cut here would lose a traceback's end.
 */
function reported(run: ProgramRun): string {
  return `${run.stdout}\n${run.stderr}`.trim();
}

/**
 * Python on Windows reads and writes in the console's code page unless told
 * otherwise, so a script printing "é" or reading a UTF-8 file fails or garbles
 * it. These make UTF-8 its default for files and for what it prints.
 */
function pythonEnvironment(): Record<string, string | undefined> {
  return { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
}

export function pythonSandbox(
  options: PythonSandboxOptions,
): SandboxAutomation {
  const run = options.run ?? runProgram;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const prepareTimeoutMs = options.prepareTimeoutMs ?? 900_000;
  const pythonVersion = options.pythonVersion ?? "3.13";
  const packages = options.packages ?? defaultPackages;
  const venv = join(options.directory, ".venv");
  const interpreter = join(venv, "Scripts", "python.exe");
  const scripts = join(options.directory, "scripts");

  const invoke = (
    executable: string,
    args: readonly string[],
    cwd: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ProgramRun> =>
    run({
      executable,
      arguments: args,
      cwd,
      timeoutMs: limit,
      ...(signal ? { signal } : {}),
      ...(options.containment ? { containment: options.containment } : {}),
      environment: pythonEnvironment(),
    });

  /**
   * Builds the environment if it is not there yet. Every `uv` command runs in
   * the sandbox folder, so a `pyproject.toml` in the person's workspace can
   * never decide what the sandbox installs.
   */
  async function prepare(
    uv: string,
    signal?: AbortSignal,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  > {
    if (await stat(interpreter).catch(() => undefined)) return { ok: true };
    await mkdir(options.directory, { recursive: true });
    const created = await invoke(
      uv,
      ["venv", "--python", pythonVersion, venv],
      options.directory,
      prepareTimeoutMs,
      signal,
    );
    if (created.exitCode !== 0)
      return {
        ok: false,
        reason: `The sandbox environment could not be created.\n${reported(created)}`,
      };
    const installed = await invoke(
      uv,
      ["pip", "install", "--python", interpreter, ...packages],
      options.directory,
      prepareTimeoutMs,
      signal,
    );
    if (installed.exitCode !== 0)
      return {
        ok: false,
        reason: `The sandbox packages could not be installed.\n${reported(installed)}`,
      };
    return { ok: true };
  }

  async function ready(): Promise<string> {
    const uv = await options.uv();
    if (!uv) throw new Error(notInstalled);
    return uv;
  }

  return {
    /** Asked again every look, so installing uv is noticed without a restart. */
    async listTools() {
      await ready();
      return tools;
    },

    async inspect(name, args) {
      const root = options.workspaceRoot();
      if (!root)
        return { ok: false, reason: "Choose a folder before running Python." };
      if (!(await options.uv())) return { ok: false, reason: notInstalled };
      const prepared = Boolean(await stat(interpreter).catch(() => undefined));
      const preparing = prepared
        ? {}
        : {
            destination:
              "Preparing the sandbox downloads Python and its default packages from python.org's package index.",
          };
      if (name === "run_python") {
        const code = args["code"];
        const path = args["path"];
        if (typeof code !== "string" && typeof path !== "string")
          return { ok: false, reason: "Give code to run or a script path." };
        return {
          ok: true,
          action: "Run a Python script",
          target: typeof path === "string" ? path : "a script",
          command:
            typeof code === "string"
              ? shortened(code, 4_000)
              : `python ${String(path)}`,
          effect: `Runs in ${root}, and may read and write files there.`,
          ...preparing,
        };
      }
      if (name === "install_python_package") {
        const asked = args["packages"];
        if (!Array.isArray(asked) || !asked.length)
          return { ok: false, reason: "Name at least one package." };
        if (
          !asked.every(
            (item) => typeof item === "string" && packageName.test(item),
          )
        )
          return {
            ok: false,
            reason: "Name packages by name and version only.",
          };
        return {
          ok: true,
          action: "Add packages to the Python sandbox",
          target: asked.join(", "),
          command: `uv pip install ${asked.join(" ")}`,
          effect: "Changes only Zhiyin's sandbox, not a project's environment.",
          destination: "Packages are downloaded from pypi.org.",
        };
      }
      if (name === "reset_python_sandbox")
        return {
          ok: true,
          action: "Rebuild the Python sandbox",
          target: "Zhiyin's Python sandbox",
          command: "uv venv --clean",
          effect:
            "Deletes the sandbox and its installed packages, then builds it again.",
          destination: "Packages are downloaded from pypi.org.",
        };
      return { ok: false, reason: `The tool “${name}” is not available.` };
    },

    async callTool(name, args, signal) {
      const root = options.workspaceRoot();
      if (!root)
        return textResult("Choose a folder before running Python.", true);
      let uv: string;
      try {
        uv = await ready();
      } catch {
        return textResult(notInstalled, true);
      }

      if (name === "reset_python_sandbox") {
        await rm(options.directory, { recursive: true, force: true });
        const built = await prepare(uv, signal);
        return built.ok
          ? textResult("The sandbox was rebuilt with its default packages.")
          : textResult(built.reason, true);
      }

      const built = await prepare(uv, signal);
      if (!built.ok) return textResult(built.reason, true);

      if (name === "install_python_package") {
        const asked = args["packages"];
        if (
          !Array.isArray(asked) ||
          !asked.length ||
          !asked.every(
            (item) => typeof item === "string" && packageName.test(item),
          )
        )
          return textResult("Name packages by name and version only.", true);
        const installed = await invoke(
          uv,
          ["pip", "install", "--python", interpreter, ...(asked as string[])],
          options.directory,
          prepareTimeoutMs,
          signal,
        );
        return installed.exitCode === 0
          ? textResult(`Installed ${asked.join(", ")}.\n${reported(installed)}`)
          : textResult(reported(installed), true);
      }

      if (name !== "run_python")
        return textResult(`Unknown tool “${name}”.`, true);

      const code = args["code"];
      const path = args["path"];
      const extra = args["arguments"];
      if (extra !== undefined && !Array.isArray(extra))
        return textResult("Script arguments must be a list of text.", true);
      const scriptArguments = ((extra as unknown[]) ?? []).map(String);
      let script: string;
      let temporary: string | undefined;
      if (typeof code === "string" && code.trim()) {
        await mkdir(scripts, { recursive: true });
        temporary = join(scripts, `${randomUUID()}.py`);
        await writeFile(temporary, code, "utf8");
        script = temporary;
      } else if (typeof path === "string" && path.trim()) {
        if (!path.toLowerCase().endsWith(".py"))
          return textResult("Only .py files can be run.", true);
        script = join(root, path);
      } else {
        return textResult("Give code to run or a script path.", true);
      }
      try {
        const ran = await invoke(
          interpreter,
          [script, ...scriptArguments],
          root,
          timeoutMs,
          signal,
        );
        if (ran.exitCode === null)
          return textResult(
            `The script did not finish.\n${reported(ran)}`,
            true,
          );
        return ran.exitCode === 0
          ? textResult(reported(ran))
          : textResult(
              `The script exited with code ${ran.exitCode}.\n${reported(ran)}`,
              true,
            );
      } finally {
        if (temporary) await rm(temporary, { force: true });
      }
    },

    describeResult(_name, _args, result) {
      return result.ok
        ? []
        : [{ kind: "text", label: "Python output", text: result.reason }];
    },

    async close() {},
  };
}
