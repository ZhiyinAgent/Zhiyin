import {
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  type ModelCatalog,
  type ModelListState,
  type ModelProviderOption,
  type ProviderSettings,
  type ProviderSummary,
  type ProviderTarget,
} from "@zhiyin/contract";

/** The model list this version ships, with updates on. */
export const demoModelList: ModelListState = {
  source: "shipped",
  version: 1,
  published: "2026-10-22",
  updates: true,
};

/** The same, once a newer list was taken from GitHub. */
export const demoModelListDownloaded: ModelListState = {
  source: "downloaded",
  version: 2,
  published: "2026-11-03",
  updates: true,
  lastCheck: { at: "2026-11-04T09:12:00.000Z", outcome: "updated" },
};

/** Updates on, and the last look could not reach GitHub. */
export const demoModelListUnreached: ModelListState = {
  ...demoModelList,
  lastCheck: {
    at: "2026-10-22T09:12:00.000Z",
    outcome: "failed",
    reason: "GitHub could not be reached.",
  },
};

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

const configured = { status: "configured", source: "credentialStore" } as const;
const missing = { status: "missing", source: "none" } as const;
const openRouterPages = {
  keys: OPENROUTER_KEYS_URL,
  billing: OPENROUTER_CREDITS_URL,
};

const xiaomiPages = {
  keys: "https://platform.xiaomimimo.com/#/console/api-keys",
  billing: "https://platform.xiaomimimo.com/#/console/recharge",
};

/** OpenRouter as the core names it, which is who the demo pages send to. */
export const demoOpenRouter: NonNullable<ProviderSettings["provider"]> = {
  id: "openrouter",
  name: "OpenRouter",
  pages: openRouterPages,
  upstreams: true,
};

const oneAccount = (
  id: string,
  name: string,
  pages: { keys: string; billing: string },
): ProviderSummary => ({
  id,
  name,
  accounts: [{ credential: missing, pages }],
});

const twoPlatforms = (
  id: string,
  name: string,
  international: { keys: string; billing: string },
  mainland: { keys: string; billing: string },
): ProviderSummary => ({
  id,
  name,
  accounts: [
    {
      region: { id: "international", name: "International" },
      credential: missing,
      pages: international,
    },
    {
      region: { id: "mainland", name: "Mainland China" },
      credential: missing,
      pages: mainland,
    },
  ],
});

/**
 * Every provider Zhiyin ships, with the pages each names: OpenRouter with a
 * key stored, every lab without one.
 */
export const demoProviderSummaries: readonly ProviderSummary[] = [
  {
    ...demoOpenRouter,
    accounts: [{ credential: configured, pages: openRouterPages }],
  },
  oneAccount("anthropic", "Anthropic", {
    keys: "https://platform.claude.com/settings/keys",
    billing: "https://platform.claude.com/settings/billing",
  }),
  oneAccount("openai", "OpenAI", {
    keys: "https://platform.openai.com/settings/organization/api-keys",
    billing: "https://platform.openai.com/settings/organization/billing",
  }),
  twoPlatforms(
    "zai",
    "Z.ai",
    {
      keys: "https://z.ai/manage-apikey/apikey-list",
      billing: "https://z.ai/manage-apikey/billing",
    },
    {
      keys: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
      billing: "https://bigmodel.cn/",
    },
  ),
  twoPlatforms(
    "deepseek",
    "DeepSeek",
    {
      keys: "https://platform.deepseek.com/api_keys",
      billing: "https://platform.deepseek.com/",
    },
    {
      keys: "https://platform.deepseek.com/api_keys",
      billing: "https://platform.deepseek.com/",
    },
  ),
  twoPlatforms(
    "moonshot",
    "Kimi",
    {
      keys: "https://platform.kimi.ai/console/api-keys",
      billing: "https://platform.kimi.ai/docs/guide/account-and-payments",
    },
    {
      keys: "https://platform.kimi.com/console/api-keys",
      billing: "https://platform.kimi.com/docs/guide/account-and-payments",
    },
  ),
  twoPlatforms(
    "minimax",
    "MiniMax",
    {
      keys: "https://platform.minimax.io/user-center/basic-information/interface-key",
      billing: "https://platform.minimax.io/user-center/payment/balance",
    },
    {
      keys: "https://platform.minimax.cn/user-center/basic-information/interface-key",
      billing: "https://platform.minimax.cn/user-center/payment/balance",
    },
  ),
  twoPlatforms("xiaomi", "Xiaomi MiMo", xiaomiPages, xiaomiPages),
  twoPlatforms(
    "qwen",
    "Qwen",
    {
      keys: "https://home.qwencloud.com/api-keys",
      billing: "https://home.qwencloud.com/billing/overview",
    },
    {
      keys: "https://platform.qianwenai.com/home/api-keys",
      billing: "https://platform.qianwenai.com/home/",
    },
  ),
  oneAccount("mistral", "Mistral", {
    keys: "https://console.mistral.ai/api-keys",
    billing: "https://admin.mistral.ai/organization/billing",
  }),
];

/** The same providers, with keys stored for DeepSeek and MiniMax as well. */
export const demoLabSummaries: readonly ProviderSummary[] =
  demoProviderSummaries.map((summary) =>
    summary.id === "deepseek" || summary.id === "minimax"
      ? {
          ...summary,
          accounts: summary.accounts.map((account) => ({
            ...account,
            credential: configured,
          })),
        }
      : summary,
  );

/** DeepSeek on its mainland platform, as the core names it. */
export const demoDeepSeekMainland: NonNullable<ProviderSettings["provider"]> = {
  id: "deepseek",
  name: "DeepSeek",
  region: { id: "mainland", name: "Mainland China" },
  pages: {
    keys: "https://platform.deepseek.com/api_keys",
    billing: "https://platform.deepseek.com/",
  },
};

/** 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. */
const deepSeekPeak = {
  weekdaysUtc: [1, 2, 3, 4, 5],
  hoursUtc: [
    [1, 4],
    [6, 10],
  ] as const,
};

/**
 * Two labs' own lists, priced as they ship on each platform on 2026-10-09:
 * DeepSeek's busy-hour prices and MiniMax's higher tier past 512K input.
 * Any other provider lists OpenRouter's catalogue.
 */
export function demoLabCatalog(target?: ProviderTarget): ModelCatalog {
  const mainland = target?.region === "mainland";
  if (target?.provider === "deepseek")
    return {
      status: "ready",
      models: [
        {
          id: "deepseek-flash",
          name: "DeepSeek V4.1 Flash",
          contextWindow: 1_048_576,
          acceptsImages: true,
          reasoning: true,
          price: mainland
            ? {
                currency: "CNY",
                input: 1,
                cacheRead: 0.02,
                output: 4,
                peak: { ...deepSeekPeak, input: 2, cacheRead: 0.04, output: 8 },
                checked: "2026-10-09",
              }
            : {
                currency: "USD",
                input: 0.15,
                cacheRead: 0.003,
                output: 0.6,
                peak: {
                  ...deepSeekPeak,
                  input: 0.3,
                  cacheRead: 0.006,
                  output: 1.2,
                },
                checked: "2026-10-09",
              },
        },
        {
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          contextWindow: 1_048_576,
          acceptsImages: false,
          reasoning: true,
          price: mainland
            ? {
                currency: "CNY",
                input: 4.5,
                cacheRead: 0.15,
                output: 13.5,
                peak: { ...deepSeekPeak, input: 9, cacheRead: 0.3, output: 27 },
                checked: "2026-10-09",
              }
            : {
                currency: "USD",
                input: 0.66,
                cacheRead: 0.022,
                output: 1.98,
                peak: {
                  ...deepSeekPeak,
                  input: 1.32,
                  cacheRead: 0.044,
                  output: 3.96,
                },
                checked: "2026-10-09",
              },
        },
      ],
    };
  if (target?.provider === "minimax")
    return {
      status: "ready",
      models: [
        {
          id: "MiniMax-M3",
          name: "MiniMax-M3",
          contextWindow: 1_000_000,
          acceptsImages: false,
          reasoning: true,
          price: mainland
            ? {
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
                checked: "2026-10-09",
              }
            : {
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
                checked: "2026-10-09",
              },
        },
      ],
    };
  return demoCatalog;
}
