/**
 * The environments Zhiyin keeps, each made from its lock and never created or
 * removed by name: the default one, made on first use, and those another
 * feature keeps here, each made only as the connector that uses it is
 * installed (ADR 0023), never by a call.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ToolchainStage } from "@zhiyin/contract";
import { lockMark, type PackageLock } from "./default-packages.js";
import type { environmentMaking } from "./environment-making.js";
import {
  defaultEnvironment,
  type EnvironmentRecord,
  type Environments,
} from "./environments.js";
import {
  keptInstallation,
  type KeptInstallation,
  type Made,
} from "./kept-installation.js";

/** The connector that makes an environment, as the Plugins page names it and the plugin it comes in. */
export type Installer = { readonly connector: string; readonly plugin: string };

/**
 * An environment another feature keeps in the sandbox. It is made from its
 * lock only as its connector is installed, never by a call, and is usable
 * only while made from exactly that lock, so one from an earlier lock is made
 * again by updating the connector. Nothing is added to it.
 */
export type KeptEnvironment = {
  /** Its name, which no environment of the person's can then have. */
  readonly name: string;
  readonly lock: PackageLock;
  readonly installedBy: Installer;
  /** Why no package is added to it, said to a call that asks for one. */
  readonly takesNoPackages: string;
};

export const notInstalledYet = (name: string, by: Installer) =>
  `The “${name}” environment is not installed: it is made when the ${by.connector} is installed, from the ${by.plugin} plugin on the Plugins page.`;

const madeEarlier = (name: string, by: Installer) =>
  `The “${name}” environment was made from the packages of an earlier Zhiyin: updating the ${by.connector}, in the ${by.plugin} plugin on the Plugins page, makes it again from this release's.`;

export function keptEnvironments(options: {
  /** The sandbox's folder. */
  readonly directory: string;
  readonly uv: () => Promise<string | undefined>;
  /** The Pythons environments are made from. */
  readonly python: string;
  readonly environments: Environments;
  /** Every environment Zhiyin keeps, by name, with its lock. */
  readonly kept: ReadonlyMap<string, PackageLock>;
  /** Those of them a connector makes. */
  readonly connectorMade: ReadonlyMap<string, KeptEnvironment>;
  readonly build: ReturnType<typeof environmentMaking>["build"];
}) {
  const { environments, kept, connectorMade, build } = options;

  const keptRecord = (name: string): EnvironmentRecord => {
    const own = kept.get(name) as PackageLock;
    return {
      python: own.python,
      packages: [...own.asked],
      ready: true,
      lock: lockMark(own),
    };
  };
  /** Whether a kept environment was made from the lock Zhiyin ships now. */
  const fromThisLock = async (name: string): Promise<boolean> =>
    (await environments.record(name))?.lock === keptRecord(name).lock;
  /**
   * Whether a kept environment can be used as it is. A feature's code needs
   * exactly the versions this release pins, so one its connector makes from
   * an earlier lock is made again. Nothing depends on the default
   * environment's exact versions, and the packages added to it are the
   * person's work, so one from an earlier lock keeps working until it is reset.
   */
  const keptMade = async (name: string): Promise<boolean> =>
    (await environments.isReady(name)) &&
    (name === defaultEnvironment || (await fromThisLock(name)));
  /** Whether a kept environment is there, made by Zhiyin from a lock other than this release's. */
  const fromEarlierLock = async (name: string): Promise<boolean> =>
    (await environments.isReady(name)) &&
    (await environments.record(name))?.lock !== undefined &&
    !(await fromThisLock(name));
  /**
   * Why an environment its connector makes cannot be used, or nothing when
   * it can, or when it is not one of those.
   */
  const notMade = async (name: string): Promise<string | undefined> => {
    const by = connectorMade.get(name)?.installedBy;
    if (!by || (await keptMade(name))) return undefined;
    return (await fromEarlierLock(name))
      ? madeEarlier(name, by)
      : notInstalledYet(name, by);
  };

  /** Makes a kept environment if it is not there yet; call it while changing it. */
  async function ensureKept(
    name: string,
    uv: string,
    signal?: AbortSignal,
    onStage?: (stage: ToolchainStage) => void,
  ): Promise<Made> {
    if (await keptMade(name)) return { ok: true };
    // The one environment kept before environments had names.
    if (name === defaultEnvironment)
      await rm(join(options.directory, ".venv"), {
        recursive: true,
        force: true,
      });
    return build(name, keptRecord(name), uv, signal, onStage);
  }

  /**
   * A kept environment for a call to use: the default one made first if it
   * is not there yet, one a connector makes only as it is. Call it while
   * changing it.
   */
  async function keptForUse(
    name: string,
    uv: string,
    signal?: AbortSignal,
  ): Promise<Made> {
    const unmade = await notMade(name);
    return unmade
      ? { ok: false, reason: unmade }
      : ensureKept(name, uv, signal);
  }

  /** Each kept environment's installation, the same one each time it is asked for. */
  const installations = new Map<string, KeptInstallation>();
  function installation(name: string): KeptInstallation {
    const own = kept.get(name);
    if (!own)
      return {
        state: async () => ({
          status: "failed",
          reason: `“${name}” is not one Zhiyin keeps.`,
        }),
        install: async () => {
          throw new Error(`“${name}” is not one Zhiyin keeps.`);
        },
      };
    const known = installations.get(name);
    if (known) return known;
    const made = keptInstallation({
      lock: own,
      pythons: options.python,
      made: () => keptMade(name),
      madeEarlier: () => fromEarlierLock(name),
      make: async (signal, onStage) => {
        const uv = await options.uv();
        if (!uv)
          return {
            ok: false,
            reason: `uv is not installed, which makes the “${name}” environment.`,
          };
        return environments.oneAtATime(name, () =>
          ensureKept(name, uv, signal, onStage),
        );
      },
    });
    installations.set(name, made);
    return made;
  }

  /** Whether a call may use the environment it names, as things are now. */
  async function knownEnvironment(name: string): Promise<boolean> {
    return kept.has(name) || (await environments.isReady(name));
  }

  /**
   * Said when using the default environment will make it first. An
   * environment a connector makes is never made by a call.
   */
  async function preparing(name: string): Promise<string | undefined> {
    if (!kept.has(name) || connectorMade.has(name) || (await keptMade(name)))
      return undefined;
    return `Zhiyin first makes the ${name} environment, downloading Python from releases.astral.sh or github.com and its packages from pypi.org, or from the mirrors registry.npmmirror.com and pypi.tuna.tsinghua.edu.cn when those cannot be reached.`;
  }

  return {
    keptRecord,
    fromThisLock,
    keptMade,
    notMade,
    keptForUse,
    installation,
    knownEnvironment,
    preparing,
  };
}

/** The kept environments' lifecycle, as the sandbox's other parts use it. */
export type KeptLifecycle = ReturnType<typeof keptEnvironments>;
