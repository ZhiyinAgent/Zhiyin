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
 * Verified against OpenRouter's model list: each entry carries
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
    typeof value.mandatory !== "boolean"
  )
    return unavailable;
  const stated = "default_enabled" in value ? value.default_enabled : undefined;
  if (stated !== undefined && typeof stated !== "boolean") return unavailable;
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
  // An entry that leaves out whether reasoning is on by default still says so
  // when the model requires reasoning or names the effort it uses by default.
  // With neither, the default is unknown, and so is what "off" would change.
  if (stated === undefined && !value.mandatory && !defaultEffort)
    return unavailable;
  return {
    status: "available",
    required: value.mandatory,
    defaultEnabled: value.mandatory || (stated ?? true),
    efforts: [...new Set(supported)],
    ...(defaultEffort ? { defaultEffort } : {}),
  };
}
