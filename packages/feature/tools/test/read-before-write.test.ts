import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileRead } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools, type ConversationItems } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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

describe("an existing file the model intends to change", () => {
  it("must have been read in this conversation before a replacement is approved", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "report.txt"), "Owner's draft.");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const write = { path: "report.txt", content: "Assistant's draft." };

    expect(
      await tools.inspect("write_file", write, "conversation-1"),
    ).toMatchObject({
      ok: false,
      correctable: true,
    });
    expect(await readFile(join(root, "report.txt"), "utf8")).toBe(
      "Owner's draft.",
    );

    expect(
      await tools.execute(
        "read_file",
        { path: "report.txt" },
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await tools.inspect("write_file", write, "conversation-1"),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await tools.inspect("write_file", write, "conversation-2"),
    ).toMatchObject({
      ok: false,
      correctable: true,
    });
  });

  it("is not counted as read when the round has no room left to show any of it", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "report.txt"), "Owner's draft.");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });

    for (const answerTokens of [0, 40, 100]) {
      const read = await tools.execute(
        "read_file",
        { path: "report.txt" },
        undefined,
        "conversation-1",
        answerTokens,
      );
      expect(read).toMatchObject({
        ok: false,
        reason: expect.stringContaining("next round"),
      });
      const together = await tools.execute(
        "read_files",
        { paths: ["report.txt"] },
        undefined,
        "conversation-1",
        answerTokens,
      );
      expect(JSON.stringify(together)).toContain("next round");
    }
    expect(
      await tools.inspect(
        "write_file",
        { path: "report.txt", content: "Assistant's draft." },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("refuses an edit after someone changes the file following the read", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "report.txt"), "First draft.");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "report.txt" },
      undefined,
      "conversation-1",
    );
    await writeFile(join(root, "report.txt"), "Owner's revised draft.");

    expect(
      await tools.inspect(
        "multi_edit",
        {
          edits: [
            {
              path: "report.txt",
              replacements: [{ find: "Owner's", replace: "Final" }],
            },
          ],
        },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
    expect(await readFile(join(root, "report.txt"), "utf8")).toBe(
      "Owner's revised draft.",
    );
  });

  it("detects a same-size external change even when the timestamp is restored", async () => {
    const root = await folders.make("zhiyin-seen-");
    const path = join(root, "report.txt");
    await writeFile(path, "First draft.");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "report.txt" },
      undefined,
      "conversation-1",
    );
    const before = await stat(path);
    await writeFile(path, "Other draft.");
    await utimes(path, before.atime, before.mtime);

    expect(
      await tools.inspect(
        "write_file",
        { path: "report.txt", content: "Final draft." },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("allows the model to revise a complete file it just created", async () => {
    const root = await folders.make("zhiyin-seen-");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    expect(
      await tools.execute(
        "write_file",
        { path: "new.txt", content: "First." },
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await tools.inspect(
        "write_file",
        { path: "new.txt", content: "Revised." },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("still knows the whole of a file it wrote after reading a few of its lines", async () => {
    const root = await folders.make("zhiyin-seen-");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const text = [
      "#set par(leading: 0.8em)",
      ...Array.from({ length: 200 }, (_, n) => `line ${n}`),
    ].join("\n");
    await tools.execute(
      "write_file",
      { path: "card.typ", content: text },
      undefined,
      "conversation-1",
    );
    // Looking again at a few lines near the end, to fix an error there.
    await tools.execute(
      "read_file",
      { path: "card.typ", startLine: 150, lineCount: 40 },
      undefined,
      "conversation-1",
    );

    expect(
      await tools.inspect(
        "multi_edit",
        {
          edits: [
            {
              path: "card.typ",
              replacements: [
                {
                  find: "#set par(leading: 0.8em)",
                  replace: "#set par(leading: 0.7em)",
                },
              ],
            },
          ],
        },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("does not treat one page of a larger file as a complete read", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "long.txt"), "line\n".repeat(2_100));
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const first = await tools.execute(
      "read_file",
      { path: "long.txt" },
      undefined,
      "conversation-1",
    );
    expect(
      await tools.inspect(
        "write_file",
        { path: "long.txt", content: "Replacement" },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
    // The rest, from where the first page says it goes on.
    const next = Number(
      /call read_file with startLine=(\d+)/.exec(JSON.stringify(first))?.[1],
    );
    await tools.execute(
      "read_file",
      { path: "long.txt", startLine: next },
      undefined,
      "conversation-1",
    );
    expect(
      await tools.inspect(
        "write_file",
        { path: "long.txt", content: "Replacement" },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("counts a file with a long line as read whole once every part was shown, page after page", async () => {
    const root = await folders.make("zhiyin-seen-");
    const paragraph = `${"Une phrase assez longue. ".repeat(100)}Fin du paragraphe.`;
    await writeFile(
      join(root, "essay.md"),
      `# Title\n\n${paragraph}\n\nEnd.\n`,
    );
    const longer = `${"word ".repeat(40_000)}last-word`;
    await writeFile(join(root, "data.txt"), `start\n${longer}\nend\n`);
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = (input: Record<string, unknown>) =>
      tools.execute("read_file", input, undefined, "conversation-1");
    const editing = (path: string, find: string, replace: string) =>
      tools.inspect(
        "multi_edit",
        { edits: [{ path, replacements: [{ find, replace }] }] },
        "conversation-1",
      );
    const replacing = (path: string) =>
      tools.inspect(
        "write_file",
        { path, content: "Replacement" },
        "conversation-1",
      );

    await read({ path: "essay.md" });
    expect(await editing("essay.md", "# Title", "# Titre")).toMatchObject({
      ok: true,
    });
    expect(
      await editing("essay.md", "Fin du paragraphe.", "Fin."),
    ).toMatchObject({ ok: true });
    expect(await replacing("essay.md")).toMatchObject({ ok: true });

    await read({ path: "data.txt" });
    // Any read of the file as it is lets an edit be checked: an exact find
    // cannot be written for text never shown.
    expect(await editing("data.txt", "last-word", "final")).toMatchObject({
      ok: true,
    });
    expect(await replacing("data.txt")).toMatchObject({ ok: false });
    let next: number | undefined = 1;
    while (next !== undefined) {
      const page = await read({
        path: "data.txt",
        startLine: 2,
        ...(next > 1 ? { startCharacter: next } : {}),
      });
      if (!page.ok) throw new Error(page.reason);
      const more = /startCharacter=(\d+)/.exec(
        (page.value as { text: string }).text,
      );
      next = more ? Number(more[1]) : undefined;
      // Not read whole until its last part was.
      if (next !== undefined)
        expect(await replacing("data.txt")).toMatchObject({ ok: false });
    }
    expect(await replacing("data.txt")).toMatchObject({ ok: true });
  });

  it("says where to read on before replacing a file read only in part", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(
      join(root, "data.txt"),
      `start\nunique-head ${"word ".repeat(40_000)}last-word\nend\n`,
    );
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = (input: Record<string, unknown>) =>
      tools.execute("read_file", input, undefined, "conversation-1");
    const replacing = () =>
      tools.inspect(
        "write_file",
        { path: "data.txt", content: "Replacement" },
        "conversation-1",
      );

    await read({ path: "data.txt", startLine: 2 });
    expect(await replacing()).toEqual({
      ok: false,
      correctable: true,
      reason:
        "Read the complete current contents of data.txt before replacing it: read on from its first line. No file was changed.",
    });

    await read({ path: "data.txt" });
    const refused = await replacing();
    expect(refused).toMatchObject({ ok: false, correctable: true });
    if (refused.ok) throw new Error("The first page is not the whole file");
    expect(refused.reason).toMatch(
      /read on from line 2(, character \d+)?\. No file was changed\.$/,
    );
  });

  it("forgets what was read of a file before it changed", async () => {
    const root = await folders.make("zhiyin-seen-");
    const longer = `${"word ".repeat(40_000)}last-word`;
    await writeFile(join(root, "data.txt"), `start\n${longer}\nend\n`);
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = async (input: Record<string, unknown>) => {
      const page = await tools.execute(
        "read_file",
        input,
        undefined,
        "conversation-1",
      );
      if (!page.ok) throw new Error(page.reason);
      return (page.value as { text: string }).text;
    };
    const starts: number[] = [1];
    for (;;) {
      const page = await read({
        path: "data.txt",
        startLine: 2,
        ...(starts.at(-1)! > 1 ? { startCharacter: starts.at(-1) } : {}),
      });
      const more = /startCharacter=(\d+)/.exec(page);
      if (!more) break;
      starts.push(Number(more[1]));
    }
    // Every part but the last was read; then the file changes elsewhere.
    await writeFile(join(root, "data.txt"), `begin\n${longer}\nend\n`);
    await read({ path: "data.txt" });
    await read({ path: "data.txt", startLine: 3 });
    await read({
      path: "data.txt",
      startLine: 2,
      startCharacter: starts.at(-1),
    });

    expect(
      await tools.inspect(
        "write_file",
        { path: "data.txt", content: "Replacement" },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("refuses to replace a file with a line no read can show whole, and says what to use instead", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(
      join(root, "cut.txt"),
      Buffer.concat([
        Buffer.from("caf", "latin1"),
        Buffer.from([0xe9]),
        Buffer.from(`\n${"A".repeat(1_100_000)}\nend\n`, "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = async (input: Record<string, unknown>) => {
      const page = await tools.execute(
        "read_file",
        input,
        undefined,
        "conversation-1",
      );
      if (!page.ok) throw new Error(page.reason);
      return (page.value as { text: string }).text;
    };
    await read({ path: "cut.txt" });
    let next: number | undefined = 1;
    while (next !== undefined) {
      const page = await read({
        path: "cut.txt",
        startLine: 2,
        ...(next > 1 ? { startCharacter: next } : {}),
      });
      const more = /startCharacter=(\d+)/.exec(page);
      next = more ? Number(more[1]) : undefined;
    }
    await read({ path: "cut.txt", startLine: 3 });

    const refused = await tools.inspect(
      "write_file",
      { path: "cut.txt", content: "Replacement" },
      "conversation-1",
    );

    expect(refused).toMatchObject({ ok: false });
    if (refused.ok) throw new Error("A file no read can show whole is refused");
    expect(refused.reason).toContain("first MiB");
    expect(refused.reason).toContain("a command or a script");
  });

  it("allows an edit anywhere in a file read in part, until the file changes", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(
      join(root, "long.txt"),
      [
        "alpha first",
        ...Array.from({ length: 2_098 }, () => "middle"),
        "omega last",
      ].join("\n"),
    );
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "long.txt" },
      undefined,
      "conversation-1",
    );
    const first = {
      edits: [
        {
          path: "long.txt",
          replacements: [{ find: "alpha first", replace: "beta first" }],
        },
      ],
    };
    const last = {
      edits: [
        {
          path: "long.txt",
          replacements: [{ find: "omega last", replace: "final last" }],
        },
      ],
    };
    expect(
      await tools.inspect("multi_edit", first, "conversation-1"),
    ).toMatchObject({ ok: true });
    expect(
      await tools.inspect("multi_edit", last, "conversation-1"),
    ).toMatchObject({ ok: true });

    await writeFile(join(root, "long.txt"), "alpha first\nomega last\n");
    expect(await tools.inspect("multi_edit", last, "conversation-1")).toEqual({
      ok: false,
      correctable: true,
      reason:
        "long.txt changed since you read it. Read it again before changing it. No file was changed.",
    });
  });

  it("asks for a read of a file never read before an edit, naming it", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "notes.txt"), "one\ntwo\n");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });

    expect(
      await tools.inspect(
        "multi_edit",
        {
          edits: [
            {
              path: "notes.txt",
              replacements: [{ find: "one", replace: "1" }],
            },
          ],
        },
        "conversation-1",
      ),
    ).toEqual({
      ok: false,
      correctable: true,
      reason: "Read notes.txt before changing it. No file was changed.",
    });
  });

  it("allows a pattern's replacements in a file read in part, the lines it changes shown for approval", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(
      join(root, "long.txt"),
      [
        "item: alpha",
        ...Array.from({ length: 2_098 }, () => "middle"),
        "item: omega",
      ].join("\n"),
    );
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "long.txt" },
      undefined,
      "conversation-1",
    );
    const every = {
      edits: [
        {
          path: "long.txt",
          replacements: [
            {
              find: "^item: (\\w+)$",
              replace: "entry: $1",
              regex: true,
              replaceAll: true,
            },
          ],
        },
      ],
    };

    const inspected = await tools.inspect(
      "multi_edit",
      every,
      "conversation-1",
    );
    expect(inspected).toMatchObject({ ok: true });
    if (!inspected.ok) throw new Error("A pattern in a read file is allowed");
    const [change] = inspected.changes ?? [];
    expect(JSON.stringify(change)).toContain("entry: omega");
  });

  it("needs no line past a find's own line ending, even at the end of the file", async () => {
    const root = await folders.make("zhiyin-seen-");
    const lines = Array.from({ length: 10 }, (_, index) => `l${index + 1}`);
    await writeFile(join(root, "a.txt"), `${lines.join("\n")}\n`);
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = (input: Record<string, unknown>) =>
      tools.execute("read_file", input, undefined, "conversation-1");
    const editing = (find: string, replace: string) =>
      tools.inspect(
        "multi_edit",
        { edits: [{ path: "a.txt", replacements: [{ find, replace }] }] },
        "conversation-1",
      );

    await read({ path: "a.txt", lineCount: 5 });
    expect(await editing("l5\n", "l5\nl5b\n")).toMatchObject({ ok: true });
    await read({ path: "a.txt", startLine: 6 });
    expect(await editing("l10\n", "l10\nl11\n")).toMatchObject({ ok: true });
  });

  it("allows a replacement of text an earlier one in the same edit wrote on a line that was read", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(
      join(root, "long.txt"),
      [
        "call foo(a) here",
        ...Array.from({ length: 2_100 }, () => "middle"),
        "last",
      ].join("\n"),
    );
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "long.txt", lineCount: 1 },
      undefined,
      "conversation-1",
    );

    expect(
      await tools.inspect(
        "multi_edit",
        {
          edits: [
            {
              path: "long.txt",
              replacements: [
                {
                  find: "call foo(a) here",
                  replace: "call foo(b) here\nand more",
                },
                { find: "foo(b) here\nand", replace: "foo(c) here\nand" },
              ],
            },
          ],
        },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("lets the model edit a file again after its own edit, without re-reading it", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "page.html"), "<h1>Title</h1>\n<p>Body</p>\n");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "page.html" },
      undefined,
      "conversation-1",
    );
    const edit = (find: string, replace: string) => ({
      edits: [{ path: "page.html", replacements: [{ find, replace }] }],
    });

    expect(
      await tools.execute(
        "multi_edit",
        edit("<h1>Title</h1>", "<h1>New title</h1>\n<h2>Subtitle</h2>"),
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await tools.execute(
        "multi_edit",
        edit("<p>Body</p>", "<p>New body</p>"),
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
    expect(await readFile(join(root, "page.html"), "utf8")).toBe(
      "<h1>New title</h1>\n<h2>Subtitle</h2>\n<p>New body</p>\n",
    );
  });

  it("still refuses an edit after its own edit when someone else then changes the file", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(join(root, "notes.txt"), "one\ntwo\n");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "notes.txt" },
      undefined,
      "conversation-1",
    );
    await tools.execute(
      "multi_edit",
      {
        edits: [
          { path: "notes.txt", replacements: [{ find: "one", replace: "1" }] },
        ],
      },
      undefined,
      "conversation-1",
    );
    await writeFile(join(root, "notes.txt"), "1\ntwo\nthree by the owner\n");

    expect(
      await tools.inspect(
        "multi_edit",
        {
          edits: [
            {
              path: "notes.txt",
              replacements: [{ find: "two", replace: "2" }],
            },
          ],
        },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("after its own edit, a file read in part stays read, and replacing it still needs a whole read", async () => {
    const root = await folders.make("zhiyin-seen-");
    await writeFile(
      join(root, "long.txt"),
      [
        "alpha first",
        ...Array.from({ length: 2_098 }, () => "middle"),
        "omega last",
      ].join("\n"),
    );
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    // Shows lines 1–2000 only.
    await tools.execute(
      "read_file",
      { path: "long.txt" },
      undefined,
      "conversation-1",
    );
    await tools.execute(
      "multi_edit",
      {
        edits: [
          {
            path: "long.txt",
            replacements: [
              { find: "alpha first", replace: "added one\nadded two\nalpha" },
            ],
          },
        ],
      },
      undefined,
      "conversation-1",
    );
    const edit = (find: string) => ({
      edits: [{ path: "long.txt", replacements: [{ find, replace: "done" }] }],
    });

    expect(
      await tools.inspect("multi_edit", edit("added two"), "conversation-1"),
    ).toMatchObject({ ok: true });
    expect(
      await tools.inspect("multi_edit", edit("omega last"), "conversation-1"),
    ).toMatchObject({ ok: true });
    expect(
      await tools.inspect(
        "write_file",
        { path: "long.txt", content: "Replacement" },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });
});
