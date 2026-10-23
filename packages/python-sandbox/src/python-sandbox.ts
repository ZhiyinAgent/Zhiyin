import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { OfferedConnection } from "@zhiyin/contract";
import {
  forgetConfinement,
  runProcess as runProgram,
  type ProcessContainment as ProgramContainment,
  type ProcessRun as ProgramRun,
  type RunProcess as RunProgram,
} from "@zhiyin/process-ownership";
import {
  defaultEnvironment,
  Environments,
  isPythonVersion,
  nameProblem,
  packageList,
  type EnvironmentRecord,
} from "./environments.js";
import {
  defaultLock,
  requirements,
  type PackageLock,
} from "./default-packages.js";
import { pythonEnvironment, reported } from "./programs.js";
import {
  asTheFile,
  bindingRefusal,
  readScript,
  scriptIdentity,
  scriptSource,
} from "./script-files.js";
import { keepStartup } from "./startup.js";
import { tools } from "./tools.js";

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
};

/** Where the default packages' lock is written, in the sandbox's folder, for uv to install from. */
const lockFile = "default-packages.txt";

const notInstalled =
  "The Python environment is not installed. Install it from the Data Science plugin before running scripts.";

const networkAnswer =
  "Say whether the script may use the internet with true or false.";

const nameEnvironment = "Name the environment with text.";

/**
 * Where a call is sent, as an approval names it: uv downloads Python from
 * Astral's mirror of python-build-standalone, and pip and uv fetch packages
 * from the Python Package Index.
 */
const packageIndex = "pypi.org";
const pythonAndPackages = "releases.astral.sh and pypi.org";

/** How the default environment's own packages are chosen, as an approval says it. */
const pinnedPackages =
  "Its own packages are the versions Zhiyin pins, each checked against the SHA-256 Zhiyin keeps.";

/** What a package's own code may reach while it installs. */
const installReach =
  "Installing a package can run its own code, which can change only that environment and use the internet.";

/** Whether a call asks for the internet: no unless it says yes, nothing when it says neither. */
function asksForNetwork(args: Record<string, unknown>): boolean | undefined {
  const network = args["network"];
  if (network === undefined) return false;
  return typeof network === "boolean" ? network : undefined;
}

/** The environment a call names, the default when it names none, or nothing when it names one wrongly. */
function chosenEnvironment(
  args: Record<string, unknown>,
  field = "environment",
): string | undefined {
  const named = args[field];
  if (named === undefined) return defaultEnvironment;
  return typeof named === "string" ? named : undefined;
}

function missing(name: string): string {
  return `There is no Python environment named “${name}” ready to use. list_python_environments names those there are.`;
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: text || "(no output)" }],
    ...(isError ? { isError: true } : {}),
  };
}

type Outcome = { readonly ok: true } | { readonly ok: false; reason: string };

/**
 * Why a script cannot be shown as what runs, if it cannot. Zhiyin writes a
 * script as UTF-8, but Python reads it in whatever encoding its first or
 * second line declares (PEP 263), and in another one, such as UTF-7, text the
 * approval shows as a comment can be code.
 */
function declaredEncodingRefusal(source: string): string | undefined {
  for (const line of source.split(/\r\n|\r|\n/).slice(0, 2)) {
    const declared = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/.exec(line)?.[1];
    if (declared !== undefined && !/^utf[-_]?8$/i.test(declared))
      return `This script declares the ${declared} encoding, so Python would read it differently from what is shown. Remove that line, or declare utf-8.`;
  }
  return undefined;
}

/** A folder's name for a workspace: the same each time, and only its. */
function workspaceKey(root: string): string {
  return createHash("sha256")
    .update(resolve(root).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/** Why a confined run did not start, when the container could not be made. */
function unconfined(ran: ProgramRun): string | undefined {
  return ran.failure === "containment" || ran.failure === "confinement"
    ? (ran.reason ?? "")
    : undefined;
}

/**
 * One Python sandbox for every folder: its environments, and the locks that
 * keep two changes of one environment apart, are shared, and each folder is
 * offered a connection of its own that runs there. ADR 0008.
 */
export function pythonSandboxes(
  options: Omit<PythonSandboxOptions, "workspaceRoot">,
): (workspaceRoot: () => string | undefined) => OfferedConnection {
  const run = options.run ?? runProgram;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const prepareTimeoutMs = options.prepareTimeoutMs ?? 900_000;
  const lock = options.lock ?? defaultLock;
  const pythonVersion = lock.python;
  const defaultRecord: EnvironmentRecord = {
    python: pythonVersion,
    packages: [...lock.asked],
    ready: true,
  };
  /** The Pythons environments are made from, Zhiyin's own and no one else's. */
  const python = join(options.directory, "python");
  const environmentsFolder = join(options.directory, "environments");
  const environments = new Environments(environmentsFolder);
  const scripts = join(options.directory, "scripts");
  const homes = join(options.directory, "homes");
  /** Where one environment's installs keep pip's cache, apart from every other's. */
  const installHome = (name: string) => join(homes, `install-${name}`);
  const contained = options.containment
    ? { containment: options.containment }
    : {};

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
   * changes only that environment, and may use the internet to fetch.
   */
  const invokePip = async (
    name: string,
    asked: readonly string[],
    signal?: AbortSignal,
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
        network: true,
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
    signal?: AbortSignal,
  ): Promise<ProgramRun> => {
    await writeFile(join(options.directory, lockFile), requirements(lock));
    return invokeUv(
      uv,
      [
        "pip",
        "install",
        "--no-config",
        "--no-build",
        "--require-hashes",
        "--python",
        environments.interpreter(defaultEnvironment),
        // Read from the sandbox's folder, uv's working directory.
        "-r",
        lockFile,
      ],
      signal,
    );
  };

  /** What a failed install says, or nothing when it worked. */
  const installFailure = (ran: ProgramRun): string | undefined => {
    const refused = unconfined(ran);
    if (refused !== undefined)
      return `Zhiyin could not give pip only the environment, so nothing was installed. ${refused}`.trim();
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
   * Makes an environment from nothing, as its record says. Whatever was
   * there is deleted first, and what was made is deleted again when a step
   * fails, so an environment is either whole or gone.
   */
  async function build(
    name: string,
    record: EnvironmentRecord,
    uv: string,
    signal?: AbortSignal,
  ): Promise<Outcome> {
    const folder = environments.folder(name);
    await environments.remove(name);
    await mkdir(environmentsFolder, { recursive: true });
    await environments.keepRecord(name, { ...record, ready: false });
    const failed = async (reason: string): Promise<Outcome> => {
      await environments.remove(name);
      return { ok: false, reason };
    };
    const made = await invokeUv(
      uv,
      // Python as uv downloads it, as the approval says, never one already
      // on the PC, with pip in the environment as published by the date the
      // release fixes.
      [
        "venv",
        "--no-config",
        "--seed",
        "--exclude-newer",
        lock.publishedBy,
        "--python",
        record.python,
        "--managed-python",
        folder,
      ],
      signal,
    );
    if (made.exitCode !== 0)
      return failed(
        `The Python environment “${name}” could not be created.\n${reported(made)}`,
      );
    await keepStartup(folder);
    if (record.packages.length) {
      const installed =
        name === defaultEnvironment
          ? await installLocked(uv, signal)
          : await invokePip(name, record.packages, signal);
      const failure =
        name === defaultEnvironment
          ? installed.exitCode === 0
            ? undefined
            : reported(installed)
          : installFailure(installed);
      if (failure !== undefined)
        return failed(
          `The packages of the Python environment “${name}” could not be installed.\n${failure}`,
        );
      // Scripts may not write the environment, so Python cannot keep what it
      // compiles of a package for the next run: compiled here once instead.
      if (name === defaultEnvironment) await compiled(name, signal);
    }
    await environments.keepRecord(name, { ...record, ready: true });
    return { ok: true };
  }

  /** Makes the default environment if it is not there yet; call it while changing it. */
  async function ensureDefault(
    uv: string,
    signal?: AbortSignal,
  ): Promise<Outcome> {
    if (await environments.isReady(defaultEnvironment)) return { ok: true };
    // The one environment kept before environments had names.
    await rm(join(options.directory, ".venv"), {
      recursive: true,
      force: true,
    });
    return build(defaultEnvironment, defaultRecord, uv, signal);
  }

  async function ready(): Promise<string> {
    const uv = await options.uv();
    if (!uv) throw new Error(notInstalled);
    return uv;
  }

  /** Whether a call may use the environment it names, as things are now. */
  async function knownEnvironment(name: string): Promise<boolean> {
    return name === defaultEnvironment || (await environments.isReady(name));
  }

  /** Said when using the default environment will make it first. */
  async function preparing(name: string): Promise<string | undefined> {
    return name === defaultEnvironment &&
      !(await environments.isReady(defaultEnvironment))
      ? "Zhiyin first makes the default environment, downloading Python from releases.astral.sh and its packages from pypi.org."
      : undefined;
  }

  async function runScript(
    root: string,
    args: Record<string, unknown>,
    uv: string,
    signal?: AbortSignal,
    /** The identity of the approval this run is under. */
    binding?: string,
  ) {
    const online = asksForNetwork(args);
    if (online === undefined) return textResult(networkAnswer, true);
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
    if (name === defaultEnvironment) {
      const made = await environments.oneAtATime(defaultEnvironment, () =>
        ensureDefault(uv, signal),
      );
      if (!made.ok) return textResult(made.reason, true);
    } else if (!(await environments.isReady(name)))
      return textResult(missing(name), true);

    const folder = environments.folder(name);
    // In a folder of its own, which scripts may read and not change, so no
    // other script can change the code between approval and running. A
    // workspace script runs from this copy of what was approved, too.
    const temporary = join(scripts, randomUUID());
    await mkdir(temporary, { recursive: true });
    const script = join(temporary, "script.py");
    await writeFile(script, source, "utf8");
    try {
      await keepStartup(folder);
      const ran = await run({
        executable: environments.interpreter(name),
        arguments: file
          ? asTheFile(script, file, scriptArguments)
          : [script, ...scriptArguments],
        cwd: root,
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...contained,
        environment: pythonEnvironment(),
        // A script reads Zhiyin's Python, its environment and its own code,
        // and changes the workspace. Scripts with and without the internet
        // keep homes apart, so nothing left by one without it is read by one
        // that could send it on.
        confinement: {
          purpose: "python",
          home: join(
            homes,
            `${workspaceKey(root)}-${online ? "online" : "offline"}`,
          ),
          read: [python, folder, temporary],
          write: [root],
          network: online === true,
        },
      });
      const refused = unconfined(ran);
      if (refused !== undefined)
        return textResult(
          `Zhiyin could not give Python only the workspace, so the script did not run. ${refused}`.trim(),
          true,
        );
      if (ran.exitCode === null)
        return textResult(`The script did not finish.\n${reported(ran)}`, true);
      return ran.exitCode === 0
        ? textResult(reported(ran))
        : textResult(
            `The script exited with code ${ran.exitCode}.\n${reported(ran)}`,
            true,
          );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

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
    if (!(await knownEnvironment(name))) return textResult(missing(name), true);
    return environments.oneAtATime(name, async () => {
      if (name === defaultEnvironment) {
        const made = await ensureDefault(uv, signal);
        if (!made.ok) return textResult(made.reason, true);
      } else if (!(await environments.isReady(name)))
        return textResult(missing(name), true);
      const installed = await invokePip(name, asked, signal);
      const failure = installFailure(installed);
      return failure === undefined
        ? textResult(
            `Installed ${asked.join(", ")} into “${name}”.\n${reported(installed)}`,
          )
        : textResult(failure, true);
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
    if (name === defaultEnvironment)
      return {
        ok: false,
        reason:
          "“default” is Zhiyin's own environment; reset_python_environment rebuilds it.",
      };
    const problem = nameProblem(name);
    if (problem !== undefined) return { ok: false, reason: problem };
    const python = args["python"] ?? pythonVersion;
    if (!isPythonVersion(python))
      return {
        ok: false,
        reason: "Name the Python by its version, such as 3.12.",
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

  function described(record: EnvironmentRecord): string {
    return record.packages.length
      ? `Python ${record.python} and ${record.packages.join(", ")}`
      : `Python ${record.python}`;
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
      defaultEnvironment,
      ...(await environments.names()).filter(
        (name) => name !== defaultEnvironment,
      ),
    ];
    const lines: string[] = [];
    for (const name of names) {
      if (!(await environments.isReady(name))) {
        lines.push(
          name === defaultEnvironment
            ? `${name} — not made yet. It is made with ${described(defaultRecord)} the first time a script runs in it or a package is added to it.`
            : `${name} — not finished: remove it, or create it again.`,
        );
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
    if (name === defaultEnvironment)
      return "The default environment cannot be removed; reset_python_environment rebuilds it.";
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

  /** What resetting an environment rebuilds it with, or nothing when it cannot be reset. */
  async function resetRecord(
    name: string,
  ): Promise<EnvironmentRecord | undefined> {
    if (name === defaultEnvironment) return defaultRecord;
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
    if (!(await resetRecord(name)))
      return textResult(
        `There is no Python environment named “${name}”.`,
        true,
      );
    return environments.oneAtATime(name, async () => {
      const record = await resetRecord(name);
      if (!record)
        return textResult(
          `There is no Python environment named “${name}”.`,
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

  function packagesCommand(name: string, record: EnvironmentRecord): string {
    const made = `uv venv --seed --exclude-newer ${lock.publishedBy} --python ${record.python} ${name}`;
    if (!record.packages.length) return made;
    return name === defaultEnvironment
      ? `${made}\nuv pip install --no-build --require-hashes -r ${lockFile}`
      : `${made}\npython -m pip install ${record.packages.join(" ")}`;
  }

  return (workspaceRoot) => ({
    /** Asked again every look, so installing uv is noticed without a restart. */
    async listTools() {
      await ready();
      return tools;
    },

    async inspect(name, args) {
      if (name === "run_python" && !workspaceRoot())
        return { ok: false, reason: "Choose a folder before running Python." };
      if (!(await options.uv())) return { ok: false, reason: notInstalled };

      if (name === "run_python") {
        const root = workspaceRoot() as string;
        const asked = scriptSource(args);
        if (asked.kind === "neither")
          return { ok: false, reason: asked.reason };
        const online = asksForNetwork(args);
        if (online === undefined) return { ok: false, reason: networkAnswer };
        const environment = chosenEnvironment(args);
        if (environment === undefined)
          return { ok: false, reason: nameEnvironment };
        if (!(await knownEnvironment(environment)))
          return { ok: false, reason: missing(environment) };
        const first = await preparing(environment);
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
        return {
          ok: true,
          action: "Run a Python script",
          target:
            environment === defaultEnvironment
              ? script
              : `${script}, in ${environment}`,
          // Whole: what is approved is what runs.
          command: asked.kind === "code" ? asked.code : (fileCode as string),
          ...(identity ? { identity } : {}),
          ...(fileCode === undefined
            ? {}
            : {
                invocation: {
                  name: "run_python",
                  arguments: [
                    ...Object.entries(args).map(([key, value]) => ({
                      name: key,
                      value:
                        typeof value === "string"
                          ? value
                          : (JSON.stringify(value, null, 2) ?? ""),
                    })),
                    { name: `Code in ${script}`, value: fileCode },
                  ],
                },
              }),
          detail: [
            online
              ? "The script reads and changes only the workspace, and can use the internet: it could send what it reads anywhere."
              : "The script reads and changes only the workspace, and cannot use the internet.",
            ...(first ? [first] : []),
          ].join(" "),
          // Scripts that reach only the workspace are one set the person can
          // allow for the conversation, whatever environment they run in; one
          // that can use the internet is asked for each time (ADR 0009).
          ...(online
            ? { asksEachTime: true as const }
            : {
                allowance: {
                  key: JSON.stringify({ workspace: root, python: "offline" }),
                  label:
                    "Python scripts that reach only the workspace, without the internet",
                },
              }),
        };
      }

      if (name === "install_python_package") {
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
        if (!(await knownEnvironment(environment)))
          return { ok: false, reason: missing(environment) };
        const first = await preparing(environment);
        return {
          ok: true,
          action: "Add packages to a Python environment",
          target: `${asked.join(", ")}, into ${environment}`,
          command: `python -m pip install ${asked.join(" ")}`,
          detail: first ? `${installReach} ${first}` : installReach,
          destination: first ? pythonAndPackages : packageIndex,
          asksEachTime: true,
        };
      }

      if (name === "create_python_environment") {
        const asked = await newEnvironment(args);
        if (!asked.ok) return asked;
        return {
          ok: true,
          action: "Create a Python environment",
          target: asked.name,
          command: packagesCommand(asked.name, asked.record),
          detail: asked.record.packages.length
            ? installReach
            : "It is made with pip, and kept until it is removed.",
          // pip itself comes from the package index, whatever else is asked.
          destination: pythonAndPackages,
          asksEachTime: true,
        };
      }

      if (name === "list_python_environments")
        return {
          ok: true,
          action: "List the Python environments",
          target: "Zhiyin's Python environments",
          command: "list_python_environments",
        };

      if (name === "remove_python_environment") {
        const problem = await removalProblem(args["name"]);
        if (problem !== undefined) return { ok: false, reason: problem };
        const environment = args["name"] as string;
        return {
          ok: true,
          action: "Remove a Python environment",
          target: environment,
          command: `delete ${environments.folder(environment)}`,
          detail: "Everything installed in it is deleted.",
          asksEachTime: true,
        };
      }

      if (name === "reset_python_environment") {
        const environment = chosenEnvironment(args);
        if (environment === undefined)
          return { ok: false, reason: nameEnvironment };
        const record = await resetRecord(environment);
        if (!record)
          return {
            ok: false,
            reason: `There is no Python environment named “${environment}”.`,
          };
        return {
          ok: true,
          action: "Rebuild a Python environment",
          target: environment,
          command: packagesCommand(environment, record),
          detail:
            environment === defaultEnvironment
              ? `Packages added to it since it was made are removed. ${pinnedPackages}`
              : "Packages added to it since it was made are removed.",
          destination: pythonAndPackages,
          asksEachTime: true,
        };
      }

      return { ok: false, reason: `The tool “${name}” is not available.` };
    },

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
          return install(args, uv, signal);
        case "create_python_environment":
          return create(args, uv, signal);
        case "list_python_environments":
          return list();
        case "remove_python_environment":
          return remove(args);
        case "reset_python_environment":
          return reset(args, uv, signal);
        default:
          return textResult(`Unknown tool “${name}”.`, true);
      }
    },

    describeResult(_name, _args, result) {
      return result.ok
        ? []
        : [{ kind: "text", label: "Python output", text: result.reason }];
    },

    async close() {},
  });
}

/** The sandbox for one folder. */
export function pythonSandbox(
  options: PythonSandboxOptions,
): OfferedConnection {
  return pythonSandboxes(options)(options.workspaceRoot);
}
