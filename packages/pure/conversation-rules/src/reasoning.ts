import type {
  ReasoningCapabilities,
  ReasoningSelection,
} from "@zhiyin/contract";

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
