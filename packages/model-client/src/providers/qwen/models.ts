/**
 * Qwen's models and prices, checked 2026-10-09 against the model pages and
 * API reference of QwenCloud (qwencloud.com, US dollars) and 千问云
 * (qianwenai.com, yuan). Neither prices these two models by input length or
 * time of day. The cache price is the implicit cache's, the only one Zhiyin
 * uses: it marks nothing for the explicit cache.
 *
 * Both platforms give the window as "1M" and the longest reply as "128k" in
 * their model table ("131K" on the model pages); the list takes the smaller
 * readings, 1,000,000 and 128,000.
 *
 * Left out: qwen3.7-plus, whose price above 256K input tokens neither
 * platform's pages show, and whose listed price is a limited-time discount.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import type { ModelList } from "../../model-list.js";

/** Thinking can be turned off; `xhigh` when no effort is named. */
const reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "xhigh",
  efforts: ["low", "medium", "xhigh"],
};

const window = { contextWindow: 1_000_000, maximumOutputTokens: 128_000 };

export const qwenModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "qwen3.8-max",
      name: "Qwen3.8-Max",
      ...window,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 2,
          cacheRead: 0.25,
          output: 6,
        },
        mainland: { currency: "CNY", input: 12, cacheRead: 1.5, output: 36 },
      },
    },
    {
      id: "qwen3.8-flash",
      name: "Qwen3.8-Flash",
      ...window,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.15,
          cacheRead: 0.016,
          output: 0.47,
        },
        mainland: { currency: "CNY", input: 0.8, cacheRead: 0.1, output: 2.7 },
      },
    },
  ],
};
