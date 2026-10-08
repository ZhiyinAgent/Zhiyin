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
          tier: null,
          region: null,
          contextWindow: 262144,
          maximumOutputTokens: null,
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

  it("tells an upstream's service tier and region apart from its provider", async () => {
    const endpoint = (tag: string, provider_name: string) => ({
      tag,
      provider_name,
      quantization: "unknown",
      context_length: 1_050_000,
      pricing: { prompt: "0.0000001", completion: "0.0000005" },
      supported_parameters: ["tools"],
    });
    const list = await fetchOpenRouterModelProviders("openai/gpt-6-luna", {
      fetcher: answers({
        data: {
          endpoints: [
            endpoint("openai/flex", "OpenAI"),
            endpoint("openai", "OpenAI"),
            endpoint("openai/fast", "OpenAI"),
            endpoint("azure/eu", "Azure"),
            endpoint("amazon-bedrock/us-east-1", "Amazon Bedrock"),
            endpoint("google-vertex/global/flex", "Google Vertex"),
            endpoint("someone/fp8", "Someone"),
          ],
        },
      }),
    });

    if (list.status !== "ready") throw new Error(list.reason);
    expect(
      list.providers.map(({ slug, tier, region }) => ({ slug, tier, region })),
    ).toEqual([
      { slug: "openai/flex", tier: "flex", region: null },
      { slug: "openai", tier: null, region: null },
      { slug: "openai/fast", tier: "priority", region: null },
      { slug: "azure/eu", tier: null, region: "eu" },
      { slug: "amazon-bedrock/us-east-1", tier: null, region: "us-east-1" },
      { slug: "google-vertex/global/flex", tier: "flex", region: "global" },
      { slug: "someone/fp8", tier: null, region: null },
    ]);
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

  it("keeps the chosen model and upstreams across restarts", async () => {
    const first = new FileModelChoice(directory);
    await first.set({
      model: "vendor/chosen",
      providers: ["one/fp8", "two"],
    });

    const second = new FileModelChoice(directory);
    expect(await second.current()).toEqual({
      model: "vendor/chosen",
      providers: ["one/fp8", "two"],
    });
  });

  it("has no model until the person chooses one", async () => {
    expect(await new FileModelChoice(directory).current()).toBeUndefined();
  });

  it("has no model, rather than failing, when the stored choice is damaged", async () => {
    await writeFile(join(directory, "model-choice.json"), "{ not json", "utf8");

    expect(await new FileModelChoice(directory).current()).toBeUndefined();
  });

  it("refuses a choice with no model", async () => {
    await expect(
      new FileModelChoice(directory).set({
        model: "  ",
        providers: [],
      }),
    ).rejects.toBeInstanceOf(ModelChoiceError);
  });

  it("applies concurrent saves one at a time, so the last one stands", async () => {
    const choice = new FileModelChoice(directory);

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

  it("sends nothing, and asks for a model, until one is chosen", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse();
      },
      choice: new FileModelChoice(directory),
    });

    await expect(
      drain(client.send({ messages: [{ role: "user", content: "hello" }] })),
    ).rejects.toMatchObject({
      code: "noModel",
      message: "Choose a model on the Model page before starting a task.",
    });
    expect(requests).toEqual([]);
    expect((await client.settings()).model).toBeUndefined();
  });

  it("sends the chosen model and restricts routing to the chosen upstreams", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const choice = new FileModelChoice(directory);
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
    const choice = new FileModelChoice(directory);
    await choice.set({ model: "vendor/chosen", providers: [] });
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
    expect(body.model).toBe("vendor/chosen");
    expect(body.provider).toBeUndefined();
  });

  it("uses a choice saved mid-session on the next request", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const choice = new FileModelChoice(directory);
    await choice.set({ model: "vendor/first", providers: [] });
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
    const choice = new FileModelChoice(directory);
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
    const choice = new FileModelChoice(directory);
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

describe("the window a request must fit", () => {
  const endpoint = (tag: string, window: number, output: number | null) => ({
    slug: tag,
    name: tag,
    quantization: null,
    contextWindow: window,
    maximumOutputTokens: output,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
    acceptsTools: true,
    responseMs: null,
    tokensPerSecond: null,
    uptimePercent: null,
  });
  const upstreams = [
    endpoint("venice/fp4", 198_000, 16_384),
    endpoint("deepinfra/fp4", 202_752, 131_072),
    endpoint("novita/bf16", 204_800, null),
  ];
  const client = (providers: readonly string[], listed = true) =>
    new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async () => streamResponse(),
      model: "z-ai/glm-4.6",
      providers,
      catalog: {
        models: async () => ({ status: "ready", models: [] }),
        providers: async (model) =>
          listed
            ? { status: "ready", model, providers: upstreams }
            : { status: "unavailable", reason: "offline" },
      },
      modelInfo: async () => ({
        context_length: 204_800,
        top_provider: {
          context_length: 198_000,
          max_completion_tokens: 16_384,
        },
      }),
    });

  it("is the smallest window and reply among the upstreams it may be routed to", async () => {
    expect(
      await client(["deepinfra/fp4", "novita/bf16"]).settings(),
    ).toMatchObject({ contextWindow: 202_752, maximumOutputTokens: 131_072 });
    expect(await client([]).settings()).toMatchObject({
      contextWindow: 198_000,
      maximumOutputTokens: 16_384,
    });
  });

  it("is the model's own listing when its upstreams cannot be listed", async () => {
    expect(await client([], false).settings()).toMatchObject({
      contextWindow: 198_000,
      maximumOutputTokens: 16_384,
    });
  });

  it("is left unknown rather than guessed when nothing lists it", async () => {
    const settings = await new OpenRouterModelClient({
      apiKey: async () => "key",
      fetcher: async () => streamResponse(),
      catalog: {
        models: async () => ({ status: "ready", models: [] }),
        providers: async () => ({ status: "unavailable", reason: "offline" }),
      },
    }).settings();

    expect(settings.contextWindow).toBeUndefined();
    expect(settings.maximumOutputTokens).toBeUndefined();
  });

  it("reads each upstream's longest reply from the catalogue", async () => {
    const list = await fetchOpenRouterModelProviders("z-ai/glm-4.6", {
      fetcher: answers({
        data: {
          endpoints: [
            {
              tag: "venice/fp4",
              provider_name: "Venice",
              context_length: 198000,
              max_completion_tokens: 16384,
              pricing: { prompt: "0.0000005", completion: "0.0000015" },
              supported_parameters: ["tools"],
            },
          ],
        },
      }),
    });

    expect(list).toMatchObject({
      providers: [{ contextWindow: 198_000, maximumOutputTokens: 16_384 }],
    });
  });
});
