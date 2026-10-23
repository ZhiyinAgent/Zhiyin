/**
 * uv, pip and Python as the sandbox meets them, standing in for the real
 * programs: making an environment puts an interpreter and its settings where
 * uv would, and installing a package leaves its record where pip would, so
 * the sandbox finds what it would find after the real thing.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { pythonSandbox, type RunProgram } from "../src/index.js";

export const folders = new TemporaryFolders();

export type Call = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly confinement: Parameters<RunProgram>[0]["confinement"];
  /** What a script it was asked to run held at that moment. */
  readonly scriptText?: string;
};

export const uvProgram = "C:/programs/uv.exe";

/** The name a requirement such as `pyarrow>=15` installs. */
function nameOf(requirement: string): string {
  return /^[A-Za-z0-9._-]+/.exec(requirement)?.[0] ?? requirement;
}

async function recordInstalled(environment: string, requirements: string[]) {
  for (const requirement of requirements) {
    const name = nameOf(requirement);
    const record = join(
      environment,
      "Lib",
      "site-packages",
      `${name.replaceAll("-", "_")}-1.0.dist-info`,
    );
    await mkdir(record, { recursive: true });
    await writeFile(
      join(record, "METADATA"),
      `Metadata-Version: 2.1\nName: ${name}\nVersion: 1.0\n`,
    );
  }
}

export async function sandboxWith(
  options: {
    readonly uv?: string | undefined;
    /** A program asked for with this among its arguments fails. */
    readonly failing?: string;
    readonly output?: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
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
      ...(scriptText === undefined ? {} : { scriptText }),
    });
    // Long enough for a second change asked for meanwhile to start, unless
    // something holds it back.
    await new Promise((settle) => setTimeout(settle, 5));
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
      await writeFile(
        join(folder, "pyvenv.cfg"),
        `home = ${join(given.environment?.["UV_PYTHON_INSTALL_DIR"] ?? "C:\\Users\\someone\\AppData\\Roaming\\uv\\python", `cpython-${version}-windows-x86_64-none`)}\nimplementation = CPython\nversion_info = ${version}\n`,
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
      await recordInstalled(
        dirname(dirname(given.executable)),
        args.slice(args.indexOf("install") + 1),
      );
    else {
      const output = options.output ?? { exitCode: 0 };
      return {
        exitCode: output.exitCode,
        stdout: output.stdout ?? "",
        stderr: output.stderr ?? "",
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
