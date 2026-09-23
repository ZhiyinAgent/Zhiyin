import {
  mkdtemp,
  open,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FileRecovery } from "../src/index.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-recovery-workspace-"));
  const storage = await mkdtemp(join(tmpdir(), "zhiyin-recovery-store-"));
  const recovery = new FileRecovery(storage, {
    now: () => new Date("2026-09-07T10:00:00.000Z"),
  });
  return { root, recovery };
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

    const prepared = await recovery.prepare("action-1", root, [
      { path: "notes/existing.txt", change: "updated" },
      { path: "notes/created.txt", change: "created" },
    ]);
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
    await recovery.prepare("action-1", root, [
      { path: "one.txt", change: "updated" },
      { path: "two.txt", change: "updated" },
    ]);
    await writeFile(join(root, "one.txt"), "after one");
    await writeFile(join(root, "two.txt"), "after two");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed",
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

  it("refuses to overwrite a file changed after the recorded action", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare("action-1", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(join(root, "note.txt"), "agent result");
    await recovery.commit("action-1");
    await writeFile(join(root, "note.txt"), "newer user edit");

    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write file",
        target: "note.txt",
        status: "completed",
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

  it("marks undeclared and oversized effects as unprotected", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "large.txt"), Buffer.alloc(11 * 1024 * 1024));
    const prepared = await recovery.prepare("action-1", root, [
      { path: "../outside.txt", change: "updated" },
      { path: "large.txt", change: "updated" },
    ]);
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
    await recovery.prepare("action-1", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(join(root, "note.txt"), "changed while waiting");
    await expect(recovery.validate("action-1")).resolves.toMatchObject({
      ok: false,
    });
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
    await recovery.prepare("action-1", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(join(root, "note.txt"), "one");
    await recovery.commit("action-1");

    now = new Date("2026-09-01T11:00:00.000Z");
    await recovery.prepare("action-2", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(join(root, "note.txt"), "two");
    await recovery.commit("action-2");
    const versionReview = await recovery.review("versions", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
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
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(ageReview.files[0]).toMatchObject({ status: "unprotected" });
  });

  it("reports a missing retained copy without preventing other files from restoring", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "one.txt"), "before one");
    await writeFile(join(root, "two.txt"), "before two");
    await recovery.prepare("action-1", root, [
      { path: "one.txt", change: "updated" },
      { path: "two.txt", change: "updated" },
    ]);
    await writeFile(join(root, "one.txt"), "after one");
    await writeFile(join(root, "two.txt"), "after two");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "2 files",
        status: "completed",
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

  it("reports bounded storage usage and deletes all retained recovery bytes", async () => {
    const { root, recovery } = await fixture();
    await writeFile(join(root, "note.txt"), "before");
    await recovery.prepare("action-1", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(join(root, "note.txt"), "after");
    await recovery.commit("action-1");

    await expect(recovery.storage()).resolves.toMatchObject({
      usedBytes: 6,
      retainedFiles: 1,
      limits: {
        totalBytes: 256 * 1024 * 1024,
        fileBytes: 10 * 1024 * 1024,
        versionsPerPath: 10,
        maximumAgeDays: 30,
      },
    });

    await recovery.clear();
    await expect(recovery.storage()).resolves.toMatchObject({
      usedBytes: 0,
      retainedFiles: 0,
    });
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write file",
        target: "note.txt",
        status: "completed",
        changes: [{ path: "note.txt", change: "updated" }],
      },
    ]);
    expect(review.files).toEqual([
      expect.objectContaining({ path: "note.txt", status: "unprotected" }),
    ]);
  });

  it("refuses restoration while another process holds an incompatible file handle", async () => {
    const { root, recovery } = await fixture();
    const path = join(root, "note.txt");
    await writeFile(path, "before");
    await recovery.prepare("action-1", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(path, "agent result");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
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
    );
    for (const path of paths) await writeFile(join(root, path), "after");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Edit files",
        target: "20 files",
        status: "completed",
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
    await recovery.prepare("action-1", root, [
      { path: "note.txt", change: "updated" },
    ]);
    await writeFile(path, "agent result");
    await recovery.commit("action-1");
    const review = await recovery.review("review-1", root, [
      {
        id: "action-1",
        action: "Write",
        target: "note.txt",
        status: "completed",
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
