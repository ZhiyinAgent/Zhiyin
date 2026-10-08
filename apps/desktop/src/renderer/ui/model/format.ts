/**
 * How prices, context windows and timings are written for someone who has
 * never chosen a model before. Units live in column headings, so these return
 * bare values — and an absent measurement reads as absent, never as zero.
 */

export function perMillion(usd: number): string {
  if (usd === 0) return "free";
  if (usd < 1)
    return `$${usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${usd.toFixed(2)}`;
}

export function tokenCount(tokens: number): string {
  if (tokens >= 1e6) return `${Math.round(tokens / 1e5) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
}

export function responseTime(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)} s`
    : `${Math.round(milliseconds)} ms`;
}
