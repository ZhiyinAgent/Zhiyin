import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions } from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-kept-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

/** Moves an item's own timestamp back, as if it had been kept that long ago. */
async function age(path: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await utimes(path, when, when);
}

async function kept(
  sessions: FileSessions,
  kind: "output" | "pastedText",
  conversationId: string | undefined,
  text: string,
): Promise<string> {
  const item = await sessions.keep(kind, conversationId, { text });
  if (item.status !== "kept") throw new Error(item.reason);
  return item.id;
}

async function pathOf(
  sessions: FileSessions,
  kind: "output" | "pastedText",
  conversationId: string,
  id: string,
): Promise<string> {
  const located = await sessions.locate(kind, conversationId, id);
  if (located.status !== "ready") throw new Error(located.reason);
  return located.path;
}

describe("what a conversation keeps beside itself", () => {
  it("removes the oldest saved outputs past the folder's limit, with a note, and no paste or picture", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      kept: {
        output: { totalBytes: 2_500 },
        pastedText: { totalBytes: 2_500 },
        toolPictures: { totalBytes: 2_500 },
      },
    });
    const paste = await kept(sessions, "pastedText", "task-1", "p".repeat(900));
    await age(await pathOf(sessions, "pastedText", "task-1", paste), 3);
    const picture = await sessions.savePicture("task-1", {
      mediaType: "image/png",
      data: "A".repeat(900),
    });
    const oldest = await kept(sessions, "output", "task-1", "a".repeat(1_000));
    await age(await pathOf(sessions, "output", "task-1", oldest), 2);
    const middle = await kept(sessions, "output", "task-2", "b".repeat(1_000));
    await age(await pathOf(sessions, "output", "task-2", middle), 1);

    const newest = await kept(sessions, "output", "task-1", "c".repeat(1_000));

    expect(await sessions.locate("output", "task-1", oldest)).toEqual({
      status: "missing",
      reason: "This saved output was deleted to save disk space.",
    });
    expect((await sessions.locate("output", "task-2", middle)).status).toBe(
      "ready",
    );
    expect((await sessions.locate("output", "task-1", newest)).status).toBe(
      "ready",
    );
    expect((await sessions.locate("pastedText", "task-1", paste)).status).toBe(
      "ready",
    );
    expect((await sessions.readPicture(picture)).status).toBe("ready");
  });

  it("keeps a saved output for 30 days, and a paste however old it is", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    const output = await kept(sessions, "output", "task-1", "old output");
    await age(await pathOf(sessions, "output", "task-1", output), 31);
    const paste = await kept(sessions, "pastedText", "task-1", "old paste");
    await age(await pathOf(sessions, "pastedText", "task-1", paste), 400);

    await kept(sessions, "output", "task-1", "new output");
    await kept(sessions, "pastedText", "task-1", "new paste");

    expect((await sessions.locate("output", "task-1", output)).status).toBe(
      "missing",
    );
    expect(
      await readFile(
        await pathOf(sessions, "pastedText", "task-1", paste),
        "utf8",
      ),
    ).toBe("old paste");
  });

  it("refuses an item past its own limit rather than pushing out others, and says so", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      kept: { output: { itemBytes: 100 } },
    });
    const earlier = await kept(sessions, "output", "task-1", "kept");

    const refused = await sessions.keep("output", "task-1", {
      text: "x".repeat(101),
    });

    expect(refused).toMatchObject({
      status: "refused",
      reason: "This output was too large to keep.",
    });
    expect(await sessions.locate("output", "task-1", refused.id)).toEqual({
      status: "missing",
      reason: "This output was too large to keep.",
    });
    expect((await sessions.locate("output", "task-1", earlier)).status).toBe(
      "ready",
    );
  });

  it("keeps a file handed to it, such as a command's whole output", async () => {
    const root = await temporaryRoot();
    const file = join(root, "stdout.txt");
    await writeFile(file, "line 1\nline 2\n");
    const sessions = new FileSessions(root);

    const item = await sessions.keep("output", "task-1", { file });

    expect(item).toMatchObject({ status: "kept", bytes: 14 });
    expect(
      await readFile(
        await pathOf(sessions, "output", "task-1", item.id),
        "utf8",
      ),
    ).toBe("line 1\nline 2\n");
  });

  it("deletes everything a conversation kept with it, and nothing of another's", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    const output = await kept(sessions, "output", "task-1", "output");
    const paste = await kept(sessions, "pastedText", "task-1", "paste");
    const other = await kept(sessions, "output", "task-2", "other");
    await sessions.noteRead("task-1", "notes.md", {
      modifiedMs: 1,
      size: 2,
      readAt: "2026-09-23T10:00:00.000Z",
    });

    await sessions.forgetConversation("task-1");

    expect((await sessions.locate("output", "task-1", output)).status).toBe(
      "missing",
    );
    expect((await sessions.locate("pastedText", "task-1", paste)).status).toBe(
      "missing",
    );
    expect(await sessions.lastRead("task-1", "notes.md")).toBeUndefined();
    expect((await sessions.locate("output", "task-2", other)).status).toBe(
      "ready",
    );
  });

  it("never reads outside what it kept for an id a model made up", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "secret.txt"), "secret");
    const sessions = new FileSessions(root);

    for (const id of ["../../../secret.txt", "..", "a/b", ""])
      expect((await sessions.locate("output", "task-1", id)).status).toBe(
        "missing",
      );
    expect((await sessions.readPicture("tool-pictures/../x")).status).toBe(
      "missing",
    );
  });
});

describe("a long text a person pasted", () => {
  it("is named by when it was pasted, and apart from another pasted the same second", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      now: () => new Date(2026, 8, 23, 14, 5, 12),
    });

    const first = await kept(sessions, "pastedText", "task-1", "one");
    const second = await kept(sessions, "pastedText", "task-1", "two");

    expect(first).toBe("pasted-2026-09-23-140512.txt");
    expect(second).toBe("pasted-2026-09-23-140512-2.txt");
  });

  it("waits as a draft until its message starts a conversation, and a draft never sent is gone at the next launch", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.claim();
    const sent = await kept(sessions, "pastedText", undefined, "sent\ntwice");
    const unsent = await kept(sessions, "pastedText", undefined, "unsent");

    const attachments = await sessions.claimDrafts("task-1", [sent]);
    await sessions.release();
    const relaunched = new FileSessions(root);
    await relaunched.claim();

    expect(attachments).toEqual([
      { kind: "pastedText", id: sent, bytes: 10, lines: 2 },
    ]);
    expect(
      await readFile(
        await pathOf(relaunched, "pastedText", "task-1", sent),
        "utf8",
      ),
    ).toBe("sent\ntwice");
    expect(await relaunched.claimDrafts("task-1", [unsent])).toEqual([]);
    await relaunched.release();
  });
});

describe("a paste sent again after its message was rewound", () => {
  it("is already its conversation's, and is sent again as it is", async () => {
    const sessions = new FileSessions(await temporaryRoot());
    const draft = await kept(sessions, "pastedText", undefined, "a\nb\nc");
    await sessions.claimDrafts("task-1", [draft]);

    const again = await sessions.claimDrafts("task-1", [draft]);

    expect(again).toEqual([
      { kind: "pastedText", id: draft, bytes: 5, lines: 3 },
    ]);
    expect(
      await readFile(
        await pathOf(sessions, "pastedText", "task-1", draft),
        "utf8",
      ),
    ).toBe("a\nb\nc");
  });

  it("is never taken from another conversation", async () => {
    const sessions = new FileSessions(await temporaryRoot());
    const other = await kept(sessions, "pastedText", "task-2", "theirs");

    expect(await sessions.claimDrafts("task-1", [other])).toEqual([]);
  });
});

describe("when a file was last read", () => {
  it("is remembered after the app restarts", async () => {
    const root = await temporaryRoot();
    const read = {
      modifiedMs: 1_700_000_000_000,
      size: 42,
      readAt: "2026-09-23T10:00:00.000Z",
    };
    await new FileSessions(root).noteRead("task-1", "notes.md", read);

    expect(await new FileSessions(root).lastRead("task-1", "notes.md")).toEqual(
      read,
    );
    expect(
      await new FileSessions(root).lastRead("task-2", "notes.md"),
    ).toBeUndefined();
  });
});
