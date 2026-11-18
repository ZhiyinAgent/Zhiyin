/**
 * A sign-in service that takes a request and never answers must not hold a
 * look at the connectors, a test of one, or a refresh: each sign-in request
 * has a time limit, and one past it counts as failed.
 */

import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionTokens } from "../src/connection-tokens.js";
import { InMemoryMcpCredentials } from "../src/credentials.js";
import { offersSignIn } from "../src/sign-in.js";
import { nodeNetwork } from "../src/network.js";

/** The connection's endpoint every credential here is given for. */
const docs = "https://docs.example/mcp";

const held: ServerResponse[] = [];
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const response of held.splice(0)) response.destroy();
  await Promise.all(closing.splice(0).map((close) => close()));
});

/** A service that refuses the connector and never answers anything else. */
async function silentService(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/mcp") {
      response.writeHead(401).end();
      return;
    }
    held.push(response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  closing.push(
    () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  return `http://127.0.0.1:${address.port}`;
}

describe("a sign-in service that never answers", () => {
  it("offers no sign-in once its requests pass their limit", async () => {
    const base = await silentService();
    const started = performance.now();

    await expect(offersSignIn(`${base}/mcp`, nodeNetwork, 200)).resolves.toBe(
      false,
    );
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("leaves a refresh with no new token, and keeps the sign-in", async () => {
    const base = await silentService();
    const tokens = new ConnectionTokens(
      new InMemoryMcpCredentials(),
      Date.now,
      nodeNetwork,
      200,
    );
    await tokens.saveSignIn("docs", docs, {
      tokens: {
        access_token: "first",
        refresh_token: "r1",
        token_type: "Bearer",
      },
      issuedAt: 0,
      client: { client_id: "zhiyin" },
      authorizationServer: base,
      metadata: {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        response_types_supported: ["code"],
      },
    });
    const started = performance.now();

    await expect(tokens.refresh("docs", docs)).resolves.toBeUndefined();
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(await tokens.state("docs", docs)).toEqual({ status: "signed-in" });
  });
});
