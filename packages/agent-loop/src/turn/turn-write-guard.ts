import type { WorkspaceTask } from "@zhiyin/contract";
import type { TurnOwnership } from "./turn-ownership.js";

/**
 * Whether a durable write to a conversation may land, asked once as it begins
 * and again as each part of it is saved.
 *
 * A write is its author's: the turn whose work made it. Once that turn is
 * stopped, nothing it writes lands, whoever holds the conversation by then.
 * The stop itself, and the end a stopped specialist records, are written on
 * no turn's behalf. While a turn runs there, a write made on no turn's behalf
 * lands only while that turn does.
 */
export function turnWriteGuard(
  ownership: TurnOwnership,
): (task: WorkspaceTask) => () => boolean {
  return (task) => {
    const author = ownership.author();
    const unstopped = () => !author?.signal.aborted;
    if (!unstopped()) return () => false;
    if (task.phase.kind === "interrupted") return unstopped;
    const controller = ownership.controller(task.id);
    if (!controller) return unstopped;
    return () =>
      unstopped() &&
      ownership.owns(task.id, controller) &&
      !controller.signal.aborted;
  };
}
