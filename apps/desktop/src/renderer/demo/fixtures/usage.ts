import type { UsageState } from "../../ui/app/index.js";

function distribute(total: number, days: number) {
  const weights = Array.from(
    { length: days },
    (_, index) => 3 + ((index * 7) % 11),
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const values = weights.map((value) =>
    Math.floor((total * value) / weightTotal),
  );
  values[values.length - 1]! +=
    total - values.reduce((sum, value) => sum + value, 0);
  return values;
}

function dateAtOffset(offset: number) {
  const date = new Date(Date.UTC(2026, 8, 2 + offset));
  return date.toISOString().slice(0, 10);
}

function demoRange(days: 7 | 30, requests: number, costUsd: number) {
  const dailyRequests = distribute(requests, days);
  return {
    days,
    requests,
    inputTokens: days === 7 ? 7_000_000 : 28_000_000,
    outputTokens: days === 7 ? 2_600_000 : 10_400_000,
    costUsd,
    pricedRequests: requests,
    activity: dailyRequests.map((count, index) => ({
      date: dateAtOffset(index - days + 1),
      requests: count,
      costUsd: Number(((count / requests) * costUsd).toFixed(6)),
    })),
    models: [
      {
        model: "z-ai/glm-5.3-flash",
        requests: Math.round(requests * 0.62),
        inputTokens: days === 7 ? 4_500_000 : 18_000_000,
        outputTokens: days === 7 ? 1_700_000 : 6_800_000,
        costUsd: Number((costUsd * 0.51).toFixed(6)),
      },
      {
        model: "openai/gpt-5.4",
        requests: Math.round(requests * 0.25),
        inputTokens: days === 7 ? 1_800_000 : 7_000_000,
        outputTokens: days === 7 ? 650_000 : 2_500_000,
        costUsd: Number((costUsd * 0.31).toFixed(6)),
      },
      {
        model: "anthropic/claude-sonnet-5",
        requests:
          requests - Math.round(requests * 0.62) - Math.round(requests * 0.25),
        inputTokens: days === 7 ? 700_000 : 3_000_000,
        outputTokens: days === 7 ? 250_000 : 1_100_000,
        costUsd: Number((costUsd * 0.18).toFixed(6)),
      },
    ],
    conversations: [
      {
        conversationId: "release",
        requests: Math.round(requests * 0.46),
        pricedRequests: Math.round(requests * 0.46) - 2,
        costUsd: Number((costUsd * 0.58).toFixed(6)),
      },
      {
        conversationId: "research",
        requests: Math.round(requests * 0.38),
        pricedRequests: Math.round(requests * 0.38),
        costUsd: Number((costUsd * 0.33).toFixed(6)),
      },
      {
        conversationId: "deleted-earlier",
        requests: Math.round(requests * 0.14),
        pricedRequests: Math.round(requests * 0.14),
        costUsd: Number((costUsd * 0.085).toFixed(6)),
      },
      {
        requests:
          requests -
          Math.round(requests * 0.46) -
          Math.round(requests * 0.38) -
          Math.round(requests * 0.14),
        pricedRequests:
          requests -
          Math.round(requests * 0.46) -
          Math.round(requests * 0.38) -
          Math.round(requests * 0.14),
        costUsd: Number((costUsd * 0.005).toFixed(6)),
      },
    ],
  };
}

export const demoUsage: UsageState = {
  status: "ready",
  costSource: "provider-reported",
  ranges: {
    "7": demoRange(7, 1_284, 18.42),
    "30": demoRange(30, 5_238, 64.9),
  },
};
