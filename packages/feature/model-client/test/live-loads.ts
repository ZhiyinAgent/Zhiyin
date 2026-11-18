/**
 * A toolkit opened mid-conversation, checked against a lab that loads tools
 * natively (ADR 0017): the model calls a tool it can know of only from the
 * load, the request after the load reads what came before it from the cache,
 * and the one after that reads further. Each platform whose
 * key variable is set is checked, with three small requests.
 */

import { TemporaryFolders } from "@zhiyin/test-support";
import { afterAll, describe, expect, it } from "vitest";
import {
  FileModelChoice,
  ModelProviders,
  type ModelMessage,
  type ModelRequest,
} from "../src/index.js";
import type { Provider } from "../src/provider.js";
import { openRouter } from "../src/providers/openrouter/provider.js";
import { answer, liveTimeout, longInstructions } from "./live-lab.js";

const openToolkit = {
  name: "open_toolkit",
  description: "Open a toolkit by its id; its tools become callable.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
};

/** A name no model would guess, so a call to it shows the load arrived. */
const loaded = {
  name: "lookup_sky_v7",
  description: "The current weather in one city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

export function checkLoadsLive(provider: Provider, model: string): void {
  const folders = new TemporaryFolders();
  afterAll(() => folders.removeAll());
  for (const region of provider.regions ?? [undefined]) {
    const variable = region?.keyVariable ?? provider.keyVariable;
    const key = process.env[variable]?.trim() || undefined;
    const name = `${region ? `${provider.name}, ${region.name}` : provider.name}, ${model}`;

    describe.skipIf(!key)(`${name}, tools loaded live (${variable})`, () => {
      it(
        "calls a tool it was given mid-conversation, and reads the conversation before it from the cache",
        async () => {
          const client = new ModelProviders({
            choice: new FileModelChoice(await folders.make("zhiyin-live-")),
            environment: (asked) => (asked === variable ? key : undefined),
            credentialEntry: () => ({
              getPassword: async () => undefined,
              setPassword: async () => {},
              deletePassword: async () => false,
            }),
            providers: [openRouter, provider],
          }).for({
            provider: provider.id,
            ...(region ? { region: region.id } : {}),
          });
          await client.selectModel(model, []);
          expect(await client.settings()).toMatchObject({ loadsTools: true });

          const messages: ModelMessage[] = [
            {
              role: "system",
              content: `Follow the person's steps exactly.\n${longInstructions}`,
            },
            {
              role: "user",
              content:
                "First call open_toolkit with id 'weather'. After it opens, call the tool it adds, for Paris. Then say the weather in one short sentence.",
            },
          ];
          const request = (cacheAfter: number[]): ModelRequest => ({
            messages,
            tools: [openToolkit],
            cacheAfter,
            session: `zhiyin-live-loads-${Date.now()}`,
            maximumOutputTokens: 4096,
          });

          const first = await answer(client, request([0, 1]));
          const open = first.toolCalls.find(
            (call) => call.name === "open_toolkit",
          );
          expect(open).toBeDefined();
          messages.push(
            {
              role: "assistant",
              content: first.text,
              toolCalls: first.toolCalls,
              ...(first.reasoning ? { reasoning: first.reasoning } : {}),
              ...(first.replay ? { replay: first.replay } : {}),
            },
            {
              role: "tool",
              toolCallId: open?.id ?? "",
              name: "open_toolkit",
              content: "The weather toolkit is open: its tools are callable.",
            },
          );
          const loads = [{ tools: [loaded], after: 3 }];

          const second = await answer(client, {
            ...request([0, 3]),
            loads,
          });
          const call = second.toolCalls.find(
            (each) => each.name === loaded.name,
          );
          expect(call).toBeDefined();
          messages.push(
            {
              role: "assistant",
              content: second.text,
              toolCalls: second.toolCalls,
              ...(second.reasoning ? { reasoning: second.reasoning } : {}),
              ...(second.replay ? { replay: second.replay } : {}),
            },
            {
              role: "tool",
              toolCallId: call?.id ?? "",
              name: loaded.name,
              content: "Paris: 14 C, light rain.",
            },
          );

          const third = await answer(client, {
            ...request([0, 3, 5]),
            loads,
          });
          expect(third.text).toMatch(/rain/i);
          expect(second.usage?.cacheReadTokens).toBeGreaterThan(0);
          expect(third.usage?.cacheReadTokens).toBeGreaterThan(
            second.usage?.cacheReadTokens ?? 0,
          );
        },
        liveTimeout * 3,
      );
    });
  }
}
