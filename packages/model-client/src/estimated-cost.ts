/**
 * What a request cost by the model list's prices, for a provider that does
 * not report costs (ADR 0015). An estimate, in the list's currency, never
 * converted: only as current as the list, which is why it names the list's
 * date.
 */

import type { EstimatedCost, ModelPrice, TokenPrices } from "@zhiyin/contract";
import type { ModelUsage } from "./model-client.js";

/** The prices in force for a request of this size at this time. */
function ratesFor(price: ModelPrice, inputTokens: number, at: Date) {
  const peak = price.peak;
  if (
    peak?.weekdaysUtc.includes(at.getUTCDay()) &&
    peak.hoursUtc.some(
      ([from, to]) => at.getUTCHours() >= from && at.getUTCHours() < to,
    )
  )
    return peak;
  const tier = (price.tiers ?? [])
    .filter((each) => inputTokens > each.aboveInputTokens)
    .sort((left, right) => right.aboveInputTokens - left.aboveInputTokens)[0];
  return tier ?? price;
}

/**
 * Undefined when the request used a kind of token the list gives no price
 * for: an unknown price is not a free one.
 */
export function estimateCost(
  price: ModelPrice,
  usage: ModelUsage,
  at: Date,
): EstimatedCost | undefined {
  const rates: TokenPrices = ratesFor(price, usage.inputTokens, at);
  const read = Math.max(0, usage.cacheReadTokens ?? 0);
  const written = Math.max(0, usage.cacheWriteTokens ?? 0);
  if (
    (read > 0 && rates.cacheRead === undefined) ||
    (written > 0 && rates.cacheWrite === undefined)
  )
    return undefined;
  const uncached = Math.max(0, usage.inputTokens - read - written);
  const amount =
    (uncached * rates.input +
      read * (rates.cacheRead ?? 0) +
      written * (rates.cacheWrite ?? 0) +
      Math.max(0, usage.outputTokens) * rates.output) /
    1_000_000;
  return { amount, currency: price.currency, priceList: price.checked };
}
