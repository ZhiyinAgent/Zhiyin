/**
 * MiniMax's models and prices, checked 2026-10-09 against MiniMax's own
 * documentation: the Anthropic-compatible API reference (window, longest
 * reply, thinking, pictures) and the pay-as-you-go pricing pages of
 * platform.minimax.io in US dollars and platform.minimaxi.com in yuan.
 *
 * MiniMax-M3's prices carry a "permanent 50% off", so the list holds the
 * reduced price; past 512k input tokens, cache hits included, the whole
 * request pays the higher rates. M2.7 bills cache writes, which only explicit
 * marks make and Zhiyin sends none of. Each longest reply is the one MiniMax
 * recommends (131,072 and 65,536); the documented maximums are 524,288 and
 * 204,800.
 *
 * Left out: MiniMax-M3.1-Flash-Preview, offered only through MiniMax's coding
 * plans for now, and the highspeed and legacy M2 models.
 */

import type { ReasoningCapabilities } from "@zhiyin/contract";
import type { ModelList } from "../../model-list.js";

/** On by Zhiyin's choice, which M3 lets the person turn off; no effort. */
const optionalThinking: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  efforts: [],
};

/** M2.x always thinks: `disabled` is accepted and ignored. */
const alwaysThinking: ReasoningCapabilities = {
  status: "available",
  required: true,
  defaultEnabled: true,
  efforts: [],
};

export const miniMaxModels: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "MiniMax-M3",
      name: "MiniMax-M3",
      contextWindow: 1_000_000,
      maximumOutputTokens: 131_072,
      // MiniMax documents pictures for M3, but checked live 2026-10-09 it
      // misread every one: a logo by URL or in the request, plain squares of
      // one colour from 64 to 512 pixels. Offered none until it reads them.
      acceptsImages: false,
      reasoning: optionalThinking,
      offered: {
        international: {
          currency: "USD",
          input: 0.3,
          cacheRead: 0.06,
          output: 1.2,
          tiers: [
            {
              aboveInputTokens: 512_000,
              input: 0.6,
              cacheRead: 0.12,
              output: 2.4,
            },
          ],
        },
        mainland: {
          currency: "CNY",
          input: 2.1,
          cacheRead: 0.42,
          output: 8.4,
          tiers: [
            {
              aboveInputTokens: 512_000,
              input: 4.2,
              cacheRead: 0.84,
              output: 16.8,
            },
          ],
        },
      },
    },
    {
      id: "MiniMax-M2.7",
      name: "MiniMax-M2.7",
      contextWindow: 204_800,
      maximumOutputTokens: 65_536,
      acceptsImages: false,
      reasoning: alwaysThinking,
      offered: {
        international: {
          currency: "USD",
          input: 0.3,
          cacheRead: 0.06,
          cacheWrite: 0.375,
          output: 1.2,
        },
        mainland: {
          currency: "CNY",
          input: 2.1,
          cacheRead: 0.42,
          cacheWrite: 2.625,
          output: 8.4,
        },
      },
    },
  ],
};
