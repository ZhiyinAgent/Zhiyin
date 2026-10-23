/**
 * Some failures pass on a lab's own sentence. Where that sentence quotes the
 * key, the key still never reaches the error: errors are shown to the person,
 * kept in the conversation and written to the diagnostic log. Nor does it
 * reach the events passed on before the error, such as a note that the
 * request is being sent again, which carries the lab's sentence too.
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { ProviderCredentials } from "../src/credentials.js";
import type { ModelFetch } from "../src/model-client.js";
import { everyProvider } from "./shipped-providers.js";

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
      "leaves the key out of the error, and of every event before it, for a %i",
      async (status) => {
        const client = new ProviderModelClient(provider, {
          apiKey: async () => apiKey,
          model: "any-model",
          ...(provider.regions?.[0] ? { region: provider.regions[0].id } : {}),
          fetcher: quotingTheKey(status),
          retry: { wait: async () => {}, random: () => 0 },
        });
        let caught: unknown;
        const events: unknown[] = [];
        try {
          for await (const event of client.send({
            messages: [{ role: "user", content: "Hello" }],
          }))
            events.push(event);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error & Record<string, unknown>;
        expect(error.message).not.toContain(apiKey);
        expect(String(error)).not.toContain(apiKey);
        expect(JSON.stringify(error)).not.toContain(apiKey);
        expect(JSON.stringify(error.provider ?? {})).not.toContain(apiKey);
        expect(JSON.stringify(events)).not.toContain(apiKey);
      },
    );

    it.each([400, 401, 403])(
      "leaves the key out of a key check it refuses with a %i",
      async (status) => {
        const client = new ProviderModelClient(provider, {
          credentials: new ProviderCredentials({
            environment: () => undefined,
            entries: () => ({
              getPassword: async () => undefined,
              setPassword: async () => {},
              deletePassword: async () => false,
            }),
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

    /** A client whose key check answers `checked`, recording what it sent. */
    function checking(checked: { ok: boolean; status: number; body: unknown }) {
      const kept: { sent: string[]; stored?: string } = { sent: [] };
      const client = new ProviderModelClient(provider, {
        credentials: new ProviderCredentials({
          environment: () => undefined,
          entries: () => ({
            getPassword: async () => kept.stored,
            setPassword: async (value) => {
              kept.stored = value;
            },
            deletePassword: async () => false,
          }),
        }),
        ...(provider.regions?.[0] ? { region: provider.regions[0].id } : {}),
        catalogFetch: async (_url, init) => {
          kept.sent.push(JSON.stringify(init.headers ?? {}));
          return {
            ok: checked.ok,
            status: checked.status,
            json: async () => checked.body,
          };
        },
      });
      return { client, kept };
    }

    const pasted = ` ${apiKey}	`;

    it("stores a key pasted with spaces around it without them", async () => {
      const { client, kept } = checking({ ok: true, status: 200, body: {} });

      await client.setApiKey(pasted);

      expect(kept.stored).toBe(apiKey);
    });

    it("checks a key pasted with spaces around it without them, and leaves it out of the refusal", async () => {
      const { client, kept } = checking({
        ok: false,
        status: 401,
        body: body(),
      });

      const outcome: unknown = await client
        .setApiKey(pasted)
        .catch((error: unknown) => error);

      const carried = kept.sent.flatMap((headers) =>
        Object.values(JSON.parse(headers) as Record<string, string>).filter(
          (value) => value.includes(apiKey),
        ),
      );
      expect(carried.length).toBeGreaterThan(0);
      for (const value of carried)
        expect([apiKey, `Bearer ${apiKey}`]).toContain(value);
      expect(String(outcome)).not.toContain(apiKey);
      expect(JSON.stringify(outcome)).not.toContain(apiKey);
    });
  },
);
