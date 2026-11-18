/**
 * The model client's fake, for the tests of the packages above it
 * (ADR 0002). It reaches no provider. Beside it, the production client bound
 * to OpenRouter, for tests that hand it the network to answer through.
 */

import type { ModelClient, ModelEvent, ModelRequest } from "../src/index.js";

export { OpenRouterModelClient } from "../src/providers/openrouter/test/openrouter-client.js";

/**
 * A model that answers each request with events, in order, and has no key and
 * no models to choose from. Given a list, every request is answered with it;
 * given a function, each request is answered with what it gives for that
 * request.
 */
export function fakeModel(
  events:
    | readonly ModelEvent[]
    | ((request: ModelRequest) => readonly ModelEvent[]) = [{ kind: "done" }],
): ModelClient {
  return {
    send: async function* (request) {
      const answer = typeof events === "function" ? events(request) : events;
      for (const event of answer) yield event;
    },
    settings: async () => ({
      model: "z-ai/glm-5.3-flash",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      credential: { status: "missing", source: "none" },
    }),
    setApiKey: async () => ({ status: "accepted" }),
    clearApiKey: async () => {},
    models: async () => ({ status: "ready", models: [] }),
    modelProviders: async (model) => ({
      status: "ready",
      model,
      providers: [],
    }),
    selectModel: async () => {},
  };
}
