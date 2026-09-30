import type { ModelCatalog, ModelProviderOption } from "@zhiyin/contract";

/**
 * A slice of the real catalogue, shaped as the app receives it. Prices, context
 * windows and measurements are values the provider actually returned on
 * 2026-09-10 rather than invented ones, so the lab shows the layout under real
 * numbers — including an upstream that cannot run tools and one with no
 * measurements at all.
 */
export const demoCatalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "z-ai/glm-5.3-flash",
      name: "Z.ai: GLM 5.3 Flash",
      contextWindow: 1_310_720,
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.25,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "anthropic/claude-sonnet-5",
      name: "Anthropic: Claude Sonnet 5",
      contextWindow: 1_000_000,
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "openai/gpt-5.4",
      name: "OpenAI: GPT-5.4",
      contextWindow: 1_050_000,
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "minimax/minimax-m2.5",
      name: "MiniMax: MiniMax M2.5",
      contextWindow: 204_800,
      inputUsdPerMillion: 0.27,
      outputUsdPerMillion: 1.08,
      acceptsImages: false,
      reasoning: true,
    },
  ],
};

export const demoProviders: readonly ModelProviderOption[] = [
  {
    slug: "deepinfra/fp4",
    name: "DeepInfra",
    quantization: "fp4",
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.25,
    acceptsTools: true,
    responseMs: 1845,
    tokensPerSecond: 15,
    uptimePercent: 95,
  },
  {
    slug: "z-ai/fp8",
    name: "Z.AI",
    quantization: "fp8",
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.25,
    acceptsTools: false,
    responseMs: 3726,
    tokensPerSecond: 38,
    uptimePercent: 86.1,
  },
  {
    slug: "crusoe/fp4",
    name: "Crusoe",
    quantization: "fp4",
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.5,
    acceptsTools: true,
    responseMs: 780,
    tokensPerSecond: 132,
    uptimePercent: 100,
  },
  {
    slug: "fireworks",
    name: "Fireworks",
    quantization: null,
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.5,
    acceptsTools: true,
    responseMs: null,
    tokensPerSecond: null,
    uptimePercent: null,
  },
];
