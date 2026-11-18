/**
 * Running a script the model wrote: from a copy no other script can change,
 * in the workspace, through its environment's interpreter, confined to the
 * workspace and the folders outside it the call was approved for.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  ProcessContainment as ProgramContainment,
  ProcessRun as ProgramRun,
  RunProcess as RunProgram,
} from "@zhiyin/sandbox";
import { outsideFolders } from "@zhiyin/workspace-containment";
import type { PackageLock } from "./default-packages.js";
import { unconfined } from "./environment-making.js";
import type { Environments } from "./environments.js";
import type { KeptLifecycle } from "./kept-environments.js";
import {
  duration,
  largestOutput,
  pythonEnvironment,
  reported,
} from "./programs.js";
import { declaredEncodingRefusal } from "./script-approval.js";
import {
  asTheFile,
  bindingRefusal,
  readScript,
  scriptSource,
} from "./script-files.js";
import { networkSection } from "./network-report.js";
import { keepStartup } from "./startup.js";
import {
  askedHosts,
  chosenEnvironment,
  missing,
  nameEnvironment,
  textResult,
  type TextResult,
} from "./tool-calls.js";

/**
 * The codes Windows ends a crashed process with, which Python's own errors
 * never use: what each means, as a model can act on it.
 */
const crashes: Readonly<Record<number, string>> = {
  0xc0000005: "an access violation, as a broken native extension makes",
  0xc00000fd: "a stack overflow, as deep recursion makes",
  0xc0000409: "a check inside a native library that failed",
  0xc0000017: "running out of memory",
  0xc000013a: "a stop from the console",
};

/** How a script that ran ended, by its exit code. */
function exitedWith(code: number): string {
  const crash = crashes[code];
  return crash
    ? `The script crashed with exit code 0x${code.toString(16).toUpperCase()}, ${crash}.`
    : `The script exited with code ${code}.`;
}

/** Where to go when a script failed for a module its environment lacks. */
function missingModule(printed: string, environment: string): string {
  const module = /^ModuleNotFoundError: No module named '([^']+)'/m.exec(
    printed,
  )?.[1];
  return module
    ? `\nThe environment “${environment}” has no module ${module}: add its package with install_python_package, or see what each environment holds with list_python_environments.`
    : "";
}

/** A folder's name for a workspace: the same each time, and only its. */
function workspaceKey(root: string): string {
  return createHash("sha256")
    .update(resolve(root).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export function scriptRunner(options: {
  readonly run: RunProgram;
  readonly containment?: ProgramContainment;
  /** How long one script may run. */
  readonly timeoutMs: number;
  /** Zhiyin's own folders, which no script is given. */
  readonly protect: readonly string[];
  /** The Pythons environments are made from. */
  readonly python: string;
  /** Where each script's code waits while it runs. */
  readonly scripts: string;
  /** Where scripts keep their homes. */
  readonly homes: string;
  readonly environments: Environments;
  readonly kept: ReadonlyMap<string, PackageLock>;
  readonly lifecycle: KeptLifecycle;
}) {
  const { environments, kept, lifecycle } = options;
  const contained = options.containment
    ? { containment: options.containment }
    : {};

  /** Why a run did not finish: at a limit, the limit and what to do instead. */
  const unfinished = (ending: ProgramRun["ending"]) =>
    ending === "timeout"
      ? `The script took longer than ${duration(options.timeoutMs)}, the most one run may take, so it was stopped. Split the work over several runs, saving to a file what the next one needs.`
      : ending === "outputLimit"
        ? `The script printed more than ${largestOutput / 1024 / 1024} MB, the most one run may print, so it was stopped. Print less, such as a summary, and write the rest to a file.`
        : ending === "stopped"
          ? "The script was stopped before it finished, as its task was stopped. Run it again only if asked."
          : "The script was ended from outside before it finished, with no exit code.";

  return async function runScript(
    root: string,
    args: Record<string, unknown>,
    uv: string,
    signal?: AbortSignal,
    /** The identity of the approval this run is under. */
    binding?: string,
  ): Promise<TextResult> {
    const namedHosts = askedHosts(args);
    if (!namedHosts.ok) return textResult(namedHosts.reason, true);
    const hosts = namedHosts.hosts;
    const online = hosts.length > 0;
    const name = chosenEnvironment(args);
    if (name === undefined) return textResult(nameEnvironment, true);
    const extra = args["arguments"];
    if (extra !== undefined && !Array.isArray(extra))
      return textResult("Script arguments must be a list of text.", true);
    const scriptArguments = ((extra as unknown[]) ?? []).map(String);
    const asked = scriptSource(args);
    if (asked.kind === "neither") return textResult(asked.reason, true);
    let source: string;
    let file: string | undefined;
    if (asked.kind === "code") source = asked.code;
    else {
      const read = await readScript(root, asked.path);
      if (!read.ok) return textResult(read.reason, true);
      const refused = bindingRefusal(binding, read.file, read.code);
      if (refused) return textResult(refused, true);
      source = read.code;
      file = read.file;
    }
    const unreadable = declaredEncodingRefusal(source);
    if (unreadable) return textResult(unreadable, true);
    // Placed again as when it was approved: a folder now reached through a
    // link, or gone, is refused rather than given.
    const outside = await outsideFolders(
      args["outside_folders"],
      root,
      options.protect,
    );
    if (!outside.ok) return textResult(outside.reason, true);
    if (kept.has(name)) {
      const made = await environments.oneAtATime(name, () =>
        lifecycle.keptForUse(name, uv, signal),
      );
      if (!made.ok) return textResult(made.reason, true);
    } else if (!(await environments.isReady(name)))
      return textResult(missing(name), true);

    const folder = environments.folder(name);
    // In a folder of its own, which scripts may read and not change, so no
    // other script can change the code between approval and running. A
    // workspace script runs from this copy of what was approved, too.
    const temporary = join(options.scripts, randomUUID());
    await mkdir(temporary, { recursive: true });
    const script = join(temporary, "script.py");
    await writeFile(script, source, "utf8");
    try {
      await keepStartup(folder);
      const ran = await options.run({
        executable: environments.interpreter(name),
        arguments: file
          ? asTheFile(script, file, scriptArguments)
          : [script, ...scriptArguments],
        cwd: root,
        timeoutMs: options.timeoutMs,
        maximumOutputBytes: largestOutput,
        ...(signal ? { signal } : {}),
        ...contained,
        environment: pythonEnvironment(),
        // A script reads Zhiyin's Python, its environment and its own code,
        // and changes the workspace, and reaches the hosts the call names.
        // Scripts with hosts and without keep homes apart, so nothing left
        // by one that reaches no network is read by one that could send it on.
        confinement: {
          purpose: "python",
          home: join(
            options.homes,
            `${workspaceKey(root)}-${online ? "online" : "offline"}`,
          ),
          read: [options.python, folder, temporary],
          write: [root, ...outside.folders],
          hosts,
        },
      });
      const refused = unconfined(ran);
      if (refused !== undefined)
        return textResult(
          `Zhiyin could not give Python only the workspace, so the script did not run. ${refused}`.trim(),
          true,
        );
      // Last, after all the script printed, so nothing it printed reads as
      // what Zhiyin saw it reach.
      const network = online
        ? networkSection(ran.network, ran.furtherHosts)
        : "";
      if (ran.exitCode === null)
        return textResult(
          `${unfinished(ran.ending)}\n${reported(ran)}${network}`,
          true,
        );
      if (ran.exitCode === 0) return textResult(`${reported(ran)}${network}`);
      const printed = reported(ran);
      return textResult(
        `${exitedWith(ran.exitCode)}\n${printed}${missingModule(printed, name)}${network}`,
        true,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  };
}
