/**
 * The environments Zhiyin keeps for its own features, beside the default one:
 * one another feature keeps is made from its lock when the connector that
 * uses it is installed, never by a call; never created or removed by name; and run by
 * a feature through the runner the sandbox hands out.
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pythonEnvironments, type RunProgram } from "../src/index.js";
import { folders, sandboxWith, uvProgram } from "./fake-programs.js";
import { parts, partsLock } from "./kept-fixture.js";

afterEach(() => folders.removeAll());

/** The packages a lock-file install was given, by name. */
async function lockedNames(call: {
  readonly arguments: readonly string[];
  readonly cwd: string;
}) {
  const lock = call.arguments[call.arguments.indexOf("-r") + 1]!;
  return (await readFile(resolve(call.cwd, lock), "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split("==")[0]);
}

type Result = { isError?: boolean; content: { text: string }[] };
const said = (result: unknown) =>
  (result as Result).content.map((part) => part.text).join("\n");

/** The sandbox's environments, with the stand-in programs, from `lock`. */
async function keptWith(
  options: {
    readonly lock?: typeof partsLock;
    readonly uv?: string | undefined;
    /** Stands in for the programs, around the usual stand-ins. */
    readonly around?: (run: RunProgram) => RunProgram;
  } = {},
) {
  const made = await sandboxWith();
  const from = (lock: typeof partsLock = options.lock ?? partsLock) =>
    pythonEnvironments({
      directory: made.directory,
      uv: async () => ("uv" in options ? options.uv : uvProgram),
      run: options.around ? options.around(made.run) : made.run,
      keptEnvironments: [{ ...parts, lock }],
    });
  const environments = from();
  /** How many times uv made the kept environment from nothing. */
  const madeTimes = () =>
    made.calls.filter(
      (call) =>
        call.executable === uvProgram &&
        call.arguments[0] === "venv" &&
        call.arguments.at(-1) === made.environment("parts"),
    ).length;
  return {
    ...made,
    from,
    kept: environments.kept,
    installation: environments.kept.installation("parts"),
    connection: environments.connection(() => made.workspace),
    madeTimes,
  };
}

/** A lock as an earlier release shipped it: one package fewer. */
const earlier = {
  ...partsLock,
  asked: ["solids"],
  locked: partsLock.locked.filter((entry) => entry.name !== "std-fasteners"),
};

/** A run of a kept environment's Python, granted nothing in particular. */
function runIn(workspace: string) {
  return {
    environment: "parts",
    arguments: [join(workspace, "..", "harness", "run.py"), "part.py"],
    cwd: workspace,
    read: [workspace],
    write: [],
    home: join(workspace, "..", "run-home"),
    timeoutMs: 60_000,
  };
}

const packageTotal = partsLock.locked.reduce(
  (sum, entry) => sum + entry.bytes,
  0,
);

describe("installing an environment its connector makes", () => {
  it("is made from the versions Zhiyin pins, each checked against its hashes, when its connector installs it", async () => {
    const { installation, calls, interpreter } = await keptWith();

    await installation.install();

    const made = calls.find(
      (call) => call.executable === uvProgram && call.arguments[0] === "venv",
    );
    expect(made?.arguments.at(-1)).toMatch(/[\\/]parts$/);
    const install = calls.find(
      (call) => call.executable === uvProgram && call.arguments[0] === "pip",
    )!;
    expect(install.arguments).toEqual(
      expect.arrayContaining(["--require-hashes", "--no-build", "-r"]),
    );
    expect(install.arguments).toContain(interpreter("parts"));
    expect(await lockedNames(install)).toEqual(
      expect.arrayContaining(["solids", "kernel-bindings"]),
    );
    expect(await installation.state()).toEqual({ status: "ready" });
  });

  it("says before it is made what it downloads, about how much, and from where", async () => {
    const { installation } = await keptWith();

    expect(await installation.state()).toEqual({
      status: "missing",
      downloads: [
        {
          name: "Python",
          version: partsLock.pythonBuild.version,
          bytes: partsLock.pythonBuild.bytes,
          sources: [
            "releases.astral.sh",
            "github.com",
            "release-assets.githubusercontent.com",
            "registry.npmmirror.com",
            "cdn.npmmirror.com",
          ],
        },
        {
          name: "solids",
          version: "0.13.0",
          bytes: packageTotal,
          estimated: true,
          detail: `With std_fasteners 0.4.0 and the ${partsLock.locked.length - 2} packages they need.`,
          sources: [
            "pypi.org",
            "files.pythonhosted.org",
            "pypi.tuna.tsinghua.edu.cn",
          ],
        },
      ],
    });
  });

  it("downloads no Python when Zhiyin already keeps one of that version", async () => {
    const { installation, connection } = await keptWith();
    // The default environment, made first, brought Python 3.13.
    await connection.callTool("run_python", { code: "print(1)" });

    const state = await installation.state();

    expect(
      state.status === "missing" && state.downloads.map((item) => item.name),
    ).toEqual(["solids"]);
  });

  it("says which step it is on while it installs", async () => {
    const stages: unknown[] = [];
    const watched: { state?: () => Promise<unknown> } = {};
    const { installation } = await keptWith({
      around: (run) => async (given) => {
        if (given.executable === uvProgram || given.arguments[0] === "-I")
          stages.push(await watched.state?.());
        return run(given);
      },
    });
    watched.state = () => installation.state();

    await installation.install();

    expect(stages).toEqual([
      {
        status: "installing",
        stage: { name: "Setting up Python", step: 1, steps: 3 },
      },
      {
        status: "installing",
        stage: { name: "Installing the packages", step: 2, steps: 3 },
      },
      {
        status: "installing",
        stage: { name: "Preparing the packages", step: 3, steps: 3 },
      },
    ]);
  });

  it("goes to the mirrors when the sites Python and the packages come from cannot be reached", async () => {
    const { installation, unreachable, calls } = await keptWith();
    unreachable.original = true;

    await installation.install();

    const install = calls.filter(
      (call) => call.executable === uvProgram && call.arguments[0] === "pip",
    );
    expect(install.at(-1)?.arguments).toEqual(
      expect.arrayContaining([
        "--default-index",
        "https://pypi.tuna.tsinghua.edu.cn/simple",
      ]),
    );
    expect(await installation.state()).toEqual({ status: "ready" });
  });

  it("fails with uv's reason, which its state then says, and leaves nothing half made", async () => {
    const { installation, failing, environment } = await keptWith();
    failing.current = "parts-packages.txt";

    await expect(installation.install()).rejects.toThrow(
      "could not be installed",
    );

    expect(await installation.state()).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("it went wrong"),
    });
    await expect(stat(environment("parts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops when asked, without a failure, and leaves nothing half made", async () => {
    const stop = new AbortController();
    const { installation, environment } = await keptWith({
      around: (run) => async (given) => {
        if (!given.arguments.includes("parts-packages.txt")) return run(given);
        stop.abort();
        return { exitCode: null, stdout: "", stderr: "", ending: "stopped" };
      },
    });

    await expect(installation.install(stop.signal)).rejects.toThrow();

    expect(await installation.state()).toMatchObject({ status: "missing" });
    await expect(stat(environment("parts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("starts anew when asked again while the last install is being stopped", async () => {
    const stop = new AbortController();
    const released: { go?: () => void } = {};
    const { installation } = await keptWith({
      around: (run) => async (given) => {
        if (
          !stop.signal.aborted &&
          given.arguments.includes("parts-packages.txt")
        ) {
          // Held until it has been stopped and asked for again.
          await new Promise<void>((go) => (released.go = go));
          return { exitCode: null, stdout: "", stderr: "", ending: "stopped" };
        }
        return run(given);
      },
    });

    const first = installation.install(stop.signal);
    first.catch(() => {});
    await new Promise((settle) => setTimeout(settle, 50));
    stop.abort();
    const again = installation.install();
    released.go?.();

    await expect(first).rejects.toThrow();
    await again;
    expect(await installation.state()).toEqual({ status: "ready" });
  });

  it("refuses to install without uv, which its connector installs first", async () => {
    const { installation } = await keptWith({ uv: undefined });

    await expect(installation.install()).rejects.toThrow("uv");
  });
});

describe("an environment its connector makes, from an earlier release", () => {
  it("reads as needing an update, and runs nothing until it is installed again", async () => {
    const { from, workspace, madeTimes } = await keptWith({ lock: earlier });
    await from().kept.installation("parts").install();

    const updated = from(partsLock);
    const state = await updated.kept.installation("parts").state();
    const usable = await updated.kept.state("parts");
    const ran = await updated.kept.run(runIn(workspace));

    expect(state).toMatchObject({
      status: "missing",
      downloads: [{ name: "solids", update: true }],
    });
    expect(usable).toBe("unavailable");
    expect(ran).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Parts studio connector"),
    });
    expect(madeTimes()).toBe(1);

    await updated.kept.installation("parts").install();

    expect(await updated.kept.installation("parts").state()).toEqual({
      status: "ready",
    });
    expect(await updated.kept.state("parts")).toBe("ready");
    expect(madeTimes()).toBe(2);
  });

  it("keeps the old environment when its update fails", async () => {
    const { from, installed, interpreter, failing } = await keptWith({
      lock: earlier,
    });
    await from().kept.installation("parts").install();
    failing.current = "parts-packages.txt";

    await expect(
      from(partsLock).kept.installation("parts").install(),
    ).rejects.toThrow();

    expect(await stat(interpreter("parts"))).toBeTruthy();
    expect(await installed("parts")).toContain("solids");
    expect(await installed("parts")).not.toContain("std-fasteners");
  });
});

describe("an environment its connector makes, in a conversation", () => {
  it("is not made by a script asked to run in it, which is told how it is installed", async () => {
    const { connection, madeTimes } = await keptWith();

    const asked = await connection.inspect("run_python", {
      code: "import solids",
      environment: "parts",
    });
    const ran = await connection.callTool("run_python", {
      code: "import solids",
      environment: "parts",
    });
    const listed = await connection.callTool("list_python_environments", {});

    expect(asked).toMatchObject({
      ok: false,
      reason: expect.stringContaining(
        "made when the Parts studio connector is installed",
      ),
    });
    expect(ran).toMatchObject({ isError: true });
    expect(said(ran)).toContain(
      "made when the Parts studio connector is installed",
    );
    expect(said(listed)).toContain(
      "parts — not installed: it is made when the Parts studio connector is installed",
    );
    expect(madeTimes()).toBe(0);
  });

  it("is not rebuilt by a script once a release ships other packages, which is told to update the connector", async () => {
    const { from, madeTimes } = await keptWith({ lock: earlier });
    await from().kept.installation("parts").install();
    const updated = from(partsLock).connection(() => undefined);

    const listed = await updated.callTool("list_python_environments", {});

    expect(said(listed)).toContain(
      "parts — made from the packages of an earlier Zhiyin: updating the Parts studio connector",
    );
    expect(madeTimes()).toBe(1);
  });

  it("runs a script once it is installed", async () => {
    const { installation, connection } = await keptWith();
    await installation.install();

    const ran = await connection.callTool("run_python", {
      code: "import solids",
      environment: "parts",
    });

    expect(ran).not.toHaveProperty("isError");
  });

  it("cannot be created or removed by name, and is rebuilt from its lock", async () => {
    const { connection, installation } = await keptWith();
    await installation.install();

    const created = await connection.inspect("create_python_environment", {
      name: "parts",
    });
    const removed = await connection.inspect("remove_python_environment", {
      name: "parts",
    });
    const reset = await connection.inspect("reset_python_environment", {
      environment: "parts",
    });

    expect(created).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Zhiyin's own environment"),
    });
    expect(removed).toMatchObject({
      ok: false,
      reason: expect.stringContaining("cannot be removed"),
    });
    expect(reset).toMatchObject({
      ok: true,
      command: expect.stringContaining(
        "uv pip install --no-build --require-hashes -r parts-packages.txt",
      ),
      detail: expect.stringContaining(
        "each checked against the SHA-256 Zhiyin keeps",
      ),
    });
  });

  it("is not made by a reset before it is installed", async () => {
    const { connection, madeTimes } = await keptWith();

    const asked = await connection.inspect("reset_python_environment", {
      environment: "parts",
    });
    const reset = await connection.callTool("reset_python_environment", {
      environment: "parts",
    });

    expect(asked).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Parts studio connector"),
    });
    expect(reset).toMatchObject({ isError: true });
    expect(madeTimes()).toBe(0);
  });
});

describe("running a kept environment for a feature", () => {
  it("runs nothing, and downloads nothing, before the environment is installed", async () => {
    const { kept, calls, workspace } = await keptWith();

    const usable = await kept.state("parts");
    const ran = await kept.run(runIn(workspace));

    expect(usable).toBe("unavailable");
    expect(ran).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Parts studio connector"),
    });
    expect(calls).toEqual([]);
  });

  it("runs its Python confined once installed: reading what it is given and its own, writing only what it is given, offline", async () => {
    const {
      kept,
      installation,
      calls,
      interpreter,
      environment,
      directory,
      workspace,
    } = await keptWith();
    const output = join(directory, "..", "out");
    const harness = join(directory, "..", "harness");
    await mkdir(output, { recursive: true });
    await installation.install();

    const ran = await kept.run({
      environment: "parts",
      arguments: [join(harness, "run.py"), "part.py"],
      cwd: workspace,
      read: [workspace, harness],
      write: [output],
      home: join(output, "..", "run-home"),
      timeoutMs: 60_000,
    });

    expect(await kept.state("parts")).toBe("ready");
    expect(ran).toMatchObject({ ok: true, run: { exitCode: 0 } });
    const script = calls.find(
      (call) =>
        call.executable === interpreter("parts") &&
        call.arguments[0] === join(harness, "run.py"),
    );
    expect(script?.cwd).toBe(workspace);
    expect(script?.confinement).toMatchObject({
      hosts: [],
      write: [output],
      // The run's own home, which goes with it.
      home: join(output, "..", "run-home"),
    });
    expect(script?.confinement?.read).toEqual(
      expect.arrayContaining([workspace, harness, environment("parts")]),
    );
    expect(script?.confinement?.write).not.toContain(workspace);
  });

  it("stops a run at the output limit its feature gives it", async () => {
    const limits: (number | undefined)[] = [];
    const { kept, installation, workspace } = await keptWith({
      around: (run) => (given) => {
        if (given.arguments.includes("part.py"))
          limits.push(given.maximumOutputBytes);
        return run(given);
      },
    });
    await installation.install();

    await kept.run({ ...runIn(workspace), maximumOutputBytes: 4096 });
    await kept.run(runIn(workspace));

    expect(limits).toEqual([4096, undefined]);
  });

  it("gives back what the script printed without the warning Python prints on every confined start", async () => {
    const { kept, installation, workspace, failing } = await keptWith();
    await installation.install();
    failing.current = "part.py";

    const ran = await kept.run(runIn(workspace));

    expect(ran).toMatchObject({
      ok: true,
      run: { exitCode: 1, stderr: "it went wrong" },
    });
  });

  it("says so in its own words when the environment's Python cannot start", async () => {
    const { kept, installation, workspace, unstartable } = await keptWith();
    await installation.install();
    unstartable.current = "part.py";

    const ran = await kept.run(runIn(workspace));

    expect(ran).toEqual({
      ok: false,
      reason: "The Python of the “parts” environment could not be started.",
    });
  });

  it("runs only an environment Zhiyin keeps, and none without uv", async () => {
    const { kept, workspace } = await keptWith();
    const missing = await keptWith({ uv: undefined });

    const other = await kept.run({ ...runIn(workspace), environment: "mine" });

    expect(other).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not one Zhiyin keeps"),
    });
    expect(await missing.kept.state("parts")).toBe("unavailable");
  });
});
