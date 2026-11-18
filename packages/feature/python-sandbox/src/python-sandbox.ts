import { join } from "node:path";
import type { OfferedConnection } from "@zhiyin/contract";
import {
  runProcess as runProgram,
  type ProcessContainment as ProgramContainment,
  type RunProcess as RunProgram,
} from "@zhiyin/sandbox";
import { defaultLock, type PackageLock } from "./default-packages.js";
import { environmentCommands } from "./environment-commands.js";
import { environmentMaking } from "./environment-making.js";
import { defaultEnvironment, Environments } from "./environments.js";
import { keptEnvironments, type KeptEnvironment } from "./kept-environments.js";
import { keptPython, type KeptPython } from "./kept-runs.js";
import { scriptRunner } from "./script-run.js";
import { networkDetail } from "./network-report.js";
import { askedHosts, notInstalled, textResult } from "./tool-calls.js";
import { toolInspection } from "./tool-inspection.js";
import { toolsFor } from "./tools.js";

export type { KeptEnvironment } from "./kept-environments.js";
export type { KeptPython, KeptPythonRun } from "./kept-runs.js";

/** The programs the Python environment needs installed before it can run, by toolchain id. */
export const pythonPrograms = ["uv"] as const;

export type PythonSandboxOptions = {
  /** The folder scripts read and write in. No folder, no running. */
  readonly workspaceRoot: () => string | undefined;
  /** Where the environments live, outside any workspace. */
  readonly directory: string;
  /** The `uv` binary, or nothing when it is not installed. */
  readonly uv: () => Promise<string | undefined>;
  readonly containment?: ProgramContainment;
  readonly run?: RunProgram;
  /** How long one script may run. Making an environment or installing gets its own. */
  readonly timeoutMs?: number;
  readonly prepareTimeoutMs?: number;
  /**
   * The default environment's packages and its Python, which is also that of
   * an environment made without naming its own.
   */
  readonly lock?: PackageLock;
  /** The environments other features keep here, each made as its connector is installed. */
  readonly keptEnvironments?: readonly KeptEnvironment[];
  /** Zhiyin's own folders, which no script is given, whatever is approved. */
  readonly protect?: readonly string[];
};

/**
 * One Python sandbox for every folder: its environments, and the locks that
 * keep two changes of one environment apart, are shared, and each folder is
 * offered a connection of its own that runs there (ADR 0008). Zhiyin's own
 * features run its kept environments through `kept`.
 */
export function pythonEnvironments(
  options: Omit<PythonSandboxOptions, "workspaceRoot">,
): {
  readonly connection: (
    workspaceRoot: () => string | undefined,
  ) => OfferedConnection;
  readonly kept: KeptPython;
} {
  const run = options.run ?? runProgram;
  const lock = options.lock ?? defaultLock;
  const contained = options.containment
    ? { containment: options.containment }
    : {};
  /** Those another feature keeps, by name. */
  const connectorMade = new Map(
    (options.keptEnvironments ?? []).map((own) => [own.name, own]),
  );
  /** Zhiyin's own environments, each made from its lock and never by name. */
  const kept = new Map<string, PackageLock>([
    [defaultEnvironment, lock],
    ...[...connectorMade.values()].map((own) => [own.name, own.lock] as const),
  ]);
  /** The Pythons environments are made from, Zhiyin's own and no one else's. */
  const python = join(options.directory, "python");
  const environmentsFolder = join(options.directory, "environments");
  const environments = new Environments(environmentsFolder);
  const homes = join(options.directory, "homes");
  /** Where one environment's installs keep pip's cache, apart from every other's. */
  const installHome = (name: string) => join(homes, `install-${name}`);

  const prepareTimeoutMs = options.prepareTimeoutMs ?? 900_000;
  const making = environmentMaking({
    directory: options.directory,
    run,
    prepareTimeoutMs,
    ...contained,
    environments,
    environmentsFolder,
    python,
    kept,
    lock,
    installHome,
  });
  const lifecycle = keptEnvironments({
    directory: options.directory,
    uv: options.uv,
    python,
    environments,
    kept,
    connectorMade,
    build: making.build,
  });
  const timeoutMs = options.timeoutMs ?? 300_000;
  const tools = toolsFor(timeoutMs, prepareTimeoutMs);
  const runScript = scriptRunner({
    run,
    ...contained,
    timeoutMs,
    protect: options.protect ?? [],
    python,
    scripts: join(options.directory, "scripts"),
    homes,
    environments,
    kept,
    lifecycle,
  });
  const commands = environmentCommands({
    environments,
    kept,
    connectorMade,
    lock,
    making,
    installHome,
    lifecycle,
  });
  const inspect = toolInspection({
    uv: options.uv,
    protect: options.protect ?? [],
    environments,
    kept,
    connectorMade,
    lifecycle,
    commands,
  });

  async function ready(): Promise<string> {
    const uv = await options.uv();
    if (!uv) throw new Error(notInstalled);
    return uv;
  }

  const connection = (
    workspaceRoot: () => string | undefined,
  ): OfferedConnection => ({
    /** Asked again every look, so installing uv is noticed without a restart. */
    async listTools() {
      await ready();
      return tools;
    },

    inspect: (name, args) => inspect(name, args, workspaceRoot()),

    async callTool(name, args, signal, binding) {
      let uv: string;
      try {
        uv = await ready();
      } catch {
        return textResult(notInstalled, true);
      }
      switch (name) {
        case "run_python": {
          const root = workspaceRoot();
          if (!root)
            return textResult("Choose a folder before running Python.", true);
          return runScript(root, args, uv, signal, binding);
        }
        case "install_python_package":
          return commands.install(args, uv, signal);
        case "create_python_environment":
          return commands.create(args, uv, signal);
        case "list_python_environments":
          return commands.list();
        case "remove_python_environment":
          return commands.remove(args);
        case "reset_python_environment":
          return commands.reset(args, uv, signal);
        default:
          return textResult(`Unknown tool “${name}”.`, true);
      }
    },

    describeResult(name, args, result) {
      const named = name === "run_python" ? askedHosts(args) : undefined;
      const network = networkDetail(
        named?.ok === true && named.hosts.length > 0,
        result,
      );
      return result.ok
        ? network
        : [
            { kind: "text", label: "Python output", text: result.reason },
            ...network,
          ];
    },

    async close() {},
  });

  return {
    connection,
    kept: keptPython({
      uv: options.uv,
      run,
      ...contained,
      python,
      environments,
      kept,
      lifecycle,
    }),
  };
}

/**
 * One Python sandbox for every folder, as `pythonEnvironments` makes it, by
 * the connection each folder is offered.
 */
export function pythonSandboxes(
  options: Omit<PythonSandboxOptions, "workspaceRoot">,
): (workspaceRoot: () => string | undefined) => OfferedConnection {
  return pythonEnvironments(options).connection;
}

/** The sandbox for one folder. */
export function pythonSandbox(
  options: PythonSandboxOptions,
): OfferedConnection {
  return pythonSandboxes(options)(options.workspaceRoot);
}
