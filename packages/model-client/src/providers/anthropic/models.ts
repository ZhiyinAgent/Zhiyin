/**
 * Anthropic's current Claude models and prices, checked 2026-10-09 against
 * Anthropic's models overview, context windows, thinking, effort and pricing
 * pages. One platform, priced in US dollars; Anthropic does not offer its API
 * in mainland China. Cache writes are priced for the five-minute cache, the
 * default Zhiyin asks for; reads are 0.025× input on Fable 5.1, 0.05× on
 * Opus 5.5 and Sonnet 5.5, 0.1× on Haiku 5.5.
 */

import type { ReasoningEffort } from "@zhiyin/contract";
import { ONE_PLATFORM, type ModelList } from "../../model-list.js";

/** Every current model takes every effort. */
const efforts: readonly ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Every current model has a 1M window and replies with up to 128k tokens. */
const size = { contextWindow: 1_000_000, maximumOutputTokens: 128_000 };

export const anthropicModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "claude-fable-5-1",
      name: "Claude Fable 5.1",
      ...size,
      acceptsImages: true,
      reasoning: {
        status: "available",
        required: true,
        defaultEnabled: true,
        defaultEffort: "high",
        efforts,
      },
      offered: {
        [ONE_PLATFORM]: {
          currency: "USD",
          input: 10,
          cacheRead: 0.25,
          cacheWrite: 12.5,
          output: 50,
        },
      },
    },
    {
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      ...size,
      acceptsImages: true,
      reasoning: {
        status: "available",
        required: true,
        defaultEnabled: true,
        defaultEffort: "medium",
        efforts,
      },
      offered: {
        [ONE_PLATFORM]: {
          currency: "USD",
          input: 4,
          cacheRead: 0.2,
          cacheWrite: 5,
          output: 20,
        },
      },
    },
    {
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      ...size,
      acceptsImages: true,
      reasoning: {
        status: "available",
        required: false,
        defaultEnabled: true,
        defaultEffort: "high",
        efforts,
      },
      offered: {
        [ONE_PLATFORM]: {
          currency: "USD",
          input: 2,
          cacheRead: 0.1,
          cacheWrite: 2.5,
          output: 10,
        },
      },
    },
    {
      id: "claude-haiku-5-5",
      name: "Claude Haiku 5.5",
      ...size,
      acceptsImages: true,
      reasoning: {
        status: "available",
        required: false,
        defaultEnabled: true,
        defaultEffort: "medium",
        efforts,
      },
      offered: {
        [ONE_PLATFORM]: {
          currency: "USD",
          input: 0.1,
          cacheRead: 0.01,
          cacheWrite: 0.125,
          output: 0.5,
          // A prompt over 100,000 tokens, cache reads and writes included,
          // pays these for the whole request.
          tiers: [
            {
              aboveInputTokens: 100_000,
              input: 0.5,
              cacheRead: 0.05,
              cacheWrite: 0.625,
              output: 2.5,
            },
          ],
        },
      },
    },
  ],
};

/**
 * How a model that lets thinking be turned off turns it off. Opus 5.5 and
 * Fable 5.1 refuse to; Sonnet 5.5 refuses `disabled` and goes without
 * up-front thinking under `between_tools`. Both are refused at `xhigh` or
 * `max` effort, which an "off" choice never names.
 */
export const thinkingOff: Readonly<
  Record<string, "disabled" | "between_tools">
> = {
  "claude-sonnet-5-5": "between_tools",
  "claude-haiku-5-5": "disabled",
};
