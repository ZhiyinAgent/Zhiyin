/**
 * DeepSeek's models and prices, checked 2026-10-09 against DeepSeek's API
 * reference, its Codex integration page (context window, pictures, efforts)
 * and its pricing pages: the English page in US dollars, the Chinese one in
 * yuan. Both halve the price off-peak; peak is 09:00-12:00 and 14:00-18:00
 * Beijing time on working days, which the estimate takes as every weekday.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import type { ModelList } from "../../model-list.js";

/** Thinking is on unless turned off; `high` when no effort is named. */
const reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "high",
  efforts: ["low", "high", "max"],
};

/** 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. */
const peakHours = {
  weekdaysUtc: [1, 2, 3, 4, 5],
  hoursUtc: [
    [1, 4],
    [6, 10],
  ] as const,
};

export const deepSeekModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      contextWindow: 1_048_576,
      maximumOutputTokens: 393_216,
      acceptsImages: true,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.15,
          cacheRead: 0.003,
          output: 0.6,
          peak: { ...peakHours, input: 0.3, cacheRead: 0.006, output: 1.2 },
        },
        mainland: {
          currency: "CNY",
          input: 1,
          cacheRead: 0.02,
          output: 4,
          peak: { ...peakHours, input: 2, cacheRead: 0.04, output: 8 },
        },
      },
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      contextWindow: 1_048_576,
      maximumOutputTokens: 393_216,
      acceptsImages: false,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.66,
          cacheRead: 0.022,
          output: 1.98,
          peak: { ...peakHours, input: 1.32, cacheRead: 0.044, output: 3.96 },
        },
        mainland: {
          currency: "CNY",
          input: 4.5,
          cacheRead: 0.15,
          output: 13.5,
          peak: { ...peakHours, input: 9, cacheRead: 0.3, output: 27 },
        },
      },
    },
  ],
};
