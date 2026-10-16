import type { WorkspaceTask } from "@zhiyin/contract";
import type { TurnOwnership } from "./turn-ownership.js";

/**
 * Whether a durable write to a conversation may land, asked once as it begins
 * and again as each part of it is saved.
 *
 * A write is its author's: the turn whose work made it. Once that turn is
 * stopped, nothing it writes lands, whoever holds the conversation by then.
 * The stop itself, and the end a stopped specialist records, are written on
 * no turn's behalf. Beyond that, while nothing runs in the conversation, as
 * after Stop, no write starts work in it, and while a turn runs there, a
 * write made on no turn's behalf lands only while that turn does.
 */
export function turnWriteGuard(
  ownership: TurnOwnership,
  saved: (taskId: string) => WorkspaceTask | undefined,
): (task: WorkspaceTask) => () => boolean {
  return (task) => {
    const author = ownership.author();
    const unstopped = () => !author?.signal.aborted;
    const before = saved(task.id);
    const starts = before !== undefined && startsWork(before, task);
    const idle = () => starts && !ownership.runningUnder(task.id);
    if (!unstopped() || idle()) return () => false;
    if (task.phase.kind === "interrupted") return () => unstopped() && !idle();
    const controller = ownership.controller(task.id);
    if (!controller) return () => unstopped() && !idle();
    return () =>
      unstopped() &&
      ownership.owns(task.id, controller) &&
      !controller.signal.aborted;
  };
}

/** The phases a turn shows only while it runs. */
const livePhases: ReadonlySet<WorkspaceTask["phase"]["kind"]> = new Set([
  "working",
  "approval",
  "input",
  "browser",
]);

/**
 * Whether `after` starts work `before` did not have: a phase only a running
 * turn shows, or an action or specialist that was not already running.
 */
function startsWork(before: WorkspaceTask, after: WorkspaceTask): boolean {
  if (
    livePhases.has(after.phase.kind) &&
    JSON.stringify(after.phase) !== JSON.stringify(before.phase)
  )
    return true;
  const running = (items: readonly { id: string; status: string }[]) =>
    new Set(
      items.filter((item) => item.status === "running").map((item) => item.id),
    );
  const actions = running(before.actions);
  const runs = running(before.specialistRuns);
  return (
    after.actions.some(
      (action) => action.status === "running" && !actions.has(action.id),
    ) ||
    after.specialistRuns.some(
      (run) => run.status === "running" && !runs.has(run.id),
    )
  );
}
