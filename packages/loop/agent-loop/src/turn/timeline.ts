import type { WorkspaceTask } from "@zhiyin/contract";

/**
 * The next free position on the timeline, counting everything that occupies
 * one, views included: two drawings made in the same turn and the action
 * after them each take a position of their own, and sort in the order they
 * were made.
 */
export function nextTimelineSequence(task: WorkspaceTask): number {
  const explicit = [
    ...task.messages.map((message) => message.sequence),
    ...task.actions.map((action) => action.sequence),
    ...task.views.map((view) => view.sequence),
    ...task.interactions.map((interaction) => interaction.sequence),
    ...task.specialistRuns.map((run) => run.sequence),
  ];
  const explicitNext = explicit.length > 0 ? Math.max(...explicit) + 1 : 0;
  return Math.max(
    explicitNext,
    task.messages.length +
      task.actions.length +
      task.views.length +
      task.interactions.length +
      task.specialistRuns.length,
  );
}

/** A tool's or an identifier's name as words a person reads. */
export function humanizeIdentifier(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words
    ? `${words.charAt(0).toUpperCase()}${words.slice(1)}`
    : "Unavailable action";
}
