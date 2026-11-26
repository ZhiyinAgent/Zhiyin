import { describe, expect, it } from "vitest";
import {
  readAsKey,
  type ToolCallInspection,
  type ToolSpec,
} from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import { fakeCorrectionsLog } from "@zhiyin/corrections-log/testing";
import { schemaProblems } from "@zhiyin/tool-input";
import { answerTo, overCatalog, type Step } from "./catalog-fixture.js";
import { resultOf, withPlan } from "./plan-fixture.js";
import { loopFrom, stubDependencies, unfenced } from "./support.js";

/**
 * A call that misses its tool's schema in a way that has one reading is
 * corrected and run, and the model is told what was corrected, as broken JSON
 * is. What could mean more than one thing is refused as before.
 */

type Call = { readonly name: string; readonly args: unknown };

/** Tools that refuse, as real ones do, any input that departs from their schema. */
const specs: readonly ToolSpec[] = [
  {
    name: "frame_sheet",
    description: "Renders a sheet of frames.",
    inputSchema: {
      type: "object",
      properties: {
        frames: { type: "integer", minimum: 1, maximum: 24 },
        frame_width: { type: "integer", minimum: 160, maximum: 640 },
      },
      required: ["frames"],
      additionalProperties: false,
    },
  },
  {
    name: "build",
    description: "Builds the parts and writes the files.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        exports: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "multi_edit",
    description: "Replaces exact text in files.",
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              replacements: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    find: { type: "string" },
                    replace: { type: "string" },
                  },
                  required: ["find", "replace"],
                  additionalProperties: false,
                },
              },
            },
            required: ["path", "replacements"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    },
  },
  {
    name: "look",
    description: "Sets the scene's look.",
    inputSchema: {
      type: "object",
      properties: { exposure: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "contact_sheet",
    description: "Lays frames side by side.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "number" },
        tile_width: { type: "integer", minimum: 160, maximum: 640 },
      },
      additionalProperties: false,
      [readAsKey]: {
        start: "time",
        frame_width: "tile_width",
        picture_width: "tile_width",
      },
    },
  },
  {
    name: "mcp__blender__blender_set_material",
    description: "Sets an object's material.",
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string" },
        color: { type: "string" },
      },
      required: ["object"],
      additionalProperties: false,
    },
  },
];

function setUp(rounds: readonly (readonly Call[])[]) {
  const ran: { readonly name: string; readonly args: unknown }[] = [];
  const requests: ModelMessage[][] = [];
  const toolsSent: (ModelRequest["tools"] | undefined)[] = [];
  const deps = stubDependencies(() => {});
  const corrections = fakeCorrectionsLog();
  let round = 0;
  const send = async function* (
    request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    requests.push([...request.messages]);
    toolsSent.push(request.tools);
    const calls = rounds[round];
    round += 1;
    if (!calls) yield { kind: "textDelta", text: "All done." };
    else
      for (const [index, call] of calls.entries())
        yield {
          kind: "toolCallDelta",
          index,
          callId: `call-${round}-${index}`,
          name: call.name,
          argumentsDelta: JSON.stringify(call.args),
        };
    yield { kind: "done" };
  };
  const loop = loopFrom({
    ...deps,
    tools: {
      list: () => specs,
      inspect: async (
        name: string,
        args: unknown,
      ): Promise<ToolCallInspection> => {
        const schema = specs.find((spec) => spec.name === name)?.inputSchema;
        const problems = schemaProblems(args, schema);
        return problems.length
          ? {
              ok: false,
              correctable: true,
              reason: `The input does not match the tool's schema: ${problems.join("; ")}.`,
            }
          : { ok: true, action: `Run ${name}`, target: name, command: name };
      },
      execute: async (name: string, args: unknown) => {
        ran.push({ name, args });
        return { ok: true as const, value: `${name} ran.` };
      },
    },
    corrections,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: { ...deps.model, send },
  });
  /** What the model was answered for the first call, read back. */
  const firstAnswer = () => {
    const message = (requests[1] ?? []).find((item) => item.role === "tool");
    return unfenced(String(message?.content ?? ""));
  };
  return { loop, ran, requests, toolsSent, corrections, firstAnswer };
}

async function run(fixture: ReturnType<typeof setUp>) {
  const taskId = await fixture.loop.createTask();
  await fixture.loop.start(taskId, "Do the work");
  return fixture.loop.snapshot().tasks[0];
}

describe("a value past its schema's limit", () => {
  it("is refused, naming the limit, when it is a number: moving it would change what the model asked for", async () => {
    const fixture = setUp([
      [{ name: "frame_sheet", args: { frames: 12, frame_width: 960 } }],
    ]);

    await run(fixture);

    expect(fixture.ran).toEqual([]);
    const answer = fixture.firstAnswer();
    expect(answer).toMatchObject({ ok: false });
    expect(String(answer.reason)).toContain(
      "“frame_width” must be at most 640",
    );
    expect(answer.note).toBeUndefined();
    expect(fixture.corrections.entries).not.toContainEqual(
      expect.objectContaining({ kind: "input-corrected" }),
    );
  });

  it("is refused, naming the limit, when it is a list past its most items", async () => {
    const exports = Array.from({ length: 9 }, (_, index) => ({
      path: `part-${index}.step`,
    }));
    const fixture = setUp([
      [{ name: "build", args: { code: "box()", exports } }],
    ]);

    await run(fixture);

    expect(fixture.ran).toEqual([]);
    const answer = fixture.firstAnswer();
    expect(answer).toMatchObject({ ok: false });
    expect(String(answer.reason)).toContain(
      "“exports” must hold at most 8 items",
    );
    expect(answer.note).toBeUndefined();
  });
});

describe("a field sent under a name its schema reads as another", () => {
  it("runs as that field, and the model is told what it was read as", async () => {
    const fixture = setUp([
      [{ name: "contact_sheet", args: { start: 2, picture_width: 480 } }],
    ]);

    await run(fixture);

    expect(fixture.ran).toEqual([
      { name: "contact_sheet", args: { time: 2, tile_width: 480 } },
    ]);
    expect(fixture.firstAnswer().note).toBe(
      "Zhiyin corrected this call's input (start read as time, picture_width read as tile_width).",
    );
  });

  it("is still held to the field's limits", async () => {
    const fixture = setUp([
      [{ name: "contact_sheet", args: { frame_width: 960 } }],
    ]);

    await run(fixture);

    expect(fixture.ran).toEqual([]);
    expect(String(fixture.firstAnswer().reason)).toContain(
      "“tile_width” must be at most 640",
    );
  });

  it("is never shown to the model: its schema lists only the fields' own names", async () => {
    const fixture = setUp([]);

    await run(fixture);

    const shown = fixture.toolsSent[0]?.find(
      (tool) => tool.name === "contact_sheet",
    );
    expect(shown?.inputSchema).not.toHaveProperty(readAsKey);
    expect(Object.keys(shown?.inputSchema["properties"] ?? {})).toEqual([
      "time",
      "tile_width",
      "purpose",
    ]);
  });
});

describe("a purpose sent where the call's own does not go", () => {
  it("is moved up from inside an item when the call has none, and names the action", async () => {
    const fixture = setUp([
      [
        {
          name: "multi_edit",
          args: {
            edits: [
              {
                path: "stand.py",
                replacements: [
                  {
                    find: "a",
                    replace: "b",
                    purpose: "Pull the back in.",
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);

    const task = await run(fixture);

    expect(fixture.ran).toEqual([
      {
        name: "multi_edit",
        args: {
          edits: [
            { path: "stand.py", replacements: [{ find: "a", replace: "b" }] },
          ],
        },
      },
    ]);
    expect(task?.actions?.[0]?.description).toBe("Pull the back in.");
    expect(fixture.firstAnswer().note).toBe(
      "Zhiyin corrected this call's input (purpose moved up from edits[0].replacements[0]).",
    );
  });

  it("is left out of an item when the call already says what it is for", async () => {
    const fixture = setUp([
      [
        {
          name: "multi_edit",
          args: {
            purpose: "Rename the stand.",
            edits: [
              {
                path: "stand.py",
                purpose: "Edit the stand.",
                replacements: [{ find: "a", replace: "b" }],
              },
            ],
          },
        },
      ],
    ]);

    const task = await run(fixture);

    expect(fixture.ran[0]?.args).toEqual({
      edits: [
        { path: "stand.py", replacements: [{ find: "a", replace: "b" }] },
      ],
    });
    expect(task?.actions?.[0]?.description).toBe("Rename the stand.");
    expect(fixture.firstAnswer().note).toBe(
      "Zhiyin corrected this call's input (purpose left out of edits[0], as the call has its own).",
    );
  });

  it("drops a second purposes field beside the purpose", async () => {
    const fixture = setUp([
      [
        {
          name: "look",
          args: {
            exposure: 0.5,
            purpose: "Brighten the scene.",
            purposes: "placeholder",
          },
        },
      ],
    ]);

    const task = await run(fixture);

    expect(fixture.ran).toEqual([{ name: "look", args: { exposure: 0.5 } }]);
    expect(task?.actions?.[0]?.description).toBe("Brighten the scene.");
    expect(fixture.firstAnswer().note).toBe(
      "Zhiyin corrected this call's input (purposes left out beside purpose).",
    );
  });
});

describe("a direct call wrapped as call's {name, arguments}", () => {
  it("runs with the arguments inside, when the name is this tool's", async () => {
    const fixture = setUp([
      [
        {
          name: "mcp__blender__blender_set_material",
          args: {
            name: "mcp__blender__blender_set_material",
            arguments: { object: "Mug", color: "red" },
            purpose: "Paint the mug red.",
          },
        },
      ],
    ]);

    const task = await run(fixture);

    expect(fixture.ran).toEqual([
      {
        name: "mcp__blender__blender_set_material",
        args: { object: "Mug", color: "red" },
      },
    ]);
    expect(task?.actions?.[0]?.description).toBe("Paint the mug red.");
    expect(fixture.firstAnswer().note).toBe(
      "Zhiyin corrected this call's input (its input unwrapped from {name, arguments}).",
    );
  });

  it("is refused as before when the name inside is another tool's", async () => {
    const fixture = setUp([
      [
        {
          name: "mcp__blender__blender_set_material",
          args: { name: "look", arguments: { exposure: 1 } },
        },
      ],
    ]);

    await run(fixture);

    expect(fixture.ran).toEqual([]);
    expect(fixture.firstAnswer()).toMatchObject({ ok: false });
  });
});

describe("update_plan sent its list as plan", () => {
  it("reads plan as items, and says so", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "update_plan",
                  id: "plan",
                  args: {
                    plan: [
                      { title: "Read the brief", status: "in_progress" },
                      { title: "Write the report", status: "pending" },
                    ],
                  },
                },
              ],
            }
          : { text: "Done." },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Write the report");

    expect(fixture.loop.snapshot().tasks[0]?.plan).toEqual([
      { id: "plan-1", title: "Read the brief", status: "in_progress" },
      { id: "plan-2", title: "Write the report", status: "pending" },
    ]);
    expect(resultOf(fixture.requests[1], "plan").note).toBe(
      "Zhiyin corrected this call's input (plan read as items).",
    );
  });
});

describe("call given a tool's name without its connection's prefix", () => {
  const search = {
    id: "web",
    cores: [],
    toolkits: [
      {
        id: "search",
        tools: [
          "mcp__tavily__tavily_search",
          "mcp__exa__web_search",
          "mcp__brave__web_search",
        ],
      },
    ],
  };
  const opened: Step = {
    calls: [{ name: "open", id: "open-1", args: { id: "toolkit:web/search" } }],
  };
  const then =
    (...steps: Step[]) =>
    (request: number): Step =>
      steps[request - 1] ?? { text: "Done." };

  it("runs the one tool whose name ends with it, kept in the conversation by its whole name", async () => {
    const fixture = overCatalog({
      plugins: [search],
      route: "bridge",
      script: then(opened, {
        calls: [
          {
            name: "call",
            id: "find",
            args: { name: "tavily_search", arguments: { path: "mugs" } },
          },
        ],
      }),
    });

    await fixture.loop.start(await fixture.loop.createTask(), "Find mugs");

    expect(fixture.ran).toEqual([
      { name: "mcp__tavily__tavily_search", args: { path: "mugs" } },
    ]);
    expect(answerTo(fixture.requests[2], "find")).toContain(
      "Zhiyin corrected this call's input (tavily_search read as mcp__tavily__tavily_search).",
    );
    const kept = (fixture.requests[2]?.messages ?? []).flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    );
    expect(kept.at(-1)?.arguments).toBe(
      JSON.stringify({
        name: "mcp__tavily__tavily_search",
        arguments: { path: "mugs" },
      }),
    );
  });

  it("is refused when it ends more than one tool's name, naming each", async () => {
    const fixture = overCatalog({
      plugins: [search],
      route: "bridge",
      script: then(opened, {
        calls: [
          {
            name: "call",
            id: "find",
            args: { name: "web_search", arguments: { path: "mugs" } },
          },
        ],
      }),
    });

    await fixture.loop.start(await fixture.loop.createTask(), "Find mugs");

    expect(fixture.ran).toEqual([]);
    expect(answerTo(fixture.requests[2], "find")).toContain(
      "“web_search” could be mcp__exa__web_search or mcp__brave__web_search.",
    );
  });
});
