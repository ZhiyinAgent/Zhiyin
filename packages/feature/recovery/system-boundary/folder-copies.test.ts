/**
 * A program that may change any file in its folder: the folder is copied
 * before it runs, and what it created, changed or deleted is put back against
 * that copy. Real folders and raw bytes; the listing is a plain walk of the
 * folder, standing in for the one the app hands in.
 */

import { writeFileSync } from "node:fs";
import {
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { ListedFile, ListWorkspace, TaskAction } from "@zhiyin/contract";
import { FileRecovery, type RecoveryLimits } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** Every file in a folder with its size and time of last change. */
const list: ListWorkspace = async (root) => {
  const files = new Map<string, ListedFile>();
  const pending = [root];
  for (let next = pending.pop(); next; next = pending.pop())
    for (const entry of await readdir(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        const found = await stat(path);
        files.set(relative(root, path).replaceAll("\\", "/"), {
          size: found.size,
          modified: found.mtimeMs,
        });
      }
    }
  return { ok: true, files };
};

async function fixture(
  files: Record<string, string | Uint8Array>,
  limits: Partial<RecoveryLimits> = {},
) {
  const root = await folders.make("zhiyin-folder-copy-workspace-");
  const storage = await folders.make("zhiyin-folder-copy-store-");
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  const recovery = new FileRecovery(storage, { list, limits });
  return { root, storage, recovery };
}

/** The record of an action whose program ran in the folder. */
const ran = (id: string): TaskAction => ({
  id,
  action: "Run a Python script",
  target: "a script",
  status: "completed",
  sequence: 0,
});

/** Puts back what the actions changed, as going back does. */
async function goBack(
  recovery: FileRecovery,
  root: string,
  actions: readonly TaskAction[],
) {
  const review = await recovery.review("review", root, actions);
  return { review, result: await recovery.restore(review) };
}

describe("a program's changes to its folder", () => {
  it("are put back: a changed file gets its bytes back, a deleted one is made again and a created one is removed", async () => {
    const { root, recovery } = await fixture({
      "data/table.csv": "a,b\n1,2\n",
      "notes.txt": "the person's notes",
      "keep.txt": "untouched",
    });
    await recovery.copyFolder("run-1", root, "conversation-1");

    await writeFile(join(root, "data/table.csv"), "a,b\n9,9\n");
    await rm(join(root, "notes.txt"));
    await writeFile(join(root, "data/chart.png"), new Uint8Array([1, 2, 3]));
    const changes = await recovery.keepFolderChanges("run-1");
    const { result } = await goBack(recovery, root, [ran("run-1")]);

    expect(changes).toEqual({
      status: "checked",
      files: [
        { path: "data/chart.png", change: "created" },
        { path: "data/table.csv", change: "updated", kept: true },
        { path: "notes.txt", change: "deleted", kept: true },
      ],
    });
    expect(result.files).toEqual(
      expect.arrayContaining([
        { path: "data/chart.png", status: "removed" },
        { path: "data/table.csv", status: "restored" },
        { path: "notes.txt", status: "restored" },
      ]),
    );
    expect(await readFile(join(root, "data/table.csv"), "utf8")).toBe(
      "a,b\n1,2\n",
    );
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect(await readdir(join(root, "data"))).toEqual(["table.csv"]);
  });

  it("are put back to the folder as it was just before the run, when it is copied again then", async () => {
    const { root, recovery } = await fixture({ "notes.txt": "first" });
    await recovery.copyFolder("run-1", root, "conversation-1");
    // The person edits the file while the run waits for approval.
    await writeFile(join(root, "notes.txt"), "the person's edit");
    await recovery.copyFolder("run-1", root, "conversation-1");

    await writeFile(join(root, "notes.txt"), "the program's");
    await recovery.keepFolderChanges("run-1");
    await goBack(recovery, root, [ran("run-1")]);

    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's edit",
    );
  });

  it("are put back across runs, each from the copy taken before it, after a restart too", async () => {
    const { root, storage, recovery } = await fixture({ "notes.txt": "v1" });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "notes.txt"), "v2 is longer");
    await recovery.keepFolderChanges("run-1");

    const restarted = new FileRecovery(storage, { list });
    await restarted.copyFolder("run-2", root, "conversation-1");
    await writeFile(join(root, "notes.txt"), "v3, longer still");
    await restarted.keepFolderChanges("run-2");
    await goBack(restarted, root, [ran("run-2")]);
    const afterOne = await readFile(join(root, "notes.txt"), "utf8");
    await goBack(restarted, root, [ran("run-1")]);

    expect(afterOne).toBe("v2 is longer");
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("v1");
  });

  it("leave a file edited since as it is, as a conflict", async () => {
    const { root, recovery } = await fixture({ "notes.txt": "before" });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "notes.txt"), "the program's");
    await recovery.keepFolderChanges("run-1");

    await writeFile(join(root, "notes.txt"), "the person's later edit");
    const { result } = await goBack(recovery, root, [ran("run-1")]);

    expect(result.files).toEqual([
      expect.objectContaining({ path: "notes.txt", status: "conflict" }),
    ]);
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's later edit",
    );
  });

  it("are put back beside a change the same action declared, each from its own copy", async () => {
    const { root, recovery } = await fixture({
      "scene.blend": "scene before",
      "render.txt": "render before",
    });
    await recovery.prepare(
      "run-1",
      root,
      [{ path: "scene.blend", change: "updated" }],
      "conversation-1",
    );
    await recovery.copyFolder("run-1", root, "conversation-1");

    await writeFile(join(root, "scene.blend"), "scene after");
    await writeFile(join(root, "render.txt"), "render after");
    await recovery.commit("run-1");
    await recovery.keepFolderChanges("run-1");
    await goBack(recovery, root, [
      {
        ...ran("run-1"),
        changes: [{ path: "scene.blend", change: "updated" }],
      },
    ]);

    expect(await readFile(join(root, "scene.blend"), "utf8")).toBe(
      "scene before",
    );
    expect(await readFile(join(root, "render.txt"), "utf8")).toBe(
      "render before",
    );
  });
});

describe("copying a folder", () => {
  it("leaves the largest files past the undo budget uncopied, saying why", async () => {
    const { root, recovery } = await fixture(
      {
        "a.txt": "a".repeat(50),
        "b.txt": "b".repeat(80),
        "huge.bin": "h".repeat(150),
        "d.txt": "d".repeat(130),
      },
      { totalBytes: 250 },
    );

    const copy = await recovery.copyFolder("run-1", root, "conversation-1");

    expect(copy).toEqual({
      ok: true,
      uncopied: [
        {
          path: "d.txt",
          reason: expect.stringContaining("undo budget"),
        },
        {
          path: "huge.bin",
          reason: expect.stringContaining("undo budget"),
        },
      ],
    });
  });

  it("keeps the same contents once, however many files hold them", async () => {
    // Room for 150 bytes; three files of 60 take it once.
    const same = "s".repeat(60);
    const { root, recovery } = await fixture(
      { "one.txt": same, "two.txt": same, "three.txt": same },
      { totalBytes: 150 },
    );

    const copy = await recovery.copyFolder("run-1", root, "conversation-1");

    expect(copy).toEqual({ ok: true, uncopied: [] });
  });

  it("makes room by forgetting what was copied of another folder first", async () => {
    const { root, storage } = await fixture(
      { "a.txt": "a".repeat(100) },
      { totalBytes: 150 },
    );
    const other = await folders.make("zhiyin-folder-copy-other-");
    await writeFile(join(other, "b.txt"), "b".repeat(100));
    const recovery = new FileRecovery(storage, {
      list,
      limits: { totalBytes: 150 },
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.keepFolderChanges("run-1");

    const copy = await recovery.copyFolder("run-2", other, "conversation-2");

    expect(copy).toEqual({ ok: true, uncopied: [] });
  });

  it("lists a change to a file that could not be copied as one that cannot be put back", async () => {
    const { root, recovery } = await fixture(
      { "huge.bin": "h".repeat(150), "small.txt": "small" },
      { totalBytes: 100 },
    );
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "huge.bin"), "x".repeat(160));
    await recovery.keepFolderChanges("run-1");

    const { review } = await goBack(recovery, root, [ran("run-1")]);

    expect(review.files).toEqual([
      {
        path: "huge.bin",
        action: "unknown",
        status: "unprotected",
        reason: expect.stringContaining("undo budget"),
      },
    ]);
    expect(await readFile(join(root, "huge.bin"), "utf8")).toBe(
      "x".repeat(160),
    );
  });

  it("says why when the folder cannot be listed, and records nothing", async () => {
    const root = await folders.make("zhiyin-folder-copy-workspace-");
    const storage = await folders.make("zhiyin-folder-copy-store-");
    const recovery = new FileRecovery(storage, {
      list: async () => ({ ok: false, reason: "Too many files to list." }),
    });

    const copy = await recovery.copyFolder("run-1", root, "conversation-1");

    expect(copy).toEqual({ ok: false, reason: "Too many files to list." });
    expect(await recovery.keepFolderChanges("run-1")).toBeUndefined();
  });

  it("is let go of for an action that did not run, which records nothing", async () => {
    const { root, recovery } = await fixture({ "notes.txt": "before" });
    await recovery.copyFolder("run-1", root, "conversation-1");

    await recovery.discard("run-1");

    expect(await recovery.keepFolderChanges("run-1")).toBeUndefined();
  });
});

describe("a run Zhiyin stopped with", () => {
  it("is weighed at the next start against the copy taken before it, so its changes are put back", async () => {
    const { root, storage, recovery } = await fixture({
      "notes.txt": "the person's notes",
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.copyFolder("run-1", root, "conversation-1", {
      begins: true,
    });
    // The script rewrites the file; Zhiyin stops before the run ends.
    await writeFile(join(root, "notes.txt"), "the script's rewrite");
    await writeFile(join(root, "made.txt"), "made by the script");

    const restarted = new FileRecovery(storage, { list });
    const { review, result } = await goBack(restarted, root, [
      {
        ...ran("run-1"),
        status: "running",
        startedAt: "2026-10-31T10:00:00.000Z",
      },
    ]);

    expect(review.files).toEqual(
      expect.arrayContaining([
        { path: "notes.txt", action: "restore", status: "recoverable" },
        { path: "made.txt", action: "remove", status: "recoverable" },
      ]),
    );
    expect(result.files).toEqual(
      expect.arrayContaining([
        { path: "notes.txt", status: "restored" },
        { path: "made.txt", status: "removed" },
      ]),
    );
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect(await readdir(root)).toEqual(["notes.txt"]);
  });
});

describe("a run after which the folder cannot be listed", () => {
  it("still has each file the copy holds looked at by itself and put back, and says the files it made are not named", async () => {
    const root = await folders.make("zhiyin-folder-copy-workspace-");
    const storage = await folders.make("zhiyin-folder-copy-store-");
    await writeFile(join(root, "a.txt"), "before");
    // A listing that gives up past three files, as one past its cap does.
    const capped: ListWorkspace = async (folder) => {
      const listed = await list(folder);
      return listed.ok && listed.files.size > 3
        ? { ok: false, reason: "This folder has more than 3 files." }
        : listed;
    };
    const recovery = new FileRecovery(storage, { list: capped });
    await recovery.copyFolder("run-1", root, "conversation-1");

    await writeFile(join(root, "a.txt"), "the script's, longer");
    for (const name of ["b.txt", "c.txt", "d.txt"])
      await writeFile(join(root, name), name);
    const changes = await recovery.keepFolderChanges("run-1");
    await goBack(recovery, root, [ran("run-1")]);

    expect(changes).toEqual({
      status: "checked",
      files: [{ path: "a.txt", change: "updated", kept: true }],
      unlisted: expect.stringContaining("more than 3 files"),
    });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("before");
  });
});

describe("a run that went on while a later one ran", () => {
  it("is credited only with what it did: going back on it keeps what the later run changed", async () => {
    const { root, recovery } = await fixture({ "report.md": "v1" });
    await recovery.copyFolder("job-1", root, "conversation-1", {
      begins: true,
    });
    // The job makes a file, then a later turn's script runs.
    await writeFile(join(root, "job.txt"), "made by the job");
    await recovery.copyFolder("run-2", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "report.md"), "turn 2's report");
    await recovery.keepFolderChanges("run-2");
    // The job ends after it.
    const jobChanges = await recovery.keepFolderChanges("job-1");

    await goBack(recovery, root, [ran("job-1")]);

    expect(jobChanges).toEqual({
      status: "checked",
      files: [{ path: "job.txt", change: "created" }],
    });
    expect(await readFile(join(root, "report.md"), "utf8")).toBe(
      "turn 2's report",
    );
    expect(await readdir(root)).toEqual(["report.md"]);
  });

  it("is credited with what it changed before the later run copied the file, and both go back in turn", async () => {
    const { root, recovery } = await fixture({ "report.md": "v1" });
    await recovery.copyFolder("job-1", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "report.md"), "the job's report");
    await recovery.copyFolder("run-2", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "report.md"), "turn 2's report, longer");
    await recovery.keepFolderChanges("run-2");
    await recovery.keepFolderChanges("job-1");

    await goBack(recovery, root, [ran("job-1"), ran("run-2")]);

    expect(await readFile(join(root, "report.md"), "utf8")).toBe("v1");
  });
});

describe("making room for a copy", () => {
  it("keeps a change's copy when the contents it keeps are needed anyway, since letting it go frees nothing", async () => {
    const same = "s".repeat(100);
    const { root, recovery } = await fixture(
      { "x.txt": same, "twin.txt": same },
      { totalBytes: 250 },
    );
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "x.txt"), "x".repeat(100));
    await recovery.keepFolderChanges("run-1");

    // The next run's copy needs 151 bytes more than the 100 kept.
    await writeFile(join(root, "new.txt"), "n".repeat(51));
    await recovery.copyFolder("run-2", root, "conversation-1");
    await recovery.discard("run-2");
    const { result } = await goBack(recovery, root, [ran("run-1")]);

    expect(result.files).toEqual([{ path: "x.txt", status: "restored" }]);
    expect(await readFile(join(root, "x.txt"), "utf8")).toBe(same);
  });
});

/** What the store keeps for actions, and the copies taken for runs. */
async function keptFor(storage: string) {
  const store = join(storage, "recovery");
  const shared = new Set(["content", "folders", "runs"]);
  const actions = (await readdir(store)).filter((name) => !shared.has(name));
  const runs = await readdir(join(store, "runs")).catch(() => []);
  return { actions, runs };
}

describe("a copy taken for a run that never began", () => {
  it("is let go of at the next start, as Zhiyin stopped while the run awaited approval", async () => {
    const { root, storage, recovery } = await fixture({
      "notes.txt": "the person's notes",
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    // Zhiyin stops while the run awaits approval; the person edits after.
    await writeFile(join(root, "notes.txt"), "the person's later notes");

    const restarted = new FileRecovery(storage, { list });
    await restarted.cleanup();

    expect(await keptFor(storage)).toEqual({ actions: [], runs: [] });
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's later notes",
    );
  });

  it("is let go of when the run is declined, and nothing of it is found at the next start", async () => {
    const { root, storage, recovery } = await fixture({ "notes.txt": "notes" });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.discard("run-1");
    await writeFile(join(root, "notes.txt"), "the person's edit");

    const restarted = new FileRecovery(storage, { list });
    await restarted.cleanup();

    expect(await keptFor(storage)).toEqual({ actions: [], runs: [] });
  });
});

describe("a job Zhiyin stopped with while later runs ended", () => {
  it("is credited at the next start only with what it did: undoing its turn keeps what a later run changed", async () => {
    const { root, storage, recovery } = await fixture({ "report.md": "v1" });
    await recovery.copyFolder("job-1", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "job.txt"), "made by the job");
    await recovery.copyFolder("run-2", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "report.md"), "turn 2's report");
    await recovery.keepFolderChanges("run-2");
    // Zhiyin stops while the job goes on.

    const restarted = new FileRecovery(storage, { list });
    await goBack(restarted, root, [
      {
        ...ran("job-1"),
        status: "running",
        startedAt: "2026-10-31T10:00:00.000Z",
      },
    ]);

    expect(await readFile(join(root, "report.md"), "utf8")).toBe(
      "turn 2's report",
    );
    expect(await readdir(root)).toEqual(["report.md"]);
    // Once the job is recorded, nothing is kept for its credit.
    expect((await keptFor(storage)).runs).toEqual([]);
  });
});

describe("a job that ends while a later run awaits approval", () => {
  it("is credited with all it did when that run is declined", async () => {
    const { root, recovery } = await fixture({ "keep.txt": "kept" });
    await recovery.copyFolder("job-1", root, "conversation-1", {
      begins: true,
    });
    await recovery.copyFolder("run-2", root, "conversation-1");
    await rm(join(root, "keep.txt"));
    await writeFile(join(root, "made.txt"), "made by the job");
    const changes = await recovery.keepFolderChanges("job-1");
    await recovery.discard("run-2");

    await goBack(recovery, root, [ran("job-1")]);

    expect(changes).toEqual({
      status: "checked",
      files: [
        { path: "keep.txt", change: "deleted", kept: true },
        { path: "made.txt", change: "created" },
      ],
    });
    expect(await readdir(root)).toEqual(["keep.txt"]);
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("kept");
  });

  it("is credited with all it did when that run is approved, and the run with only its own", async () => {
    const { root, recovery } = await fixture({
      "keep.txt": "kept",
      "report.md": "v1",
    });
    await recovery.copyFolder("job-1", root, "conversation-1", {
      begins: true,
    });
    await recovery.copyFolder("run-2", root, "conversation-1");
    await rm(join(root, "keep.txt"));
    await recovery.keepFolderChanges("job-1");
    await recovery.copyFolder("run-2", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "report.md"), "turn 2's report");
    const runChanges = await recovery.keepFolderChanges("run-2");

    await goBack(recovery, root, [ran("job-1")]);

    expect(runChanges).toEqual({
      status: "checked",
      files: [{ path: "report.md", change: "updated", kept: true }],
    });
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("kept");
    expect(await readFile(join(root, "report.md"), "utf8")).toBe(
      "turn 2's report",
    );
  });
});

describe("a run record that is not one", () => {
  it("is let go of at the next start, and copies and going back work as before", async () => {
    const { root, storage } = await fixture({ "notes.txt": "notes" });
    await mkdir(join(storage, "recovery", "runs"), { recursive: true });
    await writeFile(join(storage, "recovery", "runs", "odd.json"), "{}");

    const restarted = new FileRecovery(storage, { list });
    const copy = await restarted.copyFolder("run-1", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "notes.txt"), "changed by the script");
    await restarted.keepFolderChanges("run-1");
    await goBack(restarted, root, [ran("run-1")]);

    expect(copy).toEqual({ ok: true, uncopied: [] });
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("notes");
    expect((await keptFor(storage)).runs).toEqual([]);
  });
});

describe("a folder outside the workspace the program is given", () => {
  /** A workspace, and a folder outside it holding the person's files. */
  async function withElsewhere() {
    const made = await fixture({ "notes.txt": "the person's notes" });
    const elsewhere = await folders.make("zhiyin-folder-copy-elsewhere-");
    await writeFile(join(elsewhere, "table.csv"), "a,b\n1,2\n");
    await writeFile(join(elsewhere, "old.txt"), "kept elsewhere");
    return { ...made, elsewhere };
  }

  it("is copied beside the workspace, and going back puts back what the program changed in both, outside files by their whole paths", async () => {
    const { root, recovery, elsewhere } = await withElsewhere();
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
      outside: true,
    });

    await writeFile(join(root, "notes.txt"), "the script's notes");
    await writeFile(join(elsewhere, "table.csv"), "a,b\n9,9\n");
    await rm(join(elsewhere, "old.txt"));
    await writeFile(join(elsewhere, "chart.png"), new Uint8Array([1, 2, 3]));
    const changes = await recovery.keepFolderChanges("run-1");
    const { result } = await goBack(recovery, root, [ran("run-1")]);

    expect(changes).toEqual({
      status: "checked",
      files: [
        { path: "notes.txt", change: "updated", kept: true },
        { path: join(elsewhere, "chart.png"), change: "created" },
        { path: join(elsewhere, "old.txt"), change: "deleted", kept: true },
        { path: join(elsewhere, "table.csv"), change: "updated", kept: true },
      ],
    });
    expect(result.files.map((file) => file.status).sort()).toEqual([
      "removed",
      "restored",
      "restored",
      "restored",
    ]);
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect(await readFile(join(elsewhere, "table.csv"), "utf8")).toBe(
      "a,b\n1,2\n",
    );
    expect(await readFile(join(elsewhere, "old.txt"), "utf8")).toBe(
      "kept elsewhere",
    );
    expect((await readdir(elsewhere)).sort()).toEqual(["old.txt", "table.csv"]);
  });

  it("leaves the workspace inside it to the workspace's copy, so a file there is recorded once, by its path in the workspace", async () => {
    const elsewhere = await folders.make("zhiyin-folder-copy-elsewhere-");
    const root = join(elsewhere, "project");
    await mkdir(root);
    await writeFile(join(root, "notes.txt"), "notes");
    await writeFile(join(elsewhere, "beside.txt"), "beside");
    const storage = await folders.make("zhiyin-folder-copy-store-");
    const recovery = new FileRecovery(storage, { list });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
      outside: true,
      without: [root],
    });

    await writeFile(join(root, "notes.txt"), "the script's notes");
    await writeFile(join(elsewhere, "beside.txt"), "the script's");
    const changes = await recovery.keepFolderChanges("run-1");

    expect(changes).toEqual({
      status: "checked",
      files: [
        { path: "notes.txt", change: "updated", kept: true },
        { path: join(elsewhere, "beside.txt"), change: "updated", kept: true },
      ],
    });
  });

  it("is weighed with the workspace at the next start when Zhiyin stopped during the run, so both are put back", async () => {
    const { root, storage, recovery, elsewhere } = await withElsewhere();
    await recovery.copyFolder("run-1", root, "conversation-1", {
      begins: true,
    });
    await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
      begins: true,
      outside: true,
    });
    await writeFile(join(root, "notes.txt"), "the script's rewrite");
    await writeFile(join(elsewhere, "table.csv"), "rewritten by the script");

    const restarted = new FileRecovery(storage, { list });
    await goBack(restarted, root, [
      {
        ...ran("run-1"),
        status: "running",
        startedAt: "2026-10-31T10:00:00.000Z",
      },
    ]);

    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect(await readFile(join(elsewhere, "table.csv"), "utf8")).toBe(
      "a,b\n1,2\n",
    );
  });

  it("is let go of with the workspace's at the next start when the run never began", async () => {
    const { root, storage, recovery, elsewhere } = await withElsewhere();
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
      outside: true,
    });
    await writeFile(join(elsewhere, "table.csv"), "the person's later edit");

    const restarted = new FileRecovery(storage, { list });
    await restarted.cleanup();

    expect(await keptFor(storage)).toEqual({ actions: [], runs: [] });
    expect(await readFile(join(elsewhere, "table.csv"), "utf8")).toBe(
      "the person's later edit",
    );
  });

  it("counts the run begun at the next start when only the workspace's copy was taken as it began, recording what that copy covers", async () => {
    const { root, storage, recovery, elsewhere } = await withElsewhere();
    await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
      outside: true,
    });
    await recovery.copyFolder("run-1", root, "conversation-1", {
      begins: true,
    });
    await writeFile(join(root, "notes.txt"), "the script's rewrite");

    const restarted = new FileRecovery(storage, { list });
    await goBack(restarted, root, [
      {
        ...ran("run-1"),
        status: "running",
        startedAt: "2026-10-31T10:00:00.000Z",
      },
    ]);

    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect((await keptFor(storage)).runs).toEqual([]);
  });

  it("is let go of with the workspace's when the run is declined", async () => {
    const { root, storage, recovery, elsewhere } = await withElsewhere();
    await recovery.copyFolder("run-1", root, "conversation-1");
    await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
      outside: true,
    });

    await recovery.discard("run-1");

    expect(await keptFor(storage)).toEqual({ actions: [], runs: [] });
    expect(await recovery.keepFolderChanges("run-1")).toBeUndefined();
  });
});

describe("files that only work together", () => {
  it("are each held and checked before any is put back, so a write to one while the others are held leaves all of them", async () => {
    const root = await folders.make("zhiyin-folder-copy-group-");
    const storage = await folders.make("zhiyin-folder-copy-group-store-");
    await writeFile(join(root, "results.db"), "the database before");
    await writeFile(join(root, "results.db-wal"), "the log before");
    let racing = false;
    const recovery = new FileRecovery(storage, {
      list,
      // Another program writes the log just as Zhiyin holds the database.
      restoreCalls: (files) => ({
        ...files,
        openShared: (path) => {
          const handle = files.openShared(path);
          if (racing && path.endsWith("results.db")) {
            racing = false;
            writeFileSync(join(root, "results.db-wal"), "the person's log");
          }
          return handle;
        },
      }),
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "results.db"), "the database after");
    await writeFile(join(root, "results.db-wal"), "the log after");
    await recovery.keepFolderChanges("run-1");
    const review = await recovery.review("review", root, [ran("run-1")]);

    racing = true;
    const result = await recovery.restore(review);

    expect(result.files.map(({ path, status }) => [path, status])).toEqual([
      ["results.db", "conflict"],
      ["results.db-wal", "conflict"],
    ]);
    expect(await readFile(join(root, "results.db"), "utf8")).toBe(
      "the database after",
    );
    expect(await readFile(join(root, "results.db-wal"), "utf8")).toBe(
      "the person's log",
    );
    expect(
      (await readdir(root)).filter((name) =>
        /\.(restore|previous)$/.test(name),
      ),
    ).toEqual([]);
  });

  it("are left as they were when Windows refuses to put one back after another was, the first undone", async () => {
    const root = await folders.make("zhiyin-folder-copy-undo-");
    const storage = await folders.make("zhiyin-folder-copy-undo-store-");
    await writeFile(join(root, "results.db"), "the database before");
    await writeFile(join(root, "results.db-wal"), "the log before");
    await writeFile(join(root, "results.db-shm"), "the index before");
    const recovery = new FileRecovery(storage, {
      list,
      restoreCalls: (files) => ({
        ...files,
        replace: (target, replacement, previous) =>
          target.endsWith("-wal") && replacement.endsWith(".restore")
            ? false
            : files.replace(target, replacement, previous),
      }),
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "results.db"), "the database after");
    await writeFile(join(root, "results.db-wal"), "the log after");
    await rm(join(root, "results.db-shm"));
    await writeFile(join(root, "results.db-journal"), "a journal made");
    await recovery.keepFolderChanges("run-1");

    const { result } = await goBack(recovery, root, [ran("run-1")]);

    expect(
      Object.fromEntries(
        result.files.map(({ path, status }) => [path, status]),
      ),
    ).toEqual({
      "results.db": "conflict",
      "results.db-journal": "conflict",
      "results.db-shm": "conflict",
      "results.db-wal": "unprotected",
    });
    expect(
      Object.fromEntries(
        await Promise.all(
          (await readdir(root))
            .sort()
            .map(async (name) => [
              name,
              await readFile(join(root, name), "utf8"),
            ]),
        ),
      ),
    ).toEqual({
      "results.db": "the database after",
      "results.db-journal": "a journal made",
      "results.db-wal": "the log after",
    });
  });

  it("are put back together: a SQLite database with its write-ahead log", async () => {
    const { root, recovery } = await fixture({
      "results.db": "the database before",
      "results.db-wal": "the log before",
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    await writeFile(join(root, "results.db"), "the database after");
    await writeFile(join(root, "results.db-wal"), "the log after");
    await recovery.keepFolderChanges("run-1");

    const { result } = await goBack(recovery, root, [ran("run-1")]);

    expect(result.files).toEqual([
      { path: "results.db", status: "restored" },
      { path: "results.db-wal", status: "restored" },
    ]);
    expect(await readFile(join(root, "results.db"), "utf8")).toBe(
      "the database before",
    );
  });

  it("are left as they are, all of them, when one of them changed since", async () => {
    const { root, recovery } = await fixture({
      "results.db": "the database before",
      "results.db-wal": "the log before",
      "scan.zarr/.zarray": "the array before",
      "scan.zarr/0.0": "a chunk before",
    });
    await recovery.copyFolder("run-1", root, "conversation-1");
    for (const path of [
      "results.db",
      "results.db-wal",
      "scan.zarr/.zarray",
      "scan.zarr/0.0",
    ])
      await writeFile(join(root, path), `${path} after`);
    await recovery.keepFolderChanges("run-1");
    const review = await recovery.review("review", root, [ran("run-1")]);
    // The person's programs go on writing each group's second file.
    await writeFile(join(root, "results.db-wal"), "the person's log");
    await writeFile(join(root, "scan.zarr/0.0"), "the person's chunk");

    const result = await recovery.restore(review);

    expect(result.files.map(({ path, status }) => [path, status])).toEqual([
      ["results.db", "conflict"],
      ["results.db-wal", "conflict"],
      ["scan.zarr/.zarray", "conflict"],
      ["scan.zarr/0.0", "conflict"],
    ]);
    expect(await readFile(join(root, "results.db"), "utf8")).toBe(
      "results.db after",
    );
    expect(await readFile(join(root, "scan.zarr/.zarray"), "utf8")).toBe(
      "scan.zarr/.zarray after",
    );
  });
});
