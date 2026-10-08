/**
 * Deleting files, the action a person can least recover from by themselves.
 *
 * The model names the paths and how to delete them: to the Recycle Bin, or
 * permanently for deliberate clean-up. Before anyone is asked, each target is
 * checked with Windows; one the Recycle Bin would not take is shown as a
 * permanent deletion, so the person approves exactly what will happen. Nothing
 * is ever deleted permanently that the approval did not show as permanent.
 */

import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTools, type RecycleBin } from "../src/index.js";

/**
 * Resolved, because the temporary folder can be named by its short 8.3 form
 * (`RUNNER~1`) while the tools pass the Recycle Bin long, resolved paths.
 */
async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zhiyin-delete-")));
  await writeFile(join(root, "notes.md"), "Notes.");
  await writeFile(join(root, "huge.iso"), "A large image.");
  await mkdir(join(root, "build", "cache"), { recursive: true });
  await writeFile(join(root, "build", "app.js"), "built");
  await writeFile(join(root, "build", "cache", "x.bin"), "cached");
  return root;
}

/** A Recycle Bin that takes everything except what it is told it cannot. */
function recycleBin(root: string, refuses: readonly string[] = []) {
  const recycled: string[] = [];
  const bin: RecycleBin = {
    recyclable: async (paths) =>
      new Map(
        paths.map((path) => [
          path,
          !refuses.includes(relative(root, path).replaceAll("\\", "/")),
        ]),
      ),
    recycle: vi.fn(async (path: string) => {
      recycled.push(relative(root, path).replaceAll("\\", "/"));
    }),
  };
  return { bin, recycled };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("delete_file", () => {
  it("moves what the model names to the Recycle Bin, and says so before approval", async () => {
    const root = await workspace();
    const { bin, recycled } = recycleBin(root);
    const tools = new WorkspaceTools(root, { recycleBin: bin });

    const inspection = await tools.inspect("delete_file", {
      paths: ["notes.md"],
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Move notes.md to the Recycle Bin",
      target: "notes.md",
      access: "change",
      scope: "workspace",
      changes: [{ path: "notes.md", change: "recycled" }],
    });
    expect(
      await tools.execute("delete_file", { paths: ["notes.md"] }),
    ).toMatchObject({ ok: true });
    expect(recycled).toEqual(["notes.md"]);
  });

  it("deletes permanently only when asked to, and says it cannot be restored", async () => {
    const root = await workspace();
    const { bin, recycled } = recycleBin(root);
    const tools = new WorkspaceTools(root, { recycleBin: bin });

    const inspection = await tools.inspect("delete_file", {
      paths: ["build"],
      mode: "permanent",
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Delete build permanently",
      changes: [{ path: "build", change: "deleted" }],
    });
    expect(inspection.ok && inspection.detail).toContain(
      "cannot be restored from the Recycle Bin",
    );
    expect(inspection.ok && inspection.detail).toContain("2 files");
    expect(
      await tools.execute("delete_file", {
        paths: ["build"],
        mode: "permanent",
      }),
    ).toMatchObject({ ok: true });
    expect(await exists(join(root, "build"))).toBe(false);
    expect(recycled).toEqual([]);
  });

  it("shows a target the Recycle Bin would not take as a permanent deletion, before anyone approves", async () => {
    const root = await workspace();
    const { bin, recycled } = recycleBin(root, ["huge.iso"]);
    const tools = new WorkspaceTools(root, { recycleBin: bin });

    const inspection = await tools.inspect("delete_file", {
      paths: ["notes.md", "huge.iso"],
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Delete 2 items: 1 to the Recycle Bin, 1 permanently",
      target: "2 items",
      changes: [
        { path: "notes.md", change: "recycled" },
        { path: "huge.iso", change: "deleted" },
      ],
    });
    expect(inspection.ok && inspection.detail).toContain(
      "Windows would not move huge.iso to the Recycle Bin",
    );

    await tools.execute("delete_file", { paths: ["notes.md", "huge.iso"] });
    expect(recycled).toEqual(["notes.md"]);
    expect(await exists(join(root, "huge.iso"))).toBe(false);
  });

  it("shows a target Windows could not answer for as a permanent deletion", async () => {
    const root = await workspace();
    const { bin } = recycleBin(root);
    bin.recyclable = async (paths) =>
      new Map(
        paths
          .filter((path) => !path.endsWith("huge.iso"))
          .map((path) => [path, true]),
      );
    const tools = new WorkspaceTools(root, { recycleBin: bin });

    const inspection = await tools.inspect("delete_file", {
      paths: ["notes.md", "huge.iso"],
    });

    expect(inspection).toMatchObject({
      ok: true,
      changes: [
        { path: "notes.md", change: "recycled" },
        { path: "huge.iso", change: "deleted" },
      ],
    });
    expect(inspection.ok && inspection.detail).toContain(
      "Windows could not confirm that huge.iso would go to the Recycle Bin",
    );
  });

  it("deletes nothing permanently when the Recycle Bin refuses after approval", async () => {
    const root = await workspace();
    const { bin } = recycleBin(root);
    bin.recycle = async () => {
      throw new Error("Operation was aborted");
    };
    const tools = new WorkspaceTools(root, { recycleBin: bin });

    const result = await tools.execute("delete_file", { paths: ["notes.md"] });

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.reason).toContain(
      "notes.md was not deleted: the Recycle Bin did not accept it.",
    );
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("Notes.");
  });

  it("offers only permanent deletion where there is no Recycle Bin to use", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    const inspection = await tools.inspect("delete_file", {
      paths: ["notes.md"],
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Delete notes.md permanently",
      changes: [{ path: "notes.md", change: "deleted" }],
    });
    expect(inspection.ok && inspection.detail).toContain(
      "The Recycle Bin is not available here.",
    );
  });

  it("refuses to delete outside the workspace, the workspace itself, or something absent", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root, {
      recycleBin: recycleBin(root).bin,
    });

    expect(
      await tools.inspect("delete_file", { paths: ["../elsewhere.txt"] }),
    ).toEqual({
      ok: false,
      reason: "Only files and folders inside the workspace can be deleted.",
    });
    expect(await tools.inspect("delete_file", { paths: ["."] })).toEqual({
      ok: false,
      reason: "The workspace folder itself cannot be deleted.",
    });
    expect(
      await tools.inspect("delete_file", { paths: ["missing.txt"] }),
    ).toEqual({
      ok: false,
      reason: "missing.txt does not exist.",
      correctable: true,
    });
    expect(
      await tools.inspect("delete_file", { paths: ["build", "build/app.js"] }),
    ).toEqual({
      ok: false,
      reason: "build/app.js is inside build, which is already being deleted.",
      correctable: true,
    });
  });

  it("asks again when a target changed after it was shown", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root, {
      recycleBin: recycleBin(root).bin,
    });

    const before = await tools.inspect("delete_file", { paths: ["notes.md"] });
    await writeFile(join(root, "notes.md"), "Notes, rewritten since.");
    const after = await tools.inspect("delete_file", { paths: ["notes.md"] });

    expect(before.ok && after.ok).toBe(true);
    expect(before.ok && before.identity).not.toEqual(
      after.ok && after.identity,
    );
  });

  it("is offered only with a workspace", () => {
    expect(new WorkspaceTools().list().map((tool) => tool.name)).not.toContain(
      "delete_file",
    );
  });
});
