import type { WorkspaceTask } from "@zhiyin/contract";
import type { TurnOwnership } from "./turn-ownership.js";

/**
 * Whether a durable write to a conversation may land, asked once as it begins
 * and again as each part of it is saved.
 *
 * A write is its author's: the turn whose work made it. Once that turn is
 * stopped, nothing it writes lands, whoever holds the conversation by then.
 * The stop itself, and the ends of specialists and jobs, are written on no
 * turn's behalf. While a turn runs there, a write made on no turn's behalf
 * lands unless that turn is stopped: it holds that turn's conversation, so
 * landing after a stop would undo the stop. Such a change is made again on
 * what the stop left. A turn that finishes on its own was not stopped, so
 * what was being saved as it finished lands.
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
    return () => unstopped() && !controller.signal.aborted;
  };
}
