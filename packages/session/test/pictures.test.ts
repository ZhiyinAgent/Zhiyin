import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileSessions } from "../src/index.js";
import { savedText } from "./planted-history.js";

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-pictures-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
      recentWorkspaces: [],
      plugins: [],
      tasks: [
        {
          id: "task-1",
          title: "Look at the page",
          titleSource: "generated",
          updatedAt: "2026-09-09T10:00:00.000Z",
          updatedLabel: "Now",
          ...emptyConversationLists,
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
  /** A clock the test turns back to keep a picture as if that long ago. */
  function clock() {
    let at = Date.now();
    return {
      now: () => new Date(at),
      daysAgo(days: number) {
        at = Date.now() - days * 24 * 60 * 60 * 1000;
      },
      today() {
        at = Date.now();
      },
    };
  }

  it("deletes the oldest screenshots to make room for a new one", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { toolPictures: { totalBytes: 2_400 } },
    });
    time.daysAgo(2);
    const oldest = await sessions.savePicture("task-1", pictureOf(1_000));
    time.daysAgo(1);
    const middle = await sessions.savePicture("task-1", pictureOf(1_000));
    time.today();

    const newest = await sessions.savePicture("task-1", pictureOf(1_000));

    expect((await sessions.readPicture(newest)).status).toBe("ready");
    expect((await sessions.readPicture(middle)).status).toBe("ready");
    expect((await sessions.readPicture(oldest)).status).toBe("missing");
  });

  it("says a screenshot was deleted to save space rather than going blank", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { toolPictures: { totalBytes: 1_400 } },
    });
    time.daysAgo(1);
    const evicted = await sessions.savePicture("task-1", pictureOf(1_000));
    time.today();

    await sessions.savePicture("task-1", pictureOf(1_000));

    expect(await sessions.readPicture(evicted)).toEqual({
      status: "missing",
      reason: "This screenshot was deleted to save disk space.",
    });
  });

  it("keeps the picture it was just given, whatever it evicts to do it", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { toolPictures: { totalBytes: 1_200 } },
    });
    time.daysAgo(1);
    const first = await sessions.savePicture("task-1", pictureOf(1_000));
    time.today();

    const second = await sessions.savePicture("task-1", pictureOf(1_000));

    expect((await sessions.readPicture(second)).status).toBe("ready");
    expect((await sessions.readPicture(first)).status).toBe("missing");
  });

  it("drops screenshots older than the age it keeps them for", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, { now: time.now });
    time.daysAgo(40);
    const old = await sessions.savePicture("task-1", pictureOf(100));
    time.today();

    await sessions.savePicture("task-1", pictureOf(100));

    expect(await sessions.readPicture(old)).toEqual({
      status: "missing",
      reason: "This screenshot was deleted to save disk space.",
    });
  });

  it("keeps a 10 MB screenshot or connector picture under the default limits", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    // Base64 holds three bytes in every four characters.
    const tenMegabytes = pictureOf(Math.ceil(10_000_000 / 3) * 4);

    const screenshot = await sessions.savePicture("task-1", tenMegabytes);
    const connector = await sessions.savePicture(
      "task-1",
      tenMegabytes,
      "connector",
    );

    expect((await sessions.readPicture(screenshot)).status).toBe("ready");
    expect((await sessions.readPicture(connector)).status).toBe("ready");
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
