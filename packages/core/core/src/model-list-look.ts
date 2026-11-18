import type { ModelListState } from "@zhiyin/contract";
import type { ModelListUpdates } from "@zhiyin/model-client";
import type { LogEntry } from "./diagnostic-log.js";

/**
 * Looks once for a newer model list and keeps what came of it in the
 * diagnostic log: the version of a list taken, or why a look failed. Nothing
 * newer, or updates switched off, leaves no line.
 */
export async function lookForNewerModelList(
  modelList: Pick<ModelListUpdates, "refresh"> & {
    state(): Pick<ModelListState, "version">;
  },
  log: { record(entry: LogEntry): void },
): Promise<void> {
  const look = await modelList.refresh();
  if (look.outcome === "updated")
    log.record({
      level: "info",
      source: "model-list",
      message: `Model list ${modelList.state().version} was taken.`,
    });
  else if (look.outcome === "failed")
    log.record({
      level: "warn",
      source: "model-list",
      message: `No newer model list was taken: ${look.reason}`,
    });
}
