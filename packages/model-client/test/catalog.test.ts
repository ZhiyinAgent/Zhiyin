import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileModelChoice,
  ModelChoiceError,
  OpenRouterModelClient,
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  type CatalogFetch,
  type ModelEvent,
  type ModelFetch,
} from "../src/index.js";

const DONE_EVENT = "data: [DONE]\n\n";

function answers(body: unknown, ok = true, status = 200): CatalogFetch {
  return async () => ({ ok, status, json: async () => body });
}

function streamResponse(): Awaited<ReturnType<ModelFetch>> {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield new TextEncoder().encode(DONE_EVENT);
    })(),
  };
}

/** Runs a request to completion; these tests assert on what was sent. */
async function drain(stream: AsyncIterable<ModelEvent>) {
  for await (const event of stream) void event;
}

const toolModel = {
  id: "vendor/with-tools",
  name: "Vendor: With Tools",
  context_length: 262144,
  pricing: { prompt: "0.0000005", completion: "0.0000015" },
  architecture: { input_modalities: ["text", "image"] },
  supported_parameters: ["tools", "reasoning"],
  reasoning: { mandatory: false, default_enabled: true },
};

const toollessModel = {
  id: "vendor/no-tools",
  name: "Vendor: No Tools",
  context_length: 8192,
  pricing: { prompt: "0.0000001", completion: "0.0000002" },
  architecture: { input_modalities: ["text"] },
  supported_parameters: ["max_tokens"],
};

describe("model catalogue", () => {
  it("lists only models that can call tools", async () => {
    const catalog = await fetchOpenRouterCatalog({
      fetcher: answers({
        data: [
          toolModel,
          toollessModel,
          { ...toolModel, id: "vendor/with-tools:batch" },
        ],
      }),
    });

    expect(catalog).toEqual({
      status: "ready",
      models: [
        {
          id: "vendor/with-tools",
          name: "Vendor: With Tools",
          contextWindow: 262144,
          inputUsdPerMillion: 0.5,
          outputUsdPerMillion: 1.5,
          acceptsImages: true,
          reasoning: true,
        },
      ],
    });
  });

  it("signs the catalogue request with the stored key, because measurements need it", async () => {
    const headers: Record<string, string>[] = [];
    const fetcher: CatalogFetch = async (_url, init) => {
      headers.push({ ...init.headers });
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    await fetchOpenRouterCatalog({ fetcher, apiKey: async () => "a-key" });

    expect(headers[0]).toEqual({ Authorization: "Bearer a-key" });
  });

  it("reports absent measurements as absent rather than as zero", async () => {
    const list = await fetchOpenRouterModelProviders("vendor/with-tools", {
      fetcher: answers({
        data: {
          endpoints: [
            {
              tag: "someone/fp8",
              provider_name: "Someone",
              quantization: "fp8",
              context_length: 262144,
              pricing: { prompt: "0.0000005", completion: "0.0000015" },
              supported_parameters: ["tools"],
              latency_last_30m: null,
              throughput_last_30m: null,
              uptime_last_30m: null,
            },
          ],
        },
      }),
    });

    expect(list).toEqual({
      status: "ready",
      model: "vendor/with-tools",
      providers: [
        {
          slug: "someone/fp8",
          name: "Someone",
          quantization: "fp8",
          contextWindow: 262144,
          inputUsdPerMillion: 0.5,
          outputUsdPerMillion: 1.5,
          acceptsTools: true,
          responseMs: null,
          tokensPerSecond: null,
          uptimePercent: null,
        },
      ],
    });
  });

  it("says an upstream cannot run tools instead of hiding it", async () => {
    const list = await fetchOpenRouterModelProviders("vendor/with-tools", {
      fetcher: answers({
        data: {
          endpoints: [
            {
              tag: "plain",
              provider_name: "Plain",
              quantization: "unknown",
              context_length: 1024,
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["max_tokens"],
              latency_last_30m: { p50: 900.4 },
              throughput_last_30m: { p50: 42.6 },
              uptime_last_30m: 99.87,
            },
          ],
        },
      }),
    });

    expect(list).toMatchObject({
      status: "ready",
      providers: [
        {
          slug: "plain",
          quantization: null,
          acceptsTools: false,
          responseMs: 900,
          tokensPerSecond: 43,
          uptimePercent: 99.9,
        },
      ],
    });
  });

  it("turns a refused key into an actionable reason rather than an empty list", async () => {
    expect(
      await fetchOpenRouterCatalog({ fetcher: answers({}, false, 401) }),
    ).toEqual({
      status: "unavailable",
      reason: "The stored key was refused, so the model list is unavailable.",
    });
  });

  it("turns an unreachable catalogue into an actionable reason", async () => {
    expect(
      await fetchOpenRouterCatalog({
        fetcher: async () => {
          throw new Error("offline");
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "The model list could not be reached.",
    });
  });
});

describe("model choice", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zhiyin-choice-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const fallback = { model: "vendor/default", providers: [] as string[] };

  it("keeps the chosen model and upstreams across restarts", async () => {
    const first = new FileModelChoice(directory, fallback);
    await first.set({
      model: "vendor/chosen",
      providers: ["one/fp8", "two"],
    });

    const second = new FileModelChoice(directory, fallback);
    expect(await second.current()).toEqual({
      model: "vendor/chosen",
      providers: ["one/fp8", "two"],
    });
  });

  it("falls back to a working model when nothing has been chosen", async () => {
    expect(await new FileModelChoice(directory, fallback).current()).toEqual(
      fallback,
    );
  });

  it("falls back rather than failing when the stored choice is damaged", async () => {
    await writeFile(join(directory, "model-choice.json"), "{ not json", "utf8");

    expect(await new FileModelChoice(directory, fallback).current()).toEqual(
      fallback,
    );
  });

  it("refuses a choice with no model", async () => {
    await expect(
      new FileModelChoice(directory, fallback).set({
        model: "  ",
        providers: [],
      }),
    ).rejects.toBeInstanceOf(ModelChoiceError);
  });

  it("applies concurrent saves one at a time, so the last one stands", async () => {
    const choice = new FileModelChoice(directory, fallback);

    await Promise.all([
      choice.set({ model: "vendor/a", providers: ["a"] }),
      choice.set({ model: "vendor/b", providers: ["b"] }),
      choice.set({ model: "vendor/c", providers: ["c"] }),
    ]);

    expect(await choice.current()).toEqual({
      model: "vendor/c",
      providers: ["c"],
    });
  });
});

describe("OpenRouterModelClient with a saved choice", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zhiyin-choice-client-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("sends the chosen model and restricts routing to the chosen upstreams", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const choice = new FileModelChoice(directory, {
      model: "vendor/default",
      providers: [],
    });
    await choice.set({ model: "vendor/chosen", providers: ["one", "two/fp8"] });
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse();
      },
      choice,
    });

    await drain(
      client.send({ messages: [{ role: "user", content: "hello" }] }),
    );

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      model: "vendor/chosen",
      provider: { only: ["one", "two/fp8"], order: ["one", "two/fp8"] },
    });
  });

  it("lets the provider choose when no upstream was selected", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const choice = new FileModelChoice(directory, {
      model: "vendor/default",
      providers: [],
    });
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse();
      },
      choice,
    });

    await drain(
      client.send({ messages: [{ role: "user", content: "hello" }] }),
    );

    const body = JSON.parse(requests[0]?.[1].body ?? "{}") as {
      provider?: unknown;
      model?: string;
    };
    expect(body.model).toBe("vendor/default");
    expect(body.provider).toBeUndefined();
  });

  it("uses a choice saved mid-session on the next request", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const choice = new FileModelChoice(directory, {
      model: "vendor/default",
      providers: [],
    });
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse();
      },
      choice,
    });

    await drain(client.send({ messages: [{ role: "user", content: "one" }] }));
    await client.selectModel("vendor/later", ["chosen"]);
    await drain(client.send({ messages: [{ role: "user", content: "two" }] }));

    expect(JSON.parse(requests[1]?.[1].body ?? "{}")).toMatchObject({
      model: "vendor/later",
      provider: { only: ["chosen"] },
    });
  });

  it("reports the chosen model and upstreams in its settings", async () => {
    const choice = new FileModelChoice(directory, {
      model: "vendor/default",
      providers: [],
    });
    await choice.set({ model: "vendor/chosen", providers: ["one"] });
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async () => streamResponse(),
      choice,
    });

    expect(await client.settings()).toMatchObject({
      model: "vendor/chosen",
      providers: ["one"],
    });
  });

  it("asks the catalogue about the model that is actually selected", async () => {
    const asked: string[] = [];
    const choice = new FileModelChoice(directory, {
      model: "vendor/default",
      providers: [],
    });
    await choice.set({ model: "vendor/chosen", providers: [] });
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async () => streamResponse(),
      choice,
      modelInfo: async (model) => {
        asked.push(model);
        return { architecture: { input_modalities: ["text", "image"] } };
      },
    });

    expect((await client.settings()).acceptsImages).toBe(true);
    expect(asked).toContain("vendor/chosen");
  });
});
