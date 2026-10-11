/**
 * Moonshot's Kimi models and prices, checked 2026-10-09 against the Kimi API
 * documentation: its model list, model parameter reference, thinking and
 * reasoning effort guides, and the pricing pages of both platforms,
 * platform.kimi.ai in US dollars and platform.kimi.com in yuan. Prices are
 * flat, with no tiers by length and no peak hours. Only K3 bills a cache
 * write, at the 5-minute tier the API uses when a request names none.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import type { ModelList } from "../../model-list.js";

/** K3 always reasons, at `max` unless another effort is named. */
const k3Reasoning: ReasoningCapabilities = {
  status: "available",
  required: true,
  defaultEnabled: true,
  defaultEffort: "max",
  efforts: ["low", "high", "max"],
};

/** K2.7 Code always thinks, and takes no control over it. */
const k27CodeReasoning: ReasoningCapabilities = {
  status: "available",
  required: true,
  defaultEnabled: true,
  efforts: [],
};

/** K2.6 thinks unless turned off, and takes no effort. */
const k26Reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  efforts: [],
};

/**
 * The models whose thinking is switched by `thinking.type`. K3 takes
 * `reasoning_effort` instead, and K2.7 Code takes nothing; neither is to be
 * sent `thinking`.
 */
export const thinkingSwitched: ReadonlySet<string> = new Set(["kimi-k2.6"]);

export const moonshotModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "kimi-k3",
      name: "Kimi K3",
      contextWindow: 1_048_576,
      maximumOutputTokens: 1_048_576,
      acceptsImages: true,
      reasoning: k3Reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 3,
          cacheRead: 0.3,
          cacheWrite: 3,
          output: 15,
        },
        mainland: {
          currency: "CNY",
          input: 20,
          cacheRead: 2,
          cacheWrite: 20,
          output: 100,
        },
      },
    },
    {
      id: "kimi-k2.7-code",
      name: "Kimi K2.7 Code",
      contextWindow: 262_144,
      maximumOutputTokens: 262_144,
      acceptsImages: true,
      reasoning: k27CodeReasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.95,
          cacheRead: 0.19,
          output: 4,
        },
        mainland: { currency: "CNY", input: 6.5, cacheRead: 1.3, output: 27 },
      },
    },
    {
      id: "kimi-k2.7-code-highspeed",
      name: "Kimi K2.7 Code HighSpeed",
      contextWindow: 262_144,
      maximumOutputTokens: 262_144,
      acceptsImages: true,
      reasoning: k27CodeReasoning,
      offered: {
        international: {
          currency: "USD",
          input: 1.9,
          cacheRead: 0.38,
          output: 8,
        },
        mainland: { currency: "CNY", input: 13, cacheRead: 2.6, output: 54 },
      },
    },
    {
      id: "kimi-k2.6",
      name: "Kimi K2.6",
      contextWindow: 262_144,
      maximumOutputTokens: 262_144,
      acceptsImages: true,
      reasoning: k26Reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.95,
          cacheRead: 0.16,
          output: 4,
        },
        mainland: { currency: "CNY", input: 6.5, cacheRead: 1.1, output: 27 },
      },
    },
  ],
};
