/**
 * The backup around a program that may change any file in its folder: what
 * is held from a sealed-off one while it runs, and what is recorded once it
 * ends. File recovery is real; holding paths, which Windows does, and
 * finding Git's folder are stand-ins that record what they were
 * asked, since run backups own when they are asked, not how they work.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { ListedFile, ListWorkspace } from "@zhiyin/contract";
import type { HeldPath, ReadOnlyHolds } from "@zhiyin/sandbox";
import { FileRecovery, RunBackups } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const list: ListWorkspace = async (root) => {
  const files = new Map<string, ListedFile>();
  for (const name of await readdir(root)) {
    const found = await stat(join(root, name));
    if (found.isFile())
      files.set(name, { size: found.size, modified: found.mtimeMs });
  }
  return { ok: true, files };
};

/** Holding as Windows would, recording what is held now. */
function holdsRecording(refuse?: string) {
  const heldNow = new Set<string>();
  const holds: Pick<ReadOnlyHolds, "hold"> = {
    async hold(_within, paths) {
      const failed = paths
        .filter(({ path }) => refuse && path.endsWith(refuse))
        .map(({ path }) => ({ path, reason: "Access is denied." }));
      const held = paths
        .filter(({ path }) => !failed.some((each) => each.path === path))
        .map(({ path }) => path);
      for (const path of held) heldNow.add(path);
      return {
        held,
        failed,
        release: async () => {
          for (const path of held) heldNow.delete(path);
        },
      };
    },
  };
  return { holds, heldNow };
}

async function fixture(refuse?: string) {
  const root = await folders.make("zhiyin-run-backups-workspace-");
  const storage = await folders.make("zhiyin-run-backups-store-");
  await writeFile(join(root, "big.parquet"), "b".repeat(200));
  await writeFile(join(root, "notes.txt"), "the person's notes");
  const recording = holdsRecording(refuse);
  const gitConfig: HeldPath = { path: join(root, ".git"), hold: "tree" };
  const runs = new RunBackups(
    new FileRecovery(storage, { list, limits: { totalBytes: 100 } }),
    { holds: recording.holds, programLocations: async () => [gitConfig] },
  );
  const heldNames = () =>
    [...recording.heldNow].map((path) =>
      relative(root, path).replaceAll("\\", "/"),
    );
  return { root, storage, runs, heldNames };
}

describe("a sealed-off run", () => {
  it("is kept from what could not be copied and from Git's folder while it runs, and from nothing once it ends", async () => {
    const { root, runs, heldNames } = await fixture();
    await runs.backUp("run-1", root, "conversation-1");

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });
    const during = heldNames();
    await writeFile(join(root, "made.txt"), "new");
    const changes = await runs.finish("run-1");

    expect(started).toEqual({
      ok: true,
      held: [
        {
          path: "big.parquet",
          reason: expect.stringContaining("undo budget"),
          kind: "uncopied",
        },
        {
          path: ".git",
          reason: expect.stringContaining("Git's records"),
          kind: "git",
        },
      ],
    });
    expect(during.sort()).toEqual([".git", "big.parquet"]);
    expect(heldNames()).toEqual([]);
    expect(changes).toEqual({
      status: "checked",
      files: [{ path: "made.txt", change: "created" }],
    });
  });

  it("may change a file it could not copy when its call names it, and the rest stay held", async () => {
    const { root, runs, heldNames } = await fixture();
    await runs.backUp("run-1", root, "conversation-1");

    await runs.start("run-1", {
      sealed: true,
      writable: ["big.parquet"],
    });

    expect(heldNames()).toEqual([".git"]);
    await runs.finish("run-1");
  });

  it("does not start when a path could not be held, and nothing stays held", async () => {
    const { root, runs, heldNames } = await fixture("big.parquet");
    await runs.backUp("run-1", root, "conversation-1");

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(started).toEqual({
      ok: false,
      reason: expect.stringContaining("big.parquet"),
    });
    expect(heldNames()).toEqual([]);
  });

  it("lets go of what it held when it does not run", async () => {
    const { root, runs, heldNames } = await fixture();
    await runs.backUp("run-1", root, "conversation-1");
    await runs.start("run-1", { sealed: true, writable: [] });

    await runs.discard("run-1");

    expect(heldNames()).toEqual([]);
    expect(await runs.finish("run-1")).toBeUndefined();
  });
});

describe("a shell command", () => {
  it("is held from nothing, its folder copied all the same", async () => {
    const { root, runs, heldNames } = await fixture();
    await runs.backUp("run-1", root, "conversation-1");

    const started = await runs.start("run-1", {
      sealed: false,
      writable: [],
    });
    const during = heldNames();
    await writeFile(join(root, "notes.txt"), "changed by the command");
    const changes = await runs.finish("run-1");

    expect(started).toEqual({ ok: true, held: [] });
    expect(during).toEqual([]);
    expect(changes).toEqual({
      status: "checked",
      files: [{ path: "notes.txt", change: "updated", kept: true }],
    });
  });

  it("says which files it changed were saved before it, so undo can put them back", async () => {
    const { root, runs } = await fixture();
    await runs.backUp("run-1", root, "conversation-1");
    await runs.start("run-1", { sealed: false, writable: [] });

    await writeFile(join(root, "notes.txt"), "changed by the command");
    await writeFile(join(root, "big.parquet"), "c".repeat(300));
    const changes = await runs.finish("run-1");

    // big.parquet did not fit the undo budget, so nothing of it was saved.
    expect(changes).toEqual({
      status: "checked",
      files: [
        { path: "big.parquet", change: "updated" },
        { path: "notes.txt", change: "updated", kept: true },
      ],
    });
  });
});

describe("a run in a folder that cannot be copied", () => {
  it("does not start, saying why", async () => {
    const storage = await folders.make("zhiyin-run-backups-store-");
    const runs = new RunBackups(
      new FileRecovery(storage, {
        list: async () => ({ ok: false, reason: "Too many files to list." }),
      }),
    );
    const root = await folders.make("zhiyin-run-backups-workspace-");

    const backup = await runs.backUp("run-1", root, "conversation-1");
    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(backup).toEqual({ ok: false, reason: "Too many files to list." });
    expect(started).toEqual({ ok: false, reason: "Too many files to list." });
  });
});

describe("a run Zhiyin stopped with", () => {
  it("is weighed at the next start once it began, so going back puts back what it changed", async () => {
    const { root, storage, runs } = await fixture();
    await runs.backUp("run-1", root, "conversation-1");
    await runs.start("run-1", { sealed: false, writable: [] });
    await writeFile(join(root, "notes.txt"), "changed by the command");

    const restarted = new FileRecovery(storage, {
      list,
      limits: { totalBytes: 100 },
    });
    const review = await restarted.review("review", root, [
      {
        id: "run-1",
        action: "Run a command",
        target: "a command",
        status: "running",
        startedAt: "2026-10-31T10:00:00.000Z",
        sequence: 0,
      },
    ]);
    await restarted.restore(review);

    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
  });
});

/**
 * A workspace and a folder outside it a script is given, each with a file
 * too large to copy and a Git folder; Startup folders where the test says.
 */
async function withElsewhere(
  options: {
    readonly refuse?: string;
    readonly startup?: (elsewhere: string) => string;
    readonly listElsewhere?: (call: number) => boolean;
  } = {},
) {
  const root = await folders.make("zhiyin-run-backups-workspace-");
  const elsewhere = await folders.make("zhiyin-run-backups-elsewhere-");
  const storage = await folders.make("zhiyin-run-backups-store-");
  for (const folder of [root, elsewhere]) {
    await writeFile(join(folder, "big.parquet"), "b".repeat(200));
    await writeFile(join(folder, "notes.txt"), "the person's notes");
  }
  let listed = 0;
  const listing: ListWorkspace = async (folder) =>
    folder.toLowerCase() === elsewhere.toLowerCase() &&
    options.listElsewhere &&
    !options.listElsewhere(++listed)
      ? { ok: false, reason: "This folder has too many files." }
      : list(folder);
  const recording = holdsRecording(options.refuse);
  const recovery = new FileRecovery(storage, {
    list: listing,
    limits: { totalBytes: 100 },
  });
  const startup = options.startup?.(elsewhere);
  const runs = new RunBackups(recovery, {
    holds: recording.holds,
    programLocations: async (folder) => [
      { path: join(folder, ".git"), hold: "tree" },
    ],
    startupFolders: () => (startup ? [startup] : []),
  });
  return { root, elsewhere, recovery, runs, heldNow: recording.heldNow };
}

describe("a sealed-off run given a folder outside the workspace", () => {
  it("has that folder copied too, so going back puts back what it changed there with the workspace", async () => {
    const { root, elsewhere, recovery, runs } = await withElsewhere();
    const backup = await runs.backUp("run-1", root, "conversation-1", [
      elsewhere,
    ]);
    await runs.start("run-1", { sealed: true, writable: [] });

    await writeFile(join(root, "notes.txt"), "the script's notes");
    await writeFile(join(elsewhere, "notes.txt"), "the script's, elsewhere");
    await writeFile(join(elsewhere, "made.txt"), "made elsewhere");
    const changes = await runs.finish("run-1");
    const review = await recovery.review("review", root, [
      {
        id: "run-1",
        action: "Run a Python script",
        target: "a script",
        status: "completed",
        sequence: 0,
      },
    ]);
    await recovery.restore(review);

    expect(backup).toMatchObject({ ok: true });
    expect(changes).toEqual({
      status: "checked",
      files: [
        { path: "notes.txt", change: "updated", kept: true },
        { path: join(elsewhere, "made.txt"), change: "created" },
        { path: join(elsewhere, "notes.txt"), change: "updated", kept: true },
      ],
    });
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect(await readFile(join(elsewhere, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
    expect((await readdir(elsewhere)).sort()).toEqual([
      "big.parquet",
      "notes.txt",
    ]);
  });

  it("is kept there from what could not be copied and from its Git folder, each named by its whole path, and from nothing once it ends", async () => {
    const { root, elsewhere, runs, heldNow } = await withElsewhere();
    await runs.backUp("run-1", root, "conversation-1", [elsewhere]);

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });
    const during = [...heldNow];
    await runs.finish("run-1");

    expect(started).toEqual({
      ok: true,
      held: expect.arrayContaining([
        {
          path: "big.parquet",
          reason: expect.stringContaining("undo budget"),
          kind: "uncopied",
        },
        {
          path: join(elsewhere, "big.parquet"),
          reason: expect.stringContaining("undo budget"),
          kind: "uncopied",
        },
        {
          path: join(elsewhere, ".git"),
          reason: expect.stringContaining("Git's records"),
          kind: "git",
        },
      ]),
    });
    expect(during).toEqual(
      expect.arrayContaining([
        join(elsewhere, "big.parquet"),
        join(elsewhere, ".git"),
      ]),
    );
    expect([...heldNow]).toEqual([]);
  });

  it("may change an outside file it could not copy when its call names it by its whole path", async () => {
    const { root, elsewhere, runs, heldNow } = await withElsewhere();
    await runs.backUp("run-1", root, "conversation-1", [elsewhere]);

    await runs.start("run-1", {
      sealed: true,
      writable: [join(elsewhere, "big.parquet")],
    });

    expect([...heldNow]).not.toContain(join(elsewhere, "big.parquet"));
    expect([...heldNow]).toContain(join(root, "big.parquet"));
    await runs.finish("run-1");
  });

  it("is kept from a Startup folder in that folder, whatever its call names", async () => {
    const { root, elsewhere, runs } = await withElsewhere({
      startup: (folder) => join(folder, "Startup"),
    });
    await mkdir(join(elsewhere, "Startup"));
    await runs.backUp("run-1", root, "conversation-1", [elsewhere]);

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [join(elsewhere, "Startup")],
    });

    expect(started).toMatchObject({
      ok: true,
      held: expect.arrayContaining([
        {
          path: join(elsewhere, "Startup"),
          reason: expect.stringContaining("signs in"),
          kind: "startup",
        },
      ]),
    });
    await runs.finish("run-1");
  });

  it("is kept from the folder a missing Startup folder would be made in", async () => {
    const { root, elsewhere, runs } = await withElsewhere({
      startup: (folder) => join(folder, "Start Menu", "Programs", "Startup"),
    });
    await mkdir(join(elsewhere, "Start Menu"));
    await runs.backUp("run-1", root, "conversation-1", [elsewhere]);

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(started).toMatchObject({
      ok: true,
      held: expect.arrayContaining([
        expect.objectContaining({
          path: join(elsewhere, "Start Menu"),
          kind: "startup",
        }),
      ]),
    });
    await runs.finish("run-1");
  });

  it("is kept from the whole folder when the folder is in a Startup folder", async () => {
    const { root, elsewhere, runs } = await withElsewhere({
      startup: (folder) => dirname(folder),
    });
    await runs.backUp("run-1", root, "conversation-1", [elsewhere]);

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(started).toMatchObject({
      ok: true,
      held: expect.arrayContaining([
        expect.objectContaining({ path: elsewhere, kind: "startup" }),
      ]),
    });
    await runs.finish("run-1");
  });

  it("does not start when a path in that folder could not be held, and nothing in any folder stays held", async () => {
    // The stand-in refuses the paths that end as asked: both Git folders.
    const { root, elsewhere, runs, heldNow } = await withElsewhere({
      refuse: ".git",
    });
    await runs.backUp("run-1", root, "conversation-1", [elsewhere]);

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(started).toEqual({
      ok: false,
      reason: expect.stringContaining(".git"),
    });
    expect([...heldNow]).toEqual([]);
  });

  it("says before approval that the folder could not be copied, and still runs with its Git folder held", async () => {
    const { root, elsewhere, runs } = await withElsewhere({
      listElsewhere: () => false,
    });

    const backup = await runs.backUp("run-1", root, "conversation-1", [
      elsewhere,
    ]);
    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(backup).toEqual({
      ok: false,
      reason: expect.stringContaining(elsewhere),
    });
    expect(started).toMatchObject({
      ok: true,
      held: expect.arrayContaining([
        expect.objectContaining({ path: join(elsewhere, ".git") }),
      ]),
    });
    await runs.finish("run-1");
  });

  it("does not start when the folder was copied before approval and cannot be copied again", async () => {
    const { root, elsewhere, runs } = await withElsewhere({
      listElsewhere: (call) => call === 1,
    });
    const backup = await runs.backUp("run-1", root, "conversation-1", [
      elsewhere,
    ]);

    const started = await runs.start("run-1", {
      sealed: true,
      writable: [],
    });

    expect(backup).toMatchObject({ ok: true });
    expect(started).toEqual({
      ok: false,
      reason: expect.stringContaining(elsewhere),
    });
  });
});
