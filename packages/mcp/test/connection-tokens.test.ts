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

/** The connection's endpoint every credential here is given for. */
const docs = "https://docs.example/mcp";
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

describe("a credential and its endpoint", () => {
  it.each([
    [
      "a pasted key",
      (tokens: ConnectionTokens) => tokens.save("docs", docs, "pasted"),
    ],
    [
      "a sign-in",
      (tokens: ConnectionTokens) =>
        tokens.saveSignIn("docs", docs, signedIn(docs, "signed")),
    ],
  ])(
    "answers %s only for the endpoint it was given for",
    async (_case, give) => {
      const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
      await give(tokens);
      const elsewhere = "https://elsewhere.example/mcp";

      expect(await tokens.token("docs", elsewhere)).toBeUndefined();
      expect(await tokens.refresh("docs", elsewhere)).toBeUndefined();
      expect(await tokens.state("docs", elsewhere)).toEqual({ status: "none" });
      expect(await tokens.token("docs", docs)).toMatch(/^(pasted|signed)$/);
    },
  );
});

describe("a refresh still under way", () => {
  it("does not bring back a sign-in the person ended meanwhile", async () => {
    const service = await slowTokenService();
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", docs, signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs", docs);
    await service.asked;
    await tokens.forget("docs");
    service.answer();
    await refreshing;

    expect(await tokens.token("docs", docs)).toBeUndefined();
    expect(await tokens.state("docs", docs)).toEqual({ status: "none" });
  });

  it("does not bring back a sign-in the person ended just before it was asked for", async () => {
    const service = await slowTokenService();
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", docs, signedIn(service.base, "first"));
    void service.asked.then(service.answer);

    // Asked for while the sign-out is still being written.
    const forgetting = tokens.forget("docs");
    const refreshing = tokens.refresh("docs", docs);
    await Promise.all([forgetting, refreshing]);

    expect(await tokens.token("docs", docs)).toBeUndefined();
    expect(await tokens.state("docs", docs)).toEqual({ status: "none" });
  });

  it("does not replace a sign-in the person made meanwhile", async () => {
    const service = await slowTokenService();
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", docs, signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs", docs);
    await service.asked;
    await tokens.saveSignIn("docs", docs, {
      ...signedIn(service.base, "second"),
      issuedAt: Date.now(),
    });
    service.answer();
    await refreshing;

    expect(await tokens.token("docs", docs)).toBe("second");
  });

  it("answers a call that joins it after a new sign-in with that sign-in's token, though the service refuses it", async () => {
    const service = await slowTokenService(true);
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", docs, signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs", docs);
    await service.asked;
    await tokens.saveSignIn("docs", docs, {
      ...signedIn(service.base, "second"),
      issuedAt: Date.now(),
    });
    const joining = tokens.refresh("docs", docs);
    service.answer();

    expect(await joining).toBe("second");
    await refreshing;
    expect(await tokens.token("docs", docs)).toBe("second");
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
    await tokens.saveSignIn("docs", docs, signedIn(service.base, "first"));

    const refreshing = tokens.refresh("docs", docs);
    await service.asked;
    armed = true;
    service.answer();
    await holding;
    const signingIn = tokens.saveSignIn("docs", docs, {
      ...signedIn(service.base, "second"),
      issuedAt: Date.now(),
    });
    // All the new sign-in may write while the refresh's write is held.
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([refreshing, signingIn]);

    expect(await tokens.token("docs", docs)).toBe("second");
  });
});

describe("a refresh the service cannot make", () => {
  /** A token service that answers every request the same way. */
  async function tokenService(status: number, type: string, body: string) {
    const server = createServer((_request, response) => {
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
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

  /** A sign-in whose hour-long token ends in thirty seconds. */
  function endingIn30s(base: string, now: number): SignedIn {
    const signIn = signedIn(base, "still-valid");
    return {
      ...signIn,
      tokens: { ...signIn.tokens, expires_in: 3600 },
      issuedAt: now - 3600_000 + 30_000,
    };
  }

  it("keeps the sign-in when the service answers with an error page, and sends the token it has until it ends", async () => {
    const base = await tokenService(503, "text/html", "<h1>Down</h1>");
    let now = 1_000_000_000;
    const tokens = new ConnectionTokens(
      new InMemoryMcpCredentials(),
      () => now,
    );
    await tokens.saveSignIn("docs", docs, endingIn30s(base, now));

    await expect(tokens.refresh("docs", docs)).resolves.toBeUndefined();
    expect(await tokens.state("docs", docs)).toEqual({ status: "signed-in" });
    await expect(tokens.token("docs", docs)).resolves.toBe("still-valid");

    now += 31_000;
    await expect(tokens.token("docs", docs)).resolves.toBeUndefined();
    expect(await tokens.state("docs", docs)).toEqual({ status: "signed-in" });
  });

  it("keeps the sign-in and sends the token it has when the service cannot be reached", async () => {
    const now = 1_000_000_000;
    const tokens = new ConnectionTokens(
      new InMemoryMcpCredentials(),
      () => now,
    );
    // Nothing listens on port 9 here.
    await tokens.saveSignIn(
      "docs",
      docs,
      endingIn30s("http://127.0.0.1:9", now),
    );

    await expect(tokens.token("docs", docs)).resolves.toBe("still-valid");
    expect(await tokens.state("docs", docs)).toEqual({ status: "signed-in" });
  });

  it("keeps the sign-in when the service says it has had too many requests", async () => {
    const base = await tokenService(429, "text/plain", "Slow down");
    const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
    await tokens.saveSignIn("docs", docs, signedIn(base, "first"));

    await expect(tokens.refresh("docs", docs)).resolves.toBeUndefined();
    expect(await tokens.state("docs", docs)).toEqual({ status: "signed-in" });
  });

  it("ends the sign-in when the service refuses the refresh", async () => {
    for (const code of [
      "invalid_grant",
      "invalid_client",
      "unauthorized_client",
    ]) {
      const base = await tokenService(
        400,
        "application/json",
        JSON.stringify({ error: code }),
      );
      const tokens = new ConnectionTokens(new InMemoryMcpCredentials());
      await tokens.saveSignIn("docs", docs, signedIn(base, "first"));

      await expect(tokens.refresh("docs", docs)).resolves.toBeUndefined();
      expect(await tokens.state("docs", docs)).toEqual({ status: "none" });
    }
  });

  it("takes a stored sign-in it cannot make sense of for none", async () => {
    for (const held of ["2", "null", "{", "{}"]) {
      const store = new InMemoryMcpCredentials();
      await store.set("docs#sign-in", held);
      const tokens = new ConnectionTokens(store);

      expect(await tokens.state("docs", docs)).toEqual({ status: "none" });
      await expect(tokens.token("docs", docs)).resolves.toBeUndefined();
    }
  });

  it("removes a sign-in kept in the form earlier versions wrote when the person signs out or in again", async () => {
    for (const next of ["sign out", "sign in"] as const) {
      const store = new InMemoryMcpCredentials();
      await store.set("docs#sign-in", "2");
      await store.set("docs#sign-in:0", '{"tokens":{"refresh_token":"old-');
      await store.set("docs#sign-in:1", 'secret"}}');
      const tokens = new ConnectionTokens(store);

      if (next === "sign out") expect(await tokens.forget("docs")).toBe(true);
      else
        await tokens.saveSignIn(
          "docs",
          docs,
          signedIn("https://sign-in.example", "new"),
        );

      for (const piece of ["docs#sign-in:0", "docs#sign-in:1"])
        expect(await store.get(piece), `${next}: ${piece}`).toBeUndefined();
    }
  });

  it("removes the pieces of a sign-in earlier versions left without their count", async () => {
    for (const next of ["sign out", "sign in"] as const) {
      const store = new InMemoryMcpCredentials();
      await store.set("docs#sign-in:0", '{"tokens":{"refresh_token":"old-');
      await store.set("docs#sign-in:1", 'secret"}}');
      const tokens = new ConnectionTokens(store);

      if (next === "sign out") expect(await tokens.forget("docs")).toBe(true);
      else
        await tokens.saveSignIn(
          "docs",
          docs,
          signedIn("https://sign-in.example", "new"),
        );

      for (const piece of ["docs#sign-in:0", "docs#sign-in:1"])
        expect(await store.get(piece), `${next}: ${piece}`).toBeUndefined();
    }
  });

  it("keeps the sign-in it had when the refreshed one cannot be written down whole", async () => {
    const base = await tokenService(
      200,
      "application/json",
      JSON.stringify({
        access_token: "refreshed",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    const store = new InMemoryMcpCredentials();
    const tokens = new ConnectionTokens(store);
    // Longer than one credential entry holds, as a real sign-in is.
    const long = signedIn(base, "first");
    await tokens.saveSignIn("docs", docs, {
      ...long,
      metadata: {
        ...long.metadata!,
        service_documentation: `${base}/${"d".repeat(3_000)}`,
      },
    });
    // The credential store takes one more entry, then goes away.
    let writes = 0;
    const set = store.set.bind(store);
    store.set = async (id, token) => {
      if (++writes > 1) throw new Error("The credential store went away.");
      await set(id, token);
    };

    await expect(tokens.refresh("docs", docs)).resolves.toBeUndefined();

    const reopened = new ConnectionTokens(store);
    expect(await reopened.state("docs", docs)).toEqual({ status: "signed-in" });
    await expect(reopened.token("docs", docs)).resolves.toBe("first");
  });
});
