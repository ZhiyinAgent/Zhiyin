/**
 * What the plan ledger is allowed to claim, and what it must be shown before
 * claiming it.
 *
 * Every test here was written against an observed failure: a plan whose items
 * all read "Unresolved" after a turn that went fine. Two separate causes, both
 * on this side rather than the model's — an answer discarded for its length,
 * and a judge asked about evidence it was never given.
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

const PLAN = "Create an ordered plan for this task.";
const FINAL_ASSESSMENT =
  "Decide whether this single criterion is satisfied by the final response";

function settledTask(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: "task-1",
    title: "Earlier work",
    titleSource: "generated",
    updatedLabel: "Earlier",
    messages: [],
    actions: [],
    phase: {
      kind: "completed",
      outcome: { title: "Response complete", summary: "Done." },
    },
    ...overrides,
  };
}

/**
 * One stand-in behind both auxiliary seams, answering each request by what it
 * asked for. These tests are about what the ledger may claim, not about which
 * model was asked; `auxiliary-seams.test.ts` holds the two apart.
 */
function auxiliaryFor(
  answers: { readonly [marker: string]: unknown },
  requests: ModelRequest[] = [],
) {
  const model = {
    send: async function* (request: ModelRequest): AsyncGenerator<ModelEvent> {
      requests.push(request);
      const prompt = request.messages.at(-1)?.content ?? "";
      const match = Object.keys(answers).find((marker) =>
        prompt.includes(marker),
      );
      if (match)
        yield { kind: "textDelta", text: JSON.stringify(answers[match]) };
      yield { kind: "done" };
    },
  };
  return { guidanceModel: model, judgementModel: model };
}

const onePlanItem = {
  items: [
    {
      title: "Answer the question",
      criterion: "The reply explains what Zhiyin is and what it can do.",
    },
  ],
};

describe("plan assessment", () => {
  it("records a satisfied verdict even when the model explains it at length", async () => {
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "Zhiyin is a desktop assistant." },
      { kind: "done" },
    ]);
    const loop = loopFrom({
      ...deps,
      ...auxiliaryFor({
        [PLAN]: onePlanItem,
        [FINAL_ASSESSMENT]: {
          satisfied: true,
          summary:
            "The reply names Zhiyin, describes the desktop assistant role, and lists the kinds of work it can carry out, which is what the criterion asks a reviewer to be able to observe in the final response without consulting anything else.",
        },
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    expect(loop.snapshot().tasks[0]?.plan?.[0]).toMatchObject({
      title: "Answer the question",
      status: "verified",
    });
  });

  it("keeps a plan whose criterion runs past the display limit", async () => {
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...auxiliaryFor({
        [PLAN]: {
          items: [
            {
              title: "Answer the question",
              criterion: `The reply explains what Zhiyin is. ${"It also says what it cannot do. ".repeat(10)}`,
            },
          ],
        },
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    const item = loop.snapshot().tasks[0]?.plan?.[0];
    expect(item?.title).toBe("Answer the question");
    expect(item?.criterion).toContain("The reply explains what Zhiyin is.");
  });

  it("tells the model the same length limit the answer is held to", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...auxiliaryFor({ [PLAN]: onePlanItem }, requests),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    const assessment = requests.find((request) =>
      request.messages.at(-1)?.content.includes(FINAL_ASSESSMENT),
    );
    const schema = assessment?.tools?.[0]?.inputSchema as {
      properties?: { summary?: { maxLength?: number } };
    };
    expect(schema?.properties?.summary?.maxLength).toBeGreaterThan(0);
  });

  it("shows the final assessment what each action actually returned", async () => {
    const previous = settledTask({
      actions: [
        {
          id: "action-1",
          action: "Read a workspace file",
          description: "Check the manifest for the project name.",
          target: "package.json",
          evidence: "The manifest declares the name FOUND-IN-THE-EVIDENCE.",
          status: "completed",
          sequence: 0,
        },
      ],
      messages: [
        { id: "m1", role: "user", text: "What is this project?", sequence: 0 },
        { id: "m2", role: "assistant", text: "Reading it now.", sequence: 1 },
      ],
    });
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "The project is Zhiyin." },
      { kind: "done" },
    ]);
    const loop = loopFrom({
      ...deps,
      ...auxiliaryFor(
        {
          [PLAN]: {
            items: [
              {
                title: "Name the project",
                criterion: "The manifest's declared name is quoted.",
              },
            ],
          },
          [FINAL_ASSESSMENT]: {
            satisfied: true,
            summary: "The manifest name was read and quoted.",
          },
        },
        requests,
      ),
    });
    loop.restore([previous]);

    await loop.start(previous.id, "So what is it called?");

    const assessment = requests.find((request) =>
      request.messages.at(-1)?.content.includes(FINAL_ASSESSMENT),
    );
    expect(assessment?.messages.at(-1)?.content).toContain(
      "FOUND-IN-THE-EVIDENCE",
    );
  });
});

/**
 * What the action-copy request tells the model about plan attribution.
 *
 * The request used to end by printing its own answer shape, placeholder
 * included — `"planItemId":"plan-1 or null"` — and models returned that string
 * verbatim. Measured 2026-09-19 against MiniCPM5-1B and 2B and against the
 * configured remote model: 7 of 12 answers. The value fails validation, so
 * attribution silently fell through to guessing by position.
 */
describe("plan attribution", () => {
  const toolTurn = (
    guidanceRequests: ModelRequest[],
    presentation: unknown,
  ) => ({
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Read only" }),
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
        ok: true as const,
        action: "Read a workspace file",
        target: "package.json",
        command: 'read_file({"path":"package.json"})',
      }),
      execute: async () => ({ ok: true as const, value: { name: "zhiyin" } }),
    },
    guidanceModel: {
      send: async function* (
        request: ModelRequest,
      ): AsyncGenerator<ModelEvent> {
        guidanceRequests.push(request);
        const prompt = request.messages.at(-1)?.content ?? "";
        yield {
          kind: "textDelta",
          text: prompt.includes("Create an ordered plan")
            ? JSON.stringify({
                items: [
                  { title: "Find the name", criterion: "The name is quoted." },
                  { title: "Report it", criterion: "The reply states it." },
                ],
              })
            : JSON.stringify(presentation),
        };
        yield { kind: "done" };
      },
    },
    /*
     * Satisfied by an action's result, unsatisfied by the final response. So an
     * item can only reach "verified" here by having been attributed to the one
     * action this turn runs — which is exactly what the test is looking for.
     */
    judgementModel: {
      send: async function* (
        request: ModelRequest,
      ): AsyncGenerator<ModelEvent> {
        const prompt = request.messages.at(-1)?.content ?? "";
        yield {
          kind: "textDelta",
          text: JSON.stringify({
            satisfied: prompt.includes("supplied action result"),
            summary: "Judged from the supplied evidence.",
          }),
        };
        yield { kind: "done" };
      },
    },
  });

  it("names the plan items the model may choose instead of printing a placeholder", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...toolTurn(requests, {
        title: "Read project manifest",
        description: "Check the declared name.",
        planItemId: "plan-1",
      }),
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          if (!request.messages.some((m) => m.role === "tool"))
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "c1",
              name: "read_file",
              argumentsDelta: '{"path":"package.json"}',
            };
          else yield { kind: "textDelta", text: "It is zhiyin." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is this project called?");

    const copy = requests
      .find((request) =>
        request.messages.at(-1)?.content.includes("interface title"),
      )
      ?.messages.at(-1)?.content;
    expect(copy).toBeDefined();
    // The allowed values, not an example of them.
    expect(copy).toContain("plan-1");
    expect(copy).toContain("plan-2");
    expect(copy).not.toContain("plan-1 or null");
  });

  it("leaves the plan alone when the model attributes the action to nothing", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...toolTurn(requests, {
        title: "Read project manifest",
        description: "Check the declared name.",
        planItemId: null,
      }),
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          if (!request.messages.some((m) => m.role === "tool"))
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "c1",
              name: "read_file",
              argumentsDelta: '{"path":"package.json"}',
            };
          else yield { kind: "textDelta", text: "It is zhiyin." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is this project called?");

    // An action nothing attributed is not evidence for the first pending item.
    const plan = loop.snapshot().tasks[0]?.plan ?? [];
    expect(plan.map((item) => item.status)).not.toContain("verified");
  });
});

/**
 * A plan describes work a reviewer could watch happen. A question answered by
 * the reply itself has none, and inventing some produced the reported defect:
 * "Who are you and what can you do?" got a plan about reading README.md, no
 * tool ever ran, and every item was then honestly reported as unresolved. The
 * assessment was right; the plan should never have existed.
 */
describe("a turn with no work to plan", () => {
  it("shows no plan and assesses nothing when the planner returns no items", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "I am Zhiyin, a desktop assistant." },
      { kind: "done" },
    ]);
    const loop = loopFrom({
      ...deps,
      ...auxiliaryFor(
        { [PLAN]: { conversationTitle: "Explain the assistant", items: [] } },
        requests,
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    const task = loop.snapshot().tasks[0];
    expect(task?.plan ?? []).toHaveLength(0);
    expect(task?.title).toBe("Explain the assistant");
    expect(
      requests.filter((request) =>
        request.messages.at(-1)?.content.includes(FINAL_ASSESSMENT),
      ),
    ).toHaveLength(0);
  });

  it("lets the planner return no items without that counting as a malformed answer", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...auxiliaryFor({ [PLAN]: { items: [] } }, requests),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Hello!");

    // The schema must permit the empty answer the instructions ask for.
    const planRequest = requests.find((request) =>
      request.messages.at(-1)?.content.includes(PLAN),
    );
    const schema = planRequest?.tools?.[0]?.inputSchema as {
      properties?: { items?: { minItems?: number } };
    };
    expect(schema?.properties?.items?.minItems).toBe(0);
    expect(planRequest?.messages.at(-1)?.content).toContain("Return no items");
  });
});
