import { describe, expect, it } from "vitest";
import {
  OpenRouterModelClient,
  type ModelEvent,
  type ModelFetch,
} from "../src/index.js";

const modelInfo = async () => ({
  reasoning: {
    mandatory: true,
    default_enabled: true,
    default_effort: "max",
    supported_efforts: ["max", "high", "low"],
  },
});
function response(frames: unknown[]): Awaited<ReturnType<ModelFetch>> {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (const frame of frames)
        yield new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
      yield new TextEncoder().encode("data: [DONE]\n\n");
    })(),
  };
}
async function collect(events: AsyncIterable<ModelEvent>) {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("reasoning", () => {
  it("streams readable reasoning separately without duplicating alternate representations", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      fetcher: async () =>
        response([
          {
            choices: [
              {
                delta: {
                  reasoning: "Compare ",
                  reasoning_details: [
                    { type: "reasoning.text", text: "Compare " },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: { reasoning_content: "the sources." } }] },
          {
            choices: [
              {
                delta: {
                  reasoning_details: [
                    { type: "reasoning.summary", summary: "Sources agree." },
                    { type: "reasoning.encrypted", data: "opaque-secret" },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              { delta: { content: "The answer." }, finish_reason: "stop" },
            ],
          },
        ]),
    });
    const events = await collect(client.send({ messages: [] }));
    expect(events.filter((event) => event.kind === "reasoningDelta")).toEqual([
      { kind: "reasoningDelta", text: "Compare " },
      { kind: "reasoningDelta", text: "the sources." },
      { kind: "reasoningDelta", text: "Sources agree." },
    ]);
    expect(JSON.stringify(events)).not.toContain("opaque-secret");
    expect(events.filter((event) => event.kind === "textDelta")).toEqual([
      { kind: "textDelta", text: "The answer." },
    ]);
  });

  it("offers only the model's advertised reasoning controls", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      modelInfo,
    });
    expect((await client.settings()).reasoning).toEqual({
      status: "available",
      required: true,
      defaultEnabled: true,
      defaultEffort: "max",
      efforts: ["max", "high", "low"],
    });
  });

  it("settles reasoning and picture support from one catalogue lookup", async () => {
    let lookups = 0;
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      modelInfo: async () => {
        lookups += 1;
        return {
          ...(await modelInfo()),
          architecture: { input_modalities: ["text", "image"] },
        };
      },
    });

    const settings = await client.settings();

    expect(settings.reasoning).toMatchObject({ status: "available" });
    expect(settings.acceptsImages).toBe(true);
    expect(lookups).toBe(1);
  });

  it("sends the selected effort and refuses unsupported or forbidden settings before generation", async () => {
    const requests: string[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      modelInfo,
      fetcher: async (_url, init) => {
        requests.push(init.body);
        return response([]);
      },
    });
    await collect(
      client.send({
        messages: [],
        reasoning: { enabled: true, effort: "low" },
      }),
    );
    expect(JSON.parse(requests[0]!).reasoning).toEqual({
      enabled: true,
      effort: "low",
    });
    for (const reasoning of [
      { enabled: false } as const,
      { enabled: true, effort: "medium" } as const,
    ]) {
      await expect(
        collect(client.send({ messages: [], reasoning })),
      ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    }
    expect(requests).toHaveLength(1);
  });

  it("sends an explicit off setting for a model that permits it", async () => {
    let body = "";
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      modelInfo: async () => ({
        reasoning: {
          mandatory: false,
          default_enabled: true,
          supported_efforts: ["low", "high"],
        },
      }),
      fetcher: async (_url, init) => {
        body = init.body;
        return response([]);
      },
    });
    await collect(client.send({ messages: [], reasoning: { enabled: false } }));
    expect(JSON.parse(body).reasoning).toEqual({ enabled: false });
  });

  /**
   * A catalogue that was unreachable once must not stay unreachable.
   *
   * The lookup that failed is forgotten rather than cached, so the next question
   * about the same model asks again — no restart, no model change, the same
   * client. The wording is part of this: it used to tell somebody to restart the
   * app, which would have changed nothing and was not how the code behaved.
   */
  it("recovers reasoning settings after a catalogue failure, without a restart", async () => {
    let offline = true;
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      modelInfo: async () => {
        if (offline) throw new Error("offline");
        return {
          reasoning: {
            mandatory: false,
            default_enabled: true,
            supported_efforts: ["low", "high"],
            default_effort: "high",
          },
        };
      },
      fetcher: async () => response([]),
    });

    const whileOffline = (await client.settings()).reasoning;
    expect(whileOffline).toMatchObject({ status: "unavailable" });
    expect(
      whileOffline?.status === "unavailable" ? whileOffline.reason : "",
    ).not.toMatch(/restart/i);

    offline = false;

    expect((await client.settings()).reasoning).toMatchObject({
      status: "available",
      required: false,
      efforts: ["low", "high"],
    });
  });

  it("keeps unavailable capability discovery separate from task availability", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => "test",
      modelInfo: async () => {
        throw new Error("offline");
      },
      fetcher: async () => response([]),
    });
    expect((await client.settings()).reasoning).toMatchObject({
      status: "unavailable",
    });
    const events = await collect(client.send({ messages: [] }));
    expect(events.some((event) => event.kind === "done")).toBe(true);
  });
});
