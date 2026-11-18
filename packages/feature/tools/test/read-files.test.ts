/**
 * Reading several workspace files in one call, so looking at five small files
 * costs one request rather than five. The files share what one answer may
 * hold; a file that does not fit says where to continue, and one that cannot
 * be read does not stop the others.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type FileRead } from "@zhiyin/contract";
import { estimatedTokens } from "@zhiyin/context-budget";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools, type ConversationItems } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await folders.make("zhiyin-read-files-");
  for (const [name, text] of Object.entries(files))
    await writeFile(join(root, name), text);
  return root;
}

type Read = {
  readonly files: readonly {
    readonly path: string;
    readonly text?: string;
    readonly lines?: string;
    readonly totalLines?: number;
    readonly error?: string;
  }[];
};

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

describe("read_files", () => {
  it("reads several workspace files in one call, in the order asked, without asking anyone", async () => {
    const root = await workspace({
      "a.md": "Alpha.",
      "b.md": "Bravo.\nSecond line.",
    });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("read_files", { paths: ["b.md", "a.md"] }),
    ).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ reads: "workspace", changes: "none" }),
    });
    const result = await tools.execute("read_files", {
      paths: ["b.md", "a.md"],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          { path: "b.md", text: "1→Bravo.\n2→Second line.", totalLines: 2 },
          { path: "a.md", text: "1→Alpha.", totalLines: 1 },
        ],
      },
    });
  });

  it("says which workspace files a read reads as text, and not what the conversation kept or a file outside", async () => {
    const root = await workspace({ "a.md": "Alpha.", "b.md": "Bravo." });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("read_files", {
        paths: ["b.md", "output://saved-1", "a.md"],
      }),
    ).toMatchObject({ ok: true, readsText: ["b.md", "a.md"] });
    expect(await tools.inspect("read_file", { path: "a.md" })).toMatchObject({
      ok: true,
      readsText: ["a.md"],
    });
    expect(
      await tools.inspect("read_file", { path: "output://saved-1" }),
    ).not.toHaveProperty("readsText");
    expect(
      await tools.inspect("read_file", {
        path: join(root, "..", "outside.md"),
      }),
    ).not.toHaveProperty("readsText");
  });

  it("shares one answer's size among the files, and says where each cut one continues", async () => {
    const long = Array.from(
      { length: 3_000 },
      (_, index) => `Line ${index + 1} of a long report.`,
    ).join("\n");
    const root = await workspace({ "one.txt": long, "two.txt": long });

    const result = await new WorkspaceTools(root).execute("read_files", {
      paths: ["one.txt", "two.txt"],
    });

    if (!result.ok) throw new Error(result.reason);
    const { files } = result.value as Read;
    expect(estimatedTokens(JSON.stringify(result.value))).toBeLessThanOrEqual(
      8_000,
    );
    for (const file of files) {
      expect(file.lines).toMatch(/^1-\d+$/);
      expect(file.text).toMatch(/call read_file with startLine=\d+$/);
    }
  });

  it("gives what a small file leaves unused to the files that were cut", async () => {
    const long = Array.from(
      { length: 3_000 },
      (_, index) => `Line ${index + 1} of a long report.`,
    ).join("\n");
    const root = await workspace({
      "a.txt": "one\ntwo\nthree",
      "big.txt": long,
    });
    const tools = new WorkspaceTools(root);

    const alone = await tools.execute(
      "read_file",
      { path: "big.txt" },
      undefined,
      undefined,
      10_000,
    );
    const together = await tools.execute(
      "read_files",
      { paths: ["a.txt", "big.txt"] },
      undefined,
      undefined,
      10_000,
    );

    if (!alone.ok || !together.ok) throw new Error("not read");
    const lastLine = (lines: unknown) => Number(String(lines).split("-")[1]);
    const shownAlone = lastLine((alone.value as { lines: string }).lines);
    const [small, big] = (together.value as Read).files;
    expect(small?.text).toBe("1→one\n2→two\n3→three");
    // Nine tenths of the answer are shared, so nearly nine tenths of the lines.
    expect(lastLine(big?.lines)).toBeGreaterThan(shownAlone * 0.8);
    expect(estimatedTokens(JSON.stringify(together.value))).toBeLessThanOrEqual(
      10_000,
    );
  });

  it("shares a larger answer when the model will be shown more", async () => {
    const long = Array.from(
      { length: 6_000 },
      (_, index) => `Line ${index + 1} of a long report.`,
    ).join("\n");
    const root = await workspace({ "one.txt": long, "two.txt": long });

    const result = await new WorkspaceTools(root).execute(
      "read_files",
      { paths: ["one.txt", "two.txt"] },
      undefined,
      undefined,
      25_000,
    );

    if (!result.ok) throw new Error(result.reason);
    const size = estimatedTokens(JSON.stringify(result.value));
    expect(size).toBeGreaterThan(20_000);
    expect(size).toBeLessThanOrEqual(25_000);
  });

  it("answers for every file when one of them cannot be read", async () => {
    const root = await workspace({ "a.md": "Alpha." });

    const result = await new WorkspaceTools(root).execute("read_files", {
      paths: ["missing.md", "a.md"],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            path: "missing.md",
            error: "missing.md was not found in this workspace.",
          },
          { path: "a.md", text: "1→Alpha." },
        ],
      },
    });
  });

  it("keeps within the answer it was given when files that cannot be read have long names", async () => {
    const root = await workspace({ "a.txt": "1\n2\n3\n4\n5\n" });
    const long =
      "季度报告资料汇总与分析文件夹第一部分内容和附录材料整理".repeat(16);

    for (const answerTokens of [1_200, 2_400, 5_280]) {
      const result = await new WorkspaceTools(root).execute(
        "read_files",
        { paths: [`${long}1.txt`, "a.txt", `${long}2.txt`, `${long}3.txt`] },
        undefined,
        undefined,
        answerTokens,
      );

      expect(result.ok).toBe(true);
      expect(
        estimatedTokens(JSON.stringify({ ...result, details: undefined })),
      ).toBeLessThanOrEqual(answerTokens);
    }
  });

  it("counts as having read each file before changing it", async () => {
    const root = await workspace({ "a.md": "Alpha.", "b.md": "Bravo." });
    const tools = new WorkspaceTools(root, { items: rememberedReads() });

    await tools.execute(
      "read_files",
      { paths: ["a.md", "b.md"] },
      undefined,
      "conversation-1",
    );

    expect(
      await tools.inspect(
        "write_file",
        { path: "b.md", content: "Bravo, revised." },
        "conversation-1",
      ),
    ).toMatchObject({ ok: true });
  });

  it("reads only inside the workspace, and points elsewhere to read_file", async () => {
    const root = await workspace({});
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("read_files", { paths: ["a.md", "../outside.md"] }),
    ).toEqual({
      ok: false,
      reason:
        "read_files reads only inside the workspace; read ../outside.md with read_file.",
      correctable: true,
    });
    expect(
      await tools.inspect("read_files", { paths: ["a.md", "a.md"] }),
    ).toMatchObject({ ok: false, correctable: true });
  });
});
