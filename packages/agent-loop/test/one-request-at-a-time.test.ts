/**
 * An account that takes one request at a time.
 *
 * Some labs limit how many requests an account may have open at once, down to
 * one on a new account. A turn asks for names and labels beside its answer, so
 * on such an account they compete for the one place. The answer is what the
 * person waits for: the names and labels give way to it, and a conversation's
 * name is asked again once the turn is over.
 */

import { describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import {
  ModelClientError,
  type ModelEvent,
  type ModelRequest,
} from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * Two clients sharing one account that takes a single open request. A request
 * sent while another is open is refused as the client reports it: retried,
 * then failed once the retries run out. The first request for a name or label
 * keeps its place until it is stopped or the answer has given up.
 */
function oneAtATime(rounds: readonly (readonly ModelEvent[])[]) {
  let open = 0;
  let answerSettled = () => {};
  const answerOver = new Promise<void>((resolve) => (answerSettled = resolve));
  const presenting: ModelRequest[] = [];
  let round = 0;

  async function* refusedWhileOpen(): AsyncGenerator<ModelEvent> {
    for (let attempt = 2; open > 0; attempt += 1) {
      if (attempt > 5)
        throw new ModelClientError(
          "rateLimited",
          "The account allows one request at a time.",
        );
      yield {
        kind: "retrying",
        attempt,
        maximumAttempts: 5,
        delayMs: 0,
        reason: "rateLimited",
        message: "The account allows one request at a time.",
      };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const answering = {
    send: async function* (): AsyncGenerator<ModelEvent> {
      const events = rounds[round++] ?? [];
      const last = round === rounds.length;
      try {
        yield* refusedWhileOpen();
        open += 1;
        yield* events;
        yield { kind: "done", finishReason: "stop" };
        open -= 1;
      } finally {
        if (last) answerSettled();
      }
    },
  };

  const guidance = {
    send: async function* (request: ModelRequest): AsyncGenerator<ModelEvent> {
      presenting.push(request);
      yield* refusedWhileOpen();
      open += 1;
      try {
        if (presenting.length === 1) {
          const stopped = new Promise<void>((resolve) => {
            if (request.signal?.aborted) resolve();
            request.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          await Promise.race([stopped, answerOver]);
          if (request.signal?.aborted) return;
        }
        yield {
          kind: "textDelta",
          text: '{"title":"Explain the assistant","description":"Reads the notes."}',
        };
        yield { kind: "done", finishReason: "stop" };
      } finally {
        open -= 1;
      }
    },
  };

  return { answering, guidance };
}

describe("an account that takes one request at a time", () => {
  it("answers the first message, and names the conversation after it", async () => {
    const account = oneAtATime([
      [{ kind: "textDelta", text: "I am an assistant." }],
    ]);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: { ...deps.model, ...account.answering },
      guidanceModel: account.guidance,
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Who are you and what can you do?");

    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    expect(task?.messages.at(-1)?.text).toBe("I am an assistant.");
    expect(task?.title).toBe("Explain the assistant");
  });

  it("goes on past an action whose label is still being asked for, keeping the action's own label", async () => {
    const account = oneAtATime([
      [
        {
          kind: "toolCallDelta",
          index: 0,
          callId: "call-1",
          name: "read",
          argumentsDelta: "{}",
        },
      ],
      [{ kind: "textDelta", text: "The notes are read." }],
    ]);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: {
        list: () => [
          {
            name: "read",
            description: "Read.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Read",
          target: "notes",
          command: "read({})",
          access: "read",
          scope: "workspace",
        }),
        execute: async () => ({ ok: true, value: "notes" }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
      },
      model: { ...deps.model, ...account.answering },
      guidanceModel: account.guidance,
    });
    loop.restore([
      {
        id: "task-1",
        title: "Earlier work",
        titleSource: "manual",
        updatedLabel: "Earlier",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        messages: [],
        actions: [],
        phase: {
          kind: "completed",
          outcome: { title: "Response complete", summary: "Done." },
        },
      },
    ]);

    await loop.start("task-1", "Read the notes");

    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    expect(task?.messages.at(-1)?.text).toBe("The notes are read.");
    expect(task?.actions).toHaveLength(1);
    expect(task?.actions[0]?.action).not.toBe("Explain the assistant");
  });
});
