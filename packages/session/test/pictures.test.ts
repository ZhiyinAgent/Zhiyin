import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { FileSessions } from "../src/index.js";
import { savedText } from "./planted-history.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-pictures-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

const picture = { mediaType: "image/png", data: "QUJDRA==" };

describe("pictures a conversation contains", () => {
  it("comes back after the application is closed and opened again", async () => {
    const root = await temporaryRoot();

    const id = await new FileSessions(root).savePicture("task-1", picture);

    expect(await new FileSessions(root).readPicture(id)).toEqual({
      status: "ready",
      ...picture,
    });
  });

  it("is kept beside the conversation rather than inside it", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    const id = await sessions.savePicture("task-1", picture);
    const snapshot: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "unavailable" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Look at the page",
          updatedAt: "2026-09-09T10:00:00.000Z",
          updatedLabel: "Now",
          messages: [
            { id: "message-1", role: "user", text: "Look at it", sequence: 0 },
          ],
          actions: [
            {
              id: "capture",
              action: "Capture page",
              target: "https://example.com",
              sequence: 1,
              status: "completed",
              details: [
                {
                  kind: "image",
                  label: "Picture",
                  mediaType: "image/png",
                  source: id,
                  alt: "The page",
                },
              ],
            },
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Looked at it", summary: "Seen." },
          },
        },
      ],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage recorded." },
    };

    await sessions.saveWorkspace(snapshot);

    // A conversation's file stays small enough to read whole when it is
    // opened: what a conversation refers to is not what it is made of.
    const saved = await savedText(root);
    expect(saved).toContain(id);
    expect(saved).not.toContain(picture.data);
    // And the reference survives the round trip, so the record still shows it.
    expect(
      (await new FileSessions(root).loadWorkspace())?.tasks[0]?.actions?.[0]
        ?.details,
    ).toEqual(snapshot.tasks[0]?.actions?.[0]?.details);
  });

  it("says nothing rather than inventing one when it has been lost", async () => {
    const root = await temporaryRoot();

    expect((await new FileSessions(root).readPicture("missing")).status).toBe(
      "missing",
    );
    // A made-up name never reaches the filesystem as a path.
    expect(
      (await new FileSessions(root).readPicture("../../secrets")).status,
    ).toBe("missing");
  });

  it("forgets the pictures of a conversation that is deleted", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    const kept = await sessions.savePicture("task-1", picture);
    const dropped = await sessions.savePicture("task-2", picture);

    await sessions.forgetConversation("task-2");

    expect((await sessions.readPicture(dropped)).status).toBe("missing");
    expect(await sessions.readPicture(kept)).toEqual({
      status: "ready",
      ...picture,
    });
  });
});

/** A picture of a known encoded size, so a limit can be stated in bytes. */
function pictureOf(bytes: number): { mediaType: string; data: string } {
  return { mediaType: "image/png", data: "A".repeat(bytes) };
}

describe("what the picture store keeps", () => {
  /** Ages a stored picture by moving its file's own timestamp back. */
  async function age(root: string, id: string, days: number): Promise<void> {
    const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await utimes(join(root, "kept", ...id.split("/")), when, when);
  }

  it("deletes the oldest screenshots to make room for a new one", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      kept: { toolPictures: { totalBytes: 2_400 } },
    });
    const oldest = await sessions.savePicture("task-1", pictureOf(1_000));
    await age(root, oldest, 2);
    const middle = await sessions.savePicture("task-1", pictureOf(1_000));
    await age(root, middle, 1);

    const newest = await sessions.savePicture("task-1", pictureOf(1_000));

    expect((await sessions.readPicture(newest)).status).toBe("ready");
    expect((await sessions.readPicture(middle)).status).toBe("ready");
    expect((await sessions.readPicture(oldest)).status).toBe("missing");
  });

  it("says a screenshot was deleted to save space rather than going blank", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      kept: { toolPictures: { totalBytes: 1_400 } },
    });
    const evicted = await sessions.savePicture("task-1", pictureOf(1_000));
    await age(root, evicted, 1);

    await sessions.savePicture("task-1", pictureOf(1_000));

    expect(await sessions.readPicture(evicted)).toEqual({
      status: "missing",
      reason: "This screenshot was deleted to save disk space.",
    });
  });

  it("keeps the picture it was just given, whatever it evicts to do it", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      kept: { toolPictures: { totalBytes: 1_200 } },
    });
    const first = await sessions.savePicture("task-1", pictureOf(1_000));
    await age(root, first, 1);

    const second = await sessions.savePicture("task-1", pictureOf(1_000));

    expect((await sessions.readPicture(second)).status).toBe("ready");
    expect((await sessions.readPicture(first)).status).toBe("missing");
  });

  it("drops screenshots older than the age it keeps them for", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    const old = await sessions.savePicture("task-1", pictureOf(100));
    await age(root, old, 40);

    await sessions.savePicture("task-1", pictureOf(100));

    expect(await sessions.readPicture(old)).toEqual({
      status: "missing",
      reason: "This screenshot was deleted to save disk space.",
    });
  });

  it("says so in the conversation when a picture was too large to keep", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      kept: { toolPictures: { itemBytes: 500 } },
    });

    const id = await sessions.savePicture("task-1", pictureOf(1_000));

    expect(await sessions.readPicture(id)).toEqual({
      status: "missing",
      reason: "This screenshot was too large to keep.",
    });
  });

  it("distinguishes a picture it never had from one it deleted", async () => {
    const root = await temporaryRoot();

    expect(await new FileSessions(root).readPicture("missing")).toEqual({
      status: "missing",
      reason: "This picture is no longer stored with the conversation.",
    });
  });
});
