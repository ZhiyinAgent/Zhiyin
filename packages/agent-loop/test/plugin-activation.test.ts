import { describe, expect, it } from "vitest";
import type { McpServerState, ToolchainState } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import {
  loopFrom,
  type LoopTestDependencies,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  unfenced,
} from "./support.js";

const softwareEngineering = pluginOffering({
  name: "software-engineering",
  skills: [
    {
      id: "project-engineering",
      description: "Coordinate engineering work.",
      instructions: "Do the engineering.",
    },
  ],
  specialists: [
    {
      id: "code-reviewer",
      name: "Code reviewer",
      description: "Reviews a change.",
      instructions: "Review behavior and regressions.",
    },
  ],
  connectors: [{ id: "tavily", url: "https://mcp.tavily.com/mcp/" }],
});

function dependenciesWithPlugin(
  modelSend: (request: ModelRequest) => AsyncGenerator<ModelEvent>,
) {
  const base = stubDependencies(() => {});
  return {
    ...base,
    plugins: pluginsOffering([softwareEngineering]),
    mcp: {
      ...base.mcp,
      availableTools: async (
        _scope?: string,
        excluded: readonly string[] = [],
      ) =>
        excluded.includes("software-engineering/tavily")
          ? []
          : [
              {
                name: "mcp__software-engineering__tavily__search",
                description: "Search the web with Tavily.",
                inputSchema: { type: "object" },
              },
            ],
    },
    model: {
      ...base.model,
      send: modelSend,
    },
  };
}

describe("plugin activation", () => {
  it("advertises a compact inventory without exposing full plugin instructions until activation", async () => {
    const requests: ModelRequest[] = [];
    const loop = loopFrom(
      dependenciesWithPlugin(async function* (request) {
        requests.push(request);
        yield { kind: "textDelta", text: "Understood." };
        yield { kind: "done" };
      }),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "What can you help me with?");

    const [request] = requests;
    const toolNames = request?.tools?.map((tool) => tool.name) ?? [];
    expect(toolNames).toContain("inspect_plugin");
    expect(toolNames).toContain("activate_plugin");
    expect(toolNames).not.toContain("load_skill");
    expect(toolNames).not.toContain("delegate_specialist");
    expect(toolNames).not.toContain(
      "mcp__software-engineering__tavily__search",
    );

    const serialized = JSON.stringify(request?.messages);
    expect(serialized).toContain("software-engineering");
    expect(serialized).toContain("The software-engineering plugin.");
    expect(serialized).toContain("project-engineering");
    expect(serialized).toContain("Code reviewer");
    expect(serialized).toContain("tavily — The tavily connector.");
    expect(serialized).not.toContain("Do the engineering.");
    expect(serialized).not.toContain("Search the web with Tavily.");
  });

  it("adds exactly an activated plugin's skills, specialists and connectors to context from that point on", async () => {
    let requestNumber = 0;
    const requests: ModelRequest[] = [];
    const loop = loopFrom(
      dependenciesWithPlugin(async function* (request) {
        requests.push(request);
        requestNumber += 1;
        if (requestNumber === 1) {
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: "activate-1",
            name: "activate_plugin",
            argumentsDelta: JSON.stringify({ id: "software-engineering" }),
          };
          yield { kind: "done" };
          return;
        }
        yield { kind: "textDelta", text: "Activated." };
        yield { kind: "done" };
      }),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Activate the software engineering plugin.");

    const activationResultMessage = requests[1]?.messages.find(
      (message) =>
        message.role === "tool" &&
        "toolCallId" in message &&
        message.toolCallId === "activate-1",
    );
    const activationResult = unfenced(
      (activationResultMessage as { content: string }).content,
    );
    expect(activationResult).toEqual({
      ok: true,
      id: "software-engineering",
      skills: [
        {
          id: "software-engineering/project-engineering",
          name: "project-engineering",
          description: "Coordinate engineering work.",
        },
      ],
      specialists: [
        {
          id: "software-engineering/code-reviewer",
          name: "Code reviewer",
          description: "Reviews a change.",
        },
      ],
      connectors: [
        {
          id: "software-engineering/tavily",
          name: "tavily",
          description: "The tavily connector.",
        },
      ],
    });

    const secondRequest = requests[1];
    const toolNames = secondRequest?.tools?.map((tool) => tool.name) ?? [];
    expect(toolNames).toContain("load_skill");
    expect(toolNames).toContain("delegate_specialist");
    expect(toolNames).toContain("mcp__software-engineering__tavily__search");
    const delegateTool = secondRequest?.tools?.find(
      (tool) => tool.name === "delegate_specialist",
    );
    expect(
      (
        delegateTool?.inputSchema as {
          properties: { id: { enum: readonly string[] } };
        }
      ).properties.id.enum,
    ).toEqual(["software-engineering/code-reviewer"]);

    expect(loop.snapshot().tasks[0]?.activatedPlugins).toEqual([
      "software-engineering",
    ]);
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        action: "Activate software-engineering",
        description:
          "Make this plugin's components available in this conversation.",
        target: "software-engineering",
        status: "completed",
        invocation: {
          name: "Activate plugin",
          arguments: [{ name: "Plugin", value: "software-engineering" }],
        },
        details: [
          {
            kind: "list",
            label: "Skills",
            items: ["project-engineering — Coordinate engineering work."],
          },
          {
            kind: "list",
            label: "Specialists",
            items: ["Code reviewer — Reviews a change."],
          },
          {
            kind: "list",
            label: "Connectors",
            items: ["tavily — The tavily connector."],
          },
        ],
      }),
    ]);
  });

  it("activates every plugin asked for in one response, each saying what it is for", async () => {
    const research = pluginOffering({
      name: "research",
      skills: [
        { id: "web", description: "Search the web.", instructions: "Search." },
      ],
    });
    let requestNumber = 0;
    const requests: ModelRequest[] = [];
    const base = dependenciesWithPlugin(async function* (request) {
      requests.push(request);
      requestNumber += 1;
      if (requestNumber === 1) {
        yield {
          kind: "toolCallDelta",
          index: 0,
          callId: "activate-1",
          name: "activate_plugin",
          argumentsDelta: JSON.stringify({
            id: "software-engineering",
            purpose: "Pour relire le code.",
          }),
        };
        yield {
          kind: "toolCallDelta",
          index: 1,
          callId: "activate-2",
          name: "activate_plugin",
          argumentsDelta: JSON.stringify({
            id: "research",
            purpose: "Pour vérifier les textes officiels.",
          }),
        };
        yield { kind: "done" };
        return;
      }
      yield { kind: "textDelta", text: "Activated." };
      yield { kind: "done" };
    });
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([softwareEngineering, research]),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Use both plugins.");

    const results = (requests[1]?.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) => unfenced((message as { content: string }).content));
    expect(results).toEqual([
      expect.objectContaining({ ok: true, id: "software-engineering" }),
      expect.objectContaining({ ok: true, id: "research" }),
    ]);
    expect(loop.snapshot().tasks[0]?.activatedPlugins).toEqual([
      "software-engineering",
      "research",
    ]);
  });

  it("leaves a plugin inactive, and says why, when its tools cannot be gathered once it is active", async () => {
    const requests: ModelRequest[] = [];
    const base = dependenciesWithPlugin(async function* (request) {
      requests.push(request);
      if (requests.length === 1) {
        yield {
          kind: "toolCallDelta",
          index: 0,
          callId: "activate-1",
          name: "activate_plugin",
          argumentsDelta: JSON.stringify({ id: "software-engineering" }),
        };
        yield { kind: "done" };
        return;
      }
      yield { kind: "textDelta", text: "It could not be activated." };
      yield { kind: "done" };
    });
    const search = {
      name: "mcp__software-engineering__tavily__search",
      description: "Search the web with Tavily.",
      inputSchema: { type: "object" },
    };
    const loop = loopFrom({
      ...base,
      mcp: {
        ...base.mcp,
        // Its connector offers one name twice, which gathering refuses.
        availableTools: async (
          _scope?: string,
          excluded: readonly string[] = [],
        ) =>
          excluded.includes("software-engineering/tavily")
            ? []
            : [search, search],
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Activate the software engineering plugin.");

    const answer = requests[1]?.messages.find(
      (message) =>
        message.role === "tool" &&
        "toolCallId" in message &&
        message.toolCallId === "activate-1",
    );
    expect(unfenced((answer as { content: string }).content)).toEqual({
      ok: false,
      reason:
        "The plugin could not be activated: The tool “mcp__software-engineering__tavily__search” is registered more than once.",
    });
    expect(requests[1]?.tools?.map((tool) => tool.name)).not.toContain(
      "load_skill",
    );
    const task = loop.snapshot().tasks[0];
    expect(task?.activatedPlugins ?? []).toEqual([]);
    expect(task?.actions?.map((action) => action.status)).toEqual(["failed"]);
    expect(task?.phase.kind).toBe("completed");
  });
});

describe("a plugin whose connector cannot run yet", () => {
  const rendering = pluginOffering({
    name: "3d-rendering",
    connectors: [{ id: "assets", url: "https://assets.example.test/mcp/" }],
    appConnectors: [{ id: "studio", connector: "blender", name: "3D studio" }],
  });
  const state = (
    id: string,
    overrides: Partial<McpServerState>,
  ): McpServerState =>
    ({
      id,
      name: id,
      url: "",
      enabled: true,
      status: "connected",
      toolCount: 0,
      tools: [],
      credential: { status: "none" },
      ...overrides,
    }) as McpServerState;

  /** What the model reads back from activating the plugin. */
  async function activationAnswer(
    members: Partial<LoopTestDependencies>,
  ): Promise<string> {
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      plugins: pluginsOffering([rendering]),
      ...members,
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "activate-1",
              name: "activate_plugin",
              argumentsDelta: JSON.stringify({ id: "3d-rendering" }),
            };
            yield { kind: "done" };
            return;
          }
          yield { kind: "textDelta", text: "Done." };
          yield { kind: "done" };
        },
      },
    });
    await loop.start(await loop.createTask(), "Model my flat in 3D.");
    const answer = requests[1]?.messages.find(
      (message) =>
        message.role === "tool" &&
        "toolCallId" in message &&
        message.toolCallId === "activate-1",
    );
    return (answer as { content: string }).content;
  }

  const blender = (toolchain: ToolchainState) => {
    const base = stubDependencies(() => {});
    return {
      mcp: {
        ...base.mcp,
        states: async () => [
          state("3d-rendering/assets", {}),
          state("blender", { builtIn: true }),
        ],
      },
      connectionToolchains: { blender: ["blender"] },
      toolchains: { ...base.toolchains, state: async () => toolchain },
    };
  };

  it("tells the model which connector needs setting up, and where the person does it", async () => {
    const answer = await activationAnswer(
      blender({
        status: "missing",
        downloads: [
          {
            name: "Blender",
            version: "5.1",
            bytes: 400_000_000,
            source: "download.blender.org",
          },
        ],
      }),
    );

    expect(answer).toContain(
      "3D studio needs setting up: on the Plugins page, open 3d-rendering and, under Connectors, select Set up, then Install.",
    );
    expect(answer).toContain(
      "A connector that is not ready adds no tools to this conversation. Tell the person what it needs.",
    );
  });

  it("says nothing of setting up when the connector's program is installed", async () => {
    const answer = await activationAnswer(blender({ status: "ready" }));

    expect(answer).toContain("3D studio");
    expect(answer).not.toMatch(/setting up|not ready|notReady/);
  });

  it("says what a service refused when activating the plugin first reached it", async () => {
    const base = stubDependencies(() => {});
    let reached = false;
    const answer = await activationAnswer({
      mcp: {
        ...base.mcp,
        states: async () => [
          state("3d-rendering/assets", {
            status: reached ? "unauthorized" : "unchecked",
          }),
          state("blender", { builtIn: true }),
        ],
        availableTools: async (_scope, excluded = []) => {
          if (!excluded.includes("3d-rendering/assets")) reached = true;
          return [];
        },
      },
    });

    expect(answer).toContain(
      "assets needs setting up: on the Plugins page, open 3d-rendering and, under Connectors, select Set up.",
    );
  });
});
