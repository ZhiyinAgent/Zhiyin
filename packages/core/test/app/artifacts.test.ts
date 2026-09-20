import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { WorkspaceArtifacts } from "@zhiyin/artifacts";
import { WorkspaceTools } from "@zhiyin/tools";
import {
  currentApprovalId,
  stubDependencies,
  until,
  loopFrom,
} from "./support.js";

function writesFile(path: string) {
  return {
    list: () => [
      {
        name: "write_file",
        description: "Write a file.",
        inputSchema: { type: "object" },
      },
    ],
    inspect: async () => ({
      ok: true as const,
      action: "Create a workspace file",
      target: path,
      command: `write_file({"path":"${path}"})`,
    }),
    execute: async () => ({
      ok: true as const,
      value: { path },
      produced: [{ path, change: "created" as const, bytes: 12 }],
    }),
  };
}

function requestsOneTool(name: string, args: string) {
  let turns = 0;
  return async function* () {
    turns += 1;
    if (turns === 1) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: "call-1",
        name,
        argumentsDelta: args,
      };
    } else {
      yield { kind: "textDelta" as const, text: "Your brief is ready." };
    }
    yield { kind: "done" as const };
  };
}

describe("AgentLoop artifacts", () => {
  it("records what an approved action produced and restores it after a restart", async () => {
    const deps = stubDependencies(() => {});
    let saved: WorkspaceSnapshot | undefined;
    const dependencies = {
      ...deps,
      artifacts: new WorkspaceArtifacts(() => undefined),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      tools: writesFile("reports/brief.md"),
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot: WorkspaceSnapshot) => {
          saved = snapshot;
        },
      },
      model: {
        ...deps.model,
        send: requestsOneTool(
          "write_file",
          '{"path":"reports/brief.md","text":"A brief."}',
        ),
      },
    };

    const loop = loopFrom(dependencies);
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the brief");

    expect(loop.snapshot().tasks[0]?.artifacts).toEqual([
      {
        path: "reports/brief.md",
        name: "brief.md",
        change: "created",
        bytes: 12,
        updatedAt: "2026-09-02T19:00:00.000Z",
      },
    ]);
    expect(saved?.tasks[0]?.artifacts).toHaveLength(1);

    const restarted = loopFrom({
      ...dependencies,
      sessions: { ...dependencies.sessions, loadWorkspace: async () => saved },
    });
    await restarted.initialize();
    expect(restarted.snapshot().tasks[0]?.artifacts).toEqual(
      loop.snapshot().tasks[0]?.artifacts,
    );
  });

  it("offers a produced file for review and export only while the task still knows it", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-loop-"));
    await writeFile(join(root, "brief.md"), "A finished brief.", "utf8");
    const tools = new WorkspaceTools(root);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: writesFile("brief.md"),
      workspace: tools,
      artifacts: new WorkspaceArtifacts(() => tools.workspaceRoot()),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: requestsOneTool(
          "write_file",
          '{"path":"brief.md","text":"A finished brief."}',
        ),
      },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the brief");

    await expect(loop.previewArtifact(taskId, "brief.md")).resolves.toEqual({
      status: "ready",
      path: "brief.md",
      text: "A finished brief.",
      truncated: false,
    });
    await expect(
      loop.previewArtifact(taskId, "something-else.md"),
    ).resolves.toEqual({
      status: "missing",
      path: "something-else.md",
      reason: "This task has no record of that file.",
    });

    const destination = join(
      await mkdtemp(join(tmpdir(), "zhiyin-export-")),
      "copy.md",
    );
    await expect(
      loop.exportArtifact(taskId, "brief.md", async () => destination),
    ).resolves.toEqual({ status: "saved", destination });
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "A finished brief.",
    );
  });

  it("refuses an approved create that became an overwrite before it ran", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-loop-"));
    const tools = new WorkspaceTools(root);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools,
      workspace: tools,
      artifacts: new WorkspaceArtifacts(() => tools.workspaceRoot()),
      permissions: {
        decide: async () => ({
          outcome: "ask" as const,
          reason: "The current policy requires an explicit decision.",
        }),
      },
      model: {
        ...deps.model,
        send: requestsOneTool(
          "write_file",
          '{"path":"brief.md","text":"Zhiyin wrote this."}',
        ),
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Write a brief");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "approval",
      prompt: {
        effect: "Create a workspace file",
        detail: "This creates a new file. Nothing is replaced.",
      },
    });

    // The person's work lands in that exact place while they are deciding.
    await writeFile(join(root, "brief.md"), "The owner's own draft.", "utf8");
    await loop.resolveApproval(
      taskId,
      currentApprovalId(loop, taskId),
      "allow",
    );
    await running;

    expect(loop.snapshot().tasks[0]?.phase).toEqual({
      kind: "failed",
      reason:
        "This action changed while awaiting approval. Request it again before continuing.",
    });
    await expect(readFile(join(root, "brief.md"), "utf8")).resolves.toBe(
      "The owner's own draft.",
    );
    expect(loop.snapshot().tasks[0]?.artifacts ?? []).toEqual([]);
  });

  it("says an approved write will replace an existing file before it runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-loop-"));
    await writeFile(join(root, "brief.md"), "The earlier draft.", "utf8");
    const tools = new WorkspaceTools(root);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools,
      workspace: tools,
      artifacts: new WorkspaceArtifacts(() => tools.workspaceRoot()),
      permissions: {
        decide: async () => ({
          outcome: "ask" as const,
          reason: "The current policy requires an explicit decision.",
        }),
      },
      model: {
        ...deps.model,
        send: requestsOneTool(
          "write_file",
          '{"path":"brief.md","text":"The replacement."}',
        ),
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Rewrite the brief");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "approval",
      prompt: {
        effect: "Overwrite an existing workspace file",
        detail:
          "This replaces the current contents of brief.md (18 bytes). It cannot be undone.",
      },
    });

    await loop.resolveApproval(
      taskId,
      currentApprovalId(loop, taskId),
      "allow",
    );
    await running;

    await expect(readFile(join(root, "brief.md"), "utf8")).resolves.toBe(
      "The replacement.",
    );
    expect(loop.snapshot().tasks[0]?.artifacts).toEqual([
      {
        path: "brief.md",
        name: "brief.md",
        change: "updated",
        bytes: 16,
        updatedAt: "2026-09-02T19:00:00.000Z",
      },
    ]);
  });
});
