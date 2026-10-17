/**
 * A turn and a specialist it started run side by side, and either can need
 * the person's approval while the other keeps working. The prompt has to
 * stay on screen until the person answers it: if the other run's progress
 * replaced it, the run that asked would wait for a decision nobody can give.
 */

import { describe, expect, it } from "vitest";
import type { ToolCallInspection, WorkspaceTask } from "@zhiyin/contract";
import { ModelClientError, type ModelEvent } from "@zhiyin/model-client";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until as eventually,
  type TurnTestApp,
} from "./support.js";

function call(callId: string, name: string, args: object): ModelEvent {
  return {
    kind: "toolCallDelta",
    index: 0,
    callId,
    name,
    argumentsDelta: JSON.stringify(args),
  };
}

const done: ModelEvent = { kind: "done" };
const finish = call("finish-1", "finish_specialist", {
  summary: "Checked.",
  findings: [],
  recommendations: [],
  limitations: [],
});

/**
 * Two tools: reading a file is allowed outright, running a command is asked
 * for every time.
 */
function dependencies(
  send: (text: string) => AsyncGenerator<ModelEvent>,
): Parameters<typeof loopFrom>[0] {
  const base = stubDependencies(() => {});
  return {
    ...base,
    plugins: pluginsOffering([
      pluginOffering({
        name: "engineering",
        specialists: [
          {
            id: "checker",
            name: "Checker",
            description: "Runs the checks.",
            instructions: "Run the checks you are asked for and report.",
          },
        ],
      }),
    ]),
    tools: {
      list: () => [
        {
          name: "read_file",
          description: "Read one project file.",
          inputSchema: { type: "object" },
        },
        {
          name: "run_command",
          description: "Run a command.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (name, args): Promise<ToolCallInspection> => {
        const { path, command } = args as { path?: string; command?: string };
        return name === "read_file"
          ? {
              ok: true,
              action: "Read file",
              target: path ?? "",
              command: `read_file(${path})`,
              access: "read",
              scope: "workspace",
            }
          : {
              ok: true,
              action: "Run a command",
              target: command ?? "",
              command: command ?? "",
            };
      },
      execute: async () => ({ ok: true as const, value: "ok" }),
    },
    permissions: {
      decide: async (request) =>
        request.name === "read_file"
          ? { outcome: "allow" as const, reason: "Read only" }
          : { outcome: "ask" as const, reason: "Commands are asked for." },
    },
    model: {
      ...base.model,
      send: async function* (request) {
        yield* send(JSON.stringify(request.messages));
      },
    },
    newSpecialistRunId: () => "specialist-1",
  };
}

const conversation = (loop: TurnTestApp): WorkspaceTask => {
  const task = loop.snapshot().tasks[0];
  if (!task) throw new Error("No conversation.");
  return task;
};
const asking = (loop: TurnTestApp, target: string): boolean => {
  const phase = conversation(loop).phase;
  return phase.kind === "approval" && phase.prompt.target === target;
};
const specialistIs = (loop: TurnTestApp, status: string): boolean =>
  conversation(loop).specialistRuns[0]?.status === status;

describe("an approval beside a specialist", () => {
  it("shows no specialist's approval waiting behind the turn's once the person stops", async () => {
    let specialistAsked = false;
    const deps = dependencies(async function* () {
      yield done;
    });
    const loop: TurnTestApp = loopFrom({
      ...deps,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "checker",
              name: "Checker",
              description: "Runs the checks.",
              instructions: "Run the checks you are asked for and report.",
              access: "change",
            },
          ],
        }),
      ]),
      permissions: {
        decide: async (request) => {
          if (request.name === "read_file")
            return { outcome: "allow" as const, reason: "Read only" };
          if (JSON.stringify(request).includes("npm test"))
            specialistAsked = true;
          return { outcome: "ask" as const, reason: "Commands are asked for." };
        },
      },
      model: {
        ...deps.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Checker specialist")) {
            if (!text.includes("spec-command")) {
              await eventually(() => asking(loop, "npm run build"));
              yield call("spec-command", "run_command", {
                command: "npm test",
              });
            } else yield finish;
            yield done;
            return;
          }
          if (!text.includes("Check the site.")) {
            yield call("delegate-1", "delegate_specialist", {
              id: "engineering/checker",
              task: "Check the site.",
            });
          } else if (!text.includes("parent-command")) {
            yield call("parent-command", "run_command", {
              command: "npm run build",
            });
          } else {
            yield { kind: "textDelta", text: "Built and checked." };
          }
          yield done;
        },
      },
    });
    const taskId = await loop.createTask(["engineering"]);
    const running = loop.start(taskId, "Build the site and have it checked");
    await eventually(() => specialistAsked && asking(loop, "npm run build"));

    await loop.cancel(taskId);
    await running;
    await eventually(() => !specialistIs(loop, "running"));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(conversation(loop).phase.kind).toBe("interrupted");
  });

  it("keeps a specialist's approval on screen while its parent works on and finishes", async () => {
    // Read by the model stand-in, which runs only after the loop exists.
    const loop: TurnTestApp = loopFrom(
      dependencies(async function* (text) {
        if (text.includes("You are the Checker specialist")) {
          yield text.includes("spec-command")
            ? finish
            : call("spec-command", "run_command", { command: "npm test" });
          yield done;
          return;
        }
        if (!text.includes("Check the site.")) {
          yield call("delegate-1", "delegate_specialist", {
            id: "engineering/checker",
            task: "Check the site.",
          });
        } else if (!text.includes("parent-read")) {
          // The parent goes on only once the specialist's prompt is showing.
          await eventually(() => asking(loop, "npm test"));
          yield { kind: "textDelta", text: "Reading the page meanwhile." };
          yield call("parent-read", "read_file", { path: "site/index.html" });
        } else {
          yield {
            kind: "textDelta",
            text: text.includes("finished in the background")
              ? "All checked."
              : "The site is ready; the check goes on.",
          };
        }
        yield done;
      }),
    );
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Build the site and have it checked");
    await eventually(() =>
      conversation(loop).messages.some((message) =>
        message.text.includes("The site is ready"),
      ),
    );

    // The parent has streamed, read a file and finished; the specialist is
    // still waiting, and its question is still the one on screen.
    expect(specialistIs(loop, "running")).toBe(true);
    expect(conversation(loop).phase).toMatchObject({
      kind: "approval",
      prompt: { target: "npm test" },
    });

    const phase = conversation(loop).phase;
    if (phase.kind !== "approval") throw new Error("No approval showing.");
    await loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await eventually(() => specialistIs(loop, "completed"));
    await eventually(() =>
      conversation(loop).messages.some((message) =>
        message.text.includes("All checked."),
      ),
    );
  });

  it("keeps a specialist's approval on screen when its parent's turn fails", async () => {
    // Read by the model stand-in, which runs only after the loop exists.
    const loop: TurnTestApp = loopFrom(
      dependencies(async function* (text) {
        if (text.includes("You are the Checker specialist")) {
          yield text.includes("spec-command")
            ? finish
            : call("spec-command", "run_command", { command: "npm test" });
          yield done;
          return;
        }
        if (!text.includes("Check the site.")) {
          yield call("delegate-1", "delegate_specialist", {
            id: "engineering/checker",
            task: "Check the site.",
          });
        } else if (!text.includes("finished in the background")) {
          // The parent fails only once the specialist's prompt is showing.
          await eventually(() => asking(loop, "npm test"));
          throw new ModelClientError("rateLimited", "The provider is busy.");
        } else {
          yield { kind: "textDelta", text: "All checked." };
        }
        yield done;
      }),
    );
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Build the site and have it checked");

    // The parent's turn has failed; the specialist is still waiting, and its
    // question is still the one on screen, so it can be answered.
    expect(loop.running(taskId)).toBe(true);
    expect(specialistIs(loop, "running")).toBe(true);
    expect(conversation(loop).phase).toMatchObject({
      kind: "approval",
      prompt: { target: "npm test" },
    });

    const phase = conversation(loop).phase;
    if (phase.kind !== "approval") throw new Error("No approval showing.");
    await loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await eventually(() => specialistIs(loop, "completed"));
    await eventually(() =>
      conversation(loop).messages.some((message) =>
        message.text.includes("All checked."),
      ),
    );
  });

  it("keeps the turn's approval on screen while a specialist beside it works", async () => {
    // Read by the model stand-in, which runs only after the loop exists.
    const loop: TurnTestApp = loopFrom(
      dependencies(async function* (text) {
        if (text.includes("You are the Checker specialist")) {
          if (!text.includes("spec-read")) {
            // The specialist works only once the parent's prompt is showing.
            await eventually(() => asking(loop, "npm run build"));
            yield call("spec-read", "read_file", { path: "site/index.html" });
          } else yield finish;
          yield done;
          return;
        }
        if (!text.includes("Check the site.")) {
          yield call("delegate-1", "delegate_specialist", {
            id: "engineering/checker",
            task: "Check the site.",
          });
        } else if (!text.includes("parent-command")) {
          yield call("parent-command", "run_command", {
            command: "npm run build",
          });
        } else {
          yield { kind: "textDelta", text: "Built and checked." };
        }
        yield done;
      }),
    );
    const taskId = await loop.createTask(["engineering"]);

    const running = loop.start(taskId, "Build the site and have it checked");
    await eventually(() => specialistIs(loop, "completed"));

    // The specialist read a file and finished while the parent waited; the
    // parent's question is still the one on screen.
    expect(conversation(loop).phase).toMatchObject({
      kind: "approval",
      prompt: { target: "npm run build" },
    });

    const phase = conversation(loop).phase;
    if (phase.kind !== "approval") throw new Error("No approval showing.");
    await loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await running;
    await eventually(() => conversation(loop).phase.kind === "completed");
    expect(
      conversation(loop).messages.some((message) =>
        message.text.includes("Built and checked."),
      ),
    ).toBe(true);
  });
});
