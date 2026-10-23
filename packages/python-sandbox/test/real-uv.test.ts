/**
 * The sandbox against a real `uv`.
 *
 * The other tests replace the invocation, which proves the arguments and the
 * isolation but not that `uv` accepts them, nor what a confined script can
 * reach. These build a real environment and run real scripts. They are
 * skipped unless `uv` is named in the environment, because the gate installs
 * nothing:
 *
 *   $env:ZHIYIN_UV = "…\uv.exe"; npx vitest run packages/python-sandbox
 *
 * They download a Python and one package, so they are slow the first time,
 * and one of them needs the internet. The default environment installs from a
 * lock of that package alone, written by the script that writes the default
 * packages' lock.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer, runProcess } from "@zhiyin/process-ownership";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  pythonSandbox,
  type PackageLock,
  type PythonSandboxOptions,
  type RunProgram,
} from "../src/index.js";

const uv = process.env["ZHIYIN_UV"];

const folders = new TemporaryFolders();

type Result = { isError?: boolean; content: { text: string }[] };

/** What the person keeps in uv's folder for programs, which Zhiyin leaves alone. */
async function personsPrograms(): Promise<string[]> {
  return readdir(join(homedir(), ".local", "bin")).catch(() => []);
}

/** The app containers Windows keeps for confined installs, by profile folder. */
async function installContainers(): Promise<string[]> {
  const packages = join(
    process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
    "Packages",
  );
  return (await readdir(packages)).filter((name) =>
    name.toLowerCase().startsWith("zhiyin.python-install."),
  );
}

/** A lock of numpy alone, as the script that locks the default packages writes it. */
async function numpyLock(folder: string): Promise<PackageLock> {
  const out = join(folder, "lock.json");
  const script = fileURLToPath(
    new URL("../scripts/lock-default-packages.mjs", import.meta.url),
  );
  const made = spawnSync(
    process.execPath,
    [script, "--uv", uv!, "--packages", "numpy", "--out", out],
    { encoding: "utf8" },
  );
  if (made.status !== 0) throw new Error(made.stderr);
  return JSON.parse(await readFile(out, "utf8")) as PackageLock;
}

/** A package no index has, whose own install code tries to reach past its environment. */
const hostile = "zhiyin-hostile-probe";

async function writeHostile(folder: string, outside: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "setup.py"),
    [
      "import os, sys",
      `outside = r'${outside}'`,
      "for name, act in [",
      "    ('read', lambda: open(os.path.join(outside, 'secret.txt')).read()),",
      "    ('write', lambda: open(os.path.join(outside, 'planted.txt'), 'w').write('x')),",
      `    ('list', lambda: os.listdir(r'${homedir()}')),`,
      "]:",
      "    try:",
      "        print(f'PROBE {name} did {act()!r}', file=sys.stderr)",
      "    except OSError as error:",
      "        print(f'PROBE {name} {type(error).__name__}', file=sys.stderr)",
      "raise SystemExit('PROBE done')",
    ].join("\n"),
  );
}

describe.runIf(uv)("the real uv", () => {
  let workspace: string;
  let outside: string;
  let programsBefore: string[];
  let sandbox: ReturnType<typeof pythonSandbox>;
  let options: PythonSandboxOptions;
  let lock: PackageLock;
  let directory: string;
  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = (await sandbox.callTool(tool, args)) as Result;
    return { ...result, said: result.content.map((c) => c.text).join("\n") };
  };
  const run = (args: Record<string, unknown>) => call("run_python", args);

  beforeAll(async () => {
    programsBefore = await personsPrograms();
    workspace = await folders.make("zhiyin-sandbox-live-workspace-");
    outside = await folders.make("zhiyin-sandbox-live-outside-");
    await writeFile(join(outside, "secret.txt"), "the person's own secret");
    const probe = join(
      await folders.make("zhiyin-sandbox-live-probe-"),
      "probe",
    );
    await writeHostile(probe, outside);
    // The hostile package is asked for by name, as the model would, and
    // found in a folder pip is let read, as if an index had it.
    const findingTheProbe: RunProgram = (given) =>
      runProcess(
        given.arguments.includes(hostile) && given.confinement
          ? {
              ...given,
              arguments: given.arguments.map((part) =>
                part === hostile ? probe : part,
              ),
              confinement: {
                ...given.confinement,
                read: [...given.confinement.read, probe],
              },
            }
          : given,
      );
    // A project in the workspace that would capture an ordinary uv command.
    await writeFile(
      join(workspace, "pyproject.toml"),
      '[project]\nname = "someone-elses"\nversion = "0.0.1"\nrequires-python = ">=3.13"\ndependencies = ["this-package-does-not-exist-anywhere"]\n',
    );
    directory = join(
      await folders.make("zhiyin-sandbox-live-data-"),
      "python-sandbox",
    );
    lock = await numpyLock(await folders.make("zhiyin-sandbox-live-lock-"));
    options = {
      workspaceRoot: () => workspace,
      directory,
      uv: async () => uv,
      lock,
      // As the app runs them: contained, so scripts can be confined.
      containment: { open: openProcessContainer },
      run: findingTheProbe,
    };
    sandbox = pythonSandbox(options);
  }, 60_000);

  afterAll(() => folders.removeAll());

  it("builds an environment apart from a project in the workspace, and runs a script in it", async () => {
    const result = await run({
      code: "import numpy, pathlib; print(numpy.arange(3).sum()); pathlib.Path('out.txt').write_text('done')",
    });

    expect(result.isError, result.said).toBeUndefined();
    expect(result.said).toContain("3");
    // The script's working directory is the workspace, so its file landed there.
    expect(await readFile(join(workspace, "out.txt"), "utf8")).toBe("done");
  }, 900_000);

  it("keeps the default packages compiled, so no script compiles them again", async () => {
    const packages = join(
      directory,
      "environments",
      "default",
      "Lib",
      "site-packages",
    );
    const compiled = (
      await readdir(join(packages, "numpy"), { recursive: true })
    ).filter((name) => name.endsWith(".pyc"));

    expect(compiled.length).toBeGreaterThan(0);
  });

  it("puts no Python among the person's own programs", async () => {
    expect(await personsPrograms()).toEqual(programsBefore);
  });

  it("refuses a script every file outside the workspace, and the person's own folder", async () => {
    const result = await run({
      code: [
        "import os",
        `outside = r'${outside}'`,
        "for name, act in [",
        "    ('read', lambda: open(os.path.join(outside, 'secret.txt')).read()),",
        "    ('write', lambda: open(os.path.join(outside, 'planted.txt'), 'w').write('x')),",
        `    ('list', lambda: os.listdir(r'${homedir()}')),`,
        "]:",
        "    try:",
        "        print(name, 'did', act())",
        "    except OSError as error:",
        "        print(name, type(error).__name__)",
      ].join("\n"),
    });

    expect(result.said).toContain("read PermissionError");
    expect(result.said).toContain("write PermissionError");
    expect(result.said).toContain("list PermissionError");
    expect(result.said).not.toContain("the person's own secret");
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  }, 120_000);

  it("holds a shell the script starts to the same limits", async () => {
    const result = await run({
      code: [
        "import os, subprocess",
        `outside = r'${outside}'`,
        "secret = os.path.join(outside, 'secret.txt')",
        "shells = {",
        "    'cmd': ['cmd', '/c', 'type', secret],",
        "    'powershell': ['powershell', '-NoProfile', '-Command', f\"Get-Content -LiteralPath '{secret}'\"],",
        "    'cmd-write': ['cmd', '/c', f'echo planted> \"{os.path.join(outside, \"by-cmd.txt\")}\"'],",
        "}",
        "for name, command in shells.items():",
        // Windows' own programs answer in the console's code page.
        "    done = subprocess.run(command, capture_output=True, text=True, errors='replace')",
        "    print(name, 'exit', done.returncode, done.stdout.strip())",
      ].join("\n"),
    });

    expect(result.said).toMatch(/cmd exit [1-9]/);
    expect(result.said).toMatch(/powershell exit [1-9]/);
    expect(result.said).toMatch(/cmd-write exit [1-9]/);
    expect(result.said).not.toContain("the person's own secret");
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  }, 120_000);

  it("discards a program's output, and gives it no input, as a script does anywhere", async () => {
    const result = await run({
      code: [
        "import os, subprocess, sys",
        "loud = [sys.executable, '-c', 'import sys; print(\"lost\" * 100000); print(\"lost\", file=sys.stderr)']",
        "done = subprocess.run(loud, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
        "print('discarded exit', done.returncode)",
        "reader = [sys.executable, '-c', 'import sys; print(\"read\", len(sys.stdin.read()))']",
        "fed = subprocess.run(reader, stdin=subprocess.DEVNULL, capture_output=True, text=True)",
        "print('fed exit', fed.returncode, fed.stdout.strip())",
        "with open(os.devnull, 'w') as sink:",
        "    sink.write('lost too')",
        "with open(os.devnull) as empty:",
        "    print('devnull holds', repr(empty.read()))",
        "os.write(os.open(os.devnull, os.O_WRONLY), b'lost again')",
        "print('written to devnull')",
      ].join("\n"),
    });

    expect(result.isError, result.said).toBeUndefined();
    expect(result.said).toContain("discarded exit 0");
    expect(result.said).toContain("fed exit 0 read 0");
    expect(result.said).toContain("devnull holds ''");
    expect(result.said).toContain("written to devnull");
    expect(result.said).not.toContain("lost");
  }, 120_000);

  it("reaches the internet only when the call asks for it", async () => {
    const code = [
      "import socket",
      "try:",
      "    socket.create_connection(('1.1.1.1', 443), timeout=10).close()",
      "    print('connected')",
      "except OSError as error:",
      "    print('refused', type(error).__name__)",
    ].join("\n");

    const offline = await run({ code });
    const online = await run({ code, network: true });

    expect(offline.said).toContain("refused");
    expect(online.said).toContain("connected");
  }, 120_000);

  it("runs a multiprocessing pool, and uses the temporary folders Python makes", async () => {
    const result = await run({
      code: [
        "import multiprocessing, os, tempfile",
        "def square(n):",
        "    return n * n",
        "if __name__ == '__main__':",
        "    with multiprocessing.Pool(2) as pool:",
        "        print('pool', pool.map(square, range(5)))",
        "    with tempfile.TemporaryDirectory() as folder:",
        "        open(os.path.join(folder, 'scratch.txt'), 'w').write('kept a moment')",
        "        print('temporary', open(os.path.join(folder, 'scratch.txt')).read())",
      ].join("\n"),
    });

    expect(result.isError, result.said).toBeUndefined();
    expect(result.said).toContain("pool [0, 1, 4, 9, 16]");
    expect(result.said).toContain("temporary kept a moment");
  }, 120_000);

  it("runs a workspace script as itself: it imports its neighbours, knows its own name, and starts a pool", async () => {
    await mkdir(join(workspace, "tools"), { recursive: true });
    await writeFile(
      join(workspace, "tools", "helper.py"),
      "def greet():\n    return 'hello from helper'\n",
    );
    await writeFile(
      join(workspace, "tools", "main.py"),
      [
        "import multiprocessing, os, sys",
        "import helper",
        "def square(n):",
        "    return n * n",
        "if __name__ == '__main__':",
        "    print(helper.greet())",
        "    print('file', os.path.basename(__file__), 'argv', os.path.basename(sys.argv[0]), sys.argv[1:])",
        "    with multiprocessing.Pool(2) as pool:",
        "        print('pool', pool.map(square, range(4)))",
      ].join("\n"),
    );
    const args = { path: "tools/main.py", arguments: ["--fast"] };

    const approved = await sandbox.inspect("run_python", args);
    const result = (await sandbox.callTool(
      "run_python",
      args,
      undefined,
      approved.ok ? approved.identity : undefined,
    )) as Result;

    const said = result.content.map((part) => part.text).join("\n");
    expect(result.isError, said).toBeUndefined();
    expect(said).toContain("hello from helper");
    expect(said).toContain("file main.py argv main.py ['--fast']");
    expect(said).toContain("pool [0, 1, 4, 9]");
  }, 120_000);

  it("leaves Python's warning about the container out of what a script says", async () => {
    const result = await run({
      code: "import sys; print('to the error stream', file=sys.stderr)",
    });

    expect(result.said).toContain("to the error stream");
    expect(result.said).not.toContain("Failed to find real location");
  }, 120_000);

  it("creates an environment with another Python, installs its packages with its own confined pip, and runs scripts in it", async () => {
    const created = await call("create_python_environment", {
      name: "older",
      python: "3.12",
      packages: ["six"],
    });
    expect(created.isError, created.said).toBeUndefined();

    const result = await run({
      code: "import sys, six; print(sys.version_info[:2], six.__version__)",
      environment: "older",
    });

    expect(result.isError, result.said).toBeUndefined();
    expect(result.said).toMatch(/^\(3, 12\) \d/);
  }, 900_000);

  it("builds and installs a package published only as source, confined", async () => {
    // docopt 0.6.2 is on pypi.org as a source archive alone.
    const installed = await call("install_python_package", {
      packages: ["docopt==0.6.2"],
      environment: "older",
    });
    expect(installed.isError, installed.said).toBeUndefined();

    const result = await run({
      code: "import docopt; print(docopt.__version__)",
      environment: "older",
    });

    expect(result.said).toBe("0.6.2");
  }, 600_000);

  it("holds a package's own install code to its environment", async () => {
    const installed = await call("install_python_package", {
      packages: [hostile],
      environment: "older",
    });

    expect(installed.isError).toBe(true);
    expect(installed.said).toContain("PROBE read PermissionError");
    expect(installed.said).toContain("PROBE write PermissionError");
    expect(installed.said).toContain("PROBE list PermissionError");
    expect(installed.said).not.toContain("the person's own secret");
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  }, 600_000);

  it("lists the environments with what each holds, and removes one with the container its installs ran in", async () => {
    const before = await call("list_python_environments", {});
    const containers = await installContainers();
    const removed = await call("remove_python_environment", { name: "older" });
    const after = await call("list_python_environments", {});

    const left = await installContainers();
    expect(left).toHaveLength(containers.length - 1);
    expect(containers).toEqual(expect.arrayContaining(left));

    expect(before.said).toMatch(/^older — Python 3\.12\.\d+: .*six \d/m);
    expect(before.said).toMatch(/^default — Python 3\.13\.\d+: .*numpy \d/m);
    expect(removed.isError, removed.said).toBeUndefined();
    expect(after.said).not.toContain("older");
  }, 120_000);

  it("runs scripts in an environment made again under the same name, in the same session", async () => {
    const made = await call("create_python_environment", {
      name: "older",
      python: "3.12",
      packages: ["six"],
    });
    const ran = await run({
      environment: "older",
      code: "import six; print('again', six.__version__)",
    });

    expect(made.isError, made.said).toBeUndefined();
    expect(ran.isError, ran.said).toBeUndefined();
    expect(ran.said).toMatch(/again \d/);
  }, 900_000);

  it("runs scripts in the default environment once it is reset, in the same session", async () => {
    const reset = await call("reset_python_environment", {});
    const ran = await run({
      code: "import numpy; print('reset', numpy.arange(4).sum())",
    });

    expect(reset.isError, reset.said).toBeUndefined();
    expect(ran.isError, ran.said).toBeUndefined();
    expect(ran.said).toContain("reset 6");
  }, 900_000);

  it("refuses the default packages when a file is not the one its hash names, and leaves no default environment", async () => {
    const tampered = pythonSandbox({
      ...options,
      lock: {
        ...lock,
        locked: lock.locked.map((entry) => ({
          ...entry,
          hashes: [`sha256:${"0".repeat(64)}`],
        })),
      },
    });
    const call = async (tool: string) => {
      const result = (await tampered.callTool(tool, {})) as Result;
      return { ...result, said: result.content.map((c) => c.text).join("\n") };
    };

    const reset = await call("reset_python_environment");
    const listed = await call("list_python_environments");

    expect(reset.isError, reset.said).toBe(true);
    expect(reset.said).toContain("Hash mismatch for `numpy==");
    expect(listed.said).toMatch(/^default — not made yet/m);
  }, 900_000);
});
