import type { ReviewerModelChoice } from "@zhiyin/contract";

const named = (value: unknown, longest: number) =>
  typeof value === "string" && value !== "" && value.length <= longest;

/** A provider, a model and its upstreams, an optional region, and nothing else. */
export function isReviewerModelChoice(
  value: unknown,
): value is ReviewerModelChoice {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  const providers = item["providers"];
  return (
    Object.keys(item).every((key) =>
      ["provider", "region", "model", "providers"].includes(key),
    ) &&
    named(item["provider"], 64) &&
    (item["region"] === undefined || named(item["region"], 64)) &&
    named(item["model"], 200) &&
    Array.isArray(providers) &&
    providers.length <= 64 &&
    providers.every((slug) => named(slug, 200))
  );
}
