/**
 * The small requests behind the visible parts of a turn.
 *
 * Plans, action labels, criterion checks and repairs are all one short model
 * request each. On 2026-09-08 the configured model spent almost the whole of a
 * 320-token planning allowance on reasoning and returned nothing usable, so
 * plans disappeared and action labels fell back silently. The same probe
 * produced a structured plan at a 1,600-token allowance, using 788 tokens.
 *
 * Two things follow, and both are checked here rather than left to a comment:
 * these requests ask for the least thinking the model will do, and they carry
 * enough room that the answer still fits after whatever thinking happens.
 */

import { describe, expect, it } from "vitest";
import { ModelClientError, type ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, until, loopFrom } from "./support.js";

/** Below this an answer has been observed not to survive the reasoning. */
const floor = 800;

function recordingLoop() {
  const asked: ModelRequest[] = [];
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    guidanceModel: {
      send: async function* (request: ModelRequest) {
        asked.push(request);
        yield { kind: "done" as const };
      },
    },
    model: {
      ...deps.model,
      send: async function* () {
        yield { kind: "textDelta" as const, text: "An answer." };
        yield { kind: "done" as const };
      },
    },
  });
  return { loop, asked };
}

async function auxiliaryRequests() {
  const { loop, asked } = recordingLoop();
  const taskId = await loop.createTask();
  await loop.start(taskId, "Compare three power stations and write it up");
  await until(() => asked.length > 0);
  return asked;
}

describe("auxiliary requests", () => {
  it("asks for the least thinking the model will do", async () => {
    const asked = await auxiliaryRequests();

    expect(asked.length).toBeGreaterThan(0);
    for (const request of asked)
      expect(request.reasoning).toEqual({ enabled: true, effort: "minimal" });
  });

  it("leaves room for an answer after the thinking", async () => {
    const asked = await auxiliaryRequests();

    for (const request of asked)
      expect(request.maximumOutputTokens ?? 0).toBeGreaterThanOrEqual(floor);
  });

  it("tells the model to keep its thinking short and answer", async () => {
    const asked = await auxiliaryRequests();

    for (const request of asked) {
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) =>
          typeof message.content === "string" ? message.content : "",
        )
        .join(" ");
      expect(system).toMatch(/deliberat|think/i);
    }
  });
});

/**
 * Not every model lets its thinking be set. Asking for the least and being
 * refused must not cost the answer, because losing the answer is the thing the
 * setting exists to prevent.
 */
describe("a model that will not be told how much to think", () => {
  it("is asked again without the setting rather than left unanswered", async () => {
    const asked: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      guidanceModel: {
        send: async function* (request: ModelRequest) {
          asked.push(request);
          if (request.reasoning)
            throw new ModelClientError(
              "unsupportedReasoning",
              "This model does not let reasoning be configured.",
            );
          yield { kind: "textDelta" as const, text: "{}" };
          yield { kind: "done" as const };
        },
      },
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "textDelta" as const, text: "An answer." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Compare three power stations");

    expect(asked.some((request) => request.reasoning === undefined)).toBe(true);
  });
});
