import {
  REASONING_EFFORTS,
  type ReasoningCapabilities,
  type ReasoningEffort,
} from "@zhiyin/contract";

export async function fetchOpenRouterModelInfo(
  model: string,
): Promise<unknown> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Model information is unavailable.");
  const catalog: unknown = await response.json();
  if (
    !catalog ||
    typeof catalog !== "object" ||
    !("data" in catalog) ||
    !Array.isArray(catalog.data)
  )
    return undefined;
  return catalog.data.find(
    (entry: unknown) =>
      entry && typeof entry === "object" && "id" in entry && entry.id === model,
  );
}

/**
 * Whether the catalogue says this model takes images as input.
 *
 * Verified against OpenRouter's model list on 2026-09-09: each entry carries
 * `architecture.input_modalities`, and vision differs within one family —
 * `z-ai/glm-5.3-flash` lists `image`, `z-ai/glm-5.3` does not.
 */
export function acceptsImages(info: unknown): boolean {
  if (!info || typeof info !== "object" || !("architecture" in info))
    return false;
  const architecture = info.architecture;
  if (
    !architecture ||
    typeof architecture !== "object" ||
    !("input_modalities" in architecture) ||
    !Array.isArray(architecture.input_modalities)
  )
    return false;
  return architecture.input_modalities.includes("image");
}

export function reasoningCapabilities(info: unknown): ReasoningCapabilities {
  const unavailable = {
    status: "unavailable" as const,
    reason: "Reasoning settings are unavailable for this model.",
  };
  if (!info || typeof info !== "object" || !("reasoning" in info))
    return unavailable;
  const value = info.reasoning;
  if (
    !value ||
    typeof value !== "object" ||
    !("mandatory" in value) ||
    typeof value.mandatory !== "boolean" ||
    !("default_enabled" in value) ||
    typeof value.default_enabled !== "boolean"
  )
    return unavailable;
  const supported =
    "supported_efforts" in value && Array.isArray(value.supported_efforts)
      ? value.supported_efforts.filter(
          (effort: unknown): effort is ReasoningEffort =>
            REASONING_EFFORTS.some((known) => known === effort),
        )
      : [];
  const defaultEffort =
    "default_effort" in value &&
    supported.includes(value.default_effort as ReasoningEffort)
      ? (value.default_effort as ReasoningEffort)
      : undefined;
  return {
    status: "available",
    required: value.mandatory,
    defaultEnabled: value.mandatory || value.default_enabled,
    efforts: [...new Set(supported)],
    ...(defaultEffort ? { defaultEffort } : {}),
  };
}
