/**
 * One app instance owns a data directory at a time.
 *
 * The in-process write queue orders this process's saves and can see nothing
 * else. Two copies of the app pointed at the same folder would each save what
 * changed since its own last save, and between them write over or tangle what
 * the other had done. ADR 0005 assumes one owning instance; this is what makes
 * the assumption true rather than hoped for.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { FileSessions, SessionStoreError } from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-owner-test-"));
  roots.push(root);
  return root;
}

/**
 * Two launches, told apart by the process each speaks for. The real store uses
 * this process's id; the test supplies one so that "another copy of the app"
 * is a real second owner rather than the same one twice.
 */
function launch(root: string, pid: number, running: readonly number[] = [pid]) {
  return new FileSessions(root, {
    pid,
    processIsRunning: (candidate) => running.includes(candidate),
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const snapshot: WorkspaceSnapshot = {
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: null,
  recentWorkspaces: [],
  tasks: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "No usage recorded." },
};

describe("FileSessions single ownership", () => {
  it("refuses a second owner of the same folder rather than letting it overwrite the first", async () => {
    const root = await temporaryRoot();
    const first = launch(root, 1111);
    await first.claim();

    const second = launch(root, 2222, [1111, 2222]);

    await expect(second.claim()).rejects.toMatchObject({ code: "in-use" });
  });

  it("does not save from an instance that was refused ownership", async () => {
    const root = await temporaryRoot();
    const first = launch(root, 1111);
    await first.claim();
    await first.saveWorkspace({ ...snapshot, selectedTaskId: "the-owner" });

    const second = launch(root, 2222, [1111, 2222]);
    await expect(second.claim()).rejects.toBeInstanceOf(SessionStoreError);
    await expect(
      second.saveWorkspace({ ...snapshot, selectedTaskId: "the-intruder" }),
    ).rejects.toMatchObject({ code: "in-use" });

    await expect(first.loadWorkspace()).resolves.toMatchObject({
      selectedTaskId: "the-owner",
    });
  });

  it("lets the next launch take over from an instance that is gone", async () => {
    const root = await temporaryRoot();
    const first = launch(root, 1111);
    await first.claim();
    await first.release();

    const second = launch(root, 2222, [2222]);

    await expect(second.claim()).resolves.toBeUndefined();
    await expect(
      second.saveWorkspace({ ...snapshot, selectedTaskId: "the-next-launch" }),
    ).resolves.toBeUndefined();
  });

  it("takes over a folder whose previous owner died without releasing it", async () => {
    const root = await temporaryRoot();
    // A process id that cannot be running: the previous launch was killed
    // before it could clean up after itself.
    await writeFile(
      join(root, "owner.lock"),
      JSON.stringify({ pid: 0x7fffffff, since: "2026-09-01T00:00:00.000Z" }),
      "utf8",
    );

    const next = launch(root, 2222, [2222]);

    await expect(next.claim()).resolves.toBeUndefined();
    await expect(next.saveWorkspace(snapshot)).resolves.toBeUndefined();
  });

  it("reads without claiming, so a refused instance can still show what is saved", async () => {
    const root = await temporaryRoot();
    const owner = launch(root, 1111);
    await owner.claim();
    await owner.saveWorkspace({ ...snapshot, selectedTaskId: "the-owner" });

    const onlooker = launch(root, 2222, [1111, 2222]);

    await expect(onlooker.loadWorkspace()).resolves.toMatchObject({
      selectedTaskId: "the-owner",
    });
  });

  it("leaves no lock behind after the owner releases it", async () => {
    const root = await temporaryRoot();
    const owner = launch(root, 1111);
    await owner.claim();
    await owner.release();

    await expect(readFile(join(root, "owner.lock"), "utf8")).rejects.toThrow();
  });

  it.runIf(process.platform === "win32")(
    "takes over a lock naming a process that is running but is not the app",
    async () => {
      const root = await temporaryRoot();
      // A live process, so a lock that trusts process ids would think the
      // folder is still owned: the id of a killed app, reused by something else.
      const unrelated = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { stdio: "ignore", windowsHide: true },
      );
      try {
        await writeFile(
          join(root, "owner.lock"),
          JSON.stringify({
            pid: unrelated.pid,
            since: "2026-09-01T00:00:00.000Z",
          }),
          "utf8",
        );

        const next = new FileSessions(root);

        await expect(next.claim()).resolves.toBeUndefined();
        await expect(next.saveWorkspace(snapshot)).resolves.toBeUndefined();
        await next.release();
      } finally {
        unrelated.kill();
      }
    },
  );
});
