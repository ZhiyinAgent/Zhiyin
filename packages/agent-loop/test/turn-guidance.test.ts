import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies, until } from "./support.js";
import { settledAfterRestart } from "../src/turn/settling.js";

describe("guidance during a turn", () => {
  it("delivers guidance after a tool round and keeps final streaming open for a third round", async () => {
    const requests: ModelRequest[] = [];
    let releaseFinal!: () => void;
    const waiting = new Promise<void>((resolve) => {
      releaseFinal = resolve;
    });
    let finalStreaming = false;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
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
          command: "read_file",
        }),
        execute: async () => ({ ok: true, value: "original evidence" }),
      },
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "read",
              name: "read_file",
              argumentsDelta: '{"path":"package.json"}',
            };
          } else if (requests.length === 2) {
            yield { kind: "textDelta", text: "Initial answer." };
            finalStreaming = true;
            await waiting;
          } else {
            yield {
              kind: "textDelta",
              text: "I will use the newer file and keep the evidence already read.",
            };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();
    const first = loop.start(taskId, "Inspect the project");
    await until(() => finalStreaming);
    await loop.start(
      taskId,
      "Use the 2024 file instead",
      undefined,
      [],
      "guidance",
    );
    expect(requests).toHaveLength(2);
    expect(
      requests[1]?.messages.some((item) =>
        JSON.stringify(item).includes("2024 file"),
      ),
    ).toBe(false);
    releaseFinal();
    await first;
    expect(requests).toHaveLength(3);
    expect(
      requests[2]?.messages.some((item) =>
        JSON.stringify(item).includes(
          "The user added this while you were working: Use the 2024 file instead",
        ),
      ),
    ).toBe(true);
    const third =
      requests[2]?.messages.map((item) => JSON.stringify(item)) ?? [];
    expect(
      third.findIndex((item) => item.includes("Initial answer.")),
    ).toBeLessThan(
      third.findIndex((item) => item.includes("The user added this")),
    );
    const task = loop.snapshot().tasks[0];
    expect(task?.messages.filter((item) => item.role === "user")).toHaveLength(
      2,
    );
    expect(task?.guidance).toEqual([]);
    expect(task?.phase.kind).toBe("completed");
  });

  it("keeps late guidance as a draft without starting another turn", async () => {
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "Done." },
      { kind: "done" },
    ]);
    const loop = loopFrom(deps);
    const taskId = await loop.createTask();
    await loop.start(taskId, "First task");
    await loop.start(taskId, "Late correction", undefined, [], "guidance");
    const task = loop.snapshot().tasks[0];
    expect(task?.guidance?.[0]).toMatchObject({
      text: "Late correction",
      status: "draft",
    });
    expect(task?.messages.filter((item) => item.role === "user")).toHaveLength(
      1,
    );
  });

  it("recovers pending guidance as a draft after restart", () => {
    const task = settledAfterRestart({
      id: "task-1",
      title: "Task",
      updatedLabel: "Now",
      messages: [],
      phase: { kind: "working", steps: [] },
      guidance: [{ id: "guide-1", text: "Use newer data", status: "pending" }],
    });
    expect(task.guidance?.[0]?.status).toBe("draft");
    expect(task.phase.kind).toBe("interrupted");
  });
});
