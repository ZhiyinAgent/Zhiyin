import {
  REASONING_EFFORTS,
  type ReasoningCapabilities,
  type ReasoningEffort,
} from "@zhiyin/contract";

/** The reasoning controls a model's catalogue entry offers. */
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
