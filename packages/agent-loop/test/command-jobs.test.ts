/**
 * A command that carried on as a job ends by itself after the call that
 * started it returned. The conversation is told as Zhiyin, never in the
 * command's own words: what it printed is read through a tool, fenced like
 * any tool's answer. A conversation whose turn has ended is woken to report,
 * unless the person stopped the job: then it is told at its next request.
 */

import { describe, expect, it } from "vitest";
import type { CommandFileChanges, RunningCommand } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import {
  loopAndHost,
  loopFrom,
  queuedWorkRun,
  stubDependencies,
  until,
} from "./support.js";

type JobChanges = (
  conversationId: string,
  job: string,
  changes: CommandFileChanges,
) => void;

/** What the job wrote while it ran. */
const wrote: CommandFileChanges = {
  status: "checked",
  job: "J1",
  files: [{ path: "dist/app.js", change: "created" }],
};

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
    let running: RunningCommand[] = [];
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

    running = [
      {
        id: "J1",
        command: "npm run build",
        explanation: "Builds the project.",
        startedAt: 1_000,
      },
    ];
    changed?.(taskId);
    await until(() => loop.snapshot().tasks[0]?.runningJobs.length === 1);
    expect(loop.snapshot().tasks[0]?.runningJobs).toEqual([
      { id: "J1", command: "npm run build" },
    ]);

    running = [];
    changed?.(taskId);
    await until(() => loop.snapshot().tasks[0]?.runningJobs.length === 0);
  });

  it("keeps the end of a job a stopped turn started, which the stop ended, and what it changed", async () => {
    const base = stubDependencies(() => {});
    let running: RunningCommand[] = [];
    let changed: ((conversationId: string) => void) | undefined;
    let jobChanges: JobChanges | undefined;
    let endJob = () => {};
    let taskId = "";
    let requests = 0;
    const loop = loopFrom({
      ...base,
      tools: {
        ...base.tools,
        list: () => [
          { name: "build", description: "Builds.", inputSchema: {} },
          { name: "wait", description: "Waits.", inputSchema: {} },
        ],
        inspect: async (name) => ({
          ok: true as const,
          action: name,
          target: "here",
          command: `${name}()`,
          access: "read" as const,
          scope: "workspace" as const,
        }),
        execute: async (name, _args, signal) => {
          if (name === "build") {
            // Its end is watched from the call that started it, as a
            // command carried on as a job is.
            const ended = new Promise<void>((resolve) => (endJob = resolve));
            running = [
              {
                id: "J1",
                command: "npm run build",
                explanation: "Builds the project.",
                startedAt: 1_000,
              },
            ];
            void ended.then(() => {
              running = [];
              changed?.(taskId);
              jobChanges?.(taskId, "J1", wrote);
            });
            changed?.(taskId);
            return {
              ok: true as const,
              value: "Carried on as job J1.",
              commandChanges: { status: "running" as const, job: "J1" },
            };
          }
          // The person presses Stop while this runs, once the job is kept.
          await until(() => loop.snapshot().tasks[0]?.runningJobs.length === 1);
          void loop.cancel(taskId);
          await until(() => signal?.aborted === true);
          return { ok: true as const, value: "Waited." };
        },
        runningCommands: () => running,
        onCommandsChanged: (watcher) => {
          changed = watcher;
        },
        onJobChanges: (watcher) => {
          jobChanges = watcher;
        },
        // The stop ends the job, and its end follows.
        stopCommands: async () => endJob(),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Read" }),
      },
      model: {
        ...base.model,
        send: async function* () {
          requests += 1;
          const name = ["build", "wait"][requests - 1];
          if (name)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `${name}-1`,
              name,
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    taskId = await loop.createTask();

    await loop.start(taskId, "Build the project");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "interrupted");

    await until(() => loop.snapshot().tasks[0]?.runningJobs.length === 0);
    expect(running).toEqual([]);
    await until(
      () =>
        loop.snapshot().tasks[0]?.actions[0]?.commandChanges?.status ===
        "checked",
    );
    expect(loop.snapshot().tasks[0]?.actions[0]?.commandChanges).toEqual(wrote);
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
    loop.restore([
      loop.settleAfterRestart({
        ...saved,
        runningJobs: [{ id: "J1", command: "npm run build" }],
      }),
    ]);

    await loop.start(taskId, "Is it built?");

    const sent = JSON.stringify(requests.at(-1)?.messages);
    expect(sent).toContain(
      "The command npm run build, running as a job, was stopped when Zhiyin closed.",
    );
    expect(sent.indexOf("stopped when Zhiyin closed")).toBeLessThan(
      sent.indexOf("Is it built?"),
    );
  });
  it("tells a job's end that was waiting when the person stopped the turn at their next turn, without waking", async () => {
    const base = stubDependencies(() => {});
    let held = false;
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost({
      ...base,
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "unknown-1",
              name: "no_such_tool",
              argumentsDelta: "{}",
            };
            yield { kind: "done" as const };
            return;
          }
          yield { kind: "textDelta" as const, text: "Answered." };
          yield { kind: "done" as const };
        },
      },
    });
    const loop = host.app;
    const taskId = await loop.createTask();
    // The call's answer is being saved when the job ends and the person
    // stops the turn.
    let release = () => {};
    host.holdsSave = (task) => {
      if (
        held ||
        !task.modelHistory.some(
          (entry) => entry.kind === "result" && entry.callId === "unknown-1",
        )
      )
        return undefined;
      held = true;
      return new Promise<void>((resolve) => (release = resolve));
    };

    const turn = loop.start(taskId, "Go");
    await until(() => held);
    loop.commandEnded(taskId, "Job J9 (npm run build) finished.", true);
    await loop.cancel(taskId);
    release();
    await turn;
    await until(() => !loop.running(taskId));
    await queuedWorkRun();

    expect(requests).toHaveLength(1);
    await loop.start(taskId, "Any news?");
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
      "Job J9 (npm run build) finished.",
    );
  });
  it("wakes nothing for a job that ends by itself while the stop is being saved, and tells it at the next turn", async () => {
    const base = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost({
      ...base,
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "unknown-1",
              name: "no_such_tool",
              argumentsDelta: "{}",
            };
            yield { kind: "done" as const };
            return;
          }
          yield { kind: "textDelta" as const, text: "Answered." };
          yield { kind: "done" as const };
        },
      },
    });
    const loop = host.app;
    const taskId = await loop.createTask();
    // The call's answer is being saved when the person stops the turn, and
    // the stop is being saved when the job ends.
    let heldResult = false;
    let heldStop = false;
    let releaseResult = () => {};
    let releaseStop = () => {};
    host.holdsSave = (task) => {
      if (!heldStop && task.phase.kind === "interrupted") {
        heldStop = true;
        return new Promise<void>((resolve) => (releaseStop = resolve));
      }
      if (
        !heldResult &&
        task.modelHistory.some(
          (entry) => entry.kind === "result" && entry.callId === "unknown-1",
        )
      ) {
        heldResult = true;
        return new Promise<void>((resolve) => (releaseResult = resolve));
      }
      return undefined;
    };

    const turn = loop.start(taskId, "Go");
    await until(() => heldResult);
    const stopping = loop.cancel(taskId);
    await until(() => heldStop);
    loop.commandEnded(taskId, "Job J9 (npm run build) finished.", true);
    await queuedWorkRun();
    releaseStop();
    releaseResult();
    await stopping;
    await turn.catch(() => undefined);
    await until(() => !loop.running(taskId));
    await queuedWorkRun();

    expect(requests).toHaveLength(1);
    await loop.start(taskId, "Any news?");
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
      "Job J9 (npm run build) finished.",
    );
  });

  it("tells a job's end once when the turn is stopped while it is told", async () => {
    const base = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost({
      ...base,
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Answered." };
          yield { kind: "done" as const };
        },
      },
    });
    const loop = host.app;
    const taskId = await loop.createTask();
    const notice = "Job J9 (npm run build) finished.";
    loop.commandEnded(taskId, notice, false);
    // The person stops the turn while its first request tells of the job.
    let held = false;
    let release = () => {};
    host.holdsSave = (task) => {
      if (
        !held &&
        task.modelHistory.some(
          (entry) => entry.kind === "notice" && entry.content.includes(notice),
        )
      ) {
        held = true;
        return new Promise<void>((resolve) => (release = resolve));
      }
      return undefined;
    };

    const turn = loop.start(taskId, "Go");
    await until(() => held);
    const stopping = loop.cancel(taskId);
    release();
    await stopping;
    await turn.catch(() => undefined);
    await until(() => !loop.running(taskId));
    await loop.start(taskId, "Any news?");

    expect(
      JSON.stringify(requests.at(-1)?.messages).split(notice).length - 1,
    ).toBe(1);
  });

  it("wakes nothing for a job that ends while one of two stops is still being saved", async () => {
    const base = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost({
      ...base,
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "unknown-1",
              name: "no_such_tool",
              argumentsDelta: "{}",
            };
            yield { kind: "done" as const };
            return;
          }
          yield { kind: "textDelta" as const, text: "Answered." };
          yield { kind: "done" as const };
        },
      },
    });
    const loop = host.app;
    const taskId = await loop.createTask();
    let heldResult = false;
    let heldStop = false;
    let releaseResult = () => {};
    let releaseStop = () => {};
    host.holdsSave = (task) => {
      if (!heldStop && task.phase.kind === "interrupted") {
        heldStop = true;
        return new Promise<void>((resolve) => (releaseStop = resolve));
      }
      if (
        !heldResult &&
        task.modelHistory.some(
          (entry) => entry.kind === "result" && entry.callId === "unknown-1",
        )
      ) {
        heldResult = true;
        return new Promise<void>((resolve) => (releaseResult = resolve));
      }
      return undefined;
    };

    const turn = loop.start(taskId, "Go");
    await until(() => heldResult);
    const firstStop = loop.cancel(taskId);
    await until(() => heldStop);
    // Stop pressed again: the second finishes while the first is saved.
    await loop.cancel(taskId);
    releaseResult();
    await turn.catch(() => undefined);
    await until(() => !loop.running(taskId));
    loop.commandEnded(taskId, "Job J9 (npm run build) finished.", true);
    await queuedWorkRun();
    const asked = requests.length;
    releaseStop();
    await firstStop;

    expect(asked).toBe(1);
  });
});
