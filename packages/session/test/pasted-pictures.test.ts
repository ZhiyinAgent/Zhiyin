/**
 * Pictures a person attaches to a message: kept as drafts until the message
 * is sent, then the conversation's, read back by the address the message
 * names, and removed only to stay inside their own folder's size.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions } from "../src/index.js";

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

/** A picture of `bytes` bytes, as the window hands it over. */
function picture(name: string, bytes = 6) {
  return {
    name,
    mediaType: "image/png",
    data: Buffer.alloc(bytes, 7).toString("base64"),
  };
}

async function keptPicture(
  sessions: FileSessions,
  name: string,
  bytes?: number,
): Promise<string> {
  const item = await sessions.keepPicture(picture(name, bytes));
  if (item.status !== "kept") throw new Error(item.reason);
  return item.id;
}

describe("a picture a person attached", () => {
  it("waits as a draft, becomes the conversation's when sent, and reads back as itself", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.claim();
    const id = await keptPicture(sessions, "screenshot.png");

    const [attachment] = await sessions.claimDrafts("task-1", [id]);

    expect(attachment).toEqual({
      kind: "picture",
      id,
      name: "screenshot.png",
      mediaType: "image/png",
      bytes: 6,
      source: expect.stringMatching(/^pasted-pictures\/c-task-1\//),
    });
    if (attachment?.kind !== "picture") throw new Error("not a picture");
    await expect(
      sessions.readPicture(attachment.source ?? ""),
    ).resolves.toEqual({
      status: "ready",
      mediaType: "image/png",
      data: picture("screenshot.png").data,
    });
    await expect(sessions.readAttachedPicture("task-1", id)).resolves.toEqual({
      status: "ready",
      mediaType: "image/png",
      data: picture("screenshot.png").data,
    });
    await sessions.release();
  });

  it("is sent again as it is after its message was rewound, and never taken from another conversation", async () => {
    const sessions = new FileSessions(await temporaryRoot());
    const id = await keptPicture(sessions, "plan.png");
    const [first] = await sessions.claimDrafts("task-1", [id]);

    expect(await sessions.claimDrafts("task-1", [id])).toEqual([first]);
    expect(await sessions.claimDrafts("task-2", [id])).toEqual([]);
    await expect(
      sessions.readAttachedPicture("task-2", id),
    ).resolves.toMatchObject({ status: "missing" });
  });

  it("is a draft no longer at the next launch when its message was never sent", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.claim();
    const unsent = await keptPicture(sessions, "unsent.png");
    await sessions.release();

    const relaunched = new FileSessions(root);
    await relaunched.claim();
    expect(await relaunched.claimDrafts("task-1", [unsent])).toEqual([]);
    await relaunched.release();
  });

  it("is removed, oldest first, only to keep the pictures folder inside its limit, and says why", async () => {
    const sessions = new FileSessions(await temporaryRoot(), {
      kept: { pastedPictures: { totalBytes: 600 } },
    });
    const oldest = await keptPicture(sessions, "one.png", 200);
    await sessions.claimDrafts("task-1", [oldest]);
    const paste = await sessions.keep("pastedText", "task-1", { text: "x" });
    for (const name of ["two.png", "three.png"])
      await sessions.claimDrafts("task-1", [
        await keptPicture(sessions, name, 200),
      ]);

    await expect(
      sessions.readAttachedPicture("task-1", oldest),
    ).resolves.toEqual({
      status: "missing",
      reason: "This picture was deleted to save disk space.",
    });
    expect(paste.status).toBe("kept");
  });

  it("is refused whole when it is larger than a picture may be", async () => {
    const sessions = new FileSessions(await temporaryRoot(), {
      kept: { pastedPictures: { itemBytes: 100 } },
    });

    await expect(
      sessions.keepPicture(picture("huge.png", 200)),
    ).resolves.toMatchObject({
      status: "refused",
      reason: "This picture is larger than 12 MB, so it was not kept.",
    });
  });
});
