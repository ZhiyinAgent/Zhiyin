import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultPackagesPublishedBy } from "../src/index.js";
import {
  folders,
  sandboxWith,
  scriptRuns,
  uvProgram,
  type Call,
} from "./fake-programs.js";

afterEach(() => folders.removeAll());

type Result = { isError?: boolean; content: { text: string }[] };
const said = (result: unknown) =>
  (result as Result).content.map((part) => part.text).join("\n");
const exists = async (path: string) =>
  Boolean(await stat(path).catch(() => undefined));

/** The runs of pip, by the environment's own Python. */
const pipRuns = (calls: readonly Call[]) =>
  calls.filter(
    (call) => call.arguments[0] === "-m" && call.arguments[1] === "pip",
  );

describe("creating an environment", () => {
  it("makes it with the Python asked for, then installs its packages with its own pip, which changes only it and may use the internet", async () => {
    const { sandbox, calls, directory, environment, interpreter, installed } =
      await sandboxWith();

    const result = await sandbox.callTool("create_python_environment", {
      name: "charts",
      python: "3.12",
      packages: ["plotly", "kaleido==0.2.1"],
    });

    expect(result).not.toHaveProperty("isError");
    expect(said(result)).toContain("charts");
    expect(calls.map((call) => [call.executable, call.arguments])).toEqual([
      [
        uvProgram,
        [
          "venv",
          "--no-config",
          "--seed",
          // pip as published by the date the release fixes.
          "--exclude-newer",
          defaultPackagesPublishedBy,
          "--python",
          "3.12",
          "--managed-python",
          environment("charts"),
        ],
      ],
      [
        interpreter("charts"),
        [
          "-m",
          "pip",
          "--no-input",
          "--disable-pip-version-check",
          "install",
          "plotly",
          "kaleido==0.2.1",
        ],
      ],
    ]);
    expect(calls[1]?.confinement).toMatchObject({
      purpose: "python-install",
      read: [join(directory, "python")],
      write: [environment("charts")],
      network: true,
    });
    expect(await installed("charts")).toEqual(["kaleido", "pip", "plotly"]);
  });

  it("uses Python 3.13 when none is asked for, and installs nothing but pip when no package is", async () => {
    const { sandbox, calls, installed } = await sandboxWith();

    await sandbox.callTool("create_python_environment", { name: "bare" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments).toEqual(
      expect.arrayContaining(["--python", "3.13"]),
    );
    expect(await installed("bare")).toEqual(["pip"]);
  });

  it("is used by scripts that name it, and leaves the default environment unmade", async () => {
    const { sandbox, calls, interpreter, environment } = await sandboxWith();

    await sandbox.callTool("create_python_environment", { name: "charts" });
    await sandbox.callTool("run_python", {
      code: "print(1)",
      environment: "charts",
    });

    expect(scriptRuns(calls, interpreter("charts"))).toHaveLength(1);
    expect(await exists(environment("default"))).toBe(false);
  });

  it("refuses a name that is not a short lowercase word, Windows' reserved names, and a name already used, before anything runs", async () => {
    const { sandbox, calls } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });
    calls.length = 0;

    for (const name of [
      "Charts",
      "../up",
      "a b",
      "-x",
      "con",
      "lpt1",
      "",
      "x".repeat(40),
      7,
      "default",
      "charts",
    ]) {
      expect(
        await sandbox.inspect("create_python_environment", { name }),
        String(name),
      ).toMatchObject({ ok: false });
      expect(
        await sandbox.callTool("create_python_environment", { name }),
        String(name),
      ).toMatchObject({ isError: true });
    }
    expect(calls).toEqual([]);
  });

  it("refuses a Python that is not named by a 3.x version, before anything runs", async () => {
    const { sandbox, calls } = await sandboxWith();

    for (const python of ["latest", "3", "2.7", "--help", "3.12; echo", 3.12])
      expect(
        await sandbox.callTool("create_python_environment", {
          name: "charts",
          python,
        }),
        String(python),
      ).toMatchObject({ isError: true });
    expect(calls).toEqual([]);
  });

  it("removes what it made when the Python or a package cannot be had, and says why", async () => {
    const { sandbox, environment, failing } = await sandboxWith({
      failing: "3.99",
    });

    const noPython = await sandbox.callTool("create_python_environment", {
      name: "future",
      python: "3.99",
    });
    failing.current = "no-such-package";
    const noPackage = await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly", "no-such-package"],
    });

    expect(noPython).toMatchObject({ isError: true });
    expect(said(noPython)).toContain("it went wrong");
    expect(noPackage).toMatchObject({ isError: true });
    expect(said(noPackage)).toContain("it went wrong");
    // Python's own complaint about the container is not the reason.
    expect(said(noPackage)).not.toContain("Failed to find real location");
    expect(await exists(environment("future"))).toBe(false);
    expect(await exists(environment("charts"))).toBe(false);
  });

  it("asks each time, saying what it downloads and what the packages' own code can reach", async () => {
    const { sandbox } = await sandboxWith();

    const asked = await sandbox.inspect("create_python_environment", {
      name: "charts",
      python: "3.12",
      packages: ["plotly"],
    });

    expect(asked).toMatchObject({
      ok: true,
      action: "Create a Python environment",
      target: "charts",
      command: expect.stringContaining("plotly"),
      // Where the call is sent: uv's Python downloads, and the package index.
      destination: "releases.astral.sh and pypi.org",
      detail: expect.stringContaining("only that environment"),
      asksEachTime: true,
    });
    expect(asked).not.toHaveProperty("allowance");
  });
});

describe("installing packages", () => {
  it("installs into the environment named with its own pip, which changes only it and may use the internet", async () => {
    const { sandbox, calls, directory, environment, interpreter, installed } =
      await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });
    calls.length = 0;

    const result = await sandbox.callTool("install_python_package", {
      packages: ["httpx"],
      environment: "charts",
    });

    expect(result).not.toHaveProperty("isError");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      executable: interpreter("charts"),
      arguments: [
        "-m",
        "pip",
        "--no-input",
        "--disable-pip-version-check",
        "install",
        "httpx",
      ],
      confinement: {
        purpose: "python-install",
        read: [join(directory, "python")],
        write: [environment("charts")],
        network: true,
      },
    });
    expect(await installed("charts")).toContain("httpx");
    expect(await installed("default")).toEqual([]);
  });

  it("installs into the default environment when none is named, making it first, and never with uv", async () => {
    const { sandbox, calls, interpreter, installed } = await sandboxWith();

    await sandbox.callTool("install_python_package", { packages: ["httpx"] });

    const pip = pipRuns(calls);
    expect(pip).toHaveLength(1);
    expect(pip[0]?.executable).toBe(interpreter());
    // uv only makes the environment and puts its own packages in.
    expect(
      calls.filter((call) => call.executable === uvProgram).at(-1)?.arguments,
    ).not.toContain("httpx");
    expect(await installed("default")).toEqual(
      expect.arrayContaining(["httpx", "pandas"]),
    );
  });

  it("gives each environment's installs a home of their own, apart from the scripts'", async () => {
    const { sandbox, calls, interpreter } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    await sandbox.callTool("install_python_package", { packages: ["httpx"] });
    await sandbox.callTool("install_python_package", {
      packages: ["httpx"],
      environment: "charts",
    });
    await sandbox.callTool("run_python", { code: "print(1)", network: true });

    const homes = [
      ...pipRuns(calls).map((call) => call.confinement?.home),
      scriptRuns(calls, interpreter())[0]?.confinement?.home,
    ];
    expect(homes.every(Boolean)).toBe(true);
    expect(new Set(homes).size).toBe(3);
  });

  it("refuses names that could be read as options, paths or addresses, before anything runs", async () => {
    const { sandbox, calls } = await sandboxWith();

    for (const name of [
      "--index-url=https://packages.example/simple",
      "-e.",
      "../evil",
      "https://packages.example/evil.whl",
      "C:\\evil.whl",
      "evil @ file:///C:/evil",
      "",
    ]) {
      expect(
        await sandbox.inspect("install_python_package", { packages: [name] }),
        name,
      ).toMatchObject({ ok: false });
      expect(
        await sandbox.callTool("install_python_package", { packages: [name] }),
        name,
      ).toMatchObject({ isError: true });
    }
    expect(calls).toEqual([]);
  });

  it("refuses an environment that does not exist, before anything runs", async () => {
    const { sandbox, calls } = await sandboxWith();

    const result = await sandbox.callTool("install_python_package", {
      packages: ["httpx"],
      environment: "nowhere",
    });

    expect(result).toMatchObject({ isError: true });
    expect(said(result)).toContain("nowhere");
    expect(calls).toEqual([]);
  });

  it("reports a failed install with pip's own words, without Python's complaint about the container", async () => {
    const { sandbox, installed } = await sandboxWith({
      failing: "no-such-package",
    });
    await sandbox.callTool("create_python_environment", { name: "charts" });

    const result = await sandbox.callTool("install_python_package", {
      packages: ["no-such-package"],
      environment: "charts",
    });

    expect(result).toMatchObject({ isError: true });
    expect(said(result)).toContain("it went wrong");
    expect(said(result)).not.toContain("Failed to find real location");
    // A package that failed to install leaves the environment as it was.
    expect(await installed("charts")).toEqual(["pip"]);
  });

  it("asks each time, naming the environment and saying what the packages' own code can reach", async () => {
    const { sandbox } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    const asked = await sandbox.inspect("install_python_package", {
      packages: ["httpx"],
      environment: "charts",
    });

    expect(asked).toMatchObject({
      ok: true,
      target: "httpx, into charts",
      command: expect.stringContaining("pip install httpx"),
      destination: "pypi.org",
      detail: expect.stringContaining("only that environment"),
      asksEachTime: true,
    });
    expect(asked).not.toHaveProperty("allowance");
    // Into the default environment not made yet, Python is fetched too.
    expect(
      await sandbox.inspect("install_python_package", { packages: ["httpx"] }),
    ).toMatchObject({ destination: "releases.astral.sh and pypi.org" });
  });
});

describe("listing environments", () => {
  it("names each with its Python and what is installed in it, without running anything", async () => {
    const { sandbox, calls } = await sandboxWith();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      python: "3.12",
      packages: ["plotly"],
    });
    await sandbox.callTool("run_python", { code: "print(1)" });
    const before = calls.length;

    const listed = said(await sandbox.callTool("list_python_environments", {}));

    expect(calls).toHaveLength(before);
    const [charts] = listed
      .split("\n")
      .filter((line) => line.includes("charts"));
    expect(charts).toContain("3.12");
    expect(charts).toContain("plotly 1.0");
    const [standard] = listed
      .split("\n")
      .filter((line) => line.includes("default"));
    expect(standard).toContain("3.13");
    expect(standard).toContain("pandas 1.0");
  });

  it("says the default environment is made the first time it is used, until it is", async () => {
    const { sandbox, calls } = await sandboxWith();

    const listed = said(await sandbox.callTool("list_python_environments", {}));

    expect(listed).toContain("default");
    expect(listed).toContain("not made yet");
    expect(calls).toEqual([]);
  });

  it("lists with no folder chosen, since environments belong to no workspace", async () => {
    const { sandbox } = await sandboxWith({ workspace: () => undefined });

    expect(await sandbox.inspect("list_python_environments", {})).toMatchObject(
      { ok: true },
    );
    expect(
      await sandbox.callTool("list_python_environments", {}),
    ).not.toHaveProperty("isError");
  });
});

describe("removing an environment", () => {
  it("deletes it, and scripts can no longer run in it", async () => {
    const { sandbox, calls, environment } = await sandboxWith();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly"],
    });

    const removed = await sandbox.callTool("remove_python_environment", {
      name: "charts",
    });
    calls.length = 0;
    const run = await sandbox.callTool("run_python", {
      code: "print(1)",
      environment: "charts",
    });

    expect(removed).not.toHaveProperty("isError");
    expect(await exists(environment("charts"))).toBe(false);
    expect(run).toMatchObject({ isError: true });
    expect(calls).toEqual([]);
  });

  it("refuses the default environment, which is reset instead, and one that does not exist", async () => {
    const { sandbox } = await sandboxWith();

    expect(
      await sandbox.inspect("remove_python_environment", { name: "default" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("reset") });
    expect(
      await sandbox.inspect("remove_python_environment", { name: "nowhere" }),
    ).toMatchObject({ ok: false });
  });

  it("asks each time", async () => {
    const { sandbox } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    const asked = await sandbox.inspect("remove_python_environment", {
      name: "charts",
    });

    expect(asked).toMatchObject({
      ok: true,
      target: "charts",
      asksEachTime: true,
    });
    expect(asked).not.toHaveProperty("allowance");
  });
});

describe("resetting an environment", () => {
  it("rebuilds the default environment with its own packages, dropping those added", async () => {
    const { sandbox, installed } = await sandboxWith();
    await sandbox.callTool("install_python_package", { packages: ["httpx"] });

    const reset = await sandbox.callTool("reset_python_environment", {});

    expect(reset).not.toHaveProperty("isError");
    expect(await installed("default")).toContain("pandas");
    expect(await installed("default")).not.toContain("httpx");
  });

  it("rebuilds a named environment with the Python and packages it was made with, leaving the others alone", async () => {
    const { sandbox, calls, installed } = await sandboxWith();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      python: "3.12",
      packages: ["plotly"],
    });
    await sandbox.callTool("install_python_package", {
      packages: ["httpx"],
      environment: "charts",
    });
    await sandbox.callTool("install_python_package", { packages: ["httpx"] });
    calls.length = 0;

    await sandbox.callTool("reset_python_environment", {
      environment: "charts",
    });

    expect(calls[0]?.arguments).toEqual(
      expect.arrayContaining(["--python", "3.12"]),
    );
    expect(await installed("charts")).toEqual(["pip", "plotly"]);
    expect(await installed("default")).toContain("httpx");
  });

  it("refuses one that does not exist, and asks each time", async () => {
    const { sandbox } = await sandboxWith();

    expect(
      await sandbox.inspect("reset_python_environment", {
        environment: "nowhere",
      }),
    ).toMatchObject({ ok: false });
    const asked = await sandbox.inspect("reset_python_environment", {});
    expect(asked).toMatchObject({
      ok: true,
      target: "default",
      destination: "releases.astral.sh and pypi.org",
      asksEachTime: true,
    });
    expect(asked).not.toHaveProperty("allowance");
  });
});

describe("one change at a time", () => {
  it("makes the default environment once when two scripts ask for it together", async () => {
    const { sandbox, calls } = await sandboxWith();

    await Promise.all([
      sandbox.callTool("run_python", { code: "print(1)" }),
      sandbox.callTool("run_python", { code: "print(2)" }),
    ]);

    expect(
      calls.filter(
        (call) => call.executable === uvProgram && call.arguments[0] === "venv",
      ),
    ).toHaveLength(1);
  });

  it("changes an environment once at a time", async () => {
    const { sandbox, running, installed } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    await Promise.all([
      sandbox.callTool("install_python_package", {
        packages: ["httpx"],
        environment: "charts",
      }),
      sandbox.callTool("install_python_package", {
        packages: ["plotly"],
        environment: "charts",
      }),
      sandbox.callTool("reset_python_environment", { environment: "charts" }),
    ]);

    expect(running.most).toBe(1);
    // Whatever the order, the environment is whole.
    expect(await installed("charts")).toContain("pip");
  });
});

describe("the environment kept before environments had names", () => {
  it("is deleted when the default environment is made", async () => {
    const { sandbox, directory } = await sandboxWith();
    await mkdir(join(directory, ".venv", "Scripts"), { recursive: true });
    await writeFile(join(directory, ".venv", "pyvenv.cfg"), "home = C:\\x\n");

    await sandbox.callTool("run_python", { code: "print(1)" });

    expect(await readdir(directory)).not.toContain(".venv");
  });
});
