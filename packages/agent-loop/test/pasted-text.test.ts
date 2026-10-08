/**
 * A long paste travels as an attachment: kept beside the conversation, named
 * to the model by its address, and never copied into the message itself.
 */

import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { loopFrom, stubDependencies } from "./support.js";

const paste: MessageAttachment = {
  kind: "pastedText",
  id: "pasted-2026-09-24-101500.txt",
  bytes: 48_000,
  lines: 1_200,
};

function withDrafts(drafts: readonly MessageAttachment[]) {
  const requests: ModelMessage[][] = [];
  const claimed: string[][] = [];
  const deps = stubDependencies(() => {}, [
    { kind: "textDelta", text: "Read it." },
    { kind: "done" },
  ]);
  const loop = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      claimDrafts: async (_conversationId, ids) => {
        claimed.push([...ids]);
        return drafts.filter((draft) => ids.includes(draft.id));
      },
    },
    model: {
      ...deps.model,
      send: (request) => {
        requests.push([...request.messages]);
        return deps.model.send(request);
      },
    },
  });
  return { loop, requests, claimed };
}

function lastUserText(messages: readonly ModelMessage[]): string {
  const content = messages.findLast(
    (message) => message.role === "user",
  )?.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

describe("a pasted text sent with a message", () => {
  it("reaches the model as an address to read, beside the person's words", async () => {
    const { loop, requests, claimed } = withDrafts([paste]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise this log", undefined, [paste.id]);

    expect(claimed).toEqual([[paste.id]]);
    const sent = lastUserText(requests[0] ?? []);
    expect(sent).toContain("Summarise this log");
    expect(sent).toContain(
      `Pasted text saved as attachment://${paste.id} (47 KB, 1,200 lines); read it with read_file`,
    );
    const message = loop.snapshot().tasks[0]?.messages[0];
    expect(message).toMatchObject({
      text: "Summarise this log",
      attachments: [paste],
    });
  });

  it("may be the whole message, and names the conversation when nothing else does", async () => {
    const { loop, requests } = withDrafts([paste]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "", undefined, [paste.id]);

    expect(lastUserText(requests[0] ?? [])).toContain(
      `attachment://${paste.id}`,
    );
    expect(loop.snapshot().tasks[0]?.title).toBe("Pasted text");
  });

  it("of 10 MB sends a message under 1 KB", async () => {
    const large: MessageAttachment = {
      ...paste,
      bytes: 10 * 1024 * 1024,
      lines: 180_000,
    };
    const { loop, requests } = withDrafts([large]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "What failed?", undefined, [large.id]);

    const sent = lastUserText(requests[0] ?? []);
    expect(sent).toContain("(10.0 MB, 180,000 lines)");
    expect(Buffer.byteLength(sent)).toBeLessThan(1024);
  });

  it("is refused when it was never kept, rather than sending an empty message", async () => {
    const { loop, requests } = withDrafts([]);
    const taskId = await loop.createTask();

    await expect(
      loop.start(taskId, "", undefined, ["pasted-unknown.txt"]),
    ).rejects.toThrow("The pasted text is no longer available");

    expect(requests).toHaveLength(0);
    expect(loop.running(taskId)).toBe(false);
    expect(loop.snapshot().tasks[0]?.messages).toEqual([]);
  });
});
