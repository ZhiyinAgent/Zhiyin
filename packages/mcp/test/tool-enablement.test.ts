/**
 * A person can turn off one noisy or unwanted tool from a server without
 * disconnecting the whole thing. Disabled means genuinely unreachable, not
 * merely hidden: a disabled tool must not be callable by name either.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryMcpCredentials, type McpConnection } from "../src/index.js";
import { managed } from "./declarations.js";

async function connectedServers() {
  const connection: McpConnection = {
    listTools: async () => [
      { name: "search", description: "Search the web." },
      { name: "fetch", description: "Fetch a page." },
    ],
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    close: async () => {},
  };
  const servers = managed(
    await mkdtemp(join(tmpdir(), "zhiyin-mcp-tools-")),
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

    const [state] = await servers.manage();

    expect(state?.tools).toEqual([
      { name: "search", description: "Search the web.", enabled: true },
      { name: "fetch", description: "Fetch a page.", enabled: true },
    ]);
  });

  it("disables one tool while leaving the others reachable", async () => {
    const servers = await connectedServers();

    await servers.setToolEnabled("research", "fetch", false);

    const [state] = await servers.manage();
    expect(state?.tools).toEqual([
      { name: "search", description: "Search the web.", enabled: true },
      { name: "fetch", description: "Fetch a page.", enabled: false },
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
});
