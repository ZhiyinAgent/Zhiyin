import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { estimatedTokens } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  resolveShell,
  WorkspaceTools,
  type ConversationItems,
  type ToolResult,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const shell = resolveShell();

/** Keeps outputs in a folder of its own, one conversation's at a time. */
async function keptItems(): Promise<ConversationItems> {
  const folder = await folders.make("zhiyin-kept-");
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

describe.skipIf(!shell)("where a command runs", () => {
  it("runs each conversation's command in its own folder", async () => {
    const first = await folders.make("zhiyin-command-");
    const second = await folders.make("zhiyin-command-");
    await writeFile(join(first, "note.txt"), "first folder");
    await writeFile(join(second, "note.txt"), "second folder");
    const tools = new WorkspaceTools(undefined, { shell });
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);

    const inA = await tools.execute(
      "bash",
      { command: "cat note.txt", description: "Shows the note." },
      undefined,
      "a",
    );
    const inB = await tools.execute(
      "bash",
      { command: "cat note.txt", description: "Shows the note." },
      undefined,
      "b",
    );

    expect(valueOf(inA)["stdout"]).toBe("first folder");
    expect(valueOf(inB)["stdout"]).toBe("second folder");
  }, 60_000);
});

describe.skipIf(!shell)("a command's output", () => {
  it("returns at most the token limit inline, and keeps the whole of it to read again", async () => {
    const root = await folders.make("zhiyin-command-");
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
        description: "Prints a long numbered output.",
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
    const root = await folders.make("zhiyin-command-");
    const tools = new WorkspaceTools(root, {
      shell,
      items: await keptItems(),
    });

    const value = valueOf(
      await tools.execute(
        "bash",
        { command: "echo short", description: "Prints one word." },
        undefined,
        "task-1",
      ),
    );

    expect(value["stdout"]).toBe("short\n");
    expect(value).not.toHaveProperty("fullOutput");
  }, 60_000);

  it("keeps the whole of an output in the console's code page that is shortened once read as text, and nothing of one as long that fits", async () => {
    const root = await folders.make("zhiyin-command-");
    // 12,000 bytes each: within the 5,000-token bound as bytes, past it once
    // the code page's characters are read as text; plain letters stay within.
    await writeFile(
      join(root, "code-page.mjs"),
      "process.stdout.write(Buffer.alloc(12000, 0xb0))",
    );
    await writeFile(
      join(root, "letters.mjs"),
      "process.stdout.write('a'.repeat(12000))",
    );
    const tools = new WorkspaceTools(root, {
      shell,
      items: await keptItems(),
    });
    const node = process.execPath.replaceAll("\\", "/");
    const run = async (script: string) =>
      valueOf(
        await tools.execute(
          "bash",
          { command: `"${node}" ${script}`, description: "Prints a block." },
          undefined,
          "task-1",
        ),
      );

    const codePage = await run("code-page.mjs");
    const letters = await run("letters.mjs");

    expect(codePage["outputTruncated"]).toBe(true);
    expect(String(codePage["fullOutput"])).toMatch(/output:\/\//);
    expect(letters["outputTruncated"]).toBe(false);
    expect(letters["stdout"]).toBe("a".repeat(12000));
    expect(letters).not.toHaveProperty("fullOutput");
  }, 60_000);

  it("tells Python it starts to read and write UTF-8, as its output is read", async () => {
    const root = await folders.make("zhiyin-command-");
    const tools = new WorkspaceTools(root, { shell });

    const value = valueOf(
      await tools.execute(
        "bash",
        {
          command: 'echo "$PYTHONUTF8 $PYTHONIOENCODING"',
          description: "Prints two settings.",
        },
        undefined,
        "task-1",
      ),
    );

    expect(value["stdout"]).toBe("1 utf-8\n");
  }, 60_000);
});

describe("a command call's input", () => {
  const tools = new WorkspaceTools(process.cwd(), { shell: "bash" });

  it("takes the command and a description, shown as the model's claim", async () => {
    expect(
      await tools.inspect("bash", {
        command: "git status",
        description: "Shows which files have changed.",
      }),
    ).toMatchObject({
      ok: true,
      claim: "Shows which files have changed.",
      // A command is asked about every time, never allowed for the
      // conversation.
      asksEachTime: true,
    });
  });

  it.each(["ls", "cat notes.md", "git status", "pwd"])(
    "declares %s a change and names no folder it stays in, so it is always asked about",
    async (command) => {
      const inspection = await tools.inspect("bash", {
        command,
        description: "Look around.",
      });

      expect(inspection).toMatchObject({ ok: true, access: "change" });
      expect(inspection.ok && inspection.scope).toBeUndefined();
    },
  );

  it("hands on a command over 2,000 characters whole, to the last character", async () => {
    const files = Array.from({ length: 300 }, (_, index) => `part-${index}.md`);
    const command = `cat ${files.join(" ")} > joined.md`;
    expect(command.length).toBeGreaterThan(2_000);

    const inspection = await tools.inspect("bash", {
      command,
      description: "Joins the parts into one file.",
    });

    expect(inspection).toMatchObject({ ok: true, target: command });
  });

  it("says which input runs, and gives its time limit beside it in words", async () => {
    expect(
      await tools.inspect("bash", {
        command: "npm test",
        description: "Runs the tests.",
        timeoutMs: 90_000,
      }),
    ).toMatchObject({
      ok: true,
      invocation: {
        name: "bash",
        arguments: [
          { name: "command", value: "npm test", runs: true },
          { name: "Stops after", value: "90 s", readable: true },
        ],
      },
    });
    expect(
      await tools.inspect("bash", {
        command: "npm test",
        description: "Runs the tests.",
      }),
    ).toMatchObject({
      invocation: {
        arguments: [
          { name: "command", runs: true },
          { name: "Stops after", value: "30 min" },
        ],
      },
    });
  });

  it("refuses the description under any other name", async () => {
    expect(
      await tools.inspect("bash", {
        command: "git status",
        explanation: "Shows which files have changed.",
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "Give a single bash command and one plain sentence explaining what it does.",
    });
  });
});
