/**
 * What a version of Zhiyin does with history saved by another one.
 *
 * Older history is updated only when the person agrees, one conversation at a
 * time, and an update that fails leaves the original as it was. Newer history
 * is refused and left exactly as it is: this version cannot know what it holds,
 * so it must not write over it or offer to start afresh in its place.
 */

import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import {
  FileSessions,
  historyFiles,
  type Formats,
  type HistoryFiles,
  type SavedWorkspace,
} from "../src/index.js";
import {
  conversationFolder,
  historyFolder,
  plantHistory,
  savedSettings,
  settingsFile,
} from "./planted-history.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-formats-"));
  roots.push(root);
  return root;
}

function task(id: string) {
  return {
    id,
    title: `Conversation ${id}`,
    titleSource: "generated" as const,
    updatedAt: `2026-10-0${id.charCodeAt(0) - 96}T09:00:00.000Z`,
    updatedLabel: "Tuesday",
    messages: [
      {
        id: `${id}-m1`,
        role: "user" as const,
        text: "A question",
        sequence: 0,
      },
    ],
    ...emptyConversationLists,
    phase: {
      kind: "completed" as const,
      outcome: { title: "Done", summary: "Done." },
    },
  };
}

function history(...ids: string[]): SavedWorkspace {
  return {
    preferences: { onboarded: true, interests: ["writing"] },
    personalInstructions: "Answer briefly.",
    appearance: "dark",
    selectedTaskId: ids[0] ?? null,
    recentWorkspaces: [],
    tasks: ids.map(task),
  } as SavedWorkspace;
}

/** The first release's format, as Zhiyin 0.1.0-alpha.1 writes it. */
const first = { version: "0.1.0-alpha.1" };

/** A later release whose one change is to how a conversation is titled. */
const retitled: Formats = {
  first: 3,
  steps: [
    {
      conversation: (state) => ({
        ...(state as Record<string, unknown>),
        title: `${(state as { title: string }).title} (format 4)`,
      }),
    },
  ],
};
const later = { version: "0.2.0", formats: retitled };

/** Every file of the history, by where it is, with what it holds. */
async function everything(root: string): Promise<Record<string, string>> {
  const folder = historyFolder(root);
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries.filter((entry) => entry.isFile());
  return Object.fromEntries(
    await Promise.all(
      files.map(async (entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path.slice(folder.length), await readFile(path, "utf8")];
      }),
    ),
  );
}

async function folderBytes(root: string, id: string) {
  const folder = conversationFolder(root, id);
  return Object.fromEntries(
    await Promise.all(
      (await readdir(folder)).map(async (name) => [
        name,
        await readFile(join(folder, name), "utf8"),
      ]),
    ),
  );
}

function firstLine(text: string): Record<string, unknown> {
  return JSON.parse(text.slice(0, text.indexOf("\n"))) as Record<
    string,
    unknown
  >;
}

/** A Recycle Bin that moves what it is given into `bin`, except what it refuses. */
function recycleBinIn(bin: string, refused: readonly string[] = []) {
  const recycled: string[] = [];
  return {
    recycled,
    recyclable: async (paths: readonly string[]) =>
      new Map(paths.map((path) => [path, !refused.includes(basename(path))])),
    recycle: async (path: string) => {
      await mkdir(bin, { recursive: true });
      await rename(path, join(bin, basename(path)));
      recycled.push(basename(path));
    },
  };
}

describe("the format history is saved in", () => {
  it("records the format and the version that wrote it in the settings and every conversation", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);

    expect(await savedSettings(root)).toMatchObject({
      format: 3,
      writtenBy: "0.1.0-alpha.1",
    });
    for (const id of ["a", "b"]) {
      const files = await folderBytes(root, id);
      expect(firstLine(files["conversation.jsonl"]!)).toMatchObject({
        format: 3,
        writtenBy: "0.1.0-alpha.1",
      });
      expect(JSON.parse(files["meta.json"]!)).toMatchObject({
        format: 3,
        writtenBy: "0.1.0-alpha.1",
        id,
      });
    }
  });

  it("applies each step in order, from the format a file was written in", async () => {
    const root = await temporaryRoot();
    const marked = (mark: string) => ({
      conversation: (state: unknown) => ({
        ...(state as Record<string, unknown>),
        title: `${(state as { title: string }).title}${mark}`,
      }),
    });
    await plantHistory(root, history("a"), first);
    // Saved again by a version one step on, alongside the first one's.
    const fourth = new FileSessions(root, {
      version: "0.2.0",
      formats: { first: 3, steps: [marked(" 4")] },
    });
    await fourth.loadIndex();
    await fourth.saveWorkspace({
      ...history("a", "b"),
      tasks: [task("b")],
    } as SavedWorkspace);
    await fourth.release();

    const fifth = new FileSessions(root, {
      version: "0.3.0",
      formats: { first: 3, steps: [marked(" 4"), marked(" 5")] },
    });
    await fifth.loadIndex();
    expect((await fifth.updateConversations()).failed).toBe(0);

    expect((await fifth.openConversation("a")).task.title).toBe(
      "Conversation a 4 5",
    );
    expect((await fifth.openConversation("b")).task.title).toBe(
      "Conversation b 5",
    );
    await fifth.release();
  });
});

describe("history saved by a newer version", () => {
  it("refuses settings in a newer format, names the version that saved them, and changes nothing", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), later);
    const before = await everything(root);

    const older = new FileSessions(root, first);
    const refusal = await older.loadIndex().catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "newer", writtenBy: "0.2.0" });
    expect((refusal as Error).message).toContain("0.2.0");
    await expect(
      older.saveWorkspace(history("c") as SavedWorkspace),
    ).rejects.toMatchObject({ code: "newer" });
    expect(await older.savedAppearance()).toBeUndefined();
    await older.release();

    expect(await everything(root)).toEqual(before);
    expect(await readdir(root)).not.toContain("damaged-history");
  });

  it("leaves out a conversation in a newer format, says which version saved it, and never writes over it", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);
    const elsewhere = await temporaryRoot();
    await plantHistory(elsewhere, history("c"), later);
    await cp(
      conversationFolder(elsewhere, "c"),
      conversationFolder(root, "c"),
      {
        recursive: true,
      },
    );
    const newer = await folderBytes(root, "c");

    const sessions = new FileSessions(root, first);
    const index = await sessions.loadIndex();
    expect(index?.conversations.map((item) => item.id)).toEqual(["b", "a"]);
    expect(index?.newer).toEqual({ count: 1, writtenBy: ["0.2.0"] });
    await sessions.saveWorkspace({
      ...history("a", "b"),
      conversations: index?.conversations,
      tasks: [{ ...task("a"), title: "Renamed" }],
    } as SavedWorkspace);
    await sessions.saveWorkspace({
      ...history(),
      conversations: [],
      tasks: [],
    } as SavedWorkspace);
    await sessions.release();

    expect(await folderBytes(root, "c")).toEqual(newer);
  });
});

describe("history saved by an older version", () => {
  it("updates older settings as it reads them, and writes the current format at the next save", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a"), first);
    const sessions = new FileSessions(root, {
      version: "0.2.0",
      formats: {
        first: 3,
        steps: [
          {
            settings: (settings) => ({
              ...settings,
              personalInstructions: `${String(settings.personalInstructions)} Use French.`,
            }),
          },
        ],
      },
    });

    const index = await sessions.loadIndex();
    expect(index?.personalInstructions).toBe("Answer briefly. Use French.");
    expect(index?.preferences).toEqual({
      onboarded: true,
      interests: ["writing"],
    });
    expect(await savedSettings(root)).toMatchObject({ format: 3 });

    await sessions.saveWorkspace({
      ...index!,
      tasks: [],
    } as SavedWorkspace);
    await sessions.release();
    expect(await savedSettings(root)).toMatchObject({
      format: 4,
      writtenBy: "0.2.0",
      personalInstructions: "Answer briefly. Use French.",
    });
  });

  it("lists a conversation in an older format as needing an update, and does not open it", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);

    const sessions = new FileSessions(root, later);
    const index = await sessions.loadIndex();
    expect(index?.conversations).toEqual([
      expect.objectContaining({
        id: "b",
        title: "Conversation b",
        needsUpdate: { writtenBy: "0.1.0-alpha.1" },
      }),
      expect.objectContaining({
        id: "a",
        title: "Conversation a",
        needsUpdate: { writtenBy: "0.1.0-alpha.1" },
      }),
    ]);
    await expect(sessions.openConversation("a")).rejects.toMatchObject({
      code: "outdated",
    });
    await sessions.release();
  });

  it("lists a conversation needing an update from its log when its summary is missing", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a"), first);
    await rm(join(conversationFolder(root, "a"), "meta.json"));

    const sessions = new FileSessions(root, later);
    expect((await sessions.loadIndex())?.conversations).toEqual([
      expect.objectContaining({
        id: "a",
        title: "Conversation a",
        needsUpdate: { writtenBy: "0.1.0-alpha.1" },
      }),
    ]);
    await sessions.release();
  });

  it("never writes over or removes a conversation waiting for an update", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);
    const waiting = await folderBytes(root, "a");

    const sessions = new FileSessions(root, later);
    const index = await sessions.loadIndex();
    // A task under the waiting conversation's id is never written over it.
    await sessions.saveWorkspace({
      ...index!,
      tasks: [{ ...task("a"), title: "Written over" }],
    } as SavedWorkspace);
    // Nor is it removed by a save that no longer lists it.
    await sessions.saveWorkspace({
      ...index!,
      conversations: [],
      tasks: [],
    } as SavedWorkspace);
    await sessions.release();

    expect(await folderBytes(root, "a")).toEqual(waiting);
  });

  it("updates an older conversation, which then opens and stays updated", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);

    const sessions = new FileSessions(root, later);
    await sessions.loadIndex();
    const result = await sessions.updateConversations();
    expect(result.failed).toBe(0);
    expect(result.updated.map((item) => [item.id, item.title])).toEqual([
      ["b", "Conversation b (format 4)"],
      ["a", "Conversation a (format 4)"],
    ]);
    expect((await sessions.openConversation("a")).task.title).toBe(
      "Conversation a (format 4)",
    );
    await sessions.release();

    const again = new FileSessions(root, later);
    const index = await again.loadIndex();
    expect(index?.conversations.map((item) => item.title)).toEqual([
      "Conversation b (format 4)",
      "Conversation a (format 4)",
    ]);
    expect(index?.conversations.some((item) => item.needsUpdate)).toBe(false);
    expect(
      firstLine((await folderBytes(root, "a"))["conversation.jsonl"]!),
    ).toMatchObject({ format: 4, writtenBy: "0.2.0" });
    await again.release();
  });

  it("leaves a conversation as it was when its migration fails, and says how many", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b", "c"), first);
    const before = {
      b: await folderBytes(root, "b"),
      c: await folderBytes(root, "c"),
    };
    const sessions = new FileSessions(root, {
      version: "0.2.0",
      formats: {
        first: 3,
        steps: [
          {
            conversation: (state) => {
              const { id } = state as { id: string };
              if (id === "b") throw new Error("Not a shape this step knows.");
              // A step that loses a list makes a conversation this version refuses.
              if (id === "c") return { ...(state as object), messages: null };
              return state;
            },
          },
        ],
      },
    });
    await sessions.loadIndex();

    const result = await sessions.updateConversations();
    expect(result.updated.map((item) => item.id)).toEqual(["a"]);
    expect(result.failed).toBe(2);
    expect(await folderBytes(root, "b")).toEqual(before.b);
    expect(await folderBytes(root, "c")).toEqual(before.c);
    const index = await sessions.loadIndex();
    expect(
      index?.conversations
        .filter((item) => item.needsUpdate)
        .map((item) => item.id),
    ).toEqual(["c", "b"]);
    await sessions.release();
  });

  it("leaves the original in place when the updated copy does not read back the same", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a"), first);
    const original = (await folderBytes(root, "a"))["conversation.jsonl"];
    let garbled = false;
    const files: HistoryFiles = {
      ...historyFiles,
      create: (path, text) =>
        historyFiles.create(
          path,
          garbled ? text.replace("(format 4)", "(garbled)") : text,
        ),
    };
    const sessions = new FileSessions(root, { ...later, historyFiles: files });
    await sessions.loadIndex();

    garbled = true;
    const result = await sessions.updateConversations();
    expect(result).toEqual({ updated: [], failed: 1 });
    expect((await folderBytes(root, "a"))["conversation.jsonl"]).toBe(original);
    await expect(sessions.openConversation("a")).rejects.toMatchObject({
      code: "outdated",
    });
    await sessions.release();
  });

  it("moves conversations waiting for an update to the Recycle Bin", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);
    const bin = recycleBinIn(join(root, "bin"));

    const sessions = new FileSessions(root, { ...later, recycleBin: bin });
    await sessions.loadIndex();
    expect(await sessions.recycleOutdatedConversations()).toEqual({
      recycled: ["b", "a"],
      failed: 0,
    });
    expect(bin.recycled.sort()).toEqual(["c-a", "c-b"]);
    expect((await sessions.loadIndex())?.conversations).toEqual([]);
    expect(
      (await readFile(join(root, "bin", "c-a", "conversation.jsonl"), "utf8"))
        .length,
    ).toBeGreaterThan(0);
    await sessions.release();
  });

  it("deletes nothing when Windows would not recycle a conversation", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a", "b"), first);
    const kept = await folderBytes(root, "a");
    const bin = recycleBinIn(join(root, "bin"), ["c-a"]);

    const sessions = new FileSessions(root, { ...later, recycleBin: bin });
    await sessions.loadIndex();
    expect(await sessions.recycleOutdatedConversations()).toEqual({
      recycled: ["b"],
      failed: 1,
    });
    expect(await folderBytes(root, "a")).toEqual(kept);
    await sessions.release();

    const withoutBin = new FileSessions(root, later);
    await withoutBin.loadIndex();
    await expect(
      withoutBin.recycleOutdatedConversations(),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(await folderBytes(root, "a")).toEqual(kept);
    await withoutBin.release();
  });

  it("refuses settings saved in a format before the first release as damaged", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history("a"), first);
    const settings = await savedSettings(root);
    await mkdir(join(settingsFile(root), ".."), { recursive: true });
    await historyFiles.create(
      settingsFile(root),
      JSON.stringify({ ...settings, format: 2 }),
    );

    await expect(
      new FileSessions(root, first).loadIndex(),
    ).rejects.toMatchObject({ code: "corrupted" });
  });
});
