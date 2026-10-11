/**
 * OpenAI's models and prices, checked 2026-10-09 against OpenAI's model pages,
 * its reasoning guide and its pricing page (Standard processing, US dollars).
 * Each model has a 1,050,000-token window, of which at most 922,000 is input,
 * and replies of up to 128,000 tokens. A request with more than 272K input
 * tokens pays the long-context prices for all of it. OpenAI runs one platform,
 * not offered in mainland China.
 */

import type { ModelPrice, ReasoningCapabilities } from "@zhiyin/contract";
import { ONE_PLATFORM, type ModelList } from "../../model-list.js";

const efforts = ["low", "medium", "high", "xhigh", "max"] as const;

/** Astra cannot turn reasoning off; its default effort is not stated. */
const astraReasoning: ReasoningCapabilities = {
  status: "available",
  required: true,
  defaultEnabled: true,
  efforts,
};

/** 6.1 Sol cannot turn reasoning off, and reasons at `medium` by default. */
const solReasoning: ReasoningCapabilities = {
  status: "available",
  required: true,
  defaultEnabled: true,
  defaultEffort: "medium",
  efforts,
};

/** Luna takes `none` to turn reasoning off, and reasons at `medium` by default. */
const lunaReasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "medium",
  efforts,
};

/** Short-context prices, and the long-context ones past 272K input tokens. */
function standard(
  short: readonly [number, number, number, number],
  long: readonly [number, number, number, number],
): Omit<ModelPrice, "checked"> {
  const [input, cacheRead, cacheWrite, output] = short;
  const [longInput, longRead, longWrite, longOutput] = long;
  return {
    currency: "USD",
    input,
    cacheRead,
    cacheWrite,
    output,
    tiers: [
      {
        aboveInputTokens: 272_000,
        input: longInput,
        cacheRead: longRead,
        cacheWrite: longWrite,
        output: longOutput,
      },
    ],
  };
}

const window = { contextWindow: 1_050_000, maximumOutputTokens: 128_000 };

export const openAiModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      ...window,
      acceptsImages: true,
      reasoning: astraReasoning,
      offered: { [ONE_PLATFORM]: standard([10, 1, 12.5, 50], [20, 2, 25, 75]) },
    },
    {
      id: "gpt-6.1-sol",
      name: "GPT-6.1 Sol",
      ...window,
      acceptsImages: true,
      reasoning: solReasoning,
      offered: { [ONE_PLATFORM]: standard([2, 0.1, 2.5, 10], [4, 0.2, 5, 15]) },
    },
    {
      id: "gpt-6-luna",
      name: "GPT-6 Luna",
      ...window,
      acceptsImages: true,
      reasoning: lunaReasoning,
      offered: {
        [ONE_PLATFORM]: standard(
          [0.1, 0.01, 0.125, 0.5],
          [0.2, 0.02, 0.25, 0.75],
        ),
      },
    },
  ],
};
