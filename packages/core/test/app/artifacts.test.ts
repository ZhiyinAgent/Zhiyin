import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEvent, WorkspaceSnapshot } from "@zhiyin/contract";
import { WorkspaceArtifacts } from "@zhiyin/artifacts";
import { WorkspaceTools } from "@zhiyin/tools";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  currentApprovalId,
  stubDependencies,
  until,
  loopFrom,
} from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
      artifacts: new WorkspaceArtifacts(),
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
          '{"path":"reports/brief.md","content":"A brief."}',
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
    const root = await folders.make("zhiyin-loop-");
    await writeFile(join(root, "brief.md"), "A finished brief.", "utf8");
    const tools = new WorkspaceTools(root);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: writesFile("brief.md"),
      workspace: tools,
      artifacts: new WorkspaceArtifacts(),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: requestsOneTool(
          "write_file",
          '{"path":"brief.md","content":"A finished brief."}',
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

    const destination = join(await folders.make("zhiyin-export-"), "copy.md");
    await expect(
      loop.exportArtifact(taskId, "brief.md", async () => destination),
    ).resolves.toEqual({ status: "saved", destination });
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "A finished brief.",
    );
  });

  /**
   * Two conversations in two folders, each with a brief.md of its own. The
   * folder open is the other conversation's while a turn runs there, and
   * after the open conversation is deleted: a file is read from its own
   * conversation's folder all the same.
   */
  it("reads a produced file from its conversation's folder, whichever folder is open", async () => {
    const first = await folders.make("zhiyin-loop-first-");
    const second = await folders.make("zhiyin-loop-second-");
    await writeFile(join(first, "brief.md"), "The first brief.", "utf8");
    await writeFile(join(second, "brief.md"), "The second brief.", "utf8");
    const tools = new WorkspaceTools(first);
    const told: AppEvent[] = [];
    const deps = stubDependencies((event) => told.push(event));
    let requests = 0;
    let asking = false;
    const loop = loopFrom({
      ...deps,
      tools: writesFile("brief.md"),
      workspace: tools,
      artifacts: new WorkspaceArtifacts(),
      permissions: {
        decide: async () =>
          asking
            ? { outcome: "ask" as const, reason: "Asked." }
            : { outcome: "allow" as const, reason: "Approved" },
      },
      model: {
        ...deps.model,
        // Each turn asks for the write first, then answers.
        send: async function* () {
          requests += 1;
          if (requests % 2 === 1)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `call-${requests}`,
              name: "write_file",
              argumentsDelta: '{"path":"brief.md","content":"x"}',
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
      newTaskId: () => `task-${requests}-${Math.random()}`,
    });
    await loop.initialize();
    await loop.selectNothing();
    await loop.selectWorkspace(second);
    const inSecond = await loop.createTask();
    await loop.start(inSecond, "Write the brief");
    await loop.selectNothing();
    await loop.selectWorkspace(first);
    const inFirst = await loop.createTask();
    await loop.start(inFirst, "Write the brief");

    // A turn in the first folder waits for an answer while the second
    // conversation, in its own folder, is shown.
    asking = true;
    const running = loop.start(inFirst, "Write it again");
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === inFirst)?.phase
          .kind === "approval",
    );
    await loop.selectTask(inSecond);
    expect(loop.snapshot().workspace?.path).toBe(second);

    await expect(loop.previewArtifact(inSecond, "brief.md")).resolves.toEqual({
      status: "ready",
      path: "brief.md",
      text: "The second brief.",
      truncated: false,
    });
    const destination = join(await folders.make("zhiyin-export-"), "copy.md");
    await loop.exportArtifact(inSecond, "brief.md", async () => destination);
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "The second brief.",
    );

    await loop.resolveApproval(
      inFirst,
      currentApprovalId(loop, inFirst),
      "deny",
    );
    await running;
    // Deleting the open conversation opens the next one's folder.
    await loop.selectTask(inFirst);
    told.length = 0;
    await loop.deleteTask(inFirst);
    expect(loop.snapshot().selectedTaskId).toBe(inSecond);
    expect(loop.snapshot().workspace?.path).toBe(second);
    // And the window is told, so it shows that folder.
    const shown = told.filter((event) => event.kind === "workspaceChanged");
    expect(shown.at(-1)).toMatchObject({
      data: { fields: { workspace: { path: second } } },
    });
  });

  it("reads a produced file from the folder it was made in after its conversation moves to another", async () => {
    const first = await folders.make("zhiyin-loop-first-");
    const second = await folders.make("zhiyin-loop-second-");
    await writeFile(join(first, "brief.md"), "The first brief.", "utf8");
    await writeFile(join(second, "brief.md"), "Not this one.", "utf8");
    const tools = new WorkspaceTools(first);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: writesFile("brief.md"),
      workspace: tools,
      artifacts: new WorkspaceArtifacts(),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: requestsOneTool(
          "write_file",
          '{"path":"brief.md","content":"x"}',
        ),
      },
    });
    await loop.initialize();
    await loop.selectNothing();
    await loop.selectWorkspace(first);
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the brief");

    // Choosing a folder while the conversation is open makes it the
    // conversation's folder.
    await loop.selectWorkspace(second);
    expect(loop.snapshot().tasks[0]?.workspace?.path).toBe(second);

    await expect(loop.previewArtifact(taskId, "brief.md")).resolves.toEqual({
      status: "ready",
      path: "brief.md",
      text: "The first brief.",
      truncated: false,
    });
    const destination = join(await folders.make("zhiyin-export-"), "copy.md");
    await loop.exportArtifact(taskId, "brief.md", async () => destination);
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "The first brief.",
    );
  });

  /*
   * An approval binds what the person saw. Here the place it pointed at was
   * taken while they decided, so the action is never run. The turn goes on and
   * the model is told why, so it can look again and propose anew, which the
   * person is asked about afresh.
   */
  it("refuses an approved create that became an overwrite before it ran, and tells the model why", async () => {
    const root = await folders.make("zhiyin-loop-");
    const tools = new WorkspaceTools(root);
    const deps = stubDependencies(() => {});
    let turns = 0;
    let told = "";
    const loop = loopFrom({
      ...deps,
      tools,
      workspace: tools,
      artifacts: new WorkspaceArtifacts(),
      permissions: {
        decide: async () => ({
          outcome: "ask" as const,
          reason: "The current policy requires an explicit decision.",
        }),
      },
      model: {
        ...deps.model,
        send: async function* (request: {
          readonly messages: readonly unknown[];
        }) {
          turns += 1;
          if (turns === 1)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "call-1",
              name: "write_file",
              argumentsDelta:
                '{"path":"brief.md","content":"Zhiyin wrote this."}',
            };
          else {
            told = JSON.stringify(request.messages.at(-1));
            yield {
              kind: "textDelta" as const,
              text: "Your own draft is there; I left it.",
            };
          }
          yield { kind: "done" as const };
        },
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

    const refused =
      "brief.md changed while this action waited for approval, so it was not run.";
    const task = loop.snapshot().tasks[0];
    await expect(readFile(join(root, "brief.md"), "utf8")).resolves.toBe(
      "The owner's own draft.",
    );
    expect(task?.artifacts ?? []).toEqual([]);
    expect(task?.actions).toMatchObject([
      { status: "failed", reason: refused },
    ]);
    expect(told).toContain(refused);
    expect(task?.phase.kind).toBe("completed");
  });

  it("says an approved write will replace an existing file before it runs", async () => {
    const root = await folders.make("zhiyin-loop-");
    await writeFile(join(root, "brief.md"), "The earlier draft.", "utf8");
    const tools = new WorkspaceTools(root);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools,
      workspace: tools,
      artifacts: new WorkspaceArtifacts(),
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
          '{"path":"brief.md","content":"The replacement."}',
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
        detail: "This replaces the current contents of brief.md (18 bytes).",
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
