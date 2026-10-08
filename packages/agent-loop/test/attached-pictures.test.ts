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

  it("past what one request holds, the oldest are let go and the person's words stay", async () => {
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
    expect(pictures.filter(Boolean).length).toBeLessThanOrEqual(8);
    expect(pictures.at(-1)).toBe(true);
    expect(pictures[0]).toBe(false);
    expect(JSON.stringify(sent[0]?.content)).toContain("What is in p1?");
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
