/**
 * Mistral's models and prices, checked 2026-10-09 against Mistral's model
 * cards, its reasoning guide and its API pricing page, in US dollars. The
 * cards give the window as "1M" and "256k", read here at their smaller value,
 * and state no longest reply. Large 4 is in public preview at a launch price,
 * half its regular one for two weeks from 2026-10-06; the list carries the
 * regular price, since the sale's end is not dated and an estimate that stays
 * high after it is safer than one that stays low.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import { ONE_PLATFORM, type ModelList } from "../../model-list.js";

/**
 * Mistral documents two settings for its own models: `high`, which returns a
 * full thinking trace, and `none`, which returns none. What an unset effort
 * does is not stated, so reasoning on always names `high`, which Mistral
 * recommends for agentic use.
 */
const reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "high",
  efforts: ["high"],
};

export const mistralModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "mistral-large-4",
      name: "Mistral Large 4",
      contextWindow: 1_000_000,
      acceptsImages: true,
      reasoning,
      offered: {
        [ONE_PLATFORM]: {
          currency: "USD",
          input: 1.36,
          cacheRead: 0.14,
          output: 4.18,
        },
      },
    },
    {
      id: "mistral-medium-3-5",
      name: "Mistral Medium 3.5",
      contextWindow: 256_000,
      acceptsImages: true,
      reasoning,
      offered: {
        [ONE_PLATFORM]: {
          currency: "USD",
          input: 1.5,
          cacheRead: 0.15,
          output: 7.5,
        },
      },
    },
  ],
};
