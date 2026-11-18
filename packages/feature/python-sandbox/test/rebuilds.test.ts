/**
 * What happens to an environment Zhiyin keeps when a release ships other
 * package versions, and when making one fails: a working environment is never
 * lost before its replacement is whole, and the packages a person added are
 * never removed without saying so.
 */

import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultLock,
  pythonEnvironments,
  pythonSandbox,
} from "../src/index.js";
import { folders, sandboxWith, uvProgram } from "./fake-programs.js";
import { parts } from "./kept-fixture.js";

afterEach(() => folders.removeAll());

/** A lock as an earlier release shipped it: an older date, one package fewer. */
function earlier(lock: typeof defaultLock, dropped: string) {
  return {
    ...lock,
    publishedBy: "2026-01-01T00:00:00Z",
    asked: lock.asked.filter((name) => name !== dropped),
    locked: lock.locked.filter((entry) => entry.name !== dropped),
  };
}

async function setUp(failing?: string) {
  const made = await sandboxWith(failing ? { failing } : {});
  const sandboxFrom = (locks: { lock?: typeof defaultLock } = {}) =>
    pythonSandbox({
      workspaceRoot: () => made.workspace,
      directory: made.directory,
      uv: async () => uvProgram,
      run: made.run,
      keptEnvironments: [parts],
      ...locks,
    });
  /** How many times uv made the environment named `name` from nothing. */
  const madeTimes = (name: string) =>
    made.calls.filter(
      (call) =>
        call.executable === uvProgram &&
        call.arguments[0] === "venv" &&
        call.arguments.at(-1) === made.environment(name),
    ).length;
  return { ...made, sandboxFrom, madeTimes };
}

const dropped = defaultLock.asked.at(-1)!;

describe("an environment from an earlier release", () => {
  it("keeps the default environment working, with the packages the person added, and says reset brings the new versions", async () => {
    const { sandboxFrom, installed, madeTimes } = await setUp();
    const before = sandboxFrom({ lock: earlier(defaultLock, dropped) });
    await before.callTool("run_python", { code: "print(1)" });
    await before.callTool("install_python_package", {
      packages: ["geopandas"],
    });

    const after = sandboxFrom();
    const ran = await after.callTool("run_python", { code: "print(2)" });
    const asked = await after.inspect("run_python", { code: "print(3)" });
    const listed = await after.callTool("list_python_environments", {});

    expect(ran).not.toHaveProperty("isError");
    expect(madeTimes("default")).toBe(1);
    expect(await installed("default")).toContain("geopandas");
    expect(asked.ok && asked.detail).not.toContain("first");
    expect(JSON.stringify(listed)).toContain(
      "default — made from the package versions of an earlier Zhiyin; reset_python_environment brings it to this release's, without the packages added to it since.",
    );
  });
});

describe("making an environment again", () => {
  it("keeps the old environment when a reset cannot download the new one", async () => {
    const { sandboxFrom, failing, madeTimes } = await setUp();
    const sandbox = sandboxFrom();
    await sandbox.callTool("run_python", { code: "print(1)" });
    failing.current = "venv";

    const reset = (await sandbox.callTool("reset_python_environment", {})) as {
      isError?: boolean;
    };
    failing.current = undefined;
    const ran = await sandbox.callTool("run_python", { code: "print(2)" });

    expect(reset.isError).toBe(true);
    expect(ran).not.toHaveProperty("isError");
    // Made once, then the reset that failed: the script ran in the old one.
    expect(madeTimes("default")).toBe(2);
  });

  it("finds the old environment again after Zhiyin stopped while making a new one", async () => {
    const { sandboxFrom, directory, madeTimes } = await setUp();
    await sandboxFrom().callTool("run_python", { code: "print(1)" });
    // As a build leaves it when the app stops partway: the old environment
    // set aside, a new one begun and not finished.
    const environments = join(directory, "environments");
    await rename(
      join(environments, "default"),
      join(environments, "default.previous"),
    );
    await rename(
      join(environments, "default.json"),
      join(environments, "default.previous.json"),
    );
    await mkdir(join(environments, "default"));
    await writeFile(
      join(environments, "default.json"),
      JSON.stringify({ python: "3.13", packages: [], ready: false }),
    );

    const ran = await sandboxFrom().callTool("run_python", {
      code: "print(2)",
    });

    expect(ran).not.toHaveProperty("isError");
    expect(madeTimes("default")).toBe(1);
    await expect(
      stat(join(environments, "default.previous")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("an environment its connector makes", () => {
  it("takes no package the model adds, saying why as its feature does", async () => {
    const { sandboxFrom, installed, directory, run } = await setUp();
    const sandbox = sandboxFrom();
    await pythonEnvironments({
      directory,
      uv: async () => uvProgram,
      run,
      keptEnvironments: [parts],
    })
      .kept.installation("parts")
      .install();

    const added = await sandbox.callTool("install_python_package", {
      packages: ["trimesh"],
      environment: "parts",
    });

    expect(added).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "“parts” is the parts studio's environment",
          ),
        },
      ],
    });
    expect(await installed("parts")).not.toContain("trimesh");
  });

  it("names an environment by its name the person made before Zhiyin kept one as theirs, with its packages, before it is replaced", async () => {
    const { sandboxFrom, directory } = await setUp();
    const environments = join(directory, "environments");
    await mkdir(join(environments, "parts", "Scripts"), { recursive: true });
    await writeFile(join(environments, "parts", "Scripts", "python.exe"), "");
    await writeFile(
      join(environments, "parts.json"),
      JSON.stringify({ python: "3.12", packages: ["cadquery"], ready: true }),
    );
    const sandbox = sandboxFrom();

    const listed = await sandbox.callTool("list_python_environments", {});
    const asked = await sandbox.inspect("run_python", {
      code: "import solids",
      environment: "parts",
    });

    expect(JSON.stringify(listed)).toContain(
      "parts — your own environment, made with Python 3.12 and cadquery before Zhiyin kept one by this name. Installing the Parts studio connector replaces it.",
    );
    expect(asked).toMatchObject({
      ok: false,
      reason: expect.stringContaining(
        "made when the Parts studio connector is installed",
      ),
    });
    await rm(join(environments, "parts"), { recursive: true, force: true });
  });
});
