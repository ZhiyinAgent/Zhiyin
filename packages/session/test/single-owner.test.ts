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
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileSessions, SessionStoreError } from "../src/index.js";

async function temporaryRoot() {
  return folders.make("zhiyin-owner-test-");
}

/**
 * Two launches, told apart by the process each speaks for. The real store uses
 * this process's id; the test supplies one so that "another copy of the app"
 * is a real second owner rather than the same one twice.
 */
function launch(root: string, pid: number) {
  return new FileSessions(root, { pid });
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const snapshot: WorkspaceSnapshot = {
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: null,
  recentWorkspaces: [],
  plugins: [],
  tasks: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "No usage recorded." },
};

describe("FileSessions single ownership", () => {
  it("refuses a second owner of the same folder rather than letting it overwrite the first", async () => {
    const root = await temporaryRoot();
    const first = launch(root, 1111);
    await first.claim();

    const second = launch(root, 2222);

    await expect(second.claim()).rejects.toMatchObject({ code: "in-use" });
  });

  it("does not save from an instance that was refused ownership", async () => {
    const root = await temporaryRoot();
    const first = launch(root, 1111);
    await first.claim();
    await first.saveWorkspace({ ...snapshot, selectedTaskId: "the-owner" });

    const second = launch(root, 2222);
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

    const second = launch(root, 2222);

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

    const next = launch(root, 2222);

    await expect(next.claim()).resolves.toBeUndefined();
    await expect(next.saveWorkspace(snapshot)).resolves.toBeUndefined();
  });

  it("refuses every write from an instance that does not own the folder, and leaves the owner's items", async () => {
    const root = await temporaryRoot();
    const owner = launch(root, 1111);
    await owner.claim();
    const kept = await owner.keep("pastedText", "task-1", { text: "Notes." });
    await owner.saveWorkspace(snapshot);
    const intruder = launch(root, 2222);
    const read = { modifiedMs: 1, size: 6, readAt: "2026-10-16T09:00:00Z" };

    const writes: Record<string, () => Promise<unknown>> = {
      keep: () => intruder.keep("pastedText", "task-1", { text: "Mine." }),
      keepPicture: () =>
        intruder.keepPicture({
          name: "a.png",
          mediaType: "image/png",
          data: "iVBORw0KGgo=",
        }),
      savePicture: () =>
        intruder.savePicture("task-1", {
          mediaType: "image/png",
          data: "iVBORw0KGgo=",
        } as never),
      noteRead: () => intruder.noteRead("task-1", "notes.md", read),
      claimDrafts: () => intruder.claimDrafts("task-1", ["draft"]),
      forgetConversation: () => intruder.forgetConversation("task-1"),
      saveWorkspace: () => intruder.saveWorkspace(snapshot),
      startAfresh: () => intruder.startAfresh("kept"),
      recoverReadable: () => intruder.recoverReadable(),
      updateConversations: () => intruder.updateConversations(),
      recycleOutdatedConversations: () =>
        intruder.recycleOutdatedConversations(),
    };
    const refused: Record<string, string | undefined> = {};
    for (const [name, write] of Object.entries(writes))
      refused[name] = await write().then(
        () => undefined,
        (error: { code?: string }) => error.code,
      );

    expect(refused).toEqual(
      Object.fromEntries(Object.keys(writes).map((name) => [name, "in-use"])),
    );
    expect(kept.status).toBe("kept");
    await expect(
      owner.locate("pastedText", "task-1", kept.id),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("reads without claiming, so a refused instance can still show what is saved", async () => {
    const root = await temporaryRoot();
    const owner = launch(root, 1111);
    await owner.claim();
    await owner.saveWorkspace({ ...snapshot, selectedTaskId: "the-owner" });

    const onlooker = launch(root, 2222);

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
