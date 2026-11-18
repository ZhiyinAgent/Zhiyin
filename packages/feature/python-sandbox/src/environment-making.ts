/**
 * Making an environment: uv makes it on Zhiyin's own Python and installs a
 * kept environment's locked packages; the environment's own pip, confined,
 * installs what was asked for by name. Whatever fails, an environment is
 * left whole, or as it was.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolchainStage } from "@zhiyin/contract";
import type {
  ProcessContainment as ProgramContainment,
  ProcessRun as ProgramRun,
  RunProcess as RunProgram,
} from "@zhiyin/sandbox";
import { requirements, type PackageLock } from "./default-packages.js";
import {
  packageHosts,
  packageMirrorIndex,
  pythonMirror,
  reaching,
} from "./download-sources.js";
import type { EnvironmentRecord, Environments } from "./environments.js";
import { stages } from "./kept-installation.js";
import { duration, pythonEnvironment, reported } from "./programs.js";
import { keepStartup } from "./startup.js";

/** Where a kept environment's lock is written, in the sandbox's folder, for uv to install from. */
export const lockFileOf = (name: string) => `${name}-packages.txt`;

/** Why a confined run did not start, when the container could not be made. */
export function unconfined(ran: ProgramRun): string | undefined {
  return ran.failure === "containment" || ran.failure === "confinement"
    ? (ran.reason ?? "")
    : undefined;
}

type Outcome = { readonly ok: true } | { readonly ok: false; reason: string };

export function environmentMaking(options: {
  /** The sandbox's folder, where uv runs and lock files are written. */
  readonly directory: string;
  readonly run: RunProgram;
  readonly prepareTimeoutMs: number;
  readonly containment?: ProgramContainment;
  readonly environments: Environments;
  /** Where the environments are, made before the first. */
  readonly environmentsFolder: string;
  /** The Pythons environments are made from, Zhiyin's own and no one else's. */
  readonly python: string;
  /** Zhiyin's own environments, each made from its lock. */
  readonly kept: ReadonlyMap<string, PackageLock>;
  /** The default environment's lock: an environment of the person's own gets the pip published by its date. */
  readonly lock: PackageLock;
  /** Where one environment's installs keep pip's cache, apart from every other's. */
  readonly installHome: (name: string) => string;
}) {
  const {
    run,
    prepareTimeoutMs,
    environments,
    environmentsFolder,
    python,
    kept,
    lock,
    installHome,
  } = options;
  const contained = options.containment
    ? { containment: options.containment }
    : {};

  /** What a step said as it failed: for one that ran out of time, the limit and what to do instead. */
  const failureOf = (ran: ProgramRun): string =>
    ran.ending === "timeout"
      ? `This step took longer than ${duration(prepareTimeoutMs)}, the most one may take, so it was stopped. Try again later, when the downloads may be faster.\n${reported(ran)}`.trim()
      : reported(ran);

  /**
   * A `uv` command, in the sandbox folder so a `pyproject.toml` in the
   * person's workspace can never decide what it does, on Zhiyin's own Python.
   * uv cannot run in a container, so it only makes environments and installs
   * the default one's packages, as wheels, into a new one.
   */
  const invokeUv = (
    uv: string,
    args: readonly string[],
    signal?: AbortSignal,
    mirrors = false,
  ): Promise<ProgramRun> =>
    run({
      executable: uv,
      arguments: args,
      cwd: options.directory,
      timeoutMs: prepareTimeoutMs,
      ...(signal ? { signal } : {}),
      ...contained,
      environment: {
        ...pythonEnvironment(),
        // uv then downloads Python from the mirror only, still checking it.
        ...(mirrors ? { UV_PYTHON_INSTALL_MIRROR: pythonMirror } : {}),
        UV_PYTHON_INSTALL_DIR: python,
        // uv would otherwise put a copy of the Python it downloads among
        // the person's own programs.
        UV_PYTHON_INSTALL_BIN: "0",
        // A linked file keeps the permissions of uv's cached copy, which
        // scripts cannot read; a copy takes the environment's.
        UV_LINK_MODE: "copy",
      },
    });

  /**
   * The environment's own pip, installing what the model asked for. A package
   * may run its own code as it installs, so pip reads Zhiyin's Python,
   * changes only that environment, and reaches only the package index.
   */
  const invokePip = async (
    name: string,
    asked: readonly string[],
    signal?: AbortSignal,
    mirrors = false,
  ): Promise<ProgramRun> => {
    const folder = environments.folder(name);
    await keepStartup(folder);
    return run({
      executable: environments.interpreter(name),
      arguments: [
        "-m",
        "pip",
        "--no-input",
        "--disable-pip-version-check",
        "install",
        ...(mirrors ? ["--index-url", packageMirrorIndex] : []),
        ...asked,
      ],
      cwd: folder,
      timeoutMs: prepareTimeoutMs,
      ...(signal ? { signal } : {}),
      ...contained,
      environment: pythonEnvironment(),
      confinement: {
        purpose: "python-install",
        home: installHome(name),
        read: [python],
        write: [folder],
        // The package index and its mirror, and where they keep the files.
        hosts: packageHosts,
      },
    });
  };

  /**
   * The default packages, into the default environment: wheels only, so none
   * of their own code runs to install them outside a container, and only the
   * locked versions, each file checked against its hash, so a file that
   * differs from what the lock names is refused and nothing else resolves.
   */
  const installLocked = async (
    uv: string,
    name: string,
    signal?: AbortSignal,
    mirrors = false,
  ): Promise<ProgramRun> => {
    await writeFile(
      join(options.directory, lockFileOf(name)),
      requirements(kept.get(name) as PackageLock),
    );
    return invokeUv(
      uv,
      [
        "pip",
        "install",
        "--no-config",
        "--no-build",
        "--require-hashes",
        ...(mirrors ? ["--default-index", packageMirrorIndex] : []),
        "--python",
        environments.interpreter(name),
        // Read from the sandbox's folder, uv's working directory.
        "-r",
        lockFileOf(name),
      ],
      signal,
      mirrors,
    );
  };

  /** What a failed install says, or nothing when it worked. */
  const installFailure = (ran: ProgramRun): string | undefined => {
    const refused = unconfined(ran);
    if (refused !== undefined)
      return `Zhiyin could not give pip only the environment, so nothing was installed. ${refused}`.trim();
    if (ran.ending === "timeout")
      return `Installing the packages took longer than ${duration(prepareTimeoutMs)}, the most one install may take, so it was stopped. Ask for fewer packages at once, adding the rest with install_python_package, or try again later, when the downloads may be faster.\n${reported(ran)}`.trim();
    return ran.exitCode === 0 ? undefined : reported(ran);
  };

  /**
   * Compiles an environment's packages ahead, outside an app container, with
   * Python told to read no settings and no startup file of its packages, so
   * none of their code runs. A file that does not compile is left to be
   * compiled as it is imported, as before.
   */
  const compiled = (name: string, signal?: AbortSignal) => {
    const folder = environments.folder(name);
    return run({
      executable: environments.interpreter(name),
      arguments: [
        "-I",
        "-S",
        "-m",
        "compileall",
        "-q",
        join(folder, "Lib", "site-packages"),
      ],
      cwd: folder,
      timeoutMs: prepareTimeoutMs,
      ...(signal ? { signal } : {}),
      ...contained,
      environment: pythonEnvironment(),
    });
  };

  /**
   * Makes an environment from nothing, as its record says. One already there
   * is set aside first and let go of only once the new one is whole; when a
   * step fails, what was made is deleted and the old one put back where it
   * was, so every path written inside it still holds. An environment is
   * either whole, or as it was. `onStage` hears each step as it begins.
   */
  async function build(
    name: string,
    record: EnvironmentRecord,
    uv: string,
    signal?: AbortSignal,
    onStage?: (stage: ToolchainStage) => void,
  ): Promise<Outcome> {
    const steps = record.packages.length ? (kept.has(name) ? 3 : 2) : 1;
    const begin = (step: 1 | 2 | 3) =>
      onStage?.({ name: stages[step - 1] as string, step, steps });
    const folder = environments.folder(name);
    await mkdir(environmentsFolder, { recursive: true });
    let previous: boolean;
    try {
      previous = await environments.setAside(name);
    } catch {
      return {
        ok: false,
        reason: `The Python environment “${name}” is in use, perhaps by a script still running in it, so it was not made again. Try again once it ends.`,
      };
    }
    await environments.keepRecord(name, { ...record, ready: false });
    const failed = async (reason: string): Promise<Outcome> => {
      if (previous) await environments.restoreAside(name);
      else await environments.remove(name);
      return { ok: false, reason };
    };
    begin(1);
    const made = await reaching(async (mirrors) => {
      // What a try that could not download left is not built on.
      if (mirrors) await rm(folder, { recursive: true, force: true });
      return invokeUv(
        uv,
        // Python as uv downloads it, as the approval says, never one already
        // on the PC, with pip in the environment as published by the date the
        // release fixes.
        [
          "venv",
          "--no-config",
          "--seed",
          "--exclude-newer",
          (kept.get(name) ?? lock).publishedBy,
          ...(mirrors ? ["--default-index", packageMirrorIndex] : []),
          "--python",
          record.python,
          "--managed-python",
          folder,
        ],
        signal,
        mirrors,
      );
    }, signal);
    if (made.exitCode !== 0)
      return failed(
        `The Python environment “${name}” could not be created.\n${failureOf(made)}`,
      );
    await keepStartup(folder);
    if (record.packages.length) {
      begin(2);
      const installed = await reaching(
        (mirrors) =>
          kept.has(name)
            ? installLocked(uv, name, signal, mirrors)
            : invokePip(name, record.packages, signal, mirrors),
        signal,
      );
      const failure = kept.has(name)
        ? installed.exitCode === 0
          ? undefined
          : failureOf(installed)
        : installFailure(installed);
      if (failure !== undefined)
        return failed(
          `The packages of the Python environment “${name}” could not be installed.\n${failure}`,
        );
      // Scripts may not write the environment, so Python cannot keep what it
      // compiles of a package for the next run: compiled here once instead.
      if (kept.has(name)) {
        begin(3);
        await compiled(name, signal);
      }
    }
    await environments.keepRecord(name, { ...record, ready: true });
    if (previous) await environments.dropAside(name);
    return { ok: true };
  }

  return { build, invokePip, installFailure };
}
