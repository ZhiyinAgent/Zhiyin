import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { folders, sandboxWith, uvProgram, type Call } from "./fake-programs.js";

afterEach(() => folders.removeAll());

type Result = { isError?: boolean; content: { text: string }[] };
const said = (result: unknown) =>
  (result as Result).content.map((part) => part.text).join("\n");

const tsinghua = "https://pypi.tuna.tsinghua.edu.cn/simple";
const npmmirror =
  "https://registry.npmmirror.com/-/binary/python-build-standalone";

/** What uv and pip were asked to do, in order, with where they were sent. */
function fetches(calls: readonly Call[]) {
  return calls.flatMap((call) => {
    const args = call.arguments;
    const step =
      call.executable === uvProgram && args[0] === "venv"
        ? "make"
        : call.executable === uvProgram && args[0] === "pip"
          ? "install the lock"
          : args[0] === "-m" && args[1] === "pip"
            ? "pip install"
            : undefined;
    if (!step) return [];
    const index = args.includes("--default-index")
      ? args[args.indexOf("--default-index") + 1]
      : args.includes("--index-url")
        ? args[args.indexOf("--index-url") + 1]
        : "default";
    return [
      {
        step,
        index,
        ...(step === "make"
          ? {
              python: call.environment["UV_PYTHON_INSTALL_MIRROR"] ?? "default",
            }
          : {}),
      },
    ];
  });
}

describe("when the sites Python and packages come from cannot be reached", () => {
  it("makes an environment again from the mirrors, its Python from npmmirror and pip and its packages from Tsinghua's index", async () => {
    const { sandbox, calls, unreachable, installed } = await sandboxWith();
    unreachable.original = true;

    const made = await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly"],
    });

    expect(said(made)).toBe(
      "Created the Python environment “charts” with Python 3.13 and plotly.",
    );
    expect(fetches(calls)).toEqual([
      { step: "make", index: "default", python: "default" },
      { step: "make", index: tsinghua, python: npmmirror },
      { step: "pip install", index: "default" },
      { step: "pip install", index: tsinghua },
    ]);
    expect(await installed("charts")).toEqual(["pip", "plotly"]);
  });

  it("installs the default packages from Tsinghua's index, each file still checked against the lock", async () => {
    const { sandbox, calls, unreachable } = await sandboxWith();
    unreachable.original = true;

    const ran = await sandbox.callTool("run_python", { code: "print(1)" });

    expect((ran as Result).isError).toBeUndefined();
    const locked = calls.filter(
      (call) =>
        call.executable === uvProgram &&
        call.arguments[0] === "pip" &&
        call.arguments.includes(tsinghua),
    );
    expect(locked).toHaveLength(1);
    expect(locked[0]!.arguments).toEqual(
      expect.arrayContaining(["--require-hashes", "--no-build"]),
    );
  });

  it("adds a package the model asks for from the mirror", async () => {
    const { sandbox, calls, unreachable, installed } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });
    unreachable.original = true;
    calls.length = 0;

    const added = await sandbox.callTool("install_python_package", {
      packages: ["httpx"],
      environment: "charts",
    });

    expect((added as Result).isError).toBeUndefined();
    expect(fetches(calls)).toEqual([
      { step: "pip install", index: "default" },
      { step: "pip install", index: tsinghua },
    ]);
    expect(await installed("charts")).toEqual(["httpx", "pip"]);
  });

  it("keeps the environment it was rebuilding when the mirrors cannot be reached either", async () => {
    const { sandbox, unreachable, installed, environment } =
      await sandboxWith();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly"],
    });
    unreachable.original = true;
    unreachable.mirrors = true;

    const reset = await sandbox.callTool("reset_python_environment", {
      environment: "charts",
    });

    expect((reset as Result).isError).toBe(true);
    expect(said(reset)).toContain(
      "The Python environment “charts” could not be created.",
    );
    expect(await installed("charts")).toEqual(["pip", "plotly"]);
    expect(await readdir(environment("charts"))).toContain("Scripts");
  });

  it("does not ask the mirrors when a step failed for another reason", async () => {
    const { sandbox, calls } = await sandboxWith({ failing: "plotly" });
    await sandbox.callTool("create_python_environment", { name: "charts" });
    calls.length = 0;

    await sandbox.callTool("install_python_package", {
      packages: ["plotly"],
      environment: "charts",
    });

    expect(fetches(calls)).toEqual([{ step: "pip install", index: "default" }]);
  });
});

describe("what an approval says of the mirrors", () => {
  it("names the mirror an install's package names may go to, after the package index", async () => {
    const { sandbox } = await sandboxWith();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    const asked = await sandbox.inspect("install_python_package", {
      packages: ["httpx"],
      environment: "charts",
    });

    expect(asked).toMatchObject({
      ok: true,
      destinations: ["pypi.org", "pypi.tuna.tsinghua.edu.cn"],
    });
  });

  it("names every place making an environment may download from, the mirrors and the hosts they send downloads on to included", async () => {
    const { sandbox } = await sandboxWith();

    const asked = await sandbox.inspect("create_python_environment", {
      name: "bare",
    });

    expect(asked).toMatchObject({
      ok: true,
      detail: expect.stringContaining(
        "Making it can download Python from releases.astral.sh, or from github.com through release-assets.githubusercontent.com, and pip from pypi.org through files.pythonhosted.org. When those cannot be reached, it downloads Python from registry.npmmirror.com through cdn.npmmirror.com, and pip from pypi.tuna.tsinghua.edu.cn.",
      ),
    });
    expect(asked).not.toHaveProperty("destinations");
  });
});
