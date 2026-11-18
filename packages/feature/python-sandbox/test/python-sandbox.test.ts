import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPackages,
  defaultPackagesPublishedBy,
  pythonSandbox,
  pythonSandboxes,
} from "../src/index.js";
import {
  folders,
  sandboxWith,
  scriptRuns,
  uvProgram,
} from "./fake-programs.js";

afterEach(() => folders.removeAll());

describe("the default environment", () => {
  it("serves each folder from one sandbox, running each folder's scripts there and making the environment once", async () => {
    const { run, directory, workspace, calls, interpreter } =
      await sandboxWith();
    const other = await folders.make("zhiyin-sandbox-workspace-");
    const inFolder = pythonSandboxes({
      directory,
      uv: async () => uvProgram,
      run,
    });

    await Promise.all([
      inFolder(() => workspace).callTool("run_python", { code: "print(1)" }),
      inFolder(() => other).callTool("run_python", { code: "print(2)" }),
    ]);

    expect(
      scriptRuns(calls, interpreter())
        .map((call) => call.cwd)
        .sort(),
    ).toEqual([workspace, other].sort());
    expect(
      calls.filter(
        (call) => call.executable === uvProgram && call.arguments[0] === "venv",
      ),
    ).toHaveLength(1);
  });

  it("can read and write Excel workbooks, the format most data arrives in", async () => {
    const { sandbox, installed } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print(1)" });

    // pandas reads and writes .xlsx through openpyxl, which it does not
    // install itself.
    expect(await installed("default")).toEqual(
      expect.arrayContaining(["pandas", "openpyxl"]),
    );
  });

  it("installs only the versions Zhiyin pins, each checked against the hashes it keeps", async () => {
    const { sandbox, calls } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print(1)" });

    const install = calls.find(
      (call) => call.executable === uvProgram && call.arguments[0] === "pip",
    );
    expect(install?.arguments).toEqual(
      expect.arrayContaining(["--require-hashes", "--no-build", "-r"]),
    );
    const lock = install!.arguments[install!.arguments.indexOf("-r") + 1]!;
    const requirements = (await readFile(resolve(install!.cwd, lock), "utf8"))
      .split("\n")
      .filter((line) => line.trim());
    // One exact version per package, and the SHA-256 of each of its files.
    for (const line of requirements)
      expect(line).toMatch(
        /^[a-z0-9][a-z0-9._-]*==[^\s=]+( --hash=sha256:[0-9a-f]{64})+$/,
      );
    expect(requirements.map((line) => line.split("==")[0])).toEqual(
      expect.arrayContaining([...defaultPackages]),
    );
  });

  it("says, when it is to be rebuilt, that its packages are the pinned versions checked against their hashes", async () => {
    const { sandbox } = await sandboxWith();

    const asked = await sandbox.inspect("reset_python_environment", {});

    expect(asked).toMatchObject({
      ok: true,
      command: `uv venv --seed --exclude-newer ${defaultPackagesPublishedBy} --python 3.13 default\nuv pip install --no-build --require-hashes -r default-packages.txt`,
      detail: expect.stringContaining(
        "each checked against the SHA-256 Zhiyin keeps",
      ),
    });
  });

  it("is made once, on first use, then scripts run in the workspace folder", async () => {
    const { sandbox, calls, workspace, environment, interpreter } =
      await sandboxWith({ output: { exitCode: 0, stdout: "42\n" } });

    const first = await sandbox.callTool("run_python", {
      code: "print(6 * 7)",
    });
    await sandbox.callTool("run_python", { code: "print('again')" });

    expect(first).toMatchObject({ content: [{ text: "42" }] });
    expect(
      calls
        .slice(0, 3)
        .map((call) => [call.executable, call.arguments, call.cwd]),
    ).toEqual([
      [
        uvProgram,
        // Python as uv manages it, never one already on the PC, with pip as
        // published by the date the release fixes, and no uv settings found
        // around the folder.
        [
          "venv",
          "--no-config",
          "--seed",
          "--exclude-newer",
          defaultPackagesPublishedBy,
          "--python",
          "3.13",
          "--managed-python",
          environment("default"),
        ],
        dirname(dirname(environment("default"))),
      ],
      [
        uvProgram,
        // Its own packages come as wheels only, so none of their code runs
        // to install them, and as the versions Zhiyin pins, each file
        // checked against its hash.
        [
          "pip",
          "install",
          "--no-config",
          "--no-build",
          "--require-hashes",
          "--python",
          interpreter(),
          "-r",
          "default-packages.txt",
        ],
        dirname(dirname(environment("default"))),
      ],
      [
        interpreter(),
        // Compiled once, so no script compiles them again; without site, so
        // none of the packages' own code runs outside a container.
        [
          "-I",
          "-S",
          "-m",
          "compileall",
          "-q",
          join(environment("default"), "Lib", "site-packages"),
        ],
        environment("default"),
      ],
    ]);
    const scripts = scriptRuns(calls, interpreter());
    expect(scripts.map((call) => call.cwd)).toEqual([workspace, workspace]);
    expect(calls.filter((call) => call.arguments[0] === "venv")).toHaveLength(
      1,
    );
  });
});

describe("running Python in the sandbox", () => {
  it("runs scripts with Python reading and writing UTF-8", async () => {
    const { sandbox, calls, interpreter } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print('é')" });

    expect(scriptRuns(calls, interpreter())[0]?.environment).toMatchObject({
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PATH: process.env["PATH"],
    });
  });

  it("draws a script's plots off screen, where no window can open", async () => {
    const { sandbox, calls, interpreter } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print(1)" });

    expect(scriptRuns(calls, interpreter())[0]?.environment).toMatchObject({
      MPLBACKEND: "Agg",
    });
  });

  it("tells the model the limits of a run before it makes one", async () => {
    const { sandbox } = await sandboxWith();

    const description =
      (await sandbox.listTools()).find((tool) => tool.name === "run_python")
        ?.description ?? "";

    expect(description).toContain(
      "Each run starts fresh: nothing a script defines or loads is kept for the next, so save to a file what a later run needs.",
    );
    expect(description).toContain("A run stops after 5 minutes.");
    expect(description).toContain(
      "Its home folder (~) is Zhiyin's own for scripts, not the person's: write results in the workspace or a folder named in outside_folders.",
    );
    expect(description).toContain(
      "No window can open: to look at a figure, save it as a PNG in the workspace with savefig and read it with read_document.",
    );
    expect(description).toContain(
      "It runs in Zhiyin's environments, not a project's own virtual environment: run a project's own tests with bash.",
    );
  });

  it("tells the model how much a run may print, and stops a script there", async () => {
    const { sandbox, calls, interpreter } = await sandboxWith();

    const description =
      (await sandbox.listTools()).find((tool) => tool.name === "run_python")
        ?.description ?? "";
    await sandbox.callTool("run_python", { code: "print(1)" });

    expect(description).toContain(
      "A run may print at most 64 MB: write more to a file.",
    );
    expect(scriptRuns(calls, interpreter())[0]?.maximumOutputBytes).toBe(
      64 * 1024 * 1024,
    );
  });

  it.each([
    [
      "timeout",
      "The script took longer than 5 minutes, the most one run may take, so it was stopped. Split the work over several runs, saving to a file what the next one needs.\nstep 3 of 9",
    ],
    [
      "outputLimit",
      "The script printed more than 64 MB, the most one run may print, so it was stopped. Print less, such as a summary, and write the rest to a file.\nstep 3 of 9",
    ],
    [
      "stopped",
      "The script was stopped before it finished, as its task was stopped. Run it again only if asked.\nstep 3 of 9",
    ],
    [
      undefined,
      "The script was ended from outside before it finished, with no exit code.\nstep 3 of 9",
    ],
  ] as const)(
    "says why a script ended early, and at a limit what to do instead (%s)",
    async (ending, said) => {
      const { sandbox } = await sandboxWith({
        output: {
          exitCode: null,
          stdout: "step 3 of 9\n",
          ...(ending ? { ending } : {}),
        },
      });

      const result = (await sandbox.callTool("run_python", {
        code: "print(1)",
      })) as { isError?: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(said);
    },
  );

  it("names a crash by its Windows code", async () => {
    const { sandbox } = await sandboxWith({
      output: { exitCode: 3221225477, stdout: "loading\n" },
    });

    const result = (await sandbox.callTool("run_python", {
      code: "print(1)",
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "The script crashed with exit code 0xC0000005, an access violation, as a broken native extension makes.\nloading",
    );
  });

  it("points a missing module to the tool that adds it", async () => {
    const { sandbox } = await sandboxWith({
      output: {
        exitCode: 1,
        stderr:
          "Traceback (most recent call last):\n  File \"script.py\", line 1, in <module>\nModuleNotFoundError: No module named 'pyarrow'\n",
      },
    });

    const result = (await sandbox.callTool("run_python", {
      code: "import pyarrow",
    })) as { content: { text: string }[] };

    expect(result.content[0]?.text).toMatch(
      /\nThe environment “default” has no module pyarrow: add its package with install_python_package, or see what each environment holds with list_python_environments\.$/,
    );
  });

  it("tells the model how long installing and making an environment may take", async () => {
    const { sandbox } = await sandboxWith();

    const described = Object.fromEntries(
      (await sandbox.listTools()).map((tool) => [tool.name, tool.description]),
    );

    expect(described["install_python_package"]).toContain(
      "Each install stops after 15 minutes.",
    );
    expect(described["create_python_environment"]).toContain(
      "Each step of making it stops after 15 minutes.",
    );
    expect(described["reset_python_environment"]).toContain(
      "Each step of making it stops after 15 minutes.",
    );
  });

  it("gives Python, pip and uv Windows' own variables, and no proxy or anything that points them elsewhere", async () => {
    const planted = {
      PYTHONPATH: "C:\\elsewhere",
      PYTHONSTARTUP: "C:\\elsewhere\\start.py",
      UV_INDEX_URL: "https://packages.example/simple",
      PIP_INDEX_URL: "https://packages.example/simple",
      VIRTUAL_ENV: "C:\\elsewhere\\.venv",
      GITHUB_TOKEN: "ghp_planted",
      HTTPS_PROXY: "http://proxy.example:8080",
    };
    const before = { ...process.env };
    Object.assign(process.env, planted);
    try {
      const { sandbox, calls } = await sandboxWith();

      await sandbox.callTool("run_python", { code: "print(1)" });
      await sandbox.callTool("install_python_package", { packages: ["httpx"] });

      // uv, a script and pip.
      expect(calls.length).toBeGreaterThanOrEqual(4);
      // Windows names ignore case, and a terminal may spell them its own way.
      const read = (environment: object, name: string) =>
        Object.entries(environment).find(
          ([key]) => key.toUpperCase() === name.toUpperCase(),
        )?.[1];
      for (const { environment } of calls) {
        expect(read(environment, "SystemRoot")).toBe(process.env["SystemRoot"]);
        expect(read(environment, "PATH")).toBe(process.env["PATH"]);
        // A confined program reaches the network only through Zhiyin's proxy.
        for (const name of Object.keys(planted))
          expect(read(environment, name)).toBeUndefined();
      }
    } finally {
      for (const name of Object.keys(planted)) delete process.env[name];
      Object.assign(process.env, before);
    }
  });

  it("keeps the script it was given out of the person's folder, and removes it after", async () => {
    const { sandbox, calls, workspace, directory, interpreter } =
      await sandboxWith();

    await sandbox.callTool("run_python", { code: "print('hello')" });

    const script = scriptRuns(calls, interpreter())[0]?.arguments[0] ?? "";
    expect(script.startsWith(join(directory, "scripts"))).toBe(true);
    expect(await readdir(join(directory, "scripts"))).toEqual([]);
    expect(await readdir(workspace)).toEqual([]);
  });

  it("runs a script from the workspace, with its arguments, from a copy taken when it was approved", async () => {
    const { sandbox, calls, workspace, directory, interpreter } =
      await sandboxWith();
    await writeFile(join(workspace, "clean.py"), "print('ok')");
    const args = { path: "clean.py", arguments: ["--strict", "2"] };

    const approved = await sandbox.inspect("run_python", args);
    await sandbox.callTool(
      "run_python",
      args,
      undefined,
      approved.ok ? approved.identity : undefined,
    );

    const ran = scriptRuns(calls, interpreter()).at(-1);
    expect(ran).toMatchObject({ cwd: workspace, scriptText: "print('ok')" });
    // The copy runs under the file's own name, with its arguments after it.
    expect(ran?.arguments.slice(-2)).toEqual(["--strict", "2"]);
    expect(basename(ran?.arguments.at(-3) ?? "")).toBe("clean.py");
    expect(
      ran?.arguments.some((part) =>
        part.startsWith(join(directory, "scripts")),
      ),
    ).toBe(true);
  });

  it("tells the model how large a workspace script may be, and refuses a larger one saying what to do instead", async () => {
    const { sandbox, workspace } = await sandboxWith();
    await writeFile(
      join(workspace, "big.py"),
      `x = 1\n${"#".repeat(1024 * 1024)}\n`,
    );

    const path = (await sandbox.listTools()).find(
      (tool) => tool.name === "run_python",
    )?.inputSchema?.["properties"] as Record<string, { description: string }>;
    const refused = await sandbox.inspect("run_python", { path: "big.py" });

    expect(path["path"]?.description).toBe(
      "Workspace-relative path of a .py file to run instead, at most 1 MB.",
    );
    expect(refused).toMatchObject({
      ok: false,
      reason:
        "big.py is over 1 MB, too long to show for approval. Give the code to run instead.",
    });
  });

  it("shows the code of a workspace script on its approval", async () => {
    const { sandbox, workspace } = await sandboxWith();
    const code = "import urllib\nprint(1)\n";
    await writeFile(join(workspace, "fetch.py"), code);

    const inspection = await sandbox.inspect("run_python", {
      path: "fetch.py",
      hosts: ["pypi.org", "api.github.com"],
    });

    expect(inspection).toMatchObject({ ok: true, command: code });
    expect(inspection.ok && inspection.invocation).toEqual({
      name: "Run a Python script",
      arguments: [
        { name: "Code", value: code, runs: true },
        { name: "Script", value: "fetch.py", readable: true },
        { name: "Hosts", value: "api.github.com, pypi.org", readable: true },
      ],
    });
  });

  it("lays a script out for the person: its code as what runs, the rest in words", async () => {
    const { sandbox } = await sandboxWith();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly"],
    });

    const inline = await sandbox.inspect("run_python", {
      code: "print(1)",
      arguments: ["--title", "two words", ""],
      environment: "charts",
    });
    const plain = await sandbox.inspect("run_python", { code: "print(1)" });

    expect(inline.ok && inline.invocation).toEqual({
      name: "Run a Python script",
      arguments: [
        { name: "Code", value: "print(1)", runs: true },
        {
          name: "Arguments",
          value: '--title "two words" ""',
          readable: true,
        },
        { name: "Environment", value: "charts", readable: true },
      ],
    });
    // The default environment and no arguments say nothing.
    expect(plain.ok && plain.invocation).toEqual({
      name: "Run a Python script",
      arguments: [{ name: "Code", value: "print(1)", runs: true }],
    });
  });

  it("runs a script whose second line mentions an encoding after a first line of code, which Python reads as UTF-8", async () => {
    const { sandbox } = await sandboxWith();

    expect(
      await sandbox.inspect("run_python", {
        code: "import csv\n# old exports, encoding: latin-1\nprint(1)\n",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a script that declares an encoding other than UTF-8, which Python would read differently from what is shown", async () => {
    const { sandbox, calls, workspace, interpreter } = await sandboxWith();
    const hidden =
      "# -*- coding: utf-7 -*-\nprint('visible')\n# a note +AAo-print('hidden')\n";
    await writeFile(join(workspace, "hidden.py"), hidden);

    for (const args of [
      { code: hidden },
      { path: "hidden.py" },
      {
        code: `#!/usr/bin/env python\n# vim: set fileencoding=latin-1 :\nprint(1)\n`,
      },
    ]) {
      expect(await sandbox.inspect("run_python", args)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/declares the .* encoding/),
      });
      expect(await sandbox.callTool("run_python", args)).toMatchObject({
        isError: true,
      });
    }
    expect(scriptRuns(calls, interpreter())).toEqual([]);

    for (const declared of ["utf-8", "UTF8", "utf_8"])
      expect(
        await sandbox.inspect("run_python", {
          code: `# -*- coding: ${declared} -*-\nprint(1)\n`,
        }),
      ).toMatchObject({ ok: true });
  });

  it("does not run a workspace script changed after it was approved", async () => {
    const { sandbox, calls, workspace, interpreter } = await sandboxWith();
    await writeFile(join(workspace, "job.py"), "print('approved')");
    const args = { path: "job.py", hosts: ["api.example.com"] };

    const approved = await sandbox.inspect("run_python", args);
    await writeFile(join(workspace, "job.py"), "print('changed')");
    const again = await sandbox.inspect("run_python", args);
    await sandbox.inspect("run_python", args);
    await writeFile(join(workspace, "job.py"), "print('changed twice')");
    const result = await sandbox.callTool(
      "run_python",
      args,
      undefined,
      approved.ok ? approved.identity : undefined,
    );

    // What is approved holds the code, so a change is seen when the call is
    // looked at again before it runs.
    expect(JSON.stringify(again)).not.toBe(JSON.stringify(approved));
    expect(result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("changed after") }],
    });
    expect(scriptRuns(calls, interpreter())).toEqual([]);
  });

  it("runs a workspace script only as the code its own approval showed", async () => {
    const { sandbox, calls, workspace, interpreter } = await sandboxWith();
    await writeFile(join(workspace, "job.py"), "print('first')");
    const args = { path: "job.py", hosts: ["api.example.com"] };

    const first = await sandbox.inspect("run_python", args);
    await writeFile(join(workspace, "job.py"), "print('second')");
    // Shown again, on a second approval still waiting.
    const second = await sandbox.inspect("run_python", args);
    const fromFirst = await sandbox.callTool(
      "run_python",
      args,
      undefined,
      first.ok ? first.identity : undefined,
    );
    const fromSecond = await sandbox.callTool(
      "run_python",
      args,
      undefined,
      second.ok ? second.identity : undefined,
    );
    const unbound = await sandbox.callTool("run_python", args);

    expect(fromFirst).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("changed after") }],
    });
    expect(fromSecond).not.toMatchObject({ isError: true });
    expect(unbound).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("not shown for approval") }],
    });
    expect(
      scriptRuns(calls, interpreter()).map((call) => call.scriptText),
    ).toEqual(["print('second')"]);
  });

  it("reads blank code as no code, and refuses code and a script path given together", async () => {
    const { sandbox, calls, workspace, interpreter } = await sandboxWith();
    await writeFile(join(workspace, "job.py"), "print('from the file')");
    const blank = { code: "  ", path: "job.py" };
    const both = { code: "print('given')", path: "job.py" };

    const shown = await sandbox.inspect("run_python", blank);
    await sandbox.callTool(
      "run_python",
      blank,
      undefined,
      shown.ok ? shown.identity : undefined,
    );

    expect(shown).toMatchObject({
      ok: true,
      command: "print('from the file')",
    });
    expect(
      scriptRuns(calls, interpreter()).map((call) => call.scriptText),
    ).toEqual(["print('from the file')"]);
    expect(await sandbox.inspect("run_python", both)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not both"),
    });
    expect(await sandbox.callTool("run_python", both)).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("not both") }],
    });
  });

  it("refuses a script outside the workspace before reading it", async () => {
    const { sandbox } = await sandboxWith();

    expect(
      await sandbox.inspect("run_python", { path: "../elsewhere.py" }),
    ).toMatchObject({ ok: false });
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

  it("leaves out Python's own warning that it could not find where it is, which every start in a container prints", async () => {
    const { sandbox } = await sandboxWith({
      output: {
        exitCode: 1,
        stdout: "the answer\n",
        stderr:
          "Failed to find real location of C:\\Zhiyin\\python\\cpython-3.13-windows-x86_64-none\\python.exe\r\nTraceback: boom\r\n",
      },
    });

    const result = await sandbox.callTool("run_python", {
      code: "print('the answer')",
    });

    const said = (result as { content: { text: string }[] }).content[0]!.text;
    expect(said).toContain("the answer");
    expect(said).toContain("Traceback: boom");
    expect(said).not.toContain("Failed to find real location");
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

  it("runs a script in the environment it names, and refuses one that does not exist before anything runs", async () => {
    const { sandbox, calls, environment, interpreter } = await sandboxWith();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly"],
    });
    calls.length = 0;

    await sandbox.callTool("run_python", {
      code: "import plotly",
      environment: "charts",
    });
    const missing = await sandbox.callTool("run_python", {
      code: "print(1)",
      environment: "nowhere",
    });

    const [script] = scriptRuns(calls, interpreter("charts"));
    expect(script?.confinement?.read).toContain(environment("charts"));
    expect(missing).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("nowhere") }],
    });
    expect(calls).toHaveLength(1);
  });
});

describe("an environment named by a path", () => {
  it("is refused, even where an environment would be found there, and nothing runs", async () => {
    const { sandbox, calls, directory } = await sandboxWith();
    // What an environment leaves on disk, made outside the environments.
    const outside = join(directory, "outside");
    await mkdir(join(outside, "Scripts"), { recursive: true });
    await writeFile(join(outside, "Scripts", "python.exe"), "not Python");
    await writeFile(
      `${outside}.json`,
      JSON.stringify({ python: "3.13", packages: [], ready: true }),
    );

    for (const environment of ["../outside", "..\\outside", outside]) {
      expect(
        await sandbox.inspect("run_python", { code: "print(1)", environment }),
        environment,
      ).toMatchObject({ ok: false });
      expect(
        await sandbox.callTool("run_python", { code: "print(1)", environment }),
        environment,
      ).toMatchObject({ isError: true });
      expect(
        await sandbox.callTool("install_python_package", {
          packages: ["httpx"],
          environment,
        }),
        environment,
      ).toMatchObject({ isError: true });
      expect(
        await sandbox.callTool("reset_python_environment", { environment }),
        environment,
      ).toMatchObject({ isError: true });
      expect(
        await sandbox.callTool("remove_python_environment", {
          name: environment,
        }),
        environment,
      ).toMatchObject({ isError: true });
    }
    expect(calls).toEqual([]);
  });
});

describe("what a script reaches", () => {
  it("reads only Zhiyin's own Python, its environment and its code, changes only the workspace, and reaches only the hosts it names", async () => {
    const { sandbox, calls, workspace, directory, environment, interpreter } =
      await sandboxWith();

    await sandbox.callTool("run_python", { code: "print(1)" });
    await sandbox.callTool("run_python", {
      code: "print(2)",
      hosts: ["PyPI.org", "api.github.com", "pypi.org"],
    });

    const runs = scriptRuns(calls, interpreter());
    expect(runs).toHaveLength(2);
    for (const [index, run] of runs.entries()) {
      expect(run.confinement).toMatchObject({
        purpose: "python",
        write: [workspace],
        hosts: index === 1 ? ["api.github.com", "pypi.org"] : [],
      });
      expect(new Set(run.confinement?.read)).toEqual(
        new Set([
          join(directory, "python"),
          environment("default"),
          dirname(run.arguments[0] ?? ""),
        ]),
      );
    }
  });

  it("keeps the code it runs where no script can change it", async () => {
    const { sandbox, calls, workspace, interpreter } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print(1)" });

    const [run] = scriptRuns(calls, interpreter());
    const folder = dirname(run?.arguments[0] ?? "");
    const within = (outer: string) => !relative(outer, folder).startsWith("..");
    expect(run?.confinement?.read).toContain(folder);
    expect(within(workspace)).toBe(false);
    expect(within(run?.confinement?.home ?? workspace)).toBe(false);
  });

  it("gives scripts with hosts and without homes of their own in each workspace, kept between runs", async () => {
    const { sandbox, calls, interpreter } = await sandboxWith();

    await sandbox.callTool("run_python", { code: "print(1)" });
    await sandbox.callTool("run_python", { code: "print(2)" });
    await sandbox.callTool("run_python", {
      code: "print(3)",
      hosts: ["api.example.com"],
    });

    const [offline, again, online] = scriptRuns(calls, interpreter()).map(
      (run) => run.confinement?.home,
    );
    expect(offline).toBeDefined();
    expect(again).toBe(offline);
    expect(online).not.toBe(offline);
  });

  it("gives each workspace its own home", async () => {
    let workspace = await folders.make("zhiyin-sandbox-first-");
    const { sandbox, calls, interpreter } = await sandboxWith({
      workspace: () => workspace,
    });

    await sandbox.callTool("run_python", { code: "print(1)" });
    workspace = await folders.make("zhiyin-sandbox-second-");
    await sandbox.callTool("run_python", { code: "print(1)" });

    const homes = scriptRuns(calls, interpreter()).map(
      (run) => run.confinement?.home,
    );
    expect(homes).toHaveLength(2);
    expect(homes[0]).not.toBe(homes[1]);
  });
});

describe("what a script that names hosts is told it reached", () => {
  const reached = [
    {
      host: "pypi.org",
      port: 443,
      connections: 2,
      sent: 1800,
      received: 3_500_000,
    },
    {
      host: "evil.example",
      port: 443,
      connections: 0,
      sent: 0,
      received: 0,
      refused: "not among the hosts this run may reach",
    },
  ];

  it("ends its answer with each host it asked for, what went each way, and what was refused", async () => {
    const { sandbox } = await sandboxWith({
      output: { exitCode: 0, stdout: "done", network: reached },
    });

    const answer = await sandbox.callTool("run_python", {
      code: "print(1)",
      hosts: ["pypi.org"],
    });

    expect(answer).toMatchObject({
      content: [
        {
          text: expect.stringMatching(
            /done[\s\S]*\n\nNetwork:\npypi\.org: sent 1\.8 KB, received 3\.3 MB\.\nevil\.example: refused: not among the hosts this run may reach\.$/,
          ),
        },
      ],
    });
  });

  it("shows the person the same, beside the action", async () => {
    const { sandbox } = await sandboxWith({
      output: { exitCode: 3, stdout: "", stderr: "failed", network: reached },
    });
    const args = { code: "print(1)", hosts: ["pypi.org"] };
    const answer = (await sandbox.callTool("run_python", args)) as {
      content: { text: string }[];
    };

    const details = sandbox.describeResult("run_python", args, {
      ok: false,
      reason: answer.content[0]?.text ?? "",
    });

    expect(details).toContainEqual({
      kind: "text",
      label: "Network",
      text: "pypi.org: sent 1.8 KB, received 3.3 MB.\nevil.example: refused: not among the hosts this run may reach.",
    });
  });

  it("counts the requests to hosts past the first hundred in one line", async () => {
    const { sandbox } = await sandboxWith({
      output: {
        exitCode: 0,
        stdout: "done",
        network: reached,
        furtherHosts: {
          refused: 2900,
          failed: 1,
          connections: 2,
          sent: 10,
          received: 2048,
        },
      },
    });

    const answer = await sandbox.callTool("run_python", {
      code: "print(1)",
      hosts: ["*.example.com"],
    });

    expect(answer).toMatchObject({
      content: [
        {
          text: expect.stringMatching(
            /\nevil\.example: refused: not among the hosts this run may reach\.\nAnd 2,903 more requests to other hosts: 2,900 refused; 1 could not be reached; 2 reached, sent 10 bytes, received 2\.0 KB\.$/,
          ),
        },
      ],
    });
  });

  it("says a script reached no host when it asked for none", async () => {
    const { sandbox } = await sandboxWith({
      output: { exitCode: 0, network: [] },
    });

    const answer = await sandbox.callTool("run_python", {
      code: "print(1)",
      hosts: ["pypi.org"],
    });

    expect(answer).toMatchObject({
      content: [
        { text: expect.stringMatching(/\n\nNetwork:\nIt reached no host\.$/) },
      ],
    });
  });

  it("shows nothing a script printed as what it reached when it named no hosts", async () => {
    const forged = "\n\nNetwork:\npypi.org: sent 1 byte, received 1 byte.";
    const { sandbox } = await sandboxWith({
      output: { exitCode: 0, stdout: forged },
    });
    const args = { code: "print(1)" };
    const answer = await sandbox.callTool("run_python", args);

    expect(
      sandbox.describeResult("run_python", args, { ok: true, value: answer }),
    ).toEqual([]);
  });
});

describe("approving a script", () => {
  it("says a script reaches only the workspace, and the hosts it names", async () => {
    const { sandbox } = await sandboxWith();
    // Made first, so the approval says nothing of making it.
    await sandbox.callTool("run_python", { code: "print(0)" });

    expect(
      await sandbox.inspect("run_python", { code: "print(1)" }),
    ).toMatchObject({
      detail:
        "The script reads and changes only the workspace, and reaches no network.",
    });
    expect(
      await sandbox.inspect("run_python", {
        code: "print(1)",
        hosts: ["pypi.org", "api.github.com", "*.example.com"],
      }),
    ).toMatchObject({
      detail:
        "The script reads and changes only the workspace, and can reach *.example.com, api.github.com and pypi.org: it could send what it reads there, and nowhere else.",
    });
  });

  it("names the environment a script runs in", async () => {
    const { sandbox } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    expect(
      await sandbox.inspect("run_python", {
        code: "print(1)",
        environment: "charts",
      }),
    ).toMatchObject({ ok: true, target: "a script, in charts" });
    expect(
      await sandbox.inspect("run_python", {
        code: "print(1)",
        environment: "nowhere",
      }),
    ).toMatchObject({ ok: false });
  });

  it("asks once in a conversation for scripts that reach no network, in any environment, and once for each set of hosts", async () => {
    const { sandbox, workspace } = await sandboxWith();
    // A script that first makes its environment downloads, which no
    // allowance covers.
    const unmade = await sandbox.inspect("run_python", { code: "print(0)" });
    await sandbox.callTool("run_python", { code: "print(0)" });
    await sandbox.callTool("create_python_environment", { name: "charts" });
    await writeFile(join(workspace, "analysis.py"), "print(2)");

    const first = await sandbox.inspect("run_python", { code: "print(1)" });
    const second = await sandbox.inspect("run_python", {
      path: "analysis.py",
      environment: "charts",
    });
    const online = await sandbox.inspect("run_python", {
      code: "print(1)",
      hosts: ["pypi.org", "api.github.com"],
    });
    const sameHosts = await sandbox.inspect("run_python", {
      path: "analysis.py",
      hosts: ["API.github.com", "pypi.org"],
    });
    const otherHosts = await sandbox.inspect("run_python", {
      code: "print(1)",
      hosts: ["pypi.org"],
    });

    expect(first).toMatchObject({
      ok: true,
      allowance: {
        label: "Python scripts that reach only the workspace, and no network",
      },
    });
    // Allowing one allows every other script that reaches no network.
    expect(first.ok && first.allowance?.key).toBe(
      second.ok && second.allowance?.key,
    );
    // Allowing a set of hosts allows the scripts that reach those hosts,
    // and no others.
    expect(online).toMatchObject({
      ok: true,
      allowance: {
        label:
          "Python scripts that reach only the workspace and these hosts: api.github.com, pypi.org",
      },
    });
    expect(online.ok && online.allowance?.key).toBe(
      sameHosts.ok && sameHosts.allowance?.key,
    );
    expect(online.ok && online.allowance?.key).not.toBe(
      otherHosts.ok && otherHosts.allowance?.key,
    );
    expect(online.ok && online.allowance?.key).not.toBe(
      first.ok && first.allowance?.key,
    );
    expect(online).not.toHaveProperty("asksEachTime");
    expect(first).not.toHaveProperty("asksEachTime");
    expect(unmade).toMatchObject({ ok: true, asksEachTime: true });
    expect(unmade).not.toHaveProperty("allowance");
  });

  it("refuses hosts it cannot give, and the internet asked for without them, saying why", async () => {
    const { sandbox, calls } = await sandboxWith();

    expect(
      await sandbox.inspect("run_python", {
        code: "print(1)",
        hosts: "pypi.org",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await sandbox.inspect("run_python", {
        code: "print(1)",
        hosts: ["https://pypi.org/simple"],
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("without a scheme or path"),
    });
    expect(
      await sandbox.callTool("run_python", {
        code: "print(1)",
        hosts: ["localhost"],
      }),
    ).toMatchObject({ isError: true });
    expect(
      await sandbox.callTool("run_python", { code: "print(1)", network: true }),
    ).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "Name the hosts the script may reach in hosts",
          ),
        },
      ],
    });
    expect(calls).toEqual([]);
  });

  it("shows a long script whole, line by line, as what will run", async () => {
    const { sandbox } = await sandboxWith();
    const code = Array.from(
      { length: 400 },
      (_, line) => `print("line ${line} of a long script")`,
    ).join("\n");

    expect(await sandbox.inspect("run_python", { code })).toMatchObject({
      command: code,
    });
  });

  it("says where preparing the default environment downloads from, and sends the script nowhere", async () => {
    const { sandbox } = await sandboxWith();

    const first = await sandbox.inspect("run_python", { code: "print(1)" });
    await sandbox.callTool("run_python", { code: "print(1)" });
    const later = await sandbox.inspect("run_python", { code: "print(1)" });

    // The approval shows a destination as where the call is sent.
    expect(first).not.toHaveProperty("destinations");
    expect(first).toMatchObject({
      ok: true,
      action: "Run a Python script",
      detail: expect.stringMatching(
        /^The script reads and changes only the workspace, and reaches no network\. .*Python from releases\.astral\.sh or github\.com and its packages from pypi\.org, or from the mirrors registry\.npmmirror\.com and pypi\.tuna\.tsinghua\.edu\.cn when those cannot be reached\.$/,
      ),
    });
    expect(later).toMatchObject({
      detail:
        "The script reads and changes only the workspace, and reaches no network.",
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
      "create_python_environment",
      "list_python_environments",
      "remove_python_environment",
      "reset_python_environment",
    ]);
  });

  it("names each tool for the person while a call to it is written, as its approval does", async () => {
    const { sandbox } = await sandboxWith();

    expect(
      Object.fromEntries(
        (await sandbox.listTools()).map((tool) => [tool.name, tool.label]),
      ),
    ).toEqual({
      run_python: "Run a Python script",
      install_python_package: "Add packages to a Python environment",
      create_python_environment: "Create a Python environment",
      list_python_environments: "List the Python environments",
      remove_python_environment: "Remove a Python environment",
      reset_python_environment: "Rebuild a Python environment",
    });
  });

  it("refuses to run with no folder chosen", async () => {
    const directory = join(
      await folders.make("zhiyin-sandbox-data-"),
      "python-sandbox",
    );
    const sandbox = pythonSandbox({
      workspaceRoot: () => undefined,
      directory,
      uv: async () => uvProgram,
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
