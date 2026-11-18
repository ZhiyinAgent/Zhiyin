/**
 * A specialist is shown the pictures its tools make, as a turn's model is:
 * sent as themselves after the answer, kept with its run by where they are
 * stored, and named as not sent to a model that cannot see pictures.
 */

import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

function reviewing(acceptsImages: boolean, looks = 1, perLook = 1) {
  const base = stubDependencies(() => {});
  const childRequests: (readonly ModelMessage[])[] = [];
  const loop = loopFrom({
    ...base,
    acceptsImages,
    plugins: pluginsOffering([
      pluginOffering({
        name: "studio",
        specialists: [
          {
            id: "reviewer",
            name: "Reviewer",
            description: "Looks at the work.",
            instructions: "Look, then report.",
            access: "read",
          },
        ],
      }),
    ]),
    tools: {
      list: () => [
        {
          name: "look",
          description: "Look at the scene.",
          inputSchema: { type: "object" },
          access: "read" as const,
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Look at the scene",
        target: "scene",
        command: "look()",
      }),
      execute: async () => ({
        ok: true as const,
        value: "Four views of the scene.",
        images: Array.from({ length: perLook }, () => ({
          mediaType: "image/png",
          data: "AAAA",
        })),
      }),
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Reads." }),
    },
    model: {
      ...base.model,
      send: async function* (request: ModelRequest) {
        const text = JSON.stringify(request.messages);
        if (text.includes("You are the Reviewer specialist")) {
          childRequests.push([...request.messages]);
          yield childRequests.length <= looks
            ? {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: `look-${childRequests.length}`,
                name: "look",
                argumentsDelta: "{}",
              }
            : {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "finish-1",
                name: "finish_specialist",
                argumentsDelta: JSON.stringify({ report: "The legs float." }),
              };
        } else if (!text.includes("Review the table")) {
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: "delegate-1",
            name: "delegate_specialist",
            argumentsDelta: JSON.stringify({
              id: "studio/reviewer",
              task: "Review the table",
            }),
          };
        } else yield { kind: "textDelta" as const, text: "Delegated." };
        yield { kind: "done" as const };
      },
    },
  });
  return { loop, childRequests };
}

async function reviewed(acceptsImages: boolean, looks = 1, perLook = 1) {
  const { loop, childRequests } = reviewing(acceptsImages, looks, perLook);
  const taskId = await loop.createTask();
  await loop.start(taskId, "Make a table");
  await until(
    () => loop.snapshot().tasks[0]?.specialistRuns[0]?.status === "completed",
  );
  return {
    run: loop.snapshot().tasks[0]!.specialistRuns[0]!,
    after: childRequests[looks] ?? [],
  };
}

const images = (messages: readonly ModelMessage[]) =>
  messages.flatMap((message) =>
    message.role === "user" && typeof message.content !== "string"
      ? message.content.filter((part) => part.kind === "image")
      : [],
  );

describe("a specialist's tool that makes a picture", () => {
  it("shows the specialist the picture after the answer, and keeps where it is stored", async () => {
    const { run, after } = await reviewed(true);

    expect(images(after)).toEqual([
      { kind: "image", mediaType: "image/png", data: "AAAA" },
    ]);
    const kept = run.transcript?.find((entry) => entry.kind === "pictures");
    expect(kept).toMatchObject({
      kind: "pictures",
      pictures: [{ mediaType: "image/png" }],
    });
    expect(run.handoff?.report).toBe("The legs float.");
  });

  it("tells a specialist on a model that cannot see pictures that none was sent", async () => {
    const { after } = await reviewed(false);

    expect(images(after)).toEqual([]);
    const answer = after.find((message) => message.role === "tool");
    expect(String(answer?.content)).toContain("picturesNotSent");
  });

  it("lets go of its oldest pictures past eight, keeping the newest four and saying so", async () => {
    const { run, after } = await reviewed(true, 4, 3);

    // The third look made nine: only its three stayed. The fourth makes six,
    // within eight, so both stay.
    expect(images(after)).toHaveLength(6);
    expect(JSON.stringify(after)).toContain(
      "3 pictures shown earlier are no longer attached",
    );
    const kept = (run.transcript ?? []).filter(
      (entry) => entry.kind === "pictures",
    );
    expect(kept.map((entry) => entry.pictures.length)).toEqual([0, 0, 3, 3]);
  });

  it("keeps its first two pictures when it lets go of others, as a turn does", async () => {
    const { run, after } = await reviewed(true, 9, 1);

    // The ninth look made nine: the first two stay, with the newest two.
    expect(images(after)).toHaveLength(4);
    const kept = (run.transcript ?? []).filter(
      (entry) => entry.kind === "pictures",
    );
    expect(kept.map((entry) => entry.pictures.length)).toEqual([
      1, 1, 0, 0, 0, 0, 0, 1, 1,
    ]);
  });
});
