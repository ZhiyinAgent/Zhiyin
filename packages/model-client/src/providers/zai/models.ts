/**
 * Z.ai's GLM-5.3 models and prices, checked 2026-10-09 against Z.ai's model
 * pages, API reference and core parameters (docs.z.ai) and BigModel's
 * (docs.bigmodel.cn), and each platform's pricing page: Z.ai's in US dollars,
 * BigModel's in yuan. Neither prices these models by input length or time of
 * day. Cache storage, "free for a limited time" on both, is billed by the
 * hour rather than per token, so it is not part of a price here.
 *
 * Both platforms give the context window only as "1M"; the list takes the
 * smaller reading, 1,000,000 tokens. The longest reply is the documented
 * `max_tokens` maximum, 131,072.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import type { ModelList } from "../../model-list.js";

/** Thinking cannot be turned off; `max` when no effort is named. */
const reasoning: ReasoningCapabilities = {
  status: "available",
  required: true,
  defaultEnabled: true,
  defaultEffort: "max",
  efforts: ["low", "high", "max"],
};

const window = { contextWindow: 1_000_000, maximumOutputTokens: 131_072 };

export const zaiModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "glm-5.3",
      name: "GLM-5.3",
      ...window,
      acceptsImages: false,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 1.4,
          cacheRead: 0.26,
          output: 4.4,
        },
        mainland: { currency: "CNY", input: 8, cacheRead: 2, output: 28 },
      },
    },
    {
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      ...window,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.15,
          cacheRead: 0.03,
          output: 0.5,
        },
        mainland: {
          currency: "CNY",
          input: 0.8,
          cacheRead: 0.23,
          output: 2.8,
        },
      },
    },
    {
      id: "glm-5.3-flashx",
      name: "GLM-5.3-FlashX",
      ...window,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.37,
          cacheRead: 0.075,
          output: 1.25,
        },
        mainland: { currency: "CNY", input: 2, cacheRead: 0.57, output: 7 },
      },
    },
  ],
};
