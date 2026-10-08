import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import type { AuditEntry } from "@zhiyin/audit";
import { loopFrom, stubDependencies, unfenced } from "./support.js";

/**
 * A tool request whose input is not valid JSON is one of the most common model
 * slips. It does not end the turn: it is read with the fixes that cannot
 * change a value, then repaired by a separate call, then handed back to the
 * model, and only the call that actually ran stays in the conversation.
 */

type Call = {
  readonly id?: string;
  readonly name?: string;
  readonly args: string;
};

/** A read and a write, each recording what it was asked to do. */
function fileTools() {
  const ran: { readonly name: string; readonly args: unknown }[] = [];
  const spec = (name: string, properties: Record<string, unknown>) => ({
    name,
    description: `The ${name} tool.`,
    inputSchema: {
      type: "object",
      properties,
      required: Object.keys(properties),
    },
  });
  return {
    ran,
    registry: {
      list: () => [
        spec("read_file", { path: { type: "string" } }),
        spec("write_file", {
          path: { type: "string" },
          text: { type: "string" },
        }),
      ],
      inspect: async (
        name: string,
        args: unknown,
      ): Promise<ToolCallInspection> => {
        const input = args as Record<string, unknown>;
        const valid =
          typeof input["path"] === "string" &&
          (name === "read_file" || typeof input["text"] === "string");
        return valid
          ? {
              ok: true,
              action: name === "read_file" ? "Read a file" : "Write a file",
              target: String(input["path"]),
              command: name,
            }
          : {
              ok: false,
              correctable: true,
              reason:
                "Choose a workspace-relative file path and the text to write.",
            };
      },
      execute: async (name: string, args: unknown) => {
        ran.push({ name, args });
        return { ok: true as const, value: { done: name } };
      },
    },
  };
}

/** The main model: one batch of calls per round, then a closing answer. */
function mainModel(rounds: readonly (readonly Call[])[]) {
  const requests: ModelMessage[][] = [];
  let round = 0;
  const send = async function* (
    request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    requests.push([...request.messages]);
    const calls = rounds[round];
    round += 1;
    if (!calls) {
      yield { kind: "textDelta", text: "All done." };
    } else {
      yield { kind: "textDelta", text: "I will write the note now." };
      for (const [index, call] of calls.entries())
        yield {
          kind: "toolCallDelta",
          index,
          ...(call.id === undefined
            ? { callId: `call-${round}-${index}` }
            : call.id
              ? { callId: call.id }
              : {}),
          ...(call.name === undefined
            ? {}
            : call.name
              ? { name: call.name }
              : {}),
          argumentsDelta: call.args,
        };
    }
    yield { kind: "done" };
  };
  return { requests, send };
}

/** The repair model: answers each repair request with the next answer. */
function repairModel(
  ...answers: (Record<string, unknown> | { readonly outOfRoom: true })[]
) {
  const requests: ModelRequest[] = [];
  const send = async function* (
    request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    const repairing = request.tools?.some(
      (tool) => tool.name === "record_repair_decision",
    );
    if (repairing) requests.push(request);
    const answer = repairing ? answers.shift() : undefined;
    if (answer && "outOfRoom" in answer) {
      yield { kind: "done", finishReason: "length" };
      return;
    }
    yield { kind: "textDelta", text: JSON.stringify(answer ?? {}) };
    yield { kind: "done", finishReason: "stop" };
  };
  return { requests, send };
}

function recordingAudit() {
  const entries: AuditEntry[] = [];
  return {
    entries,
    log: {
      record: async (entry: AuditEntry) => {
        entries.push(entry);
      },
      read: async () => entries,
      clear: async () => {},
    },
  };
}

function setUp(rounds: readonly (readonly Call[])[], repair = repairModel()) {
  const deps = stubDependencies(() => {});
  const tools = fileTools();
  const main = mainModel(rounds);
  const audit = recordingAudit();
  const loop = loopFrom({
    ...deps,
    tools: tools.registry,
    audit: audit.log,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    guidanceModel: { send: repair.send },
    model: { ...deps.model, send: main.send },
  });
  return { loop, tools, main, repair, audit };
}

function toolResults(messages: readonly ModelMessage[] | undefined) {
  return (messages ?? []).flatMap((message) =>
    message.role === "tool" ? [message] : [],
  );
}

function callsIn(messages: readonly ModelMessage[] | undefined) {
  return (messages ?? []).flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );
}

const read = (path: string): Call => ({
  name: "read_file",
  args: JSON.stringify({ path }),
});
const unescapedQuote: Call = {
  name: "write_file",
  args: '{"path":"note.md","text":"She said "hi" twice."}',
};
const repaired = {
  action: "repair",
  arguments: { path: "note.md", text: 'She said "hi" twice.' },
};

describe("a tool request whose input is not valid JSON", () => {
  it("does not stop the other calls in its batch, and the turn goes on", async () => {
    const { loop, tools, main } = setUp([
      [read("a.md"), unescapedQuote, read("b.md")],
      [{ name: "write_file", args: '{"path":"note.md","text":"Fixed."}' }],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
    expect(tools.ran.map((item) => item.name)).toEqual([
      "read_file",
      "read_file",
      "write_file",
    ]);
    // Every call in the batch was answered, in order.
    expect(toolResults(main.requests[1]).map((m) => m.name)).toEqual([
      "read_file",
      "write_file",
      "read_file",
    ]);
  });

  it("is repaired by a separate call, and only the repaired call stays in the conversation", async () => {
    const { loop, tools, main, audit } = setUp(
      [[unescapedQuote]],
      repairModel(repaired),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(tools.ran).toEqual([
      { name: "write_file", args: repaired.arguments },
    ]);
    const afterwards = main.requests.at(-1);
    expect(
      callsIn(afterwards).map((call) => JSON.parse(call.arguments)),
    ).toEqual([repaired.arguments]);
    // The raw text is nowhere in what the model is sent.
    expect(JSON.stringify(afterwards)).not.toContain(
      JSON.stringify(unescapedQuote.args).slice(1, -1),
    );
    const result = unfenced(toolResults(afterwards)[0]?.content ?? "");
    expect(result.note).toMatch(
      /^Zhiyin corrected this call's input \(invalid JSON: .+\)\.$/,
    );
    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        kind: "repair-applied",
        before: unescapedQuote.args,
      }),
    );
  });

  it("tells the repair what it may change, the tool's schema, and what the model said it was doing", async () => {
    const { loop, repair } = setUp([[unescapedQuote]], repairModel(repaired));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const request = repair.requests[0];
    const prompt = request?.messages[1]?.content ?? "";
    expect(request?.messages[0]?.content).toMatch(/only the JSON syntax/);
    expect(prompt).toContain(JSON.stringify(unescapedQuote.args));
    expect(prompt).toContain('"required":["path","text"]');
    expect(prompt).toContain("I will write the note now.");
    // Room to write the whole call back, not a fixed cap.
    expect(request?.maximumOutputTokens).toBeGreaterThanOrEqual(
      Math.ceil(unescapedQuote.args.length / 3) + 300,
    );
  });

  it("rejects a repair that changes one character of the text, and hands the refusal to the model", async () => {
    const { loop, tools, main, audit } = setUp(
      [[unescapedQuote]],
      repairModel({
        action: "repair",
        arguments: { path: "note.md", text: 'She said "hi" twice!' },
      }),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(tools.ran).toEqual([]);
    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        kind: "repair-rejected",
        cause: "content-changed",
      }),
    );
    const refusal = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(refusal).toMatchObject({
      ok: false,
      refusedBy: "input-check",
      reason: expect.stringMatching(/^The input was not valid JSON: /),
      next: expect.any(String),
    });
    // The next request is valid JSON throughout.
    expect(callsIn(main.requests[1]).map((call) => call.arguments)).toEqual([
      "{}",
    ]);
  });

  it("is not sent to repair when it was cut off, and the model is told so", async () => {
    const { loop, main, repair } = setUp([
      [
        {
          name: "write_file",
          args: '{"path":"note.md","text":"The first half',
        },
      ],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(repair.requests).toEqual([]);
    const refusal = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(refusal.reason).toMatch(/cut off/);
    expect(refusal.next).toMatch(/shorter|split/);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("records a repair that ran out of room as out of room", async () => {
    const { loop, audit } = setUp(
      [[unescapedQuote]],
      repairModel({ outOfRoom: true }),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        kind: "repair-rejected",
        cause: "out-of-room",
      }),
    );
  });

  it("is fixed without a model when the fix cannot change a value, and the model is told", async () => {
    const trailingComma: Call = {
      name: "write_file",
      args: '{"path":"note.md","text":"Line one\nLine two",}',
    };
    const { loop, tools, main, repair, audit } = setUp([[trailingComma]]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(repair.requests).toEqual([]);
    expect(tools.ran).toEqual([
      {
        name: "write_file",
        args: { path: "note.md", text: "Line one\nLine two" },
      },
    ]);
    const result = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(result.note).toMatch(/^Zhiyin corrected this call's input/);
    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        kind: "repair-applied",
        before: trailingComma.args,
      }),
    );
  });

  it("leaves neither the malformed call nor its refusal in the request once the tool succeeds", async () => {
    const { loop, main } = setUp([
      [unescapedQuote],
      [{ name: "write_file", args: '{"path":"note.md","text":"Fixed."}' }],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const afterSuccess = JSON.stringify(main.requests.at(-1));
    expect(afterSuccess).not.toContain("not valid JSON");
    expect(callsIn(main.requests.at(-1))).toHaveLength(1);
    expect(toolResults(main.requests.at(-1))).toHaveLength(1);
  });

  it("shows the person the failure once the model has used its quiet corrections", async () => {
    const { loop } = setUp([
      [unescapedQuote],
      [unescapedQuote],
      [unescapedQuote],
      [unescapedQuote],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/^The input was not valid JSON: /),
    });
  });

  it("keeps what arrived of refused input in the failed action, its start and where it stopped", async () => {
    const cutOff: Call = {
      name: "write_file",
      args: `{"path":"note.md","text":"Opening words. ${"middle ".repeat(5_000)}last words before the cut`,
    };
    const { loop } = setUp([[cutOff], [cutOff], [cutOff], [cutOff]]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const command = loop.snapshot().tasks[0]?.actions?.[0]?.command ?? "";
    expect(command).toContain("Opening words.");
    expect(command).toContain("last words before the cut");
    expect(command.length).toBeLessThan(5_000);
  });
});

describe("a refusal the model receives", () => {
  it("says who refused and what to do next, differently for the input check and the tool", async () => {
    const { loop, main } = setUp([
      [unescapedQuote, { name: "write_file", args: '{"path":"note.md"}' }],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const [inputCheck, tool] = toolResults(main.requests[1]).map((message) =>
      unfenced(message.content),
    );
    expect(inputCheck?.["refusedBy"]).toBe("input-check");
    expect(tool?.["refusedBy"]).toBe("tool");
    expect(inputCheck?.["next"]).toEqual(expect.any(String));
    expect(tool?.["next"]).toEqual(expect.any(String));
    expect(inputCheck?.["next"]).not.toBe(tool?.["next"]);
  });
});

describe("a tool request streamed without its id or name", () => {
  it("is given an id, so its result still pairs with it", async () => {
    const { loop, tools, main } = setUp([
      [{ id: "", name: "read_file", args: '{"path":"a.md"}' }],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read it");

    expect(tools.ran).toHaveLength(1);
    const [call] = callsIn(main.requests[1]);
    expect(call?.id).toBeTruthy();
    expect(toolResults(main.requests[1])[0]?.toolCallId).toBe(call?.id);
  });

  it("ends the turn when the name is missing, but only after the valid calls ran", async () => {
    const { loop, tools } = setUp([
      [read("a.md"), { name: "", args: '{"path":"b.md"}' }, read("c.md")],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read them");

    expect(tools.ran.map((item) => item.args)).toEqual([
      { path: "a.md" },
      { path: "c.md" },
    ]);
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({ kind: "failed" });
  });
});
