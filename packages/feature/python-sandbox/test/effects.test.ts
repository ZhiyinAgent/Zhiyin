/**
 * What each call declares it does (ADR 0012), true for that very call: what
 * it reads, changes and sends, the code it runs, and whether it leaves
 * something that runs later.
 */

import { afterEach, describe, expect, it } from "vitest";
import { pythonSandbox } from "../src/index.js";
import { folders, sandboxWith, uvProgram } from "./fake-programs.js";

afterEach(() => folders.removeAll());

const nothing = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
} as const;

/** A sandbox whose default environment is already made. */
async function made() {
  const sandbox = await sandboxWith();
  await sandbox.sandbox.callTool("run_python", { code: "print(0)" });
  return sandbox;
}

describe("a script", () => {
  it("runs sealed, reading the workspace and changing it in a way Zhiyin can put back, sending nothing when it cannot use the internet", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("run_python", { code: "print(1)" });

    expect(asked).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "workspace",
        changes: "workspace",
        runs: "sealed",
      },
    });
  });

  it("sends where it chooses when it names hosts", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("run_python", {
      code: "print(1)",
      hosts: ["api.example.com"],
    });

    expect(asked).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "workspace",
        changes: "workspace",
        sends: "chosen",
        runs: "sealed",
        // What it fetches from those hosts is anyone's words, and it prints
        // what it likes of it.
        brings: "outside",
      },
    });
  });

  it("sends to the fixed download sites when its environment is first made, though the script cannot use the internet", async () => {
    const { sandbox } = await sandboxWith();

    const asked = await sandbox.inspect("run_python", { code: "print(1)" });

    expect(asked).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "workspace",
        changes: "workspace",
        sends: "service",
        runs: "sealed",
      },
    });
  });

  it("reads and changes elsewhere when given folders outside the workspace, which Zhiyin copies first as it does the workspace", async () => {
    const made = await sandboxWith();
    const elsewhere = await folders.make("zhiyin-sandbox-elsewhere-");
    const own = await folders.make("zhiyin-sandbox-own-");
    const sandbox = pythonSandbox({
      workspaceRoot: () => made.workspace,
      directory: made.directory,
      uv: async () => uvProgram,
      run: made.run,
      protect: [own],
    });
    await sandbox.callTool("run_python", { code: "print(0)" });

    const asked = await sandbox.inspect("run_python", {
      code: "print(1)",
      outside_folders: [elsewhere],
    });

    expect(asked).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "elsewhere",
        changes: "elsewhere",
        runs: "sealed",
      },
      changesAnyFile: { outside: [elsewhere] },
    });
  });
  it("changes the workspace for good, naming the file, when let change a file Zhiyin could not copy, which no grant for scripts covers", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("run_python", {
      code: "print(1)",
      change_locked: ["data/big.parquet"],
    });

    expect(asked).not.toHaveProperty("allowance");
    expect(asked).toMatchObject({
      ok: true,
      detail: expect.stringContaining("data/big.parquet"),
      effects: {
        ...nothing,
        reads: "workspace",
        changes: "workspace-for-good",
        runs: "sealed",
      },
      changesAnyFile: { writable: ["data/big.parquet"] },
    });
  });

  it("may change any file in the workspace, which is copied before it runs", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("run_python", { code: "print(1)" });

    expect(asked).toMatchObject({
      ok: true,
      changesAnyFile: { writable: [], unheldBy: "change_locked" },
    });
  });

  it("is refused when it names a file to change in Git's folder", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("run_python", {
      code: "print(1)",
      change_locked: [".git/config"],
    });

    expect(asked).toMatchObject({ ok: false });
  });
});

describe("the Python environments", () => {
  it("are read by listing them, which changes and sends nothing", async () => {
    const { sandbox } = await sandboxWith();

    expect(await sandbox.inspect("list_python_environments", {})).toMatchObject(
      { ok: true, effects: { ...nothing, reads: "app" } },
    );
  });

  it("are changed for good by installing a package, whose own code runs sealed as it installs and in every later script", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("install_python_package", {
      packages: ["httpx"],
    });

    expect(asked).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "app",
        changes: "app",
        sends: "service",
        runs: "sealed",
        lasting: true,
      },
    });
  });

  it("gain one made from the fixed download sites, running the code of the packages it is made with", async () => {
    const { sandbox } = await sandboxWith();

    const bare = await sandbox.inspect("create_python_environment", {
      name: "charts",
    });
    const withPackages = await sandbox.inspect("create_python_environment", {
      name: "plots",
      packages: ["plotly"],
    });

    expect(bare).toMatchObject({
      ok: true,
      effects: { ...nothing, changes: "app", sends: "service", lasting: true },
    });
    expect(withPackages).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        changes: "app",
        sends: "service",
        runs: "sealed",
        lasting: true,
      },
    });
  });

  it("are rebuilt from the fixed download sites, running the code only of packages Zhiyin does not pin", async () => {
    const { sandbox } = await made();
    await sandbox.callTool("create_python_environment", {
      name: "charts",
      packages: ["plotly"],
    });

    const pinned = await sandbox.inspect("reset_python_environment", {});
    const chosen = await sandbox.inspect("reset_python_environment", {
      environment: "charts",
    });

    expect(pinned).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "app",
        changes: "app",
        sends: "service",
        lasting: true,
      },
    });
    expect(chosen).toMatchObject({
      ok: true,
      effects: {
        ...nothing,
        reads: "app",
        changes: "app",
        sends: "service",
        runs: "sealed",
        lasting: true,
      },
    });
  });

  it("lose one by removing it, which leaves nothing to run later", async () => {
    const { sandbox } = await made();
    await sandbox.callTool("create_python_environment", { name: "charts" });

    const asked = await sandbox.inspect("remove_python_environment", {
      name: "charts",
    });

    expect(asked).toMatchObject({
      ok: true,
      effects: { ...nothing, reads: "app", changes: "app" },
    });
  });
});

describe("what a package call shows the person", () => {
  it("lists each package and the environment in words, then the command that installs them", async () => {
    const { sandbox } = await made();

    const asked = await sandbox.inspect("install_python_package", {
      packages: ["httpx", "rich==13.7.1"],
    });

    expect(asked.ok && asked.invocation?.arguments).toEqual([
      { name: "Packages", value: "httpx\nrich==13.7.1", readable: true },
      { name: "Environment", value: "default", readable: true },
      {
        name: "Command",
        value: "python -m pip install httpx rich==13.7.1",
        runs: true,
      },
    ]);
  });

  it("shows a new environment by its name and the packages it is made with", async () => {
    const { sandbox } = await sandboxWith();

    const asked = await sandbox.inspect("create_python_environment", {
      name: "plots",
      packages: ["plotly"],
    });

    expect(asked.ok && asked.invocation?.arguments).toEqual(
      expect.arrayContaining([
        { name: "Environment", value: "plots", readable: true },
        { name: "Packages", value: "plotly", readable: true },
      ]),
    );
  });
});
