/**
 * Reading several workspace files in one call, so looking at five small files
 * costs one request rather than five. The files share what one answer may
 * hold; a file that does not fit says where to continue, and one that cannot
 * be read does not stop the others.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimatedTokens } from "@zhiyin/contract";
import {
  WorkspaceTools,
  type ConversationItems,
  type FileRead,
} from "../src/index.js";

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-read-files-"));
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
    ).toMatchObject({ ok: true, access: "read", scope: "workspace" });
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
        { path: "b.md", text: "Bravo, revised." },
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
