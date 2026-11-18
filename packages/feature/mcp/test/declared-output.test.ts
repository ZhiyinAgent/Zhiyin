/**
 * A server that answers a call unlike the output its tool declares has still
 * run the call: the answer is not used, and the call is not told apart from
 * one the server refused.
 */

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  connectHttpMcpServer,
  McpUndeclaredAnswerError,
} from "../src/index.js";

type Message = {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: { readonly arguments?: { readonly answer?: string } };
};

/**
 * A server whose one tool declares a count as its output, and answers each
 * call as its `answer` argument says: with a count, with words where the
 * count should be, without the structured answer, or with an error.
 */
async function countingServer() {
  let calls = 0;
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
    const answer = (body: object) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...body }));
    };
    if (message.method === "initialize")
      return answer({
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "counting", version: "1" },
        },
      });
    if (message.method === "tools/list")
      return answer({
        result: {
          tools: [
            {
              name: "count",
              inputSchema: { type: "object" },
              outputSchema: {
                type: "object",
                properties: {
                  count: { type: "number" },
                  // Takes exponential time on a backtracking engine.
                  label: { type: "string", pattern: "^(a+)+$" },
                },
                required: ["count"],
              },
            },
          ],
        },
      });
    calls += 1;
    const asked = message.params?.arguments?.answer;
    if (asked === "error")
      return answer({ error: { code: -32602, message: "Unknown argument" } });
    return answer({
      result: {
        content: [{ type: "text", text: "Counted." }],
        ...(asked === "words" ? { structuredContent: { count: "three" } } : {}),
        ...(asked === "count" ? { structuredContent: { count: 3 } } : {}),
        ...(asked === "label"
          ? { structuredContent: { count: 3, label: `${"a".repeat(27)}!` } }
          : {}),
      },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls: () => calls,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("an answer checked against the output its tool declares", () => {
  it("is checked without the patterns the server wrote, which could hold the app", async () => {
    const server = await countingServer();
    try {
      const connection = await connectHttpMcpServer(
        { id: "counting", name: "Counting", enabled: true, url: server.url },
        async () => undefined,
      );
      try {
        await connection.listTools();
        const started = performance.now();

        await expect(
          connection.callTool("count", { answer: "label" }),
        ).resolves.toMatchObject({ structuredContent: { count: 3 } });
        expect(performance.now() - started).toBeLessThan(1_000);
        await expect(
          connection.callTool("count", { answer: "words" }),
        ).rejects.toBeInstanceOf(McpUndeclaredAnswerError);
      } finally {
        await connection.close();
      }
    } finally {
      await server.close();
    }
  });
});

describe("a call answered unlike the output its tool declares", () => {
  it("is told apart from a call the server refused, and is sent once", async () => {
    const server = await countingServer();
    try {
      const connection = await connectHttpMcpServer(
        { id: "counting", name: "Counting", enabled: true, url: server.url },
        async () => undefined,
      );
      try {
        await connection.listTools();

        await expect(
          connection.callTool("count", { answer: "count" }),
        ).resolves.toMatchObject({ structuredContent: { count: 3 } });
        for (const answer of ["words", "none"])
          await expect(
            connection.callTool("count", { answer }),
          ).rejects.toBeInstanceOf(McpUndeclaredAnswerError);
        const refused = await connection
          .callTool("count", { answer: "error" })
          .catch((error: unknown) => error);
        expect(refused).not.toBeInstanceOf(McpUndeclaredAnswerError);
        expect(server.calls()).toBe(4);
      } finally {
        await connection.close();
      }
    } finally {
      await server.close();
    }
  });
});
