import { copyFile, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimatedTokens } from "@zhiyin/contract";
import {
  WorkspaceTools,
  type ConversationItems,
  type FileRead,
  type ToolResult,
} from "../src/index.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zhiyin-read-"));
}

function numberedLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${index + 1}: the quick brown fox`,
  ).join("\n");
}

function textOf(result: ToolResult): string {
  if (!result.ok) throw new Error(result.reason);
  return (result.value as { text: string }).text;
}

describe("reading a file", () => {
  it("reads a short file whole, each line numbered", async () => {
    const root = await workspace();
    await writeFile(join(root, "note.md"), "Short and whole.\nSecond.", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "note.md" });

    expect(result).toMatchObject({
      ok: true,
      value: { text: "1→Short and whole.\n2→Second.", totalLines: 2 },
    });
  });

  it("reads line 9,000 of a 20,000-line file", async () => {
    const root = await workspace();
    await writeFile(join(root, "log.txt"), numberedLines(20_000), "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", {
      path: "log.txt",
      startLine: 9_000,
      lineCount: 1,
    });

    expect(textOf(result).split("\n")[0]).toBe(
      "9000→line 9000: the quick brown fox",
    );
    expect(textOf(result)).toContain(
      "lines 9001–20,000 not shown; call read_file with startLine=9001",
    );
  });

  it("reads a long file a page at a time, and says where the next page starts", async () => {
    const root = await workspace();
    // Lines short enough that 2,000 of them fit the token limit.
    await writeFile(
      join(root, "log.txt"),
      Array.from({ length: 20_000 }, () => "x").join("\n"),
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(await tools.execute("read_file", { path: "log.txt" }));

    const shown = text.split("\n").filter((line) => /^\d+→/.test(line));
    expect(shown[0]).toBe("1→x");
    expect(shown).toHaveLength(2_000);
    expect(
      text.endsWith(
        "… lines 2001–20,000 not shown; call read_file with startLine=2001",
      ),
    ).toBe(true);
  });

  it.each([
    ["Chinese", "测试中文内容的阅读限制"],
    ["English", "reading limits in English"],
  ])(
    "returns at most the token limit per read of a 60,000-character %s file",
    async (_, phrase) => {
      const root = await workspace();
      const line = phrase.repeat(Math.ceil(100 / phrase.length)).slice(0, 100);
      await writeFile(
        join(root, "doc.txt"),
        Array.from({ length: 600 }, () => line).join("\n"),
        "utf8",
      );
      const tools = new WorkspaceTools(root);

      const text = textOf(
        await tools.execute("read_file", { path: "doc.txt" }),
      );

      expect(estimatedTokens(text)).toBeLessThanOrEqual(8_000);
      expect(text).toContain("not shown; call read_file with startLine=");
    },
  );

  it("cuts a line too long to read whole, and says how much was left out", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "min.js"),
      `a${"x".repeat(9_999)}\nnext`,
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(await tools.execute("read_file", { path: "min.js" }));

    expect(text).toContain("… 8,000 more characters on this line");
    expect(text).toContain("2→next");
  });

  it("reads a text file larger than 2 MB, a page at a time", async () => {
    const root = await workspace();
    await writeFile(join(root, "big.log"), numberedLines(120_000), "utf8");
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", {
        path: "big.log",
        startLine: 119_999,
      }),
    );

    expect(text).toBe(
      "119999→line 119999: the quick brown fox\n120000→line 120000: the quick brown fox",
    );
  });

  it("refuses a file that is not text, and says what it is instead", async () => {
    const root = await workspace();
    // A PNG header, then bytes no text file would contain.
    await writeFile(
      join(root, "shot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]),
    );
    await writeFile(
      join(root, "app.bin"),
      Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00, 0x03]),
    );
    const tools = new WorkspaceTools(root);

    const picture = await tools.execute("read_file", { path: "shot.png" });
    const binary = await tools.execute("read_file", { path: "app.bin" });

    // A picture is not unreadable, it is read by something else.
    expect(picture).toMatchObject({ ok: false });
    if (picture.ok) throw new Error("A picture is not text");
    expect(picture.reason).toContain("read_document");
    expect(binary).toMatchObject({ ok: false });
    if (binary.ok) throw new Error("A binary is not text");
    expect(binary.reason).toMatch(/not a text file/i);
  });

  it("reads a text file that merely contains unusual characters", async () => {
    const root = await workspace();
    await writeFile(join(root, "notes.md"), "Grüße — ok\ttabbed\r\n", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "notes.md" });

    expect(result).toMatchObject({ ok: true });
  });
});

describe("a call the model got wrong in shape", () => {
  it("is answered to the model rather than shown as a failed action", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    // A malformed call is a fact about the request, not about authority: the
    // model can fix it, and a person watching learns nothing from being told.
    // Leaving the workspace is never correctable, however it arose.
    expect(await tools.inspect("list_directory", {})).toMatchObject({
      ok: false,
      correctable: true,
    });
    expect(await tools.inspect("read_file", {})).toMatchObject({
      ok: false,
      correctable: true,
    });
    expect(await tools.inspect("write_file", { path: "a.txt" })).toMatchObject({
      ok: false,
      correctable: true,
    });
    const outside = await tools.inspect("write_file", {
      path: "../outside.txt",
      text: "x",
    });
    expect(outside.ok).toBe(false);
    expect((outside as { correctable?: boolean }).correctable).not.toBe(true);
  });
});

/** What the application keeps for each conversation, held in memory. */
function keptItems(root: string) {
  const items = new Map<string, string>();
  const reads = new Map<string, FileRead>();
  const port: ConversationItems = {
    locate: async (conversationId, kind, id) => {
      const path = items.get(`${conversationId}/${kind}/${id}`);
      return path
        ? { status: "ready", path }
        : { status: "missing", reason: "This output is no longer stored." };
    },
    keepOutput: async (conversationId, file) => {
      const id = `out-${items.size + 1}`;
      const path = join(root, `${id}.txt`);
      await copyFile(file, path);
      items.set(`${conversationId}/output/${id}`, path);
      return { status: "kept", id };
    },
    lastRead: async (conversationId, path) =>
      reads.get(`${conversationId}/${path}`),
    noteRead: async (conversationId, path, read) => {
      reads.set(`${conversationId}/${path}`, read);
    },
  };
  return {
    port,
    async put(
      conversationId: string,
      kind: "output" | "attachment",
      id: string,
      text: string,
    ) {
      const path = join(root, `${kind}-${id}`);
      await writeFile(path, text, "utf8");
      items.set(`${conversationId}/${kind}/${id}`, path);
    },
  };
}

describe("reading what a conversation kept", () => {
  it("reads a saved output by its id, a page at a time, within its own conversation only", async () => {
    const root = await workspace();
    const kept = keptItems(await workspace());
    await kept.put("task-1", "output", "abc", numberedLines(5_000));
    const tools = new WorkspaceTools(root, { items: kept.port });

    const page = await tools.execute(
      "read_file",
      { path: "output://abc", startLine: 2_500, lineCount: 2 },
      undefined,
      "task-1",
    );
    const elsewhere = await tools.execute(
      "read_file",
      { path: "output://abc" },
      undefined,
      "task-2",
    );

    expect(textOf(page).split("\n").slice(0, 2)).toEqual([
      "2500→line 2500: the quick brown fox",
      "2501→line 2501: the quick brown fox",
    ]);
    expect(elsewhere).toEqual({
      ok: false,
      reason: "This output is no longer stored.",
    });
  });

  it("reads a pasted text by its attachment id, without asking", async () => {
    const root = await workspace();
    const kept = keptItems(await workspace());
    await kept.put("task-1", "attachment", "pasted-1.txt", "The pasted log.");
    const tools = new WorkspaceTools(root, { items: kept.port });

    expect(
      await tools.inspect("read_file", { path: "attachment://pasted-1.txt" }),
    ).toMatchObject({ scope: "workspace", access: "read" });
    expect(
      textOf(
        await tools.execute(
          "read_file",
          { path: "attachment://pasted-1.txt" },
          undefined,
          "task-1",
        ),
      ),
    ).toBe("1→The pasted log.");
  });

  it("says a file changed since the last read, and still reads it", async () => {
    const root = await workspace();
    await writeFile(join(root, "log.txt"), numberedLines(3_000), "utf8");
    const tools = new WorkspaceTools(root, {
      items: keptItems(await workspace()).port,
    });
    const first = await tools.execute(
      "read_file",
      { path: "log.txt" },
      undefined,
      "task-1",
    );
    await writeFile(join(root, "log.txt"), numberedLines(3_100), "utf8");
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "log.txt"), later, later);

    const second = await tools.execute(
      "read_file",
      { path: "log.txt", startLine: 2_001 },
      undefined,
      "task-1",
    );
    const unchanged = await tools.execute(
      "read_file",
      { path: "log.txt", startLine: 3_001 },
      undefined,
      "task-1",
    );

    expect(textOf(first)).not.toContain("changed since your last read");
    expect(textOf(second)).toMatch(
      /^This file changed since your last read at .+; earlier pages may be out of date\.\n2001→line 2001/,
    );
    expect(textOf(unchanged)).not.toContain("changed since your last read");
  });
});

describe("a conversation without a folder", () => {
  it("can read what it kept, and nothing from a folder", async () => {
    const kept = keptItems(await workspace());
    await kept.put("task-1", "attachment", "pasted-1.txt", "The pasted log.");
    const tools = new WorkspaceTools(undefined, {
      shell: undefined,
      items: kept.port,
    });

    expect(tools.list().map((tool) => tool.name)).toContain("read_file");
    expect(tools.list().map((tool) => tool.name)).not.toContain(
      "list_directory",
    );
    expect(
      textOf(
        await tools.execute(
          "read_file",
          { path: "attachment://pasted-1.txt" },
          undefined,
          "task-1",
        ),
      ),
    ).toBe("1→The pasted log.");
    expect(
      await tools.execute(
        "read_file",
        { path: "notes.md" },
        undefined,
        "task-1",
      ),
    ).toEqual({ ok: false, reason: "Choose a folder before using files." });
  });
});
