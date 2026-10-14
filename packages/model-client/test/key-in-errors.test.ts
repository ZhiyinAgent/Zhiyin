/**
 * Some failures pass on a lab's own sentence. Where that sentence quotes the
 * key, the key still never reaches the error: errors are shown to the person,
 * kept in the conversation and written to the diagnostic log.
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { ProviderCredentials } from "../src/credentials.js";
import type { ModelFetch } from "../src/model-client.js";
import { everyProvider } from "../src/providers/index.js";

const apiKey = "sk-zhiyin-check-0123456789abcdef";
const encoder = new TextEncoder();

/** An answer whose every usual field quotes the key back. */
function body() {
  const sentence = `Incorrect API key provided: ${apiKey}.`;
  return {
    type: "error",
    error: {
      type: "invalid_request_error",
      code: apiKey,
      message: sentence,
    },
    message: sentence,
    msg: sentence,
    base_resp: { status_code: 1004, status_msg: sentence },
  };
}

/** A refusal that quotes the key back. */
function quotingTheKey(status: number): ModelFetch {
  return async () => ({
    ok: false,
    status,
    headers: { get: () => null },
    body: (async function* () {
      yield encoder.encode(JSON.stringify(body()));
    })(),
  });
}

describe.each(everyProvider.map((provider) => [provider.name, provider]))(
  "%s, when its answer quotes the key",
  (_name, provider) => {
    it.each([400, 401, 403, 404, 422, 429, 500])(
      "leaves the key out of the error for a %i",
      async (status) => {
        const client = new ProviderModelClient(provider, {
          apiKey: async () => apiKey,
          model: "any-model",
          ...(provider.regions?.[0] ? { region: provider.regions[0].id } : {}),
          fetcher: quotingTheKey(status),
          retry: { wait: async () => {}, random: () => 0 },
        });
        let caught: unknown;
        try {
          for await (const event of client.send({
            messages: [{ role: "user", content: "Hello" }],
          }))
            void event;
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error & Record<string, unknown>;
        expect(error.message).not.toContain(apiKey);
        expect(String(error)).not.toContain(apiKey);
        expect(JSON.stringify(error)).not.toContain(apiKey);
        expect(JSON.stringify(error.provider ?? {})).not.toContain(apiKey);
      },
    );

    it.each([400, 401, 403])(
      "leaves the key out of a key check it refuses with a %i",
      async (status) => {
        const client = new ProviderModelClient(provider, {
          credentials: new ProviderCredentials({
            environment: () => undefined,
            entry: {
              getPassword: async () => undefined,
              setPassword: async () => {},
              deletePassword: async () => false,
            },
          }),
          ...(provider.regions?.[0] ? { region: provider.regions[0].id } : {}),
          catalogFetch: async () => ({
            ok: false,
            status,
            json: async () => body(),
          }),
        });

        const outcome: unknown = await client
          .setApiKey(apiKey)
          .catch((error: unknown) => error);

        expect(String(outcome)).not.toContain(apiKey);
        expect(JSON.stringify(outcome)).not.toContain(apiKey);
        expect((outcome as Error).message ?? "").not.toContain(apiKey);
      },
    );
  },
);
