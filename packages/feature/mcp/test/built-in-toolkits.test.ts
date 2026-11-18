import { afterEach, describe, expect, it } from "vitest";
import type { ConnectionTool } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  InMemoryMcpCredentials,
  type BuiltInMcpServer,
  type McpConnection,
} from "../src/index.js";
import { managed } from "./declarations.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const studioTools: readonly ConnectionTool[] = [
  {
    name: "studio_render",
    description: "Render the scene.",
    inputSchema: { type: "object" },
    label: "Render",
  },
  {
    name: "studio_set_material",
    description: "Give an object a material.",
    inputSchema: { type: "object" },
    label: "Set material",
    toolkit: "surfacing",
  },
];

function connectionListing(tools: readonly ConnectionTool[]): McpConnection {
  return {
    listTools: async () => tools,
    callTool: async () => ({ content: [] }),
    close: async () => {},
  };
}

/** A studio scoped to conversations, counting each conversation it opens for. */
function studio(opened: string[]): BuiltInMcpServer {
  return {
    id: "studio",
    name: "Studio",
    scope: "conversation",
    describe: async () => studioTools,
    open: async (scope) => {
      opened.push(scope ?? "");
      return connectionListing(studioTools);
    },
  };
}

describe("the toolkit a built-in connection's tool loads with", () => {
  it("is passed on from a connection Zhiyin ships, and from no other server", async () => {
    const opened: string[] = [];
    const servers = managed(
      await folders.make("zhiyin-mcp-"),
      async () => connectionListing(studioTools),
      new InMemoryMcpCredentials(),
      [studio(opened)],
    );
    await servers.declare({
      id: "remote",
      name: "Remote",
      url: "https://example.test/mcp",
      enabled: true,
    });

    const toolkits = Object.fromEntries(
      (await servers.availableTools("conversation-1")).map((tool) => [
        tool.name,
        tool.toolkit,
      ]),
    );

    expect(toolkits).toEqual({
      mcp__studio__studio_render: undefined,
      mcp__studio__studio_set_material: "surfacing",
      mcp__remote__studio_render: undefined,
      mcp__remote__studio_set_material: undefined,
    });
    await servers.shutdownAll();
  });
});

describe("what each built-in connection offers, apart from any conversation", () => {
  it("is each one's tools as a conversation is offered them, by connection, opening none", async () => {
    const opened: string[] = [];
    const servers = managed(
      await folders.make("zhiyin-mcp-"),
      async () => connectionListing([]),
      new InMemoryMcpCredentials(),
      [studio(opened)],
    );

    const described = await servers.builtInTools();
    const offered = await servers.availableTools("conversation-1");

    expect([...described.keys()]).toEqual(["studio"]);
    expect(described.get("studio")).toEqual(offered);
    expect(opened).toEqual(["conversation-1"]);
    await servers.shutdownAll();
  });

  it("leaves out a built-in that cannot describe itself here", async () => {
    const servers = managed(
      await folders.make("zhiyin-mcp-"),
      async () => connectionListing([]),
      new InMemoryMcpCredentials(),
      [
        {
          ...studio([]),
          describe: async () => {
            throw new Error("Blender is not installed.");
          },
        },
      ],
    );

    expect(await servers.builtInTools()).toEqual(new Map());
  });
});
