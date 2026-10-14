/**
 * A lab's own API checked against its live service, one platform at a time:
 * the path its provider folder was built for from documentation, which no
 * person is sent down until it passes here (ADR 0024).
 *
 * A platform is checked only when its key variable is set, like the feature's
 * other live checks; `pnpm test:live` sets them from the repository's
 * gitignored `.env.local`. Every request is small: the largest is the cache
 * check's, about 7,000 tokens, sent up to three times.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ModelReplay } from "@zhiyin/contract";
import { describe, expect, it } from "vitest";
import {
  FileModelChoice,
  ModelProviders,
  type CredentialEntry,
  type ModelClient,
  type ModelMessage,
  type ModelRequest,
  type ModelToolCall,
  type ModelUsage,
} from "../src/index.js";
import type { Provider } from "../src/provider.js";
import { openRouter } from "../src/providers/openrouter/provider.js";

/** Reasoning models take their time; a hang still fails. */
const liveTimeout = 180_000;

/** Past every lab's minimum for caching, 4,096 tokens at most. */
const longInstructions = Array.from(
  { length: 400 },
  (_, index) =>
    `Rule ${index + 1}: keep each answer short, plain, and about the notes only.`,
).join("\n");

const readNote = {
  name: "read_note",
  description: "Read one of the person's notes by its number.",
  inputSchema: {
    type: "object",
    properties: { note: { type: "number" } },
    required: ["note"],
  },
};

/** A square of one colour, as a base64 PNG. */
function square(red: number, green: number, blue: number): string {
  const size = 64;
  const row = Buffer.from([
    0,
    ...Array.from({ length: size }, () => [red, green, blue]).flat(),
  ]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // red, green and blue
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk(
      "IDAT",
      deflateSync(Buffer.concat(Array.from({ length: size }, () => row))),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

type Answer = {
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage?: ModelUsage;
  readonly finishReason?: string;
  readonly replay?: ModelReplay;
};

/** One request's stream, gathered the way the agent loop gathers it. */
async function answer(
  client: ModelClient,
  request: ModelRequest,
): Promise<Answer> {
  let text = "";
  let reasoning = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let usage: ModelUsage | undefined;
  let finishReason: string | undefined;
  let replay: ModelReplay | undefined;
  for await (const event of client.send(request)) {
    if (event.kind === "textDelta") text += event.text;
    else if (event.kind === "reasoningDelta") reasoning += event.text;
    else if (event.kind === "toolCallDelta") {
      const call = calls.get(event.index) ?? { id: "", name: "", args: "" };
      if (event.callId) call.id = event.callId;
      if (event.name) call.name += event.name;
      if (event.argumentsDelta) call.args += event.argumentsDelta;
      calls.set(event.index, call);
    } else if (event.kind === "usage") usage = event.usage;
    else if (event.kind === "done") {
      finishReason = event.finishReason;
      replay = event.replay;
    }
  }
  return {
    text,
    reasoning,
    toolCalls: [...calls.values()].map(({ id, name, args }) => ({
      id,
      name,
      arguments: args,
    })),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(replay ? { replay } : {}),
  };
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Checks one lab on each of its platforms whose key is set, with `model`: the
 * cheapest it offers that takes tools. `sharedKeys` says the lab's platforms
 * take each other's keys, as found live, rather than refusing them.
 */
export function checkLive(
  provider: Provider,
  model: string,
  { sharedKeys = false }: { readonly sharedKeys?: boolean } = {},
): void {
  for (const region of provider.regions ?? [undefined]) {
    const variable = region?.keyVariable ?? provider.keyVariable;
    const key = process.env[variable]?.trim() || undefined;
    const target = {
      provider: provider.id,
      ...(region ? { region: region.id } : {}),
    };

    /** The platform as the app reaches it, with a development key or none. */
    function reach(environmentKey: string | undefined): ModelClient {
      const stored = new Map<string, string>();
      const entry = (account: string): CredentialEntry => ({
        getPassword: async () => stored.get(account),
        setPassword: async (secret) => void stored.set(account, secret),
        deletePassword: async () => stored.delete(account),
      });
      return new ModelProviders({
        choice: new FileModelChoice(
          mkdtempSync(join(tmpdir(), "zhiyin-live-")),
        ),
        environment: (name) => (name === variable ? environmentKey : undefined),
        credentialEntry: entry,
        providers: [openRouter, provider],
      }).for(target);
    }

    async function chosen(): Promise<ModelClient> {
      const client = reach(key);
      await client.selectModel(model, []);
      return client;
    }

    const name = region ? `${provider.name}, ${region.name}` : provider.name;

    describe.skipIf(!key)(`${name}, live (${variable})`, () => {
      it(
        "accepts its key, and refuses a wrong one before keeping it",
        async () => {
          await expect(reach(undefined).setApiKey(key ?? "")).resolves.toEqual({
            status: "accepted",
          });
          await expect(
            reach(undefined).setApiKey("zhiyin-live-check-not-a-key"),
          ).rejects.toMatchObject({ code: "unauthorized" });
        },
        liveTimeout,
      );

      // Where the lab's other platform has a host of its own.
      const other = provider.regions?.find(
        (each) => each.id !== region?.id && each.endpoint !== region?.endpoint,
      );
      const otherKey = other
        ? process.env[other.keyVariable ?? provider.keyVariable]?.trim()
        : undefined;
      it.skipIf(!otherKey)(
        sharedKeys
          ? "accepts a key from the lab's other platform"
          : "refuses a key from the lab's other platform",
        async () => {
          const offered = reach(undefined).setApiKey(otherKey ?? "");
          if (sharedKeys)
            await expect(offered).resolves.toEqual({ status: "accepted" });
          else
            await expect(offered).rejects.toMatchObject({
              code: "unauthorized",
            });
        },
        liveTimeout,
      );

      it(
        "lists the model this check uses",
        async () => {
          const catalog = await reach(key).models();

          expect(catalog.status).toBe("ready");
          if (catalog.status !== "ready") return;
          expect(catalog.models.map((each) => each.id)).toContain(model);
        },
        liveTimeout,
      );

      it(
        "streams an answer, with its usage and its cost",
        async () => {
          const reply = await answer(await chosen(), {
            messages: [
              { role: "user", content: "Reply with the single word: ready" },
            ],
            maximumOutputTokens: 4096,
          });

          expect(reply.text.trim()).not.toBe("");
          expect(reply.finishReason).not.toBe("length");
          expect(reply.usage?.inputTokens).toBeGreaterThan(0);
          expect(reply.usage?.outputTokens).toBeGreaterThan(0);
          expect(
            reply.usage?.costUsd ?? reply.usage?.estimatedCost,
          ).toBeDefined();
        },
        liveTimeout,
      );

      it(
        "calls a tool, then answers from its result with its reasoning sent back",
        async () => {
          const client = await chosen();
          const settings = await client.settings();
          const reasoning =
            settings.reasoning?.status === "available"
              ? { enabled: true as const }
              : undefined;
          const asked: ModelMessage[] = [
            {
              role: "user",
              content:
                "Use read_note to read note 7, then say in one sentence what it says.",
            },
          ];
          const request = {
            tools: [readNote],
            maximumOutputTokens: 4096,
            ...(reasoning ? { reasoning } : {}),
          };

          const first = await answer(client, { ...request, messages: asked });

          expect(first.toolCalls.map((call) => call.name)).toContain(
            "read_note",
          );
          const second = await answer(client, {
            ...request,
            messages: [
              ...asked,
              {
                role: "assistant",
                content: first.text,
                toolCalls: first.toolCalls,
                ...(first.reasoning ? { reasoning: first.reasoning } : {}),
                ...(first.replay ? { replay: first.replay } : {}),
              },
              ...first.toolCalls.map((call): ModelMessage => ({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: "Note 7 says the launch moved to December 4.",
              })),
            ],
          });

          expect(second.text).toMatch(/december/i);
        },
        liveTimeout,
      );

      it(
        "accepts an earlier tool turn kept without its reasoning",
        async () => {
          const client = await chosen();
          const settings = await client.settings();

          // As alpha.1 kept it, or another provider wrote it.
          const reply = await answer(client, {
            tools: [readNote],
            maximumOutputTokens: 4096,
            ...(settings.reasoning?.status === "available"
              ? { reasoning: { enabled: true as const } }
              : {}),
            messages: [
              {
                role: "user",
                content:
                  "Use read_note to read note 7, then say in one sentence what it says.",
              },
              {
                role: "assistant",
                content: "",
                toolCalls: [
                  {
                    id: "call_0123456789",
                    name: "read_note",
                    arguments: JSON.stringify({ note: 7 }),
                  },
                ],
              },
              {
                role: "tool",
                toolCallId: "call_0123456789",
                name: "read_note",
                content: "Note 7 says the launch moved to December 4.",
              },
            ],
          });

          expect(reply.text).toMatch(/december/i);
        },
        liveTimeout,
      );

      it(
        "sees a picture, where the model takes pictures",
        async ({ skip }) => {
          const client = await chosen();
          if (!(await client.settings()).acceptsImages)
            skip("The model takes no pictures.");

          const reply = await answer(client, {
            messages: [
              {
                role: "user",
                content: [
                  {
                    kind: "text",
                    text: "What colour is this square? Answer with one word.",
                  },
                  {
                    kind: "image",
                    mediaType: "image/png",
                    data: square(0, 0, 255),
                  },
                ],
              },
            ],
            maximumOutputTokens: 4096,
          });

          expect(reply.text).toMatch(/blue/i);
        },
        liveTimeout,
      );

      it(
        "bills a repeated start from its cache",
        async () => {
          const client = await chosen();
          const request: ModelRequest = {
            messages: [
              { role: "system", content: longInstructions },
              {
                role: "user",
                content: "Which rule comes first? Answer with its number only.",
              },
            ],
            cacheAfter: [0],
            session: `zhiyin-live-${Date.now()}`,
            maximumOutputTokens: 4096,
          };

          const read: number[] = [];
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (attempt > 0) await pause(3_000);
            const { usage } = await answer(client, request);
            read.push(usage?.cacheReadTokens ?? 0);
            if (read.at(-1)! > 0) break;
          }

          expect(Math.max(...read)).toBeGreaterThan(0);
        },
        liveTimeout,
      );
    });
  }
}
