/**
 * Moving and renaming files and folders, inside the workspace and across its
 * edge.
 *
 * A move is declared at both ends before anyone approves it: each file it
 * takes away, with where it goes, and each file it puts there, so recovery can
 * put the first back and take the second away. A move that reaches outside the
 * workspace names the whole real path there and is asked about every time.
 */

import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileRead } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools, type ConversationItems } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(): Promise<string> {
  const root = await realpath(await folders.make("zhiyin-move-"));
  await writeFile(join(root, "notes.md"), "Notes.\n");
  await mkdir(join(root, "drafts", "old"), { recursive: true });
  await writeFile(join(root, "drafts", "a.md"), "Draft A.\n");
  await writeFile(join(root, "drafts", "old", "b.md"), "Draft B.\n");
  return root;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function rememberedReads(): ConversationItems {
  const reads = new Map<string, FileRead>();
  return {
    locate: async () => ({ status: "missing", reason: "Not stored." }),
    keepOutput: async () => ({ status: "refused", reason: "Not stored." }),
    lastRead: async (conversationId, path) =>
      reads.get(`${conversationId}/${path}`),
    noteRead: async (conversationId, path, read) => {
      reads.set(`${conversationId}/${path}`, read);
    },
  };
}

describe("move_file inside the workspace", () => {
  it("says in its description how many files one call moves", async () => {
    const tools = new WorkspaceTools(await workspace());

    expect(
      tools.list().find((tool) => tool.name === "move_file")?.description,
    ).toContain(
      "One call moves at most 5,000 files, counting everything in the folders it moves.",
    );
  });

  it("renames a file, declaring both ends before approval", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const move = { from: "notes.md", to: "Notes for Lin.md" };

    const inspection = await tools.inspect("move_file", move);

    expect(inspection).toMatchObject({
      ok: true,
      action: "Rename notes.md to Notes for Lin.md",
      target: "notes.md",
      effects: expect.objectContaining({ changes: "workspace" }),
      changes: [
        { path: "notes.md", change: "moved", to: "Notes for Lin.md" },
        { path: "Notes for Lin.md", change: "created", from: "notes.md" },
      ],
    });
    // Inside the workspace a move can be undone, so a grant may cover it.
    expect(inspection).not.toHaveProperty("asksEachTime");

    expect(await tools.execute("move_file", move)).toMatchObject({ ok: true });
    expect(await exists(join(root, "notes.md"))).toBe(false);
    expect(await readFile(join(root, "Notes for Lin.md"), "utf8")).toBe(
      "Notes.\n",
    );
  });

  it("moves a file into a folder it creates, and says it creates it", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const move = { from: "notes.md", to: "archive/2026/notes.md" };

    expect(await tools.inspect("move_file", move)).toMatchObject({
      ok: true,
      action: "Move notes.md to archive/2026/notes.md",
      changes: [
        { path: "notes.md", change: "moved", to: "archive/2026/notes.md" },
        {
          path: "archive/2026/notes.md",
          change: "created",
          from: "notes.md",
          createdFolder: "archive/2026",
        },
      ],
    });
    expect(await tools.execute("move_file", move)).toMatchObject({ ok: true });
    expect(
      await readFile(join(root, "archive", "2026", "notes.md"), "utf8"),
    ).toBe("Notes.\n");
  });

  it("moves a folder with everything in it, declaring each file", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const move = { from: "drafts", to: "kept/drafts" };

    const inspection = await tools.inspect("move_file", move);

    expect(inspection).toMatchObject({
      ok: true,
      action: "Move drafts to kept/drafts",
    });
    const changes = inspection.ok ? (inspection.changes ?? []) : [];
    expect(
      changes.map((change) => `${change.change} ${change.path}`).sort(),
    ).toEqual([
      "created kept/drafts/a.md",
      "created kept/drafts/old/b.md",
      "moved drafts/a.md",
      "moved drafts/old/b.md",
    ]);
    expect(await tools.execute("move_file", move)).toMatchObject({ ok: true });
    expect(await exists(join(root, "drafts"))).toBe(false);
    expect(
      await readFile(join(root, "kept", "drafts", "old", "b.md"), "utf8"),
    ).toBe("Draft B.\n");
  });

  it("makes several moves in one call", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const moves = {
      moves: [
        { from: "notes.md", to: "kept/notes.md" },
        { from: "drafts/a.md", to: "kept/a.md" },
      ],
    };

    expect(await tools.inspect("move_file", moves)).toMatchObject({
      ok: true,
      action: "Move 2 items",
      target: "2 items",
    });
    expect(await tools.execute("move_file", moves)).toMatchObject({ ok: true });
    expect((await readdir(join(root, "kept"))).sort()).toEqual([
      "a.md",
      "notes.md",
    ]);
  });

  it("takes a whole path that leads into the workspace as the workspace's", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const move = { from: join(root, "notes.md"), to: join(root, "kept.md") };

    const inspection = await tools.inspect("move_file", move);

    expect(inspection).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "workspace" }),
      changes: [
        { path: "notes.md", change: "moved", to: "kept.md" },
        { path: "kept.md", change: "created", from: "notes.md" },
      ],
    });
    expect(inspection).not.toHaveProperty("asksEachTime");
  });

  it("changes only the letter case of a name", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.execute("move_file", { from: "notes.md", to: "Notes.md" }),
    ).toMatchObject({ ok: true });
    expect(await readdir(root)).toContain("Notes.md");
    expect(await readdir(root)).not.toContain("notes.md");
  });

  it("changes only the letter case of a folder's name", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.execute("move_file", { from: "drafts", to: "Drafts" }),
    ).toMatchObject({ ok: true });
    expect(await readdir(root)).toContain("Drafts");
    expect(await readFile(join(root, "Drafts", "a.md"), "utf8")).toBe(
      "Draft A.\n",
    );
  });

  it("carries what the conversation read to the new name", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute("read_file", { path: "notes.md" }, undefined, "c");

    await tools.execute(
      "move_file",
      { from: "notes.md", to: "kept/notes.md" },
      undefined,
      "c",
    );

    // The file is the same file, so an edit there needs no new read.
    expect(
      await tools.execute(
        "multi_edit",
        {
          path: "kept/notes.md",
          replacements: [{ find: "Notes.", replace: "Kept notes." }],
        },
        undefined,
        "c",
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("move_file refuses", () => {
  it("to replace what is already at the destination", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    const refused = await tools.inspect("move_file", {
      from: "notes.md",
      to: "drafts/a.md",
    });

    expect(refused).toMatchObject({ ok: false, correctable: true });
    expect(refused.ok ? "" : refused.reason).toMatch(/already exists/);
    expect(
      await tools.execute("move_file", { from: "notes.md", to: "drafts/a.md" }),
    ).toMatchObject({ ok: false });
    expect(await readFile(join(root, "drafts", "a.md"), "utf8")).toBe(
      "Draft A.\n",
    );
  });

  it("to replace what appeared at the destination after approval", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const move = { from: "notes.md", to: "kept.md" };
    expect(await tools.inspect("move_file", move)).toMatchObject({ ok: true });

    await writeFile(join(root, "kept.md"), "Written meanwhile.\n");

    expect(await tools.execute("move_file", move)).toMatchObject({ ok: false });
    expect(await readFile(join(root, "kept.md"), "utf8")).toBe(
      "Written meanwhile.\n",
    );
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("Notes.\n");
  });

  it("to move a folder holding a link", async () => {
    const root = await workspace();
    const target = await realpath(await folders.make("zhiyin-move-target-"));
    await symlink(target, join(root, "drafts", "linked"), "junction");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", { from: "drafts", to: "kept" }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/link/) });
    expect(await exists(join(root, "drafts", "a.md"))).toBe(true);
  });

  it("to carry more than 5,000 files in one call", async () => {
    const root = await workspace();
    await mkdir(join(root, "many"));
    for (let index = 0; index < 5_001; index += 1)
      await writeFile(join(root, "many", `${index}.txt`), "");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", { from: "many", to: "kept" }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/5,000/) });
  });

  it("a source that does not exist, naming it", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", {
        moves: [
          { from: "notes.md", to: "kept/notes.md" },
          { from: "missing.md", to: "kept/missing.md" },
        ],
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason: "missing.md does not exist.",
    });
  });

  it("a call that gives one move and several", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    const refused = await tools.inspect("move_file", {
      from: "notes.md",
      to: "kept/notes.md",
      moves: [{ from: "drafts/a.md", to: "kept/a.md" }],
    });

    expect(refused).toMatchObject({ ok: false, correctable: true });
    expect(refused.ok ? "" : refused.reason).toMatch(/not both/);
  });

  it("to move a folder into itself", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", {
        from: "drafts",
        to: "drafts/old/drafts",
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/into itself/),
    });
    expect(await exists(join(root, "drafts", "a.md"))).toBe(true);
  });

  it("to move the workspace itself", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", { from: ".", to: "elsewhere" }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/workspace folder itself/),
    });
  });

  it("to move one file twice in one call", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", {
        moves: [
          { from: "drafts", to: "kept" },
          { from: "drafts/a.md", to: "a.md" },
        ],
      }),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("to put two items where Windows sees one place", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", {
        moves: [
          { from: "notes.md", to: "kept/one.md" },
          { from: "drafts/a.md", to: "Kept/One.md" },
        ],
      }),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("to move a link, which would move something else", async () => {
    const root = await workspace();
    const target = await realpath(await folders.make("zhiyin-move-target-"));
    await symlink(target, join(root, "linked"), "junction");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", { from: "linked", to: "moved" }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/link/) });
  });

  it("to move into one of Zhiyin's own folders", async () => {
    const root = await workspace();
    const own = await realpath(await folders.make("zhiyin-own-"));
    const tools = new WorkspaceTools(root, { protect: [own] });

    expect(
      await tools.inspect("move_file", {
        from: "notes.md",
        to: join(own, "notes.md"),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/Zhiyin/) });
    expect(await exists(join(root, "notes.md"))).toBe(true);
  });
});

describe("move_file across the workspace's edge", () => {
  it("moves a file out, named by its whole path and asked every time", async () => {
    const root = await workspace();
    const outside = await realpath(await folders.make("zhiyin-out-"));
    const tools = new WorkspaceTools(root);
    const destination = join(outside, "notes.md");
    const move = { from: "notes.md", to: destination };

    expect(await tools.inspect("move_file", move)).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "elsewhere" }),
      asksEachTime: true,
      changes: [
        { path: "notes.md", change: "moved", to: destination },
        { path: destination, change: "created", from: "notes.md" },
      ],
    });
    expect(await tools.execute("move_file", move)).toMatchObject({ ok: true });
    expect(await exists(join(root, "notes.md"))).toBe(false);
    expect(await readFile(destination, "utf8")).toBe("Notes.\n");
  });

  it("moves a file in from outside", async () => {
    const root = await workspace();
    const outside = await realpath(await folders.make("zhiyin-out-"));
    await writeFile(join(outside, "ticket.pdf"), "%PDF-1.7 ticket");
    const tools = new WorkspaceTools(root);
    const move = { from: join(outside, "ticket.pdf"), to: "trip/ticket.pdf" };

    expect(await tools.inspect("move_file", move)).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "elsewhere" }),
      asksEachTime: true,
    });
    expect(await tools.execute("move_file", move)).toMatchObject({ ok: true });
    expect(await exists(join(outside, "ticket.pdf"))).toBe(false);
    expect(await readFile(join(root, "trip", "ticket.pdf"), "utf8")).toBe(
      "%PDF-1.7 ticket",
    );
  });

  it("refuses to move a folder that holds the workspace", async () => {
    const root = await workspace();
    const parent = join(root, "..");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("move_file", {
        from: parent,
        to: join(parent, "..", "moved-away"),
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/holds the workspace/),
    });
  });
});
