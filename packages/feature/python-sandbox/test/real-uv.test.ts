/**
 * The sandbox against a real `uv`.
 *
 * The other tests replace the invocation, which proves the arguments and the
 * isolation but not that `uv` accepts them, nor what a confined script can
 * reach. These build a real environment and run real scripts. They are
 * skipped unless `uv` is named in the environment, because the gate installs
 * nothing:
 *
 *   $env:ZHIYIN_UV = "…\uv.exe"; npx vitest run packages/feature/python-sandbox
 *
 * They download a Python and one package, so they are slow the first time,
 * and one of them needs the internet. The default environment installs from a
 * lock of that package alone, written by the script that writes the default
 * packages' lock.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  forgetConfinement,
  openProcessContainer,
  runProcess,
} from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  pythonEnvironments,
  pythonSandbox,
  type PackageLock,
  type PythonSandboxOptions,
  type RunProgram,
} from "../src/index.js";
import { pythonVersions } from "../src/environments.js";
import { parts } from "./kept-fixture.js";

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

  it("reaches only the hosts the call names, through Zhiyin's proxy, and is told what it reached", async () => {
    const code = [
      "import socket, urllib.request",
      "def fetch(url):",
      "    try:",
      "        with urllib.request.urlopen(url, timeout=30) as answer:",
      "            print(url, 'answered', answer.status)",
      "    except OSError as error:",
      "        print(url, 'refused', error)",
      "fetch('https://pypi.org/simple/six/')",
      "fetch('https://example.com/')",
      "try:",
      "    socket.create_connection(('1.1.1.1', 443), timeout=10).close()",
      "    print('direct connected')",
      "except OSError as error:",
      "    print('direct refused', type(error).__name__)",
    ].join("\n");

    const offline = await run({ code });
    const online = await run({ code, hosts: ["pypi.org"] });

    expect(offline.said).toContain("https://pypi.org/simple/six/ refused");
    expect(offline.said).toContain("direct refused");
    expect(online.said).toContain("https://pypi.org/simple/six/ answered 200");
    expect(online.said).toContain("https://example.com/ refused");
    expect(online.said).toContain("direct refused");
    expect(online.said).toMatch(
      /\n\nNetwork:\npypi\.org: sent .*, received .*\.\nexample\.com: refused: not among the hosts this run may reach\.$/,
    );
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

  it.each(pythonVersions)(
    "makes Python %s's own library work confined: private folders, a pool, real paths, an archive unpacked, and the null device",
    async (python) => {
      const environment = `python-${python.replace(".", "-")}`;
      const created = await call("create_python_environment", {
        name: environment,
        python,
      });
      expect(created.isError, created.said).toBeUndefined();

      const result = await run({
        environment,
        code: [
          "import io, multiprocessing, os, subprocess, sys, tarfile, tempfile",
          "def square(n):",
          "    return n * n",
          "if __name__ == '__main__':",
          "    print('version', '%d.%d' % sys.version_info[:2])",
          "    with multiprocessing.Pool(2) as pool:",
          "        print('pool', pool.map(square, range(4)))",
          "    with tempfile.TemporaryDirectory() as folder:",
          "        archive = os.path.join(folder, 'packed.tar')",
          "        with tarfile.open(archive, 'w') as packing:",
          "            member = tarfile.TarInfo('inside/note.txt')",
          "            member.size = 4",
          "            packing.addfile(member, io.BytesIO(b'kept'))",
          "        with tarfile.open(archive) as unpacking:",
          "            unpacking.extractall(os.path.join(folder, 'out'), filter='data')",
          "        print('unpacked', open(os.path.join(folder, 'out', 'inside', 'note.txt')).read())",
          "    print('real path', os.path.basename(os.path.realpath('.')))",
          "    done = subprocess.run([sys.executable, '-c', 'print(1)'], stdout=subprocess.DEVNULL, stdin=subprocess.DEVNULL)",
          "    with open(os.devnull, 'w') as sink:",
          "        sink.write('dropped')",
          "    print('discarded exit', done.returncode)",
        ].join("\n"),
      });

      expect(result.isError, result.said).toBeUndefined();
      expect(result.said).toContain(`version ${python}`);
      expect(result.said).toContain("pool [0, 1, 4, 9]");
      expect(result.said).toContain("unpacked kept");
      expect(result.said).toContain(`real path ${basename(workspace)}`);
      expect(result.said).toContain("discarded exit 0");
      expect(result.said).not.toContain("Traceback");
    },
    900_000,
  );

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
    expect(installed.said).toMatch(
      /^Installed into “older”: docopt 0\.6\.2\.\n/,
    );
    const again = await call("install_python_package", {
      packages: ["docopt==0.6.2", "six"],
      environment: "older",
    });
    expect(again.said).toMatch(
      /^Nothing was installed: docopt 0\.6\.2, six [\d.]+ were already in “older”\.\n/,
    );

    const result = await run({
      code: "import docopt; print(docopt.__version__)",
      environment: "older",
    });

    expect(result.said).toBe("0.6.2");
  }, 600_000);

  it("says what came with the packages asked for, and each version an install changed", async () => {
    // jaraco.functools needs more-itertools; "older" holds the latest six.
    const installed = await call("install_python_package", {
      packages: ["jaraco.functools==4.1.0", "six==1.16.0"],
      environment: "older",
    });

    expect(installed.isError, installed.said).toBeUndefined();
    expect(installed.said.split("\n").slice(0, 3)).toEqual([
      expect.stringMatching(
        /^Installed into “older”: jaraco[._]functools 4\.1\.0\.$/,
      ),
      expect.stringMatching(/^With them: more[-_]itertools \d[\d.]*\.$/),
      expect.stringMatching(
        /^Changed in “older”: six (?!1\.16\.0)\d[\d.]* → 1\.16\.0\.$/,
      ),
    ]);
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

  it("leaves no container in the person's profile for a kept run whose home lasts one run", async () => {
    // A kept environment made from the small lock, so nothing large is fetched.
    const { kept } = pythonEnvironments({
      ...options,
      directory: join(
        await folders.make("zhiyin-sandbox-live-kept-"),
        "python-sandbox",
      ),
      keptEnvironments: [{ ...parts, lock }],
    });
    const containers = async () =>
      (
        await readdir(
          join(
            process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
            "Packages",
          ),
        )
      ).filter((name) => name.toLowerCase().startsWith("zhiyin.python-parts."));
    const homes: string[] = [];
    const runIn = async (homeLastsOneRun: boolean) => {
      const run = await folders.make("zhiyin-sandbox-live-run-");
      homes.push(join(run, "home"));
      const script = join(run, "script.py");
      await writeFile(script, "print('ran')");
      return kept.run({
        environment: "parts",
        arguments: [script],
        cwd: run,
        read: [run],
        write: [],
        home: join(run, "home"),
        homeLastsOneRun,
        timeoutMs: 120_000,
      });
    };
    // Installed, as its connector installs it, and run once first, so the
    // counts below see the runs alone.
    await kept.installation("parts").install();
    expect(await kept.installation("parts").state()).toEqual({
      status: "ready",
    });
    expect(await runIn(true)).toMatchObject({ ok: true });
    const before = await containers();

    const once = await runIn(true);
    const afterOnce = await containers();
    const longer = await runIn(false);
    const afterLonger = await containers();
    forgetConfinement("python-parts", homes.at(-1)!);

    expect(once).toMatchObject({ ok: true, run: { exitCode: 0 } });
    expect(longer).toMatchObject({ ok: true, run: { exitCode: 0 } });
    expect(afterOnce).toEqual(before);
    // A home kept longer keeps its container, until its feature forgets it.
    expect(afterLonger).toHaveLength(before.length + 1);
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

  it("refuses the default packages when a file is not the one its hash names, and keeps the default environment it had", async () => {
    // The environment as the lock Zhiyin ships makes it, there before the reset.
    await pythonSandbox(options).callTool("run_python", { code: "print(1)" });
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
    const call = async (tool: string, args: Record<string, unknown> = {}) => {
      const result = (await tampered.callTool(tool, args)) as Result;
      return { ...result, said: result.content.map((c) => c.text).join("\n") };
    };

    const reset = await call("reset_python_environment");
    const ran = await call("run_python", {
      code: "import numpy; print('kept')",
    });

    expect(reset.isError, reset.said).toBe(true);
    expect(reset.said).toContain("Hash mismatch for `numpy==");
    expect(ran.isError, ran.said).toBeFalsy();
    expect(ran.said).toContain("kept");
  }, 900_000);
});
