/**
 * A refresh takes a round trip to the service, and the person can sign out
 * or sign in again while it is under way. What they did last is what holds:
 * a refresh that comes back afterwards changes nothing.
 */
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionTokens } from "../src/connection-tokens.js";
import { InMemoryMcpCredentials } from "../src/credentials.js";
import type { SignedIn } from "../src/signed-in.js";

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

/** A token endpoint that answers a refresh only when told to. */
async function slowTokenService() {
  const waiting: (() => void)[] = [];
  const asked: Promise<void>[] = [];
  let arrived: () => void = () => undefined;
  asked.push(new Promise((resolve) => (arrived = resolve)));
  const server = createServer((_request, response) => {
    arrived();
    waiting.push(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "refreshed",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  closing.push(
    () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  return {
    base,
    asked: asked[0]!,
    answer: () => waiting.splice(0).forEach((send) => send()),
  };
}

function signedIn(base: string, access: string): SignedIn {
  return {
    tokens: { access_token: access, refresh_token: "r1", token_type: "Bearer" },
    issuedAt: 0,
    client: { client_id: "zhiyin" },
    authorizationServer: base,
    metadata: {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      response_types_supported: ["code"],
    },
  };
}

describe("a refresh still under way", () => {
  it("does not bring back a sign-in the person ended meanwhile", async () => {
    const service = await slowTokenService();
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs");
    await service.asked;
    await tokens.forget("docs");
    service.answer();
    await refreshing;

    expect(await tokens.token("docs")).toBeUndefined();
    expect(await tokens.state("docs")).toEqual({ status: "none" });
  });

  it("does not replace a sign-in the person made meanwhile", async () => {
    const service = await slowTokenService();
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs");
    await service.asked;
    await tokens.saveSignIn("docs", {
      ...signedIn(service.base, "second"),
      issuedAt: Date.now(),
    });
    service.answer();
    await refreshing;

    expect(await tokens.token("docs")).toBe("second");
  });
});
