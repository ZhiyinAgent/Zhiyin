/**
 * Which model each auxiliary request goes to.
 *
 * The loop asks a second model for two different kinds of thing, and they are
 * not interchangeable. Writing a label for an action is presentation: a weaker
 * model writes a slightly worse title. Deciding whether evidence satisfies a
 * criterion is judgement: a weaker model is wrong in ways nothing downstream
 * can detect. Condensing a conversation is neither: it is asked of the
 * conversation's own model, from the request that model already has cached.
 *
 * One seam could not tell them apart, so both followed whichever model the
 * person had selected. These tests hold the two apart so a composition can
 * point them at different models.
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

function recorder(
  requests: ModelRequest[],
  answers: { readonly [marker: string]: unknown } = {},
) {
  return {
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
}

function promptsOf(requests: readonly ModelRequest[]): string {
  return requests.map((request) => request.messages.at(-1)?.content).join("\n");
}

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
 * A 13,600-token Medium budget, with room past it for the request that asks
 * for the summary.
 */
const smallWindow = {
  model: "small",
  contextWindow: 16_000,
  maximumOutputTokens: 100,
};

/** About 13k tokens of earlier conversation: past that budget with the rest. */
function pastItsBudget(): WorkspaceTask {
  return settledTask({
    messages: [
      {
        id: "m1",
        role: "user",
        text: "OLDER MATERIAL ".repeat(2_600),
        sequence: 0,
      },
      { id: "m2", role: "assistant", text: "Earlier answer", sequence: 1 },
    ],
  });
}

describe("auxiliary model seams", () => {
  it("asks the guidance model for the plan and the conversation name", async () => {
    const guidance: ModelRequest[] = [];
    const judgement: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: recorder(guidance, {
        "Create an ordered plan": {
          conversationTitle: "Explain the assistant",
          items: [
            { title: "Answer", criterion: "The reply explains what it is." },
          ],
        },
      }),
      judgementModel: recorder(judgement),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    expect(promptsOf(guidance)).toContain("Create an ordered plan");
    expect(promptsOf(judgement)).not.toContain("Create an ordered plan");
    expect(loop.snapshot().tasks[0]?.title).toBe("Explain the assistant");
  });

  it("asks the judgement model whether a criterion is satisfied", async () => {
    const guidance: ModelRequest[] = [];
    const judgement: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "It is a desktop assistant." },
      { kind: "done" },
    ]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: recorder(guidance, {
        "Create an ordered plan": {
          items: [
            { title: "Answer", criterion: "The reply explains what it is." },
          ],
        },
      }),
      judgementModel: recorder(judgement, {
        "Decide whether this single criterion": {
          satisfied: true,
          summary: "The reply explains what it is.",
        },
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    expect(promptsOf(judgement)).toContain(
      "Decide whether this single criterion",
    );
    expect(promptsOf(guidance)).not.toContain(
      "Decide whether this single criterion",
    );
    expect(loop.snapshot().tasks[0]?.plan?.[0]?.status).toBe("verified");
  });

  it("asks the conversation's own model to condense it, and neither auxiliary model", async () => {
    const guidance: ModelRequest[] = [];
    const judgement: ModelRequest[] = [];
    const main: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      modelWindow: smallWindow,
      model: {
        ...stubDependencies(() => {}).model,
        ...recorder(main, {
          "about to be condensed": {
            title: "Continue the earlier work",
            summary: "The earlier material was discussed.",
          },
        }),
      },
      guidanceModel: recorder(guidance, {
        "Create an ordered plan": { items: [] },
      }),
      judgementModel: recorder(judgement),
    });
    loop.restore([pastItsBudget()]);

    await loop.start("task-1", "Continue");

    expect(promptsOf(main)).toContain("about to be condensed");
    expect(promptsOf(guidance)).not.toContain("about to be condensed");
    expect(promptsOf(judgement)).not.toContain("about to be condensed");
    expect(loop.snapshot().tasks[0]).toMatchObject({
      compaction: { summary: "The earlier material was discussed." },
    });
  });

  it("names a condensed conversation from the condensing answer, without a second request", async () => {
    const guidance: ModelRequest[] = [];
    const main: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      modelWindow: smallWindow,
      model: {
        ...stubDependencies(() => {}).model,
        ...recorder(main, {
          "about to be condensed": {
            title: "Continue second-stage analysis",
            summary: "The earlier material was discussed.",
          },
        }),
      },
      guidanceModel: recorder(guidance, {
        "Create an ordered plan": { items: [] },
      }),
    });
    loop.restore([pastItsBudget()]);

    await loop.start("task-1", "Continue");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Continue second-stage analysis",
      titleSource: "generated",
    });
    expect(
      main.filter((request) =>
        request.messages.at(-1)?.content.includes("about to be condensed"),
      ),
    ).toHaveLength(1);
    expect(promptsOf(guidance)).not.toContain("Name this conversation");
  });
});
