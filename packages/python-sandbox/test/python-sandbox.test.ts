import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPackages,
  pythonSandbox,
  type RunProgram,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `zhiyin-sandbox-${label}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Call = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
};

/** What each program was given to run with, alongside the calls. */
const environments: (
  Readonly<Record<string, string | undefined>> | undefined
)[] = [];

/**
 * A `uv` that behaves: creating the environment puts an interpreter where the
 * connector expects one, so the next call finds a prepared sandbox.
 */
async function sandboxWith(
  options: {
    readonly uv?: string | undefined;
    readonly failing?: string;
    readonly output?: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
    };
  } = {},
) {
  const workspace = await temporaryRoot("workspace");
  const directory = join(await temporaryRoot("data"), "python-sandbox");
  const calls: Call[] = [];
  environments.length = 0;
  const run: RunProgram = async ({
    executable,
    arguments: args,
    cwd,
    environment,
  }) => {
    calls.push({ executable, arguments: args, cwd });
    environments.push(environment);
    if (args[0] === "venv") {
      await mkdir(join(directory, ".venv", "Scripts"), { recursive: true });
      await writeFile(
        join(directory, ".venv", "Scripts", "python.exe"),
        "not really an interpreter",
      );
    }
    if (options.failing && args.includes(options.failing))
      return { exitCode: 1, stdout: "", stderr: "it went wrong" };
    const output = options.output ?? { exitCode: 0 };
    return {
      exitCode: output.exitCode,
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
    };
  };
  return {
    workspace,
    directory,
    calls,
    interpreter: join(directory, ".venv", "Scripts", "python.exe"),
    sandbox: pythonSandbox({
      workspaceRoot: () => workspace,
      directory,
      uv: async () => ("uv" in options ? options.uv : "C:/programs/uv.exe"),
      run,
    }),
  };
}

describe("running Python in the sandbox", () => {
  it("prepares the environment once, then runs the script in the workspace folder", async () => {
    const { sandbox, calls, workspace, directory, interpreter } =
      await sandboxWith({ output: { exitCode: 0, stdout: "42\n" } });

    const first = await sandbox.callTool("run_python", {
      code: "print(6 * 7)",
    });
    await sandbox.callTool("run_python", { code: "print('again')" });

    expect(first).toMatchObject({ content: [{ text: "42" }] });
    expect(calls.slice(0, 2)).toEqual([
      {
        executable: "C:/programs/uv.exe",
        arguments: ["venv", "--python", "3.13", join(directory, ".venv")],
        cwd: directory,
      },
      {
        executable: "C:/programs/uv.exe",
        arguments: [
          "pip",
          "install",
          "--python",
          interpreter,
          ...defaultPackages,
        ],
        cwd: directory,
      },
    ]);
    // Scripts run with the person's folder as the working directory, through
    // the sandbox's own interpreter.
    expect(calls[2]?.executable).toBe(interpreter);
    expect(calls[2]?.cwd).toBe(workspace);
    // The environment is built once, not on every call.
    expect(calls.filter((call) => call.arguments[0] === "venv")).toHaveLength(
      1,
    );
  });

  it("runs scripts with Python reading and writing UTF-8, in Zhiyin's own environment", async () => {
    const { sandbox, calls, interpreter } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print('é')" });

    const script = calls.findIndex((call) => call.executable === interpreter);
    expect(environments[script]).toMatchObject({
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PATH: process.env["PATH"],
    });
  });

  it("keeps the script it was given out of the person's folder, and removes it after", async () => {
    const { sandbox, calls, workspace, directory } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print('hello')" });

    const script = calls.at(-1)?.arguments[0] ?? "";
    expect(script.startsWith(join(directory, "scripts"))).toBe(true);
    expect(await readdir(join(directory, "scripts"))).toEqual([]);
    expect(await readdir(workspace)).toEqual([]);
  });

  it("runs a script from the workspace, with its arguments", async () => {
    const { sandbox, calls, workspace, interpreter } = await sandboxWith();
    await writeFile(join(workspace, "clean.py"), "print('ok')");

    await sandbox.callTool("run_python", {
      path: "clean.py",
      arguments: ["--strict", "2"],
    });

    expect(calls.at(-1)).toEqual({
      executable: interpreter,
      arguments: [join(workspace, "clean.py"), "--strict", "2"],
      cwd: workspace,
    });
  });

  it("reports a script that failed with its output rather than a bare code", async () => {
    const { sandbox } = await sandboxWith({
      output: { exitCode: 1, stderr: "Traceback: boom" },
    });

    expect(
      await sandbox.callTool("run_python", { code: "raise SystemExit(1)" }),
    ).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("Traceback: boom") }],
    });
  });

  it("keeps the end of a long failing run, where the traceback is", async () => {
    const { sandbox } = await sandboxWith({
      output: {
        exitCode: 1,
        stdout: "progress\n".repeat(5_000),
        stderr: "Traceback: boom at the end",
      },
    });

    expect(
      await sandbox.callTool("run_python", { code: "raise SystemExit(1)" }),
    ).toMatchObject({
      content: [{ text: expect.stringContaining("boom at the end") }],
    });
  });

  it("refuses anything but a .py file, and a call that names no script at all", async () => {
    const { sandbox } = await sandboxWith();

    expect(
      await sandbox.callTool("run_python", { path: "notes.md" }),
    ).toMatchObject({
      isError: true,
      content: [{ text: "Only .py files can be run." }],
    });
    expect(await sandbox.callTool("run_python", {})).toMatchObject({
      isError: true,
      content: [{ text: "Give code to run or a script path." }],
    });
  });
});

describe("the sandbox's own packages", () => {
  it("installs into the sandbox, from the sandbox folder, never the workspace", async () => {
    const { sandbox, calls, directory, interpreter } = await sandboxWith();

    const result = await sandbox.callTool("install_python_package", {
      packages: ["httpx", "pyarrow>=15"],
    });

    expect(result).not.toHaveProperty("isError");
    expect(calls.at(-1)).toEqual({
      executable: "C:/programs/uv.exe",
      arguments: [
        "pip",
        "install",
        "--python",
        interpreter,
        "httpx",
        "pyarrow>=15",
      ],
      cwd: directory,
    });
  });

  it("refuses a package name that is not one", async () => {
    const { sandbox, calls } = await sandboxWith();

    for (const packages of [["--index-url http://evil"], ["a b"], []])
      expect(
        await sandbox.callTool("install_python_package", { packages }),
      ).toMatchObject({ isError: true });
    expect(calls.some((call) => call.arguments.includes("--index-url"))).toBe(
      false,
    );
  });

  it("rebuilds the sandbox from nothing when it is reset", async () => {
    const { sandbox, calls, directory } = await sandboxWith();
    await sandbox.callTool("run_python", { code: "print(1)" });
    await writeFile(join(directory, "left-over.txt"), "stale");

    const result = await sandbox.callTool("reset_python_sandbox", {});

    expect(result).toMatchObject({
      content: [{ text: "The sandbox was rebuilt with its default packages." }],
    });
    expect(await readdir(directory)).toEqual([".venv"]);
    expect(calls.filter((call) => call.arguments[0] === "venv")).toHaveLength(
      2,
    );
  });

  it("says what went wrong when the environment cannot be built", async () => {
    const { sandbox } = await sandboxWith({ failing: "venv" });

    expect(
      await sandbox.callTool("run_python", { code: "print(1)" }),
    ).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("could not be created") }],
    });
  });
});

describe("what the sandbox offers", () => {
  it("offers no tool until uv is installed, and all of them once it is", async () => {
    const without = await sandboxWith({ uv: undefined });
    await expect(without.sandbox.listTools()).rejects.toThrow(/not installed/);
    expect(
      await without.sandbox.callTool("run_python", { code: "print(1)" }),
    ).toMatchObject({ isError: true });

    const { sandbox } = await sandboxWith();
    expect((await sandbox.listTools()).map((tool) => tool.name)).toEqual([
      "run_python",
      "install_python_package",
      "reset_python_sandbox",
    ]);
  });

  it("tells a person what a call will do and where anything is downloaded from", async () => {
    const { sandbox, workspace } = await sandboxWith();

    expect(
      await sandbox.inspect("run_python", { code: "print(1)" }),
    ).toMatchObject({
      ok: true,
      action: "Run a Python script",
      effect: `Runs in ${workspace}, and may read and write files there.`,
      destination: expect.stringContaining("downloads Python"),
    });
    expect(
      await sandbox.inspect("install_python_package", { packages: ["httpx"] }),
    ).toMatchObject({
      ok: true,
      target: "httpx",
      effect: "Changes only Zhiyin's sandbox, not a project's environment.",
      destination: "Packages are downloaded from pypi.org.",
    });
    expect(
      await sandbox.inspect("install_python_package", {
        packages: ["--index-url http://evil"],
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses to run with no folder chosen", async () => {
    const directory = join(await temporaryRoot("data"), "python-sandbox");
    const sandbox = pythonSandbox({
      workspaceRoot: () => undefined,
      directory,
      uv: async () => "C:/programs/uv.exe",
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });

    expect(await sandbox.inspect("run_python", { code: "print(1)" })).toEqual({
      ok: false,
      reason: "Choose a folder before running Python.",
    });
    expect(
      await sandbox.callTool("run_python", { code: "print(1)" }),
    ).toMatchObject({ isError: true });
  });
});
