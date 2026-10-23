import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileSessions } from "../src/index.js";
import { conversationFolder } from "./planted-history.js";

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-kept-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** A clock the test turns back to keep an item as if that long ago. */
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

/**
 * Opens a file the way a program that forbids its removal does, until the
 * returned function lets it go.
 */
async function holdWithoutSharing(
  root: string,
  path: string,
): Promise<() => Promise<void>> {
  const script = join(root, "holder.ps1");
  await writeFile(
    script,
    "param([string]$Target)\n$s=[IO.File]::Open($Target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)\n[Console]::Out.WriteLine('held')\n[Console]::Out.Flush()\n[Console]::In.ReadLine() | Out-Null\n$s.Dispose()",
  );
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Target",
      path,
    ],
    { windowsHide: true },
  );
  const released = new Promise((resolve) => holder.once("exit", resolve));
  await new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.stdout.once("data", () => resolve());
  });
  return async () => {
    holder.stdin.end("\n");
    await released;
  };
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
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: {
        output: { totalBytes: 2_500 },
        pastedText: { totalBytes: 2_500 },
        toolPictures: { totalBytes: 2_500 },
      },
    });
    time.daysAgo(3);
    const paste = await kept(sessions, "pastedText", "task-1", "p".repeat(900));
    time.today();
    const picture = await sessions.savePicture("task-1", {
      mediaType: "image/png",
      data: "A".repeat(900),
    });
    time.daysAgo(2);
    const oldest = await kept(sessions, "output", "task-1", "a".repeat(1_000));
    time.daysAgo(1);
    const middle = await kept(sessions, "output", "task-2", "b".repeat(1_000));
    time.today();

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
    const time = clock();
    const sessions = new FileSessions(root, { now: time.now });
    time.daysAgo(31);
    const output = await kept(sessions, "output", "task-1", "old output");
    time.daysAgo(400);
    const paste = await kept(sessions, "pastedText", "task-1", "old paste");
    time.today();

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

  it("gives two pastes kept at the same moment a name each, and each its own text", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      now: () => new Date("2026-09-23T14:05:12.000Z"),
    });
    const first = "first paste ".repeat(2_000);
    const second = "second paste ".repeat(2_000);

    const [a, b] = await Promise.all([
      sessions.keep("pastedText", undefined, { text: first }),
      sessions.keep("pastedText", undefined, { text: second }),
    ]);

    expect(a.id).not.toBe(b.id);
    const located = await Promise.all(
      [a.id, b.id].map((id) => sessions.locate("pastedText", undefined, id)),
    );
    const texts = await Promise.all(
      located.map((item) =>
        item.status === "ready" ? readFile(item.path, "utf8") : item.reason,
      ),
    );
    expect(texts).toEqual([first, second]);
  });

  it("never gives a removed paste's name to a new one, so the old name still says it was removed", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root, {
      now: () => new Date("2026-09-23T14:05:12.000Z"),
      kept: { pastedText: { totalBytes: 2_500 } },
    });
    const removed = await kept(
      sessions,
      "pastedText",
      "task-1",
      "a".repeat(1_000),
    );
    await kept(sessions, "pastedText", "task-1", "b".repeat(1_000));
    await kept(sessions, "pastedText", "task-1", "c".repeat(1_000));

    const newest = await kept(
      sessions,
      "pastedText",
      "task-1",
      "d".repeat(1_000),
    );

    expect(newest).not.toBe(removed);
    expect(await sessions.locate("pastedText", "task-1", removed)).toEqual({
      status: "missing",
      reason: "This pasted text was deleted to save disk space.",
    });
    expect(
      await readFile(
        await pathOf(sessions, "pastedText", "task-1", newest),
        "utf8",
      ),
    ).toBe("d".repeat(1_000));
  });

  it("removes an old item by the age the store gave it, after a restart too", async () => {
    const root = await temporaryRoot();
    const time = clock();
    time.daysAgo(31);
    const old = await kept(
      new FileSessions(root, { now: time.now }),
      "output",
      "task-1",
      "old output",
    );
    time.today();

    const relaunched = new FileSessions(root, { now: time.now });
    await kept(relaunched, "output", "task-1", "new output");

    expect(await relaunched.locate("output", "task-1", old)).toEqual({
      status: "missing",
      reason: "This saved output was deleted to save disk space.",
    });
  });

  it("removes a paste sent with a message by its new place when room is needed", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { pastedText: { totalBytes: 1_500 } },
    });
    time.daysAgo(1);
    const sent = await kept(
      sessions,
      "pastedText",
      undefined,
      "a".repeat(1_000),
    );
    await sessions.claimDrafts("task-1", [sent]);
    time.today();

    await kept(sessions, "pastedText", "task-1", "b".repeat(1_000));

    expect(await sessions.locate("pastedText", "task-1", sent)).toEqual({
      status: "missing",
      reason: "This pasted text was deleted to save disk space.",
    });
  });

  it("keeps a new item while an old one another program holds cannot be removed, and removes that one later", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { output: { totalBytes: 1_500 } },
    });
    time.daysAgo(1);
    const held = await kept(sessions, "output", "task-1", "a".repeat(1_000));
    time.today();
    const path = await pathOf(sessions, "output", "task-1", held);
    const release = await holdWithoutSharing(root, path);

    let newer: string;
    try {
      newer = await kept(sessions, "output", "task-1", "b".repeat(1_000));
    } finally {
      await release();
    }
    expect(
      await readFile(await pathOf(sessions, "output", "task-1", newer), "utf8"),
    ).toBe("b".repeat(1_000));
    await kept(sessions, "output", "task-1", "c".repeat(100));

    expect(await sessions.locate("output", "task-1", held)).toEqual({
      status: "missing",
      reason: "This saved output was deleted to save disk space.",
    });
  });

  it("keeps a new item while an old removal note another program holds cannot be removed", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { output: { totalBytes: 1_500 } },
    });
    time.daysAgo(60);
    await kept(sessions, "output", "task-1", "a".repeat(1_000));
    await kept(sessions, "output", "task-1", "b".repeat(1_000));
    time.today();
    const note = (await readdir(root, { recursive: true })).find((name) =>
      name.endsWith(".removed"),
    );
    if (!note) throw new Error("No removal note was written.");
    const release = await holdWithoutSharing(root, join(root, note));

    let newer: string;
    try {
      newer = await kept(sessions, "output", "task-1", "c".repeat(100));
    } finally {
      await release();
    }
    expect(
      await readFile(await pathOf(sessions, "output", "task-1", newer), "utf8"),
    ).toBe("c".repeat(100));
  });

  it("keeps one more picture in a store of thousands without reading them all again", async () => {
    const root = await temporaryRoot();
    // 100 conversations' screenshots, five each, with twenty notes of
    // pictures that made room.
    for (let owner = 0; owner < 100; owner += 1) {
      const folder = join(root, "kept", "tool-pictures", `c-task-${owner}`);
      await mkdir(folder, { recursive: true });
      await Promise.all([
        ...Array.from({ length: 5 }, (_, item) =>
          writeFile(join(folder, `picture-${item}`), "{}"),
        ),
        ...Array.from({ length: 20 }, (_, item) =>
          writeFile(join(folder, `gone-${item}.removed`), "{}"),
        ),
      ]);
    }
    const sessions = new FileSessions(root);
    const picture = { mediaType: "image/png", data: "QUJDRA==" };
    await sessions.savePicture("task-1", picture);

    const started = performance.now();
    for (let count = 0; count < 20; count += 1)
      await sessions.savePicture("task-1", picture);
    const each = (performance.now() - started) / 20;

    expect(each).toBeLessThan(25);
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

  it("counts the room a deleted conversation freed, so another's older item stays", async () => {
    const root = await temporaryRoot();
    const time = clock();
    const sessions = new FileSessions(root, {
      now: time.now,
      kept: { output: { totalBytes: 2_500 } },
    });
    time.daysAgo(3);
    const older = await kept(sessions, "output", "task-2", "x".repeat(1_000));
    time.today();
    await kept(sessions, "output", "task-1", "a".repeat(1_000));
    await kept(sessions, "output", "task-1", "b".repeat(400));

    await sessions.forgetConversation("task-1");
    await kept(sessions, "output", "task-3", "c".repeat(1_000));

    expect((await sessions.locate("output", "task-2", older)).status).toBe(
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

describe("a paste sent with its message", () => {
  const second = new Date("2026-09-23T14:05:12.000Z");

  it("never takes the name of a paste the conversation already holds", async () => {
    const sessions = new FileSessions(await temporaryRoot(), {
      now: () => second,
    });
    const first = await kept(sessions, "pastedText", undefined, "first");
    const [held] = await sessions.claimDrafts("task-1", [first]);
    const next = await kept(sessions, "pastedText", undefined, "second");

    const [claimed] = await sessions.claimDrafts("task-1", [next]);

    expect(claimed!.id).not.toBe(held!.id);
    expect(
      await readFile(
        await pathOf(sessions, "pastedText", "task-1", held!.id),
        "utf8",
      ),
    ).toBe("first");
    expect(
      await readFile(
        await pathOf(sessions, "pastedText", "task-1", claimed!.id),
        "utf8",
      ),
    ).toBe("second");
  });

  it("keeps both of two pastes claimed at the same moment for the same name", async () => {
    const sessions = new FileSessions(await temporaryRoot(), {
      now: () => second,
    });
    const first = await kept(sessions, "pastedText", undefined, "first");
    await sessions.claimDrafts("task-1", [first]);
    // Kept at the same moment: one takes the name the conversation's paste
    // has, so it moves to the next, which the other already has.
    const again = await kept(sessions, "pastedText", undefined, "again");
    const other = await kept(sessions, "pastedText", undefined, "other");
    expect(again).toBe(first);

    const [[a], [b]] = await Promise.all([
      sessions.claimDrafts("task-1", [again]),
      sessions.claimDrafts("task-1", [other]),
    ]);

    expect(new Set([first, a!.id, b!.id]).size).toBe(3);
    const text = (id: string) =>
      pathOf(sessions, "pastedText", "task-1", id).then((path) =>
        readFile(path, "utf8"),
      );
    expect(await text(first)).toBe("first");
    expect(await text(a!.id)).toBe("again");
    expect(await text(b!.id)).toBe("other");
  });

  it("never takes the name of a paste the conversation lost to save space", async () => {
    let now = second;
    const sessions = new FileSessions(await temporaryRoot(), {
      now: () => now,
      kept: { pastedText: { totalBytes: 1_500 } },
    });
    const first = await kept(
      sessions,
      "pastedText",
      undefined,
      "a".repeat(1_000),
    );
    await sessions.claimDrafts("task-1", [first]);
    now = new Date(second.getTime() + 5_000);
    // Room for one: the first paste goes.
    await kept(sessions, "pastedText", "task-1", "b".repeat(1_000));
    now = second;
    const again = await kept(
      sessions,
      "pastedText",
      undefined,
      "c".repeat(1_000),
    );
    expect(again).toBe(first);

    const [claimed] = await sessions.claimDrafts("task-1", [again]);

    expect(claimed!.id).not.toBe(first);
    expect(await sessions.locate("pastedText", "task-1", first)).toEqual({
      status: "missing",
      reason: "This pasted text was deleted to save disk space.",
    });
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

  it("leaves nothing behind when the record of reads cannot be saved", async () => {
    const root = await temporaryRoot();
    const read = {
      modifiedMs: 1_700_000_000_000,
      size: 42,
      readAt: "2026-09-23T10:00:00.000Z",
    };
    const sessions = new FileSessions(root);
    await sessions.noteRead("task-1", "notes.md", read);
    const reads = join(root, "kept", "file-reads");
    const [record] = await readdir(reads);
    // A folder holding a file now stands where the record goes, and no file
    // can replace it.
    await rm(join(reads, record!));
    await mkdir(join(reads, record!));
    await writeFile(join(reads, record!, "inside.txt"), "kept");

    await expect(
      sessions.noteRead("task-1", "other.md", read),
    ).rejects.toThrow();

    expect(await readdir(reads)).toEqual([record]);
    expect(await readdir(join(reads, record!))).toEqual(["inside.txt"]);
  });

  it("is remembered for every file when reads finish together", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    const read = {
      modifiedMs: 1_700_000_000_000,
      size: 42,
      readAt: "2026-09-23T10:00:00.000Z",
    };
    const paths = ["one.md", "two.md", "three.md", "four.md"];

    await Promise.all(
      paths.map((path) => sessions.noteRead("task-1", path, read)),
    );

    for (const path of paths)
      expect(await sessions.lastRead("task-1", path)).toEqual(read);
  });

  it("keeps the digest and shown ranges for an interrupted conversation", async () => {
    const root = await temporaryRoot();
    const read = {
      modifiedMs: 1_700_000_000_000,
      size: 42,
      readAt: "2026-09-23T10:00:00.000Z",
      digest: "abc123",
      ranges: [{ first: 1, last: 20 }],
      totalLines: 40,
    };
    await new FileSessions(root).noteRead("task-1", "C:/work/notes.md", read);
    expect(
      await new FileSessions(root).lastRead("task-1", "C:/work/notes.md"),
    ).toEqual(read);
  });
});

describe("what a deleted conversation kept", () => {
  const withConversation = (...ids: string[]) => ({
    recentWorkspaces: [],
    selectedTaskId: ids[0] ?? null,
    tasks: ids.map((id) => ({
      id,
      title: id,
      titleSource: "generated" as const,
      updatedAt: "2026-09-23T10:00:00.000Z",
      updatedLabel: "Now",
      messages: [],
      ...emptyConversationLists,
      phase: { kind: "draft" as const },
    })),
  });

  it("is cleared at the next launch when Zhiyin closed before clearing it", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.claim();
    await sessions.saveWorkspace(withConversation("task-1"));
    const paste = await kept(sessions, "pastedText", "task-1", "paste");
    await sessions.forgetConversation("task-1");
    // The save that deleted the conversation's folder ran; Zhiyin closed
    // before what the conversation kept was cleared.
    await rm(conversationFolder(root, "task-1"), { recursive: true });
    await sessions.release();

    const next = new FileSessions(root);
    await next.claim();

    expect((await next.locate("pastedText", "task-1", paste)).status).toBe(
      "missing",
    );
  });

  it("leaves nothing behind when the note of a deletion cannot be written", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.claim();
    await sessions.saveWorkspace(withConversation("task-1"));
    // The note's place holds a folder, which no file replaces.
    await mkdir(join(root, "kept", "forgetting.json"), { recursive: true });
    await writeFile(join(root, "kept", "forgetting.json", "blocker"), "");

    await expect(sessions.forgetConversation("task-1")).rejects.toThrow();

    expect(await readdir(join(root, "kept"))).toEqual(["forgetting.json"]);
  });

  it("comes back with its conversation when the deletion was never saved", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.claim();
    await sessions.saveWorkspace(withConversation("task-1"));
    const paste = await kept(sessions, "pastedText", "task-1", "paste");
    await sessions.forgetConversation("task-1");
    await sessions.release();

    const next = new FileSessions(root);
    await next.claim();

    expect((await next.locate("pastedText", "task-1", paste)).status).toBe(
      "ready",
    );
  });
});
