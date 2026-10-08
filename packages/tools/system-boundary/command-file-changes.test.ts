/**
 * A shell command declares nothing about the files it touches, so its folder
 * is listed before and after it runs, and the difference is kept with its
 * answer: names and kinds, never contents, since nothing was copied first.
 *
 * Real shell, real ripgrep and real files, because what is being shown is what
 * a listing of a real folder sees.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/process-ownership";
import type { CommandFileChanges } from "@zhiyin/contract";
import { WorkspaceTools, resolveShell, type ToolResult } from "../src/index.js";

const shell = resolveShell();

async function folder(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-command-files-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
  return root;
}

function run(tools: WorkspaceTools, command: string): Promise<ToolResult> {
  return tools.execute(
    "bash",
    { command, explanation: "A command for this test." },
    undefined,
    "conversation-1",
  );
}

function changesOf(result: ToolResult): CommandFileChanges | undefined {
  return result.commandChanges;
}

describe.runIf(shell)("what a command changed in its folder", () => {
  it("lists the files it created, changed and removed, with nothing of their contents", async () => {
    const root = await folder({
      "notes.txt": "first\n",
      "old.txt": "old\n",
      "same.txt": "same\n",
    });
    const tools = new WorkspaceTools(root, { shell });

    const result = await run(
      tools,
      "echo more >> notes.txt; mv old.txt renamed.txt; mkdir exports; echo a,b > exports/data.csv",
    );

    expect(result.ok).toBe(true);
    expect(changesOf(result)).toEqual({
      status: "checked",
      files: [
        { path: "exports/data.csv", change: "created" },
        { path: "notes.txt", change: "updated" },
        { path: "old.txt", change: "deleted" },
        { path: "renamed.txt", change: "created" },
      ],
    });
  }, 60_000);

  it("lists what a failing command changed before it failed", async () => {
    const tools = new WorkspaceTools(await folder(), { shell });

    const result = await run(tools, "echo partial > part.txt; exit 2");

    expect(result).toMatchObject({ ok: false, reported: true });
    expect(changesOf(result)).toEqual({
      status: "checked",
      files: [{ path: "part.txt", change: "created" }],
    });
  }, 60_000);

  it("leaves out the folders a search leaves out, such as node_modules", async () => {
    const tools = new WorkspaceTools(await folder(), { shell });

    const result = await run(
      tools,
      "mkdir node_modules; echo x > node_modules/lib.js; echo y > kept.txt",
    );

    expect(changesOf(result)).toEqual({
      status: "checked",
      files: [{ path: "kept.txt", change: "created" }],
    });
  }, 60_000);

  it("names the first files and counts the rest when a command changes many", async () => {
    const tools = new WorkspaceTools(await folder(), {
      shell,
      commandFilesKept: 3,
    });

    const result = await run(
      tools,
      "for i in 1 2 3 4 5; do echo $i > f$i.txt; done",
    );

    expect(changesOf(result)).toEqual({
      status: "checked",
      files: [
        { path: "f1.txt", change: "created" },
        { path: "f2.txt", change: "created" },
        { path: "f3.txt", change: "created" },
      ],
      more: 2,
    });
  }, 60_000);

  it("says changes could not be checked in a folder above the bound, and runs the command anyway", async () => {
    const root = await folder({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
    const tools = new WorkspaceTools(root, { shell, checkCommandsUpTo: 2 });

    const result = await run(tools, "echo d > d.txt");

    expect(result.ok).toBe(true);
    expect(changesOf(result)).toEqual({
      status: "unchecked",
      reason:
        "This folder has more than 2 files, too many to check what commands change.",
    });
  }, 60_000);

  it("says changes could not be checked without ripgrep", async () => {
    const tools = new WorkspaceTools(await folder(), {
      shell,
      ripgrep: undefined,
    });

    const result = await run(tools, "echo x > x.txt");

    expect(result.ok).toBe(true);
    expect(changesOf(result)).toEqual({
      status: "unchecked",
      reason: "Zhiyin could not list this folder's files.",
    });
  }, 60_000);
});

describe.runIf(shell && process.platform === "win32")(
  "what a job changed in its folder",
  () => {
    it("is said to be pending while it runs, and arrives named for its job when it ends", async () => {
      const root = await folder();
      const tools = new WorkspaceTools(root, {
        shell,
        containment: { open: openProcessContainer },
        promoteCommandsAfterMs: 1_000,
      });
      const seen: [string, string, CommandFileChanges][] = [];
      tools.onJobChanges((conversationId, job, changes) =>
        seen.push([conversationId, job, changes]),
      );

      const started = await run(tools, "sleep 3; echo late > late.txt");

      expect(changesOf(started)).toEqual({ status: "running", job: "J1" });
      const answer = await tools.execute(
        "job_output",
        { job: "J1", waitSeconds: 20 },
        undefined,
        "conversation-1",
      );
      // Listed once, on the call that started the job.
      expect(changesOf(answer)).toBeUndefined();
      await expect
        .poll(() => seen, { timeout: 10_000 })
        .toEqual([
          [
            "conversation-1",
            "J1",
            {
              status: "checked",
              job: "J1",
              files: [{ path: "late.txt", change: "created" }],
            },
          ],
        ]);
    }, 60_000);
  },
);
