import type { ToolGathering } from "@zhiyin/capabilities";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";

/** What gathering a conversation's tools uses. */
export type GatherDependencies = Pick<
  AgentLoopDependencies,
  "capabilities" | "host"
>;

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Gathers the tools a turn may offer. A connector reached for the first time
 * holds this up until it answers, so the turn names what it is waiting for, and
 * the connection list is looked at again once it has answered, either way.
 */
export async function gatherTools(
  deps: GatherDependencies,
  records: TurnRecords,
  taskId: string,
  activatedPlugins: readonly string[],
): Promise<ToolGathering> {
  const waitingFor: string[] = [];
  let shown = Promise.resolve();
  const gathered = await deps.capabilities.toolsFor(taskId, {
    skills: deps.host.capabilitiesAvailable(),
    activatedPlugins,
    onConnecting: (name) => {
      if (waitingFor.includes(name)) return;
      waitingFor.push(name);
      const note = `Connecting to ${listed(waitingFor)}`;
      shown = shown.then(() =>
        records.progress.working(taskId, note, records.progress.steps(taskId)),
      );
    },
  });
  if (!waitingFor.length) return gathered;
  await shown;
  await records.progress.working(
    taskId,
    undefined,
    records.progress.steps(taskId),
  );
  await deps.host.refreshConnections();
  return gathered;
}
