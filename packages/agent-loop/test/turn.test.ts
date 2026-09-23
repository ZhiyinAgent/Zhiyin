import { describe, expect, it } from "vitest";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import {
  currentApprovalId,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
  loopFrom,
} from "./support.js";

describe("AgentLoop", () => {
  it("loads an enabled skill through permission handling and returns instructions to the model", async () => {
    const deps = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    let permissionChecks = 0;
    const loop = loopFrom({
      ...deps,
      permissions: {
        decide: async () => {
          permissionChecks += 1;
          return { outcome: "allow", reason: "Local instructions approved" };
        },
      },
      plugins: pluginsOffering([
        pluginOffering({
          name: "writing",
          skills: [
            {
              id: "writer",
              description: "Write clearly",
              instructions: "Use short sentences.",
            },
          ],
        }),
      ]),
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "load-writer",
              name: "load_skill",
              argumentsDelta: '{"id":"writing/writer"}',
            };
          else yield { kind: "textDelta", text: "A clear draft." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask(["writing"]);
    await loop.start(taskId, "Help me write");
    expect(permissionChecks).toBe(1);
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Use short sentences.",
    );
    expect(loop.snapshot().tasks[0]?.actions?.[0]?.status).toBe("completed");
  });
  it("advertises enabled skills and retains earlier tool evidence for a follow-up", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const previous: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Read my notes",
          updatedLabel: "Earlier",
          messages: [{ id: "m1", role: "user", text: "Read my notes" }],
          actions: [
            {
              id: "a1",
              action: "Read notes",
              target: "notes.txt",
              status: "completed",
              toolName: "read_file",
              evidence: "The launch date is December 12.",
            },
          ],
          phase: { kind: "interrupted" },
          activatedPlugins: ["writing"],
        },
      ],
      plugins: [],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage" },
    };
    const loop = loopFrom({
      ...deps,
      plugins: pluginsOffering([
        pluginOffering({
          name: "writing",
          skills: [
            {
              id: "writer",
              description: "Write clearly",
              instructions: "Use short sentences.",
            },
          ],
        }),
      ]),
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "textDelta", text: "December 12" };
          yield { kind: "done" };
        },
      },
    });
    loop.restore(previous.tasks);

    await loop.start("task-1", "When is the launch?");
    expect(JSON.stringify(requests[0]?.messages)).toContain("December 12");
    expect(requests[0]?.tools?.some((tool) => tool.name === "load_skill")).toBe(
      true,
    );
  });
  it("keeps cancellation terminal during final assessment", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let evaluating = false;
    const auxiliary = {
      send: async function* (request: ModelRequest) {
        const prompt = request.messages.at(-1)?.content ?? "";
        if (prompt.includes("Create an ordered plan")) {
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({
              items: [
                { title: "Answer", criterion: "The question is answered" },
              ],
            }),
          };
        } else {
          evaluating = true;
          await waiting;
          yield {
            kind: "textDelta" as const,
            text: '{"satisfied":true,"summary":"Answered"}',
          };
        }
        yield { kind: "done" as const };
      },
    };
    const loop = loopFrom({
      ...stubDependencies(() => {}, [
        { kind: "textDelta", text: "Answer" },
        { kind: "done" },
      ]),
      guidanceModel: auxiliary,
      judgementModel: auxiliary,
    });
    await loop.createTask();
    const running = loop.start("task-1", "A question");
    await until(() => evaluating);
    await loop.cancel("task-1");
    release();
    await running;
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });

  it("rejects overlapping starts instead of replacing an active turn", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dependencies = stubDependencies(() => {});
    const loop = loopFrom({
      ...dependencies,
      model: {
        ...dependencies.model,
        send: async function* () {
          await waiting;
          yield { kind: "done" };
        },
      },
    });
    await loop.createTask();
    const first = loop.start("task-1", "First");
    await expect(loop.start("task-1", "Second")).rejects.toThrow(
      "already running",
    );
    await loop.cancel("task-1");
    release();
    await first;
    expect(
      loop
        .snapshot()
        .tasks[0]?.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });
  it("sends everything user-visible through the event stream it was given", () => {
    const seen: AppEvent[] = [];
    const loop = loopFrom(stubDependencies((event) => seen.push(event)));

    loop.emit({ kind: "coreReady", data: { version: "0.1.0" } });

    expect(seen).toEqual([{ kind: "coreReady", data: { version: "0.1.0" } }]);
  });

  it("runs a first model turn through authoritative task events", async () => {
    const seen: AppEvent[] = [];
    const loop = loopFrom(
      stubDependencies(
        (event) => seen.push(event),
        [
          { kind: "textDelta", text: "Hello" },
          { kind: "textDelta", text: " from Zhiyin." },
          {
            kind: "usage",
            usage: {
              requestId: "generation-1",
              model: "z-ai/glm-5.3-flash",
              inputTokens: 8,
              outputTokens: 4,
              totalTokens: 12,
              costUsd: 0.000002,
            },
          },
          { kind: "done" },
        ],
      ),
    );

    const taskId = await loop.createTask();
    await loop.start(taskId, "Introduce yourself");

    expect(taskId).toBe("task-1");
    expect(loop.snapshot().tasks[0]).toMatchObject({
      id: "task-1",
      title: "Introduce yourself",
      messages: [
        { role: "user", text: "Introduce yourself" },
        { role: "assistant", text: "Hello from Zhiyin." },
      ],
      phase: { kind: "completed" },
    });
    expect(seen).toContainEqual({
      kind: "usageRecorded",
      data: {
        requestId: "generation-1",
        model: "z-ai/glm-5.3-flash",
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
        costUsd: 0.000002,
        recordedAt: "2026-09-02T19:00:00.000Z",
      },
    });
    expect(seen.at(-1)).toMatchObject({
      kind: "taskChanged",
      data: { id: "task-1", phase: { kind: "completed" } },
    });
  });

  it("gives the model the current workspace inventory and exploration guidance", async () => {
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      workspace: {
        describeWorkspace: async () => ({
          rootName: "Zhiyin",
          entries: [
            { path: "apps", kind: "directory" },
            { path: "package.json", kind: "file" },
          ],
          truncated: false,
        }),
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "textDelta", text: "Zhiyin is the current project." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is the current project?");

    expect(requests[0]?.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringMatching(
        /Current workspace: Zhiyin[\s\S]*directory: apps[\s\S]*file: package\.json[\s\S]*list_directory/,
      ),
    });
  });

  it("stores explanations and actions in the order they happened", async () => {
    let requestCount = 0;
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Allowed." }),
      },
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Read a workspace file",
          target: "package.json",
          command: 'read_file({"path":"package.json"})',
        }),
        execute: async () => ({ ok: true, value: { name: "zhiyin" } }),
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* () {
          requestCount += 1;
          if (requestCount === 1) {
            yield { kind: "textDelta", text: "I’ll inspect the manifest." };
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-package",
              name: "read_file",
              argumentsDelta: '{"path":"package.json"}',
            };
          } else {
            yield {
              kind: "textDelta",
              text: "The manifest identifies the project as Zhiyin.",
            };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Identify the project");

    const task = loop.snapshot().tasks[0];
    expect(task?.messages).toMatchObject([
      { role: "user", sequence: 0, text: "Identify the project" },
      { role: "assistant", sequence: 1, text: "I’ll inspect the manifest." },
      {
        role: "assistant",
        sequence: 3,
        text: "The manifest identifies the project as Zhiyin.",
      },
    ]);
    expect(task?.actions).toEqual([
      expect.objectContaining({ sequence: 2, action: "Read package.json" }),
    ]);
  });

  it("does not invent user-facing work steps for ordinary model generation", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* () {
          await waiting;
          yield { kind: "textDelta", text: "Done." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Answer directly");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "working");

    expect(loop.snapshot().tasks[0]?.phase).toEqual({
      kind: "working",
      steps: [],
    });

    release?.();
    await running;
  });

  it("turns model failures into a visible failed task without exposing causes", async () => {
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      model: {
        send: async function* () {
          yield* [];
          throw new Error("provider internals");
        },
        settings: async () => ({
          model: "z-ai/glm-5.3-flash",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          credential: { status: "missing", source: "none" },
        }),
        setApiKey: async () => {},
        clearApiKey: async () => {},
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Hello");

    expect(loop.snapshot().tasks[0]?.phase).toEqual({
      kind: "failed",
      reason: "The model request failed. Try again.",
    });
  });

  it("does not discard a completed response when usage storage is unavailable", async () => {
    const loop = loopFrom({
      ...stubDependencies(() => {}, [
        { kind: "textDelta", text: "The response is complete." },
        {
          kind: "usage",
          usage: {
            requestId: "usage-failure",
            model: "z-ai/glm-5.3-flash",
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
        { kind: "done" },
      ]),
      usage: {
        record: async () => {
          throw new Error("disk unavailable");
        },
        state: async () => ({
          status: "unavailable",
          reason: "Usage history could not be saved.",
        }),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer the question");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      messages: [
        { role: "user" },
        { role: "assistant", text: "The response is complete." },
      ],
      phase: { kind: "completed" },
    });
  });

  it("executes a permitted call once and returns its structured result to the model and event stream", async () => {
    const requests: ModelRequest[] = [];
    const seen: AppEvent[] = [];
    let executionCount = 0;
    const loop = loopFrom({
      ...stubDependencies((event) => seen.push(event)),
      permissions: {
        decide: async () => ({
          outcome: "allow",
          reason: "Reading this workspace file is allowed.",
        }),
      },
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read a UTF-8 text file in the workspace.",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Read a workspace file",
          target: "README.md",
          command: 'read_file({"path":"README.md"})',
        }),
        execute: async () => {
          executionCount += 1;
          return { ok: true, value: { text: "Project notes" } };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-readme",
              name: "read_file",
              argumentsDelta: '{"path":',
            };
            yield {
              kind: "toolCallDelta",
              index: 0,
              argumentsDelta: '"README.md"}',
            };
          } else {
            yield { kind: "textDelta", text: "The notes say Project notes." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read the project notes");

    expect(executionCount).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call-readme",
      name: "read_file",
      content: '{"ok":true,"value":{"text":"Project notes"}}',
    });
    expect(seen).toContainEqual({
      kind: "toolActivity",
      data: {
        taskId,
        callId: "call-readme",
        toolName: "read_file",
        status: "completed",
        result: { ok: true, value: { text: "Project notes" } },
      },
    });
    expect(seen).toContainEqual({
      kind: "taskChanged",
      data: expect.objectContaining({
        id: taskId,
        phase: {
          kind: "working",
          steps: [
            {
              id: "tool-call-readme",
              label: "Read README.md",
              detail: "README.md",
              status: "active",
            },
          ],
        },
      }),
    });
    expect(
      seen
        .filter((event) => event.kind === "taskChanged")
        .some(
          (event) =>
            event.kind === "taskChanged" &&
            event.data.phase.kind === "working" &&
            event.data.phase.steps.some((step) =>
              step.label.includes("read_file"),
            ),
        ),
    ).toBe(false);
    expect(loop.snapshot().tasks[0]).toMatchObject({
      messages: [
        { role: "user", text: "Read the project notes" },
        { role: "assistant", text: "The notes say Project notes." },
      ],
      actions: [
        {
          action: "Read README.md",
          target: "README.md",
          status: "completed",
        },
      ],
      phase: { kind: "completed" },
    });
  });

  it("keeps a denied call from producing a real side effect and returns the rejection to the model", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-denied-tool-"));
    const sentinel = join(root, "side-effect.txt");
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({
          outcome: "deny",
          reason: "This write was blocked by policy.",
        }),
      },
      tools: {
        list: () => [
          {
            name: "write_sentinel",
            description: "Change a sentinel value.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Change the sentinel",
          target: "test sentinel",
          command: "write_sentinel({})",
        }),
        execute: async () => {
          await writeFile(sentinel, "changed", "utf8");
          return { ok: true, value: { changed: true } };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-write",
              name: "write_sentinel",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta", text: "The write was denied." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the sentinel");

    await expect(access(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call-write",
      name: "write_sentinel",
      content: '{"ok":false,"reason":"This write was blocked by policy."}',
    });
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        action: "Change the sentinel",
        target: "test sentinel",
        status: "blocked",
        reason: "This write was blocked by policy.",
      }),
    ]);
  });

  it("routes an externally registered tool to its owning MCP server", async () => {
    let mcpExecutions = 0;
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Allowed." }),
      },
      plugins: pluginsOffering([
        pluginOffering({
          name: "lookups",
          connectors: [{ id: "external", url: "https://external.test/mcp" }],
        }),
      ]),
      mcp: {
        ...stubDependencies(() => {}).mcp,
        availableTools: async () => [
          {
            name: "external_lookup",
            description: "Look up external data.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Look up external data",
          target: "test service",
          command: "external_lookup({})",
        }),
        execute: async () => {
          mcpExecutions += 1;
          return { ok: true, value: { answer: 42 } };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-mcp",
              name: "external_lookup",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta", text: "The answer is 42." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask(["lookups"]);

    await loop.start(taskId, "Look up the answer");

    expect(mcpExecutions).toBe(1);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call-mcp",
      name: "external_lookup",
      content: '{"ok":true,"value":{"answer":42}}',
    });
  });

  it("pauses an asked permission until the exact request is approved", async () => {
    let executed = false;
    let requestCount = 0;
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({
          outcome: "ask",
          reason: "The current policy requires an explicit decision.",
        }),
      },
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Read a workspace file",
          target: "README.md",
          command: 'read_file({"path":"README.md"})',
        }),
        execute: async () => {
          executed = true;
          return { ok: true, value: { text: "notes" } };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* () {
          requestCount += 1;
          if (requestCount === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-approval",
              name: "read_file",
              argumentsDelta: '{"path":"README.md"}',
            };
          } else {
            yield { kind: "textDelta", text: "Done." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Read the notes");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");

    expect(executed).toBe(false);
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "approval",
      steps: [],
      prompt: {
        action: "Read README.md",
        target: "README.md",
      },
    });
    await expect(
      loop.resolveApproval(taskId, "a-different-call", "allow"),
    ).rejects.toThrow("no longer active");
    expect(executed).toBe(false);

    await loop.resolveApproval(
      taskId,
      currentApprovalId(loop, taskId),
      "allow",
    );
    await running;

    expect(executed).toBe(true);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("asks the guidance model for the plan and action copy, and the judgement model whether the criterion is met", async () => {
    const guidanceRequests: ModelRequest[] = [];
    const judgementRequests: ModelRequest[] = [];
    const modelRequests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({ outcome: "ask", reason: "Approval required." }),
      },
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Read package.json",
          target: "package.json",
          command: 'read_file({"path":"package.json"})',
        }),
        execute: async () => ({
          ok: true,
          value: { name: "zhiyin", packageManager: "pnpm@11.25.0" },
        }),
      },
      guidanceModel: {
        send: async function* (request) {
          guidanceRequests.push(request);
          const prompt = request.messages.at(-1)?.content ?? "";
          yield {
            kind: "textDelta",
            text: prompt.includes("Create an ordered plan")
              ? '{"conversationTitle":"Identify current project","items":[{"title":"Identify the project","criterion":"The project name and package manager are supported by workspace evidence."}]}'
              : '{"title":"Read project manifest","description":"I need package.json to identify the project and its package manager.","planItemId":"plan-1"}',
          };
          yield { kind: "done" };
        },
      },
      judgementModel: {
        send: async function* (request) {
          judgementRequests.push(request);
          yield {
            kind: "textDelta",
            text: '{"satisfied":true,"summary":"package.json identifies Zhiyin and pnpm."}',
          };
          yield { kind: "done" };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          modelRequests.push(request);
          if (!request.messages.some((message) => message.role === "tool")) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-package",
              name: "read_file",
              argumentsDelta: '{"path":"package.json"}',
            };
          } else {
            yield {
              kind: "textDelta",
              text: "This is the Zhiyin pnpm workspace.",
            };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "What is the current project?");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      plan: [
        {
          id: "plan-1",
          title: "Identify the project",
          criterion:
            "The project name and package manager are supported by workspace evidence.",
          status: "active",
        },
      ],
      phase: {
        kind: "approval",
        prompt: {
          action: "Read project manifest",
          reason:
            "I need package.json to identify the project and its package manager.",
        },
      },
    });

    await loop.resolveApproval(
      taskId,
      currentApprovalId(loop, taskId),
      "allow",
    );
    await running;

    // The plan and the action's copy; the criterion went to the other seam.
    expect(guidanceRequests).toHaveLength(2);
    expect(judgementRequests).toHaveLength(1);
    expect(JSON.stringify(guidanceRequests)).not.toContain("read_file");
    expect(modelRequests[0]?.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Explain the purpose"),
    });
    expect(loop.snapshot().tasks[0]).toMatchObject({
      actions: [
        {
          action: "Read project manifest",
          description:
            "I need package.json to identify the project and its package manager.",
          target: "package.json",
          status: "completed",
        },
      ],
      plan: [
        {
          status: "verified",
          verification: "package.json identifies Zhiyin and pnpm.",
        },
      ],
      phase: { kind: "completed" },
    });
  });

  it("stops the turn immediately when the user denies an asked permission", async () => {
    let executed = false;
    let requestCount = 0;
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({
          outcome: "ask",
          reason: "The current policy requires an explicit decision.",
        }),
      },
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Read a workspace file",
          target: "package.json",
          command: 'read_file({"path":"package.json"})',
        }),
        execute: async () => {
          executed = true;
          return { ok: true, value: { text: "notes" } };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* () {
          requestCount += 1;
          if (requestCount === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-denied",
              name: "read_file",
              argumentsDelta: '{"path":"package.json"}',
            };
          } else {
            yield { kind: "textDelta", text: "I tried another approach." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Read the project metadata");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    await loop.resolveApproval(taskId, currentApprovalId(loop, taskId), "deny");
    await running;

    expect(executed).toBe(false);
    expect(requestCount).toBe(1);
    expect(loop.snapshot().tasks[0]).toMatchObject({
      actions: [
        {
          action: "Read package.json",
          target: "package.json",
          status: "denied",
        },
      ],
      phase: {
        kind: "interrupted",
        reason: "The action was denied. No further work ran.",
      },
    });
  });

  it("returns an unknown tool as a structured failure the model can recover from", async () => {
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-missing",
              name: "missing_tool",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta", text: "That tool is unavailable." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Use a missing tool");

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call-missing",
      name: "missing_tool",
      content:
        '{"ok":false,"refusedBy":"input-check","reason":"The tool “missing_tool” is not available.","next":"Use one of the tools on offer."}',
    });
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        action: "Missing tool",
        description: "Zhiyin requested a capability that is not connected.",
        target: "Unavailable",
        status: "failed",
      }),
    ]);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("returns tool execution failures to the model instead of hanging", async () => {
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Allowed." }),
      },
      tools: {
        list: () => [
          {
            name: "failing_tool",
            description: "Fails during execution.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Run the failing tool",
          target: "test target",
          command: "failing_tool({})",
        }),
        execute: async () => {
          throw new Error("internal failure");
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-fail",
              name: "failing_tool",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta", text: "The action failed safely." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Run the tool");

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call-fail",
      name: "failing_tool",
      content:
        '{"ok":false,"reason":"The requested action failed while it was running."}',
    });
    expect(loop.snapshot().tasks[0]).toMatchObject({
      actions: [
        {
          action: "Run the failing tool",
          target: "test target",
          status: "failed",
          reason: "The requested action failed while it was running.",
        },
      ],
      phase: { kind: "completed" },
    });
  });

  it("aborts an executing tool and emits no later completion", async () => {
    const seen: AppEvent[] = [];
    let executionStarted = false;
    let toolObservedAbort = false;
    let sharedConnectionsClosed = false;
    const scopesClosed: string[] = [];
    const loop = loopFrom({
      ...stubDependencies((event) => seen.push(event)),
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Allowed." }),
      },
      tools: {
        list: () => [
          {
            name: "slow_tool",
            description: "Waits until cancelled.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Run the slow tool",
          target: "test target",
          command: "slow_tool({})",
        }),
        execute: async (_name, _args, signal) => {
          executionStarted = true;
          return new Promise((resolve) => {
            signal?.addEventListener(
              "abort",
              () => {
                toolObservedAbort = true;
                resolve({ ok: false, reason: "Cancelled." });
              },
              { once: true },
            );
          });
        },
      },
      mcp: {
        ...stubDependencies(() => {}).mcp,
        shutdownAll: async () => {
          sharedConnectionsClosed = true;
        },
        shutdownScope: async (scope: string) => {
          scopesClosed.push(scope);
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* () {
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: "call-slow",
            name: "slow_tool",
            argumentsDelta: "{}",
          };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Run the slow tool");
    await until(() => executionStarted);
    await loop.cancel(taskId);
    await running;

    expect(toolObservedAbort).toBe(true);
    // Stopping this conversation closes this conversation's connections. It is
    // not a reason to disconnect the servers every other conversation shares,
    // which is what ADR 0012 means by not closing shared resources for
    // unrelated work.
    expect(scopesClosed).toEqual([taskId]);
    expect(sharedConnectionsClosed).toBe(false);
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        action: "Run the slow tool",
        target: "test target",
        status: "cancelled",
        reason: "The action stopped before it completed.",
      }),
    ]);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
    expect(
      seen.some(
        (event) =>
          event.kind === "taskChanged" && event.data.phase.kind === "completed",
      ),
    ).toBe(false);
  });
});

describe("what the model is told before it starts", () => {
  it("states today's date, so nothing it writes has to guess one", async () => {
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      now: () => new Date("2026-09-10T13:00:00.000Z"),
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write me a note");

    const system = (requests[0]?.messages ?? [])
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    // A dated deliverable written from a guess is wrong in a way nobody
    // notices until later.
    expect(system).toContain("10 September 2026");
  });

  it("says that a chart lives in the conversation and not in a file", async () => {
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise this and chart it");

    const system = (requests[0]?.messages ?? [])
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    // A summary that says "the chart below" and is then opened as a file
    // points at nothing.
    expect(system).toMatch(/shown in the conversation/i);
    expect(system).toMatch(/not.*(embedded|in a file)/i);
  });
});
