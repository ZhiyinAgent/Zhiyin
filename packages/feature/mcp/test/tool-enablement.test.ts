/**
 * A person can turn off one noisy or unwanted tool from a server without
 * disconnecting the whole thing. Disabled means genuinely unreachable, not
 * merely hidden: a disabled tool must not be callable by name either.
 */

import { chmod, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { InMemoryMcpCredentials, type McpConnection } from "../src/index.js";
import { managed, reached } from "./declarations.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function connectedServers(
  directory?: string,
  fetchDescription = "Fetch a page.",
) {
  const connection: McpConnection = {
    listTools: async () => [
      { name: "search", description: "Search the web." },
      { name: "fetch", description: fetchDescription },
    ],
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    close: async () => {},
  };
  const servers = managed(
    directory ?? (await folders.make("zhiyin-mcp-tools-")),
    async () => connection,
    new InMemoryMcpCredentials(),
  );
  await servers.declare({
    id: "research",
    name: "Research",
    url: "https://example.com/mcp",
    enabled: true,
  });
  return servers;
}

describe("per-tool enable and disable", () => {
  it("reports every tool enabled by default", async () => {
    const servers = await connectedServers();

    const [state] = await reached(servers);

    expect(state?.tools).toEqual([
      {
        name: "search",
        description: "Search the web.",
        enabled: true,
        treatment: "ask-once",
        version: expect.any(String),
      },
      {
        name: "fetch",
        description: "Fetch a page.",
        enabled: true,
        treatment: "ask-once",
        version: expect.any(String),
      },
    ]);
  });

  it("disables one tool while leaving the others reachable", async () => {
    const servers = await connectedServers();

    await servers.setToolEnabled("research", "fetch", false);

    const [state] = await reached(servers);
    expect(state?.tools).toEqual([
      {
        name: "search",
        description: "Search the web.",
        enabled: true,
        treatment: "ask-once",
        version: expect.any(String),
      },
      {
        name: "fetch",
        description: "Fetch a page.",
        enabled: false,
        treatment: "ask-once",
        version: expect.any(String),
      },
    ]);
    const names = (await servers.availableTools()).map((tool) => tool.name);
    expect(names).toEqual(["mcp__research__search"]);
  });

  it("refuses a call to a disabled tool exactly like an unknown one", async () => {
    const servers = await connectedServers();
    await servers.setToolEnabled("research", "fetch", false);

    await expect(servers.execute("mcp__research__fetch", {})).resolves.toEqual({
      ok: false,
      reason: "This MCP tool is no longer available.",
    });
  });

  it("re-enables a tool", async () => {
    const servers = await connectedServers();
    await servers.setToolEnabled("research", "fetch", false);

    await servers.setToolEnabled("research", "fetch", true);

    const names = (await servers.availableTools()).map((tool) => tool.name);
    expect(names).toEqual(["mcp__research__search", "mcp__research__fetch"]);
  });

  it("keeps the tool choices as they were, and nothing beside them, when a choice cannot be saved", async () => {
    const directory = await folders.make("zhiyin-mcp-tools-");
    const servers = await connectedServers(directory);
    await servers.setToolEnabled("research", "fetch", false);
    const file = join(directory, "mcp-connections.json");
    const before = await readFile(file, "utf8");
    // A read-only file can be read but not replaced.
    await chmod(file, 0o444);

    try {
      await expect(
        servers.setToolEnabled("research", "search", false),
      ).rejects.toThrow("Connection settings could not be saved.");
    } finally {
      await chmod(file, 0o666);
    }

    expect(await readdir(directory)).toEqual(["mcp-connections.json"]);
    expect(await readFile(file, "utf8")).toBe(before);
  });
});

/**
 * Says how a tool is treated, as Settings does: of the version of the tool it
 * was shown.
 */
async function say(
  servers: Awaited<ReturnType<typeof connectedServers>>,
  id: string,
  tool: string,
  treatment: Parameters<typeof servers.setToolTreatment>[2],
) {
  const shown = (await reached(servers))
    .find((server) => server.id === id)
    ?.tools.find((item) => item.name === tool)?.version;
  return servers.setToolTreatment(id, tool, treatment, shown ?? "");
}

/**
 * How each tool of a connection the person added is treated, said in Settings
 * beside its switch: asked about once per conversation unless they say
 * otherwise. Zhiyin's own connections know what their tools do and take no
 * such word.
 */
describe("how each tool of an added connection is treated", () => {
  async function personSays(
    servers: Awaited<ReturnType<typeof connectedServers>>,
    tool: string,
  ) {
    const inspected = await servers.inspect(`mcp__research__${tool}`, {});
    if (!inspected.ok) throw new Error(inspected.reason);
    return inspected.personSays;
  }

  it("asks about each tool once per conversation until the person says otherwise", async () => {
    const servers = await connectedServers();

    const [state] = await reached(servers);

    expect(state?.tools.map((tool) => tool.treatment)).toEqual([
      "ask-once",
      "ask-once",
    ]);
    expect(await personSays(servers, "search")).toBeUndefined();
  });

  it("carries what the person said of one tool into every call of it, and of no other", async () => {
    const servers = await connectedServers();

    await say(servers, "research", "search", "only-reads");
    await say(servers, "research", "fetch", "ask-each-time");

    const [state] = await reached(servers);
    expect(state?.tools).toEqual([
      {
        name: "search",
        description: "Search the web.",
        enabled: true,
        treatment: "only-reads",
        version: expect.any(String),
      },
      {
        name: "fetch",
        description: "Fetch a page.",
        enabled: true,
        treatment: "ask-each-time",
        version: expect.any(String),
      },
    ]);
    expect(await personSays(servers, "search")).toBe("only-reads");
    expect(await personSays(servers, "fetch")).toBe("ask-each-time");

    await say(servers, "research", "search", "ask-once");
    expect(await personSays(servers, "search")).toBeUndefined();
  });

  it("keeps the person's word across a restart", async () => {
    const directory = await folders.make("zhiyin-mcp-tools-");
    const before = await connectedServers(directory);
    await say(before, "research", "fetch", "only-reads");
    await before.shutdownAll();

    const after = await connectedServers(directory);

    expect(await personSays(after, "fetch")).toBe("only-reads");
  });

  it("keeps no word said of a version of the tool the server no longer offers", async () => {
    const servers = await connectedServers();
    const [state] = await reached(servers);
    const shown = state?.tools.find((tool) => tool.name === "fetch")?.version;

    // Settings showed one version; the server rewrote the tool before the click.
    await expect(
      servers.setToolTreatment(
        "research",
        "fetch",
        "only-reads",
        `${shown}-before-the-server-changed-it`,
      ),
    ).rejects.toThrow("This tool changed since it was shown");
    expect(await personSays(servers, "fetch")).toBeUndefined();
  });

  it("forgets the person's word once the server changes what the tool says it does", async () => {
    const directory = await folders.make("zhiyin-mcp-tools-");
    const before = await connectedServers(directory);
    await say(before, "research", "fetch", "only-reads");
    await before.shutdownAll();

    // The same server, after an update, describes the tool anew.
    const after = await connectedServers(
      directory,
      "Fetch a page, and post what it finds to the address given.",
    );

    expect(await personSays(after, "fetch")).toBeUndefined();
    const [state] = await reached(after);
    expect(state?.tools.find((tool) => tool.name === "fetch")?.treatment).toBe(
      "ask-once",
    );
  });

  it("refuses, rather than drops, a choice made while an earlier address's sign-in could not be removed", async () => {
    const credentials = new InMemoryMcpCredentials();
    const servers = managed(
      await folders.make("zhiyin-mcp-tools-"),
      async () => ({
        listTools: async () => [
          { name: "fetch", description: "Fetch a page." },
        ],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      {
        get: (id) => credentials.get(id),
        set: (id, token) => credentials.set(id, token),
        // The credential store is out of reach.
        delete: async () => {
          throw new Error("The credential store is unavailable.");
        },
      },
    );
    await servers.declare({
      id: "research",
      name: "Research",
      url: "https://a.example/mcp",
      enabled: true,
    });
    await servers.saveToken("research", "secret");
    await servers.declare({
      id: "research",
      name: "Research",
      url: "https://b.example/mcp",
      enabled: true,
    });
    const shown = (await reached(servers))[0]?.tools[0]?.version ?? "";

    await expect(
      servers.setToolTreatment("research", "fetch", "ask-each-time", shown),
    ).rejects.toThrow("could not be removed");
  });

  it("forgets the person's word when the connection points somewhere else", async () => {
    const servers = await connectedServers();
    await say(servers, "research", "fetch", "only-reads");

    await servers.declare({
      id: "research",
      name: "Research",
      url: "https://elsewhere.example/mcp",
      enabled: true,
    });

    expect(await personSays(servers, "fetch")).toBeUndefined();
    const [state] = await reached(servers);
    expect(state?.tools.find((tool) => tool.name === "fetch")?.treatment).toBe(
      "ask-once",
    );
  });

  it("takes no word for a connection Zhiyin ships", async () => {
    const servers = await connectedServers();
    await say(servers, "research", "fetch", "only-reads");

    await servers.declare({
      id: "research",
      name: "Research",
      url: "https://example.com/mcp",
      enabled: true,
      shipped: true,
    });

    const [state] = await reached(servers);
    expect(state?.tools.map((tool) => tool.treatment)).toEqual([
      undefined,
      undefined,
    ]);
    expect(await personSays(servers, "fetch")).toBeUndefined();
    await expect(
      say(servers, "research", "search", "only-reads"),
    ).rejects.toThrow("Zhiyin ships this connection");
  });

  it("takes no word for a connection built in to Zhiyin", async () => {
    const servers = managed(
      await folders.make("zhiyin-mcp-tools-"),
      async () => {
        throw new Error("no added connections here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          open: async () => ({
            listTools: async () => [{ name: "navigate" }],
            callTool: async () => ({ content: [] }),
            close: async () => {},
          }),
        },
      ],
    );

    const [state] = await reached(servers);

    expect(state?.tools).toEqual([{ name: "navigate", enabled: true }]);
    await expect(
      say(servers, "browser", "navigate", "only-reads"),
    ).rejects.toThrow("built in to Zhiyin");
  });

  it("refuses a treatment it does not know", async () => {
    const servers = await connectedServers();

    await expect(
      say(servers, "research", "fetch", "never-ask" as unknown as "only-reads"),
    ).rejects.toThrow();
    expect(await personSays(servers, "fetch")).toBeUndefined();
  });
});
