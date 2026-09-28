import type { WorkspaceTask } from "@zhiyin/contract";

/** The visible final state after a model round with no tool calls. */
export function completionPhase(
  task: WorkspaceTask,
  text: string,
  reportOnly: boolean,
  incomplete: boolean,
  lengthReached: boolean,
): WorkspaceTask["phase"] {
  // A cut-off answer is never presented as complete.
  if (incomplete)
    return {
      kind: "interrupted",
      reason: lengthReached
        ? "The answer was cut off before it was finished. Ask again to carry on from here."
        : "The model stopped before returning an answer or action. Ask again to continue.",
    };
  const backgroundSpecialistIds = (task.specialistRuns ?? [])
    .filter((run) => run.status === "running")
    .map((run) => run.id);
  return {
    kind: "completed",
    outcome: {
      title: reportOnly ? "Work paused" : "Response complete",
      summary: text || "The model returned no text.",
    },
    ...(backgroundSpecialistIds.length ? { backgroundSpecialistIds } : {}),
  };
}
