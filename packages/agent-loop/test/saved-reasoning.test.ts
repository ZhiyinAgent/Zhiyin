/**
 * A conversation keeps the reasoning setting it was last sent with. A model
 * chosen since may not offer that effort, and a request asking for it is
 * refused before it is sent. Every request the loop builds asks for what the
 * model can take instead: its default effort, or reasoning on with none named.
 */

import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type ReasoningCapabilities,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies } from "./support.js";

const tiers: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "medium",
  efforts: ["low", "medium", "high"],
};

function conversationAt(effort: "xhigh"): WorkspaceTask {
  return {
    id: "task-1",
    title: "Earlier work",
    titleSource: "manual",
    updatedLabel: "Earlier",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [
      { id: "m1", role: "user", text: "Read the older material", sequence: 0 },
      {
        id: "m2",
        role: "assistant",
        text: "OLDER MATERIAL ".repeat(800),
        sequence: 1,
      },
    ],
    actions: [],
    reasoning: { enabled: true, effort },
    phase: {
      kind: "completed",
      outcome: { title: "Response complete", summary: "Done." },
    },
  };
}

function recording(
  requests: ModelRequest[],
  controls: ReasoningCapabilities = tiers,
) {
  const deps = stubDependencies(() => {});
  return loopFrom({
    ...deps,
    reasoningControls: controls,
    modelWindow: {
      model: "small",
      contextWindow: 16_000,
      maximumOutputTokens: 100,
    },
    model: {
      ...deps.model,
      send: async function* (request: ModelRequest) {
        requests.push(request);
        const last = request.messages.at(-1)?.content;
        yield {
          kind: "textDelta" as const,
          text:
            typeof last === "string" && last.includes('kind="condense"')
              ? JSON.stringify({ summary: "The older material was read." })
              : "Carried on.",
        };
        yield { kind: "done" as const };
      },
    },
  });
}

describe("a saved reasoning effort the chosen model does not offer", () => {
  it("is asked for as the model's default effort when the turn is continued", async () => {
    const requests: ModelRequest[] = [];
    const loop = recording(requests);
    loop.restore([conversationAt("xhigh")]);

    await loop.start("task-1", "Continue.", { enabled: true, effort: "xhigh" });

    expect(requests.map((request) => request.reasoning)).toEqual(
      requests.map(() => ({ enabled: true, effort: "medium" })),
    );
    expect(requests.length).toBeGreaterThan(0);
  });

  it("is asked for as the model's default effort when the conversation is condensed", async () => {
    const requests: ModelRequest[] = [];
    const loop = recording(requests);
    loop.restore([conversationAt("xhigh")]);

    await loop.condenseNow("task-1");

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests)
      expect(request.reasoning).toEqual({ enabled: true, effort: "medium" });
  });
});

describe("a saved reasoning setting and a model that offers no reasoning", () => {
  it("is not sent, so the turn runs at what the model does", async () => {
    const requests: ModelRequest[] = [];
    const loop = recording(requests, {
      status: "unavailable",
      reason: "Reasoning settings are unavailable for this model.",
    });
    loop.restore([conversationAt("xhigh")]);

    await loop.start("task-1", "Continue.", { enabled: true, effort: "xhigh" });

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.map((request) => request.reasoning)).toEqual(
      requests.map(() => undefined),
    );
  });

  it("is still sent while the model's settings could not be looked up, to be checked once they are", async () => {
    const requests: ModelRequest[] = [];
    const loop = recording(requests, {
      status: "unavailable",
      reason: "Reasoning settings could not be loaded.",
      lookupFailed: true,
    });
    loop.restore([conversationAt("xhigh")]);

    await loop.start("task-1", "Continue.", { enabled: true, effort: "xhigh" });

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.map((request) => request.reasoning)).toEqual(
      requests.map(() => ({ enabled: true, effort: "xhigh" })),
    );
  });
});
