/**
 * A command that carried on as a job ends by itself after the call that
 * started it returned. The conversation is told as Zhiyin, never in the
 * command's own words: what it printed is read through a tool, fenced like
 * any tool's answer. A conversation whose turn has ended is woken to report,
 * unless the person stopped the job: then it is told at its next request.
 */

import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/contract";
import { loopFrom, stubDependencies, until } from "./support.js";

type Announce = (
  conversationId: string,
  notice: string,
  wakes: boolean,
) => void;

const ended = "Job J1 (npm run build) finished with exit code 0.";

function announced(request: ModelRequest, notice = ended): boolean {
  return JSON.stringify(request.messages).includes(
    `<zhiyin-notice kind=\\"job\\">${notice}</zhiyin-notice>`,
  );
}

describe("a command that ends after its call returned", () => {
  it("wakes a conversation whose turn has ended, and tells it as Zhiyin", async () => {
    const base = stubDependencies(() => {});
    let announce: Announce | undefined;
    const loop = loopFrom({
      ...base,
      tools: {
        ...base.tools,
        onCommandEnded: (listener) => {
          announce = listener;
        },
      },
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          yield {
            kind: "textDelta" as const,
            text: announced(request)
              ? "The build finished."
              : "The build is running.",
          };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Build the project");

    announce?.(taskId, ended, true);

    await until(() => {
      const phase = loop.snapshot().tasks[0]?.phase;
      return (
        phase?.kind === "completed" &&
        phase.outcome.summary === "The build finished."
      );
    });
  });

  it("tells a turn still running at its next request, without waking another", async () => {
    const base = stubDependencies(() => {});
    let announce: Announce | undefined;
    const requests: ModelRequest[] = [];
    let taskId = "";
    const loop = loopFrom({
      ...base,
      tools: {
        ...base.tools,
        list: () => [
          {
            name: "look",
            description: "Looks.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Look",
          target: "here",
          command: "look()",
          access: "read",
          scope: "workspace",
        }),
        execute: async () => {
          announce?.(taskId, ended, true);
          return { ok: true, value: "Looked." };
        },
        onCommandEnded: (listener) => {
          announce = listener;
        },
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
      },
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (requests.length === 1)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "look-1",
              name: "look",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    taskId = await loop.createTask();

    await loop.start(taskId, "Look around");

    expect(requests).toHaveLength(2);
    expect(announced(requests[1]!)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toHaveLength(2);
  });

  it("tells of a job the person stopped at the next request, without waking the conversation", async () => {
    const stopped = "Job J1 (npm run build) was stopped by the person.";
    const base = stubDependencies(() => {});
    let announce: Announce | undefined;
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...base,
      tools: {
        ...base.tools,
        onCommandEnded: (listener) => {
          announce = listener;
        },
      },
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Build the project");

    announce?.(taskId, stopped, false);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests).toHaveLength(1);
    await loop.start(taskId, "What happened?");
    expect(requests).toHaveLength(2);
    expect(announced(requests[1]!, stopped)).toBe(true);
  });

  it("keeps a conversation's running jobs with it while they run, so a restart can tell of them", async () => {
    const base = stubDependencies(() => {});
    let running: { id: string; command: string; startedAt: number }[] = [];
    let changed: ((conversationId: string) => void) | undefined;
    const loop = loopFrom({
      ...base,
      tools: {
        ...base.tools,
        runningCommands: () => running,
        onCommandsChanged: (watcher) => {
          changed = watcher;
        },
      },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Build the project");

    running = [{ id: "J1", command: "npm run build", startedAt: 1_000 }];
    changed?.(taskId);
    await until(() => loop.snapshot().tasks[0]?.runningJobs.length === 1);
    expect(loop.snapshot().tasks[0]?.runningJobs).toEqual([
      { id: "J1", command: "npm run build" },
    ]);

    running = [];
    changed?.(taskId);
    await until(() => loop.snapshot().tasks[0]?.runningJobs.length === 0);
  });

  it("tells the model at its next request of a job that stopped when Zhiyin closed", async () => {
    const base = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...base,
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Build the project");
    const saved = loop.snapshot().tasks[0]!;
    const index = loop.tasks.findIndex((task) => task.id === taskId);
    loop.tasks[index] = loop.settleAfterRestart({
      ...saved,
      runningJobs: [{ id: "J1", command: "npm run build" }],
    });

    await loop.start(taskId, "Is it built?");

    const sent = JSON.stringify(requests.at(-1)?.messages);
    expect(sent).toContain(
      "The command npm run build, running as a job, was stopped when Zhiyin closed.",
    );
    expect(sent.indexOf("stopped when Zhiyin closed")).toBeLessThan(
      sent.indexOf("Is it built?"),
    );
  });
});
