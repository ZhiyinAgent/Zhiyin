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

/**
 * A token endpoint that answers a refresh only when told to: with a new
 * token, or, when it `refuses`, with the refresh token refused.
 */
async function slowTokenService(refuses = false) {
  const waiting: (() => void)[] = [];
  const asked: Promise<void>[] = [];
  let arrived: () => void = () => undefined;
  asked.push(new Promise((resolve) => (arrived = resolve)));
  const server = createServer((_request, response) => {
    arrived();
    waiting.push(() => {
      if (refuses) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
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

  it("does not bring back a sign-in the person ended just before it was asked for", async () => {
    const service = await slowTokenService();
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", signedIn(service.base, "first"));
    void service.asked.then(service.answer);

    // Asked for while the sign-out is still being written.
    const forgetting = tokens.forget("docs");
    const refreshing = tokens.refresh("docs");
    await Promise.all([forgetting, refreshing]);

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

  it("answers a call that joins it after a new sign-in with that sign-in's token, though the service refuses it", async () => {
    const service = await slowTokenService(true);
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs");
    await service.asked;
    await tokens.saveSignIn("docs", {
      ...signedIn(service.base, "second"),
      issuedAt: Date.now(),
    });
    const joining = tokens.refresh("docs");
    service.answer();

    expect(await joining).toBe("second");
    await refreshing;
    expect(await tokens.token("docs")).toBe("second");
  });

  it("does not mix into a sign-in the person makes while its own answer is being written", async () => {
    const service = await slowTokenService();
    const memory = new InMemoryMcpCredentials();
    // Holds the first write asked for once armed, as a slow store would.
    let armed = false;
    let release = () => {};
    let reached = () => {};
    const holding = new Promise<void>((resolve) => (reached = resolve));
    const tokens = new ConnectionTokens({
      get: (id) => memory.get(id),
      delete: (id) => memory.delete(id),
      set: async (id, token) => {
        if (armed) {
          armed = false;
          reached();
          await new Promise<void>((resolve) => (release = resolve));
        }
        await memory.set(id, token);
      },
    });
    await tokens.saveSignIn("docs", signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs");
    await service.asked;
    armed = true;
    service.answer();
    await holding;
    const signingIn = tokens.saveSignIn("docs", {
      ...signedIn(service.base, "second"),
      issuedAt: Date.now(),
    });
    // All the new sign-in may write while the refresh's write is held.
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([refreshing, signingIn]);

    expect(await tokens.token("docs")).toBe("second");
  });
});
