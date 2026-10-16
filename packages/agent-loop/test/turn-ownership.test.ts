/**
 * Who owns a turn, and what happens to work that comes back after it stopped.
 *
 * Stopping a turn aborts a signal. It does not reach inside a request that is
 * already in flight, a tool already running, or a store already writing — all
 * of those can still return, and when they do the turn that owned them may be
 * gone, replaced, or its whole conversation deleted. Every test here holds a
 * result open on purpose and releases it after the moment that should have
 * ended it.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent } from "@zhiyin/model-client";
import { VisibleError, type ToolInvocationResult } from "@zhiyin/contract";
import { loopAndHost, loopFrom, stubDependencies, until } from "./support.js";

/** A promise a test opens and closes by hand. */
function gate() {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
}

describe("AgentLoop turn ownership", () => {
  it("cannot let a stopped turn write over the turn that replaced it", async () => {
    const held = gate();
    let turn = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          turn += 1;
          if (turn === 1) {
            await held.opened;
            yield { kind: "textDelta", text: "Answer from the stopped turn." };
          } else {
            yield { kind: "textDelta", text: "Answer from the second turn." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const first = loop.start(taskId, "First question");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "working");
    await loop.cancel(taskId);
    await loop.start(taskId, "Second question");

    held.release();
    await first;

    const texts = loop
      .snapshot()
      .tasks[0]!.messages.filter((message) => message.role === "assistant")
      .map((message) => message.text)
      .join(" ");
    expect(texts).toContain("Answer from the second turn.");
    expect(texts).not.toContain("Answer from the stopped turn.");
  });

  it("gives the conversation back when its turn fails before it starts", async () => {
    const { host } = loopAndHost(stubDependencies(() => {}));
    const loop = host.app;
    const taskId = await loop.createTask();
    const enter = host.enterFolderOf.bind(host);
    host.enterFolderOf = async () => {
      throw new VisibleError("The folder could not be opened.");
    };

    await expect(loop.start(taskId, "First question")).rejects.toThrow(
      "The folder could not be opened.",
    );
    host.enterFolderOf = enter;

    expect(loop.running(taskId)).toBe(false);
    await loop.start(taskId, "Second question");
    expect(
      loop
        .snapshot()
        .tasks[0]!.messages.filter((message) => message.role === "user")
        .map((message) => message.text),
    ).toEqual(["Second question"]);
  });

  it("ends a stopped conversation's commands even when the stop cannot be saved", async () => {
    const held = gate();
    const stopped: string[] = [];
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      tools: {
        ...deps.tools,
        stopCommands: async (conversationId: string) => {
          stopped.push(conversationId);
        },
      },
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          await held.opened;
          yield { kind: "done" };
        },
      },
    });
    const loop = host.app;
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Keep busy");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "working");
    const store = host.store.bind(host);
    host.store = async () => {
      throw new Error("The disk is full.");
    };

    await expect(loop.cancel(taskId)).rejects.toThrow("The disk is full.");

    expect(stopped).toEqual([taskId]);
    host.store = store;
    held.release();
    await running.catch(() => {});
  });

  it("survives a late answer arriving for a conversation that was deleted", async () => {
    const held = gate();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          await held.opened;
          yield { kind: "textDelta", text: "Too late." };
          yield { kind: "done" };
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    const taskId = await loop.createTask();
    const keep = await loop.createTask();

    const running = loop.start(taskId, "A question");
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === taskId)?.phase.kind ===
        "working",
    );
    await loop.deleteTask(taskId);

    held.release();
    await expect(running).resolves.toBeUndefined();

    expect(loop.snapshot().tasks.map((task) => task.id)).toEqual([keep]);
  });

  it("leaves another conversation's connections usable after one is stopped", async () => {
    const held = gate();
    let connectionsOpen = true;
    let turn = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      mcp: {
        ...deps.mcp,
        availableTools: async () => [
          {
            name: "mcp__docs__search",
            description: "Search the docs.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Use Docs: search",
          target: "docs",
          command: "mcp__docs__search({})",
        }),
        execute: async (): Promise<ToolInvocationResult> =>
          connectionsOpen
            ? { ok: true, value: "Found it." }
            : { ok: false, reason: "The connection is closed." },
        shutdownAll: async () => {
          connectionsOpen = false;
        },
        shutdownScope: async () => {},
      },
      permissions: { decide: async () => ({ outcome: "allow", reason: "ok" }) },
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          turn += 1;
          if (turn === 1) {
            await held.opened;
            yield { kind: "done" };
            return;
          }
          // Once only: the answer after the tool result ends the turn, rather
          // than asking for the same tool for ever.
          if (turn === 2)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-1",
              name: "mcp__docs__search",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta", text: "The docs say so." };
          yield { kind: "done" };
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    const stopped = await loop.createTask();
    const other = await loop.createTask();

    const running = loop.start(stopped, "Keep busy");
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === stopped)?.phase
          .kind === "working",
    );
    await loop.cancel(stopped);
    held.release();
    await running;

    await loop.start(other, "Search the docs");

    const actions =
      loop.snapshot().tasks.find((task) => task.id === other)?.actions ?? [];
    expect(actions.map((action) => action.status)).toEqual(["completed"]);
  });

  it("drops a write the stopped turn began, still being saved when the next turn has the conversation", async () => {
    const saving = gate();
    let rounds = 0;
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          rounds += 1;
          yield {
            kind: "textDelta",
            text:
              rounds === 1
                ? "Answer from the stopped turn."
                : "Answer from the second turn.",
          };
          yield { kind: "done" };
        },
      },
    });
    const loop = host.app;
    // The stopped turn's answer is still on its way to the disk.
    let holding = false;
    const store = host.store.bind(host);
    host.store = async (task, options) => {
      if (
        !holding &&
        task.messages.some((message) =>
          message.text.includes("the stopped turn"),
        )
      ) {
        holding = true;
        await saving.opened;
      }
      await store(task, options);
    };
    const taskId = await loop.createTask();

    const first = loop.start(taskId, "First question").catch(() => undefined);
    await until(() => holding);
    await loop.cancel(taskId);
    await loop.start(taskId, "Second question");
    saving.release();
    await first;

    const task = loop.snapshot().tasks[0]!;
    const said = task.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.text)
      .join(" ");
    expect(said).toContain("Answer from the second turn.");
    expect(said).not.toContain("Answer from the stopped turn.");
    expect(task.phase.kind).toBe("completed");
  });

  it("keeps a stopped turn's late tool result out of the turn that replaced it", async () => {
    const toolHeld = gate();
    const secondHeld = gate();
    let rounds = 0;
    let toolRunning = false;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed." }),
      },
      tools: {
        list: () => [
          {
            name: "read_report",
            description: "Read the report.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Read a workspace file",
          target: "report.md",
          command: "read_report({})",
        }),
        // The stopped turn's tool answers only once the next turn is running.
        execute: async () => {
          toolRunning = true;
          await toolHeld.opened;
          return { ok: true as const, value: "The stopped turn's result." };
        },
      },
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          rounds += 1;
          if (rounds === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-1",
              name: "read_report",
              argumentsDelta: "{}",
            };
          else {
            await secondHeld.opened;
            yield { kind: "textDelta", text: "Answer from the second turn." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const first = loop.start(taskId, "First question").catch(() => undefined);
    await until(() => toolRunning);
    await loop.cancel(taskId);
    const second = loop.start(taskId, "Second question");
    await until(() => rounds === 2);
    toolHeld.release();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 10));
    secondHeld.release();
    await second;

    const task = loop.snapshot().tasks[0]!;
    expect(JSON.stringify(task.modelHistory)).not.toContain(
      "The stopped turn's result.",
    );
    expect(task.actions.map((action) => action.status)).not.toContain(
      "completed",
    );
    expect(task.phase.kind).toBe("completed");
  });

  it("does not run an action that was approved but not yet dispatched when the turn is stopped", async () => {
    const held = gate();
    let executed = 0;
    let rounds = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      // The decision itself is what the test holds open: the action has been
      // approved by the time it returns, and by then the turn is over.
      permissions: {
        decide: async () => {
          await held.opened;
          return { outcome: "allow" as const, reason: "Allowed." };
        },
      },
      tools: {
        list: () => [
          {
            name: "write_file",
            description: "Write one file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Create a workspace file",
          target: "report.md",
          command: 'write_file({"path":"report.md"})',
        }),
        execute: async () => {
          executed += 1;
          return { ok: true as const, value: "written" };
        },
      },
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          rounds += 1;
          if (rounds === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "call-1",
              name: "write_file",
              argumentsDelta: '{"path":"report.md"}',
            };
          else yield { kind: "textDelta", text: "Written." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Write the report");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "working");
    await loop.cancel(taskId);
    held.release();
    await running;

    expect(executed).toBe(0);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });

  it("says a stopped remote action may already have happened", async () => {
    const held = gate();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      permissions: { decide: async () => ({ outcome: "allow", reason: "ok" }) },
      mcp: {
        ...deps.mcp,
        availableTools: async () => [
          {
            name: "mcp__tracker__create_issue",
            description: "File an issue.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Use Tracker: create_issue",
          target: "tracker",
          command: "mcp__tracker__create_issue({})",
        }),
        // Dispatched and never answered: the request left this machine, so
        // what happened at the other end is not knowable from here.
        execute: async () => {
          await held.opened;
          return { ok: true as const, value: "filed" };
        },
      },
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: "call-1",
            name: "mcp__tracker__create_issue",
            argumentsDelta: "{}",
          };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "File an issue");
    await until(() => (loop.snapshot().tasks[0]?.actions ?? []).length > 0);
    await loop.cancel(taskId);
    held.release();
    await running;

    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        status: "cancelled",
        reason:
          "Stopped waiting. The remote action may already have taken effect; check its destination before retrying.",
      }),
    ]);
  });

  it("publishes no completion for a turn that was still running at shutdown", async () => {
    const held = gate();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (): AsyncGenerator<ModelEvent> {
          await held.opened;
          yield { kind: "textDelta", text: "Answer after the app closed." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "A question");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "working");
    await loop.shutdown();
    held.release();
    await running;

    expect(loop.snapshot().tasks[0]?.phase.kind).not.toBe("completed");
    expect(
      loop
        .snapshot()
        .tasks[0]!.messages.map((message) => message.text)
        .join(" "),
    ).not.toContain("Answer after the app closed.");
  });
});
