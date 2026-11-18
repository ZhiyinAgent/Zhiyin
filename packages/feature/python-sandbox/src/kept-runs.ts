/**
 * Running a kept environment's Python for another feature of Zhiyin's: only
 * an environment Zhiyin keeps, only once made from the lock it ships, never
 * made by the run, and confined to what the feature gives it, offline.
 */

import {
  forgetConfinement,
  type ProcessContainment as ProgramContainment,
  type ProcessRun as ProgramRun,
  type RunProcess as RunProgram,
} from "@zhiyin/sandbox";
import type { PackageLock } from "./default-packages.js";
import { unconfined } from "./environment-making.js";
import type { Environments } from "./environments.js";
import type { KeptLifecycle } from "./kept-environments.js";
import type { KeptInstallation } from "./kept-installation.js";
import { pythonEnvironment, withoutContainerWarning } from "./programs.js";
import { keepStartup } from "./startup.js";
import { notInstalled } from "./tool-calls.js";

/** One run of a kept environment's Python for a feature of Zhiyin's. */
export type KeptPythonRun = {
  /** An environment Zhiyin keeps, by name. */
  readonly environment: string;
  /** What Python is given: the script to run first, then its arguments. */
  readonly arguments: readonly string[];
  readonly cwd: string;
  /** Folders it may read, beside Zhiyin's Python and the environment. */
  readonly read: readonly string[];
  /** Folders it may change; nothing else, and no network. */
  readonly write: readonly string[];
  /** The run's own home, which it may change too: the feature says where, and how long it is kept. */
  readonly home: string;
  /**
   * The home is this run's alone, removed by the feature after it: what
   * Windows keeps for the home in the person's profile goes when it ends.
   */
  readonly homeLastsOneRun?: boolean;
  readonly timeoutMs: number;
  /** The most it may print, across both streams, before it is stopped. */
  readonly maximumOutputBytes?: number;
  readonly signal?: AbortSignal;
};

/**
 * The environments Zhiyin keeps for its own features, run for them: each made
 * from its lock as its connector is installed, never by a run, then each run
 * confined to what it is given.
 */
export type KeptPython = {
  /**
   * Whether it can run: made from the lock this release ships, with uv
   * there. One not made yet, or from an earlier lock, cannot until it is
   * installed again.
   */
  state(environment: string): Promise<"ready" | "unavailable">;
  run(
    request: KeptPythonRun,
  ): Promise<
    | { readonly ok: true; readonly run: ProgramRun }
    | { readonly ok: false; readonly reason: string }
  >;
  /** How a kept environment is made, for the connector that uses it. */
  installation(environment: string): KeptInstallation;
};

export function keptPython(options: {
  readonly uv: () => Promise<string | undefined>;
  readonly run: RunProgram;
  readonly containment?: ProgramContainment;
  /** The Pythons environments are made from. */
  readonly python: string;
  readonly environments: Environments;
  readonly kept: ReadonlyMap<string, PackageLock>;
  readonly lifecycle: KeptLifecycle;
}): KeptPython {
  const { environments, kept, lifecycle } = options;
  const contained = options.containment
    ? { containment: options.containment }
    : {};
  return {
    installation: lifecycle.installation,

    async state(name) {
      if (!kept.has(name) || !(await options.uv())) return "unavailable";
      return (await lifecycle.keptMade(name)) ? "ready" : "unavailable";
    },

    async run(request) {
      const name = request.environment;
      if (!kept.has(name))
        return {
          ok: false,
          reason: `“${name}” is not one Zhiyin keeps for its own features.`,
        };
      if (!(await options.uv())) return { ok: false, reason: notInstalled };
      // Never made here: after an install under way, as it left it.
      const unmade = await environments.oneAtATime(name, async () =>
        (await lifecycle.keptMade(name))
          ? undefined
          : ((await lifecycle.notMade(name)) ??
            `The “${name}” environment is not made yet.`),
      );
      if (unmade) return { ok: false, reason: unmade };
      const folder = environments.folder(name);
      await keepStartup(folder);
      const purpose = `python-${name}`;
      const ran = await options
        .run({
          executable: environments.interpreter(name),
          arguments: request.arguments,
          cwd: request.cwd,
          timeoutMs: request.timeoutMs,
          ...(request.maximumOutputBytes
            ? { maximumOutputBytes: request.maximumOutputBytes }
            : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...contained,
          environment: pythonEnvironment(),
          // What the feature gives it, beside Zhiyin's Python and its
          // environment, in the home it gives.
          confinement: {
            purpose,
            home: request.home,
            read: [options.python, folder, ...request.read],
            write: [...request.write],
            hosts: [],
          },
        })
        .finally(() => {
          if (request.homeLastsOneRun) forgetConfinement(purpose, request.home);
        });
      if (ran.failure === "start")
        return {
          ok: false,
          reason: `The Python of the “${name}” environment could not be started.`,
        };
      const refused = unconfined(ran);
      return refused === undefined
        ? { ok: true, run: withoutContainerWarning(ran) }
        : {
            ok: false,
            reason:
              `Zhiyin could not confine Python to what it was given, so nothing ran. ${refused}`.trim(),
          };
    },
  };
}
