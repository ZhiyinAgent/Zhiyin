/**
 * Making a kept environment as the connector that uses it is installed: what
 * it downloads, said before it starts, which step it is on while it runs, and
 * why it failed, until it is tried again (ADR 0023).
 */

import { readdir } from "node:fs/promises";
import type {
  ToolchainDownload,
  ToolchainStage,
  ToolchainState,
} from "@zhiyin/contract";
import type { PackageLock } from "./default-packages.js";
import { packageHosts, pythonHosts } from "./download-sources.js";

/**
 * Making a kept environment, as the connector that uses it is installed: what
 * it downloads, stated before, and the steps it is on, while it runs.
 */
export type KeptInstallation = {
  /**
   * Ready when made from the lock this release ships; missing, with what
   * installing downloads, when not made yet or made from an earlier lock;
   * installing, with its step; or failed, with why, until it is tried again.
   */
  state(): Promise<ToolchainState>;
  /** Makes it, rejecting with the reason when it cannot; the signal stops it. */
  install(signal?: AbortSignal): Promise<void>;
};

/** The steps of making a kept environment, as a person reads them. */
export const stages = [
  "Setting up Python",
  "Installing the packages",
  "Preparing the packages",
] as const;

/** A package's name as pip compares names: in any case, with - for _ and . */
const normalName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** Whether `pythons` holds a Python of this minor version, which making an environment then does not download. */
async function hasPython(pythons: string, version: string): Promise<boolean> {
  const named = new RegExp(
    `^cpython-${version.replace(".", "\\.")}(?:\\.\\d+)?-windows-x86_64-none$`,
  );
  return (await readdir(pythons).catch(() => [] as string[])).some((entry) =>
    named.test(entry),
  );
}

/**
 * What installing an environment from `lock` downloads: the Python the lock
 * names, unless one of its version is kept, and the locked packages, by the
 * size of the files the lock installs, which is an estimate: pip, which comes
 * with the environment, is not counted, and what uv has cached is not
 * downloaded again.
 */
async function downloadsOf(
  lock: PackageLock,
  pythons: string,
  update: boolean,
): Promise<ToolchainDownload[]> {
  const version = (asked: string) =>
    lock.locked.find((entry) => normalName(entry.name) === normalName(asked))
      ?.version ?? "";
  const [first = "Packages", ...others] = lock.asked;
  const needed = lock.locked.length - lock.asked.length;
  const along = others.map((asked) => `${asked} ${version(asked)}`);
  return [
    ...((await hasPython(pythons, lock.python))
      ? []
      : [
          {
            name: "Python",
            version: lock.pythonBuild.version,
            bytes: lock.pythonBuild.bytes,
            sources: pythonHosts,
          },
        ]),
    {
      name: first,
      version: version(first),
      bytes: lock.locked.reduce((sum, entry) => sum + entry.bytes, 0),
      estimated: true,
      detail: along.length
        ? `With ${along.join(", ")} and the ${needed} packages they need.`
        : `With the ${needed} packages it needs.`,
      ...(update ? { update: true as const } : {}),
      sources: packageHosts,
    },
  ];
}

/** What making it gives back: done, or why not. */
export type Made =
  { readonly ok: true } | { readonly ok: false; reason: string };

/**
 * One kept environment's installation. `make` makes it, hearing each step as
 * it begins, and makes nothing when it is made already. One install under way
 * is joined by the next asked for, unless it is being stopped: then the next
 * starts once it has ended.
 */
export function keptInstallation(options: {
  readonly lock: PackageLock;
  /** Where Zhiyin keeps the Pythons environments are made from. */
  readonly pythons: string;
  /** Made from this lock, as it is now. */
  readonly made: () => Promise<boolean>;
  /** Made by Zhiyin from an earlier lock, which installing replaces. */
  readonly madeEarlier: () => Promise<boolean>;
  readonly make: (
    signal: AbortSignal | undefined,
    onStage: (stage: ToolchainStage) => void,
  ) => Promise<Made>;
}): KeptInstallation {
  /** The step of the install under way, once it has reached one. */
  let installing: { stage?: ToolchainStage } | undefined;
  let failure: string | undefined;
  let running: Promise<void> | undefined;
  /** What stops the install under way. */
  let stoppedBy: AbortSignal | undefined;
  const installation: KeptInstallation = {
    async state() {
      if (installing)
        return {
          status: "installing",
          ...(installing.stage ? { stage: installing.stage } : {}),
        };
      if (await options.made()) return { status: "ready" };
      if (failure) return { status: "failed", reason: failure };
      return {
        status: "missing",
        downloads: await downloadsOf(
          options.lock,
          options.pythons,
          await options.madeEarlier(),
        ),
      };
    },
    install(signal) {
      if (running && stoppedBy?.aborted) {
        const again = () => installation.install(signal);
        return running.then(again, again);
      }
      if (running) return running;
      const now: { stage?: ToolchainStage } = {};
      installing = now;
      stoppedBy = signal;
      running = (async () => {
        const outcome = await options.make(signal, (stage) => {
          now.stage = stage;
        });
        signal?.throwIfAborted();
        if (!outcome.ok) throw new Error(outcome.reason);
      })()
        .then(() => {
          failure = undefined;
        })
        .catch((error: unknown) => {
          // Stopped on purpose is not a failure: it is offered as before.
          failure = signal?.aborted
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error);
          throw error;
        })
        .finally(() => {
          installing = undefined;
          running = undefined;
          stoppedBy = undefined;
        });
      return running;
    },
  };
  return installation;
}
