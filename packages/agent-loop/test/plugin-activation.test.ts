import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
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
  it("advertises a compact plugin directory instead of a plugin's full skills and specialists until it is activated", async () => {
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
    expect(serialized).not.toContain("project-engineering");
    expect(serialized).not.toContain("code-reviewer");
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
    const activationResult = JSON.parse(
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
});
