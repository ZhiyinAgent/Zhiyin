/**
 * Verifies the external wire contract against the real provider. Kept out of
 * the normal suite the way the feature's other live check is: it needs a
 * credential and the network, so it skips unless `OPENROUTER_API_KEY` is set.
 * It is for checking that the provider still answers the shape this code
 * reads — not for making local tests pass.
 *
 * Last run 2026-09-10 against the live provider.
 */

import { describe, expect, it } from "vitest";
import {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  fetchOpenRouterModelInfo,
  OpenRouterModelClient,
  type ModelEvent,
} from "../src/index.js";
import { reasoningCapabilities } from "../src/reasoning.js";

const key = process.env["OPENROUTER_API_KEY"];

/**
 * A model that makes reasoning optional, verified live on 2026-09-13:
 * `{"mandatory":false,"default_enabled":true,"supported_efforts":["high",
 * "medium","low","none"],"default_effort":"medium"}`.
 *
 * It has to be a different model from the app's default. `z-ai/glm-5.3-flash`
 * reports `mandatory: true`, so reasoning cannot be turned off on it at all -
 * which is exactly why turning it off had never been exercised against a real
 * provider.
 */
const optionalReasoningModel = "inception/mercury-2.5";

describe.skipIf(!key)("live provider check", () => {
  it("parses the real catalogue", async () => {
    const catalog = await fetchOpenRouterCatalog({ apiKey: async () => key });

    expect(catalog.status).toBe("ready");
    if (catalog.status !== "ready") return;
    expect(catalog.models.length).toBeGreaterThan(100);
    expect(catalog.models.every((model) => model.inputUsdPerMillion >= 0)).toBe(
      true,
    );
    expect(catalog.models.every((model) => model.contextWindow > 0)).toBe(true);
    expect(catalog.models.some((model) => model.acceptsImages)).toBe(true);
    expect(catalog.models.some((model) => model.id.endsWith(":batch"))).toBe(
      false,
    );
  });

  it("parses real upstreams, with the measurements a key unlocks", async () => {
    const list = await fetchOpenRouterModelProviders("z-ai/glm-5.3-flash", {
      apiKey: async () => key,
    });

    expect(list.status).toBe("ready");
    if (list.status !== "ready") return;
    expect(list.providers.length).toBeGreaterThan(5);
    expect(
      list.providers.some((provider) => provider.responseMs !== null),
    ).toBe(true);
    expect(
      list.providers.some((provider) => provider.tokensPerSecond !== null),
    ).toBe(true);
    /*
     * Every upstream serving this model advertises `tools`, so tool support is
     * not what separates them. The narrower `tool_choice: required` capability
     * is missing on some, but Zhiyin never sends `tool_choice` — so it is not
     * the question this app asks, and is deliberately not read.
     */
    expect(list.providers.every((provider) => provider.acceptsTools)).toBe(
      true,
    );
  });

  /*
   * Verified 2026-09-10: both catalogue URLs answer 200 to a key they do not
   * recognise and simply omit the measurements. A rejected key therefore looks
   * exactly like a model with no recent traffic, so neither call can be used to
   * validate a key, and no interface built on them may claim it did.
   */
  it("refuses a withdrawn model id in one of the two ways the app now reads", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => key,
      model: "z-ai/glm-4.9-retired-does-not-exist",
    });

    /*
     * Verified live on 2026-09-13, and the reason the app reads both: an id the
     * provider never had is refused 400 "is not a valid model ID", while a real
     * model that has since been retired answers 404 "No endpoints found". Either
     * way the person's stored choice is the thing that has to change, so the
     * failure names it and says where.
     */
    let failure: unknown;
    try {
      for await (const _ of client.send({
        messages: [{ role: "user", content: "Hi" }],
        maximumOutputTokens: 8,
      }))
        void _;
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "modelUnavailable",
      message: expect.stringContaining("z-ai/glm-4.9-retired-does-not-exist"),
    });
    expect((failure as Error).message).toContain("Settings");
  }, 60_000);

  it("answers a key it does not recognise with a catalogue and no measurements", async () => {
    const rejected = async () => "sk-or-v1-not-a-key";

    expect(await fetchOpenRouterCatalog({ apiKey: rejected })).toMatchObject({
      status: "ready",
    });

    const list = await fetchOpenRouterModelProviders("z-ai/glm-5.3-flash", {
      apiKey: rejected,
    });
    expect(list.status).toBe("ready");
    if (list.status !== "ready") return;
    expect(
      list.providers.every((provider) => provider.responseMs === null),
    ).toBe(true);
  });
});

/**
 * Reasoning against a model that lets it be turned off.
 *
 * Every earlier measurement was taken against the app's default, which requires
 * reasoning, so "off" had never been sent to a provider that would honour it.
 * A deterministic provider-shaped stream covers the parser; it cannot tell us
 * whether a real endpoint accepts the request, which is the whole question here.
 */
describe.skipIf(!key)("live optional reasoning", () => {
  async function collect(
    stream: AsyncIterable<ModelEvent>,
  ): Promise<ModelEvent[]> {
    const events: ModelEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
  }

  const client = () =>
    new OpenRouterModelClient({
      apiKey: async () => key,
      model: optionalReasoningModel,
      modelInfo: fetchOpenRouterModelInfo,
    });

  const traceFrom = (events: readonly ModelEvent[]) =>
    events
      .filter((event) => event.kind === "reasoningDelta")
      .map((event) => (event.kind === "reasoningDelta" ? event.text : ""))
      .join("");

  it("reads this model's reasoning as available and optional", async () => {
    const capabilities = reasoningCapabilities(
      await fetchOpenRouterModelInfo(optionalReasoningModel),
    );

    expect(capabilities).toMatchObject({
      status: "available",
      required: false,
    });
  }, 60_000);

  it("returns no reasoning at all when it is turned off", async () => {
    const events = await collect(
      client().send({
        reasoning: { enabled: false },
        maximumOutputTokens: 64,
        messages: [
          { role: "user", content: "Reply with the single word: ready." },
        ],
      }),
    );

    expect(traceFrom(events)).toBe("");
    expect(events.some((event) => event.kind === "textDelta")).toBe(true);
  }, 120_000);

  it("is accepted when turned on, and whatever trace comes back is readable", async () => {
    const events = await collect(
      client().send({
        reasoning: { enabled: true, effort: "high" },
        maximumOutputTokens: 300,
        messages: [
          {
            role: "user",
            content:
              "A farmer has 17 sheep. All but 9 run away. How many are left? Answer with the number only.",
          },
        ],
      }),
    );
    const trace = traceFrom(events);

    console.log("reasoning characters returned:", trace.length);

    // That a provider returns a readable trace is its choice, not this client's
    // contract, so its presence is reported rather than required. What is
    // required is that asking for one is accepted and that anything arriving is
    // real text rather than an empty marker the interface would draw a box for.
    expect(events.some((event) => event.kind === "textDelta")).toBe(true);
    if (trace.length > 0) expect(trace.trim().length).toBeGreaterThan(0);
  }, 120_000);
});
