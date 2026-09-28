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
});
