/**
 * A dry run: whether an endpoint and token actually work, before anything is
 * saved. Must never touch persisted or live connection state — a failed test
 * must not disturb a server that is already connected.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryMcpCredentials, McpUnauthorizedError } from "../src/index.js";
import { managed } from "./declarations.js";

describe("test()", () => {
  it("reports the tools a working endpoint offers, without saving anything", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-test-")),
      async () => ({
        listTools: async () => [{ name: "search", description: "Search." }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );

    const result = await servers.test(
      {
        id: "draft",
        name: "Draft",
        url: "https://example.com/mcp",
        enabled: true,
      },
      "a-token",
    );

    expect(result).toEqual({
      ok: true,
      tools: [{ name: "search", description: "Search.", enabled: true }],
    });
    expect(await servers.manage()).toEqual([]);
  });

  it("reports a reason when the endpoint refuses the connection", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-test-")),
      async () => {
        throw new Error("connection refused");
      },
      new InMemoryMcpCredentials(),
    );

    const result = await servers.test({
      id: "draft",
      name: "Draft",
      url: "https://example.com/mcp",
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "Could not connect to this MCP server.",
    });
  });

  it("reports an unauthorized credential apart from an unreachable server", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-test-")),
      async () => {
        throw new McpUnauthorizedError("refused");
      },
      new InMemoryMcpCredentials(),
    );

    const result = await servers.test({
      id: "draft",
      name: "Draft",
      url: "https://example.com/mcp",
      enabled: true,
    });

    expect(result).toMatchObject({ ok: false });
  });

  it("does not disturb an already-connected server with the same id", async () => {
    let closedTest = false;
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-test-")),
      async (definition) => ({
        listTools: async () => [{ name: "tool" }],
        callTool: async () => ({ content: [] }),
        close: async () => {
          if (definition.id === "draft") closedTest = true;
        },
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "live",
      name: "Live",
      url: "https://live.example/mcp",
      enabled: true,
    });

    await servers.test({
      id: "draft",
      name: "Draft",
      url: "https://example.com/mcp",
      enabled: true,
    });

    expect(closedTest).toBe(true);
    expect(await servers.manage()).toEqual([
      expect.objectContaining({ id: "live", status: "connected" }),
    ]);
  });
});
