import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { connectHttpMcpServer } from "../src/index.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

async function listening(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("a connector whose server sends its requests to another origin", () => {
  it.each([307, 308, 302])(
    "sends that origin nothing, neither the request nor its token, on a %i",
    async (status) => {
      const elsewhere: string[] = [];
      const other = await listening(
        createServer((request, response) => {
          elsewhere.push(
            `${request.method} ${String(request.headers["authorization"])}`,
          );
          request.resume();
          response.writeHead(500).end();
        }),
      );
      const connector = await listening(
        createServer((request, response) => {
          request.resume();
          response.writeHead(status, { location: `${other}/mcp` }).end();
        }),
      );

      await expect(
        connectHttpMcpServer(
          {
            id: "tracker",
            name: "Tracker",
            enabled: true,
            url: `${connector}/mcp`,
          },
          async () => "tracker-secret",
        ),
      ).rejects.toThrow();

      expect(elsewhere).toEqual([]);
    },
  );
});
