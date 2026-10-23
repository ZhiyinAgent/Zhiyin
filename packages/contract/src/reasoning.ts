export const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ReasoningSelection =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly effort?: ReasoningEffort };

export type ReasoningCapabilities =
  | {
      readonly status: "available";
      readonly required: boolean;
      readonly defaultEnabled: boolean;
      readonly defaultEffort?: ReasoningEffort;
      readonly efforts: readonly ReasoningEffort[];
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      /**
       * The settings could not be looked up, so whether the model offers any
       * is not known. Absent when the model offers none.
       */
      readonly lookupFailed?: true;
    };

export type ReasoningTrace = {
  readonly text: string;
  readonly status: "streaming" | "complete" | "interrupted";
};

/**
 * A chosen reasoning setting as the model can take it. An effort it does not
 * offer becomes its default effort, or reasoning on with no effort named where
 * it lists none; off becomes on where it requires reasoning. Nothing for a
 * model that offers no reasoning, unchanged where its controls are unknown,
 * and nothing where nothing was chosen.
 */
export function offeredReasoning(
  capabilities: ReasoningCapabilities | undefined,
  chosen: ReasoningSelection | undefined,
): ReasoningSelection | undefined {
  if (capabilities?.status === "unavailable" && !capabilities.lookupFailed)
    return undefined;
  if (!chosen || capabilities?.status !== "available") return chosen;
  if (
    chosen.enabled
      ? !chosen.effort || capabilities.efforts.includes(chosen.effort)
      : !capabilities.required
  )
    return chosen;
  const effort = capabilities.defaultEffort;
  return effort && capabilities.efforts.includes(effort)
    ? { enabled: true, effort }
    : { enabled: true };
}
