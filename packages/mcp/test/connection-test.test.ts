/**
 * A dry run: whether an endpoint and token actually work, before anything is
 * saved. Must never touch persisted or live connection state — a failed test
 * must not disturb a server that is already connected.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { InMemoryMcpCredentials, McpUnauthorizedError } from "../src/index.js";
import { managed } from "./declarations.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("test()", () => {
  it("reports the tools a working endpoint offers, without saving anything", async () => {
    const servers = managed(
      await folders.make("zhiyin-mcp-test-"),
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
      await folders.make("zhiyin-mcp-test-"),
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
      await folders.make("zhiyin-mcp-test-"),
      async () => {
        throw new McpUnauthorizedError("refused");
      },
      new InMemoryMcpCredentials(),
    );

    const draft = {
      id: "draft",
      name: "Draft",
      url: "https://example.com/mcp",
      enabled: true,
    };

    // Refused with no key, it says a key is what it needs.
    await expect(servers.test(draft)).resolves.toEqual({
      ok: false,
      reason: "This service needs an access token.",
      needs: "token",
    });
    // Refused with one, the key is what it refused.
    await expect(servers.test(draft, "a-token")).resolves.toEqual({
      ok: false,
      reason:
        "This server refused the access token. Save a current token to sign in again.",
    });
  });

  it.each([
    [
      "http://search.example/mcp",
      "MCP endpoints must use HTTPS unless the server runs on this computer.",
    ],
    [
      "https://example.com/mcp?apiKey=secret",
      "Use an endpoint without embedded credentials. Save the access token separately.",
    ],
  ])(
    "sends no token to %s, which a saved connection could not use either",
    async (url, reason) => {
      let dialled = false;
      const servers = managed(
        await folders.make("zhiyin-mcp-test-"),
        async () => {
          dialled = true;
          throw new Error("must not be reached");
        },
        new InMemoryMcpCredentials(),
      );

      const result = await servers.test(
        { id: "draft", name: "Draft", url, enabled: true },
        "a-token",
      );

      expect(result).toEqual({ ok: false, reason });
      expect(dialled).toBe(false);
    },
  );

  it("does not disturb an already-connected server with the same id", async () => {
    let closedTest = false;
    const servers = managed(
      await folders.make("zhiyin-mcp-test-"),
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

describe("saveToken()", () => {
  it("keeps no token for a connection nothing declares", async () => {
    const credentials = new InMemoryMcpCredentials();
    const servers = managed(
      await folders.make("zhiyin-mcp-test-"),
      async () => {
        throw new Error("must not be reached");
      },
      credentials,
    );

    await expect(servers.saveToken("invented", "a-token")).rejects.toThrow(
      "The MCP server no longer exists.",
    );
    expect(await credentials.get("invented")).toBeUndefined();
  });
});
