import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WorkspaceTools,
  type ConversationItems,
  type FileRead,
} from "../src/index.js";

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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
    await writeFile(join(root, "report.txt"), "Owner's draft.");
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const write = { path: "report.txt", text: "Assistant's draft." };

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

  it("refuses an edit after someone changes the file following the read", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
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
        { path: "report.txt", text: "Final draft." },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("allows the model to revise a complete file it just created", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    expect(
      await tools.execute(
        "write_file",
        { path: "new.txt", text: "First." },
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await tools.inspect(
        "write_file",
        { path: "new.txt", text: "Revised." },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("still knows the whole of a file it wrote after reading a few of its lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const text = [
      "#set par(leading: 0.8em)",
      ...Array.from({ length: 200 }, (_, n) => `line ${n}`),
    ].join("\n");
    await tools.execute(
      "write_file",
      { path: "card.typ", text },
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
    await writeFile(join(root, "long.txt"), "line\n".repeat(2_100));
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    await tools.execute(
      "read_file",
      { path: "long.txt" },
      undefined,
      "conversation-1",
    );
    expect(
      await tools.inspect(
        "write_file",
        { path: "long.txt", text: "Replacement" },
        "conversation-1",
      ),
    ).toMatchObject({ ok: false, correctable: true });
    await tools.execute(
      "read_file",
      { path: "long.txt", startLine: 2_001 },
      undefined,
      "conversation-1",
    );
    expect(
      await tools.inspect(
        "write_file",
        { path: "long.txt", text: "Replacement" },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("allows a partial multi_edit only where the model saw the replaced lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
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
    ).toMatchObject({
      ok: false,
      correctable: true,
    });
    await tools.execute(
      "read_file",
      { path: "long.txt", startLine: 2_001 },
      undefined,
      "conversation-1",
    );
    expect(
      await tools.inspect("multi_edit", last, "conversation-1"),
    ).toMatchObject({ ok: true });
  });

  it("lets the model edit a file again after its own edit, without re-reading it", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
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

  it("after its own edit, keeps unseen lines unseen and shifts seen ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-seen-"));
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
    ).toMatchObject({ ok: false, correctable: true });
  });
});
