import {
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileRecovery } from "../src/index.js";
import { recreateExclusively } from "../src/exclusive-restore.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function fixture() {
  const root = await folders.make("zhiyin-recovery-workspace-");
  const storage = await folders.make("zhiyin-recovery-store-");
  const recovery = new FileRecovery(storage, {
    now: () => new Date("2026-09-07T10:00:00.000Z"),
  });
  return { root, storage, recovery };
}

/** The folders kept for actions, one each. */
async function keptFolders(storage: string): Promise<string[]> {
  return readdir(join(storage, "recovery")).catch(() => []);
}

// Real files and real processes, so these are slow by design rather than by
// accident. The default per-test patience is tuned for unit tests and is not
// enough for them once the rest of the suite is running alongside.
describe("FileRecovery", { timeout: 30_000 }, () => {
  it("restores replaced bytes and removes a newly created file", async () => {
    const { root, recovery } = await fixture();
    await mkdir(join(root, "notes"));
    await writeFile(
      join(root, "notes", "existing.txt"),
      Buffer.from([0, 1, 2]),
    );

    const prepared = await recovery.prepare(
      "action-1",
      root,
      [
        { path: "notes/existing.txt", change: "updated" },
        { path: "notes/created.txt", change: "created" },
      ],
      "conversation-1",
    );
    expect(prepared.files.map((file) => file.status)).toEqual([
      "protected",
      "protected",
    ]);

    await writeFile(join(root, "notes", "existing.txt"), Buffer.from([3, 4]));
    await writeFile(join(root, "notes", "created.txt"), "created");
    await recovery.commit("action-1");

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed",
        sequence: 0,
        changes: [
          { path: "notes/existing.txt", change: "updated" },
          { path: "notes/created.txt", change: "created" },
        ],
      },
    ]);
    expect(review.files).toEqual([
      { path: "notes/existing.txt", action: "restore", status: "recoverable" },
      { path: "notes/created.txt", action: "remove", status: "recoverable" },
    ]);

    const result = await recovery.restore(review);
    expect(result.files).toEqual([
      { path: "notes/existing.txt", status: "restored" },
      { path: "notes/created.txt", status: "removed" },
    ]);
    expect(await readFile(join(root, "notes", "existing.txt"))).toEqual(
      Buffer.from([0, 1, 2]),
    );
    await expect(
      readFile(join(root, "notes", "created.txt")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("finishes a partially applied restoration after restart", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "one.txt"), "before one");
    await writeFile(join(root, "two.txt"), "before two");
    await recovery.prepare(
      "action-1",
      root,
      [
        { path: "one.txt", change: "updated" },
        { path: "two.txt", change: "updated" },
      ],
      "conversation-1",
    );
    await writeFile(join(root, "one.txt"), "after one");
    await writeFile(join(root, "two.txt"), "after two");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed",
        sequence: 0,
        changes: [
          { path: "one.txt", change: "updated" },
          { path: "two.txt", change: "updated" },
        ],
      },
    ]);

    // The process stopped after this file was restored but before the other
    // file and conversation history were committed.
    await writeFile(join(root, "one.txt"), "before one");
    const result = await recovery.restore(review);

    expect(result.files).toEqual([
      { path: "one.txt", status: "restored" },
      { path: "two.txt", status: "restored" },
    ]);
    expect(await readFile(join(root, "one.txt"), "utf8")).toBe("before one");
    expect(await readFile(join(root, "two.txt"), "utf8")).toBe("before two");
  });

  it("finishes a restoration a restart cut short, from what it kept on disk", async () => {
    const { root, storage, recovery } = await fixture();
    await writeFile(join(root, "one.txt"), Buffer.from([1, 0, 1]));
    await writeFile(join(root, "two.txt"), Buffer.from([2, 0, 2]));
    const changes = [
      { path: "one.txt", change: "updated" as const },
      { path: "two.txt", change: "updated" as const },
    ];
    await recovery.prepare("action-1", root, changes, "conversation-1");
    await writeFile(join(root, "one.txt"), "after one");
    await writeFile(join(root, "two.txt"), "after two");
    await recovery.commit("action-1");
    const action = {
      id: "action-1",
      action: "Edit files",
      target: "2 files",
      status: "completed" as const,
      sequence: 0,
      changes,
    };
    const review = await recovery.review("review-1", root, [action]);
    // Zhiyin closed after the first file went back.
    await writeFile(join(root, "one.txt"), Buffer.from([1, 0, 1]));

    const restarted = new FileRecovery(storage, {
      now: () => new Date("2026-09-07T10:05:00.000Z"),
    });
    const result = await restarted.restore(review);

    expect(result.files).toEqual([
      { path: "one.txt", status: "restored" },
      { path: "two.txt", status: "restored" },
    ]);
    expect(await readFile(join(root, "one.txt"))).toEqual(
      Buffer.from([1, 0, 1]),
    );
    expect(await readFile(join(root, "two.txt"))).toEqual(
      Buffer.from([2, 0, 2]),
    );
    // And what it kept is reviewed again after the restart as before it.
    await writeFile(join(root, "two.txt"), "after two");
    await writeFile(join(root, "one.txt"), "after one");
    expect((await restarted.review("review-2", root, [action])).files).toEqual([
      { path: "one.txt", action: "restore", status: "recoverable" },
      { path: "two.txt", action: "restore", status: "recoverable" },
    ]);
  });

  it("uses a copy only in the workspace it was taken in", async () => {
    const { root, recovery } = await fixture();
    const other = await folders.make("zhiyin-recovery-other-");
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "after");
    await recovery.commit("action-1");
    // Another folder holding a file of the same name, as the action left it.
    await writeFile(join(other, "note.txt"), "after");

    const review = await recovery.review("review-1", other, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    const result = await recovery.restore(review);

    expect(review.files).toMatchObject([
      { path: "note.txt", status: "unprotected" },
    ]);
    expect(result.files).not.toContainEqual(
      expect.objectContaining({ status: "restored" }),
    );
    expect(await readFile(join(other, "note.txt"), "utf8")).toBe("after");
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("after");
  });

  it("keeps no more than its total limit: the oldest copies make room for the newest", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-07T10:00:00.000Z");
    const store = (totalBytes: number) =>
      new FileRecovery(storage, { now: () => now, limits: { totalBytes } });
    const action = (id: string, path: string) => ({
      id,
      action: "Write",
      target: path,
      status: "completed" as const,
      sequence: 0,
      changes: [{ path, change: "updated" as const }],
    });
    const wrote = async (recovery: FileRecovery, id: string, path: string) => {
      await writeFile(join(root, path), "ten bytes!");
      const prepared = await recovery.prepare(
        id,
        root,
        [{ path, change: "updated" }],
        "conversation-1",
      );
      await writeFile(join(root, path), "changed");
      await recovery.commit(id);
      return prepared.files[0];
    };

    const roomy = store(25);
    expect(await wrote(roomy, "action-1", "one.txt")).toMatchObject({
      status: "protected",
    });
    now = new Date("2026-09-07T10:01:00.000Z");
    expect(await wrote(roomy, "action-2", "two.txt")).toMatchObject({
      status: "protected",
    });
    now = new Date("2026-09-07T10:02:00.000Z");
    // Twenty bytes are kept: the oldest copy goes to make room for ten more.
    expect(await wrote(roomy, "action-3", "three.txt")).toMatchObject({
      status: "protected",
    });
    expect(
      (
        await roomy.review("review-1", root, [
          action("action-1", "one.txt"),
          action("action-2", "two.txt"),
          action("action-3", "three.txt"),
        ])
      ).files,
    ).toMatchObject([
      { path: "one.txt", status: "unprotected" },
      { path: "two.txt", status: "recoverable" },
      { path: "three.txt", status: "recoverable" },
    ]);

    // A store started with a lower limit lets the oldest copy go.
    const tight = store(15);
    await tight.cleanup();
    const review = await tight.review("review-2", root, [
      action("action-2", "two.txt"),
      action("action-3", "three.txt"),
    ]);
    expect(review.files).toMatchObject([
      { path: "two.txt", status: "unprotected" },
      { path: "three.txt", status: "recoverable" },
    ]);
  });

  it("takes no copy larger than the whole store can hold", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    const recovery = new FileRecovery(storage, { limits: { totalBytes: 8 } });
    await writeFile(join(root, "big.txt"), "ten bytes!");

    const prepared = await recovery.prepare(
      "action-1",
      root,
      [{ path: "big.txt", change: "updated" }],
      "conversation-1",
    );

    expect(prepared.files).toEqual([
      {
        path: "big.txt",
        status: "unprotected",
        reason: "The recovery storage limit cannot admit this file.",
      },
    ]);
  });

  it("keeps a copy of each change to one file, letting its oldest go once it has its versions", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-07T10:00:00.000Z");
    // Room for two ten-byte copies, and two versions of a file.
    const recovery = new FileRecovery(storage, {
      now: () => now,
      limits: { totalBytes: 25, versionsPerPath: 2 },
    });
    const edits = ["first one!", "second one", "third one!", "now fourth"];
    const statuses: string[] = [];
    for (const [index, before] of edits.slice(0, 3).entries()) {
      now = new Date(Date.parse(now.toISOString()) + 60_000);
      await writeFile(join(root, "note.txt"), before);
      const prepared = await recovery.prepare(
        `action-${index + 1}`,
        root,
        [{ path: "note.txt", change: "updated" }],
        "conversation-1",
      );
      statuses.push(prepared.files[0]!.status);
      await writeFile(join(root, "note.txt"), edits[index + 1]!);
      await recovery.commit(`action-${index + 1}`);
    }

    expect(statuses).toEqual(["protected", "protected", "protected"]);
    const action = (id: string) => ({
      id,
      action: "Write",
      target: "note.txt",
      status: "completed" as const,
      sequence: 0,
      changes: [{ path: "note.txt", change: "updated" as const }],
    });
    const lastTwo = await recovery.review("review-1", root, [
      action("action-2"),
      action("action-3"),
    ]);
    expect(lastTwo.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
    await recovery.restore(lastTwo);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("second one");
  });

  it("keeps the copy of the change just made, even when every change was made at the same moment", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    const recovery = new FileRecovery(storage, {
      now: () => new Date("2026-09-07T10:00:00.000Z"),
      limits: { versionsPerPath: 2 },
    });
    const edits = ["first one!", "second one", "third one!", "now fourth"];
    for (const [index, before] of edits.slice(0, 3).entries()) {
      await writeFile(join(root, "note.txt"), before);
      await recovery.prepare(
        `action-${index + 1}`,
        root,
        [{ path: "note.txt", change: "updated" }],
        "conversation-1",
      );
      await writeFile(join(root, "note.txt"), edits[index + 1]!);
      await recovery.commit(`action-${index + 1}`);
    }
    const action = (id: string) => ({
      id,
      action: "Write",
      target: "note.txt",
      status: "completed" as const,
      sequence: 0,
      changes: [{ path: "note.txt", change: "updated" as const }],
    });

    const lastOne = await recovery.review("review-1", root, [
      action("action-3"),
    ]);
    expect(lastOne.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
    const lastTwo = await recovery.review("review-2", root, [
      action("action-2"),
      action("action-3"),
    ]);
    expect(lastTwo.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
    await recovery.restore(lastTwo);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("second one");
  });

  it("keeps the copy of a change approved after waiting longer than copies are kept", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-07T10:00:00.000Z");
    const recovery = new FileRecovery(storage, { now: () => now });
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );

    now = new Date("2026-10-09T10:00:00.000Z");
    await writeFile(join(root, "note.txt"), "after");
    await recovery.commit("action-1");

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
  });

  it("no longer counts the copy of an action that did not run against the total", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-07T10:00:00.000Z");
    // Room for two ten-byte copies.
    const recovery = new FileRecovery(storage, {
      now: () => now,
      limits: { totalBytes: 25 },
    });
    const change = async (id: string, path: string, run: boolean) => {
      now = new Date(Date.parse(now.toISOString()) + 60_000);
      await writeFile(join(root, path), "ten bytes!");
      await recovery.prepare(
        id,
        root,
        [{ path, change: "updated" }],
        "conversation-1",
      );
      if (!run) return recovery.discard(id);
      await writeFile(join(root, path), "changed");
      await recovery.commit(id);
    };
    await change("action-1", "one.txt", true);
    await change("declined", "two.txt", false);
    await change("action-2", "three.txt", true);

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "one.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "one.txt", change: "updated" }],
      },
      {
        id: "action-2",
        action: "Write",
        target: "three.txt",
        status: "completed",
        sequence: 1,
        changes: [{ path: "three.txt", change: "updated" }],
      },
    ]);
    expect(review.files).toMatchObject([
      { path: "one.txt", status: "recoverable" },
      { path: "three.txt", status: "recoverable" },
    ]);
    expect(await keptFolders(storage)).toHaveLength(2);
  });

  it("gives the reason no copy was taken, not another folder, for a file that had none", async () => {
    const first = await folders.make("zhiyin-recovery-first-");
    const second = await folders.make("zhiyin-recovery-second-");
    const storage = await folders.make("zhiyin-recovery-store-");
    const recovery = new FileRecovery(storage, { limits: { fileBytes: 4 } });
    await writeFile(join(first, "big.txt"), "more than four bytes");
    await recovery.prepare(
      "action-1",
      first,
      [{ path: "big.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(first, "big.txt"), "changed");
    await recovery.commit("action-1");

    const review = await recovery.review("review-1", second, [
      {
        id: "action-1",
        action: "Write",
        target: "big.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "big.txt", change: "updated" }],
      },
    ]);

    expect(review.files).toEqual([
      {
        path: "big.txt",
        action: "unknown",
        status: "unprotected",
        reason: "The existing file exceeds the 10 MiB recovery limit.",
      },
    ]);
  });

  it("puts back a file from the copy taken in this folder, whatever was changed elsewhere under the same name", async () => {
    const first = await folders.make("zhiyin-recovery-first-");
    const second = await folders.make("zhiyin-recovery-second-");
    const { recovery } = await fixture();
    const change = async (id: string, folder: string) => {
      await writeFile(join(folder, "notes.md"), `before in ${id}`);
      await recovery.prepare(
        id,
        folder,
        [{ path: "notes.md", change: "updated" }],
        "conversation-1",
      );
      await writeFile(join(folder, "notes.md"), "changed");
      await recovery.commit(id);
    };
    await change("action-1", first);
    await change("action-2", second);
    const action = (id: string, sequence: number) => ({
      id,
      action: "Write",
      target: "notes.md",
      status: "completed" as const,
      sequence,
      changes: [{ path: "notes.md", change: "updated" as const }],
    });

    const review = await recovery.review("review-1", second, [
      action("action-1", 0),
      action("action-2", 1),
    ]);
    expect(review.files).toEqual([
      { path: "notes.md", action: "restore", status: "recoverable" },
    ]);
    await recovery.restore(review);

    expect(await readFile(join(second, "notes.md"), "utf8")).toBe(
      "before in action-2",
    );
    expect(await readFile(join(first, "notes.md"), "utf8")).toBe("changed");
  });

  describe("a change made in another folder, with no copy kept", () => {
    async function twoFolders() {
      const first = await folders.make("zhiyin-recovery-first-");
      const second = await folders.make("zhiyin-recovery-second-");
      const { recovery } = await fixture();
      const prepare = async (id: string, folder: string) => {
        await writeFile(join(folder, "notes.md"), `before in ${id}`);
        await recovery.prepare(
          id,
          folder,
          [{ path: "notes.md", change: "updated" }],
          "conversation-1",
        );
        await writeFile(join(folder, "notes.md"), "changed");
      };
      const change = async (id: string, folder: string) => {
        await prepare(id, folder);
        await recovery.commit(id);
      };
      const action = (id: string, sequence: number, folder?: string) => ({
        id,
        action: "Write",
        target: "notes.md",
        status: "completed" as const,
        startedAt: "2026-09-07T10:00:00.000Z",
        sequence,
        changes: [{ path: "notes.md", change: "updated" as const }],
        ...(folder ? { folder } : {}),
      });
      return { first, second, recovery, prepare, change, action };
    }

    it("leaves this folder's copy to put back when the other folder's record is gone", async () => {
      const { first, second, recovery, change, action } = await twoFolders();
      await change("action-1", first);
      await recovery.discard("action-1");
      await change("action-2", second);

      const review = await recovery.review("review-1", second, [
        action("action-1", 0, first),
        action("action-2", 1, second),
      ]);

      expect(review.files).toEqual([
        { path: "notes.md", action: "restore", status: "recoverable" },
      ]);
    });

    it("leaves this folder's copy to put back when the change there was cut short by a crash", async () => {
      const { first, second, recovery, prepare, change, action } =
        await twoFolders();
      await prepare("action-1", first);
      await change("action-2", second);

      const review = await recovery.review("review-1", second, [
        { ...action("action-1", 0), status: "cancelled" as const },
        action("action-2", 1, second),
      ]);

      expect(review.files).toEqual([
        { path: "notes.md", action: "restore", status: "recoverable" },
      ]);
    });

    it("puts nothing back when a change with no copy may have been made in this folder", async () => {
      const { second, recovery, change, action } = await twoFolders();
      await change("action-1", second);
      await recovery.discard("action-1");
      await change("action-2", second);

      for (const earlier of [
        action("action-1", 0, second),
        action("action-1", 0),
      ])
        expect(
          (
            await recovery.review("review-1", second, [
              earlier,
              action("action-2", 1, second),
            ])
          ).files,
        ).toMatchObject([{ path: "notes.md", status: "unprotected" }]);
    });
  });

  it("lists a file an action cut short by a closing app may have changed, with no copy to put back", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "notes.md"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "notes.md", change: "updated" }],
      "conversation-1",
    );

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "notes.md",
        status: "cancelled",
        startedAt: "2026-09-07T10:00:00.000Z",
        sequence: 0,
        changes: [{ path: "notes.md", change: "updated" }],
      },
    ]);

    expect(review.files).toMatchObject([
      { path: "notes.md", status: "unprotected" },
    ]);
  });

  it("refuses a copy for room only when copies of changes still waiting to run fill the store", async () => {
    const { root, storage } = await fixture();
    // Room for two ten-byte copies.
    const recovery = new FileRecovery(storage, { limits: { totalBytes: 25 } });
    const prepare = async (id: string, path: string) => {
      await writeFile(join(root, path), "ten bytes!");
      return (
        await recovery.prepare(
          id,
          root,
          [{ path, change: "updated" }],
          "conversation-1",
        )
      ).files[0];
    };

    expect(await prepare("waiting-1", "one.txt")).toMatchObject({
      status: "protected",
    });
    expect(await prepare("waiting-2", "two.txt")).toMatchObject({
      status: "protected",
    });
    expect(await prepare("waiting-3", "three.txt")).toEqual({
      path: "three.txt",
      status: "unprotected",
      reason: "The recovery storage limit cannot admit this file.",
    });
  });

  it("leaves nothing behind when copies cannot all be taken", async () => {
    const { root, storage, recovery } = await fixture();
    await writeFile(join(root, "one.txt"), "readable");
    await writeFile(join(root, "two.txt"), "held");
    const lockerScript = join(root, "..", `locker-${Date.now()}.ps1`);
    await writeFile(
      lockerScript,
      "param([string]$Target)\n$s=[IO.File]::Open($Target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)\n[Console]::Out.WriteLine('locked')\n[Console]::Out.Flush()\nStart-Sleep -Seconds 30\n$s.Dispose()",
    );
    const locker = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        lockerScript,
        "-Target",
        join(root, "two.txt"),
      ],
      { windowsHide: true },
    );
    await new Promise<void>((resolve, reject) => {
      locker.once("error", reject);
      locker.stdout.once("data", () => resolve());
    });
    try {
      await expect(
        recovery.prepare(
          "action-1",
          root,
          [
            { path: "one.txt", change: "updated" },
            { path: "two.txt", change: "updated" },
          ],
          "conversation-1",
        ),
      ).rejects.toThrow();
    } finally {
      locker.kill();
      await rm(lockerScript, { force: true });
    }

    expect(await keptFolders(storage)).toEqual([]);
  });

  it("says a copy was taken in another folder, and which, rather than that none was kept", async () => {
    const { root, recovery } = await fixture();
    const moved = await folders.make("zhiyin-recovery-moved-");
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "after");
    await recovery.commit("action-1");

    const review = await recovery.review("review-1", moved, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);

    expect(review.files).toEqual([
      {
        path: "note.txt",
        action: "unknown",
        status: "unprotected",
        reason: `The copy of this file was taken in ${await realpath(root)}, not in the folder this conversation is in now.`,
      },
    ]);
  });

  it("reviews no file of an action that never began running, and still puts back one that did", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare(
      "write-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "the agent's notes");
    await recovery.commit("write-1");
    // Declined: its copy was thrown away, and it never ran.
    await recovery.prepare(
      "write-2",
      root,
      [
        { path: "note.txt", change: "updated" },
        { path: "other.txt", change: "created" },
      ],
      "conversation-1",
    );
    await recovery.discard("write-2");
    const action = (
      id: string,
      status: "completed" | "denied",
      paths: string[],
    ) => ({
      id,
      action: "Write",
      target: paths[0]!,
      status,
      sequence: 0,
      ...(status === "completed"
        ? { startedAt: "2026-09-07T10:00:00.000Z" }
        : {}),
      changes: paths.map((path) => ({ path, change: "updated" as const })),
    });

    const review = await recovery.review("review-1", root, [
      action("write-1", "completed", ["note.txt"]),
      action("write-2", "denied", ["note.txt", "other.txt"]),
    ]);

    expect(review.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
    await recovery.restore(review);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("before");
  });

  it("takes no copy in a folder that is gone, and says the folder is why", async () => {
    const { recovery } = await fixture();
    const gone = join(tmpdir(), "zhiyin-recovery-folder-that-was-moved");

    const prepared = await recovery.prepare(
      "write-1",
      gone,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );

    expect(prepared.files).toEqual([
      {
        path: "note.txt",
        status: "unprotected",
        reason:
          "The conversation's folder could not be opened, so no copy was taken.",
      },
    ]);
  });

  it("reviews a conversation whose folder is gone without failing, every file without a copy to put back", async () => {
    const { recovery } = await fixture();
    const gone = join(tmpdir(), "zhiyin-recovery-folder-that-was-moved");

    const review = await recovery.review("review-1", gone, [
      {
        id: "write-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);

    expect(review.files).toEqual([
      {
        path: "note.txt",
        action: "unknown",
        status: "unprotected",
        reason: "The conversation's folder could not be opened.",
      },
    ]);
  });

  it("serves change after change from a store of thousands of kept actions without reading them all again", async () => {
    const { root, storage } = await fixture();
    const kept = join(storage, "recovery");
    await mkdir(kept, { recursive: true });
    const realRoot = await realpath(root);
    for (let index = 0; index < 3_000; index += 1) {
      const folder = join(kept, `kept-${index}`);
      await mkdir(folder);
      await writeFile(
        join(folder, "manifest.json"),
        JSON.stringify({
          version: 1,
          actionId: `old-${index}`,
          conversationId: "conversation-1",
          workspaceRoot: realRoot,
          createdAt: "2026-09-07T09:00:00.000Z",
          phase: "committed",
          files: [
            {
              path: `f${index}.txt`,
              status: "protected",
              before: "absent",
              after: "file",
              afterDigest: "x",
            },
          ],
        }),
      );
    }
    const recovery = new FileRecovery(storage, {
      now: () => new Date("2026-09-07T10:00:00.000Z"),
    });
    const change = async (id: string) => {
      await writeFile(join(root, "note.txt"), id);
      await recovery.prepare(
        id,
        root,
        [{ path: "note.txt", change: "updated" }],
        "conversation-1",
      );
      await recovery.validate(id);
      await writeFile(join(root, "note.txt"), `${id} changed`);
      await recovery.commit(id);
    };
    await change("warm");

    const started = performance.now();
    for (let index = 0; index < 5; index += 1) await change(`change-${index}`);
    const each = (performance.now() - started) / 5;

    expect(each).toBeLessThan(60);
  });

  it("puts back a file the work deleted, and the folder it was in", async () => {
    const { root, recovery } = await fixture();
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "plan.md"), "the plan");
    await writeFile(join(root, "budget.csv"), "a,b\n1,2\n");
    const changes = [
      { path: "notes/plan.md", change: "recycled" as const },
      { path: "budget.csv", change: "deleted" as const },
    ];
    await recovery.prepare("action-1", root, changes, "conversation-1");
    await rm(join(root, "notes"), { recursive: true });
    await rm(join(root, "budget.csv"));
    await recovery.commit("action-1");

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Delete files",
        target: "2 files",
        status: "completed",
        sequence: 0,
        changes,
      },
    ]);
    expect(review.files).toEqual([
      { path: "notes/plan.md", action: "restore", status: "recoverable" },
      { path: "budget.csv", action: "restore", status: "recoverable" },
    ]);

    const result = await recovery.restore(review);
    expect(result.files).toEqual([
      { path: "notes/plan.md", status: "restored" },
      { path: "budget.csv", status: "restored" },
    ]);
    expect(await readFile(join(root, "notes", "plan.md"), "utf8")).toBe(
      "the plan",
    );
    expect(await readFile(join(root, "budget.csv"), "utf8")).toBe("a,b\n1,2\n");
  });

  it("leaves a file made again at a deleted path in place", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "plan.md"), "the plan");
    const changes = [{ path: "plan.md", change: "deleted" as const }];
    await recovery.prepare("action-1", root, changes, "conversation-1");
    await rm(join(root, "plan.md"));
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Delete files",
        target: "plan.md",
        status: "completed",
        sequence: 0,
        changes,
      },
    ]);

    // Someone writes a new file there after the review was shown.
    await writeFile(join(root, "plan.md"), "a new plan");
    const result = await recovery.restore(review);

    expect(result.files).toMatchObject([
      { path: "plan.md", status: "conflict" },
    ]);
    expect(await readFile(join(root, "plan.md"), "utf8")).toBe("a new plan");
  });

  it("never makes a deleted file again over one that has taken its place", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "kept.bin"), "the kept copy");
    await writeFile(join(root, "plan.md"), "a new plan");

    await expect(
      recreateExclusively({
        absolute: join(root, "plan.md"),
        backup: join(root, "kept.bin"),
      }),
    ).rejects.toThrow();
    expect(await readFile(join(root, "plan.md"), "utf8")).toBe("a new plan");
    expect(
      (await readdir(root)).filter((name) => name.endsWith(".restore")),
    ).toEqual([]);
  });

  it("puts back as it is a file already as it was, as after an undo another file stopped partway", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "back.txt"), "before");
    await writeFile(join(root, "held.txt"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [
        { path: "back.txt", change: "updated" },
        { path: "held.txt", change: "updated" },
      ],
      "conversation-1",
    );
    await writeFile(join(root, "back.txt"), "agent result");
    await writeFile(join(root, "held.txt"), "agent result");
    await recovery.commit("action-1");
    // The first undo put one file back; the other was left as the work left it.
    await writeFile(join(root, "back.txt"), "before");
    const actions = [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed" as const,
        sequence: 0,
        changes: [
          { path: "back.txt", change: "updated" as const },
          { path: "held.txt", change: "updated" as const },
        ],
      },
    ];

    const review = await recovery.review("review-1", root, actions);
    const result = await recovery.restore(review);

    expect(review.files.map((file) => file.status)).toEqual([
      "recoverable",
      "recoverable",
    ]);
    expect(result.files.map((file) => file.status)).toEqual([
      "restored",
      "restored",
    ]);
    expect(await readFile(join(root, "back.txt"), "utf8")).toBe("before");
    expect(await readFile(join(root, "held.txt"), "utf8")).toBe("before");
  });

  it("refuses to overwrite a file changed after the recorded action", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "agent result");
    await recovery.commit("action-1");
    await writeFile(join(root, "note.txt"), "newer user edit");

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write file",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(review.files[0]).toMatchObject({
      path: "note.txt",
      status: "conflict",
    });
    const result = await recovery.restore(review);
    expect(result.files[0]).toMatchObject({ status: "conflict" });
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe(
      "newer user edit",
    );
  });

  it("gives a file as it was before the first action and as the last one left it, and refuses once it has changed since", async () => {
    const { root, recovery } = await fixture();
    const compiled = (id: string) => ({
      id,
      action: "Compile document",
      target: "paper.pdf",
      status: "completed" as const,
      sequence: 0,
      changes: [{ path: "paper.pdf", change: "updated" as const }],
    });
    await writeFile(join(root, "paper.pdf"), Buffer.from([0, 1, 2]));
    for (const [id, bytes] of [
      ["compile-1", [3, 4]],
      ["compile-2", [5, 6, 7]],
    ] as const) {
      await recovery.prepare(id, root, compiled(id).changes, "conversation-1");
      await writeFile(join(root, "paper.pdf"), Buffer.from(bytes));
      await recovery.commit(id);
    }
    const actions = [compiled("compile-1"), compiled("compile-2")];

    expect(await recovery.versions(root, actions, "paper.pdf")).toEqual({
      ok: true,
      before: new Uint8Array([0, 1, 2]),
      after: new Uint8Array([5, 6, 7]),
    });

    await writeFile(join(root, "paper.pdf"), "edited afterwards");
    expect(await recovery.versions(root, actions, "paper.pdf")).toEqual({
      ok: false,
      reason:
        "paper.pdf has changed since, so the change can no longer be shown.",
    });
  });

  it("gives a created file with nothing before it, and says when no copy was kept", async () => {
    const { root, recovery } = await fixture();
    const action = {
      id: "compile-1",
      action: "Compile document",
      target: "2 files",
      status: "completed" as const,
      sequence: 0,
      changes: [
        { path: "paper.pdf", change: "created" as const },
        { path: "large.pdf", change: "updated" as const },
      ],
    };
    await writeFile(join(root, "large.pdf"), Buffer.alloc(11 * 1024 * 1024));
    await recovery.prepare(action.id, root, action.changes, "conversation-1");
    await writeFile(join(root, "paper.pdf"), Buffer.from([1]));
    await writeFile(join(root, "large.pdf"), Buffer.from([2]));
    await recovery.commit(action.id);

    expect(await recovery.versions(root, [action], "paper.pdf")).toEqual({
      ok: true,
      after: new Uint8Array([1]),
    });
    expect(await recovery.versions(root, [action], "large.pdf")).toEqual({
      ok: false,
      reason: "The existing file exceeds the 10 MiB recovery limit.",
    });
  });

  it("marks undeclared and oversized effects as unprotected", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "large.txt"), Buffer.alloc(11 * 1024 * 1024));
    const prepared = await recovery.prepare(
      "action-1",
      root,
      [
        { path: "../outside.txt", change: "updated" },
        { path: "large.txt", change: "updated" },
      ],
      "conversation-1",
    );
    expect(prepared.files).toEqual([
      expect.objectContaining({
        path: "../outside.txt",
        status: "unprotected",
      }),
      expect.objectContaining({ path: "large.txt", status: "unprotected" }),
    ]);
  });

  it("invalidates a capture when its source changes before execution", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "note.txt"), "reviewed");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "changed while waiting");
    await expect(recovery.validate("action-1")).resolves.toMatchObject({
      ok: false,
    });
  });

  /*
   * A folder that stops accepting changes while a new letter waits for
   * approval is Windows refusing access. Nothing has left the workspace, and
   * the reason must not say it has.
   */
  it("says Windows denied access, not that a path left the workspace", async () => {
    const { root, recovery } = await fixture();
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "letter.md", change: "created" }],
      "conversation-1",
    );
    const who = `${process.env["USERDOMAIN"]}\\${process.env["USERNAME"]}`;
    const icacls = (...args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const run = spawn("icacls", [root, ...args], { windowsHide: true });
        run.on("error", reject);
        run.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`icacls exited ${code}`)),
        );
      });
    // Write access denied on the whole folder.
    await icacls("/deny", `${who}:(W)`);
    try {
      const checked = await recovery.validate("action-1");

      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.reason).toBe(
        "Windows denied access to letter.md.",
      );
    } finally {
      await icacls("/remove:d", who);
    }
  });

  it("expires old captures and keeps only the configured versions per path", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-01T10:00:00.000Z");
    const recovery = new FileRecovery(storage, {
      now: () => now,
      limits: { versionsPerPath: 1, maximumAgeMs: 24 * 60 * 60 * 1000 },
    });
    await writeFile(join(root, "note.txt"), "zero");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "one");
    await recovery.commit("action-1");

    now = new Date("2026-09-01T11:00:00.000Z");
    await recovery.prepare(
      "action-2",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "two");
    await recovery.commit("action-2");
    const versionReview = await recovery.review("versions", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(versionReview.files[0]).toMatchObject({ status: "unprotected" });

    now = new Date("2026-09-03T12:00:00.000Z");
    await recovery.cleanup();
    const ageReview = await recovery.review("age", root, [
      {
        id: "action-2",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(ageReview.files[0]).toMatchObject({ status: "unprotected" });
  });

  it("removes an action's folder once none of its copies remain", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-01T10:00:00.000Z");
    const recovery = new FileRecovery(storage, {
      now: () => now,
      limits: { versionsPerPath: 1 },
    });
    await writeFile(join(root, "note.txt"), "zero");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "one");
    await recovery.commit("action-1");
    expect(await keptFolders(storage)).toHaveLength(1);

    now = new Date("2026-09-01T11:00:00.000Z");
    await recovery.prepare(
      "action-2",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "two");
    await recovery.commit("action-2");

    expect(await keptFolders(storage)).toHaveLength(1);
    const review = await recovery.review("review-1", root, [
      {
        id: "action-2",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
  });

  it("removes everything kept for an action past the age limit, a created file's record included", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let now = new Date("2026-09-01T10:00:00.000Z");
    const recovery = new FileRecovery(storage, {
      now: () => now,
      limits: { maximumAgeMs: 24 * 60 * 60 * 1000 },
    });
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "new.txt", change: "created" }],
      "conversation-1",
    );
    await writeFile(join(root, "new.txt"), "made by the action");
    await recovery.commit("action-1");

    now = new Date("2026-09-03T10:00:00.000Z");
    await recovery.cleanup();

    expect(await keptFolders(storage)).toEqual([]);
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "new.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "new.txt", change: "created" }],
      },
    ]);
    expect(review.files).toEqual([
      {
        path: "new.txt",
        action: "unknown",
        status: "unprotected",
        reason:
          "No copy of this file is kept: none was taken, or it was removed by the storage limits.",
      },
    ]);
  });

  it("leaves no partial record behind when an action's record cannot be written", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    const recovery = new FileRecovery(storage, {
      // The record's place holds a folder, which no file replaces.
      beforeManifest: async () => {
        const [folder] = await readdir(join(storage, "recovery"));
        const record = join(storage, "recovery", folder!, "manifest.json");
        await mkdir(record);
        await writeFile(join(record, "blocker"), "");
      },
    });
    await writeFile(join(root, "notes.txt"), "before");

    await expect(
      recovery.prepare(
        "action-1",
        root,
        [{ path: "notes.txt", change: "updated" }],
        "conversation-1",
      ),
    ).rejects.toThrow();

    expect(await keptFolders(storage)).toEqual([]);
  });

  it("leaves alone the copies of an action still being prepared when it cleans up", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    let copied!: () => void;
    const copiesTaken = new Promise<void>((resolve) => (copied = resolve));
    let write!: () => void;
    const manifestHeld = new Promise<void>((resolve) => (write = resolve));
    const recovery = new FileRecovery(storage, {
      now: () => new Date("2026-09-07T10:00:00.000Z"),
      beforeManifest: async () => {
        copied();
        await manifestHeld;
      },
    });
    await writeFile(join(root, "notes.txt"), "before");

    const preparing = recovery.prepare(
      "action-1",
      root,
      [{ path: "notes.txt", change: "updated" }],
      "conversation-1",
    );
    await copiesTaken;
    await recovery.cleanup();
    write();
    await preparing;
    await writeFile(join(root, "notes.txt"), "after");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit notes",
        target: "notes.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "notes.txt", change: "updated" }],
      },
    ]);
    const result = await recovery.restore(review);

    expect(result.files).toEqual([{ path: "notes.txt", status: "restored" }]);
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("before");
  });

  it("removes a folder left without its record", async () => {
    const { storage, recovery } = await fixture();
    const leftBehind = join(storage, "recovery", "left-behind");
    await mkdir(leftBehind, { recursive: true });
    await writeFile(join(leftBehind, "0.bin"), "a copy nothing names");

    await recovery.cleanup();

    expect(await keptFolders(storage)).toEqual([]);
  });

  it("forgets what was kept for a deleted conversation and keeps the others'", async () => {
    const { root, storage, recovery } = await fixture();
    await writeFile(join(root, "one.txt"), "before one");
    await writeFile(join(root, "two.txt"), "before two");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "one.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "one.txt"), "after one");
    await recovery.commit("action-1");
    await recovery.prepare(
      "action-2",
      root,
      [{ path: "two.txt", change: "updated" }],
      "conversation-2",
    );
    await writeFile(join(root, "two.txt"), "after two");
    await recovery.commit("action-2");

    await recovery.forgetConversation("conversation-1");

    expect(await keptFolders(storage)).toHaveLength(1);
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "one.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "one.txt", change: "updated" }],
      },
      {
        id: "action-2",
        action: "Write",
        target: "two.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "two.txt", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      {
        path: "one.txt",
        action: "unknown",
        status: "unprotected",
        reason:
          "No copy of this file is kept: none was taken, or it was removed by the storage limits.",
      },
      { path: "two.txt", action: "restore", status: "recoverable" },
    ]);
  });

  it("puts back only files inside the reviewed folder, and only from copies it kept", async () => {
    const { root, recovery } = await fixture();
    const elsewhere = await folders.make("zhiyin-recovery-else-");
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "note.txt"), "after");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    const target = review.targets[0]!;
    const refused = {
      path: "note.txt",
      status: "unprotected",
      reason:
        "The restore named a file outside its folder or a copy Zhiyin did not keep, so the file was left as it is.",
    };

    // A file elsewhere that matches what the action left.
    await writeFile(join(elsewhere, "note.txt"), "after");
    const redirected = {
      ...review,
      targets: [{ ...target, absolute: join(elsewhere, "note.txt") }],
    };
    expect((await recovery.restore(redirected)).files).toEqual([refused]);
    expect(await readFile(join(elsewhere, "note.txt"), "utf8")).toBe("after");

    // The same bytes as the kept copy, but not where copies are kept.
    await writeFile(
      join(elsewhere, "copy.bin"),
      await readFile(target.backup!),
    );
    const borrowed = {
      ...review,
      targets: [{ ...target, backup: join(elsewhere, "copy.bin") }],
    };
    expect((await recovery.restore(borrowed)).files).toEqual([refused]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("after");

    expect((await recovery.restore(review)).files).toEqual([
      { path: "note.txt", status: "restored" },
    ]);
  });

  it("keeps and puts back files in a folder opened through a link", async () => {
    const { root: real, recovery } = await fixture();
    // The folder as a person might open it: by a junction to where it is.
    const parent = await folders.make("zhiyin-recovery-linked-");
    const root = join(parent, "workspace");
    await symlink(real, root, "junction");
    await writeFile(join(root, "note.txt"), "before");

    const prepared = await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    expect(prepared.files.map((file) => file.status)).toEqual(["protected"]);
    await writeFile(join(root, "note.txt"), "after");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);

    expect((await recovery.restore(review)).files).toEqual([
      { path: "note.txt", status: "restored" },
    ]);
    expect(await readFile(join(real, "note.txt"), "utf8")).toBe("before");
  });

  it("keeps no copy of a file a link inside the folder leads out to", async () => {
    const { root, recovery } = await fixture();
    const outside = await folders.make("zhiyin-recovery-outside-");
    await writeFile(join(outside, "note.txt"), "outside");
    await symlink(outside, join(root, "elsewhere"), "junction");

    const prepared = await recovery.prepare(
      "action-1",
      root,
      [{ path: "elsewhere/note.txt", change: "updated" }],
      "conversation-1",
    );
    expect(prepared.files.map((file) => file.status)).toEqual(["unprotected"]);
  });

  it.skipIf(!TemporaryFolders.canTellCaseApart())(
    "keeps no copy of a file a link leads out to, in a folder named like the workspace but for case",
    async () => {
      const { recovery } = await fixture();
      const parent = await folders.makeCaseSensitive("zhiyin-recovery-case-");
      const root = join(parent, "work");
      await mkdir(root);
      await mkdir(join(parent, "WORK"));
      await writeFile(join(parent, "WORK", "note.txt"), "outside");
      await symlink(join(parent, "WORK"), join(root, "elsewhere"), "junction");

      const prepared = await recovery.prepare(
        "action-1",
        root,
        [{ path: "elsewhere/note.txt", change: "updated" }],
        "conversation-1",
      );
      expect(prepared.files.map((file) => file.status)).toEqual([
        "unprotected",
      ]);
    },
  );

  it("reports a missing retained copy without preventing other files from restoring", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "one.txt"), "before one");
    await writeFile(join(root, "two.txt"), "before two");
    await recovery.prepare(
      "action-1",
      root,
      [
        { path: "one.txt", change: "updated" },
        { path: "two.txt", change: "updated" },
      ],
      "conversation-1",
    );
    await writeFile(join(root, "one.txt"), "after one");
    await writeFile(join(root, "two.txt"), "after two");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed",
        sequence: 0,
        changes: [
          { path: "one.txt", change: "updated" },
          { path: "two.txt", change: "updated" },
        ],
      },
    ]);
    await rm(review.targets[0]!.backup!);

    const result = await recovery.restore(review);
    expect(result.files[0]).toMatchObject({
      path: "one.txt",
      status: "unprotected",
    });
    expect(result.files[1]).toEqual({ path: "two.txt", status: "restored" });
    expect(await readFile(join(root, "one.txt"), "utf8")).toBe("after one");
    expect(await readFile(join(root, "two.txt"), "utf8")).toBe("before two");
  });

  it("leaves a file as it is when the copy kept of it is damaged, and says so", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "edited.txt"), "before the edit");
    await writeFile(join(root, "deleted.txt"), "before the delete");
    const changes = [
      { path: "edited.txt", change: "updated" as const },
      { path: "deleted.txt", change: "deleted" as const },
    ];
    await recovery.prepare("action-1", root, changes, "conversation-1");
    await writeFile(join(root, "edited.txt"), "after the edit");
    await rm(join(root, "deleted.txt"));
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed",
        sequence: 0,
        changes,
      },
    ]);
    for (const target of review.targets)
      await writeFile(target.backup!, "befo");

    const result = await recovery.restore(review);

    expect(result.files).toEqual(
      ["edited.txt", "deleted.txt"].map((path) => ({
        path,
        status: "unprotected",
        reason:
          "The copy kept before the change is damaged, so the current file was left as it is.",
      })),
    );
    expect(await readFile(join(root, "edited.txt"), "utf8")).toBe(
      "after the edit",
    );
    await expect(readFile(join(root, "deleted.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses restoration while another process holds an incompatible file handle", async () => {
    const { root, recovery } = await fixture();
    const path = join(root, "note.txt");
    await writeFile(path, "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(path, "agent result");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    const lockerScript = join(root, "locker.ps1");
    await writeFile(
      lockerScript,
      "param([string]$Target)\n$s=[IO.File]::Open($Target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)\n[Console]::Out.WriteLine('locked')\n[Console]::Out.Flush()\nStart-Sleep -Seconds 30\n$s.Dispose()",
    );
    const locker = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        lockerScript,
        "-Target",
        path,
      ],
      { windowsHide: true },
    );
    await new Promise<void>((resolve, reject) => {
      locker.once("error", reject);
      locker.stdout.once("data", () => resolve());
    });
    try {
      const result = await recovery.restore(review);
      expect(result.files[0]).toMatchObject({ status: "unprotected" });
      expect(await readFile(path, "utf8")).toBe("agent result");
    } finally {
      locker.kill();
    }
  });
  it("restores twenty files without starting PowerShell", async () => {
    const { root, recovery } = await fixture();
    const paths = Array.from({ length: 20 }, (_, index) => `file-${index}.txt`);
    for (const path of paths)
      await writeFile(join(root, path), `before ${path}`);
    await recovery.prepare(
      "action-1",
      root,
      paths.map((path) => ({ path, change: "updated" as const })),
      "conversation-1",
    );
    for (const path of paths) await writeFile(join(root, path), "after");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "20 files",
        status: "completed",
        sequence: 0,
        changes: paths.map((path) => ({ path, change: "updated" as const })),
      },
    ]);

    // Nothing on the path, so a restore that needs PowerShell cannot start it.
    const path = process.env["PATH"];
    process.env["PATH"] = "";
    let result;
    try {
      result = await recovery.restore(review);
    } finally {
      process.env["PATH"] = path;
    }

    expect(result.files).toEqual(
      paths.map((path) => ({ path, status: "restored" })),
    );
    for (const path of paths)
      expect(await readFile(join(root, path), "utf8")).toBe(`before ${path}`);
  });

  it("leaves a file in place while another program has it open for writing", async () => {
    const { root, recovery } = await fixture();
    const path = join(root, "note.txt");
    await writeFile(path, "before");
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "note.txt", change: "updated" }],
      "conversation-1",
    );
    await writeFile(path, "agent result");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
        sequence: 0,
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    const writer = await open(path, "r+");
    try {
      const result = await recovery.restore(review);

      expect(result.files[0]).toMatchObject({ status: "unprotected" });
    } finally {
      await writer.close();
    }
    expect(await readFile(path, "utf8")).toBe("agent result");
  });
});

/** A shell command's action, with what its folder listing found. */
function commandAction(
  id: string,
  files: readonly { path: string; change: "created" | "updated" | "deleted" }[],
  sequence = 0,
) {
  return {
    id,
    action: "Run a command",
    target: "cp /tmp/card.pdf card.pdf",
    status: "completed" as const,
    sequence,
    commandChanges: { status: "checked" as const, files },
  };
}

describe("files a shell command created", { timeout: 30_000 }, () => {
  it("are removed by going back while they are as the command left them", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "card.pdf"), "the card");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "card.pdf", change: "created" }],
      "conversation-1",
    );

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "card.pdf", change: "created" }]),
    ]);
    expect(review.files).toEqual([
      { path: "card.pdf", action: "remove", status: "recoverable" },
    ]);
    expect((await recovery.restore(review)).files).toEqual([
      { path: "card.pdf", status: "removed" },
    ]);
    await expect(readFile(join(root, "card.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("are left as they are, as a conflict, once changed after the command", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "card.pdf"), "the card");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "card.pdf", change: "created" }],
      "conversation-1",
    );
    await writeFile(join(root, "card.pdf"), "the person's own edit");

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "card.pdf", change: "created" }]),
    ]);
    expect(review.files).toMatchObject([
      { path: "card.pdf", action: "remove", status: "conflict" },
    ]);
    await recovery.restore(review);
    expect(await readFile(join(root, "card.pdf"), "utf8")).toBe(
      "the person's own edit",
    );
  });

  it("are removed when a later change by a tool started from what the command left", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "page.html"), "made by the command");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "page.html", change: "created" }],
      "conversation-1",
    );
    await recovery.prepare(
      "action-2",
      root,
      [{ path: "page.html", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "page.html"), "edited by a tool");
    await recovery.commit("action-2");

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "page.html", change: "created" }]),
      {
        id: "action-2",
        action: "Edit a workspace file",
        target: "page.html",
        status: "completed",
        sequence: 1,
        changes: [{ path: "page.html", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      { path: "page.html", action: "remove", status: "recoverable" },
    ]);
    await recovery.restore(review);
    await expect(readFile(join(root, "page.html"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("are not put back when a tool deleted them later", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, ".preview.png"), "a render to look at");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: ".preview.png", change: "created" }],
      "conversation-1",
    );
    await recovery.prepare(
      "action-2",
      root,
      [{ path: ".preview.png", change: "deleted" }],
      "conversation-1",
    );
    await rm(join(root, ".preview.png"));
    await recovery.commit("action-2");

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: ".preview.png", change: "created" }]),
      {
        id: "action-2",
        action: "Delete a workspace file",
        target: ".preview.png",
        status: "completed",
        sequence: 1,
        changes: [{ path: ".preview.png", change: "deleted" }],
      },
    ]);
    await recovery.restore(review);

    // Going back leaves the file absent, as it was before the command.
    expect(review.files).toEqual([
      { path: ".preview.png", action: "remove", status: "recoverable" },
    ]);
    await expect(readFile(join(root, ".preview.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("are removed though later commands changed them again, as a run that regenerates a PDF does", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "card.pdf"), "first version");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "card.pdf", change: "created" }],
      "conversation-1",
    );
    await writeFile(join(root, "card.pdf"), "regenerated");
    await recovery.keepCommandChanges(
      "action-2",
      root,
      [{ path: "card.pdf", change: "updated" }],
      "conversation-1",
    );

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "card.pdf", change: "created" }]),
      commandAction("action-2", [{ path: "card.pdf", change: "updated" }], 1),
    ]);
    expect(review.files).toEqual([
      { path: "card.pdf", action: "remove", status: "recoverable" },
    ]);
    await recovery.restore(review);
    await expect(readFile(join(root, "card.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("are left as a conflict when the person changed them after the last command", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "card.pdf"), "first version");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "card.pdf", change: "created" }],
      "conversation-1",
    );
    await writeFile(join(root, "card.pdf"), "regenerated");
    await recovery.keepCommandChanges(
      "action-2",
      root,
      [{ path: "card.pdf", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "card.pdf"), "the person's own edit");

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "card.pdf", change: "created" }]),
      commandAction("action-2", [{ path: "card.pdf", change: "updated" }], 1),
    ]);
    expect(review.files).toMatchObject([
      { path: "card.pdf", status: "conflict" },
    ]);
  });

  it("are removed when a tool created them and a command changed them after", async () => {
    const { root, recovery } = await fixture();
    await recovery.prepare(
      "action-1",
      root,
      [{ path: "page.html", change: "created" }],
      "conversation-1",
    );
    await writeFile(join(root, "page.html"), "written by a tool");
    await recovery.commit("action-1");
    await writeFile(join(root, "page.html"), "rewritten by a command");
    await recovery.keepCommandChanges(
      "action-2",
      root,
      [{ path: "page.html", change: "updated" }],
      "conversation-1",
    );

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Create a workspace file",
        target: "page.html",
        status: "completed",
        sequence: 0,
        changes: [{ path: "page.html", change: "created" }],
      },
      commandAction("action-2", [{ path: "page.html", change: "updated" }], 1),
    ]);
    expect(review.files).toEqual([
      { path: "page.html", action: "remove", status: "recoverable" },
    ]);
  });

  it("put back what a tool changed after a command, to the version the command left, as before", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "notes.md"), "changed by the command");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "notes.md", change: "updated" }],
      "conversation-1",
    );
    await recovery.prepare(
      "action-2",
      root,
      [{ path: "notes.md", change: "updated" }],
      "conversation-1",
    );
    await writeFile(join(root, "notes.md"), "edited by a tool");
    await recovery.commit("action-2");

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "notes.md", change: "updated" }]),
      {
        id: "action-2",
        action: "Edit a workspace file",
        target: "notes.md",
        status: "completed",
        sequence: 1,
        changes: [{ path: "notes.md", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      { path: "notes.md", action: "restore", status: "recoverable" },
    ]);
    await recovery.restore(review);
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe(
      "changed by the command",
    );
  });

  it("leave out what the command updated or deleted, of which no copy exists", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "notes.md"), "changed by the command");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "notes.md", change: "updated" }],
      "conversation-1",
    );

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [
        { path: "notes.md", change: "updated" },
        { path: "old.txt", change: "deleted" },
      ]),
    ]);
    expect(review.files).toEqual([]);
  });

  it("are not taken past the size limit, and stay where they are", async () => {
    const root = await folders.make("zhiyin-recovery-workspace-");
    const storage = await folders.make("zhiyin-recovery-store-");
    const recovery = new FileRecovery(storage, { limits: { fileBytes: 4 } });
    await writeFile(join(root, "big.bin"), "more than four bytes");
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: "big.bin", change: "created" }],
      "conversation-1",
    );

    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: "big.bin", change: "created" }]),
    ]);
    expect(review.files).toEqual([]);
    await recovery.restore(review);
    expect(await readFile(join(root, "big.bin"), "utf8")).toBe(
      "more than four bytes",
    );
  });

  it("are never taken outside the conversation's folder", async () => {
    const { root, recovery } = await fixture();
    const outside = await folders.make("zhiyin-recovery-outside-");
    await writeFile(join(outside, "theirs.txt"), "not the workspace's");
    const theirs = `../${basename(outside)}/theirs.txt`;
    await recovery.keepCommandChanges(
      "action-1",
      root,
      [{ path: theirs, change: "created" }],
      "conversation-1",
    );
    const review = await recovery.review("review-1", root, [
      commandAction("action-1", [{ path: theirs, change: "created" }]),
    ]);
    expect(review.targets).toEqual([]);
    await recovery.restore(review);
    expect(await readFile(join(outside, "theirs.txt"), "utf8")).toBe(
      "not the workspace's",
    );
  });
});
