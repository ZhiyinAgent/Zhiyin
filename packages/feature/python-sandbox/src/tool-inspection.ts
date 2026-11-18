/**
 * What each of the sandbox's tools is approved as: what a call will do, what
 * it reaches and where it sends, shown before anything runs. A call that
 * cannot run is refused here, saying why.
 */

import type {
  ActionEffects,
  ToolArgument,
  ToolCallInspection,
} from "@zhiyin/contract";
import {
  namedWorkspaceFiles,
  outsideFolders,
} from "@zhiyin/workspace-containment";
import { makingDownloads, packageIndexes } from "./download-sources.js";
import type { EnvironmentCommands } from "./environment-commands.js";
import {
  defaultEnvironment,
  packageList,
  type Environments,
} from "./environments.js";
import type { KeptEnvironment, KeptLifecycle } from "./kept-environments.js";
import { declaredEncodingRefusal, scriptRows } from "./script-approval.js";
import { readScript, scriptIdentity, scriptSource } from "./script-files.js";
import {
  askedHosts,
  listed,
  chosenEnvironment,
  missing,
  nameEnvironment,
  notInstalled,
} from "./tool-calls.js";

/** How the default environment's own packages are chosen, as an approval says it. */
const pinnedPackages =
  "Its own packages are the versions Zhiyin pins, each checked against the SHA-256 Zhiyin keeps.";

/** What a package's own code may reach while it installs. */
const installReach =
  "Installing a package can run its own code, which can change only that environment and reach only the package index.";

/** A call that does none of these things; each call names what it does. */
const noEffects: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/**
 * Changing an environment: its downloads come only from the fixed package
 * indexes and Python's release sites, and what it installs runs inside every
 * later script in it. A package the model named runs its own code, confined,
 * as it installs; Zhiyin's pinned packages come as wheels and run none.
 */
const environmentChange = (
  reads: "none" | "app",
  runsPackageCode: boolean,
): ActionEffects => ({
  ...noEffects,
  reads,
  changes: "app",
  sends: "service",
  runs: runsPackageCode ? "sealed" : "none",
  lasting: true,
});

/** The packages a call adds and the environment they go into, in words. */
function environmentRows(
  environment: string,
  packages: readonly string[],
): ToolArgument[] {
  return [
    ...(packages.length
      ? [
          {
            name: "Packages",
            value: packages.join("\n"),
            readable: true as const,
          },
        ]
      : []),
    { name: "Environment", value: environment, readable: true as const },
  ];
}

type Args = Record<string, unknown>;

export function toolInspection(options: {
  readonly uv: () => Promise<string | undefined>;
  /** Zhiyin's own folders, which no script is given. */
  readonly protect: readonly string[];
  readonly environments: Environments;
  /** The names of the environments Zhiyin keeps. */
  readonly kept: ReadonlyMap<string, unknown>;
  /** Those of them a connector makes. */
  readonly connectorMade: ReadonlyMap<string, KeptEnvironment>;
  readonly lifecycle: KeptLifecycle;
  readonly commands: EnvironmentCommands;
}) {
  const { environments, kept, lifecycle, commands } = options;

  async function runPython(
    root: string,
    args: Args,
  ): Promise<ToolCallInspection> {
    const asked = scriptSource(args);
    if (asked.kind === "neither") return { ok: false, reason: asked.reason };
    const namedHosts = askedHosts(args);
    if (!namedHosts.ok) return { ok: false, reason: namedHosts.reason };
    const hosts = namedHosts.hosts;
    const online = hosts.length > 0;
    const environment = chosenEnvironment(args);
    if (environment === undefined)
      return { ok: false, reason: nameEnvironment };
    if (!(await lifecycle.knownEnvironment(environment)))
      return { ok: false, reason: missing(environment) };
    const unmade = await lifecycle.notMade(environment);
    if (unmade) return { ok: false, reason: unmade };
    const first = await lifecycle.preparing(environment);
    const script = asked.kind === "file" ? asked.path : "a script";
    // A workspace script is shown as its code, which is what is approved,
    // and the approval is bound to that code.
    let fileCode: string | undefined;
    let identity: string | undefined;
    if (asked.kind === "file") {
      const read = await readScript(root, asked.path);
      if (!read.ok) return { ok: false, reason: read.reason };
      fileCode = read.code;
      identity = scriptIdentity(read.file, read.code);
    }
    const unreadable = declaredEncodingRefusal(
      asked.kind === "code" ? asked.code : (fileCode as string),
    );
    if (unreadable) return { ok: false, reason: unreadable };
    const outside = await outsideFolders(
      args["outside_folders"],
      root,
      options.protect,
    );
    if (!outside.ok) return { ok: false, reason: outside.reason };
    const elsewhere = outside.folders.length > 0;
    const locked = namedWorkspaceFiles(args["change_locked"], outside.folders);
    if (!locked.ok)
      return {
        ok: false,
        reason: locked.reason,
        correctable: true,
      };
    const forGood = locked.paths.length > 0;
    return {
      ok: true,
      action: "Run a Python script",
      // A script changes the workspace, and the folders outside it it is
      // given, which it can read too; Zhiyin copies each before it runs
      // and can put it back. A file it is let change though it could not
      // be copied is changed for good. Making its environment first
      // downloads from fixed sites.
      effects: {
        ...noEffects,
        reads: elsewhere ? "elsewhere" : "workspace",
        changes: forGood
          ? "workspace-for-good"
          : elsewhere
            ? "elsewhere"
            : "workspace",
        sends: online ? "chosen" : first ? "service" : "none",
        runs: "sealed",
        // What it fetches is anyone's words, and it prints what it likes.
        brings: online ? "outside" : "none",
      },
      changesAnyFile: {
        writable: locked.paths,
        unheldBy: "change_locked",
        ...(elsewhere ? { outside: outside.folders } : {}),
      },
      target:
        environment === defaultEnvironment
          ? script
          : `${script}, in ${environment}`,
      // Whole: what is approved is what runs.
      command: asked.kind === "code" ? asked.code : (fileCode as string),
      ...(identity ? { identity } : {}),
      invocation: {
        name: "Run a Python script",
        arguments: scriptRows(
          asked.kind === "code"
            ? { code: asked.code }
            : { code: fileCode as string, file: script },
          args["arguments"],
          environment === defaultEnvironment ? undefined : environment,
          hosts,
        ),
      },
      detail: [
        online
          ? `The script reads and changes ${elsewhere ? "the workspace" : "only the workspace"}, and can reach ${listed(hosts)}: it could send what it reads there, and nowhere else.`
          : `The script reads and changes ${elsewhere ? "the workspace" : "only the workspace"}, and reaches no network.`,
        ...(elsewhere
          ? [
              `It can also change files in ${outside.folders.join(" and ")}, outside the folder you selected.`,
            ]
          : []),
        ...(first ? [first] : []),
        ...(forGood
          ? [
              `It may also change ${locked.paths.join(", ")}, which Zhiyin could not copy first, so that change cannot be undone.`,
            ]
          : []),
      ].join(" "),
      // Scripts that reach only the workspace are one set the person can
      // allow for the conversation, whatever environment they run in, and
      // those that reach the same hosts besides are another; a script that
      // names other hosts is asked about apart (ADR 0006). One that first
      // makes or rebuilds its environment downloads, which no allowance
      // covers.
      // One that may change a file Zhiyin could not copy is asked about,
      // naming the file, which can be allowed for the conversation by
      // itself (ADR 0013). One that also changes folders outside the
      // workspace is allowed by those folders, as a write there is (ADR
      // 0012), never by this set.
      ...(first
        ? { asksEachTime: true as const }
        : elsewhere || forGood
          ? {}
          : {
              allowance: online
                ? {
                    key: JSON.stringify({ workspace: root, python: hosts }),
                    label: `Python scripts that reach only the workspace and these hosts: ${hosts.join(", ")}`,
                  }
                : {
                    key: JSON.stringify({ workspace: root, python: "offline" }),
                    label:
                      "Python scripts that reach only the workspace, and no network",
                  },
            }),
    };
  }

  async function installPackage(args: Args): Promise<ToolCallInspection> {
    const asked = args["packages"];
    if (!Array.isArray(asked) || !asked.length)
      return { ok: false, reason: "Name at least one package." };
    if (!packageList(asked))
      return {
        ok: false,
        reason: "Name packages by name and version only.",
      };
    const environment = chosenEnvironment(args);
    if (environment === undefined)
      return { ok: false, reason: nameEnvironment };
    const refusal = options.connectorMade.get(environment)?.takesNoPackages;
    if (refusal !== undefined)
      return { ok: false, reason: refusal, correctable: true };
    if (!(await lifecycle.knownEnvironment(environment)))
      return { ok: false, reason: missing(environment) };
    const first = await lifecycle.preparing(environment);
    return {
      ok: true,
      action: "Add packages to a Python environment",
      effects: environmentChange("app", true),
      target: `${asked.join(", ")}, into ${environment}`,
      command: `python -m pip install ${asked.join(" ")}`,
      invocation: {
        name: "Add packages to a Python environment",
        arguments: [
          ...environmentRows(environment, asked),
          {
            name: "Command",
            value: `python -m pip install ${asked.join(" ")}`,
            runs: true,
          },
        ],
      },
      detail: first ? `${installReach} ${first}` : installReach,
      destinations: packageIndexes,
      asksEachTime: true,
    };
  }

  async function createEnvironment(args: Args): Promise<ToolCallInspection> {
    const asked = await commands.newEnvironment(args);
    if (!asked.ok) return asked;
    const command = commands.packagesCommand(asked.name, asked.record);
    return {
      ok: true,
      action: "Create a Python environment",
      effects: environmentChange("none", asked.record.packages.length > 0),
      target: asked.name,
      invocation: {
        name: "Create a Python environment",
        arguments: [
          ...environmentRows(asked.name, asked.record.packages),
          { name: "Command", value: command, runs: true },
        ],
      },
      command,
      detail: `${
        asked.record.packages.length
          ? installReach
          : "It is made with pip, and kept until it is removed."
      } ${makingDownloads}`,
      ...(asked.record.packages.length ? { destinations: packageIndexes } : {}),
      asksEachTime: true,
    };
  }

  function listEnvironments(): ToolCallInspection {
    return {
      ok: true,
      action: "List the Python environments",
      effects: { ...noEffects, reads: "app" },
      target: "Zhiyin's Python environments",
      command: "list_python_environments",
    };
  }

  async function removeEnvironment(args: Args): Promise<ToolCallInspection> {
    const problem = await commands.removalProblem(args["name"]);
    if (problem !== undefined) return { ok: false, reason: problem };
    const environment = args["name"] as string;
    return {
      ok: true,
      action: "Remove a Python environment",
      // What it held is gone, so nothing of it runs later.
      effects: { ...noEffects, reads: "app", changes: "app" },
      target: environment,
      command: `delete ${environments.folder(environment)}`,
      detail: "Everything installed in it is deleted.",
      asksEachTime: true,
    };
  }

  async function resetEnvironment(args: Args): Promise<ToolCallInspection> {
    const environment = chosenEnvironment(args);
    if (environment === undefined)
      return { ok: false, reason: nameEnvironment };
    const problem = await commands.resetProblem(environment);
    const record = await commands.resetRecord(environment);
    if (problem || !record)
      return {
        ok: false,
        reason:
          problem ?? `There is no Python environment named “${environment}”.`,
      };
    return {
      ok: true,
      action: "Rebuild a Python environment",
      effects: environmentChange(
        "app",
        record.packages.length > 0 && !kept.has(environment),
      ),
      target: environment,
      command: commands.packagesCommand(environment, record),
      detail: `${
        kept.has(environment)
          ? `Packages added to it since it was made are removed. ${pinnedPackages}`
          : "Packages added to it since it was made are removed."
      } ${makingDownloads}`,
      ...(record.packages.length ? { destinations: packageIndexes } : {}),
      asksEachTime: true,
    };
  }

  /** What a call of the tool `name` will do, in the folder `root` when there is one. */
  return async function inspect(
    name: string,
    args: Args,
    root: string | undefined,
  ): Promise<ToolCallInspection> {
    if (name === "run_python" && !root)
      return { ok: false, reason: "Choose a folder before running Python." };
    if (!(await options.uv())) return { ok: false, reason: notInstalled };
    switch (name) {
      case "run_python":
        return runPython(root as string, args);
      case "install_python_package":
        return installPackage(args);
      case "create_python_environment":
        return createEnvironment(args);
      case "list_python_environments":
        return listEnvironments();
      case "remove_python_environment":
        return removeEnvironment(args);
      case "reset_python_environment":
        return resetEnvironment(args);
      default:
        return { ok: false, reason: `The tool “${name}” is not available.` };
    }
  };
}
