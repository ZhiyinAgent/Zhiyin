/**
 * A review run on the model the person chose for reviews (ADR 0024): its
 * requests go to that model, and what a request may hold — pictures, its
 * reasoning, its window — is that model's, not the conversation's. Everything
 * else is the conversation's: its records, its tools, its permissions.
 */

import type { ModelClient } from "@zhiyin/model-client";
import type {
  AgentLoopDependencies,
  ReviewerModel,
  TurnHost,
} from "../dependencies.js";

/** `of`, with `overrides` answered in its place and the rest left to it. */
function answeredBy<T extends object>(of: T, overrides: Partial<T>): T {
  return new Proxy(of, {
    get(target, key) {
      if (Object.hasOwn(overrides, key))
        return overrides[key as keyof T] as unknown;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function onReviewerModel<Deps extends AgentLoopDependencies>(
  deps: Deps,
  reviewer: ReviewerModel,
): Deps {
  const host = answeredBy<TurnHost>(deps.host, {
    acceptsImages: () => reviewer.acceptsImages,
    leastReasoning: () => reviewer.leastReasoning,
    reasoningControls: () => reviewer.reasoningControls,
    modelWindow: () => reviewer.modelWindow,
    // A refusal by the reviewer's model says nothing of the conversation's.
    lowerWindow: () => {},
  });
  const model = answeredBy<ModelClient>(deps.model, {
    send: (request) => reviewer.client.send(request),
    uncounted: async (usage) => reviewer.client.uncounted?.(usage),
  });
  return { ...deps, host, model };
}
