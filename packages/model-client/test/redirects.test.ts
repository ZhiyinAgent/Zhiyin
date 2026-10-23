/**
 * A request carrying a key is never sent on by a redirect. Xiaomi takes its
 * key in an `api-key` header, which a redirect to another host would carry
 * there; the request fails instead.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { xiaomi } from "./shipped-providers.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function serving(
  answer: Parameters<typeof createServer>[1],
): Promise<string> {
  const server = createServer(answer);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("a lab's answer that redirects", () => {
  it("is not followed, so the key never reaches the host it names", async () => {
    const reached: string[] = [];
    const elsewhere = await serving((request, response) => {
      reached.push(String(request.headers["api-key"]));
      response.end();
    });
    const lab = await serving((_request, response) => {
      response.writeHead(307, { location: `${elsewhere}/v1/chat/completions` });
      response.end();
    });
    const client = new ProviderModelClient(xiaomi, {
      apiKey: async () => "sk-zhiyin-redirect-check",
      model: "mimo-v2.6-flash",
      region: "international",
      endpoint: `${lab}/v1/chat/completions`,
      retry: { wait: async () => {}, random: () => 0 },
    });

    await expect(async () => {
      for await (const event of client.send({
        messages: [{ role: "user", content: "Hello" }],
      }))
        void event;
    }).rejects.toThrow();
    expect(reached).toEqual([]);
  });
});
