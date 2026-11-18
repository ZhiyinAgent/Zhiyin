/**
 * uv, pip and Python as the sandbox meets them, standing in for the real
 * programs: making an environment puts an interpreter and its settings where
 * uv would, and installing a package leaves its record where pip would, so
 * the sandbox finds what it would find after the real thing.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TemporaryFolders } from "@zhiyin/test-support";
import { pythonSandbox, type RunProgram } from "../src/index.js";

type ProgramRunResult = Awaited<ReturnType<RunProgram>>;

export const folders = new TemporaryFolders();

export type Call = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly confinement: Parameters<RunProgram>[0]["confinement"];
  /** How much it may print before it is stopped, when it was given a limit. */
  readonly maximumOutputBytes?: number;
  /** What a script it was asked to run held at that moment. */
  readonly scriptText?: string;
};

export const uvProgram = "C:/programs/uv.exe";

/** The name a requirement such as `pyarrow>=15` installs. */
function nameOf(requirement: string): string {
  return /^[A-Za-z0-9._-]+/.exec(requirement)?.[0] ?? requirement;
}

/**
 * Leaves each package's record where pip would, and answers as pip does: the
 * packages it installed, and those already there.
 */
async function recordInstalled(
  environment: string,
  requirements: string[],
): Promise<string> {
  const installed: string[] = [];
  const present: string[] = [];
  for (const requirement of requirements) {
    const name = nameOf(requirement);
    const packages = join(environment, "Lib", "site-packages");
    const record = join(packages, `${name.replaceAll("-", "_")}-1.0.dist-info`);
    if (await readdir(record).catch(() => undefined)) {
      present.push(
        `Requirement already satisfied: ${requirement} in ${packages.toLowerCase()} (1.0)`,
      );
      continue;
    }
    installed.push(`${name}-1.0`);
    await mkdir(record, { recursive: true });
    await writeFile(
      join(record, "METADATA"),
      `Metadata-Version: 2.1\nName: ${name}\nVersion: 1.0\n`,
    );
  }
  return [
    ...present,
    ...(installed.length
      ? [`Successfully installed ${installed.join(" ")}`]
      : []),
  ].join("\n");
}

export async function sandboxWith(
  options: {
    readonly uv?: string | undefined;
    /** A program asked for with this among its arguments fails. */
    readonly failing?: string;
    /** A program asked for with this among its arguments runs out of time, and is stopped. */
    readonly slow?: string;
    /**
     * What pip does, asked to install a package named here: the packages it
     * adds and removes in its place, how it exits and what it says.
     */
    readonly pipDoes?: Readonly<
      Record<
        string,
        {
          readonly adds?: readonly string[];
          readonly removes?: readonly string[];
          readonly exitCode?: number;
          readonly stderr?: string;
        }
      >
    >;
    readonly output?: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
      /** What a script that names hosts reached, as Zhiyin's proxy counts it. */
      network?: ProgramRunResult["network"];
      /** What went to the hosts past the first hundred it asked for. */
      furtherHosts?: ProgramRunResult["furtherHosts"];
      /** Why a script's run was ended early, as the process layer says it. */
      ending?: ProgramRunResult["ending"];
    };
    readonly workspace?: () => string | undefined;
  } = {},
) {
  const workspace = await folders.make("zhiyin-sandbox-workspace-");
  const directory = join(
    await folders.make("zhiyin-sandbox-data-"),
    "python-sandbox",
  );
  const calls: Call[] = [];
  const failing = { current: options.failing };
  /** A file whose run cannot even start, as when Windows refuses the program. */
  const unstartable: { current: string | undefined } = { current: undefined };
  /**
   * Where uv and pip download from is out of reach, as from a network that
   * blocks it: the sites they use by default, or the mirrors.
   */
  const unreachable = { original: false, mirrors: false };
  /** How many programs ran at once, at most. */
  const running = { now: 0, most: 0 };
  const run: RunProgram = async (given) => {
    running.now += 1;
    running.most = Math.max(running.most, running.now);
    try {
      return await answer(given);
    } finally {
      running.now -= 1;
    }
  };
  const answer: RunProgram = async (given) => {
    const args = [...given.arguments];
    // The first file named is the one Python is given to run.
    const scriptFile = args.find((part) => part.endsWith(".py"));
    const scriptText = scriptFile
      ? await readFile(scriptFile, "utf8").catch(() => undefined)
      : undefined;
    calls.push({
      executable: given.executable,
      arguments: args,
      cwd: given.cwd,
      environment: given.environment ?? {},
      confinement: given.confinement,
      ...(given.maximumOutputBytes === undefined
        ? {}
        : { maximumOutputBytes: given.maximumOutputBytes }),
      ...(scriptText === undefined ? {} : { scriptText }),
    });
    // Long enough for a second change asked for meanwhile to start, unless
    // something holds it back.
    await new Promise((settle) => setTimeout(settle, 5));
    if (unstartable.current && args.includes(unstartable.current))
      return { exitCode: null, stdout: "", stderr: "", failure: "start" };
    const fetches =
      (given.executable === uvProgram && ["venv", "pip"].includes(args[0]!)) ||
      (args[0] === "-m" && args[1] === "pip");
    const toMirrors =
      args.includes("--default-index") || args.includes("--index-url");
    if (fetches && (toMirrors ? unreachable.mirrors : unreachable.original))
      return {
        exitCode: 2,
        stdout: "",
        // As uv says it when the index does not answer.
        stderr:
          "error: Failed to fetch: `https://pypi.org/simple/pip/`\n  Caused by: error sending request for url (https://pypi.org/simple/pip/)",
      };
    if (options.slow && args.includes(options.slow))
      return {
        exitCode: null,
        stdout: "Still downloading\n",
        stderr: "",
        ending: "timeout",
      };
    const does = Object.entries(options.pipDoes ?? {}).find(([name]) =>
      args.includes(name),
    )?.[1];
    if (does && args[0] === "-m" && args[1] === "pip") {
      const site = join(
        dirname(dirname(given.executable)),
        "Lib",
        "site-packages",
      );
      for (const name of does.removes ?? [])
        await rm(join(site, `${name.replaceAll("-", "_")}-1.0.dist-info`), {
          recursive: true,
        });
      await recordInstalled(dirname(dirname(given.executable)), [
        ...(does.adds ?? []),
      ]);
      return {
        exitCode: does.exitCode ?? 0,
        stdout: "",
        stderr: does.stderr ?? "",
      };
    }
    if (failing.current && args.includes(failing.current))
      return {
        exitCode: 1,
        stdout: "",
        // As Python says it on every start in a container.
        stderr: `${given.confinement ? `Failed to find real location of ${given.executable}\r\n` : ""}it went wrong`,
      };
    if (given.executable === uvProgram && args[0] === "venv") {
      const folder = args.at(-1)!;
      const version = args[args.indexOf("--python") + 1] ?? "3.13";
      await mkdir(join(folder, "Scripts"), { recursive: true });
      await writeFile(join(folder, "Scripts", "python.exe"), "not Python");
      const pythons = given.environment?.["UV_PYTHON_INSTALL_DIR"];
      const home = join(
        pythons ?? "C:\\Users\\someone\\AppData\\Roaming\\uv\\python",
        `cpython-${version}-windows-x86_64-none`,
      );
      // The Python uv downloaded, where it keeps it.
      if (pythons) await mkdir(home, { recursive: true });
      await writeFile(
        join(folder, "pyvenv.cfg"),
        `home = ${home}\nimplementation = CPython\nversion_info = ${version}\n`,
      );
      if (args.includes("--seed")) await recordInstalled(folder, ["pip"]);
    } else if (given.executable === uvProgram && args[0] === "pip") {
      const python = args[args.indexOf("--python") + 1]!;
      const lock = args.includes("-r")
        ? args[args.indexOf("-r") + 1]!
        : undefined;
      await recordInstalled(
        dirname(dirname(python)),
        lock
          ? (await readFile(resolve(given.cwd, lock), "utf8"))
              .split("\n")
              .filter((line) => line.trim())
          : args.slice(args.indexOf("--python") + 2),
      );
    } else if (
      args[0] === "-m" &&
      args[1] === "pip" &&
      args.includes("install")
    )
      return {
        exitCode: 0,
        stderr: "",
        stdout: await recordInstalled(
          dirname(dirname(given.executable)),
          args
            .slice(args.indexOf("install") + 1)
            // An index is named with its address, which installs nothing.
            .filter(
              (part, at, rest) =>
                part !== "--index-url" && rest[at - 1] !== "--index-url",
            ),
        ),
      };
    else {
      const output = options.output ?? { exitCode: 0 };
      return {
        exitCode: output.exitCode,
        stdout: output.stdout ?? "",
        stderr: output.stderr ?? "",
        ...(output.ending ? { ending: output.ending } : {}),
        ...(output.network && given.confinement?.hosts.length
          ? { network: output.network }
          : {}),
        ...(output.furtherHosts && given.confinement?.hosts.length
          ? { furtherHosts: output.furtherHosts }
          : {}),
      };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const environments = join(directory, "environments");
  return {
    workspace,
    directory,
    calls,
    /** The stand-in programs, for a test that builds its own sandbox. */
    run,
    failing,
    unstartable,
    unreachable,
    running,
    /** The folder of the environment named `name`. */
    environment: (name: string) => join(environments, name),
    /** The interpreter of the environment named `name`. */
    interpreter: (name = "default") =>
      join(environments, name, "Scripts", "python.exe"),
    /** What is installed in the environment named `name`, by name. */
    installed: async (name: string) =>
      (
        await readdir(join(environments, name, "Lib", "site-packages")).catch(
          () => [] as string[],
        )
      )
        .filter((entry) => entry.endsWith(".dist-info"))
        .map((entry) => entry.split("-")[0]!.replaceAll("_", "-"))
        .sort(),
    sandbox: pythonSandbox({
      workspaceRoot: options.workspace ?? (() => workspace),
      directory,
      uv: async () => ("uv" in options ? options.uv : uvProgram),
      run,
    }),
  };
}

/** The runs of an environment's interpreter that ran a script, not a module such as pip. */
export function scriptRuns(calls: readonly Call[], interpreter: string) {
  return calls.filter(
    (call) => call.executable === interpreter && !call.arguments.includes("-m"),
  );
}
