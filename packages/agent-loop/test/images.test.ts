import { describe, expect, it } from "vitest";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "@zhiyin/agent-loop";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * A tool that answers with a picture, the way a screenshot does: a short line
 * of text for the record and the image itself on its own channel.
 */
const camera = {
  list: () => [
    {
      name: "capture",
      description: "Take a picture of the page.",
      inputSchema: { type: "object" },
    },
  ],
  inspect: async () => ({
    ok: true as const,
    action: "Capture page",
    target: "https://example.com",
    command: "capture()",
  }),
  execute: async () => ({
    ok: true as const,
    value: { content: [{ type: "text", text: "[image 1, shown separately]" }] },
    images: [{ mediaType: "image/png", data: "AAAA" }],
  }),
};

function callsCapture(times = 1) {
  let turn = 0;
  return async function* (request: ModelRequest) {
    void request;
    turn += 1;
    if (turn <= times) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: `call-${turn}`,
        name: "capture",
        argumentsDelta: "{}",
      };
    } else {
      yield { kind: "textDelta" as const, text: "The chart looks right." };
    }
    yield { kind: "done" as const };
  };
}

function loopWith(
  acceptsImages: boolean,
  requests: ModelMessage[][],
  sessions?: Partial<AgentLoopDependencies["sessions"]>,
  captures = 1,
  pictures?: AgentLoopDependencies["pictures"],
) {
  const deps = stubDependencies(() => {});
  return loopFrom({
    ...deps,
    // What the core answers from the provider's settings in production.
    acceptsImages,
    ...(pictures ? { pictures } : {}),
    ...(sessions ? { sessions: { ...deps.sessions, ...sessions } } : {}),
    tools: camera,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: {
      ...deps.model,
      settings: async () => ({
        ...(await deps.model.settings()),
        acceptsImages,
      }),
      send: (() => {
        const inner = callsCapture(captures);
        return async function* (request: ModelRequest) {
          requests.push([...request.messages]);
          yield* inner(request);
        };
      })(),
    },
  });
}

describe("a picture a tool produced", () => {
  it("reaches a model that can be shown one, as a picture", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopWith(true, requests);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check the chart");

    const asked = requests.at(-1) ?? [];
    const carrying = asked.find(
      (message) =>
        message.role === "user" && typeof message.content !== "string",
    );
    expect(carrying).toBeDefined();
    expect(carrying?.content).toContainEqual({
      kind: "image",
      mediaType: "image/png",
      data: "AAAA",
    });
    // The text channel still says what happened, without the picture in it.
    expect(
      asked.some(
        (message) =>
          message.role === "tool" &&
          message.content.includes("shown separately"),
      ),
    ).toBe(true);
    expect(
      JSON.stringify(asked.filter((m) => m.role === "tool")),
    ).not.toContain("AAAA");
  });

  it("is never sent to a model that cannot be shown one", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopWith(false, requests);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check the chart");

    const asked = requests.at(-1) ?? [];
    expect(JSON.stringify(asked)).not.toContain("AAAA");
    // And the model is told a picture exists that it cannot see, rather than
    // being left to wonder why the answer says nothing.
    expect(JSON.stringify(asked)).toContain("cannot be shown");
  });
});

describe("a picture in the record of what happened", () => {
  it("is kept where a conversation reopened tomorrow can still find it", async () => {
    const saved: { mediaType: string; data: string }[] = [];
    const requests: ModelMessage[][] = [];
    const loop = loopWith(true, requests, {
      savePicture: async (image) => {
        saved.push(image);
        return `picture-${saved.length}`;
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check the chart");

    expect(saved).toEqual([{ mediaType: "image/png", data: "AAAA" }]);
    const action = loop.snapshot().tasks[0]?.actions?.[0];
    expect(action?.details).toContainEqual({
      kind: "image",
      label: "Picture",
      mediaType: "image/png",
      source: "picture-1",
      alt: "A picture from Capture page",
    });
    // What is written down names the picture; it does not contain it.
    expect(JSON.stringify(loop.snapshot())).not.toContain("AAAA");
  });
});

describe("how many pictures one request carries", () => {
  it("keeps the most recent ones and says the older ones are gone", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopWith(true, requests, undefined, 12);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Watch the page change");

    const asked = requests.at(-1) ?? [];
    const carried = asked.filter(
      (message) =>
        message.role === "user" &&
        typeof message.content !== "string" &&
        message.content.some((part) => part.kind === "image"),
    );
    // A provider counts images per request, and every one of them is paid for
    // again on every later request in the turn.
    expect(carried.length).toBeLessThanOrEqual(8);
    expect(carried.length).toBeGreaterThan(0);
    // The ones let go are accounted for rather than silently absent.
    expect(JSON.stringify(asked)).toContain("no longer attached");
  });
});

describe("a picture larger than the model accepts", () => {
  it("is made to fit, and the model is told what it is looking at", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopWith(true, requests, undefined, 1, {
      fit: async () => ({
        status: "resized" as const,
        image: { mediaType: "image/png", data: "SMALLER" },
        note: "This picture was 390 by 6231 pixels. It was scaled to 375 by 6000 to be sent. This is a very long page.",
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check the chart");

    const asked = requests.at(-1) ?? [];
    const carrying = asked.find(
      (message) =>
        message.role === "user" && typeof message.content !== "string",
    );
    // The smaller picture is the one sent, and the sentence explaining it
    // travels with it rather than being left for the model to infer.
    expect(carrying?.content).toContainEqual({
      kind: "image",
      mediaType: "image/png",
      data: "SMALLER",
    });
    expect(JSON.stringify(carrying?.content)).toContain(
      "scaled to 375 by 6000",
    );
    expect(JSON.stringify(asked)).not.toContain("AAAA");
  });

  it("is described rather than sent when nothing in it would be legible", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopWith(true, requests, undefined, 1, {
      fit: async () => ({
        status: "unusable" as const,
        note: "This picture is 80 by 9000 pixels. Capture a smaller region instead.",
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check the chart");

    const asked = requests.at(-1) ?? [];
    // Nothing illegible is sent, and the model is told why and what to do.
    expect(JSON.stringify(asked)).not.toContain("AAAA");
    expect(JSON.stringify(asked)).toContain("Capture a smaller region instead");
  });
});

describe("evidence that a picture was changed on its way to the model", () => {
  it("records what was done to it, so the record does not imply the model saw the original", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopWith(true, requests, undefined, 1, {
      fit: async () => ({
        status: "resized" as const,
        image: { mediaType: "image/png", data: "SMALLER" },
        note: "This picture was 390 by 6231 pixels. It was scaled to 125 by 2000 to be sent.",
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check the chart");

    // The store keeps the picture as captured; the model was shown something
    // smaller. Without this, nothing written down says so.
    const details = loop.snapshot().tasks[0]?.actions?.[0]?.details ?? [];
    expect(JSON.stringify(details)).toContain("scaled to 125 by 2000");
  });
});
