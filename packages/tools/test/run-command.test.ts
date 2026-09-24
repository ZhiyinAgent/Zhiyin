import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimatedTokens } from "@zhiyin/contract";
import {
  resolveShell,
  WorkspaceTools,
  type ConversationItems,
  type ToolResult,
} from "../src/index.js";

const shell = resolveShell();

/** Keeps outputs in a folder of its own, one conversation's at a time. */
async function keptItems(): Promise<ConversationItems> {
  const folder = await mkdtemp(join(tmpdir(), "zhiyin-kept-"));
  const items = new Map<string, string>();
  return {
    locate: async (conversationId, kind, id) => {
      const path = items.get(`${conversationId}/${kind}/${id}`);
      return path
        ? { status: "ready", path }
        : { status: "missing", reason: "Not kept." };
    },
    keepOutput: async (conversationId, file) => {
      const id = `out-${items.size + 1}`;
      const path = join(folder, id);
      await copyFile(file, path);
      items.set(`${conversationId}/output/${id}`, path);
      return { status: "kept", id };
    },
    lastRead: async () => undefined,
    noteRead: async () => undefined,
  };
}

function valueOf(result: ToolResult): Record<string, unknown> {
  if (!result.ok && result.value === undefined) throw new Error(result.reason);
  return result.value as Record<string, unknown>;
}

describe.skipIf(!shell)("a command's output", () => {
  it("returns at most the token limit inline, and keeps the whole of it to read again", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-command-"));
    // 20,000 numbered lines, about 500,000 characters.
    await writeFile(
      join(root, "print.mjs"),
      "for (let i = 1; i <= 20000; i++) process.stdout.write(`line ${i}: ${'x'.repeat(14)}\\n`);",
    );
    const tools = new WorkspaceTools(root, {
      shell,
      items: await keptItems(),
    });
    const node = process.execPath.replaceAll("\\", "/");

    const result = await tools.execute(
      "bash",
      {
        command: `"${node}" print.mjs`,
        explanation: "Prints a long numbered output.",
      },
      undefined,
      "task-1",
    );

    const value = valueOf(result);
    expect(estimatedTokens(JSON.stringify(value))).toBeLessThanOrEqual(8_000);
    expect(value["stdout"]).toContain("line 1: ");
    expect(value["stdout"]).toContain("line 20000: ");
    const saved = /output:\/\/[^;\s]+/.exec(String(value["fullOutput"]))?.[0];
    expect(saved).toBeDefined();

    const middle = await tools.execute(
      "read_file",
      { path: saved, startLine: 10_000, lineCount: 1 },
      undefined,
      "task-1",
    );

    expect(valueOf(middle)["text"]).toMatch(/^10000→line 10000: x{14}\n/);
  }, 60_000);

  it("keeps nothing when the whole output fits", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-command-"));
    const tools = new WorkspaceTools(root, {
      shell,
      items: await keptItems(),
    });

    const value = valueOf(
      await tools.execute(
        "bash",
        { command: "echo short", explanation: "Prints one word." },
        undefined,
        "task-1",
      ),
    );

    expect(value["stdout"]).toBe("short\n");
    expect(value).not.toHaveProperty("fullOutput");
  }, 60_000);
});
