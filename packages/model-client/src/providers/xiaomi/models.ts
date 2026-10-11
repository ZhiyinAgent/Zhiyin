/**
 * Xiaomi MiMo's models and prices, checked 2026-10-09 against Xiaomi's own
 * pages: the model summary and the Chat Completions reference (thinking,
 * pictures, longest reply), its OpenCode integration page (the window in
 * tokens and the names as Xiaomi writes them), and its pay-as-you-go pricing,
 * in yuan for mainland China accounts and US dollars for overseas ones.
 * Xiaomi lists no input tiers and no time-of-day prices for these models, and
 * cache writes are free for a limited time with no price given after.
 *
 * Left out: `mimo-v2.5-pro` and `mimo-v2.5`, which Xiaomi retires on
 * 2026-10-21, and `mimo-v2.6-pro-ultraspeed`, for which Xiaomi publishes no
 * rate limits and offers service on request.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import type { ModelList } from "../../model-list.js";

/**
 * Thinking is on unless turned off. Chat Completions takes no effort: only
 * `thinking.type`, `enabled` or `disabled`.
 */
const reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  efforts: [],
};

export const xiaomiModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "mimo-v2.6-pro",
      name: "MiMo-V2.6-Pro",
      contextWindow: 1_048_576,
      maximumOutputTokens: 131_072,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.435,
          cacheRead: 0.0036,
          output: 0.87,
        },
        mainland: { currency: "CNY", input: 3, cacheRead: 0.025, output: 6 },
      },
    },
    {
      id: "mimo-v2.6-flash",
      name: "MiMo-V2.6-Flash",
      contextWindow: 1_048_576,
      maximumOutputTokens: 131_072,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.14,
          cacheRead: 0.0028,
          output: 0.28,
        },
        mainland: { currency: "CNY", input: 1, cacheRead: 0.02, output: 2 },
      },
    },
  ],
};
