/**
 * How long a call to a connector may take before Zhiyin stops waiting: a
 * minute, unless the connection's declaration gives a tool longer, as a
 * research tool that works for many minutes needs.
 */

import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectHttpMcpServer } from "../src/index.js";

type Message = { readonly id?: string | number; readonly method?: string };

/** A server whose one tool, `research`, answers only when told to. */
async function slowServer() {
  const held: ServerResponse[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString()) as Message;
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const answer = (result: object) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    };
    if (message.method === "initialize")
      return answer({
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "slow", version: "1" },
      });
    if (message.method === "tools/list")
      return answer({
        tools: [
          { name: "research", inputSchema: { type: "object" } },
          { name: "search", inputSchema: { type: "object" } },
        ],
      });
    held.push(response);
    (response as ServerResponse & { answer?: () => void }).answer = () =>
      answer({ content: [{ type: "text", text: "Found." }] });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    answerAll: () =>
      held.forEach((response) =>
        (response as ServerResponse & { answer?: () => void }).answer?.(),
      ),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a call to a connector's tool", () => {
  it("is given the minutes its declaration names for that tool", async () => {
    const server = await slowServer();
    const connection = await connectHttpMcpServer(
      {
        id: "slow",
        name: "Slow",
        enabled: true,
        url: server.url,
        toolMinutes: { research: 16 },
      },
      async () => undefined,
    );
    try {
      await connection.listTools();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let settled: string | undefined;
      const call = connection.callTool("research", {}).then(
        () => (settled = "answered"),
        () => (settled = "stopped"),
      );

      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(settled).toBeUndefined();
      server.answerAll();
      vi.useRealTimers();
      await call;

      expect(settled).toBe("answered");
    } finally {
      await connection.close();
      await server.close();
    }
  });

  it("is stopped after a minute when its declaration names no other time", async () => {
    const server = await slowServer();
    const connection = await connectHttpMcpServer(
      {
        id: "slow",
        name: "Slow",
        enabled: true,
        url: server.url,
        toolMinutes: { research: 16 },
      },
      async () => undefined,
    );
    try {
      await connection.listTools();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const call = connection.callTool("search", {}).then(
        () => "answered",
        () => "stopped",
      );

      await vi.advanceTimersByTimeAsync(61_000);

      expect(await call).toBe("stopped");
    } finally {
      vi.useRealTimers();
      await connection.close();
      await server.close();
    }
  });
});
