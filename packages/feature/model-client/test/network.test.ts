/**
 * Every request the model client sends goes through the network it is handed
 * (ADR 0004), never Node's own `fetch`: in the app that network is Chromium's,
 * which reads Windows' certificates and proxy settings.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProviders, type CredentialEntry } from "../src/index.js";

const encoder = new TextEncoder();

function answer(url: string): Response {
  if (url.endsWith("/chat/completions"))
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const event of [
            { id: "gen-1", choices: [{ index: 0, delta: { content: "Hi" } }] },
            { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          ])
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  return Response.json({ data: [] });
}

function store(): (account: string) => CredentialEntry {
  const stored = new Map<string, string>();
  return (account) => ({
    getPassword: async () => stored.get(account),
    setPassword: async (secret) => void stored.set(account, secret),
    deletePassword: async () => stored.delete(account),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the network the model client is handed", () => {
  it("carries the answers, the key check and the listings, and Node's own fetch carries nothing", async () => {
    const nodeFetch = vi.fn(async () => {
      throw new Error("Node's fetch was used.");
    });
    vi.stubGlobal("fetch", nodeFetch);
    const asked: { url: string; redirect: RequestInit["redirect"] }[] = [];
    const providers = new ModelProviders({
      fixed: { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
      environment: () => undefined,
      credentialEntry: store(),
      retry: { wait: async () => {} },
      network: async (url, init) => {
        asked.push({ url, redirect: init.redirect });
        return answer(url);
      },
    });
    const client = providers.for({ provider: "openrouter" });

    await client.setApiKey("sk-or-test");
    for await (const event of client.send({
      messages: [{ role: "user", content: "Hello" }],
    }))
      void event;
    await client.models().catch(() => undefined);
    await client.modelProviders("z-ai/glm-5.3-flash").catch(() => undefined);
    await client.settings().catch(() => undefined);

    expect(nodeFetch).not.toHaveBeenCalled();
    expect(asked.map(({ url }) => new URL(url).pathname)).toEqual(
      expect.arrayContaining([
        "/api/v1/key",
        "/api/v1/chat/completions",
        "/api/v1/models",
      ]),
    );
    // A request that carries a key follows no redirect, whichever network.
    expect(asked.every(({ redirect }) => redirect === "error")).toBe(true);
  });

  it("says a certificate this computer does not trust is the reason, and does not send the request again", async () => {
    let requests = 0;
    const providers = new ModelProviders({
      fixed: { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
      environment: (variable) =>
        variable === "ZHIYIN_OPENROUTER_API_KEY" ? "sk-or-test" : undefined,
      credentialEntry: store(),
      retry: { wait: async () => {} },
      // How Chromium's network refuses a certificate it does not trust.
      network: async () => {
        requests += 1;
        throw new Error("net::ERR_CERT_AUTHORITY_INVALID");
      },
    });

    const sending = async () => {
      for await (const event of providers
        .for({ provider: "openrouter" })
        .send({ messages: [{ role: "user", content: "Hello" }] }))
        void event;
    };

    await expect(sending()).rejects.toMatchObject({
      code: "networkFailure",
      retryable: false,
      message:
        "OpenRouter's certificate is not trusted on this computer, so Zhiyin did not send the request.",
    });
    expect(requests).toBe(1);
  });
});
