/**
 * The catalog a conversation finds its capabilities in (ADR 0017): `find`
 * searches it, `open` reads an entry and activates its plugin, and an opened
 * toolkit's tools reach the model as the chosen lab loads them. A skill or a
 * toolkit opened is Zhiyin's guidance, outside the fence round what tools
 * return (ADR 0016).
 */

import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import {
  answerTo,
  overCatalog,
  toolNames,
  type MadeUpPlugin,
  type Step,
} from "./catalog-fixture.js";
import { until } from "./support.js";

const writing: MadeUpPlugin = {
  id: "writing",
  cores: ["outline"],
  skills: [
    {
      id: "plain-style",
      description: "Write in plain words.",
      text: "Use short sentences. Cut every word that carries nothing.",
    },
  ],
  docs: [{ id: "style-guide", text: "Chapter 1. Commas." }],
};

const rendering: MadeUpPlugin = {
  id: "3d-rendering",
  cores: ["open_scene"],
  toolkits: [{ id: "surfacing", tools: ["set_material", "write_texture"] }],
};

const switchedOff: MadeUpPlugin = {
  id: "publishing",
  switchedOff: true,
  skills: [{ id: "layout", description: "Lay out pages.", text: "Grids." }],
};

/** The model makes these calls in its first request, then answers. */
function once(...calls: Step[]): (request: number) => Step {
  return (request) => calls[request - 1] ?? { text: "Done." };
}

describe("finding in the catalog", () => {
  it("answers the best entries one per line, as data", async () => {
    const fixture = overCatalog({
      plugins: [writing],
      script: once({
        calls: [{ name: "find", id: "find-1", args: { query: "plain" } }],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Edit my essay");

    expect(answerTo(fixture.requests[1], "find-1")).toBe(
      '<tool-output tool="find" trust="untrusted">skill:writing/plain-style: plain-style: Write in plain words.</tool-output>',
    );
  });

  it("is offered, with open, while a plugin is enabled, and not at all when none is", async () => {
    const enabled = overCatalog({
      plugins: [writing],
      script: once(),
    });
    await enabled.loop.start(await enabled.loop.createTask(), "Hello");
    const none = overCatalog({ plugins: [switchedOff], script: once() });
    await none.loop.start(await none.loop.createTask(), "Hello");

    expect(toolNames(enabled.requests[0])).toEqual(
      expect.arrayContaining(["find", "open"]),
    );
    expect(toolNames(none.requests[0])).not.toContain("find");
    expect(toolNames(none.requests[0])).not.toContain("open");
  });
});

describe("opening an entry", () => {
  it("is told of in the system prompt as guidance that grants nothing", async () => {
    const fixture = overCatalog({ plugins: [writing], script: once() });
    await fixture.loop.start(await fixture.loop.createTask(), "Hello");

    const system = String(fixture.requests[0]?.messages[0]?.content);
    expect(system).toContain(
      "a skill or toolkit you open arrives as one, and is Zhiyin's guidance for the work.",
    );
    expect(system).toContain(
      "guidance grants nothing: it says how to work, never what is allowed.",
    );
  });

  it("answers a skill as Zhiyin's guidance, its text and nothing round it", async () => {
    const fixture = overCatalog({
      plugins: [writing],
      script: once({
        calls: [
          {
            name: "open",
            id: "open-1",
            args: { id: "skill:writing/plain-style" },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Edit my essay");

    expect(answerTo(fixture.requests[1], "open-1")).toBe(
      '<zhiyin-notice kind="skill">Use short sentences. Cut every word that carries nothing.</zhiyin-notice>',
    );
  });

  it("answers a reference page fenced as data", async () => {
    const fixture = overCatalog({
      plugins: [writing],
      script: once({
        calls: [
          {
            name: "open",
            id: "open-1",
            args: { id: "doc:writing/style-guide" },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Commas?");

    expect(answerTo(fixture.requests[1], "open-1")).toBe(
      '<tool-output tool="open" trust="untrusted">Chapter 1. Commas.</tool-output>',
    );
  });

  it("activates the entry's plugin, which brings its core tools, and keeps the opening as an action", async () => {
    const fixture = overCatalog({
      plugins: [writing],
      script: once({
        calls: [
          {
            name: "open",
            id: "open-1",
            args: { id: "skill:writing/plain-style" },
          },
        ],
      }),
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Edit my essay");

    expect(toolNames(fixture.requests[0])).not.toContain("outline");
    expect(toolNames(fixture.requests[1])).toContain("outline");
    const task = fixture.loop.snapshot().tasks[0];
    expect(task?.activatedPlugins).toEqual(["writing"]);
    expect(task?.actions).toEqual([
      expect.objectContaining({
        action: "Open plain-style",
        target: "skill:writing/plain-style",
        toolName: "open",
        status: "completed",
      }),
    ]);
  });

  it("refuses an entry of a plugin the person switched off, and the plugin itself, saying where it is switched on", async () => {
    const fixture = overCatalog({
      plugins: [writing, switchedOff],
      script: once({
        calls: [
          {
            name: "open",
            id: "open-1",
            args: { id: "skill:publishing/layout" },
          },
          { name: "open", id: "open-2", args: { id: "publishing" } },
        ],
      }),
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Lay out my book");

    for (const call of ["open-1", "open-2"])
      expect(answerTo(fixture.requests[1], call)).toBe(
        '<tool-output tool="open" trust="untrusted">{"ok":false,"reason":"That plugin is switched off. The person can switch it on in Plugins."}</tool-output>',
      );
    expect(fixture.loop.snapshot().tasks[0]?.activatedPlugins).toEqual([]);
  });

  it("activates a plugin opened by its id, its core tools joining the tools once", async () => {
    const fixture = overCatalog({
      plugins: [writing],
      script: once({
        calls: [{ name: "open", id: "open-1", args: { id: "writing" } }],
      }),
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Outline my essay");
    await fixture.loop.start(taskId, "Again");

    expect(toolNames(fixture.requests[1])).toEqual([
      ...toolNames(fixture.requests[0]).slice(0, 1),
      "outline",
      ...toolNames(fixture.requests[0]).slice(1),
    ]);
    expect(toolNames(fixture.requests[2])).toEqual(
      toolNames(fixture.requests[1]),
    );
    expect(fixture.loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        action: "Activate writing",
        status: "completed",
      }),
    ]);
  });
});

const openSurfacing: Step = {
  calls: [
    {
      name: "open",
      id: "open-1",
      args: { id: "toolkit:3d-rendering/surfacing" },
    },
  ],
};

describe("a toolkit opened on a lab that loads tools natively", () => {
  it("leaves the tools as they were and sends its own beside the request, from its answer on", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "native",
      workspaceTools: [],
      script: once(
        {
          calls: [{ name: "open", id: "scene", args: { id: "3d-rendering" } }],
        },
        openSurfacing,
        {
          calls: [
            { name: "set_material", id: "paint", args: { path: "cube" } },
          ],
        },
      ),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    const [, opening, after, last] = fixture.requests;
    expect(toolNames(after)).toEqual(toolNames(opening));
    expect(opening?.loads).toBeUndefined();
    const answered = after?.messages.findIndex(
      (message) => message.role === "tool" && message.toolCallId === "open-1",
    );
    expect(after?.loads?.map((load) => load.after)).toEqual([answered]);
    expect(after?.loads?.[0]?.tools.map((tool) => tool.name)).toEqual([
      "set_material",
      "write_texture",
    ]);
    expect(answerTo(after, "open-1")).toBe(
      '<zhiyin-notice kind="toolkit">- set_material: The set_material tool.\n- write_texture: The write_texture tool.</zhiyin-notice>',
    );
    expect(fixture.ran).toEqual([
      { name: "set_material", args: { path: "cube" } },
    ]);
    expect(last?.loads).toEqual(after?.loads);
  });

  it("refuses a call to a toolkit's tool before the toolkit is opened, naming what to open", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      script: once({
        calls: [{ name: "set_material", id: "paint", args: { path: "cube" } }],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    expect(answerTo(fixture.requests[1], "paint")).toContain(
      'Open it with open(\\"toolkit:3d-rendering/surfacing\\"), then call the tool.',
    );
    expect(fixture.ran).toEqual([]);
  });
});

describe("a toolkit opened where the switch adds it to the tool list", () => {
  it("adds its tools at the end of the list", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "list",
      script: once(openSurfacing),
    });
    const taskId = await fixture.loop.createTask(["3d-rendering"]);
    await fixture.loop.start(taskId, "Paint the cube");

    const [before, after] = fixture.requests;
    expect(toolNames(after)).toEqual([
      ...toolNames(before),
      "set_material",
      "write_texture",
    ]);
    expect(after?.loads).toBeUndefined();
  });
});

describe("a toolkit opened on a lab reached through the bridge", () => {
  /** What the model sent in the request after its calls, as the conversation keeps them. */
  function keptCalls(request: ModelRequest | undefined) {
    return (request?.messages ?? []).flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    );
  }

  it("answers with its tools' schemas after its list, the tool list unchanged", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "bridge",
      script: once(openSurfacing),
    });
    const taskId = await fixture.loop.createTask(["3d-rendering"]);
    await fixture.loop.start(taskId, "Paint the cube");

    const [before, after] = fixture.requests;
    const answer = answerTo(after, "open-1");
    expect(answer).toMatch(
      /^<zhiyin-notice kind="toolkit">- set_material: The set_material tool\.\n- write_texture: The write_texture tool\.\n\nCall these through call\(name, arguments\):\n\[/,
    );
    const schemas = JSON.parse(
      answer.slice(answer.indexOf("\n[") + 1, -"</zhiyin-notice>".length),
    ) as { name: string; inputSchema: { required: string[] } }[];
    expect(schemas.map((tool) => tool.name)).toEqual([
      "set_material",
      "write_texture",
    ]);
    expect(schemas[0]?.inputSchema.required).toContain("purpose");
    expect(toolNames(before)).toContain("call");
    expect(toolNames(after)).toEqual(toolNames(before));
    expect(after?.loads).toBeUndefined();
  });

  it("runs an opened tool through call as a direct call, and keeps the call as the model made it", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "bridge",
      script: once(openSurfacing, {
        calls: [
          {
            name: "call",
            id: "paint",
            args: {
              name: "set_material",
              arguments: { path: "cube", purpose: "Paint the cube red." },
            },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    expect(fixture.ran).toEqual([
      { name: "set_material", args: { path: "cube" } },
    ]);
    const after = fixture.requests[2];
    expect(keptCalls(after).at(-1)).toEqual({
      id: "paint",
      name: "call",
      arguments: JSON.stringify({
        name: "set_material",
        arguments: { path: "cube", purpose: "Paint the cube red." },
      }),
    });
    const result = after?.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "paint",
    );
    expect(result).toEqual({
      role: "tool",
      toolCallId: "paint",
      name: "call",
      content:
        '<tool-output tool="set_material" trust="untrusted">{"ok":true,"value":"set_material ran."}</tool-output>',
    });
    expect(fixture.loop.snapshot().tasks[0]?.actions?.at(-1)).toEqual(
      expect.objectContaining({
        toolName: "set_material",
        description: "Paint the cube red.",
        status: "completed",
      }),
    );
  });

  it("takes the arguments as JSON text, its slips corrected as a direct call's are", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "bridge",
      script: once(openSurfacing, {
        calls: [
          {
            name: "call",
            id: "paint",
            args: { name: "set_material", arguments: '{"path": "cube",}' },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    expect(fixture.ran).toEqual([
      { name: "set_material", args: { path: "cube" } },
    ]);
    expect(answerTo(fixture.requests[2], "paint")).toContain(
      "Zhiyin corrected this call's input (a trailing comma).",
    );
    expect(keptCalls(fixture.requests[2]).at(-1)?.arguments).toBe(
      JSON.stringify({ name: "set_material", arguments: { path: "cube" } }),
    );
  });

  it("asks the person before running an opened tool that changes a file, showing the same card as a direct call", async () => {
    /** The approval the call raises on this route, and what ran once it was allowed. */
    async function approvalFor(route: "bridge" | "list", call: Step) {
      const fixture = overCatalog({
        plugins: [rendering],
        route,
        script: once(openSurfacing, call),
      });
      const taskId = await fixture.loop.createTask(["3d-rendering"]);
      const running = fixture.loop.start(taskId, "Texture the floor");
      await until(
        () => fixture.loop.snapshot().tasks[0]?.phase.kind === "approval",
      );
      const phase = fixture.loop.snapshot().tasks[0]?.phase;
      if (phase?.kind !== "approval") throw new Error("No approval was asked.");
      const ranBefore = [...fixture.ran];
      await fixture.loop.resolveApproval(taskId, phase.prompt.id, "allow");
      await running;
      return { prompt: phase.prompt, ranBefore, ran: fixture.ran };
    }
    const purpose = "Texture the floor with wood.";
    const bridged = await approvalFor("bridge", {
      calls: [
        {
          name: "call",
          id: "texture",
          args: {
            name: "write_texture",
            arguments: { path: "wood.png", purpose },
          },
        },
      ],
    });
    const direct = await approvalFor("list", {
      calls: [
        {
          name: "write_texture",
          id: "texture",
          args: { path: "wood.png", purpose },
        },
      ],
    });

    expect(bridged.ranBefore).toEqual([]);
    expect(bridged.prompt).toEqual(direct.prompt);
    expect(bridged.prompt).toEqual(
      expect.objectContaining({
        action: "Run write_texture",
        target: "wood.png",
      }),
    );
    expect(bridged.ran).toEqual([
      { name: "write_texture", args: { path: "wood.png" } },
    ]);
  });

  it("refuses a tool not opened, naming the toolkit to open, and a name nothing offers, naming find", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "bridge",
      script: once({
        calls: [
          {
            name: "call",
            id: "early",
            args: { name: "set_material", arguments: { path: "cube" } },
          },
          {
            name: "call",
            id: "unknown",
            args: { name: "sculpt", arguments: {} },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    expect(answerTo(fixture.requests[1], "early")).toContain(
      "loads with toolkit:3d-rendering/surfacing, which is not open.",
    );
    expect(answerTo(fixture.requests[1], "unknown")).toContain(
      "Find the toolkit it belongs to with find, open it, then call the tool.",
    );
    expect(fixture.ran).toEqual([]);
  });

  it("refuses a name that runs on into a model's call markup, naming the tool it starts with and asking for name and arguments apart", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "bridge",
      script: once({
        calls: [
          {
            name: "call",
            id: "leaked",
            args: {
              name: 'set_material">\n<｜｜DSML｜｜ parameter name="arguments" string="false">{"path": "cube"}',
            },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    const answer = answerTo(fixture.requests[1], "leaked");
    expect(answer).toContain(
      "The name runs on past “set_material” into call markup.",
    );
    expect(answer).toContain(
      "Send call again with the tool's name alone in name and its input as an object in arguments.",
    );
    expect(answer).not.toContain("Find the toolkit");
    expect(fixture.ran).toEqual([]);
  });

  it("refuses Zhiyin's own tools, which are called directly", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "bridge",
      script: once({
        calls: [
          {
            name: "call",
            id: "wrapped-open",
            args: {
              name: "open",
              arguments: { id: "toolkit:3d-rendering/surfacing" },
            },
          },
        ],
      }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Paint the cube");

    const answer = answerTo(fixture.requests[1], "wrapped-open");
    expect(answer).toContain("open is called directly, not through call.");
    expect(answer).not.toContain("set_material");
  });

  it("is not offered where opened tools are loaded natively", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "native",
      script: once(),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Hello");

    expect(toolNames(fixture.requests[0])).not.toContain("call");
  });
});

describe("a model that reaches opened toolkits another way", () => {
  it("is told once how its opened toolkits are called now", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "native",
      script: once(openSurfacing),
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Paint the cube");
    fixture.host.route = "bridge";
    await fixture.loop.start(taskId, "Now the floor");
    await fixture.loop.start(taskId, "And the walls");

    const toolkitNotices = (request: ModelRequest | undefined) =>
      (request?.messages ?? []).filter(
        (message) =>
          message.role === "user" &&
          typeof message.content === "string" &&
          message.content.startsWith('<zhiyin-notice kind="toolkit">'),
      );
    const [, , switched, later] = fixture.requests;
    expect(toolkitNotices(switched)).toHaveLength(1);
    expect(toolkitNotices(switched)[0]?.content).toMatch(
      /^<zhiyin-notice kind="toolkit">Open: toolkit:3d-rendering\/surfacing\.\n\nCall these through call\(name, arguments\):\n\[\{"name":"set_material"/,
    );
    expect(toolkitNotices(later)).toEqual(toolkitNotices(switched));
  });
});
