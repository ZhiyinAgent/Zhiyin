import { describe, expect, it } from "vitest";
import type { ToolCallInspection, ToolSpec } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import { fakeCorrectionsLog } from "@zhiyin/corrections-log/testing";
import { loopFrom, stubDependencies, unfenced } from "./support.js";

/**
 * A tool request whose input is not valid JSON is one of the most common model
 * slips. It does not end the turn: it is read with the fixes that cannot
 * change a value, and otherwise handed back to the model (ADR 0009). Only the
 * call that actually ran stays in the conversation.
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
        // One whose schema says it takes no other field.
        {
          ...spec("open_note", { path: { type: "string" } }),
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      ],
      inspect: async (
        name: string,
        args: unknown,
      ): Promise<ToolCallInspection> => {
        const input = args as Record<string, unknown>;
        const valid =
          typeof input["path"] === "string" &&
          (name !== "write_file" || typeof input["text"] === "string");
        // A tool that says itself how the input departs from its schema.
        if (!valid && name === "open_note")
          return {
            ok: false,
            correctable: true,
            reason: "The note cannot be opened as given: “path” must be text.",
          };
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

function setUp(
  rounds: readonly (readonly Call[])[],
  connected: readonly ToolSpec[] = [],
) {
  const deps = stubDependencies(() => {});
  const tools = fileTools();
  const main = mainModel(rounds);
  const corrections = fakeCorrectionsLog();
  const loop = loopFrom({
    ...deps,
    mcp: { ...deps.mcp, availableTools: async () => connected },
    tools: tools.registry,
    corrections,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: { ...deps.model, send: main.send },
  });
  return { loop, tools, main, corrections };
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

  it("is answered to the model alone, and does not run", async () => {
    const { loop, tools, main, corrections } = setUp([[unescapedQuote]]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(tools.ran).toEqual([]);
    expect(corrections.entries.map((entry) => entry.kind)).toEqual([
      "quiet-retry",
    ]);
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

  it("tells the model a long call that stopped early to send less", async () => {
    const { loop, main } = setUp([
      [
        {
          name: "write_file",
          args: `{"path":"note.md","text":"The first half ${"of a long note ".repeat(400)}`,
        },
      ],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const refusal = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(refusal.reason).toMatch(/never closed/);
    expect(refusal.next).toMatch(/shorter|split/);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("tells the model a short call that stopped early was not cut for its length", async () => {
    // What a provider sends when it could not turn a call the model wrote out
    // back into arguments: the start of them, a few dozen characters long.
    const { loop, main } = setUp([
      [{ name: "write_file", args: '{"path":"note.md","text":' }],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    const refusal = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(refusal.reason).toMatch(/never closed/);
    expect(refusal.next).toMatch(/not cut for its length/);
    expect(refusal.next).not.toMatch(/shorter|split/);
  });

  it("tells the model a whole call that leaves a bracket open what is wrong, not that it was cut off", async () => {
    // A call DeepSeek V4.1 Flash wrote in full: the list of edits is never
    // closed, and its purpose sits inside it.
    const { loop, main } = setUp([
      [
        {
          name: "write_file",
          args: '{"edits": [{"path": "stand1.py", "replacements": [{"find": "a", "replace": "b"}], "purpose": "Pull the back in"}',
        },
      ],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Edit the stand");

    const refusal = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(refusal.reason).not.toMatch(/cut off/);
    expect(refusal.reason).toMatch(/never closed/);
    expect(refusal.next).toMatch(/close every bracket/i);
  });

  it("names a connector's failed call by the tool, not by its routing", async () => {
    const stopped: Call = {
      name: "mcp__studio__set_camera",
      args: '{"location":[0,-0.35,0.05],"look_at":',
    };
    const { loop } = setUp(
      [[stopped], [stopped], [stopped], [stopped]],
      [
        {
          name: "mcp__studio__set_camera",
          description: "Sets the camera.",
          inputSchema: { type: "object" },
          // As the connection feature names its tools.
          connection: { id: "studio", tool: "set_camera" },
        },
      ],
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Frame the mug");

    expect(loop.snapshot().tasks[0]?.actions?.[0]?.action).toBe("Set camera");
  });

  it("tells the model a field its tool does not take went unused, when the tool runs the call", async () => {
    const { loop, tools, main } = setUp([
      [{ name: "open_note", args: '{"path":"note.md","loop":true}' }],
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Open the note");

    expect(tools.ran).toHaveLength(1);
    const result = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(result.note).toBe(
      "“loop” is not a field of open_note, so the call ran without it.",
    );
  });

  it("is fixed without a model when the fix cannot change a value, and the model is told", async () => {
    const trailingComma: Call = {
      name: "write_file",
      args: '{"path":"note.md","text":"Line one\nLine two",}',
    };
    const { loop, tools, main, corrections } = setUp([[trailingComma]]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the note");

    expect(tools.ran).toEqual([
      {
        name: "write_file",
        args: { path: "note.md", text: "Line one\nLine two" },
      },
    ]);
    const result = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(result.note).toMatch(/^Zhiyin corrected this call's input/);
    expect(corrections.entries).toContainEqual(
      expect.objectContaining({
        kind: "input-corrected",
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

  it("gives the tool's refusal as the tool words it", async () => {
    const { loop, main } = setUp([[{ name: "open_note", args: '{"path":7}' }]]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Open the note");

    const [answer] = toolResults(main.requests[1]).map((message) =>
      unfenced(message.content),
    );
    expect(answer?.["reason"]).toBe(
      "The note cannot be opened as given: “path” must be text.",
    );
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

describe("a tool request whose list arrives as the JSON text of one", () => {
  it("runs with the list its schema asks for, and the model is told", async () => {
    const ran: unknown[] = [];
    const deps = stubDependencies(() => {});
    const main = mainModel([
      [
        {
          name: "multi_edit",
          args: JSON.stringify({
            path: "note.md",
            edits: JSON.stringify([{ find: "Dana", replace: "Kim" }]),
          }),
        },
      ],
    ]);
    const loop = loopFrom({
      ...deps,
      tools: {
        list: () => [
          {
            name: "multi_edit",
            description: "Replace exact text in a file.",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string" },
                edits: { type: "array", items: { type: "object" } },
              },
              required: ["path", "edits"],
            },
          },
        ],
        inspect: async (
          _name: string,
          args: unknown,
        ): Promise<ToolCallInspection> =>
          Array.isArray((args as { edits?: unknown }).edits)
            ? {
                ok: true,
                action: "Edit a file",
                target: "note.md",
                command: "multi_edit",
              }
            : {
                ok: false,
                correctable: true,
                reason: "edits must be a list.",
              },
        execute: async (_name: string, args: unknown) => {
          ran.push(args);
          return { ok: true as const, value: { edited: true } };
        },
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: { ...deps.model, send: main.send },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    expect(ran).toEqual([
      { path: "note.md", edits: [{ find: "Dana", replace: "Kim" }] },
    ]);
    const result = unfenced(toolResults(main.requests[1])[0]?.content ?? "");
    expect(result.note).toBe(
      "Zhiyin corrected this call's input (edits sent as text).",
    );
  });
});
