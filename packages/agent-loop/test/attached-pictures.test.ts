import { describe, expect, it } from "vitest";
import type { MessageAttachment, StoredPicture } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import { loopAndHost, stubDependencies } from "./support.js";

/** A picture the person attached, as the store answers for it once claimed. */
function attached(id: string): MessageAttachment {
  return {
    kind: "picture",
    id,
    name: `${id}.png`,
    mediaType: "image/png",
    bytes: 3,
    source: `pasted-pictures/c-task/${id}`,
  };
}

/**
 * A loop whose model only answers, recording every request. `stored` is what
 * the picture store holds now, by source; anything else is gone.
 */
function loopSeeing(
  acceptsImages: boolean,
  stored: Map<string, StoredPicture>,
) {
  const requests: ModelMessage[][] = [];
  const deps = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...deps,
    acceptsImages,
    sessions: {
      ...deps.sessions,
      claimDrafts: async (_conversationId, ids) => ids.map(attached),
      readPicture: async (source) =>
        stored.get(source) ?? {
          status: "missing",
          reason: "This picture was deleted to save disk space.",
        },
    },
    model: {
      ...deps.model,
      settings: async () => ({
        ...(await deps.model.settings()),
        acceptsImages,
      }),
      send: async function* (request: ModelRequest) {
        requests.push([...request.messages]);
        yield { kind: "textDelta" as const, text: "I see it." };
        yield { kind: "done" as const };
      },
    },
  });
  return { loop: host.app, host, requests };
}

function storing(...ids: string[]): Map<string, StoredPicture> {
  return new Map(
    ids.map((id) => [
      `pasted-pictures/c-task/${id}`,
      { status: "ready", mediaType: "image/png", data: `DATA-${id}` },
    ]),
  );
}

/** The person's messages in a request, as the model is sent them. */
function personal(request: readonly ModelMessage[] | undefined) {
  return (request ?? []).filter(
    (message) =>
      message.role === "user" &&
      JSON.stringify(message.content).includes("What is"),
  );
}

describe("a picture a person attached", () => {
  it("is sent with their words, as a picture, and named so the model can look again", async () => {
    const { loop, requests } = loopSeeing(true, storing("shot"));
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is wrong here?", undefined, ["shot"]);

    expect(personal(requests.at(-1))).toEqual([
      {
        role: "user",
        content: [
          {
            kind: "text",
            text: "What is wrong here?\n\nPicture attached as attachment://shot (shot.png); look at it again with read_document",
          },
          { kind: "image", mediaType: "image/png", data: "DATA-shot" },
        ],
      },
    ]);
  });

  it("is sent as a note saying why, once it is no longer stored", async () => {
    const stored = storing("shot");
    const { loop, requests } = loopSeeing(true, stored);
    const taskId = await loop.createTask();
    await loop.start(taskId, "What is wrong here?", undefined, ["shot"]);
    stored.clear();

    await loop.start(taskId, "What is it now?");

    const [first] = personal(requests.at(-1));
    expect(JSON.stringify(first?.content)).toContain(
      "A picture the person attached is no longer stored. This picture was deleted to save disk space.",
    );
    expect(JSON.stringify(first?.content)).not.toContain("DATA-shot");
  });

  it("is never sent to a model that cannot see pictures; a note says it was there", async () => {
    const { loop, requests } = loopSeeing(false, storing("shot"));
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is wrong here?", undefined, ["shot"]);

    const sent = JSON.stringify(requests.at(-1));
    expect(sent).not.toContain('"kind":"image"');
    expect(sent).toContain(
      "A picture was attached here. This model cannot see pictures, so it was not sent.",
    );
  });

  it("sent before the model was switched to one that cannot see, goes as a note from then on", async () => {
    const { loop, host, requests } = loopSeeing(true, storing("shot"));
    const taskId = await loop.createTask();
    await loop.start(taskId, "What is wrong here?", undefined, ["shot"]);
    expect(JSON.stringify(requests.at(-1))).toContain("DATA-shot");

    host.images = false;
    await loop.start(taskId, "What is it now?");

    const sent = JSON.stringify(requests.at(-1));
    expect(sent).not.toContain("DATA-shot");
    expect(sent).toContain(
      "A picture was attached here. This model cannot see pictures, so it was not sent.",
    );
  });

  it("past what one request holds, those in the middle are let go: the first two and the newest stay, and the person's words stay", async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `p${index + 1}`);
    const { loop, requests } = loopSeeing(true, storing(...ids));
    const taskId = await loop.createTask();

    for (const id of ids)
      await loop.start(taskId, `What is in ${id}?`, undefined, [id]);

    const sent = personal(requests.at(-1));
    expect(sent).toHaveLength(9);
    const pictures = sent.map((message) =>
      JSON.stringify(message.content).includes('"kind":"image"'),
    );
    expect(pictures).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(JSON.stringify(sent[2]?.content)).toContain("What is in p3?");
  });

  it("counts pictures, not messages, so two full messages never send sixteen", async () => {
    const first = Array.from({ length: 8 }, (_, index) => `a${index}`);
    const second = Array.from({ length: 8 }, (_, index) => `b${index}`);
    const { loop, requests } = loopSeeing(true, storing(...first, ...second));
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is in these?", undefined, first);
    await loop.start(taskId, "What is in those?", undefined, second);

    const images = JSON.stringify(requests.at(-1)).split('"kind":"image"');
    expect(images.length - 1).toBe(8);
    expect(JSON.stringify(personal(requests.at(-1))[0])).toContain(
      "What is in these?",
    );
  });

  it("lets the first two go too when the newest message leaves them no room", async () => {
    const newest = Array.from({ length: 7 }, (_, index) => `n${index}`);
    const { loop, requests } = loopSeeing(true, storing("p1", "p2", ...newest));
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is in p1?", undefined, ["p1"]);
    await loop.start(taskId, "What is in p2?", undefined, ["p2"]);
    await loop.start(taskId, "What is in these?", undefined, newest);

    const pictures = personal(requests.at(-1)).map((message) =>
      JSON.stringify(message.content).includes('"kind":"image"'),
    );
    expect(pictures).toEqual([false, false, true]);
  });

  it("refuses more than one request can hold in one message", async () => {
    const { loop, requests } = loopSeeing(true, storing());
    const taskId = await loop.createTask();
    const nine = Array.from({ length: 9 }, (_, index) => `p${index}`);

    await expect(
      loop.start(taskId, "What is all this?", undefined, nine),
    ).rejects.toThrow("A message can carry at most 8 pictures.");
    expect(requests).toEqual([]);
  });
});

describe("a picture a model that cannot see is not sent", () => {
  /** A loop whose provider counts each request at `count` input tokens. */
  function counting(count: number, contextWindow = 128_000) {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      acceptsImages: true,
      modelWindow: {
        model: "small",
        contextWindow,
        maximumOutputTokens: 1_000,
      },
      sessions: {
        ...deps.sessions,
        claimDrafts: async (_conversationId, ids) => ids.map(attached),
        readPicture: async (source) =>
          storing("shot").get(source) ?? {
            status: "missing",
            reason: "Gone.",
          },
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
                ? JSON.stringify({ summary: "A picture was looked at." })
                : "I see it.",
          };
          yield {
            kind: "usage" as const,
            usage: {
              requestId: "r",
              model: "small",
              inputTokens: count,
              outputTokens: 10,
              totalTokens: count + 10,
            },
          };
          yield { kind: "done" as const };
        },
      },
    });
    return { loop: host.app, host, requests };
  }

  it("is not counted in the size of the conversation, which keeps to the provider's count", async () => {
    const { loop, host } = counting(1_000);
    const taskId = await loop.createTask();
    await loop.start(taskId, "What is wrong here?", undefined, ["shot"]);
    host.images = false;
    await loop.start(taskId, "What is it now?");

    await loop.start(taskId, "And now?");

    const usage = host.find(taskId)?.contextUsage;
    expect(usage?.measured).toBe(true);
    // The count, and the short exchange added since; no picture's 4,800,
    // in the total or in the part the conversation takes of it.
    expect(usage?.totalTokens).toBeLessThan(1_500);
    expect(usage?.parts.conversation).toBeLessThan(1_500);
  });

  it("is not sent to the model when the conversation is condensed", async () => {
    const { loop, host, requests } = counting(1_000, 16_000);
    const taskId = await loop.createTask();
    await loop.start(taskId, "What is wrong here?", undefined, ["shot"]);
    for (const ask of ["Anything else?", "And the legend?", "The axis?"])
      await loop.start(taskId, `${ask} ${"Some detail. ".repeat(1_500)}`);
    const before = requests.length;
    host.images = false;

    await loop.condenseNow(taskId);

    expect(host.find(taskId)?.condensings.at(-1)?.outcome).toBe("condensed");
    expect(JSON.stringify(requests.slice(before))).not.toContain("DATA-shot");
  });
});
