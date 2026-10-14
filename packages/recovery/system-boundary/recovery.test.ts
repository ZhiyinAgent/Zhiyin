import {
  mkdtemp,
  open,
  readFile,
  readdir,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FileRecovery } from "../src/index.js";
import { recreateExclusively } from "../src/exclusive-restore.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-recovery-workspace-"));
  const storage = await mkdtemp(join(tmpdir(), "zhiyin-recovery-store-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-recovery-workspace-"));
    const storage = await mkdtemp(join(tmpdir(), "zhiyin-recovery-store-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-recovery-workspace-"));
    const storage = await mkdtemp(join(tmpdir(), "zhiyin-recovery-store-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-recovery-workspace-"));
    const storage = await mkdtemp(join(tmpdir(), "zhiyin-recovery-store-"));
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
    const elsewhere = await mkdtemp(join(tmpdir(), "zhiyin-recovery-else-"));
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
