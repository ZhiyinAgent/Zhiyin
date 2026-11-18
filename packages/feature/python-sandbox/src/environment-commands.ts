/**
 * The commands that change or list the environments: adding packages,
 * creating, listing, removing and resetting. Each change of an environment
 * runs after the changes asked for before it.
 */

import { rm } from "node:fs/promises";
import { forgetConfinement } from "@zhiyin/sandbox";
import type { PackageLock } from "./default-packages.js";
import { reaching } from "./download-sources.js";
import {
  lockFileOf,
  unconfined,
  type environmentMaking,
} from "./environment-making.js";
import { installReport } from "./install-report.js";
import {
  defaultEnvironment,
  isPythonVersion,
  nameProblem,
  packageList,
  spokenVersions,
  type EnvironmentRecord,
  type Environments,
} from "./environments.js";
import {
  notInstalledYet,
  type KeptEnvironment,
  type KeptLifecycle,
} from "./kept-environments.js";
import { reported } from "./programs.js";
import {
  chosenEnvironment,
  missing,
  nameEnvironment,
  textResult,
} from "./tool-calls.js";

function described(record: EnvironmentRecord): string {
  return record.packages.length
    ? `Python ${record.python} and ${record.packages.join(", ")}`
    : `Python ${record.python}`;
}

export function environmentCommands(options: {
  readonly environments: Environments;
  /** Every environment Zhiyin keeps, by name, with its lock. */
  readonly kept: ReadonlyMap<string, PackageLock>;
  /** Those of them a connector makes. */
  readonly connectorMade: ReadonlyMap<string, KeptEnvironment>;
  /** The default environment's lock, whose Python and date an environment of the person's own takes. */
  readonly lock: PackageLock;
  readonly making: ReturnType<typeof environmentMaking>;
  /** Where one environment's installs keep pip's cache. */
  readonly installHome: (name: string) => string;
  readonly lifecycle: KeptLifecycle;
}) {
  const { environments, kept, connectorMade, lifecycle, installHome } = options;
  const { build, invokePip, installFailure } = options.making;

  async function install(
    args: Record<string, unknown>,
    uv: string,
    signal?: AbortSignal,
  ) {
    const asked = packageList(args["packages"]);
    if (!asked?.length)
      return textResult("Name packages by name and version only.", true);
    const name = chosenEnvironment(args);
    if (name === undefined) return textResult(nameEnvironment, true);
    const refusal = connectorMade.get(name)?.takesNoPackages;
    if (refusal !== undefined) return textResult(refusal, true);
    if (!(await lifecycle.knownEnvironment(name)))
      return textResult(missing(name), true);
    return environments.oneAtATime(name, async () => {
      if (kept.has(name)) {
        const made = await lifecycle.keptForUse(name, uv, signal);
        if (!made.ok) return textResult(made.reason, true);
      } else if (!(await environments.isReady(name)))
        return textResult(missing(name), true);
      const before = await environments.installed(name);
      const installed = await reaching(
        (mirrors) => invokePip(name, asked, signal, mirrors),
        signal,
      );
      const failure = installFailure(installed);
      const report = installReport(
        name,
        asked,
        before,
        await environments.installed(name),
      );
      if (failure === undefined)
        return textResult(
          [...report.lines, reported(installed)].filter(Boolean).join("\n"),
        );
      // pip ran and refused: what it left is measured, as for a success.
      const exited =
        installed.exitCode !== null &&
        installed.ending === undefined &&
        unconfined(installed) === undefined;
      if (!exited) return textResult(failure, true);
      const lead = report.changed
        ? `pip exited with code ${installed.exitCode}, and “${name}” changed even so. ${report.lines.join(" ")}`
        : `pip exited with code ${installed.exitCode}, and “${name}” holds the same packages as before.`;
      return textResult(`${lead}\n${failure}`.trim(), true);
    });
  }

  /** What a new environment would be made with, or why it cannot be. */
  async function newEnvironment(
    args: Record<string, unknown>,
  ): Promise<
    | { ok: true; name: string; record: EnvironmentRecord }
    | { ok: false; reason: string }
  > {
    const name = args["name"];
    if (typeof name === "string" && kept.has(name))
      return {
        ok: false,
        reason: `“${name}” is Zhiyin's own environment; reset_python_environment rebuilds it.`,
      };
    const problem = nameProblem(name);
    if (problem !== undefined) return { ok: false, reason: problem };
    const python = args["python"] ?? options.lock.python;
    if (!isPythonVersion(python))
      return {
        ok: false,
        reason: `Name the Python by one of the versions an environment may use: ${spokenVersions}.`,
      };
    const asked =
      args["packages"] === undefined ? [] : packageList(args["packages"]);
    if (!asked)
      return { ok: false, reason: "Name packages by name and version only." };
    if (await environments.isReady(name as string))
      return {
        ok: false,
        reason: `There is already a Python environment named “${name as string}”.`,
      };
    return {
      ok: true,
      name: name as string,
      record: { python, packages: asked, ready: true },
    };
  }

  async function create(
    args: Record<string, unknown>,
    uv: string,
    signal?: AbortSignal,
  ) {
    const asked = await newEnvironment(args);
    if (!asked.ok) return textResult(asked.reason, true);
    const { name, record } = asked;
    return environments.oneAtATime(name, async () => {
      if (await environments.isReady(name))
        return textResult(
          `There is already a Python environment named “${name}”.`,
          true,
        );
      const built = await build(name, record, uv, signal);
      return built.ok
        ? textResult(
            `Created the Python environment “${name}” with ${described(record)}.`,
          )
        : textResult(built.reason, true);
    });
  }

  async function list() {
    const names = [
      ...kept.keys(),
      ...(await environments.names()).filter((name) => !kept.has(name)),
    ];
    const lines: string[] = [];
    for (const name of names) {
      const record = await environments.record(name);
      const by = connectorMade.get(name)?.installedBy;
      if (by && !(await lifecycle.keptMade(name))) {
        const ready = await environments.isReady(name);
        lines.push(
          record && ready && record.lock === undefined
            ? `${name} — your own environment, made with ${described(record)} before Zhiyin kept one by this name. Installing the ${by.connector} replaces it.`
            : ready
              ? `${name} — made from the packages of an earlier Zhiyin: updating the ${by.connector}, in the ${by.plugin} plugin on the Plugins page, makes it again with ${described(lifecycle.keptRecord(name))}.`
              : `${name} — not installed: it is made when the ${by.connector} is installed, from the ${by.plugin} plugin on the Plugins page, with ${described(lifecycle.keptRecord(name))}.`,
        );
        continue;
      }
      if (
        name === defaultEnvironment &&
        (await environments.isReady(name)) &&
        !(await lifecycle.fromThisLock(name))
      ) {
        lines.push(
          `${name} — made from the package versions of an earlier Zhiyin; reset_python_environment brings it to this release's, without the packages added to it since.`,
        );
        continue;
      }
      if (kept.has(name) && !(await lifecycle.keptMade(name))) {
        lines.push(
          `${name} — not made yet. It is made with ${described(lifecycle.keptRecord(name))} the first time a script runs in it or a package is added to it.`,
        );
        continue;
      }
      if (!(await environments.isReady(name))) {
        lines.push(`${name} — not finished: remove it, or create it again.`);
        continue;
      }
      const version =
        (await environments.pythonOf(name)) ??
        (await environments.record(name))?.python;
      const installed = (await environments.installed(name)).map(
        (found) => `${found.name} ${found.version}`,
      );
      lines.push(
        `${name} — Python ${version ?? "of unknown version"}: ${installed.join(", ") || "no packages"}`,
      );
    }
    return textResult(lines.join("\n"));
  }

  /** Why an environment cannot be removed, or nothing when it can. */
  async function removalProblem(name: unknown): Promise<string | undefined> {
    if (typeof name !== "string") return nameEnvironment;
    if (kept.has(name))
      return `The ${name} environment cannot be removed; reset_python_environment rebuilds it.`;
    if (nameProblem(name) !== undefined || !(await environments.record(name)))
      return `There is no Python environment named “${name}”.`;
    return undefined;
  }

  async function remove(args: Record<string, unknown>) {
    const problem = await removalProblem(args["name"]);
    if (problem !== undefined) return textResult(problem, true);
    const name = args["name"] as string;
    return environments.oneAtATime(name, async () => {
      try {
        await environments.remove(name);
        await rm(installHome(name), { recursive: true, force: true });
        forgetConfinement("python-install", installHome(name));
      } catch (error) {
        return textResult(
          `The Python environment “${name}” could not be removed entirely, perhaps because a script is still running in it. ${error instanceof Error ? error.message : ""}`.trim(),
          true,
        );
      }
      return textResult(`Removed the Python environment “${name}”.`);
    });
  }

  /** Why an environment cannot be reset, or nothing when it can. */
  async function resetProblem(name: string): Promise<string | undefined> {
    const by = connectorMade.get(name)?.installedBy;
    // One its connector makes is rebuilt by a reset only once it is there.
    if (by && !(await environments.isReady(name)))
      return notInstalledYet(name, by);
    return (await resetRecord(name))
      ? undefined
      : `There is no Python environment named “${name}”.`;
  }

  /** What resetting an environment rebuilds it with, or nothing when it cannot be reset. */
  async function resetRecord(
    name: string,
  ): Promise<EnvironmentRecord | undefined> {
    if (kept.has(name)) return lifecycle.keptRecord(name);
    if (nameProblem(name) !== undefined) return undefined;
    const record = await environments.record(name);
    return record ? { ...record, ready: true } : undefined;
  }

  async function reset(
    args: Record<string, unknown>,
    uv: string,
    signal?: AbortSignal,
  ) {
    const name = chosenEnvironment(args);
    if (name === undefined) return textResult(nameEnvironment, true);
    const problem = await resetProblem(name);
    if (problem) return textResult(problem, true);
    return environments.oneAtATime(name, async () => {
      const again = await resetProblem(name);
      const record = await resetRecord(name);
      if (again || !record)
        return textResult(
          again ?? `There is no Python environment named “${name}”.`,
          true,
        );
      await rm(installHome(name), { recursive: true, force: true });
      const built = await build(name, record, uv, signal);
      return built.ok
        ? textResult(
            `The Python environment “${name}” was rebuilt with ${described(record)}.`,
          )
        : textResult(built.reason, true);
    });
  }

  /** The commands that make an environment as its record says, as an approval shows them. */
  function packagesCommand(name: string, record: EnvironmentRecord): string {
    const made = `uv venv --seed --exclude-newer ${(kept.get(name) ?? options.lock).publishedBy} --python ${record.python} ${name}`;
    if (!record.packages.length) return made;
    return kept.has(name)
      ? `${made}\nuv pip install --no-build --require-hashes -r ${lockFileOf(name)}`
      : `${made}\npython -m pip install ${record.packages.join(" ")}`;
  }

  return {
    install,
    newEnvironment,
    create,
    list,
    removalProblem,
    remove,
    resetProblem,
    resetRecord,
    reset,
    packagesCommand,
  };
}

export type EnvironmentCommands = ReturnType<typeof environmentCommands>;
